/**
 * Reader Contract — the promises made to the reader that must not be broken.
 *
 * Layer 1 of the seven-layer interaction framework (§14).
 * Set at book creation and revised per volume/arc. Drives genre adherence,
 * satisfaction design, and anti-abandonment strategies.
 *
 * Persisted at: books/<bookId>/story/reader_contract.json
 *
 * @module
 */

import { z } from "zod";

export const SatisfactionTypeSchema = z.enum([
  "intellectual",  // 智慧碾压、推理快感
  "emotional",     // 情感共鸣、催泪治愈
  "mystery",       // 悬疑解谜、层层剥开
  "action",        // 战斗燃爆、节奏压迫
  "character",     // 人物成长、关系拉扯
  "hybrid",        // 复合型
]);

export type SatisfactionType = z.infer<typeof SatisfactionTypeSchema>;

export const ReaderContractSchema = z.object({
  /** What type of experience does the reader expect? */
  genrePromise: z.string().min(1, "Genre promise is required"),

  /** If a reader abandons this book, the most likely reason — and how to avoid it. */
  abandonmentRisk: z.string().optional(),

  /** The primary satisfaction type. */
  satisfactionType: SatisfactionTypeSchema,

  /** Content the author absolutely will NOT write. */
  hardNoGos: z.array(z.string()).default([]),

  /** The emotion the reader should feel upon finishing the final chapter. */
  finalEmotion: z.string().min(1, "Final emotion is required"),

  /** Tracked promises: each one is made in a chapter and tracked until fulfilled. */
  promises: z
    .array(
      z.object({
        id: z.string(),
        description: z.string(),
        madeInChapter: z.number().int().positive(),
        fulfilledInChapter: z.number().int().positive().optional(),
        status: z.enum(["pending", "fulfilled", "broken", "abandoned"]),
      }),
    )
    .default([]),

  /** ISO timestamp of last update. */
  updatedAt: z.string().datetime().default(() => new Date().toISOString()),
});

export type ReaderContract = z.infer<typeof ReaderContractSchema>;

export const DEFAULT_READER_CONTRACT: ReaderContract = {
  genrePromise: "",
  satisfactionType: "hybrid",
  hardNoGos: [],
  finalEmotion: "",
  promises: [],
  updatedAt: new Date().toISOString(),
};
