/**
 * Book creation global state — shared between server.ts and routes/agent.ts.
 * Tracks async book creation status for SSE broadcasting.
 */
export interface BookCreateEntry {
  status: "queued" | "creating" | "completed" | "failed";
  error?: string;
  phase?: string;
  createdAt: number;
  ttlMs: number;
}

export const BOOK_CREATE_TIMEOUT_MS = 10 * 60 * 1000; // 10 min timeout
export const BOOK_CREATE_TTL_MS = 60 * 1000; // 60s retention after completion

export const bookCreateStatus = new Map<string, BookCreateEntry>();

// Periodic cleanup
const bookCreateCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, st] of bookCreateStatus) {
    if (now - st.createdAt > st.ttlMs) {
      bookCreateStatus.delete(id);
    }
  }
}, 30_000);

if (typeof process !== "undefined") {
  process.once("beforeExit", () => clearInterval(bookCreateCleanupTimer));
}
