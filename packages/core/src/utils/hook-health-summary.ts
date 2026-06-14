/**
 * Hook health summary — lightweight aggregation of pending hook state
 * for the book health overview. Parses pending_hooks.md (or memory-db),
 * normalizes statuses, and returns risk counts.
 *
 * This is a READ-ONLY summary function. It does NOT modify any truth file.
 */

import { parsePendingHooksMarkdown } from "./memory-retrieval.js";
import type { StoredHook } from "../state/memory-db.js";

export interface HookHealthSummary {
  readonly total: number;
  readonly stale: number;
  readonly blocked: number;
  readonly expiringSoon: number;
  readonly criticalIds: ReadonlyArray<string>;
}

export interface HookHealthSummaryOptions {
  readonly markdown: string;
  /** Current chapter number for relative risk calculations. */
  readonly chapterNumber: number;
  /** Number of chapters without advancement before considering a hook stale. Default: 10. */
  readonly staleThreshold?: number;
}

/**
 * Parse pending_hooks markdown and return a structured risk summary.
 * Handles empty/malformed input gracefully (returns zero counts).
 * Status normalization matches the consolidator in hook-lifecycle.ts.
 */
export function summarizePendingHookHealth(
  options: HookHealthSummaryOptions,
): HookHealthSummary {
  const { markdown, chapterNumber, staleThreshold = 10 } = options;

  if (!markdown.trim()) {
    return { total: 0, stale: 0, blocked: 0, expiringSoon: 0, criticalIds: [] };
  }

  let hooks: ReadonlyArray<StoredHook>;
  try {
    hooks = parsePendingHooksMarkdown(markdown);
  } catch {
    // Malformed markdown — return empty summary rather than crashing
    return { total: 0, stale: 0, blocked: 0, expiringSoon: 0, criticalIds: [] };
  }

  if (hooks.length === 0) {
    return { total: 0, stale: 0, blocked: 0, expiringSoon: 0, criticalIds: [] };
  }

  const stale: string[] = [];
  const blocked: string[] = [];
  const expiringSoon: string[] = [];
  const criticalIds: string[] = [];

  for (const hook of hooks) {
    // Normalize status: treat lowercase variants uniformly
    const status = hook.status.toLowerCase().trim();

    // Stale: hook hasn't been advanced past staleThreshold chapters
    const lastAdvanced = hook.lastAdvancedChapter ?? hook.startChapter;
    const chaptersSinceAdvance = chapterNumber - lastAdvanced;
    const isStale = status === "open"
      && chaptersSinceAdvance >= staleThreshold
      && hook.startChapter < chapterNumber;

    if (isStale) {
      stale.push(hook.hookId);
      criticalIds.push(hook.hookId);
    }

    if (status === "blocked") {
      blocked.push(hook.hookId);
      criticalIds.push(hook.hookId);
    }

    // Hook nearing its expected payoff window
    if (hook.expectedPayoff && status !== "resolved" && status !== "abandoned") {
      const payoffMatch = hook.expectedPayoff.match(/\d+/);
      if (payoffMatch) {
        const payoffChapter = parseInt(payoffMatch[0], 10);
        if (payoffChapter > 0 && chapterNumber >= payoffChapter - 3 && chapterNumber <= payoffChapter) {
          expiringSoon.push(hook.hookId);
          if (!criticalIds.includes(hook.hookId)) {
            criticalIds.push(hook.hookId);
          }
        }
      }
    }
  }

  return {
    total: hooks.length,
    stale: stale.length,
    blocked: blocked.length,
    expiringSoon: expiringSoon.length,
    criticalIds,
  };
}
