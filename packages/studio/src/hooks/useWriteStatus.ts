/**
 * useWriteStatus — poll the current write job status for a book.
 *
 * P1-5: Wires the previously unused GET /api/v1/books/:id/write-status
 * endpoint to the Studio frontend so users see live write progress.
 *
 * @module
 */

import { useApi } from "./use-api";
import { useEffect, useRef } from "react";

export interface WriteStatus {
  readonly bookId: string;
  readonly jobKey?: string;
  readonly status: "idle" | "queued" | "writing" | "completed" | "failed";
  readonly chapterNumber?: number;
  readonly error?: string;
  readonly phase?: string;
  readonly elapsedMs?: number;
}

const POLL_INTERVAL_MS = 2000;

/**
 * Polls GET /api/v1/books/:id/write-status every 2s while a write job
 * is queued or active. Returns the latest status snapshot.
 *
 * Set `active` to false to stop polling (e.g. when the write panel is closed).
 */
export function useWriteStatus(bookId: string | undefined, active = true) {
  const { data, loading, refetch } = useApi<WriteStatus>(
    bookId && active
      ? `/api/v1/books/${encodeURIComponent(bookId)}/write-status`
      : null,
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!bookId || !active) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const poll = () => {
      refetch?.();
    };

    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [bookId, active, refetch]);

  return { status: data, loading };
}
