import type { LLMClient, OnStreamProgress } from "../llm/provider.js";
import { chatCompletion, createLLMClient } from "../llm/provider.js";
import type { Logger } from "../utils/logger.js";
import type { BookConfig, FanficMode } from "../models/book.js";
import type { ChapterMeta } from "../models/chapter.js";
import type { NotifyChannel, LLMConfig, AgentLLMOverride, InputGovernanceMode } from "../models/project.js";
import type { GenreProfile } from "../models/genre-profile.js";
import { ArchitectAgent, type ArchitectOutput, type ArchitectRole } from "../agents/architect.js";
import {
  assembleFoundationContext,
  buildFoundationSourceBundle,
  persistFoundationSourceBundle,
  type FoundationSourceBundle,
  type FoundationSourceInput,
} from "../import/foundation-source.js";
import { FoundationReviewerAgent } from "../agents/foundation-reviewer.js";
import { PlannerAgent, type PlanChapterOutput } from "../agents/planner.js";
import { composeGovernedChapter, type ComposeChapterOutput } from "../agents/composer.js";
import { WriterAgent, type WriteChapterInput, type WriteChapterOutput } from "../agents/writer.js";
import { LengthNormalizerAgent } from "../agents/length-normalizer.js";
import { ChapterAnalyzerAgent } from "../agents/chapter-analyzer.js";
import { ContinuityAuditor } from "../agents/continuity.js";
import { ReviserAgent, DEFAULT_REVISE_MODE, type ReviseMode } from "../agents/reviser.js";
import { StateValidatorAgent, type ValidationResult, type ValidationWarning } from "../agents/state-validator.js";
import { RadarAgent } from "../agents/radar.js";
import type { RadarSource } from "../agents/radar-source.js";
import { readGenreProfile } from "../agents/rules-reader.js";
import { analyzeAITells } from "../agents/ai-tells.js";
import {
  loadChapterIntents,
  getChapterIntent,
  confirmChapterIntent,
  saveChapterIntents,
} from "../models/chapter-intent.js";
import { validateAuthorIntentInContent } from "../agents/post-write-validator.js";
import { BetaReader, type BetaReaderMode } from "../agents/beta-reader.js";
import { IssueNormalizer } from "../agents/issue-normalizer.js";
import { createIssue, hasAuditIssueParagraphLocation, resolveAuditIssue } from "../models/audit-issue.js";
import { checkPatchBoundary, issueLocationsToParagraphSet } from "../utils/patch-boundary.js";
import {
  loadIssueConsecutiveCounts,
  saveIssueConsecutiveCounts,
  updateConsecutiveCounts,
} from "../utils/issue-persistence.js";
import { anchorAuditIssues } from "../utils/location-anchor.js";
import {
  evaluateBetaReaderModelConstraint,
  persistBetaReaderShadow,
} from "../utils/beta-reader-runtime.js";
import { StateManager } from "../state/manager.js";
import {
  PipelineContext,
  type PipelineConfig,
} from "./context.js";
import { MemoryDB, tryCreateMemoryDB, type Fact } from "../state/memory-db.js";
import {
  reviseDraft as revisionReviseDraft,
  type ReviseDraftHost,
} from "./runner-revision.js";
import {
  syncCurrentStateFactHistory,
  syncNarrativeMemoryIndex,
  syncLegacyStructuredStateFromMarkdown,
  rebuildCurrentStateFactHistory,
  rebuildNarrativeMemoryIndex,
  canOpenMemoryIndex,
  logMemoryIndexDebugInfo,
  withMemoryIndexRetry,
  isMemoryIndexUnavailableError,
  isMemoryIndexBusyError,
  factKey,
  type MemoryIndexDeps,
} from "./runner-memory-index.js";
import { dispatchNotification, dispatchWebhookEvent } from "../notify/dispatcher.js";
import { logPlanGenerated, logChapterWritten, logAuditCompleted } from "../utils/state-logger.js";
import type { WebhookEvent } from "../notify/webhook.js";
import type { AgentContext } from "../agents/base.js";
import type { AuditResult, AuditIssue } from "../agents/continuity.js";
import type { RadarResult } from "../agents/radar.js";
import type { LengthSpec, LengthTelemetry } from "../models/length-governance.js";
import type { ChapterMemo, ContextPackage, RuleStack } from "../models/input-governance.js";
import { buildLengthSpec, countChapterLength, formatLengthCount, isOutsideHardRange, resolveLengthCountingMode, type LengthLanguage } from "../utils/length-metrics.js";
import { analyzeLongSpanFatigue } from "../utils/long-span-fatigue.js";
import { buildWritingMethodologySection } from "../utils/writing-methodology.js";
import {
  readCharacterContext,
  readStoryFrame,
  readVolumeMap,
} from "../utils/outline-paths.js";
import { loadNarrativeMemorySeed, loadSnapshotCurrentStateFacts } from "../state/runtime-state-store.js";
import { rewriteStructuredStateFromMarkdown } from "../state/state-bootstrap.js";
import { readFile, readdir, writeFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  parseStateDegradedReviewNote,
  resolveStateDegradedBaseStatus,
  retrySettlementAfterValidationFailure,
} from "./chapter-state-recovery.js";
import { persistChapterArtifacts } from "./chapter-persistence.js";
import { runChapterReviewCycle } from "./chapter-review-cycle.js";
import {
  importCanon as importCanonFn,
  importChapters as importChaptersFn,
  type ImportHost,
} from "./runner-import.js";
import {
  generateStyleGuide as generateStyleGuideFn,
  tryGenerateStyleGuide as tryGenerateStyleGuideFn,
  buildDeterministicStyleGuide,
  type StyleGuideHost,
} from "./runner-style-guide.js";
import {
  assertChapterContentNotEmpty,
  buildLengthWarnings as buildLengthWarningsFn,
  buildLengthTelemetry as buildLengthTelemetryFn,
  logLengthWarnings as logLengthWarningsFn,
  normalizeDraftLengthIfNeeded as normalizeDraftLengthIfNeededFn,
  persistAuditDriftGuidance as persistAuditDriftGuidanceFn,
  emitWebhook as emitWebhookFn,
  type UtilsHost,
} from "./runner-utils.js";
import {
  stripAuditDriftCorrectionBlock,
  restoreLostAuditIssues,
  restoreActionableAuditIfLost,
  type MergedAuditEvaluation,
} from "./audit-helpers.js";
import { validateChapterTruthPersistence } from "./chapter-truth-validation.js";
import { loadPersistedPlan, relativeToBookDir, savePersistedPlan } from "./persisted-governed-plan.js";
import {
  readTruthFilesFromCtx,
  getBookStatusFromCtx,
  type TruthFiles as PipelineTruthFiles,
  type BookStatusResult,
} from "./pipeline-book-status.js";

const SEQUENCE_LEVEL_CATEGORIES = new Set([
  "Pacing Monotony", "节奏单调",
  "Mood Monotony", "情绪单调",
  "Title Collapse", "标题重复",
  "Title Clustering", "标题聚集",
  "Opening Pattern Repetition", "开头同构",
  "Ending Pattern Repetition", "结尾同构",
]);

function isSequenceLevelCategory(category: string): boolean {
  return SEQUENCE_LEVEL_CATEGORIES.has(category);
}

interface ImportFoundationSourceOptions {
  readonly maxFullTextChars?: number;
  readonly chapterExcerptChars?: number;
  readonly titleCatalogChars?: number;
  readonly edgeChapterCount?: number;
  readonly middleAnchorCount?: number;
}

const DEFAULT_IMPORT_FOUNDATION_MAX_FULL_TEXT_CHARS = 80_000;
const DEFAULT_IMPORT_CHAPTER_EXCERPT_CHARS = 6_000;
const DEFAULT_IMPORT_TITLE_CATALOG_CHARS = 24_000;
const DEFAULT_IMPORT_EDGE_CHAPTER_COUNT = 4;
const DEFAULT_IMPORT_MIDDLE_ANCHOR_COUNT = 8;

