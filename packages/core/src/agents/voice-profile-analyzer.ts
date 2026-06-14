/**
 * Voice Profile Analyzer — extracts character vocal fingerprints from dialogue.
 *
 * Collects all dialogue lines for a character across chapters, then applies
 * rule-based heuristics for sentence-level features and (optionally) LLM
 * analysis for dialogue style classification.
 *
 * @module
 */

import { BaseAgent, type AgentContext } from "./base.js";
import { VoiceProfileSchema, type VoiceProfile } from "../models/voice-profile.js";

export interface AnalyzeVoiceInput {
  /** Character ID to analyze. */
  readonly characterId: string;
  /** Display name. */
  readonly characterName: string;
  /** All dialogue lines for this character across analyzed chapters. */
  readonly dialogueLines: ReadonlyArray<string>;
  /** Chapter numbers these lines come from. */
  readonly sourceChapters: ReadonlyArray<number>;
  /** Whether to use LLM for style classification. */
  readonly useLlm?: boolean;
}

export class VoiceProfileAnalyzer extends BaseAgent {
  constructor(ctx: AgentContext) {
    super(ctx);
  }

  get name(): string {
    return "voice-profile-analyzer";
  }

  async analyze(input: AnalyzeVoiceInput): Promise<VoiceProfile> {
    const dialogue = input.dialogueLines;

    // ── Rule-based analysis ───────────────────────────────────
    const avgLen = dialogue.length > 0
      ? Math.round(dialogue.reduce((sum, d) => sum + d.length, 0) / dialogue.length)
      : undefined;

    const shortCount = dialogue.filter(d => d.length < 10).length;
    const prefersShort = dialogue.length > 0 && shortCount / dialogue.length > 0.5;

    const rhetoricalCount = dialogue.filter(d =>
      /[？?]$/.test(d.trim()) && !/[吗呢吧啊]/.test(d),
    ).length;
    const usesRhetorical = dialogue.length > 0 && rhetoricalCount / dialogue.length > 0.15;

    // Determine sentence complexity from average length
    let complexity: VoiceProfile["sentenceComplexity"] = "moderate";
    if (avgLen !== undefined) {
      if (avgLen < 15) complexity = "simple";
      else if (avgLen > 50) complexity = "complex";
    }

    // Simple word frequency for signature phrases
    const wordFreq = new Map<string, number>();
    for (const line of dialogue) {
      const words = line.replace(/[，。！？、；：""''「」『』\s]/g, "|").split("|").filter(Boolean);
      for (const word of words) {
        if (word.length >= 2) {
          wordFreq.set(word, (wordFreq.get(word) ?? 0) + 1);
        }
      }
    }
    const signaturePhrases = [...wordFreq.entries()]
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);

    // ── LLM-based style classification ────────────────────────
    let dialogueStyle: VoiceProfile["dialogueStyle"] = "casual";
    let vocabularyLevel: VoiceProfile["vocabularyLevel"] = "standard";

    if (input.useLlm && dialogue.length > 0) {
      try {
        const llmResult = await this.classifyWithLLM(dialogue, input.characterName);
        dialogueStyle = llmResult.style;
        vocabularyLevel = llmResult.vocabulary;
      } catch {
        // Fall back to rule-based defaults
      }
    }

    return VoiceProfileSchema.parse({
      characterId: input.characterId,
      characterName: input.characterName,
      avgSentenceLength: avgLen,
      sentenceComplexity: complexity,
      prefersShortSentences: prefersShort,
      usesRhetoricalQuestions: usesRhetorical,
      signaturePhrases,
      vocabularyLevel,
      dialogueStyle,
      interruptionTendency: 0.3,
      usesDialect: false,
      dialectNotes: "",
      analyzedFromChapters: input.sourceChapters,
      confidence: input.useLlm ? 0.7 : 0.4,
      updatedAt: new Date().toISOString(),
    });
  }

  private async classifyWithLLM(
    dialogue: ReadonlyArray<string>,
    characterName: string,
  ): Promise<{ style: VoiceProfile["dialogueStyle"]; vocabulary: VoiceProfile["vocabularyLevel"] }> {
    const samples = dialogue.slice(0, 20).join("\n");
    const prompt = `分析以下角色的对话风格：

角色名：${characterName}

对话样本：
${samples}

请判断：
1. 对话风格（选择一项）：terse(简洁)/verbose(冗长)/formal(正式)/casual(随意)/sarcastic(讽刺)/earnest(真挚)/cold(冷淡)/warm(温暖)
2. 词汇水平（选择一项）：colloquial(口语)/standard(标准)/literary(书面)

只输出 JSON：{"style":"...","vocabulary":"..."}`;

    const response = await this.chat(
      [
        { role: "system", content: "你是一个文学对话风格分析器。只输出JSON。" },
        { role: "user", content: prompt },
      ],
      { temperature: 0.1, maxTokens: 128 },
    );

    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in LLM response");

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      style: parsed.style ?? "standard",
      vocabulary: parsed.vocabulary ?? "standard",
    };
  }
}
