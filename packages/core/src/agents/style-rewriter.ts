/**
 * Style rewriter — LLM-based rewrite preview with author profile constraints.
 *
 * Uses the existing chatCompletion() for model calls; does NOT manage its own
 * LLM connections or API keys. Only returns previews — never writes to disk.
 *
 * Before calling this module, ensure the caller has already:
 *   1. Run diagnostics (runFullDiagnostics)
 *   2. Generated an adjustment plan (generateAdjustmentPlan)
 *   3. Loaded the target author profile (getAuthorProfile)
 *
 * This module then:
 *   a. Builds a constrained system prompt from the author profile (stats + tags only)
 *   b. Calls chatCompletion with the text + selected suggestion instructions
 *   c. Parses the response into a structured preview with before/after diagnostics
 */

import type { LLMClient,LLMResponse } from "../llm/provider.js";
import { chatCompletion } from "../llm/provider.js";
import type { AuthorStyleProfile } from "../style-library/models.js";
import type { AdjustmentPlan } from "./style-adjuster.js";
import { runFullDiagnostics,type FullStyleDiagnostics } from "./style-diagnostics.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StyleRewriteRequest {
  readonly text: string;
  readonly authorProfile: AuthorStyleProfile;
  readonly plan: AdjustmentPlan;
  readonly selectedSuggestionIds: ReadonlyArray<string>;
  readonly preserveContent: true;
}

export interface ChangedRange {
  readonly original: string;
  readonly replacement: string;
}

