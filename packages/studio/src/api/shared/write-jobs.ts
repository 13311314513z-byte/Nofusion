// ─── Write job tracker (P0-1: fire-and-forget protection) ────────────────────
// Shared module so both server.ts and route modules can access write jobs.

export interface WriteJobEntry {
  status: "running" | "completed" | "failed" | "timed_out";
  bookId: string;
  /** "write-next" | "draft" | "rewrite" */
  operation: string;
  chapterNumber?: number;
  error?: string;
  startedAt: number;
}

export const writeJobs = new Map<string, WriteJobEntry>();
export const WRITE_JOB_TIMEOUT_MS = 10 * 60 * 1000; // 10 min
export const WRITE_JOB_TTL_MS = 2 * 60 * 1000; // 2 min retention after completion

// Periodic cleanup of stale jobs
const writeJobCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, job] of writeJobs) {
    if (job.status !== "running" && now - job.startedAt > WRITE_JOB_TTL_MS) {
      writeJobs.delete(key);
    }
    if (job.status === "running" && now - job.startedAt > WRITE_JOB_TIMEOUT_MS + 60_000) {
      writeJobs.delete(key);
    }
  }
}, 30_000);

// Cleanup on exit (best-effort)
if (typeof process !== "undefined") {
  process.once("beforeExit", () => clearInterval(writeJobCleanupTimer));
}

export function acquireWriteJob(bookId: string, operation: string): string | null {
  const key = `${bookId}:${operation}`;
  for (const [, job] of writeJobs) {
    if (job.bookId === bookId && job.status === "running") {
      return null; // already writing
    }
  }
  writeJobs.set(key, {
    status: "running",
    bookId,
    operation,
    startedAt: Date.now(),
  });
  return key;
}

export function completeWriteJob(key: string, chapterNumber?: number): void {
  const job = writeJobs.get(key);
  if (job) {
    writeJobs.set(key, { ...job, status: "completed", chapterNumber });
  }
}

export function failWriteJob(key: string, error: string): void {
  const job = writeJobs.get(key);
  if (job) {
    writeJobs.set(key, { ...job, status: "failed", error });
  }
}

export function timeoutWriteJob(key: string): void {
  const job = writeJobs.get(key);
  if (job) {
    writeJobs.set(key, { ...job, status: "timed_out", error: "Write operation timed out" });
  }
}
