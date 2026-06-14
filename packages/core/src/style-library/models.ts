/**
 * Style Library models — author style profile storage and aggregation.
 */

import type { StyleProfile } from "../models/style-profile.js";
import type { DocumentFileType } from "../utils/document-reader.js";

/** A single source document within an author's style archive. */
export interface StyleSourceDocument {
  readonly id: string;
  readonly authorId: string;
  readonly fileName: string;
  readonly fileType: DocumentFileType;
  readonly textHash: string;
  readonly charCount: number;
  readonly profile: StyleProfile;
  readonly status: "ready" | "failed";
  readonly error?: string;
  readonly extractedAt: string;
}

/** Aggregated style profile for an author. */
export interface AuthorStyleProfile {
  readonly id: string;
  readonly name: string;
  readonly language: "zh" | "en";
  readonly tags: ReadonlyArray<string>;
  readonly sourceIds: ReadonlyArray<string>;
  readonly aggregateProfile: StyleProfile;
  readonly sampleStats: {
    readonly sourceCount: number;
    readonly totalChars: number;
    readonly avgCharsPerSource: number;
  };
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** 互联网来源链接列表（仅从网络抓取时填充） */
  readonly sourceUrls?: ReadonlyArray<{
    readonly url: string;
    readonly title: string;
    readonly fetchedAt: string;
    readonly localFilePath?: string;
  }>;
}

/** Index of all author profiles in the style library. */
export interface StyleLibraryIndex {
  readonly authors: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly language: "zh" | "en";
    readonly tags: ReadonlyArray<string>;
    readonly sourceCount: number;
    readonly updatedAt: string;
  }>;
}

/** Result of applying an author profile to a book. */
export interface ApplyStyleResult {
  readonly bookId: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly styleProfilePath: string;
  readonly styleGuidePath: string;
}

// ---------------------------------------------------------------------------
// Distillation models
// ---------------------------------------------------------------------------

export type DistillationStatus = "draft" | "reviewed" | "published" | "archived";
export type SampleAdequacyLevel = "insufficient" | "limited" | "sufficient";

export interface DistillationRule {
  readonly id: string;
  readonly dimension:
    | "sentence-length"
    | "paragraph-rhythm"
    | "dialogue"
    | "action"
    | "psychological"
    | "sensory"
    | "vocabulary"
    | "rhetoric"
    | "punctuation"
    | "ai-tell";
  readonly mode: "target-range" | "prefer" | "avoid" | "instruction";
  readonly instruction: string;
  readonly targetRange?: { readonly min: number; readonly max: number };
  readonly confidence: number;
  readonly source: "automatic" | "manual";
  readonly enabled: boolean;
}

export interface DistillationEvidence {
  readonly id: string;
  readonly authorId: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly dimension: string;
  readonly excerpt: string;
  readonly start?: number;
  readonly end?: number;
  readonly lineNumber?: number;
  readonly textHash: string;
  readonly approved: boolean;
}

export interface AuthorDistillation {
  readonly authorId: string;
  readonly authorProfileVersion: number;
  readonly version: number;
  readonly status: DistillationStatus;
  readonly generatedAt: string;
  readonly reviewedAt?: string;
  readonly publishedAt?: string;
  readonly sampleAdequacy: SampleAdequacyLevel;
  readonly confidence: number;
  readonly rules: ReadonlyArray<DistillationRule>;
  readonly evidenceRefs: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
}
