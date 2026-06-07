/**
 * Style adjuster — generates structured adjustment plans from diagnostics
 * and optional author profile comparisons.
 *
 * Pure functions, no LLM, no file I/O.
 * Receives diagnostics output and comparison result as inputs.
 */

import type { FullStyleDiagnostics } from "./style-diagnostics.js";
import type { StyleComparisonResult } from "./style-comparator.js";
import type { AuthorStyleProfile } from "../style-library/models.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TextPatch {
  readonly expectedText: string;
  readonly replacementText: string;
  readonly position: { readonly start: number; readonly end: number };
}

export interface AdjustmentSuggestion {
  readonly id: string;
  readonly category: "intent-repetition" | "description-repetition" | "transition" | "clause-complexity" | "ai-tell" | "vocabulary" | "rhythm";
  readonly severity: "critical" | "warning" | "info";
  readonly confidence: number;
  readonly description: string;
  readonly originalSnippet: string;
  readonly instruction: string;
  readonly position: { readonly start: number; readonly end: number };
  readonly targetMetric?: string;
  readonly targetRange?: { readonly min: number; readonly max: number };
  readonly patch?: TextPatch;
}

export interface AdjustmentPlan {
  readonly sourceHash: string;
  readonly ruleVersion: string;
  readonly authorProfileId?: string;
  readonly authorProfileVersion?: number;
  readonly suggestions: ReadonlyArray<AdjustmentSuggestion>;
  readonly comparison?: StyleComparisonResult;
  readonly warnings: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stableId(
  ruleVersion: string,
  category: string,
  position: { readonly start: number; readonly end: number },
  evidence: string,
): string {
  const hash = evidence.split("").reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
  const posStr = `${position.start}-${position.end}`;
  return `${ruleVersion}/${category}/${posStr}/${Math.abs(hash).toString(36).slice(0, 6)}`;
}

function severityFromDiagnosticSeverity(
  ds: "high" | "medium" | "low",
): "critical" | "warning" | "info" {
  switch (ds) {
    case "high": return "critical";
    case "medium": return "warning";
    default: return "info";
  }
}

function clipText(text: string, start: number, end: number, maxLen = 80): string {
  const contextStart = Math.max(0, start - 10);
  const contextEnd = Math.min(text.length, end + 10);
  let snippet = text.slice(contextStart, contextEnd).replace(/\s+/g, " ").trim();
  if (snippet.length > maxLen) {
    snippet = snippet.slice(0, maxLen) + "...";
  }
  return snippet;
}

// ---------------------------------------------------------------------------
// Patch generators
// ---------------------------------------------------------------------------

function buildIntentPatch(
  text: string,
  finding: { readonly examples: ReadonlyArray<{ readonly start: number; readonly end: number }> },
): TextPatch | undefined {
  // For action-expression repetitions: merge duplicates by removing second occurrence
  if (finding.examples.length < 2) return undefined;

  const first = finding.examples[0];
  const second = finding.examples[1];

  // Only remove if the two occurrences are close (within 500 chars),
  // otherwise they're likely intentional repetitions across different scenes
  if (second.start - first.end > 500) return undefined;

  const snippet = text.slice(second.start, second.end);
  if (!snippet.trim()) return undefined;

  return {
    expectedText: snippet,
    replacementText: "",
    position: { start: second.start, end: second.end },
  };
}

function buildTransitionPatch(
  text: string,
  transition: string,
): TextPatch | undefined {
  // Find a paragraph-starting transition word
  // Paragraphs can be separated by \n (markdown) or by 。 (Chinese prose)
  const paragraphs = text.split(/\n|(?<=[。！？；])/);
  for (let i = 1; i < paragraphs.length; i++) {
    const trimmed = paragraphs[i].trim();
    if (trimmed.startsWith(transition)) {
      const idx = text.indexOf(trimmed);
      if (idx >= 0) {
        // Only remove the leading transition word, keep the rest of the sentence
        const afterTransition = trimmed.slice(transition.length).trim();
        return {
          expectedText: trimmed,
          replacementText: afterTransition,
          position: { start: idx, end: idx + trimmed.length },
        };
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Generate an adjustment plan from diagnostics results.
 *
 * @param text - The original text
 * @param diagnostics - Output from runFullDiagnostics()
 * @param options - Optional target profile, comparison, and limits
 * @returns A structured plan with ranked suggestions
 */
export function generateAdjustmentPlan(
  text: string,
  diagnostics: FullStyleDiagnostics,
  options?: {
    readonly targetAuthorProfile?: AuthorStyleProfile;
    readonly comparison?: StyleComparisonResult;
    readonly maxSuggestions?: number;
  },
): AdjustmentPlan {
  const { sourceHash, ruleVersion, intentRepetitions, repeatedDescriptions, transitionClustering, clauseComplexity, sampleAdequacy } = diagnostics;
  const suggestions: AdjustmentSuggestion[] = [];
  const warnings: string[] = [];

  // Warn if sample is too small
  if (sampleAdequacy === "insufficient") {
    warnings.push("Sample too small for reliable adjustments");
  }

  // 1. Intent repetitions
  for (const finding of intentRepetitions) {
    if (finding.severity === "low" && finding.count < 3) continue;

    const severity = severityFromDiagnosticSeverity(finding.severity);
    const patch = finding.kind === "action-expression"
      ? buildIntentPatch(text, finding)
      : undefined;

    suggestions.push({
      id: stableId(ruleVersion, "intent-repetition", { start: finding.examples[0]?.start ?? 0, end: finding.examples[0]?.end ?? 0 }, finding.pattern),
      category: "intent-repetition",
      severity,
      confidence: finding.confidence,
      description: `"${finding.pattern}" 出现 ${finding.count} 次（${finding.perThousandChars.toFixed(1)}/千字）`,
      originalSnippet: clipText(text, finding.examples[0]?.start ?? 0, finding.examples[0]?.end ?? 0),
      instruction: finding.kind === "action-expression"
        ? `减少"${finding.pattern}"的重复使用，合并或替换冗余表达`
        : `检查"${finding.pattern}"相关段落是否在重复表达同一信息`,
      position: { start: finding.examples[0]?.start ?? 0, end: finding.examples[0]?.end ?? 0 },
      ...(patch ? { patch } : {}),
    });
  }

  // 2. Transition clustering
  for (const finding of transitionClustering) {
    if (finding.severity === "low") continue;

    const severity = severityFromDiagnosticSeverity(finding.severity);
    const patch = buildTransitionPatch(text, finding.transitionWord);

    suggestions.push({
      id: stableId(ruleVersion, "transition", { start: 0, end: 0 }, finding.transitionWord),
      category: "transition",
      severity,
      confidence: 0.7,
      description: `"${finding.transitionWord}" 出现 ${finding.totalCount} 次，${finding.paragraphsWithTransition} 段含转折词，连续 ${finding.consecutiveTransitions} 段`,
      originalSnippet: `"${finding.transitionWord}" 在 ${finding.consecutiveTransitions} 个连续段落中出现`,
      instruction: `减少"${finding.transitionWord}"的使用频率，每 2-3 段使用一次转折`,
      position: { start: 0, end: 0 },
      ...(patch ? { patch } : {}),
    });
  }

  // 3. Clause complexity
  for (const finding of clauseComplexity) {
    if (finding.severity === "low") continue;

    const severity = severityFromDiagnosticSeverity(finding.severity);

    suggestions.push({
      id: stableId(ruleVersion, "clause-complexity", finding.position, finding.sentence),
      category: "clause-complexity",
      severity,
      confidence: finding.confidence,
      description: `句子过长（${finding.sentenceLength} 字，${finding.separatorCount} 个分隔符，估计 ${finding.estimatedClauseCount} 个从句）`,
      originalSnippet: clipText(text, finding.position.start, finding.position.end),
      instruction: "考虑拆分为 2-3 个短句，每个句子表达一个核心意思",
      position: finding.position,
    });
  }

  // 4. Repeated descriptions
  for (const finding of repeatedDescriptions) {
    if (finding.severity === "low" || finding.occurrences.length < 2) continue;

    const severity = severityFromDiagnosticSeverity(finding.severity);

    suggestions.push({
      id: stableId(ruleVersion, "description-repetition", finding.occurrences[0], finding.cluster),
      category: "description-repetition",
      severity,
      confidence: finding.confidence,
      description: `"${finding.cluster}" 重复 ${finding.occurrences.length} 次（密度 ${finding.density.toFixed(1)}）`,
      originalSnippet: finding.matchedPhrases.slice(0, 3).join("、"),
      instruction: `合并"${finding.cluster}"相关描述，每次出现使用不同的表达方式`,
      position: finding.occurrences[0],
    });
  }

  // 5. Comparison-based suggestions
  if (options?.comparison) {
    for (const dev of options.comparison.deviations) {
      if (Math.abs(dev.normalizedDeviation) < 0.3) continue;

      suggestions.push({
        id: stableId(ruleVersion, "vocabulary", { start: 0, end: 0 }, dev.metric),
        category: "vocabulary",
        severity: "info",
        confidence: 0.5,
        description: `${dev.metric}: 当前 ${dev.currentValue}，目标 ${dev.targetValue}`,
        originalSnippet: `偏差 ${(dev.normalizedDeviation * 100).toFixed(0)}%`,
        instruction: `调整 ${dev.metric} 趋近目标值 ${dev.targetValue}`,
        position: { start: 0, end: 0 },
        targetMetric: dev.metric,
        targetRange: {
          min: dev.targetValue * (1 - 0.2),
          max: dev.targetValue * (1 + 0.2),
        },
      });
    }
  }

  // Sort: critical first, then warning, then info; within same severity by confidence desc
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  suggestions.sort((a, b) => {
    const sa = severityOrder[a.severity] - severityOrder[b.severity];
    if (sa !== 0) return sa;
    return b.confidence - a.confidence;
  });

  // Limit suggestions
  const max = options?.maxSuggestions ?? 20;
  const limited = suggestions.slice(0, max);

  return {
    sourceHash,
    ruleVersion,
    authorProfileId: options?.targetAuthorProfile?.id,
    authorProfileVersion: options?.targetAuthorProfile?.version,
    suggestions: limited,
    comparison: options?.comparison,
    warnings,
  };
}
