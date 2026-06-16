/**
 * Creative Tension Map — the dynamic vector field of unresolved narrative forces.
 *
 * Layer 2 of the seven-layer interaction framework (§14).
 * Updated every chapter. Each tension records the opposing poles, current
 * intensity, trend direction, and expected resolution timing. Feeds into
 * Planner memo generation and Interviewer's inherited questioning.
 *
 * Persisted at: books/<bookId>/story/creative_tension_map.json
 *
 * @module
 */

import { z } from "zod";

export const TensionTypeSchema = z.enum([
  "character",   // character vs character (e.g. 程时一 vs 山本武正)
  "theme",       // theme vs theme (e.g. 生存 vs 信念)
  "plot",        // plot-driven (e.g. 情报传递 vs 搜捕)
  "world",       // world/system (e.g. 个人 vs 时代)
]);

export type TensionType = z.infer<typeof TensionTypeSchema>;

export const TensionTrendSchema = z.enum([
  "heating",    // intensifying
  "cooling",    // de-escalating
  "stable",     // holding steady
  "resolved",   // fully resolved
]);

export type TensionTrend = z.infer<typeof TensionTrendSchema>;

export const CreativeTensionSchema = z.object({
  /** Unique identifier for this tension. */
  tensionId: z.string().min(1),

  /** Human-readable label. */
  label: z.string().min(1, "Tension label is required"),

  /** What kind of tension is this? */
  type: TensionTypeSchema,

  /** The two opposing poles. */
  poles: z.tuple([z.string(), z.string()]),

  /** Current intensity (1-10). */
  intensity: z.number().int().min(1).max(10),

  /** Is this tension heating up or cooling down? */
  trend: TensionTrendSchema,

  /** Which chapter introduced this tension? */
  introducedChapter: z.number().int().positive(),

  /** Which chapter last advanced this tension? */
  lastAdvancedChapter: z.number().int().positive(),

  /** Expected resolution chapter (if planned). */
  expectedResolutionChapter: z.number().int().positive().optional(),

  /** Free-text notes about this tension's current state. */
  notes: z.string().default(""),
});

export type CreativeTension = z.infer<typeof CreativeTensionSchema>;

export const CreativeTensionMapSchema = z.object({
  /** The book this map belongs to. */
  bookId: z.string().min(1),

  /** All active and resolved tensions. */
  tensions: z.array(CreativeTensionSchema).default([]),

  /** ISO timestamp of last update. */
  updatedAt: z.string().datetime().default(() => new Date().toISOString()),
});

export type CreativeTensionMap = z.infer<typeof CreativeTensionMapSchema>;

// ─── Helpers ───────────────────────────────────────────────────────

/** Find tensions that need attention (cooling for too long or approaching resolution). */
export function findAttentionTensions(
  map: CreativeTensionMap,
  currentChapter: number,
): CreativeTension[] {
  return map.tensions.filter((t) => {
    if (t.trend === "resolved") return false;
    const chaptersSince = currentChapter - t.lastAdvancedChapter;
    const overdue = chaptersSince >= 3 && t.trend === "cooling";
    const nearingResolution =
      t.expectedResolutionChapter !== undefined &&
      currentChapter >= t.expectedResolutionChapter - 1;
    return overdue || nearingResolution;
  });
}

/** Calculate the overdue index for a tension (chapters since last advance / expected pace). */
export function tensionOverdueIndex(
  tension: CreativeTension,
  currentChapter: number,
): number {
  const since = currentChapter - tension.lastAdvancedChapter;
  const pace = tension.expectedResolutionChapter
    ? (tension.expectedResolutionChapter - tension.introducedChapter) / 3
    : 5;
  return since / Math.max(pace, 1);
}
