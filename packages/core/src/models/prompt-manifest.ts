/**
 * Prompt Manifest — observable metadata about assembled LLM prompts.
 *
 * Instead of replacing prompt assembly logic, this module wraps it with
 * a metadata layer: each fragment is tagged with its source, priority,
 * and estimated token count. The manifest is emitted alongside the actual
 * prompt for tracing, debugging, and A/B experiment tracking.
 *
 * @module
 */

// ─── Fragment ──────────────────────────────────────────────────────

export interface PromptFragment {
  /** Unique identifier within the stage. */
  readonly id: string;
  /** Origin of this content (e.g. "book-rules", "chapter-intent", "character-voice"). */
  readonly source: string;
  /** Target role in the LLM message array. */
  readonly role: "system" | "user" | "assistant";
  /** Logical slot within the prompt structure. */
  readonly slot: string;
  /** Priority 0-100; higher = less likely to be dropped when over budget. */
  readonly priority: number;
  /** The actual text content. */
  readonly content: string;
  /** If true, this fragment may be omitted without breaking generation. */
  readonly optional: boolean;
  /** Estimated token count (calculated via a tokenizer or length heuristic). */
  readonly estimatedTokens: number;
}

// ─── Manifest ──────────────────────────────────────────────────────

export interface PromptManifest {
  /** Which agent stage produced this manifest. */
  readonly stage: string;
  /** All fragments that were included in the prompt. */
  readonly fragments: ReadonlyArray<PromptFragment>;
  /** Sum of estimatedTokens across all fragments. */
  readonly totalEstimatedTokens: number;
  /** Maximum allowed input tokens (context window - output - overhead). */
  readonly maxAllowedInputTokens: number;
  /** Fragments that were excluded due to budget constraints. */
  readonly droppedFragments: ReadonlyArray<{
    readonly fragmentId: string;
    readonly reason: string;
  }>;
  /** Deterministic hash of the assembled prompt (for A/B tracking). */
  readonly promptHash: string;
  /** ISO timestamp of assembly. */
  readonly assembledAt: string;
}

// ─── Builder ───────────────────────────────────────────────────────

export interface BuildManifestInput {
  readonly stage: string;
  readonly fragments: ReadonlyArray<PromptFragment>;
  readonly maxAllowedInputTokens: number;
}

/**
 * Build a PromptManifest from a set of fragments.
 * If total exceeds the budget, low-priority optional fragments are dropped.
 */
export function buildPromptManifest(input: BuildManifestInput): PromptManifest {
  const { stage, maxAllowedInputTokens } = input;

  // Sort by priority descending; optional fragments are demoted one tier.
  const sorted = [...input.fragments].sort((a, b) => {
    const aWeight = a.priority - (a.optional ? 10 : 0);
    const bWeight = b.priority - (b.optional ? 10 : 0);
    return bWeight - aWeight;
  });

  const included: PromptFragment[] = [];
  const droppedFragments: Array<{ fragmentId: string; reason: string }> = [];
  let runningTotal = 0;

  // Estimate system message overhead (role headers, formatting)
  const OVERHEAD_ESTIMATE = 20; // tokens

  for (const fragment of sorted) {
    const wouldTotal = runningTotal + fragment.estimatedTokens + OVERHEAD_ESTIMATE;
    if (wouldTotal > maxAllowedInputTokens && fragment.optional) {
      droppedFragments.push({
        fragmentId: fragment.id,
        reason: fragment.optional
          ? `token budget exceeded (${wouldTotal} > ${maxAllowedInputTokens})`
          : `token budget exceeded — non-optional fragment dropped (${wouldTotal} > ${maxAllowedInputTokens})`,
      });
      continue;
    }
    included.push(fragment);
    runningTotal += fragment.estimatedTokens;
  }

  // Restore original order for deterministic output
  const originalOrder = input.fragments
    .filter((f) => included.some((i) => i.id === f.id))
    .map((f) => {
      const kept = included.find((i) => i.id === f.id);
      return kept!;
    });

  // Compute hash from concatenated content
  const concatenated = originalOrder.map((f) => `${f.role}:${f.slot}:${f.content}`).join("|");
  const promptHash = simpleHash(concatenated);

  const totalEstimatedTokens = originalOrder.reduce((sum, f) => sum + f.estimatedTokens, 0);

  return {
    stage,
    fragments: originalOrder,
    totalEstimatedTokens,
    maxAllowedInputTokens,
    droppedFragments,
    promptHash,
    assembledAt: new Date().toISOString(),
  };
}

// ─── Token estimation ──────────────────────────────────────────────

/**
 * Rough token estimation for Chinese + English mixed text.
 * Chinese: ~1.5 chars per token; English: ~4 chars per token.
 * This is a heuristic — real tokenization depends on the model.
 */
export function estimateTokens(text: string): number {
  let cjkChars = 0;
  let latinChars = 0;

  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
      (code >= 0x3040 && code <= 0x30ff)    // Hiragana/Katakana
    ) {
      cjkChars++;
    } else if (/[a-zA-Z0-9]/.test(ch)) {
      latinChars++;
    }
  }

  return Math.ceil(cjkChars / 1.5 + latinChars / 4);
}

/**
 * Simple non-cryptographic hash for prompt content comparison.
 * Uses DJB2 algorithm — fast, deterministic, collision-resistant enough for A/B tracking.
 */
function simpleHash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) & 0xffffffff;
  }
  // Return as 8-char hex
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ─── Token budget helpers ──────────────────────────────────────────

/** Known model context window sizes (in tokens). Extend as needed. */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "deepseek-v4-flash": 65536,
  "deepseek-chat": 65536,
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "claude-3-opus": 200000,
  "claude-3-sonnet": 200000,
  "gemini-pro": 1048576,
};

const MODEL_DEFAULT_MAX_OUTPUT: Record<string, number> = {
  "deepseek-v4-flash": 8192,
  "deepseek-chat": 8192,
};

const MODEL_PROTOCOL_OVERHEAD: Record<string, number> = {
  "deepseek-v4-flash": 50,
  "deepseek-chat": 50,
};

const MODEL_SAFETY_MARGIN: Record<string, number> = {
  "deepseek-v4-flash": 500,
  "deepseek-chat": 500,
};

/**
 * Get the context window size for a given model.
 * Falls back to 8192 for unknown models.
 */
export function getModelContextWindow(modelId: string): number {
  return MODEL_CONTEXT_WINDOWS[modelId] ?? 8192;
}

/**
 * Calculate the maximum available input tokens for a given model.
 *
 * availableInput =
 *   contextWindow
 *   - requestedMaxOutput
 *   - protocolOverhead
 *   - safetyMargin
 */
export function getAvailableInputTokens(
  modelId: string,
  requestedMaxOutput?: number,
): number {
  const contextWindow = getModelContextWindow(modelId);
  const maxOutput = requestedMaxOutput ?? MODEL_DEFAULT_MAX_OUTPUT[modelId] ?? 4096;
  const protocolOverhead = MODEL_PROTOCOL_OVERHEAD[modelId] ?? 30;
  const safetyMargin = MODEL_SAFETY_MARGIN[modelId] ?? 300;
  return Math.max(1024, contextWindow - maxOutput - protocolOverhead - safetyMargin);
}
