/**
 * Zod schemas for /style/* API endpoints.
 * Enforces whitelist validation and rejects unknown fields.
 */

import { z } from "zod";

export const MAX_PREPROCESS_TEXT_CHARS = 5_000_000;

export const PreprocessOptionsSchema = z.object({
  filterCode: z.boolean().optional(),
  filterRepeatedPrompts: z.boolean().optional(),
  filterUrls: z.boolean().optional(),
  filterStructuredData: z.boolean().optional(),
  stripMarkdown: z.boolean().optional(),
  minLineLength: z.number().int().min(0).max(100).optional(),
  deduplicateParagraphs: z.boolean().optional(),
  filterTimestamps: z.boolean().optional(),
  filterIds: z.boolean().optional(),
  filterNoiseMarkers: z.boolean().optional(),
}).strict();

export const RelayoutOptionsSchema = z.object({
  mergeShortParagraphs: z.boolean().optional(),
  shortParagraphThreshold: z.number().int().min(1).max(200).optional(),
  formatDialogue: z.boolean().optional(),
  ensureParagraphSpacing: z.boolean().optional(),
  normalizeQuotes: z.boolean().optional(),
  compressBlankLines: z.boolean().optional(),
}).strict();

export const PreprocessRequestSchema = z.object({
  text: z.string().max(MAX_PREPROCESS_TEXT_CHARS),
  options: PreprocessOptionsSchema.optional(),
}).strict();

export const RelayoutRequestSchema = z.object({
  text: z.string().max(MAX_PREPROCESS_TEXT_CHARS),
  options: RelayoutOptionsSchema.optional(),
}).strict();

const InspectionCodeSchema = z.enum([
  "explicit-think-block",
  "similar-paragraphs",
  "repeated-phrase",
  "mixed-language",
  "encoded-data",
  "asr-marker",
  "translation-pair",
  "quote-block",
  "rp-marker",
  "high-whitespace",
  "possible-garbled-text",
]);

export const InspectRequestSchema = z.object({
  text: z.string().max(MAX_PREPROCESS_TEXT_CHARS),
  checks: z.array(InspectionCodeSchema).optional(),
}).strict();

export type PreprocessRequest = z.infer<typeof PreprocessRequestSchema>;
export type RelayoutRequest = z.infer<typeof RelayoutRequestSchema>;
export type InspectRequest = z.infer<typeof InspectRequestSchema>;

// --- Style Diagnostics & Adjustment Schemas ---

export const DiagnosticsRequestSchema = z.object({
  text: z.string().min(1).max(MAX_PREPROCESS_TEXT_CHARS),
  language: z.enum(["zh", "en"]).optional(),
}).strict();

export const CompareRequestSchema = z.object({
  text: z.string().min(1).max(MAX_PREPROCESS_TEXT_CHARS),
  targetAuthorId: z.string().min(1).max(128),
  language: z.enum(["zh", "en"]).optional(),
}).strict();

export const AdjustmentPlanRequestSchema = z.object({
  text: z.string().min(1).max(MAX_PREPROCESS_TEXT_CHARS),
  targetAuthorId: z.string().max(128).optional(),
  maxSuggestions: z.number().int().min(1).max(50).optional(),
}).strict();

export const RewritePreviewRequestSchema = z.object({
  text: z.string().min(1).max(20_000),
  sourceHash: z.string().min(1),
  targetAuthorId: z.string().min(1).max(128),
  authorProfileVersion: z.number().int().min(1),
  selectedSuggestionIds: z.array(z.string()).min(1).max(50),
  preserveContent: z.literal(true),
}).strict();
