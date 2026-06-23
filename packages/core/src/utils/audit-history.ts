/**
 * Audit history — append-only JSONL log for chapter audit results.
 *
 * File location: books/<bookId>/story/audit_history.jsonl
 *
 * Each line is a JSON object with:
 * - timestamp: ISO 8601
 * - chapterNumber: number
 * - passed: boolean
 * - overallScore?: number
 * - issueCount: number
 * - criticalCount: number
 * - warningCount: number
 * - infoCount: number
 * - summary: string
 * - revisionRound?: number  // 0 = initial, 1+ = post-revision
 */

import { appendFile,mkdir,readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AuditResult } from "../agents/continuity.js";

export interface AuditHistoryEntry {
  readonly timestamp: string;
  readonly chapterNumber: number;
  readonly passed: boolean;
  readonly overallScore?: number;
  readonly issueCount: number;
  readonly criticalCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly summary: string;
  readonly revisionRound: number;
}

// Per-bookdir write queue to prevent concurrent appendFile interleaving.
// Each book directory gets a promise chain; writes are serialized per-book.
const writeQueues = new Map<string, Promise<void>>();

function enqueueWrite(bookDir: string, task: () => Promise<void>): Promise<void> {
  const key = bookDir;
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const next = previous.then(task, task); // Recover from rejections
  writeQueues.set(key, next);
  // Clean up resolved entries (garbage collect after 5s)
  next.then(() => {
    setTimeout(() => {
      if (writeQueues.get(key) === next) {
        writeQueues.delete(key);
      }
    }, 5_000).unref();
  }, () => {
    setTimeout(() => {
      if (writeQueues.get(key) === next) {
        writeQueues.delete(key);
      }
    }, 5_000).unref();
  });
  return next;
}

export async function appendAuditHistory(
  bookDir: string,
  chapterNumber: number,
  auditResult: AuditResult,
  revisionRound = 0,
): Promise<void> {
  const issues = auditResult.issues ?? [];
  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const infoCount = issues.filter((i) => i.severity === "info").length;

  const entry: AuditHistoryEntry = {
    timestamp: new Date().toISOString(),
    chapterNumber,
    passed: auditResult.passed,
    overallScore: auditResult.overallScore,
    issueCount: issues.length,
    criticalCount,
    warningCount,
    infoCount,
    summary: auditResult.summary,
    revisionRound,
  };

  const storyDir = join(bookDir, "story");
  await mkdir(storyDir, { recursive: true });
  const filePath = join(storyDir, "audit_history.jsonl");

  // Use the write queue to prevent concurrent append interleaving.
  await enqueueWrite(bookDir, async () => {
    await appendFile(filePath, JSON.stringify(entry) + "\n", "utf-8");
  });
}

export async function loadAuditHistory(bookDir: string): Promise<AuditHistoryEntry[]> {
  const filePath = join(bookDir, "story", "audit_history.jsonl");
  try {
    const raw = await readFile(filePath, "utf-8");
    const entries: AuditHistoryEntry[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed) as AuditHistoryEntry);
      } catch {
        // Skip corrupted line, preserve rest
      }
    }
    return entries;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw e;
  }
}
