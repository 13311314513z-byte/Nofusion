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
