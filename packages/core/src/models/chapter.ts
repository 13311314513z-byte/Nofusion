import { z } from "zod";
import { LengthTelemetrySchema } from "./length-governance.js";

export const ChapterStatusSchema = z.enum([
  "card-generated",
  "drafting",
  "drafted",
  "auditing",
  "audit-passed",
  "audit-failed",
  "state-degraded",
  "revising",
  "ready-for-review",
  "approved",
  "rejected",
  "published",
  "imported",
]);
export type ChapterStatus = z.infer<typeof ChapterStatusSchema>;

export const ChapterMetaSchema = z.object({
  number: z.number().int().min(1),
  title: z.string(),
  status: ChapterStatusSchema,
  wordCount: z.number().int().default(0),
  wordCountTarget: z.number().int().min(1).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  auditIssues: z.array(z.string()).default([]),
  lengthWarnings: z.array(z.string()).default([]),
  tags: z.array(z.string()).optional(),
  povCharacter: z.string().optional(),
  location: z.string().optional(),
  moodScore: z.number().min(-10).max(10).optional(),
  revisionCount: z.number().int().min(0).optional(),
  timeOfDay: z.string().optional(),
  chapterType: z.string().optional(),
  reviewNote: z.string().optional(),
  detectionScore: z.number().min(0).max(1).optional(),
  detectionProvider: z.string().optional(),
  detectedAt: z.string().datetime().optional(),
  lengthTelemetry: LengthTelemetrySchema.optional(),
  /** Revision of the AuthorChapterIntent used to generate this chapter. */
  intentRevision: z.number().int().min(0).optional(),
  tokenUsage: z.object({
    promptTokens: z.number().int().default(0),
    completionTokens: z.number().int().default(0),
    totalTokens: z.number().int().default(0),
  }).optional(),
});

export type ChapterMeta = z.infer<typeof ChapterMetaSchema>;
