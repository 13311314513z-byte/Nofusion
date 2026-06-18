import type { BookConfig } from "../../models/book.js";
import type { LengthSpec } from "../../models/length-governance.js";
import type { Logger } from "../../utils/logger.js";

/**
 * Pipeline length normalization stage.
 * Adjusts chapter content to fit the target word count range.
 *
 * Extracted from PipelineRunner.
 */
export interface LengthNormalizeInput {
  /** Book configuration */
  book: Pick<BookConfig, "chapterWordCount">;
  /** Target length specification */
  lengthSpec: LengthSpec;
  /** Current chapter content */
  content: string;
  /** Current word count (pre-normalization) */
  currentWordCount: number;
  /** Logger */
  logger: Logger;
}

export interface LengthNormalizeOutput {
  /** Normalized content */
  content: string;
  /** Final word count */
  wordCount: number;
  /** Whether normalization was needed */
  wasNormalized: boolean;
}

/**
 * Check if length normalization is needed and apply it.
 * Returns the (possibly unchanged) content with word count.
 */
export function evaluateNormalizationNeed(input: LengthNormalizeInput): {
  needsNormalization: boolean;
  reason?: string;
} {
  const { lengthSpec, currentWordCount } = input;

  if (lengthSpec.hardMin > 0 && currentWordCount < lengthSpec.hardMin) {
    return { needsNormalization: true, reason: `below minimum (${currentWordCount} < ${lengthSpec.hardMin})` };
  }
  if (lengthSpec.hardMax > 0 && currentWordCount > lengthSpec.hardMax) {
    return { needsNormalization: true, reason: `above maximum (${currentWordCount} > ${lengthSpec.hardMax})` };
  }

  return { needsNormalization: false };
}