export interface StyleRewritePreview {
  readonly sourceHash: string;
  readonly authorProfileVersion: number;
  readonly adjustedText: string;
  readonly changedRanges: ReadonlyArray<ChangedRange>;
  readonly beforeDiagnostics: FullStyleDiagnostics;
  readonly afterDiagnostics: FullStyleDiagnostics;
  readonly warnings: ReadonlyArray<string>;
  readonly usage: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

/** Build system prompt that describes the target author's style characteristics. */
function buildRewriteSystemPrompt(
  authorProfile: AuthorStyleProfile,
): string {
  const fp = authorProfile.aggregateProfile.fingerprint;
  const stats = [
    `- Average sentence length: ${authorProfile.aggregateProfile.avgSentenceLength.toFixed(1)} chars`,
    `- Dialogue ratio: ${(fp.dialogueRatio * 100).toFixed(0)}%`,
    `- Action density: ${(fp.actionDensity * 100).toFixed(0)}%`,
    `- Psychological description ratio: ${(fp.psychologicalRatio * 100).toFixed(0)}%`,
    `- Sensory description density: ${(fp.sensoryDensity * 100).toFixed(0)}%`,
    `- Vocabulary diversity: ${(authorProfile.aggregateProfile.vocabularyDiversity * 100).toFixed(0)}%`,
  ].join("\n");

  const tags = authorProfile.tags.length > 0
    ? `\nStyle tags: ${authorProfile.tags.join(", ")}`
    : "";

  const languageHint = authorProfile.language === "zh"
    ? "Keep all content in Chinese.\n5. Use Chinese punctuation (。！？，；：)“” instead of English"
    : "Keep all content in English.\n5. Use English punctuation (.!?,;:\"\") as normal";

  return [
    "You are a literary style adjustment assistant. Your task is to modify the user's text to match the target author's style characteristics.",
    "",
    "CRITICAL RULES:",
    "1. Do NOT change characters, facts, time order, or point of view",
    "2. Do NOT add new plot events or characters",
    "3. Do NOT change the meaning or intensity of dialogue",
    "4. Only process the categories of issues the user has selected",
    languageHint,
    "",
    "Target author style profile:",
    stats,
    tags,
    "",
    "Return ONLY the modified text. No explanations, no markdown formatting.",
  ].join("\n");
}

/** Build user prompt with original text + selected suggestions. */
function buildRewriteUserPrompt(
  text: string,
  plan: AdjustmentPlan,
  selectedIds: ReadonlyArray<string>,
): string {
  const selectedSuggestions = plan.suggestions.filter((s) => selectedIds.includes(s.id));
  if (selectedSuggestions.length === 0) {
    return `Please rewrite the following text to better match the target author's style while preserving all content:\n\n${text}`;
  }

  const instructions = selectedSuggestions.map((s, i) =>
    `${i + 1}. [${s.severity}] ${s.category}: ${s.instruction}\n   Original: "${s.originalSnippet}"`,
  ).join("\n");

  return [
    "Please rewrite the following text according to these adjustment instructions:",
    "",
    instructions,
    "",
    "---",
    text,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Diff computation
// ---------------------------------------------------------------------------

function computeChangedRanges(
  original: string,
  adjusted: string,
): ReadonlyArray<ChangedRange> {
  if (original === adjusted) return [];

  // Use longest-common-prefix/suffix to extract the meaningful changed region.
  // This is robust against LLM-induced line-break changes.
  let prefixLen = 0;
  const maxPrefix = Math.min(original.length, adjusted.length);
  while (prefixLen < maxPrefix && original[prefixLen] === adjusted[prefixLen]) {
    prefixLen++;
  }

  let suffixLen = 0;
  const _origSuffixStart = original.length - 1 - suffixLen;
  const _adjSuffixStart = adjusted.length - 1 - suffixLen;
  while (
    suffixLen < original.length - prefixLen &&
    suffixLen < adjusted.length - prefixLen &&
    original[original.length - 1 - suffixLen] === adjusted[adjusted.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const changedOriginal = original.slice(prefixLen, original.length - suffixLen);
  const changedAdjusted = adjusted.slice(prefixLen, adjusted.length - suffixLen);

  return [{
    original: changedOriginal || "(empty)",
    replacement: changedAdjusted || "(empty)",
  }];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const MAX_REWRITE_CHARS = 20_000;

/**
 * Rewrite text to match an author profile using LLM, then return a preview
 * with before/after diagnostics and a line-level diff.
 *
 * @param request - The rewrite request with text, profile, plan and selections
 * @param ctx - LLM client + model (from existing InkOS config)
 * @returns A structured preview — does NOT persist anything
 */
export async function rewriteWithAuthorProfile(
  request: StyleRewriteRequest,
  ctx: { client: LLMClient; model: string },
): Promise<StyleRewritePreview> {
  const { text, authorProfile, plan, selectedSuggestionIds } = request;

  // 1. Validate input
  if (!text || text.length === 0) {
    throw new Error("Text is required for rewrite");
  }
  if (text.length > MAX_REWRITE_CHARS) {
    throw new Error(`Text exceeds ${MAX_REWRITE_CHARS} characters; please select a shorter passage`);
  }

  // 2. Run before diagnostics
  const beforeDiagnostics = runFullDiagnostics(text);

  // 3. Build prompts
  const systemPrompt = buildRewriteSystemPrompt(authorProfile);
  const userPrompt = buildRewriteUserPrompt(text, plan, selectedSuggestionIds);

  // 4. Call LLM (chatCompletion is statically imported at the top of the file)
  let response: LLMResponse;
  try {
    response = await chatCompletion(ctx.client, ctx.model, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ], { temperature: 0.3 });
  } catch (error) {
    throw new Error(`LLM rewrite failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 5. Parse response
  const adjustedText = response.content.trim();
  if (!adjustedText) {
    throw new Error("LLM returned empty rewrite; please try again");
  }

  // 6. Run after diagnostics
  const afterDiagnostics = runFullDiagnostics(adjustedText);

  // 7. Compute diff
  const changedRanges = computeChangedRanges(text, adjustedText);

  // 8. Build warnings
  const warnings: string[] = [];
  if (beforeDiagnostics.sampleAdequacy === "insufficient") {
    warnings.push("Original text is very short; rewrite may be imprecise");
  }

  return {
    sourceHash: plan.sourceHash,
    authorProfileVersion: authorProfile.version,
    adjustedText,
    changedRanges,
    beforeDiagnostics,
    afterDiagnostics,
    warnings,
    usage: response.usage,
  };
}
