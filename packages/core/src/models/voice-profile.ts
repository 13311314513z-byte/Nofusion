/**
 * Voice Profile — per-character vocal fingerprint for consistent dialogue.
 *
 * Captures sentence patterns, word preferences, and dialogue style for each
 * character. The Writer uses these profiles to keep character voices distinct
 * and consistent across chapters.
 *
 * Persisted at: books/<bookId>/story/voice_profiles/<characterId>.json
 *
 * @module
 */

import { z } from "zod";

export const VoiceProfileSchema = z.object({
  /** Matches RoleCard.id. */
  characterId: z.string().min(1),

  /** Display name. */
  characterName: z.string().min(1),

  // ── Sentence-level features ──────────────────────────────

  /** Average sentence length in characters (Chinese) or words (English). */
  avgSentenceLength: z.number().positive().optional(),

  /** Sentence complexity level. */
  sentenceComplexity: z.enum(["simple", "moderate", "complex"]).default("moderate"),

  /** Whether this character tends to use short, clipped sentences. */
  prefersShortSentences: z.boolean().default(false),

  /** Whether this character frequently uses rhetorical questions. */
  usesRhetoricalQuestions: z.boolean().default(false),

  // ── Word preferences ─────────────────────────────────────

  /** Signature phrases or verbal tics. */
  signaturePhrases: z.array(z.string()).default([]),

  /** Vocabulary level. */
  vocabularyLevel: z.enum(["colloquial", "standard", "literary"]).default("standard"),

  /** Words this character favors. */
  favoredWords: z.array(z.string()).default([]),

  /** Words this character avoids. */
  avoidedWords: z.array(z.string()).default([]),

  // ── Dialogue style ───────────────────────────────────────

  /** Overall dialogue style. */
  dialogueStyle: z.enum([
    "terse", "verbose", "formal", "casual",
    "sarcastic", "earnest", "cold", "warm",
  ]).default("casual"),

  /** Tendency to interrupt others (0–1). */
  interruptionTendency: z.number().min(0).max(1).default(0.3),

  /** Whether this character uses regional dialect. */
  usesDialect: z.boolean().default(false),

  /** Notes about dialect usage. */
  dialectNotes: z.string().default(""),

  // ── Metadata ─────────────────────────────────────────────

  /** Chapter numbers used for analysis. */
  analyzedFromChapters: z.array(z.number().int().positive()).default([]),

  /** Confidence in the profile accuracy (0–1). */
  confidence: z.number().min(0).max(1).default(0.5),

  /** ISO timestamp of last update. */
  updatedAt: z.string().datetime().default(() => new Date().toISOString()),
});

export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;

/** Index of all voice profiles for a book. */
export const VoiceProfileIndexSchema = z.object({
  profiles: z.array(VoiceProfileSchema).default([]),
  updatedAt: z.string().datetime().default(() => new Date().toISOString()),
});

export type VoiceProfileIndex = z.infer<typeof VoiceProfileIndexSchema>;
