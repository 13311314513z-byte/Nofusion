/**
 * Readability scoring — compute a readability score for a piece of text.
 *
 * Pure functions, no I/O.
 */

import { detectDuplicateRhetoric, type RhetoricCategory } from "./semantic-duplication.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReadabilityScore {
  readonly overall: number;
  readonly dimensions: {
    readonly rhetoricVariety: number;
    readonly vocabularyDiversity: number;
    readonly sentenceVariety: number;
    readonly paragraphCoherence: number;
    readonly repetitionPenalty: number;
  };
}

export interface ReadabilityTrend {
  readonly chapterScores: ReadonlyArray<{
    readonly chapterNumber: number;
    readonly score: number;
  }>;
}

// ---------------------------------------------------------------------------
// Rhetoric variety score
// ---------------------------------------------------------------------------

/**
 * Compute rhetoric variety score (0-100).
 * Lower is better — fewer categories with excessive use means higher score.
 * Penalty: each category over its per-thousand threshold reduces score.
 */
function computeRhetoricVariety(text: string, language: "zh" | "en"): number {
  const result = detectDuplicateRhetoric(text, language);
  if (result.findings.length === 0) return 100;

  const totalChars = text.length;
  const perThousand = (count: number) => (count / totalChars) * 1000;

  let totalPenalty = 0;
  for (const f of result.findings) {
    const rate = perThousand(f.count);
    // Thresholds: each category has a "safe" threshold
    const thresholds: Partial<Record<RhetoricCategory, number>> = {
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
    const threshold = thresholds[f.category] ?? 2;
    if (rate > threshold) {
      totalPenalty += (rate - threshold) * 5; // 5 points per excess per-thousand
    }
  }

  return Math.max(0, Math.min(100, 100 - totalPenalty));
}

// ---------------------------------------------------------------------------
// Vocabulary diversity score
// ---------------------------------------------------------------------------

function computeVocabularyDiversity(text: string): number {
  const cleaned = text.replace(/[\s\n\r，。！？、：；""''（）【】《》\d]/g, "");
  if (cleaned.length < 10) return 50;
  const uniqueChars = new Set(cleaned);
  const ttr = uniqueChars.size / cleaned.length;
  // Map TTR (typ. 0.3-0.8 for Chinese) to 0-100 score
  return Math.round(Math.min(100, Math.max(0, (ttr - 0.2) / 0.6 * 100)));
}

// ---------------------------------------------------------------------------
// Sentence variety score
// ---------------------------------------------------------------------------

function computeSentenceVariety(text: string): number {
  const sentences = text.split(/[。！？\n]/).filter((s) => s.trim().length > 0);
  if (sentences.length < 3) return 100;

  // Measure sentence length distribution variance
  const lengths = sentences.map((s) => s.length);
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((sum, l) => sum + (l - avg) ** 2, 0) / lengths.length;
  const stdDev = Math.sqrt(variance);

  // Ideal: stdDev ~40-60% of mean (healthy variety)
  const ratio = avg > 0 ? stdDev / avg : 0;
  if (ratio >= 0.3 && ratio <= 0.8) return 90;
  if (ratio >= 0.2 && ratio <= 1.0) return 70;
  return 50;
}

// ---------------------------------------------------------------------------
// Paragraph coherence score
// ---------------------------------------------------------------------------

function computeParagraphCoherence(text: string): number {
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  if (paragraphs.length < 2) return 100;

  // Check for overlapping content between consecutive paragraphs
  let overlapCount = 0;
  for (let i = 0; i < paragraphs.length - 1; i++) {
    const a = new Set(paragraphs[i].slice(-40).split(""));
    const b = new Set(paragraphs[i + 1].slice(0, 40).split(""));
    let common = 0;
    for (const ch of a) if (b.has(ch)) common++;
    const overlap = common / Math.max(a.size, b.size);
    if (overlap > 0.6) overlapCount++;
  }

  const overlapRate = overlapCount / (paragraphs.length - 1);
  return Math.round(100 - overlapRate * 50);
}

// ---------------------------------------------------------------------------
// Repetition penalty
// ---------------------------------------------------------------------------

function computeRepetitionPenalty(text: string, language: "zh" | "en"): number {
  const result = detectDuplicateRhetoric(text, language);
  if (result.findings.length === 0) return 0;

  // Penalty based on total excess findings
  let totalExcess = 0;
  for (const f of result.findings) {
    if (f.severity === "high") totalExcess += 3;
    else if (f.severity === "medium") totalExcess += 1.5;
    else totalExcess += 0.5;
  }

  return Math.min(50, Math.round(totalExcess * 3));
}

// ---------------------------------------------------------------------------
// Main scoring function
// ---------------------------------------------------------------------------

/**
 * Compute a comprehensive readability score (0-100) for the given text.
 * 100 = highly readable, 0 = very repetitive/poor readability.
 */
export function computeReadabilityScore(
  text: string,
  language: "zh" | "en" = "zh",
): ReadabilityScore {
  const rhetoricVariety = computeRhetoricVariety(text, language);
  const vocabularyDiversity = computeVocabularyDiversity(text);
  const sentenceVariety = computeSentenceVariety(text);
  const paragraphCoherence = computeParagraphCoherence(text);
  const repetitionPenalty = computeRepetitionPenalty(text, language);

  const overall = Math.round(
    rhetoricVariety * 0.25 +
    vocabularyDiversity * 0.25 +
    sentenceVariety * 0.2 +
    paragraphCoherence * 0.15 +
    Math.max(0, 100 - repetitionPenalty) * 0.15,
  );

  return {
    overall,
    dimensions: {
      rhetoricVariety,
      vocabularyDiversity,
      sentenceVariety,
      paragraphCoherence,
      repetitionPenalty,
    },
  };
}
