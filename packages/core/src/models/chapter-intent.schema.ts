/**
 * Zod schemas for AuthorChapterIntent and related types.
 *
 * These schemas serve as the single source of truth for data validation
 * across Core, Studio, and API. All three layers should import and reuse
 * these schemas rather than duplicating interface definitions.
 *
 * @module
 */

import { z } from "zod";

// ─── Author scene plan ─────────────────────────────────────────────

export const AuthorScenePlanSchema = z.object({
  /** What this scene is supposed to accomplish. */
  goal: z.string().min(1, "Scene goal is required"),
  /** Where the scene takes place. */
  location: z.string().optional(),
  /** Whose point of view. */
  povCharacter: z.string().optional(),
  /** The emotion the author wants the reader to feel during this scene. */
  targetEmotion: z.string().optional(),
  /** The central conflict or tension of the scene. */
  conflict: z.string().optional(),
  /** What happens at the end of the scene (how it resolves or escalates). */
  outcome: z.string().optional(),
  /** Beats that MUST appear in this scene. */
  requiredBeats: z.array(z.string()).optional(),
  /** Moves that MUST NOT appear in this scene. */
  forbiddenMoves: z.array(z.string()).optional(),
  /** Narrative importance of this scene. */
  importance: z.enum(["bridge", "normal", "key"]).optional(),
});

export type AuthorScenePlan = z.input<typeof AuthorScenePlanSchema>;

// ─── Character state snapshot ─────────────────────────────────────

export const AuthorCharacterStateSchema = z.object({
  /** Character identifier (matches role card id). */
  characterId: z.string().min(1, "Character ID is required"),
  /** The character's dominant emotion at the start of the chapter. */
  emotion: z.string().min(1, "Emotion is required"),
  /** How the character's relationships changed since last chapter. */
  relationshipChanges: z.string().optional(),
});

export type AuthorCharacterState = z.input<typeof AuthorCharacterStateSchema>;

// ─── The full intent ───────────────────────────────────────────────

export const AuthorChapterIntentSchema = z.object({
  chapterNumber: z.number().int().positive(),

  // ── Level 1: Core (author must answer these) ────────────────
  coreNarrative: z.string().optional(),
  readerTakeaway: z.string().optional(),
  keyMoment: z.string().optional(),

  // ── Level 2: Scene planning (strongly recommended) ──────────
  scenes: z.array(AuthorScenePlanSchema).optional(),

  // ── Level 3: Character state (on demand) ────────────────────
  characterStates: z.array(AuthorCharacterStateSchema).optional(),

  // ── Level 4: Constraints (inherited from ChapterGoalCard) ───
  requiredBeats: z.array(z.string()).optional(),
  forbiddenMoves: z.array(z.string()).optional(),
  pendingHookIds: z.array(z.string()).optional(),

  // ── Meta ────────────────────────────────────────────────────
  narrativePosition: z
    .enum(["opening", "rising", "climax", "falling", "resolution"])
    .optional(),
  plotLine: z.string().optional(),
  interviewCompletedAt: z.string().datetime().optional(),

  // ── Version tracking (Stage 0 addition) ─────────────────────
  /** Monotonically incremented on each author edit. */
  revision: z.number().int().optional().default(1),
  /** Whether this intent is still active, confirmed by generation, or replaced. */
  status: z.enum(["draft", "confirmed", "superseded"]).optional().default("draft"),
  /** ISO timestamp of last modification. */
  updatedAt: z.string().datetime().optional().default(() => new Date().toISOString()),
  /** Origin of this intent data. */
  source: z.enum(["author", "import", "assistant-suggestion"]).optional().default("author"),
});

export type AuthorChapterIntent = z.input<typeof AuthorChapterIntentSchema>;

// ─── Index wrapper ─────────────────────────────────────────────────

export const ChapterIntentsIndexSchema = z.object({
  intents: z.array(AuthorChapterIntentSchema),
  updatedAt: z.string().datetime().default(() => new Date().toISOString()),
});

export type ChapterIntentsIndex = z.infer<typeof ChapterIntentsIndexSchema>;

// ─── Migration helpers ─────────────────────────────────────────────

/**
 * Migrate a legacy intent (missing revision/status/updatedAt/source)
 * to the current schema by filling in defaults.
 */
export function migrateLegacyIntent(
  raw: Record<string, unknown>,
): AuthorChapterIntent {
  return AuthorChapterIntentSchema.parse({
    revision: 1,
    status: "draft",
    updatedAt: new Date().toISOString(),
    source: "author",
    ...raw,
  });
}

/**
 * Migrate an entire index file. Safe to call on every load.
 *
 * Tolerant of malformed or null entries: they are silently skipped rather
 * than causing the whole load to fail. This preserves the behaviour of the
 * previous hand-written loader.
 */
export function migrateIntentsIndex(
  raw: unknown,
): ChapterIntentsIndex {
  const record = raw !== null && typeof raw === "object"
    ? raw as Record<string, unknown>
    : {};
  const parsed = ChapterIntentsIndexSchema.partial().safeParse(record);
  const rawIntents = Array.isArray(record.intents)
    ? (record.intents as unknown[])
    : [];

  const migrated: Array<z.output<typeof AuthorChapterIntentSchema>> = [];
  for (const entry of rawIntents) {
    if (entry === null || typeof entry !== "object") continue;
    const parsedIntent = AuthorChapterIntentSchema.safeParse({
      revision: 1,
      status: "draft",
      updatedAt: new Date().toISOString(),
      source: "author",
      ...entry,
    });
    if (parsedIntent.success) {
      migrated.push(parsedIntent.data);
    }
  }

  return {
    intents: migrated,
    updatedAt: parsed.success ? (parsed.data.updatedAt ?? new Date().toISOString()) : new Date().toISOString(),
  };
}