function formatImportedChapter(
  chapter: { readonly title: string; readonly content: string },
  index: number,
  language: LengthLanguage,
  content = chapter.content,
): string {
  return language === "en"
    ? `Chapter ${index + 1}: ${chapter.title}\n\n${content}`
    : `第${index + 1}章 ${chapter.title}\n\n${content}`;
}

function estimateImportFullTextLength(
  chapters: ReadonlyArray<{ readonly title: string; readonly content: string }>,
): number {
  return chapters.reduce((total, chapter) => total + chapter.title.length + chapter.content.length + 24, 0);
}

function excerptHeadTail(text: string, maxChars: number, language: LengthLanguage): string {
  const clean = text.trim();
  if (clean.length <= maxChars) return clean;
  const headChars = Math.max(200, Math.floor(maxChars * 0.6));
  const tailChars = Math.max(200, maxChars - headChars);
  const omitted = clean.length - headChars - tailChars;
  const marker = language === "en"
    ? `\n\n[... ${omitted} chars omitted for import-context budget ...]\n\n`
    : `\n\n【中间省略 ${omitted} 字，用于控制导入上下文预算】\n\n`;
  return `${clean.slice(0, headChars).trimEnd()}${marker}${clean.slice(-tailChars).trimStart()}`;
}

function pickImportAnchorIndexes(
  chapterCount: number,
  edgeChapterCount: number,
  middleAnchorCount: number,
): ReadonlyArray<number> {
  const selected = new Set<number>();
  for (let i = 0; i < Math.min(edgeChapterCount, chapterCount); i++) selected.add(i);
  for (let i = Math.max(0, chapterCount - edgeChapterCount); i < chapterCount; i++) selected.add(i);

  const middleStart = Math.min(edgeChapterCount, chapterCount);
  const middleEnd = Math.max(middleStart, chapterCount - edgeChapterCount);
  const middleSize = middleEnd - middleStart;
  const anchors = Math.min(middleAnchorCount, middleSize);
  for (let i = 0; i < anchors; i++) {
    const offset = Math.floor(((i + 1) * middleSize) / (anchors + 1));
    selected.add(Math.min(chapterCount - 1, middleStart + offset));
  }

  return [...selected].sort((a, b) => a - b);
}

function buildTitleCatalog(
  chapters: ReadonlyArray<{ readonly title: string; readonly content: string }>,
  language: LengthLanguage,
  maxChars: number,
): string {
  const lines = chapters.map((chapter, index) =>
    language === "en"
      ? `- Chapter ${index + 1}: ${chapter.title} (${chapter.content.length} chars)`
      : `- 第${index + 1}章：${chapter.title}（${chapter.content.length}字）`,
  );
  const joined = lines.join("\n");
  if (joined.length <= maxChars) return joined;

  const headBudget = Math.floor(maxChars * 0.55);
  const tailBudget = maxChars - headBudget;
  const head: string[] = [];
  const tail: string[] = [];
  let headChars = 0;
  let tailChars = 0;
  for (const line of lines) {
    if (headChars + line.length + 1 > headBudget) break;
    head.push(line);
    headChars += line.length + 1;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (tailChars + line.length + 1 > tailBudget) break;
    tail.unshift(line);
    tailChars += line.length + 1;
  }
  const omitted = lines.length - head.length - tail.length;
  const marker = language === "en"
    ? `- ... ${omitted} chapter titles omitted ...`
    : `- ……中间 ${omitted} 个章节标题省略……`;
  return [...head, marker, ...tail].join("\n");
}

export function buildImportFoundationSource(
  chapters: ReadonlyArray<{ readonly title: string; readonly content: string }>,
  language: LengthLanguage,
  options: ImportFoundationSourceOptions = {},
): string {
  const maxFullTextChars = options.maxFullTextChars ?? DEFAULT_IMPORT_FOUNDATION_MAX_FULL_TEXT_CHARS;
  const chapterExcerptChars = options.chapterExcerptChars ?? DEFAULT_IMPORT_CHAPTER_EXCERPT_CHARS;
  const titleCatalogChars = options.titleCatalogChars ?? DEFAULT_IMPORT_TITLE_CATALOG_CHARS;
  const edgeChapterCount = options.edgeChapterCount ?? DEFAULT_IMPORT_EDGE_CHAPTER_COUNT;
  const middleAnchorCount = options.middleAnchorCount ?? DEFAULT_IMPORT_MIDDLE_ANCHOR_COUNT;

  if (estimateImportFullTextLength(chapters) <= maxFullTextChars) {
    return chapters.map((chapter, index) => formatImportedChapter(chapter, index, language)).join("\n\n---\n\n");
  }

  const anchorIndexes = pickImportAnchorIndexes(chapters.length, edgeChapterCount, middleAnchorCount);
  const header = language === "en"
    ? [
        "## Import foundation source package",
        "",
        `The imported book has ${chapters.length} chapters. To avoid overflowing the LLM context, this package keeps the opening chapters, ending/continuation point, selected middle anchors, and a capped title catalog. Full chapters will still be replayed sequentially after foundation generation to rebuild truth files.`,
      ].join("\n")
    : [
        "## 导入基础设定压缩资料包",
        "",
        `本次导入共 ${chapters.length} 章。为避免超出 LLM 上下文，这里保留开篇、结尾续写点、少量中段锚点和标题目录；完整章节将在后续顺序回放中逐章分析并沉淀 truth files。`,
      ].join("\n");
  const catalogTitle = language === "en" ? "## Capped chapter title catalog" : "## 章节标题目录（截断）";
  const anchorsTitle = language === "en" ? "## Source excerpts for architecture" : "## 用于反推基础设定的正文摘录";
  const anchorText = anchorIndexes
    .map((index) => {
      const chapter = chapters[index]!;
      return formatImportedChapter(
        chapter,
        index,
        language,
        excerptHeadTail(chapter.content, chapterExcerptChars, language),
      );
    })
    .join("\n\n---\n\n");

  return [
    header,
    "",
    catalogTitle,
    buildTitleCatalog(chapters, language, titleCatalogChars),
    "",
    anchorsTitle,
    anchorText,
  ].join("\n");
}

export type { PipelineConfig } from "./context.js";
export { PipelineContext } from "./context.js";
import {
  initBook as foundationInitBook,
  reviseFoundation as foundationReviseFoundation,
  generateAndReviewFoundation,
  buildFoundationReviewFeedback,
  assertValidArchitectOutput,
  getFoundationRevision,
  copyDirShallow,
  copyDirRecursive,
} from "./pipeline-foundation.js";
import { evaluateMergedAudit } from "./pipeline-audit.js";
import { importFanficCanon as fanficImportCanon } from "./pipeline-fanfic.js";
import { repairChapterStateLocked, resyncChapterArtifactsLocked } from "./pipeline-revision.js";
import { writeNextChapterLocked } from "./pipeline-writing.js";
import { planFoundationImport as planImport, commitFoundationImport as commitImport } from "./pipeline-import.js";
import type { TokenUsageSummary, ChapterPipelineResult, DraftResult, PlanChapterResult } from "./pipeline-types.js";

export type { TokenUsageSummary, ChapterPipelineResult, DraftResult, PlanChapterResult } from "./pipeline-types.js";

export interface ComposeChapterResult extends PlanChapterResult {
  readonly contextPath: string;
  readonly ruleStackPath: string;
  readonly tracePath: string;
}

export interface ReviseResult {
  readonly chapterNumber: number;
  readonly wordCount: number;
  readonly fixedIssues: ReadonlyArray<string>;
  readonly applied: boolean;
  readonly status: "unchanged" | "ready-for-review" | "audit-failed";
  readonly skippedReason?: string;
  readonly lengthWarnings?: ReadonlyArray<string>;
  readonly lengthTelemetry?: LengthTelemetry;
}

