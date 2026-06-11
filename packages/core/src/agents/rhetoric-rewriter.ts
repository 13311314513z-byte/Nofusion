/**
 * Rhetoric rewriter — LLM-based rewriting of text to reduce repetitive rhetoric.
 *
 * Provides:
 *   - Prompt builders for LLM-based rhetoric deduplication
 *   - Rhetoric awareness utility for Pipeline writer prompts
 *   - Threshold definitions for safe rhetoric usage
 *
 * The actual LLM call is handled by the Studio API layer (server.ts),
 * which passes the built prompt to the LLM provider.
 */

import { detectDuplicateRhetoric, type RhetoricCategory, type DuplicateRhetoricFinding } from "../utils/semantic-duplication.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RewriteMode = "replace" | "delete" | "redistribute";

export interface RewriteOptions {
  readonly mode: RewriteMode;
  readonly targetPerThousandChars: number;
  readonly maxChanges: number;
}

export interface RhetoricChange {
  readonly original: string;
  readonly modified: string;
  readonly reason: string;
  readonly category: RhetoricCategory;
}

export interface RewriteResult {
  readonly result: string;
  readonly changes: ReadonlyArray<RhetoricChange>;
  readonly changedRanges: ReadonlyArray<{ readonly start: number; readonly end: number }>;
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export const RHETORIC_SAFE_THRESHOLDS: Partial<Record<RhetoricCategory, number>> = {
  metaphor: 2,
  parallelism: 1,
  personification: 1,
  repetition: 2,
  transition: 3,
  hyperbole: 1,
  "rhetorical-question": 1,
  anaphora: 1,
  epistrophe: 1,
  "parallel-structure": 2,
};

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

/**
 * Build a prompt for Pipeline writer agent to be aware of rhetoric usage.
 * Injects statistics about rhetoric usage in the already-written text so the
 * writer can naturally avoid overusing similar devices in subsequent sections.
 */
export function buildRhetoricAwarePrompt(
  basePrompt: string,
  contextText: string,
  maxPerThousandChars?: Partial<Record<RhetoricCategory, number>>,
): string {
  const stats = detectDuplicateRhetoric(contextText);
  const thresholds = { ...RHETORIC_SAFE_THRESHOLDS, ...maxPerThousandChars };
  const warnings: string[] = [];

  for (const finding of stats.findings) {
    const limit = thresholds[finding.category] ?? 2;
    if (finding.perThousandChars >= limit) {
      warnings.push(
        `- 已使用 ${finding.label} ${finding.count} 次（${finding.perThousandChars.toFixed(1)}/千字），` +
        `接近上限 ${limit}/千字，后续段落请减少使用。`,
      );
    }
  }

  if (warnings.length === 0) return basePrompt;

  return `${basePrompt}\n\n【修辞使用提示】\n前文已出现的修辞统计如下。请在继续写作时自然分散修辞使用，避免同类修辞过度集中：\n${warnings.join("\n")}`;
}

/**
 * Build the user prompt for LLM-based rhetoric deduplication.
 * The caller (typically Studio API) sends this prompt to the LLM provider.
 */
export function buildDedupePrompt(
  text: string,
  findings: ReadonlyArray<DuplicateRhetoricFinding>,
  mode: RewriteMode,
): string {
  const findingsJson = JSON.stringify(
    findings.map((f) => ({
      category: f.category,
      label: f.label,
      count: f.count,
      perThousandChars: f.perThousandChars,
      severity: f.severity,
      examples: f.examples.slice(0, 2).map((e) => e.text),
    })),
    null,
    2,
  );

  const modeDescriptions: Record<RewriteMode, string> = {
    replace: "用同义表达替换重复修辞，保持原意",
    delete: "删除冗余修辞，保留核心语义",
    redistribute: "将连续同类修辞分散或重组到全文各处",
  };

  return `你是一个中文小说编辑助手。以下是用户文稿中发现的修辞重复问题：

${findingsJson}

请对原文进行最小干预修改，遵循以下规则：
1. 修改模式：${modeDescriptions[mode]}
2. 保持原文风格和叙事节奏
3. 每处修改都提供修改理由
4. 修改后修辞重复度应低于安全阈值
5. 不要引入新的 AI 腔
6. 返回 JSON 格式：{ "result": "修改后的完整文本", "changes": [{"original": "...", "modified": "...", "reason": "..."}] }

【待修改文本】
${text}`;
}
