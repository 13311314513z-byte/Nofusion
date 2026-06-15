/**
 * BookContext — shared state and event bus for BookWorkspace sections.
 *
 * Enables cross-section communication without prop drilling:
 *   - BookGoalsSection publishes "goal-updated" → BookChatSection refreshes
 *   - BookHooksSection publishes "hook-created" → BookRuntimeSection refreshes
 *
 * Pattern: React Context + useRef listeners (no external deps).
 */

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";
import type { AuthorChapterIntent } from "@actalk/inkos-core";

// ─── Event types ───────────────────────────────────────────────────

export type BookContextEvent =
  | { type: "goal-updated"; chapterNumber: number }
  | { type: "intent-updated"; chapterNumber: number }
  | { type: "hook-created"; hookId: string }
  | { type: "hook-deleted"; hookId: string }
  | { type: "chapter-written"; chapterNumber: number }
  | { type: "audit-completed"; chapterNumber: number };

// ─── Context value ─────────────────────────────────────────────────

export interface BookContextValue {
  readonly bookId: string;
  /** The currently active chapter intent (shared across sections). */
  readonly activeChapterIntent: AuthorChapterIntent | null;
  readonly setActiveChapterIntent: (intent: AuthorChapterIntent | null) => void;
  /** Fire an event to all subscribed sections. */
  readonly notify: (event: BookContextEvent) => void;
  /** Subscribe to events. Returns an unsubscribe function. */
  readonly subscribe: (fn: (event: BookContextEvent) => void) => () => void;
}

const BookCtx = createContext<BookContextValue | null>(null);

// ─── Provider ──────────────────────────────────────────────────────

export function BookContextProvider({
  bookId,
  children,
}: {
  readonly bookId: string;
  readonly children: ReactNode;
}) {
  const [intent, setIntent] = useState<AuthorChapterIntent | null>(null);
  const listeners = useRef<Set<(event: BookContextEvent) => void>>(new Set());

  const notify = useCallback((event: BookContextEvent) => {
    for (const fn of listeners.current) {
      fn(event);
    }
  }, []);

  const subscribe = useCallback((fn: (event: BookContextEvent) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  return (
    <BookCtx.Provider
      value={{
        bookId,
        activeChapterIntent: intent,
        setActiveChapterIntent: setIntent,
        notify,
        subscribe,
      }}
    >
      {children}
    </BookCtx.Provider>
  );
}

// ─── Hook ──────────────────────────────────────────────────────────

export function useBookContext(): BookContextValue {
  const ctx = useContext(BookCtx);
  if (!ctx) {
    throw new Error("useBookContext must be used within a BookContextProvider");
  }
  return ctx;
}
