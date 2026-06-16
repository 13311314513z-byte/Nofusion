/**
 * Book Soul — the creative vision that defines why this book must exist.
 *
 * Layer 0 of the seven-layer interaction framework (§14).
 * Set once at book creation, rarely revised. Constrains all subsequent
 * thematic choices across every chapter.
 *
 * Persisted at: books/<bookId>/story/book_soul.json
 *
 * @module
 */

import { z } from "zod";

export const BookSoulSchema = z.object({
  /** The core expression — one sentence about what this story is truly about. */
  coreExpression: z.string().min(1, "Core expression is required"),

  /** If the reader remembers only one thing, this is it. */
  oneThingToRemember: z.string().min(1, "One thing to remember is required"),

  /** The emotional driver behind this story. What moment makes the author feel most alive? */
  emotionalCore: z.string().optional(),

  /** A work this book is in dialogue with (homage / subversion / response). */
  dialogicReference: z.string().optional(),

  /** Rules that must never be broken in this story. */
  unbreakableRules: z.array(z.string()).default([]),

  /** ISO timestamp of last update. */
  updatedAt: z.string().datetime().default(() => new Date().toISOString()),
});

export type BookSoul = z.infer<typeof BookSoulSchema>;

/** Default book soul for new books (author fills in later). */
export const DEFAULT_BOOK_SOUL: BookSoul = {
  coreExpression: "",
  oneThingToRemember: "",
  unbreakableRules: [],
  updatedAt: new Date().toISOString(),
};
