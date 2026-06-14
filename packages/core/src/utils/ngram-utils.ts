/**
 * N-gram extraction utilities for text analysis.
 *
 * Supports both word-level (English) and character-level (Chinese) n-grams.
 * Extracted from post-write-validator so it can be reused by style-diagnostics
 * and other text-analysis modules.
 */

/** A single n-gram phrase with its occurrence count. */
export interface NgramCount {
  readonly phrase: string;
  readonly count: number;
}

/**
 * Extract word-level n-grams from English-like text.
 * Words are lowercased and filtered by minimum length.
 */
export function extractWordNgrams(
  text: string,
  n: number,
  minWordLength = 2,
): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\w\s']/g, "")
    .split(/\s+/)
    .filter((w) => w.length > minWordLength);

  const ngrams: string[] = [];
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.push(words.slice(i, i + n).join(" "));
  }
  return ngrams;
}

/**
 * Extract character-level n-grams from text.
 * Optionally filter to only characters matching a regex,
 * and optionally remove whitespace first.
 */
export function extractCharNgrams(
  text: string,
  n: number,
  options?: {
    readonly filterPattern?: RegExp;
    readonly removeWhitespace?: boolean;
  },
): string[] {
  let clean = text;
  if (options?.removeWhitespace) {
    clean = clean.replace(/[\s\n\r]/g, "");
  }

  const ngrams: string[] = [];
  for (let i = 0; i <= clean.length - n; i++) {
    const phrase = clean.slice(i, i + n);
    if (!options?.filterPattern || options.filterPattern.test(phrase)) {
      ngrams.push(phrase);
    }
  }
  return ngrams;
}

/** Count occurrences of each n-gram phrase. */
export function countNgrams(ngrams: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const phrase of ngrams) {
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
  return counts;
}

/**
 * Find phrases that appear at least `minCount` times in `sourceCounts`
 * and also appear in `targetText`.
 *
 * @param sourceCounts - n-gram counts from the source text
 * @param targetText   - text to search for cross-text repeats
 * @param minCount     - minimum occurrences in source to qualify (default 2)
 * @returns sorted by count descending
 */
export function findCrossTextRepeats(
  sourceCounts: Map<string, number>,
  targetText: string,
  minCount = 2,
): NgramCount[] {
  const results: NgramCount[] = [];
  const targetLower = targetText.toLowerCase();

  for (const [phrase, count] of sourceCounts) {
    if (count >= minCount && targetLower.includes(phrase.toLowerCase())) {
      results.push({ phrase, count });
    }
  }

  results.sort((a, b) => b.count - a.count);
  return results;
}
