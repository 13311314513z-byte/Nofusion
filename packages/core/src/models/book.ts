import { z } from "zod";

export const PlatformSchema = z.enum(["tomato", "feilu", "qidian", "other"]);
export type Platform = z.infer<typeof PlatformSchema>;

export function normalizePlatformId(platform: unknown): Platform | undefined {
  if (typeof platform !== "string") {
    return undefined;
  }

  const raw = platform.trim();
  if (!raw) {
    return undefined;
  }

  const lowered = raw.toLowerCase();
  const compact = lowered.replace(/[\s_-]+/g, "");

  if (compact === "tomato" || compact === "fanqie" || compact === "fanqienovel" || raw.includes("番茄")) {
    return "tomato";
  }
  if (compact === "qidian" || compact === "qidianzhongwenwang" || raw.includes("起点")) {
    return "qidian";
  }
  if (compact === "feilu" || raw.includes("飞卢")) {
    return "feilu";
  }
  if (compact === "other" || compact === "others" || raw.includes("其他") || raw.includes("其它")) {
    return "other";
  }

  return "other";
}

export function normalizePlatformOrOther(platform: unknown): Platform {
  return normalizePlatformId(platform) ?? "other";
}

export const GenreSchema = z.string().min(1);
export type Genre = z.infer<typeof GenreSchema>;

export const BookStatusSchema = z.enum([
  "incubating",
  "outlining",
  "active",
  "paused",
  "completed",
  "dropped",
]);
export type BookStatus = z.infer<typeof BookStatusSchema>;

export const FanficModeSchema = z.enum(["canon", "au", "ooc", "cp"]);
export type FanficMode = z.infer<typeof FanficModeSchema>;

export const BookConfigSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  platform: PlatformSchema,
  genre: GenreSchema,
  status: BookStatusSchema,
  targetChapters: z.number().int().min(1).default(200),
  chapterWordCount: z.number().int().min(1000).default(3000),
  language: z.enum(["zh", "en"]).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  parentBookId: z.string().optional(),
  fanficMode: FanficModeSchema.optional(),
  volumeCount: z.number().int().min(1).optional(),
  currentVolume: z.number().int().min(1).optional(),
  keywords: z.array(z.string()).optional(),
  targetAudience: z.string().optional(),
  serializationStatus: z.enum(["draft", "serializing", "completed", "hiatus"]).optional(),
  // ── Extended fields (P1-1) ──────────────────────────────
  /** Reference to the style profile (authorId) applied to this book. */
  styleProfileId: z.string().optional(),
  /** Whether to auto-apply style adjustments on each chapter. */
  autoStyleAdjust: z.boolean().optional(),
  /** Default narrative control mode for Writer prompts. */
  narrativeMode: z.enum(["strict", "guided", "loose"]).optional(),
  /** Per-agent model overrides (agent name → model string). */
  pipelineModels: z.record(z.string(), z.string()).optional(),
  /** The book's creative vision / soul description. */
  bookSoul: z.string().optional(),
  /** Target total word count (for completion tracking). */
  targetWordCount: z.number().int().positive().optional(),
  /** Whether to auto-approve chapters that pass audit. */
  autoApprove: z.boolean().optional(),
  /** Allow concurrent chapter generation. */
  concurrentGeneration: z.boolean().optional(),
  /** Maximum concurrent chapters. */
  maxConcurrency: z.number().int().min(1).max(4).optional(),
});

export type BookConfig = z.infer<typeof BookConfigSchema>;
