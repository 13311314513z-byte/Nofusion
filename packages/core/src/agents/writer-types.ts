import type { BookConfig } from "../models/book.js";
import type { ChapterIntent, ChapterMemo, ContextPackage, RuleStack } from "../models/input-governance.js";
import type { LengthSpec } from "../models/length-governance.js";
import type { RuntimeStateDelta } from "../models/runtime-state.js";
import type { RuntimeStateSnapshot } from "../state/state-reducer.js";
import type { OpeningFrame, ClosingFrame, PathConstraints } from "../models/chapter-intent.schema.js";
import type { PostWriteViolation } from "./post-write-validator.js";

/** Legacy context budget limits for the legacy write path. */
export const LEGACY_WRITER_CONTEXT_BUDGET = {
  storyBible: 14_000,
  currentState: 7_000,
  ledger: 6_000,
  hooks: 9_000,
  chapterSummaries: 9_000,
  subplotBoard: 7_000,
  emotionalArcs: 7_000,
  characterMatrix: 12_000,
  parentCanon: 12_000,
  volumeOutline: 12_000,
} as const;

export interface WriteChapterInput {
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly externalContext?: string;
  readonly chapterIntent?: string;
  readonly chapterMemo?: ChapterMemo;
  readonly chapterIntentData?: ChapterIntent;
  readonly contextPackage?: ContextPackage;
  readonly ruleStack?: RuleStack;
  readonly lengthSpec?: LengthSpec;
  readonly wordCountOverride?: number;
  readonly temperatureOverride?: number;
  // ── Endpoint Lock (from AuthorChapterIntent) ──
  readonly openingFrame?: OpeningFrame;
  readonly closingFrame?: ClosingFrame;
  readonly pathConstraints?: PathConstraints;
}

export interface SettleChapterStateInput {
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly title: string;
  readonly content: string;
  readonly allowReapply?: boolean;
  readonly chapterIntent?: string;
  readonly contextPackage?: ContextPackage;
  readonly ruleStack?: RuleStack;
  readonly validationFeedback?: string;
}

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface WriteChapterOutput {
  readonly chapterNumber: number;
  readonly title: string;
  readonly content: string;
  readonly wordCount: number;
  readonly preWriteCheck: string;
  readonly postSettlement: string;
  readonly runtimeStateDelta?: RuntimeStateDelta;
  readonly runtimeStateSnapshot?: RuntimeStateSnapshot;
  readonly updatedState: string;
  readonly updatedLedger: string;
  readonly updatedHooks: string;
  readonly chapterSummary: string;
  readonly updatedChapterSummaries?: string;
  readonly updatedSubplots: string;
  readonly updatedEmotionalArcs: string;
  readonly updatedCharacterMatrix: string;
  readonly postWriteErrors: ReadonlyArray<PostWriteViolation>;
  readonly postWriteWarnings: ReadonlyArray<PostWriteViolation>;
  readonly hookHealthIssues?: ReadonlyArray<{
    readonly severity: "critical" | "warning" | "info";
    readonly category: string;
    readonly description: string;
    readonly suggestion: string;
  }>;
  readonly writerPromptHash?: string;
  readonly tokenUsage?: TokenUsage;
}
