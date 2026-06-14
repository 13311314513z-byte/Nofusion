/**
 * Issue Persistence — cross-chapter issue tracking for severity escalation.
 *
 * Stores a map of "issue signature → consecutive chapter count" between
 * chapter runs so that the IssueNormalizer can escalate severity for issues
 * that reappear across multiple chapters (e.g. same OOC problem in 3+ chapters).
 *
 * @module
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const CONSECUTIVE_FILE = "issue-consecutive-counts.json";

export interface IssueConsecutiveCounts {
  /** Map of issue signature → consecutive chapter count. */
  readonly counts: Record<string, number>;
  /** Last chapter number that updated this file. */
  readonly lastChapterNumber: number;
  /** ISO timestamp of last update. */
  readonly updatedAt: string;
}

/**
 * Load the consecutive issue counts for a book.
 * Returns an empty map if no data exists yet.
 */
export async function loadIssueConsecutiveCounts(
  bookDir: string,
): Promise<Map<string, number>> {
  try {
    const filePath = join(bookDir, "story", CONSECUTIVE_FILE);
    const raw = await readFile(filePath, "utf-8");
    const data: IssueConsecutiveCounts = JSON.parse(raw);
    return new Map(Object.entries(data.counts));
  } catch {
    return new Map();
  }
}

/**
 * Save the consecutive issue counts for a book.
 */
export async function saveIssueConsecutiveCounts(
  bookDir: string,
  counts: Map<string, number>,
  chapterNumber: number,
): Promise<void> {
  const storyDir = join(bookDir, "story");
  await mkdir(storyDir, { recursive: true });
  const data: IssueConsecutiveCounts = {
    counts: Object.fromEntries(counts),
    lastChapterNumber: chapterNumber,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(
    join(storyDir, CONSECUTIVE_FILE),
    JSON.stringify(data, null, 2),
    "utf-8",
  );
}

/**
 * Update the consecutive counts based on the current chapter's issues.
 *
 * For each issue, its signature is computed from source + normalized category.
 * If the same signature appears in the current chapter, increment the count.
 * If it does NOT appear, reset its count to 0 (the chain is broken).
 *
 * Severity escalation thresholds (used by IssueNormalizer):
 *   - count >= 3: info → warning
 *   - count >= 5: warning → critical
 */
/**
 * Category synonym map — mirrors the one in issue-normalizer.ts.
 * Ensures signatures are stable regardless of which language or synonym
 * the LLM uses for the same category.
 */
const CATEGORY_NORMALIZER: Record<string, string> = {
  // English → canonical
  "out of character": "OOC Check",
  "character inconsistency": "OOC Check",
  "lore inconsistency": "Lore Conflict Check",
  "world building conflict": "Lore Conflict Check",
  "timeline error": "Timeline Check",
  "plot hole": "Hook Check",
  // Chinese → canonical
  "角色行为不一致": "OOC Check",
  "人设崩塌": "OOC Check",
  "设定矛盾": "Lore Conflict Check",
  "时间线错误": "Timeline Check",
  "剧情漏洞": "Hook Check",
};

function normalizeCategory(category: string): string {
  return CATEGORY_NORMALIZER[category.toLowerCase().trim()] ?? category;
}

/**
 * Build a stable fingerprint for an issue, resilient to LLM wording changes.
 *
 * Strategy:
 *   1. Normalize category (synonym → canonical)
 * Category-level tracking is intentional here: descriptions are generated text
 * and are not stable identifiers across chapters. More granular recurrence
 * tracking must use a future structured rule or subject ID, not prose snippets.
 */
export function buildIssueFingerprint(
  source: string | undefined,
  category: string,
  _description: string,
): string {
  const normCat = normalizeCategory(category);
  return `${source ?? "unknown"}:${normCat}`;
}

export function updateConsecutiveCounts(
  current: Map<string, number>,
  chapterIssues: ReadonlyArray<{ readonly source?: string; readonly category: string; readonly description: string }>,
): Map<string, number> {
  const updated = new Map(current);

  // Reset all existing counts — they'll be re-incremented if they appear
  for (const key of updated.keys()) {
    updated.set(key, 0);
  }

  // Build signature set for issues in THIS chapter
  const seenSignatures = new Set<string>();
  for (const issue of chapterIssues) {
    const sig = buildIssueFingerprint(issue.source, issue.category, issue.description);
    if (seenSignatures.has(sig)) continue; // count once per chapter
    seenSignatures.add(sig);
    const prevCount = current.get(sig) ?? 0;
    updated.set(sig, prevCount + 1);
  }

  // Clean up zero-count entries to keep the file small
  for (const [key, value] of updated) {
    if (value === 0) {
      updated.delete(key);
    }
  }

  return updated;
}
