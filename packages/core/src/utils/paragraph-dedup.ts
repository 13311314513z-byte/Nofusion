/**
 * Paragraph deduplication detection.
 *
 * Detects:
 *   - Exact duplicate paragraphs (identical text)
 *   - Near-duplicate paragraphs (Jaccard similarity > threshold)
 *
 * Pure functions, no I/O.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DuplicateParagraphGroup {
  readonly hash: string;
  readonly content: string;
  readonly lineNumber: number;
  readonly duplicates: ReadonlyArray<{ readonly lineNumber: number }>;
}

export interface SimilarParagraphGroup {
  readonly paragraphs: ReadonlyArray<{
    readonly content: string;
    readonly lineNumber: number;
  }>;
  readonly similarity: number;
}

export interface DedupResult {
  readonly duplicateGroups: ReadonlyArray<DuplicateParagraphGroup>;
  readonly similarGroups: ReadonlyArray<SimilarParagraphGroup>;
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

function quickHash(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const chr = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return hash.toString(36);
}

function findLineNumber(text: string, target: string, hintIndex?: number): number {
  // Use hint if provided and valid, otherwise search from beginning
  const lines = text.split("\n");
  const prefix = target.slice(0, Math.min(20, target.length));

  if (hintIndex !== undefined && hintIndex < lines.length) {
    // Find the Nth occurrence that matches
    let matchCount = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(prefix)) {
        matchCount++;
        if (matchCount === hintIndex) return i + 1;
      }
    }
  }

  // Fallback: first match
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(prefix)) return i + 1;
  }
  return 0;
}

function normalizeParagraph(s: string): string {
  return s.trim().replace(/\s+/g, "");
}

// ---------------------------------------------------------------------------
// Exact duplicate detection
// ---------------------------------------------------------------------------

/**
 * Find paragraphs with identical text content.
 * Paragraphs are defined as blocks separated by blank lines.
 */
export function findDuplicateParagraphs(text: string): ReadonlyArray<DuplicateParagraphGroup> {
  const paras = text.split(/\n\s*\n/);
  const seen = new Map<string, number[]>(); // hash → [lineNumbers]
  const occurrenceCount = new Map<string, number>(); // track occurrence per hash

  paras.forEach((para) => {
    const normalized = normalizeParagraph(para);
    if (normalized.length < 20) return;
    const hash = quickHash(normalized);
    const existing = seen.get(hash) ?? [];
    const count = occurrenceCount.get(hash) ?? 0;
    occurrenceCount.set(hash, count + 1);
    seen.set(hash, [...existing, findLineNumber(text, para, count)]);
  });

  return [...seen.entries()]
    .filter(([, lines]) => lines.length >= 2)
    .map(([hash, lines]) => {
      const firstLine = lines[0];
      const content = extractContent(text, firstLine);
      return {
        hash,
        content,
        lineNumber: firstLine,
        duplicates: lines.slice(1).map((l) => ({ lineNumber: l })),
      };
    });
}

function extractContent(text: string, lineNumber: number): string {
  const lines = text.split("\n");
  if (lineNumber >= 1 && lineNumber <= lines.length) {
    return lines[lineNumber - 1].trim();
  }
  return "";
}

// ---------------------------------------------------------------------------
// Near-duplicate (similar) detection using Jaccard similarity
// ---------------------------------------------------------------------------

/**
 * Tokenize Chinese text into character bigrams.
 */
function tokenizeBigrams(s: string): Set<string> {
  const cleaned = s.replace(/[\s\n\r，。！？、：；""''（）【】《》\d]/g, "");
  const bigrams = new Set<string>();
  for (let i = 0; i < cleaned.length - 1; i++) {
    bigrams.add(cleaned.slice(i, i + 2));
  }
  return bigrams;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface SimilarityOptions {
  readonly similarityThreshold: number;
  readonly minParagraphLength: number;
}

const DEFAULT_SIMILARITY_OPTIONS: SimilarityOptions = {
  similarityThreshold: 0.8,
  minParagraphLength: 20,
};

/**
 * Find paragraphs that are semantically similar but not identical.
 * Uses Jaccard similarity on character bigrams.
 */
export function findSimilarParagraphs(
  text: string,
  options: Partial<SimilarityOptions> = {},
): ReadonlyArray<SimilarParagraphGroup> {
  const opts = { ...DEFAULT_SIMILARITY_OPTIONS, ...options };
  const paras = text.split(/\n\s*\n/);
  const validParas: Array<{ text: string; lineNumber: number; tokens: Set<string> }> = [];

  paras.forEach((para) => {
    const normalized = normalizeParagraph(para);
    if (normalized.length < opts.minParagraphLength) return;
    validParas.push({
      text: para.trim(),
      lineNumber: findLineNumber(text, para),
      tokens: tokenizeBigrams(normalized),
    });
  });

  const groups: SimilarParagraphGroup[] = [];
  const visited = new Set<number>();

  for (let i = 0; i < validParas.length; i++) {
    if (visited.has(i)) continue;
    const group: Array<{ content: string; lineNumber: number }> = [
      { content: validParas[i].text, lineNumber: validParas[i].lineNumber },
    ];
    visited.add(i);

    for (let j = i + 1; j < validParas.length; j++) {
      if (visited.has(j)) continue;
      const sim = jaccardSimilarity(validParas[i].tokens, validParas[j].tokens);
      if (sim >= opts.similarityThreshold) {
        group.push({ content: validParas[j].text, lineNumber: validParas[j].lineNumber });
        visited.add(j);
      }
    }

    if (group.length >= 2) {
      const similarity = jaccardSimilarity(validParas[i].tokens, validParas[i].tokens);
      groups.push({ paragraphs: group, similarity });
    }
  }

  return groups;
}

/**
 * Run both exact and near-duplicate paragraph detection.
 */
export function detectDuplicateParagraphs(
  text: string,
  options?: Partial<SimilarityOptions>,
): DedupResult {
  return {
    duplicateGroups: findDuplicateParagraphs(text),
    similarGroups: findSimilarParagraphs(text, options),
  };
}