export interface TruthFiles {
  readonly currentState: string;
  readonly particleLedger: string;
  readonly pendingHooks: string;
  readonly storyBible: string;
  readonly volumeOutline: string;
  readonly bookRules: string;
}

export interface BookStatusInfo {
  readonly bookId: string;
  readonly title: string;
  readonly genre: string;
  readonly platform: string;
  readonly status: string;
  readonly chaptersWritten: number;
  readonly totalWords: number;
  readonly nextChapter: number;
  readonly chapters: ReadonlyArray<ChapterMeta>;
}

export interface ImportChaptersInput {
  readonly bookId: string;
  readonly chapters: ReadonlyArray<{
    readonly title: string;
    readonly content: string;
    /** Optional target chapter number from the import plan. If omitted, sequential numbering starts from resumeFrom. */
    readonly targetNumber?: number;
  }>;
  readonly resumeFrom?: number;
  /** "continuation" (default) = pick up where the text left off, no new spacetime.
   *  "series" = shared universe but independent new story, requires new spacetime. */
  readonly importMode?: "continuation" | "series";
}

export interface ImportChaptersResult {
  readonly bookId: string;
  readonly importedCount: number;
  readonly totalWords: number;
  readonly nextChapter: number;
}

export interface InitBookOptions {
  readonly externalContext?: string;
  readonly authorIntent?: string;
  readonly currentFocus?: string;
  readonly sourceBundle?: FoundationSourceBundle;
}

export class PipelineRunner {
  /** Shared pipeline context — can be injected for testability or shared across runners. */
  readonly ctx: PipelineContext;

  constructor(config: PipelineConfig, ctx?: PipelineContext) {
    if (ctx && ctx.config.projectRoot !== config.projectRoot) {
      throw new Error(
        `PipelineRunner: injected context projectRoot (${ctx.config.projectRoot}) does not match config projectRoot (${config.projectRoot})`,
      );
    }
    this.ctx = ctx ?? new PipelineContext(config);
  }

  // ─── Delegated properties (backward compat) ────────────────────────────────
  private get state(): StateManager { return this.ctx.state; }
  private get config(): PipelineConfig { return this.ctx.config; }
  private get agentClients(): Map<string, { client: LLMClient; cachedAt: number }> { return this.ctx.agentClients; }
  private get chapterContentCache(): Map<string, string> { return this.ctx.chapterContentCache; }
  private get memoryIndexFallbackWarned(): boolean { return this.ctx.memoryIndexFallbackWarned; }
  private set memoryIndexFallbackWarned(v: boolean) { this.ctx.memoryIndexFallbackWarned = v; }

  dispose(): void { this.ctx.dispose(); }

  /** Reset transient per-write state so the runner can be reused by PipelinePool. */
  resetForReuse(): void { this.ctx.resetForReuse(); }
  private setAgentClient(k: string, c: LLMClient): void { this.ctx.setAgentClient(k, c); }

  private localize(language: LengthLanguage, messages: { zh: string; en: string }): string {
    return language === "en" ? messages.en : messages.zh;
  }

  private async resolveBookLanguage(
    book: Pick<BookConfig, "genre" | "language">,
  ): Promise<LengthLanguage> {
    if (book.language) {
      return book.language;
    }

    try {
      const { profile } = await this.loadGenreProfile(book.genre);
      return profile.language;
    } catch {
      return "zh";
    }
  }

  private async resolveBookLanguageById(bookId: string): Promise<LengthLanguage> {
    try {
      const book = await this.state.loadBookConfig(bookId);
      return await this.resolveBookLanguage(book);
    } catch {
      return "zh";
    }
  }

  private languageFromLengthSpec(lengthSpec: Pick<LengthSpec, "countingMode">): LengthLanguage {
    return lengthSpec.countingMode === "en_words" ? "en" : "zh";
  }

  private logStage(language: LengthLanguage, message: { zh: string; en: string }): void {
    this.config.logger?.info(
      `${this.localize(language, { zh: "阶段：", en: "Stage: " })}${this.localize(language, message)}`,
    );
  }

  private logInfo(language: LengthLanguage, message: { zh: string; en: string }): void {
    this.config.logger?.info(this.localize(language, message));
  }

  private logWarn(language: LengthLanguage, message: { zh: string; en: string }): void {
    this.config.logger?.warn(this.localize(language, message));
  }

  private async tryGenerateStyleGuide(
    bookId: string,
    referenceText: string,
    sourceName: string | undefined,
    language?: LengthLanguage,
  ): Promise<void> {
    return tryGenerateStyleGuideFn(this as any as StyleGuideHost, bookId, referenceText, sourceName, language);
  }

  private async generateAndReviewFoundation(params: Parameters<typeof generateAndReviewFoundation>[4]): Promise<ArchitectOutput> {
    return generateAndReviewFoundation(this.ctx, this.resolveBookLanguage.bind(this), this.logStage.bind(this), this.logWarn.bind(this), params);
  }

  private buildFoundationReviewFeedback(
    review: Parameters<typeof buildFoundationReviewFeedback>[0],
    language: Parameters<typeof buildFoundationReviewFeedback>[1],
  ): string {
    return buildFoundationReviewFeedback(review, language);
  }

  private agentCtx(bookId?: string): AgentContext { return this.ctx.agentCtx(bookId); }
  private resolveOverride(agentName: string): { model: string; client: LLMClient } { return this.ctx.resolveOverride(agentName); }
  private agentCtxFor(agent: string, bookId?: string): AgentContext { return this.ctx.agentCtxFor(agent, bookId); }
  public createAgentContext(agent: string, bookId?: string): AgentContext { return this.ctx.agentCtxFor(agent, bookId); }
  private async pathExists(path: string): Promise<boolean> { return this.ctx.pathExists(path); }

  private async loadGenreProfile(genre: string): Promise<{ profile: GenreProfile }> {
    const parsed = await readGenreProfile(this.config.projectRoot, genre);
    return { profile: parsed.profile };
  }

  // ---------------------------------------------------------------------------
  // Atomic operations (composable by OpenClaw or agent mode)
  // ---------------------------------------------------------------------------

  async runRadar(): Promise<RadarResult> {
    const radar = new RadarAgent(this.agentCtxFor("radar"), this.config.radarSources);
    return radar.scan();
  }

  async initBook(book: BookConfig, options: InitBookOptions = {}): Promise<void> {
    return foundationInitBook(this.ctx, this.resolveBookLanguage.bind(this), this.logStage.bind(this), book, options);
  }

  /**
   * Revise an existing book foundation without touching runtime chapter state.
   *
   * Legacy books read the flat foundation files as source. Phase 5+ books read
   * the authoritative outline/ and roles/ files instead of the compatibility
   * shims, otherwise large role/story details can be lost during rewrite.
   */
  async reviseFoundation(bookId: string, feedback: string): Promise<void> {
    return foundationReviseFoundation(this.ctx, bookId, feedback);
  }

  private async copyDirShallow(src: string, dest: string): Promise<void> { return copyDirShallow(src, dest); }
  private async copyDirRecursive(src: string, dest: string): Promise<void> { return copyDirRecursive(src, dest); }

  /** Import external source material and generate fanfic_canon.md — delegated to pipeline-fanfic.ts */
  async importFanficCanon(
    bookId: string,
    sourceText: string,
    sourceName: string,
    fanficMode: FanficMode,
  ): Promise<string> {
    return fanficImportCanon(this.ctx, bookId, sourceText, sourceName, fanficMode);
  }

  // ---------------------------------------------------------------------------
  // Foundation Import (plan / commit)
  // ---------------------------------------------------------------------------

