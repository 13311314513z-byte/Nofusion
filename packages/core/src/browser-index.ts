/**
 * Browser-safe entry point for @actalk/inkos-core.
 *
 * Only exports pure computation functions and types that have NO server-side
 * dependencies (node:fs, node:path, node:http, etc.). This entry is safe to
 * import from browser bundles (Vite, etc.).
 *
 * Server-side modules (agents, pipeline, llm, interaction, state, config-loader)
 * are intentionally excluded — they belong in the main "." entry.
 */
export { detectDuplicateParagraphs, findDuplicateParagraphs, findSimilarParagraphs, type DuplicateParagraphGroup, type SimilarParagraphGroup, type DedupResult } from "./utils/paragraph-dedup.js";
export { computeReadabilityScore, type ReadabilityScore, type ReadabilityTrend } from "./utils/readability-score.js";
export { detectDuplicateRhetoric, type DuplicateRhetoricFinding, type DuplicateRhetoricResult, type RhetoricCategory } from "./utils/semantic-duplication.js";
export { preprocessText, exportPreprocessed, type PreprocessOptions, type PreprocessResult, type PreprocessExportFormat, type PreprocessExportResult } from "./utils/text-preprocessor.js";
export { relayoutText, type RelayoutOptions, type RelayoutResult } from "./utils/text-relayout.js";
export { analyzeAITells, type AITellResult, type AITellIssue } from "./agents/ai-tells.js";
export { countChapterLength, resolveLengthCountingMode, formatLengthCount, buildLengthSpec, isOutsideSoftRange, isOutsideHardRange, chooseNormalizeMode, type LengthLanguage } from "./utils/length-metrics.js";
export { splitChapters, type SplitChapter } from "./utils/chapter-splitter.js";
// NOTE: document-reader and document-writer are excluded from browser entry
// because they depend on node:fs / node:crypto / node:path.
// Studio should import them from the server entry or use file-based equivalents.
export { computeAnalytics, type AnalyticsData, type TokenStats } from "./utils/analytics.js";

// Types only — no runtime code
export type { StyleProfile, PunctuationRhythm, SensoryBreakdown } from "./models/style-profile.js";
export type { DetectionHistoryEntry, DetectionStats } from "./models/detection.js";
export type { LengthCountingMode, LengthNormalizeMode, LengthSpec, LengthTelemetry, LengthWarning } from "./models/length-governance.js";
export type { AuthorStyleProfile, StyleSourceDocument, StyleLibraryIndex, AuthorDistillation, DistillationRule, DistillationEvidence, DistillationStatus, SampleAdequacyLevel } from "./style-library/models.js";
export type { FullStyleDiagnostics } from "./index.js";
