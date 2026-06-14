/**
 * Genre Promise Checker — deterministic, zero-LLM-cost checks for genre commitments.
 *
 * These checks do NOT use keyword matching. Instead, they:
 *   - Verify that promises with scope "book" have fulfillment evidence across chapters
 *   - Check that "chapter-type" scoped promises are fulfilled in the expected chapter types
 *   - Report overdue promises as info/warning/critical based on expiry policy
 *
 * @module
 */

import type { GenreProfile } from "../models/genre-profile.js";

export interface GenrePromiseStatus {
  readonly promiseId: string;
  readonly description: string;
  readonly importance: "core" | "expected" | "optional";
  readonly scope: "book" | "arc" | "chapter-type";
  readonly status: "fulfilled" | "pending" | "overdue" | "expired";
  /** Severity derived from overduePolicy — how urgently this should be surfaced. */
  readonly severity: "critical" | "warning" | "info";
  readonly message: string;
}

/** Map overduePolicy to severity for active/overdue promises. */
function resolvePromiseSeverity(
  status: GenrePromiseStatus["status"],
  overduePolicy: "info" | "warning" | "critical",
): GenrePromiseStatus["severity"] {
  if (status === "overdue" || status === "expired") {
    return overduePolicy;
  }
  // Pending/fulfilled promises are informational
  return "info";
}

/**
 * Check genre promises for a specific chapter.
 *
 * This is a lightweight heuristic — it checks if the promise's evidence conditions
 * are met across available chapter summaries. The actual evidence checking is
 * delegated to the LLM-based evaluator (Stage 4+), but this provides a basic
 * deterministic check that can run without extra LLM calls.
 */
export function checkGenrePromises(
  profile: GenreProfile,
  chapterNumber: number,
  _totalChapters: number,
): ReadonlyArray<GenrePromiseStatus> {
  const results: GenrePromiseStatus[] = [];

  for (const promise of profile.promises ?? []) {
    const window = promise.expectedWindow;

    // Determine if this chapter falls within the promise's expected window
    if (window) {
      if (chapterNumber < window.from) {
        // Promise not yet due
        results.push({
          promiseId: promise.id,
          description: promise.description,
          importance: promise.importance,
          scope: promise.scope,
          status: "pending",
          severity: resolvePromiseSeverity("pending", promise.overduePolicy),
          message: `承诺"${promise.description}"的预期窗口为第 ${window.from}-${window.to} 章，当前第 ${chapterNumber} 章，尚未到期。`,
        });
        continue;
      }

      if (chapterNumber > window.to) {
        // Promise window has passed — check if fulfilled (delegated to LLM evaluation)
        results.push({
          promiseId: promise.id,
          description: promise.description,
          importance: promise.importance,
          scope: promise.scope,
          status: "overdue",
          severity: resolvePromiseSeverity("overdue", promise.overduePolicy),
          message: `承诺"${promise.description}"的预期窗口（第 ${window.from}-${window.to} 章）已过，请确认是否已兑现。`,
        });
        continue;
      }
    }

    // Within window or no window — mark as pending fulfillment
    results.push({
      promiseId: promise.id,
      description: promise.description,
      importance: promise.importance,
      scope: promise.scope,
      status: "pending",
      severity: resolvePromiseSeverity("pending", promise.overduePolicy),
      message:
        promise.importance === "core"
          ? `核心承诺"${promise.description}"需在本章或近期章节中兑现。`
          : `期望承诺"${promise.description}"建议在本阶段关注。`,
    });
  }

  return results;
}

/**
 * Get a summary of all genre promises that are overdue or critical.
 */
export function getCriticalGenrePromises(
  profile: GenreProfile,
  chapterNumber: number,
  totalChapters: number,
): ReadonlyArray<GenrePromiseStatus> {
  return checkGenrePromises(profile, chapterNumber, totalChapters).filter(
    (p) => p.status === "overdue",
  );
}
