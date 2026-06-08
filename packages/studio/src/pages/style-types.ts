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
  readonly sampleStats: { readonly sourceCount: number; readonly totalChars: number; readonly avgCharsPerSource: number };
  readonly aggregateProfile: CoreStyleProfile;
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
