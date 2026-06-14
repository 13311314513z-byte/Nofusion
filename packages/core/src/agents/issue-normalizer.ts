/**
 * Issue Normalizer — deterministic deduplication and grouping of audit issues.
 *
 * This is NOT an agent and does NOT use LLM. It performs only deterministic
 * operations: category normalization, exact deduplication, Levenshtein-based
 * approximate matching, and severity escalation for recurring issues.
 *
 * Semantic conflict detection ("加长对话" vs "减少对话") requires LLM
 * and is deliberately excluded from this first version.
 *
 * @module
 */

import {
  resolveAuditIssue,
  type AuditIssue,
  type AuditIssueSource,
  type ResolvedAuditIssue,
} from "../models/audit-issue.js";
import { buildIssueFingerprint } from "../utils/issue-persistence.js";

export type NormalizableAuditIssue = AuditIssue;

export interface NormalizedIssues {
  /** Deduplicated and sorted issues. */
  readonly issues: ReadonlyArray<ResolvedAuditIssue>;
  /** Number of duplicate issues that were merged. */
  readonly mergedCount: number;
  /** Issues grouped by fix scope for easier revision routing. */
  readonly byFixScope: Record<string, ReadonlyArray<ResolvedAuditIssue>>;
}

// ─── Synonymous category mapping ───────────────────────────────────

const CATEGORY_SYNONYMS: Record<string, string> = {
  // English synonyms → canonical
  "out of character": "OOC Check",
  "character inconsistency": "OOC Check",
  "lore inconsistency": "Lore Conflict Check",
  "world building conflict": "Lore Conflict Check",
  "timeline error": "Timeline Check",
  "plot hole": "Hook Check",

  // Chinese synonyms → canonical
  "角色行为不一致": "OOC Check",
  "人设崩塌": "OOC Check",
  "设定矛盾": "Lore Conflict Check",
  "时间线错误": "Timeline Check",
  "剧情漏洞": "Hook Check",
};

function normalizeCategory(category: string): string {
  return CATEGORY_SYNONYMS[category.toLowerCase().trim()] ?? category;
}

// ─── Levenshtein distance for approximate description matching ─────

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = [];

  for (let i = 0; i <= m; i++) {
    dp[i] = [i];
  }
  for (let j = 0; j <= n; j++) {
    dp[0]![j] = j;
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }

  return dp[m]![n]!;
}

// ─── Normalizer ────────────────────────────────────────────────────

export class IssueNormalizer {
  /**
   * Normalize a list of audit issues.
   *
   * Operations performed:
   *   1. Category name standardization (synonyms → canonical)
   *   2. Exact dedup: same source + same location → keep first
   *   3. Approximate dedup: similar descriptions within same category → merge
   *   4. Severity escalation: same issue appearing N+ chapters in a row
   *   5. Group by fixScope for revision routing
   */
  normalize(
    issues: ReadonlyArray<NormalizableAuditIssue>,
    consecutiveChapterCounts?: Map<string, number>,
    defaultSource: AuditIssueSource = "continuity",
  ): NormalizedIssues {
    // Step 1: Category normalization
    const normalized: ResolvedAuditIssue[] = issues.map((issue) =>
      resolveAuditIssue({
        ...issue,
        category: normalizeCategory(issue.category),
      }, defaultSource),
    );

    // Step 2: Exact dedup — same source + same location range
    const exactDeduped: ResolvedAuditIssue[] = [];
    const seenExact = new Set<string>();

    for (const issue of normalized) {
      const locKey = issue.location
        ? `${issue.location.startParagraph}-${issue.location.endParagraph}`
        : "none";
      const descriptionKey = issue.description.trim().toLowerCase();
      const key = `${issue.source}:${issue.category}:${locKey}:${descriptionKey}`;

      if (!seenExact.has(key)) {
        seenExact.add(key);
        exactDeduped.push(issue);
      }
    }

    const exactMerged = normalized.length - exactDeduped.length;

    // Step 3: Approximate dedup — Levenshtein distance on descriptions
    const approxDeduped: ResolvedAuditIssue[] = [];
    let approxMerged = 0;

    for (const issue of exactDeduped) {
      const THRESHOLD = 0.3; // 30% of the shorter string length
      let isDuplicate = false;

      for (const kept of approxDeduped) {
        if (kept.category !== issue.category) continue;
        if (kept.source !== issue.source) continue;
        const sameLocation =
          !kept.location && !issue.location
            ? true
            : Boolean(
                kept.location &&
                issue.location &&
                kept.location.startParagraph === issue.location.startParagraph &&
                kept.location.endParagraph === issue.location.endParagraph,
              );
        if (!sameLocation) {
          continue;
        }

        const shorterLen = Math.min(kept.description.length, issue.description.length);
        const distance = levenshtein(kept.description, issue.description);

        if (shorterLen > 0 && distance / shorterLen < THRESHOLD) {
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        approxDeduped.push(issue);
      } else {
        approxMerged++;
      }
    }

    // Step 4: Severity escalation
    if (consecutiveChapterCounts) {
      for (const issue of approxDeduped) {
        const key = buildIssueFingerprint(issue.source, issue.category, issue.description);
        const count = consecutiveChapterCounts.get(key) ?? 0;

        if (count >= 3 && issue.severity === "info") {
          // Create new object with escalated severity (cannot mutate readonly)
          const idx = approxDeduped.indexOf(issue);
          approxDeduped[idx] = { ...issue, severity: "warning" };
        } else if (count >= 5 && issue.severity === "warning") {
          const idx = approxDeduped.indexOf(issue);
          approxDeduped[idx] = { ...issue, severity: "critical" };
        }
      }
    }

    // Step 5: Sort by severity then fixScope
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    const fixScopeOrder: Record<string, number> = { chapter: 0, scene: 1, paragraph: 2, sentence: 3, word: 4 };

    const sorted = [...approxDeduped].sort((a, b) => {
      const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (sevDiff !== 0) return sevDiff;
      return fixScopeOrder[a.fixScope] - fixScopeOrder[b.fixScope];
    });

    // Group by fixScope
    const byFixScope: Record<string, ResolvedAuditIssue[]> = {};
    for (const issue of sorted) {
      const scope = issue.fixScope;
      if (!byFixScope[scope]) byFixScope[scope] = [];
      byFixScope[scope]!.push(issue);
    }

    return {
      issues: sorted,
      mergedCount: exactMerged + approxMerged,
      byFixScope,
    };
  }
}