  /**
   * Plan a foundation import — build source bundle, call Architect, return
   * a preview of changes WITHOUT writing anything to disk.
   */
  async planFoundationImport(
    bookId: string,
    inputs: ReadonlyArray<FoundationSourceInput>,
    options?: { mode?: "supplement" | "rebuild"; instruction?: string },
  ): Promise<{
    bundle: FoundationSourceBundle;
    proposed?: ArchitectOutput;
    foundationRevision?: string;
    warnings: string[];
    roleChanges?: { added: string[]; updated: string[]; removed: string[] };
  }> {
    return planImport(this.ctx, bookId, inputs, options, {
      loadBookConfig: (id) => this.state.loadBookConfig(id),
      bookDir: (id) => this.state.bookDir(id),
      loadGenreProfile: this.loadGenreProfile.bind(this),
      scanExistingRoles: this.scanExistingRoles.bind(this),
      computeRoleChanges: this.computeRoleChanges.bind(this),
    });
  }

  /**
   * Commit a previously planned foundation import — backup, then write files.
   */
  async commitFoundationImport(
    bookId: string,
    proposed: ArchitectOutput,
    options?: { mode?: "supplement" | "rebuild"; expectedRevision?: string; sourceBundle?: FoundationSourceBundle },
  ): Promise<void> {
    return commitImport(this.ctx, bookId, proposed, options, {
      loadBookConfig: (id) => this.state.loadBookConfig(id),
      bookDir: (id) => this.state.bookDir(id),
      loadGenreProfile: this.loadGenreProfile.bind(this),
      scanExistingRoles: this.scanExistingRoles.bind(this),
      computeRoleChanges: this.computeRoleChanges.bind(this),
    });
  }

  /** Scan existing role files and return their names */
  private async scanExistingRoles(bookDir: string): Promise<string[]> {
    const storyDir = join(bookDir, "story");
    const rolesDirs = [
      join(storyDir, "roles", "主要角色"),
      join(storyDir, "roles", "次要角色"),
      join(storyDir, "roles", "核心角色"),
      join(storyDir, "roles", "功能角色"),
      join(storyDir, "roles", "重要角色"),
      join(storyDir, "roles", "major"),
      join(storyDir, "roles", "minor"),
      join(storyDir, "roles", "core"),
      join(storyDir, "roles", "functional"),
    ];
    // P1-9: parallelize directory reads
    const results = await Promise.all(
      rolesDirs.map(async (dir) => {
        try {
          const entries = await readdir(dir);
          return entries.filter((e) => e.endsWith(".md")).map((e) => e.replace(/\.md$/, ""));
        } catch {
          return [] as string[];
        }
      }),
    );
    return results.flat();
  }

  /** Compute role changes between existing and proposed */
  private computeRoleChanges(
    existing: string[],
    proposed: ReadonlyArray<ArchitectRole>,
    mode: "supplement" | "rebuild",
  ): { added: string[]; updated: string[]; removed: string[] } {
    const proposedNames = new Set(proposed.map((r) => r.name));
    const existingSet = new Set(existing);

    const added = proposed.filter((r) => !existingSet.has(r.name)).map((r) => r.name);
    const updated = proposed.filter((r) => existingSet.has(r.name)).map((r) => r.name);
    const removed = mode === "rebuild"
      ? existing.filter((name) => !proposedNames.has(name))
      : []; // supplement mode keeps all existing roles

    return { added, updated, removed };
  }

  async getFoundationRevision(bookId: string): Promise<string> {
    return getFoundationRevision(this.ctx, bookId);
  }

  private assertValidArchitectOutput(output: ArchitectOutput): void {
    return assertValidArchitectOutput(output);
  }

  /** One-step fanfic book creation: create book + import canon + generate foundation */
  async initFanficBook(
    book: BookConfig,
    sourceText: string,
    sourceName: string,
    fanficMode: FanficMode,
  ): Promise<void> {
    const bookDir = this.state.bookDir(book.id);
    const stageLanguage = await this.resolveBookLanguage(book);

    this.logStage(stageLanguage, { zh: "保存书籍配置", en: "saving book config" });
    await this.state.saveBookConfig(book.id, book);

    // Step 1: Import source material → fanfic_canon.md
    this.logStage(stageLanguage, { zh: "导入同人正典", en: "importing fanfic canon" });
    const fanficCanon = await this.importFanficCanon(book.id, sourceText, sourceName, fanficMode);

    // Step 2: Generate foundation with review loop
    const architect = new ArchitectAgent(this.agentCtxFor("architect", book.id));
    const reviewer = new FoundationReviewerAgent(this.agentCtxFor("foundation-reviewer", book.id));
    this.logStage(stageLanguage, { zh: "生成同人基础设定", en: "generating fanfic foundation" });
    const { profile: gp } = await this.loadGenreProfile(book.genre);
    const resolvedLanguage = (book.language ?? gp.language) === "en" ? "en" as const : "zh" as const;
    const foundation = await this.generateAndReviewFoundation({
      generate: (reviewFeedback) => architect.generateFanficFoundation(
        book,
        fanficCanon,
        fanficMode,
        reviewFeedback,
      ),
      reviewer,
      mode: "fanfic",
      sourceCanon: fanficCanon,
      language: resolvedLanguage,
      stageLanguage,
    });
    this.logStage(stageLanguage, { zh: "写入基础设定文件", en: "writing foundation files" });
    await architect.writeFoundationFiles(
      bookDir,
      foundation,
      gp.numericalSystem,
      book.language ?? gp.language,
    );
    this.logStage(stageLanguage, { zh: "初始化控制文档", en: "initializing control documents" });
    await this.state.ensureControlDocuments(book.id, this.config.externalContext);

    // Step 3: Generate style guide from source material
    if (sourceText.length >= 500) {
      this.logStage(stageLanguage, { zh: "提取原作风格指纹", en: "extracting source style fingerprint" });
      await this.tryGenerateStyleGuide(book.id, sourceText, sourceName, stageLanguage);
    }

    // Step 4: Initialize chapters directory + snapshot
    this.logStage(stageLanguage, { zh: "创建初始快照", en: "creating initial snapshot" });
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await this.state.saveChapterIndex(book.id, []);
    await this.state.snapshotState(book.id, 0);
  }

