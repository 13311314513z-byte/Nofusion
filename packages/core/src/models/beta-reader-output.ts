/**
 * Beta Reader output type — the shared contract between the Beta Reader agent
 * and its consumers (pipeline, evaluators, UI).
 *
 * @module
 */

export interface ReaderObservation {
  /** Which aspect of the chapter this observation addresses. */
  readonly dimension: "engagement" | "clarity" | "emotion" | "character" | "expectation";
  /** Overall judgment. */
  readonly judgment: "positive" | "mixed" | "negative";
  /** Paragraph-level evidence supporting this judgment (1-indexed). */
  readonly evidence: ReadonlyArray<{
    readonly startParagraph: number;
    readonly endParagraph: number;
    readonly reason: string;
  }>;
  /** Confidence 0-1. */
  readonly confidence: number;
}

export interface BetaReaderOutput {
  /** All observations for this chapter. */
  readonly observations: ReadonlyArray<ReaderObservation>;
  /** Metadata about the reader model — for audit and calibration. */
  readonly modelInfo: {
    readonly provider: string;
    readonly model: string;
    readonly promptHash: string;
    readonly version: string;
  };
}

/**
 * Maturity stages for the Beta Reader.
 *
 * - off: Not called
 * - shadow: Called but results are only logged, never shown or used
 * - advisory: Results shown to the author, no automatic action
 * - actionable: Results can trigger localized revision (only if calibration passes)
 */
export type BetaReaderMode = "off" | "shadow" | "advisory" | "actionable";

/**
 * Compute a summary from reader observations for metrics/reporting.
 */
export function summarizeObservations(
  observations: ReadonlyArray<ReaderObservation>,
): {
  readonly positiveRatio: number;
  readonly totalObservations: number;
  readonly byDimension: Record<string, { positive: number; mixed: number; negative: number }>;
} {
  const byDimension: Record<string, { positive: number; mixed: number; negative: number }> = {};
  let positiveCount = 0;

  for (const obs of observations) {
    if (!byDimension[obs.dimension]) {
      byDimension[obs.dimension] = { positive: 0, mixed: 0, negative: 0 };
    }
    byDimension[obs.dimension]![obs.judgment]++;
    if (obs.judgment === "positive") positiveCount++;
  }

  return {
    positiveRatio: observations.length > 0 ? positiveCount / observations.length : 0,
    totalObservations: observations.length,
    byDimension,
  };
}
