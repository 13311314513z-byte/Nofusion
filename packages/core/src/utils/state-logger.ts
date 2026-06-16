/**
 * state-logger.ts — Persistent state change audit trail (M10).
 *
 * Writes a state_changelog.jsonl line for every meaningful state mutation so
 * debugging, analytics, and trend reports can reconstruct "what happened when"
 * without relying on in-memory signals that vanish after the process exits.
 */

import { appendFile } from "node:fs/promises";
import { join } from "node:path";

/** A single state mutation record. */
export interface StateDelta {
  /** ISO-8601 timestamp of the mutation. */
  readonly timestamp: string;
  /** The chapter whose processing triggered this mutation. */
  readonly chapterNumber: number;
  /** Which pipeline phase triggered the change (planner / writer / auditor / hook-advance / etc.). */
  readonly phase: string;
  /** A short, stable key identifying the kind of state that changed. */
  readonly key: string;
  /** Snapshot of the value before the change (optional — omitted when the value
   *  didn't exist before, e.g. a newly-created hook). */
  readonly before?: unknown;
  /** Snapshot of the value after the change. */
  readonly after: unknown;
}

/** Append a single delta line to the book's changelog. */
export async function logStateDelta(
  bookDir: string,
  delta: StateDelta,
): Promise<void> {
  const logPath = join(bookDir, "story", "state", "state_changelog.jsonl");
  await appendFile(logPath, JSON.stringify(delta) + "\n", "utf-8");
}

/**
 * Convenience helpers for common mutation types so callers don't need to
 * hand-build the `key` string every time.
 */

export async function logHookCreated(
  bookDir: string,
  chapterNumber: number,
  hookId: string,
  hookRecord: unknown,
): Promise<void> {
  await logStateDelta(bookDir, {
    timestamp: new Date().toISOString(),
    chapterNumber,
    phase: "hook-management",
    key: `hook:${hookId}:created`,
    after: hookRecord,
  });
}

export async function logHookAdvanced(
  bookDir: string,
  chapterNumber: number,
  hookId: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await logStateDelta(bookDir, {
    timestamp: new Date().toISOString(),
    chapterNumber,
    phase: "hook-management",
    key: `hook:${hookId}:advanced`,
    before,
    after,
  });
}

export async function logPlanGenerated(
  bookDir: string,
  chapterNumber: number,
  planDigest: unknown,
): Promise<void> {
  await logStateDelta(bookDir, {
    timestamp: new Date().toISOString(),
    chapterNumber,
    phase: "planner",
    key: `plan:chapter-${chapterNumber}`,
    after: planDigest,
  });
}

export async function logChapterWritten(
  bookDir: string,
  chapterNumber: number,
  digest: { readonly wordCount: number; readonly title: string },
): Promise<void> {
  await logStateDelta(bookDir, {
    timestamp: new Date().toISOString(),
    chapterNumber,
    phase: "writer",
    key: `chapter:${chapterNumber}:written`,
    after: digest,
  });
}

export async function logAuditCompleted(
  bookDir: string,
  chapterNumber: number,
  auditDigest: unknown,
): Promise<void> {
  await logStateDelta(bookDir, {
    timestamp: new Date().toISOString(),
    chapterNumber,
    phase: "auditor",
    key: `audit:chapter-${chapterNumber}`,
    after: auditDigest,
  });
}