  /** Write a single draft chapter. Saves chapter file + truth files + index + snapshot. */
  async writeDraft(bookId: string, context?: string, wordCount?: number): Promise<DraftResult> {
    const releaseLock = await this.state.acquireBookLock(bookId);
    try {
      await this.state.ensureControlDocuments(bookId);
      const book = await this.state.loadBookConfig(bookId);
      const bookDir = this.state.bookDir(bookId);
      const chapterNumber = await this.state.getNextChapterNumber(bookId);
      const stageLanguage = await this.resolveBookLanguage(book);
      this.logStage(stageLanguage, { zh: "准备章节输入", en: "preparing chapter inputs" });
      const writeInput = await this.prepareWriteInput(
        book,
        bookDir,
        chapterNumber,
        context ?? this.config.externalContext,
      );

      const { profile: gp } = await this.loadGenreProfile(book.genre);
      const lengthSpec = buildLengthSpec(
        wordCount ?? book.chapterWordCount,
        book.language ?? gp.language,
      );

      const writer = new WriterAgent(this.agentCtxFor("writer", bookId));
      this.logStage(stageLanguage, { zh: "撰写章节草稿", en: "writing chapter draft" });
      const output = await writer.writeChapter({
        book,
        bookDir,
        chapterNumber,
        ...writeInput,
        lengthSpec,
        ...(wordCount ? { wordCountOverride: wordCount } : {}),
      });
      const writerCount = countChapterLength(output.content, lengthSpec.countingMode);
      let totalUsage: TokenUsageSummary = output.tokenUsage ?? {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };
      const normalizedDraft = await this.normalizeDraftLengthIfNeeded({
        bookId,
        chapterNumber,
        chapterContent: output.content,
        lengthSpec,
        chapterIntent: writeInput.chapterIntent,
      });
      totalUsage = PipelineRunner.addUsage(totalUsage, normalizedDraft.tokenUsage);
      const draftOutput: WriteChapterOutput = {
        ...output,
        content: normalizedDraft.content,
        wordCount: normalizedDraft.wordCount,
        tokenUsage: totalUsage,
      };
      const lengthWarnings = this.buildLengthWarnings(
        chapterNumber,
        draftOutput.wordCount,
        lengthSpec,
      );
      const lengthTelemetry = this.buildLengthTelemetry({
        lengthSpec,
        writerCount,
        postWriterNormalizeCount: normalizedDraft.wordCount,
        postReviseCount: 0,
        finalCount: draftOutput.wordCount,
        normalizeApplied: normalizedDraft.applied,
        lengthWarning: lengthWarnings.length > 0,
      });
      this.logLengthWarnings(lengthWarnings);

      // Save chapter file
      const chaptersDir = join(bookDir, "chapters");
      const paddedNum = String(chapterNumber).padStart(4, "0");
      const sanitized = draftOutput.title.replace(/[/\\?%*:|"<>]/g, "").replace(/\s+/g, "_").slice(0, 50);
      const filename = `${paddedNum}_${sanitized}.md`;
      const filePath = join(chaptersDir, filename);

      const resolvedLang = book.language ?? gp.language;
      const heading = resolvedLang === "en"
        ? `# Chapter ${chapterNumber}: ${draftOutput.title}`
        : `# 第${chapterNumber}章 ${draftOutput.title}`;
      await writeFile(filePath, `${heading}\n\n${draftOutput.content}`, "utf-8");

      // Save truth files
      this.logStage(stageLanguage, { zh: "落盘草稿与真相文件", en: "persisting draft and truth files" });
      await writer.saveChapter(bookDir, draftOutput, gp.numericalSystem, resolvedLang);
      await writer.saveNewTruthFiles(bookDir, draftOutput, resolvedLang);
      await this.syncLegacyStructuredStateFromMarkdown(bookDir, chapterNumber, draftOutput);
      await this.syncNarrativeMemoryIndex(bookId);

      // Update index
      const existingIndex = await this.state.loadChapterIndex(bookId);
      const now = new Date().toISOString();
      const newEntry: ChapterMeta = {
        number: chapterNumber,
        title: draftOutput.title,
        status: "drafted",
        wordCount: draftOutput.wordCount,
        createdAt: now,
        updatedAt: now,
        auditIssues: [],
        lengthWarnings,
        lengthTelemetry,
        ...(draftOutput.tokenUsage ? { tokenUsage: draftOutput.tokenUsage } : {}),
      };
      const existingIdx = existingIndex.findIndex((e) => e.number === chapterNumber);
      const updatedIndex = existingIdx >= 0
        ? existingIndex.map((e, i) => i === existingIdx ? newEntry : e)
        : [...existingIndex, newEntry];
      await this.state.saveChapterIndex(bookId, updatedIndex);
      await this.markBookActiveIfNeeded(bookId);

      // Snapshot
      this.logStage(stageLanguage, { zh: "更新章节索引与快照", en: "updating chapter index and snapshots" });
      await this.state.snapshotState(bookId, chapterNumber);
      await this.syncCurrentStateFactHistory(bookId, chapterNumber);

      await this.emitWebhook("chapter-complete", bookId, chapterNumber, {
        title: draftOutput.title,
        wordCount: draftOutput.wordCount,
      });

      // M10: Log chapter written for state audit trail
      logChapterWritten(bookDir, chapterNumber, {
        wordCount: draftOutput.wordCount,
        title: draftOutput.title,
      }).catch(() => { /* best-effort */ });

      return {
        chapterNumber,
        title: draftOutput.title,
        wordCount: draftOutput.wordCount,
        filePath,
        lengthWarnings,
        lengthTelemetry,
        tokenUsage: draftOutput.tokenUsage,
      };
    } finally {
      await releaseLock();
    }
  }

  async planChapter(bookId: string, context?: string): Promise<PlanChapterResult> {
    await this.state.ensureControlDocuments(bookId);
    const book = await this.state.loadBookConfig(bookId);
    const bookDir = this.state.bookDir(bookId);
    const chapterNumber = await this.state.getNextChapterNumber(bookId);
    const stageLanguage = await this.resolveBookLanguage(book);
    this.logStage(stageLanguage, { zh: "规划下一章意图", en: "planning next chapter intent" });
    const { plan } = await this.createGovernedArtifacts(
      book,
      bookDir,
      chapterNumber,
      context ?? this.config.externalContext,
      { reuseExistingIntentWhenContextMissing: false },
    );

    return {
      bookId,
      chapterNumber,
      intentPath: relativeToBookDir(bookDir, plan.runtimePath),
      goal: plan.intent.goal,
      conflicts: [],
    };
  }

  async composeChapter(bookId: string, context?: string): Promise<ComposeChapterResult> {
    await this.state.ensureControlDocuments(bookId);
    const book = await this.state.loadBookConfig(bookId);
    const bookDir = this.state.bookDir(bookId);
    const chapterNumber = await this.state.getNextChapterNumber(bookId);
    const stageLanguage = await this.resolveBookLanguage(book);
    this.logStage(stageLanguage, { zh: "组装章节运行时上下文", en: "composing chapter runtime context" });
    const { plan, composed } = await this.createGovernedArtifacts(
      book,
      bookDir,
      chapterNumber,
      context ?? this.config.externalContext,
      { reuseExistingIntentWhenContextMissing: true },
    );

    return {
      bookId,
      chapterNumber,
      intentPath: relativeToBookDir(bookDir, plan.runtimePath),
      goal: plan.intent.goal,
      conflicts: [],
      contextPath: relativeToBookDir(bookDir, composed.contextPath),
      ruleStackPath: relativeToBookDir(bookDir, composed.ruleStackPath),
      tracePath: relativeToBookDir(bookDir, composed.tracePath),
    };
  }

  /** Audit the latest (or specified) chapter. Read-only, no lock needed. */
  async auditDraft(bookId: string, chapterNumber?: number): Promise<AuditResult & { readonly chapterNumber: number }> {
    const book = await this.state.loadBookConfig(bookId);
    const bookDir = this.state.bookDir(bookId);
    const targetChapter = chapterNumber ?? (await this.state.getNextChapterNumber(bookId)) - 1;
    if (targetChapter < 1) {
      throw new Error(`No chapters to audit for "${bookId}"`);
    }

    const content = await this.readChapterContent(bookDir, targetChapter);
    const auditor = new ContinuityAuditor(this.agentCtxFor("auditor", bookId));
    const { profile: gp } = await this.loadGenreProfile(book.genre);
    const language = book.language ?? gp.language;
    this.logStage(language, {
      zh: `审计第${targetChapter}章`,
      en: `auditing chapter ${targetChapter}`,
    });
    const evaluation = await this.evaluateMergedAudit({
      auditor,
      book,
      bookDir,
      chapterContent: content,
      chapterNumber: targetChapter,
      language,
    });
    const result = evaluation.auditResult;

    // Update index with audit result
    const index = await this.state.loadChapterIndex(bookId);
    const updated = index.map((ch) =>
      ch.number === targetChapter
        ? {
            ...ch,
            status: (result.passed ? "ready-for-review" : "audit-failed") as ChapterMeta["status"],
            updatedAt: new Date().toISOString(),
            auditIssues: result.issues.map((i) => `[${i.severity}] ${i.description}`),
          }
        : ch,
    );
    await this.state.saveChapterIndex(bookId, updated);
    const latestChapter = index.length > 0 ? Math.max(...index.map((chapter) => chapter.number)) : targetChapter;
    if (targetChapter === latestChapter) {
      await this.persistAuditDriftGuidance({
        bookDir,
        chapterNumber: targetChapter,
        issues: result.issues.filter((issue) => issue.severity === "critical" || issue.severity === "warning"),
        language,
      }).catch(() => undefined);
    }

    await this.emitWebhook(
      result.passed ? "audit-passed" : "audit-failed",
      bookId,
      targetChapter,
      { summary: result.summary, issueCount: result.issues.length },
    );

    // M10: Log audit completed for state audit trail
    logAuditCompleted(bookDir, targetChapter, {
      passed: result.passed,
      issueCount: result.issues.length,
      criticalCount: result.issues.filter((i) => i.severity === "critical").length,
      summary: result.summary,
    }).catch(() => { /* best-effort */ });

    return { ...result, chapterNumber: targetChapter };
  }

  /** Revise the latest (or specified) chapter based on audit issues. */
  async reviseDraft(bookId: string, chapterNumber?: number, mode: ReviseMode = DEFAULT_REVISE_MODE): Promise<ReviseResult> {
    const host: ReviseDraftHost = {
      state: {
        acquireBookLock: (id) => this.state.acquireBookLock(id),
        loadBookConfig: (id) => this.state.loadBookConfig(id),
        bookDir: (id) => this.state.bookDir(id),
        getNextChapterNumber: (id) => this.state.getNextChapterNumber(id),
        loadChapterIndex: (id) => this.state.loadChapterIndex(id),
        saveChapterIndex: (id, index) => this.state.saveChapterIndex(id, index),
        snapshotState: (id, chapter) => this.state.snapshotState(id, chapter),
      },
      config: this.config,
      resolveBookLanguage: this.resolveBookLanguage.bind(this),
      logStage: this.logStage.bind(this),
      loadGenreProfile: this.loadGenreProfile.bind(this),
      agentCtxFor: this.agentCtxFor.bind(this),
      readChapterContent: this.readChapterContent.bind(this),
      createGovernedArtifacts: this.createGovernedArtifacts.bind(this),
      evaluateMergedAudit: this.evaluateMergedAudit.bind(this),
      normalizeDraftLengthIfNeeded: this.normalizeDraftLengthIfNeeded.bind(this),
      buildLengthWarnings: this.buildLengthWarnings.bind(this),
      buildLengthTelemetry: this.buildLengthTelemetry.bind(this),
      logLengthWarnings: this.logLengthWarnings.bind(this),
      syncLegacyStructuredStateFromMarkdown: this.syncLegacyStructuredStateFromMarkdown.bind(this),
      syncNarrativeMemoryIndex: this.syncNarrativeMemoryIndex.bind(this),
      syncCurrentStateFactHistory: this.syncCurrentStateFactHistory.bind(this),
      persistAuditDriftGuidance: this.persistAuditDriftGuidance.bind(this),
      emitWebhook: this.emitWebhook.bind(this),
    };
    return revisionReviseDraft(host, bookId, chapterNumber, mode);
  }

  /** Read all truth files for a book. Delegates to pipeline-book-status.ts (G1). */
  async readTruthFiles(bookId: string): Promise<TruthFiles> {
    return readTruthFilesFromCtx(this.ctx, bookId);
  }

  /** Get book status overview. Delegates to pipeline-book-status.ts (G1). */
  async getBookStatus(bookId: string): Promise<BookStatusInfo> {
    return getBookStatusFromCtx(this.ctx, bookId) as unknown as Promise<BookStatusInfo>;
  }

  // ---------------------------------------------------------------------------
  // Full pipeline (convenience — runs draft + audit + revise in one shot)
  // ---------------------------------------------------------------------------

  async writeNextChapter(bookId: string, wordCount?: number, temperatureOverride?: number): Promise<ChapterPipelineResult> {
    const releaseLock = await this.state.acquireBookLock(bookId);
    try {
      return await this._writeNextChapterLocked(bookId, wordCount, temperatureOverride, this.config.externalContext);
    } finally {
      await releaseLock();
    }
  }

  async repairChapterState(bookId: string, chapterNumber?: number): Promise<ChapterPipelineResult> {
    const releaseLock = await this.state.acquireBookLock(bookId);
    try {
      return await this._repairChapterStateLocked(bookId, chapterNumber);
    } finally {
      await releaseLock();
    }
  }

  async resyncChapterArtifacts(bookId: string, chapterNumber?: number): Promise<ChapterPipelineResult> {
    const releaseLock = await this.state.acquireBookLock(bookId);
    try {
      return await this._resyncChapterArtifactsLocked(bookId, chapterNumber);
    } finally {
      await releaseLock();
    }
  }

  private async _writeNextChapterLocked(
    bookId: string,
    wordCount?: number,
    temperatureOverride?: number,
    externalContext?: string,
  ): Promise<ChapterPipelineResult> {
    return writeNextChapterLocked(this.ctx, bookId, wordCount, temperatureOverride, externalContext, {
      ensureControlDocuments: (id) => this.state.ensureControlDocuments(id),
      loadBookConfig: (id) => this.state.loadBookConfig(id),
      bookDir: (id) => this.state.bookDir(id),
      getNextChapterNumber: (id) => this.state.getNextChapterNumber(id),
      loadChapterIndex: (id) => this.state.loadChapterIndex(id),
      saveChapterIndex: (id, idx) => this.state.saveChapterIndex(id, idx),
      snapshotState: (id, ch) => this.state.snapshotState(id, ch),
      resolveBookLanguage: this.resolveBookLanguage.bind(this),
      loadGenreProfile: this.loadGenreProfile.bind(this),
      logStage: this.logStage.bind(this),
      logWarn: this.logWarn.bind(this),
      logInfo: this.logInfo.bind(this),
      assertNoPendingStateRepair: this.assertNoPendingStateRepair.bind(this),
      prepareWriteInput: this.prepareWriteInput.bind(this),
      buildPersistenceOutput: this.buildPersistenceOutput.bind(this),
      normalizeDraftLengthIfNeeded: this.normalizeDraftLengthIfNeeded.bind(this),
      assertChapterContentNotEmpty: this.assertChapterContentNotEmpty.bind(this),
      buildLengthWarnings: this.buildLengthWarnings.bind(this),
      buildLengthTelemetry: this.buildLengthTelemetry.bind(this),
      logLengthWarnings: this.logLengthWarnings.bind(this),
      syncLegacyStructuredStateFromMarkdown: this.syncLegacyStructuredStateFromMarkdown.bind(this),
      syncNarrativeMemoryIndex: this.syncNarrativeMemoryIndex.bind(this),
      syncCurrentStateFactHistory: this.syncCurrentStateFactHistory.bind(this),
      markBookActiveIfNeeded: this.markBookActiveIfNeeded.bind(this),
      persistAuditDriftGuidance: this.persistAuditDriftGuidance.bind(this),
      emitWebhook: this.emitWebhook.bind(this),
      addUsage: PipelineRunner.addUsage,
    });
  }

  private async _repairChapterStateLocked(bookId: string, chapterNumber?: number): Promise<ChapterPipelineResult> {
    return repairChapterStateLocked(this.ctx, bookId, chapterNumber, {
      resolveBookLanguage: this.resolveBookLanguage.bind(this),
      loadGenreProfile: this.loadGenreProfile.bind(this),
      readChapterContent: this.readChapterContent.bind(this),
      logStage: this.logStage.bind(this),
      logWarn: this.logWarn.bind(this),
      syncLegacyStructuredStateFromMarkdown: this.syncLegacyStructuredStateFromMarkdown.bind(this),
      syncNarrativeMemoryIndex: this.syncNarrativeMemoryIndex.bind(this),
      syncCurrentStateFactHistory: this.syncCurrentStateFactHistory.bind(this),
    });
  }

  private async _resyncChapterArtifactsLocked(bookId: string, chapterNumber?: number): Promise<ChapterPipelineResult> {
    return resyncChapterArtifactsLocked(this.ctx, bookId, chapterNumber, {
      resolveBookLanguage: this.resolveBookLanguage.bind(this),
      loadGenreProfile: this.loadGenreProfile.bind(this),
      readChapterContent: this.readChapterContent.bind(this),
      logStage: this.logStage.bind(this),
      logWarn: this.logWarn.bind(this),
      syncLegacyStructuredStateFromMarkdown: this.syncLegacyStructuredStateFromMarkdown.bind(this),
      syncNarrativeMemoryIndex: this.syncNarrativeMemoryIndex.bind(this),
      syncCurrentStateFactHistory: this.syncCurrentStateFactHistory.bind(this),
      createGovernedArtifacts: this.createGovernedArtifacts.bind(this),
    });
  }

  // ---------------------------------------------------------------------------
  // Import operations (style imitation + canon for spinoff)
  // ---------------------------------------------------------------------------

  /**
   * Generate a qualitative style guide from reference text via LLM.
   * Also saves the statistical style_profile.json.
   */
  async generateStyleGuide(bookId: string, referenceText: string, sourceName?: string): Promise<string> {
    return generateStyleGuideFn(this as any as StyleGuideHost, bookId, referenceText, sourceName);
  }

  // buildDeterministicStyleGuide is now re-exported from runner-style-guide.ts

  /**
   * Import canon from parent book for spinoff writing.
   * Reads parent's truth files, uses LLM to generate parent_canon.md in target book.
   */
  async importCanon(targetBookId: string, parentBookId: string): Promise<string> {
    return importCanonFn(this as any as ImportHost, targetBookId, parentBookId);
  }

  // ---------------------------------------------------------------------------
  // Chapter import (for continuation writing from existing chapters)
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Chapter import (for continuation writing from existing chapters)
  // ---------------------------------------------------------------------------

  /**
   * Import existing chapters into a book. Reverse-engineers all truth files
   * via sequential replay so the Writer and Auditor can continue naturally.
   *
   * Step 1: Generate foundation (story_frame, volume_map, book_rules) from all chapters.
   * Step 2: Sequentially replay each chapter through ChapterAnalyzer to build truth files.
   */
  async importChapters(input: ImportChaptersInput): Promise<ImportChaptersResult> {
    return importChaptersFn(this as any as ImportHost, input, {
      AgentClasses: {
        ArchitectAgent,
        FoundationReviewerAgent,
        ChapterAnalyzerAgent,
        WriterAgent,
      },
      buildImportFoundationSource,
    });
  }

  private static addUsage(
    a: TokenUsageSummary,
    b?: { readonly promptTokens: number; readonly completionTokens: number; readonly totalTokens: number },
  ): TokenUsageSummary {
    if (!b) return a;
    return {
      promptTokens: a.promptTokens + b.promptTokens,
      completionTokens: a.completionTokens + b.completionTokens,
      totalTokens: a.totalTokens + b.totalTokens,
    };
  }

  private async buildPersistenceOutput(
    bookId: string,
    book: BookConfig,
    bookDir: string,
    chapterNumber: number,
    output: WriteChapterOutput,
    finalContent: string,
    countingMode: Parameters<typeof countChapterLength>[1],
    reducedControlInput?: {
      chapterIntent: string;
      contextPackage: ContextPackage;
      ruleStack: RuleStack;
    },
  ): Promise<WriteChapterOutput> {
    if (finalContent === output.content) {
      return output;
    }

    const analyzer = new ChapterAnalyzerAgent(this.agentCtxFor("chapter-analyzer", bookId));
    const analyzed = await analyzer.analyzeChapter({
      book,
      bookDir,
      chapterNumber,
      chapterContent: finalContent,
      chapterTitle: output.title,
      chapterIntent: reducedControlInput?.chapterIntent,
      contextPackage: reducedControlInput?.contextPackage,
      ruleStack: reducedControlInput?.ruleStack,
    });

    return {
      ...analyzed,
      content: finalContent,
      wordCount: countChapterLength(finalContent, countingMode),
      postWriteErrors: [],
      postWriteWarnings: [],
      hookHealthIssues: output.hookHealthIssues,
      tokenUsage: output.tokenUsage,
    };
  }

  private async assertNoPendingStateRepair(bookId: string): Promise<void> {
    const existingIndex = await this.state.loadChapterIndex(bookId);
    const latestChapter = [...existingIndex].sort((left, right) => right.number - left.number)[0];
    if (latestChapter?.status !== "state-degraded") {
      return;
    }

    throw new Error(
      `Latest chapter ${latestChapter.number} is state-degraded. Repair state or rewrite that chapter before continuing.`,
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async prepareWriteInput(
    book: BookConfig,
    bookDir: string,
    chapterNumber: number,
    externalContext?: string,
  ): Promise<Pick<WriteChapterInput, "externalContext" | "chapterIntent" | "chapterMemo" | "chapterIntentData" | "contextPackage" | "ruleStack">> {
    if ((this.config.inputGovernanceMode ?? "v2") === "legacy") {
      return { externalContext };
    }

    const { plan, composed } = await this.createGovernedArtifacts(
      book,
      bookDir,
      chapterNumber,
      externalContext,
      { reuseExistingIntentWhenContextMissing: true },
    );

    return {
      externalContext,
      chapterIntent: plan.intentMarkdown,
      chapterMemo: plan.memo,
      chapterIntentData: plan.intent,
      contextPackage: composed.contextPackage,
      ruleStack: composed.ruleStack,
    };
  }

  private async resetImportReplayTruthFiles(
    bookDir: string,
    language: LengthLanguage,
  ): Promise<void> {
    const storyDir = join(bookDir, "story");

    await Promise.all([
      writeFile(
        join(storyDir, "current_state.md"),
        this.buildImportReplayStateSeed(language),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        this.buildImportReplayHooksSeed(language),
        "utf-8",
      ),
      rm(join(storyDir, "chapter_summaries.md"), { force: true }),
      rm(join(storyDir, "subplot_board.md"), { force: true }),
      rm(join(storyDir, "emotional_arcs.md"), { force: true }),
      rm(join(storyDir, "character_matrix.md"), { force: true }),
      rm(join(storyDir, "volume_summaries.md"), { force: true }),
      rm(join(storyDir, "particle_ledger.md"), { force: true }),
      rm(join(storyDir, "memory.db"), { force: true }),
      rm(join(storyDir, "memory.db-shm"), { force: true }),
      rm(join(storyDir, "memory.db-wal"), { force: true }),
      rm(join(storyDir, "state"), { recursive: true, force: true }),
      rm(join(storyDir, "snapshots"), { recursive: true, force: true }),
    ]);
  }

  private buildImportReplayStateSeed(language: LengthLanguage): string {
    if (language === "en") {
      return [
        "# Current State",
        "",
        "| Field | Value |",
        "| --- | --- |",
        "| Current Chapter | 0 |",
        "| Current Location | (not set) |",
        "| Protagonist State | (not set) |",
        "| Current Goal | (not set) |",
        "| Current Constraint | (not set) |",
        "| Current Alliances | (not set) |",
        "| Current Conflict | (not set) |",
        "",
      ].join("\n");
    }

    return [
      "# 当前状态",
      "",
      "| 字段 | 值 |",
      "| --- | --- |",
      "| 当前章节 | 0 |",
      "| 当前位置 | （未设定） |",
      "| 主角状态 | （未设定） |",
      "| 当前目标 | （未设定） |",
      "| 当前限制 | （未设定） |",
      "| 当前敌我 | （未设定） |",
      "| 当前冲突 | （未设定） |",
      "",
    ].join("\n");
  }

  private buildImportReplayHooksSeed(language: LengthLanguage): string {
    if (language === "en") {
      return [
        "# Pending Hooks",
        "",
        "| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | notes |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "",
      ].join("\n");
    }

    return [
      "# 伏笔池",
      "",
      "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      "",
    ].join("\n");
  }

  private async normalizeDraftLengthIfNeeded(params: {
    bookId: string;
    chapterNumber: number;
    chapterContent: string;
    lengthSpec: LengthSpec;
    chapterIntent?: string;
  }): Promise<{
    content: string;
    wordCount: number;
    applied: boolean;
    tokenUsage?: TokenUsageSummary;
  }> {
    return normalizeDraftLengthIfNeededFn(this as any as UtilsHost, params);
  }

  private assertChapterContentNotEmpty(content: string, chapterNumber: number, stage: string): void {
    return assertChapterContentNotEmpty(content, chapterNumber, stage);
  }

  // ─── Memory index (delegated to runner-memory-index.ts) ────────────────────

  private buildMemoryIndexDeps(): MemoryIndexDeps {
    const self = this;
    return {
      state: this.state,
      config: this.config,
      resolveBookLanguageById: (bookId: string) => this.resolveBookLanguageById(bookId),
      logWarn: (l, m) => this.logWarn(l, m),
      isFallbackWarned: () => this.ctx.memoryIndexFallbackWarned,
      markFallbackWarned: () => { this.ctx.memoryIndexFallbackWarned = true; },
    };
  }

  private async syncCurrentStateFactHistory(bookId: string, uptoChapter: number): Promise<void> {
    return syncCurrentStateFactHistory(this.buildMemoryIndexDeps(), bookId, uptoChapter);
  }

  private async syncLegacyStructuredStateFromMarkdown(
    bookDir: string,
    chapterNumber: number,
    output?: {
      readonly runtimeStateDelta?: WriteChapterOutput["runtimeStateDelta"];
      readonly runtimeStateSnapshot?: WriteChapterOutput["runtimeStateSnapshot"];
    },
  ): Promise<void> {
    return syncLegacyStructuredStateFromMarkdown(bookDir, chapterNumber, output);
  }

  private async syncNarrativeMemoryIndex(bookId: string): Promise<void> {
    return syncNarrativeMemoryIndex(this.buildMemoryIndexDeps(), bookId);
  }

  private async rebuildCurrentStateFactHistory(bookDir: string, uptoChapter: number): Promise<void> {
    return rebuildCurrentStateFactHistory(this.buildMemoryIndexDeps(), bookDir, uptoChapter);
  }

  private async rebuildNarrativeMemoryIndex(bookDir: string): Promise<void> {
    return rebuildNarrativeMemoryIndex(this.buildMemoryIndexDeps(), bookDir);
  }

  private canOpenMemoryIndex(bookDir: string): boolean {
    return canOpenMemoryIndex(bookDir);
  }

  private async logMemoryIndexDebugInfo(bookId: string, error: unknown): Promise<void> {
    return logMemoryIndexDebugInfo(this.buildMemoryIndexDeps(), bookId, error);
  }

  private async withMemoryIndexRetry<T>(operation: () => Promise<T> | T): Promise<T> {
    return withMemoryIndexRetry(operation);
  }

  private isMemoryIndexUnavailableError(error: unknown): boolean {
    return isMemoryIndexUnavailableError(error);
  }

  private isMemoryIndexBusyError(error: unknown): boolean {
    return isMemoryIndexBusyError(error);
  }

  private factKey(fact: Pick<Fact, "subject" | "predicate">): string {
    return factKey(fact);
  }

  private buildLengthWarnings(
    chapterNumber: number,
    finalCount: number,
    lengthSpec: LengthSpec,
  ): string[] {
    return buildLengthWarningsFn(this as any as UtilsHost, chapterNumber, finalCount, lengthSpec);
  }

  private buildLengthTelemetry(params: {
    lengthSpec: LengthSpec;
    writerCount: number;
    postWriterNormalizeCount: number;
    postReviseCount: number;
    finalCount: number;
    normalizeApplied: boolean;
    lengthWarning: boolean;
  }): LengthTelemetry {
    return buildLengthTelemetryFn(params);
  }

  private async persistAuditDriftGuidance(params: {
    readonly bookDir: string;
    readonly chapterNumber: number;
    readonly issues: ReadonlyArray<AuditIssue>;
    readonly language: LengthLanguage;
  }): Promise<void> {
    return persistAuditDriftGuidanceFn(this as any as UtilsHost, params);
  }

  private logLengthWarnings(lengthWarnings: ReadonlyArray<string>): void {
    return logLengthWarningsFn(this as any as UtilsHost, lengthWarnings);
  }

  // C2-ext: Delegated to pipeline-audit.ts
  private async evaluateMergedAudit(params: {
    auditor: ContinuityAuditor;
    book: BookConfig;
    bookDir: string;
    chapterContent: string;
    chapterNumber: number;
    language: LengthLanguage;
    auditOptions?: {
      temperature?: number;
      chapterIntent?: string;
      chapterMemo?: ChapterMemo;
      contextPackage?: ContextPackage;
      ruleStack?: RuleStack;
      truthFileOverrides?: {
        currentState?: string;
        ledger?: string;
        hooks?: string;
      };
    };
  }): Promise<MergedAuditEvaluation> {
    return evaluateMergedAudit({
      auditor: params.auditor,
      bookDir: params.bookDir,
      chapterContent: params.chapterContent,
      chapterNumber: params.chapterNumber,
      language: params.language,
      genre: params.book.genre,
      auditOptions: params.auditOptions,
    });
  }

  private async markBookActiveIfNeeded(bookId: string): Promise<void> {
    const book = await this.state.loadBookConfig(bookId);
    if (book.status !== "outlining") return;

    await this.state.saveBookConfig(bookId, {
      ...book,
      status: "active",
      updatedAt: new Date().toISOString(),
    });
  }

  private async createGovernedArtifacts(
    book: BookConfig,
    bookDir: string,
    chapterNumber: number,
    externalContext?: string,
    options?: {
      readonly reuseExistingIntentWhenContextMissing?: boolean;
    },
  ): Promise<{
    plan: PlanChapterOutput;
    composed: ComposeChapterOutput;
  }> {
    const plan = await this.resolveGovernedPlan(book, bookDir, chapterNumber, externalContext, options);
    const composed = await composeGovernedChapter({
      book,
      bookDir,
      chapterNumber,
      plan,
    });

    return { plan, composed };
  }

  private async resolveGovernedPlan(
    book: BookConfig,
    bookDir: string,
    chapterNumber: number,
    externalContext?: string,
    options?: {
      readonly reuseExistingIntentWhenContextMissing?: boolean;
    },
  ): Promise<PlanChapterOutput> {
    if (
      options?.reuseExistingIntentWhenContextMissing &&
      (!externalContext || externalContext.trim().length === 0)
    ) {
      const persisted = await loadPersistedPlan(bookDir, chapterNumber);
      if (persisted) return persisted;
    }

    const planner = new PlannerAgent(this.agentCtxFor("planner", book.id));
    const plan = await planner.planChapter({
      book,
      bookDir,
      chapterNumber,
      externalContext,
      generateAlternatives: true,
    });
    // Persist in the new memo format so subsequent compose/write phases can
    // skip the planner LLM call when no new context is supplied.
    await savePersistedPlan(bookDir, plan);
    // M10: Log plan generation for state audit trail
    logPlanGenerated(bookDir, chapterNumber, {
      goal: plan.intent.goal,
      alternativesCount: plan.alternatives?.length ?? 0,
    }).catch(() => { /* best-effort — never block the pipeline on logging */ });
    return plan;
  }

  private async emitWebhook(
    event: WebhookEvent,
    bookId: string,
    chapterNumber?: number,
    data?: Record<string, unknown>,
  ): Promise<void> {
    return emitWebhookFn(this as any as UtilsHost, event, bookId, chapterNumber, data);
  }

  private async readChapterContent(bookDir: string, chapterNumber: number): Promise<string> {
    const cacheKey = `${bookDir}:${chapterNumber}`;
    const cached = this.chapterContentCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const chaptersDir = join(bookDir, "chapters");
    const files = await readdir(chaptersDir);
    const paddedNum = String(chapterNumber).padStart(4, "0");
    const chapterFile = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
    if (!chapterFile) {
      throw new Error(`Chapter ${chapterNumber} file not found in ${chaptersDir}`);
    }
    const raw = await readFile(join(chaptersDir, chapterFile), "utf-8");
    // Strip the title line
    const lines = raw.split("\n");
    const contentStart = lines.findIndex((l, i) => i > 0 && l.trim().length > 0);
    const content = contentStart >= 0 ? lines.slice(contentStart).join("\n") : raw;
    this.chapterContentCache.set(cacheKey, content);
    return content;
  }
}
