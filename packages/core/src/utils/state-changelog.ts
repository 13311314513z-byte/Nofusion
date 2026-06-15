/**
 * State Changelog — append-only log of state transitions within a BookWorkspace.
 *
 * Every mutation to truth files, hooks, roles, and chapters writes a
 * changelog entry. The log is stored as JSONL at:
 *   books/<bookId>/state_changelog.jsonl
 *
 * @module
 */

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

// ─── Changelog entry schema ────────────────────────────────────────

export const ChangelogEntrySchema = z.object({
  /** ISO timestamp of the state change. */
  timestamp: z.string().datetime(),
  /** What kind of resource changed. */
  resource: z.enum([
    "truth", "hook", "role", "source", "chapter", "config",
    "event-chain", "scene-template", "voice-profile", "plan", "context", "trace",
  ]),
  /** The resource identifier (e.g. file path, hook ID, chapter number). */
  resourceId: z.string().min(1),
  /** What action was performed. */
  action: z.enum(["created", "updated", "deleted", "approved", "rejected", "extracted", "analyzed"]),
  /** Optional: previous value hash for rollback. */
  previousHash: z.string().optional(),
  /** Optional: new value hash. */
  newHash: z.string().optional(),
  /** Optional: agent/actor that triggered this change. */
  triggeredBy: z.string().optional(),
  /** Optional: free-text summary of the change. */
  summary: z.string().optional(),
});

export type ChangelogEntry = z.infer<typeof ChangelogEntrySchema>;

// ─── Writer ────────────────────────────────────────────────────────

let changelogDir: string | null = null;

/** Initialize the changelog writer for a specific book directory. */
export function initChangelog(bookDir: string): void {
  changelogDir = bookDir;
}

/**
 * Append a changelog entry to the book's state_changelog.jsonl.
 */
export async function appendChangelog(entry: ChangelogEntry): Promise<void> {
  if (!changelogDir) return;

  const validated = ChangelogEntrySchema.parse(entry);
  const line = JSON.stringify(validated) + "\n";
  const filePath = join(changelogDir, "state_changelog.jsonl");

  await mkdir(changelogDir, { recursive: true }).catch(() => {});
  await appendFile(filePath, line, "utf-8");
}

/**
 * Convenience: log a truth file update.
 */
export async function logTruthUpdate(
  bookDir: string,
  file: string,
  previousHash?: string,
  newHash?: string,
  summary?: string,
): Promise<void> {
  initChangelog(bookDir);
  await appendChangelog({
    timestamp: new Date().toISOString(),
    resource: "truth",
    resourceId: file,
    action: "updated",
    previousHash,
    newHash,
    summary,
  });
}

/**
 * Convenience: log a chapter status change.
 */
export async function logChapterStatus(
  bookDir: string,
  chapterNumber: number,
  action: "approved" | "rejected" | "created" | "updated",
  summary?: string,
): Promise<void> {
  initChangelog(bookDir);
  await appendChangelog({
    timestamp: new Date().toISOString(),
    resource: "chapter",
    resourceId: String(chapterNumber),
    action,
    summary,
  });
}

/**
 * Convenience: log a hook/role change.
 */
export async function logResourceChange(
  bookDir: string,
  resource: ChangelogEntry["resource"],
  resourceId: string,
  action: ChangelogEntry["action"],
  summary?: string,
): Promise<void> {
  initChangelog(bookDir);
  await appendChangelog({
    timestamp: new Date().toISOString(),
    resource,
    resourceId,
    action,
    summary,
  });
}
