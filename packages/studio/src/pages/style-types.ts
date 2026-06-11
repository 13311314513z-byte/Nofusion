// Shared types for StyleManager and its tab sub-components

export interface PunctuationRhythm {
  readonly commaRatio: number;
  readonly periodRatio: number;
  readonly questionRatio: number;
  readonly exclamationRatio: number;
  readonly ellipsisRatio: number;
  readonly semicolonRatio: number;
}

export interface StyleFingerprint {
  readonly dialogueRatio: number;
  readonly actionDensity: number;
  readonly psychologicalRatio: number;
  readonly sensoryDensity: number;
  readonly colloquialismScore: number;
  readonly rhetoricDensity: number;
  readonly punctuationRhythm: PunctuationRhythm;
  readonly aiTellRisk: number;
  readonly sensoryBreakdown: {
    readonly visual: number;
    readonly auditory: number;
    readonly tactile: number;
    readonly olfactory: number;
    readonly gustatory: number;
  };
}

export interface CoreStyleProfile {
  readonly sourceName: string;
  readonly avgSentenceLength: number;
  readonly sentenceLengthStdDev: number;
  readonly avgParagraphLength: number;
  readonly vocabularyDiversity: number;
  readonly topPatterns: ReadonlyArray<string>;
  readonly rhetoricalFeatures: ReadonlyArray<string>;
  readonly fingerprint: StyleFingerprint;
}

export interface AuthorIndexItem {
  readonly id: string;
  readonly name: string;
  readonly language: "zh" | "en";
  readonly tags: ReadonlyArray<string>;
  readonly sourceCount: number;
  readonly updatedAt: string;
}

export interface AuthorProfile {
  readonly id: string;
  readonly name: string;
  readonly language: "zh" | "en";
  readonly tags: ReadonlyArray<string>;
  readonly sourceIds: ReadonlyArray<string>;
  readonly sampleStats: { readonly sourceCount: number; readonly totalChars: number; readonly avgCharsPerSource: number };
  readonly aggregateProfile: CoreStyleProfile;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sourceUrls?: ReadonlyArray<string>;
}

export interface AuthorDetail {
  readonly profile: AuthorProfile;
  readonly sources: ReadonlyArray<{
    readonly id: string;
    readonly fileName: string;
    readonly fileType: string;
    readonly charCount: number;
    readonly status: string;
    readonly error?: string;
  }>;
}

export interface ExtractedDoc {
  readonly sourceName?: string;
  readonly text: string;
  readonly charCount: number;
  readonly warnings: ReadonlyArray<string>;
  readonly truncated?: boolean;
  readonly totalChunks?: number;
  readonly chunkIndex?: number;
  readonly originalLength?: number;
}

export interface BookSummary {
  readonly id: string;
  readonly title: string;
}

// ---------------------------------------------------------------------------
// Unified source context — tracks where the analysis text came from
// ---------------------------------------------------------------------------

export type StyleSourceType = "manual" | "file" | "url" | "chapter" | "book-sample";

export interface StyleSourceContext {
  readonly sourceType: StyleSourceType;
  readonly sourceName: string;
  readonly bookId?: string;
  readonly chapterNumber?: number;
  readonly language: "zh" | "en";
}

// ---------------------------------------------------------------------------
// Analysis session — shared state across all analysis steps
// ---------------------------------------------------------------------------

export interface StyleAnalysisSession {
  readonly source: StyleSourceContext;
  readonly text: string;
  readonly sourceHash: string;
  readonly status: "idle" | "analyzing" | "ready" | "stale" | "error";
}

// ---------------------------------------------------------------------------
// Unified text range issue — used for precise positioning and highlighting
// ---------------------------------------------------------------------------

export interface TextRangeIssue {
  readonly id: string;
  readonly category: string;
  readonly severity: "high" | "medium" | "low" | "info";
  readonly start: number;
  readonly end: number;
  readonly message: string;
  readonly suggestion?: string;
}

export interface ChapterIndexEntry {
  readonly number: number;
  readonly title: string;
}

export interface ChapterIndex {
  readonly chapters: ReadonlyArray<ChapterIndexEntry>;
}
