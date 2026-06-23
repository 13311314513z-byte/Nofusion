/**
 * Beta Reader — simulates a reader experience to provide structured feedback.
 *
 * Unlike a scoring model that outputs 1-10 numbers, the Beta Reader produces
 * evidence-bound observations: each judgment is anchored to specific paragraphs
 * in the chapter. This makes the feedback actionable and auditable.
 *
 * Maturity stages (controlled by `betaReaderMode` config):
 *   - off:      Not called
 *   - shadow:   Called but results are only logged, never shown or used
 *   - advisory: Results shown to the author, no automatic action
 *   - actionable: Results can trigger localized revision (only if calibration passes)
 *
 * Important: Writer and Reader should use different model families to avoid
 * self-preference bias in evaluation.
 *
 * @module
 */

import type {
BetaReaderOutput,
ReaderObservation
} from "../models/beta-reader-output.js";
import { logPromptManifest } from "../utils/prompt-tracing.js";
import { BaseAgent,type AgentContext } from "./base.js";

export type {
BetaReaderMode,
BetaReaderOutput,
ReaderObservation
} from "../models/beta-reader-output.js";

// ─── Agent ────────────────────────────────────────────────────────

export interface BetaReaderInput {
  readonly chapterContent: string;
  readonly chapterNumber: number;
  readonly genre?: string;
  readonly title?: string;
}

export class BetaReader extends BaseAgent {
  constructor(ctx: AgentContext) {
    super(ctx);
  }

  get name(): string {
    return "beta-reader";
  }

  /**
   * Read a chapter and produce evidence-bound observations.
   */
  async read(input: BetaReaderInput): Promise<BetaReaderOutput> {
    const systemPrompt = this.buildSystemPrompt(input.genre);
    const userPrompt = this.buildUserPrompt(input);

    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userPrompt },
    ];

    logPromptManifest(this.name, messages, this.ctx.model, this.log);

    // P1-13: Configurable LLM params via AgentContext, with sensible defaults
    const temperature = this.ctx.temperature ?? 0.3;
    const maxTokens = this.ctx.maxTokens ?? 1500;

    const response = await this.chat(messages, {
      temperature,
      maxTokens,
    });

    const observations = this.parseObservations(response.content);
    const modelInfo = {
      provider: this.ctx.client.provider,
      model: this.ctx.model,
      promptHash: this.computePromptHash(messages),
      version: "1.0.0",
    };

    return { observations, modelInfo };
  }

  // ─── Prompt building ──────────────────────────────────────────

  private buildSystemPrompt(genre?: string): string {
    return `你是一个${genre || "网文"}读者。请阅读以下章节，并根据你的真实阅读感受给出反馈。

## 反馈要求

请从以下 5 个维度给出观察。每个观察必须：
1. 给出判断（positive / mixed / negative）
2. **绑定到具体段落**（标明段落编号）
3. 说明理由

### 维度说明

- **engagement**：这章吸引人吗？你会想继续读吗？
- **clarity**：叙事清晰吗？有没有让人困惑的地方？
- **emotion**：情感推进自然吗？有没有触动你的情绪？
- **character**：角色真实可信吗？他们的行为是否符合性格？
- **expectation**：这一章让你对后续发展产生期待吗？

## 输出格式

请以 JSON 格式输出。每个 observation 必须包含 evidence 字段，evidence 中的段落编号为 1-indexed。

\`\`\`json
{
  "observations": [
    {
      "dimension": "engagement",
      "judgment": "positive",
      "evidence": [
        { "startParagraph": 3, "endParagraph": 5, "reason": "..." }
      ],
      "confidence": 0.85
    }
  ]
}
\`\`\`

## 规则

- 你是真实读者，不是评论家或编辑——给出你的真实阅读感受。
- 每个判断必须有段落证据。没有证据的判断不应出现在输出中。
- 如果你觉得某维度无法判断，可以省略该维度。
- 不要输出 1-10 分数——分数由评估层从 observations 中计算。`;
  }

  private buildUserPrompt(input: BetaReaderInput): string {
    const lines: string[] = [];

    if (input.title) {
      lines.push(`## 章节标题\n${input.title}\n`);
    }

    lines.push(`## 章节正文\n${input.chapterContent}`);

    lines.push(`\n## 反馈要求\n请用 JSON 格式输出你的观察，每个观察必须绑定到具体的段落编号。`);

    return lines.join("\n\n");
  }

  // ─── Response parsing ─────────────────────────────────────────

  private parseObservations(content: string): ReadonlyArray<ReaderObservation> {
    // Try to extract JSON from the response
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/{[\s\S]*"observations"[\s\S]*}/);

    if (!jsonMatch) {
      this.log?.warn("[beta-reader] No JSON found in response, returning empty observations");
      return [];
    }

    try {
      const parsed = JSON.parse(jsonMatch[1] ?? jsonMatch[0]!) as {
        observations?: ReadonlyArray<{
          dimension?: string;
          judgment?: string;
          evidence?: ReadonlyArray<{
            startParagraph?: number;
            endParagraph?: number;
            reason?: string;
          }>;
          confidence?: number;
        }>;
      };

      if (!parsed.observations || !Array.isArray(parsed.observations)) {
        return [];
      }

      const validDimensions = new Set(["engagement", "clarity", "emotion", "character", "expectation"]);
      const validJudgments = new Set(["positive", "mixed", "negative"]);

      return parsed.observations
        .filter((o): o is ReaderObservation => {
          if (!o.dimension || !validDimensions.has(o.dimension)) return false;
          if (!o.judgment || !validJudgments.has(o.judgment)) return false;
          if (!o.evidence || o.evidence.length === 0) return false;
          return o.evidence.every(
            (e: { startParagraph?: number; endParagraph?: number; reason?: string }) =>
              Number.isInteger(e.startParagraph) &&
              Number.isInteger(e.endParagraph) &&
              e.startParagraph! > 0 &&
              e.endParagraph! >= e.startParagraph! &&
              typeof e.reason === "string" &&
              e.reason.trim().length > 0,
          );
        })
        .map((o) => ({
          dimension: o.dimension as ReaderObservation["dimension"],
          judgment: o.judgment as ReaderObservation["judgment"],
          evidence: o.evidence!.map((e) => ({
            startParagraph: e.startParagraph!,
            endParagraph: e.endParagraph!,
            reason: e.reason!.trim(),
          })),
          confidence: typeof o.confidence === "number"
            ? Math.max(0, Math.min(1, o.confidence))
            : 0.5,
        }));
    } catch (e: unknown) {
      this.log?.warn(`[beta-reader] Failed to parse JSON response: ${e}`);
      return [];
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private computePromptHash(
    messages: ReadonlyArray<{ role: string; content: string }>,
  ): string {
    let hash = 5381;
    const combined = messages.map((m) => `${m.role}:${m.content}`).join("|");
    for (let i = 0; i < combined.length; i++) {
      hash = ((hash << 5) + hash + combined.charCodeAt(i)) & 0xffffffff;
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }
}
