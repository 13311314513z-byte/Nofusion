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
import { createIssue, resolveAuditIssue } from "../models/audit-issue.js";
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
    try {
      await this.generateStyleGuide(bookId, referenceText, sourceName);
    } catch (error) {
      const resolvedLanguage = language ?? await this.resolveBookLanguageById(bookId);
      const detail = error instanceof Error ? error.message : String(error);
      this.logWarn(resolvedLanguage, {
        zh: `风格指纹提取失败，已跳过：${detail}`,
        en: `Style fingerprint extraction failed and was skipped: ${detail}`,
      });
    }
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
    const releaseLock = await this.state.acquireBookLock(bookId);
    try {
      const book = await this.state.loadBookConfig(bookId);
      const bookDir = this.state.bookDir(bookId);
      const targetChapter = chapterNumber ?? (await this.state.getNextChapterNumber(bookId)) - 1;
      if (targetChapter < 1) {
        throw new Error(`No chapters to revise for "${bookId}"`);
      }

      const stageLanguage = await this.resolveBookLanguage(book);
      // Read the current audit issues from index
      this.logStage(stageLanguage, {
        zh: `加载第${targetChapter}章修订上下文`,
        en: `loading revision context for chapter ${targetChapter}`,
      });
      const index = await this.state.loadChapterIndex(bookId);
      const chapterMeta = index.find((ch) => ch.number === targetChapter);
      if (!chapterMeta) {
        throw new Error(`Chapter ${targetChapter} not found in index`);
      }

      // Re-audit to get structured issues (index only stores strings)
      const content = await this.readChapterContent(bookDir, targetChapter);
      const auditor = new ContinuityAuditor(this.agentCtxFor("auditor", bookId));
      const { profile: gp } = await this.loadGenreProfile(book.genre);
      const language = book.language ?? gp.language;
      const countingMode = resolveLengthCountingMode(language);
      const reviseControlInput = (this.config.inputGovernanceMode ?? "v2") === "legacy"
        ? undefined
        : await this.createGovernedArtifacts(
          book,
          bookDir,
          targetChapter,
          this.config.externalContext,
          { reuseExistingIntentWhenContextMissing: true },
        );
      const preRevision = await this.evaluateMergedAudit({
        auditor,
        book,
        bookDir,
        chapterContent: content,
        chapterNumber: targetChapter,
        language,
        auditOptions: reviseControlInput
          ? {
              chapterIntent: reviseControlInput.plan.intentMarkdown,
              chapterMemo: reviseControlInput.plan.memo,
              contextPackage: reviseControlInput.composed.contextPackage,
              ruleStack: reviseControlInput.composed.ruleStack,
            }
          : undefined,
      });

      if (preRevision.blockingCount === 0 && preRevision.aiTellCount === 0) {
        return {
          chapterNumber: targetChapter,
          wordCount: countChapterLength(content, countingMode),
          fixedIssues: [],
          applied: false,
          status: "unchanged",
          skippedReason: "No warning, critical, or AI-tell issues to fix.",
        };
      }

      const chapterLengthTarget = chapterMeta.lengthTelemetry?.target ?? book.chapterWordCount;
      const lengthLanguage = chapterMeta.lengthTelemetry?.countingMode === "en_words"
        ? "en"
        : language;
      const lengthSpec = buildLengthSpec(
        chapterLengthTarget,
        lengthLanguage,
      );

      const reviser = new ReviserAgent(this.agentCtxFor("reviser", bookId));
      this.logStage(stageLanguage, {
        zh: `修订第${targetChapter}章`,
        en: `revising chapter ${targetChapter}`,
      });
      const reviseOutput = await reviser.reviseChapter(
        bookDir,
        content,
        targetChapter,
        preRevision.auditResult.issues,
        mode,
        book.genre,
        reviseControlInput
          ? {
              chapterIntent: reviseControlInput.plan.intentMarkdown,
              chapterMemo: reviseControlInput.plan.memo,
              chapterIntentData: reviseControlInput.plan.intent,
              contextPackage: reviseControlInput.composed.contextPackage,
              ruleStack: reviseControlInput.composed.ruleStack,
              lengthSpec,
            }
          : { lengthSpec },
      );

      if (reviseOutput.revisedContent.length === 0) {
        throw new Error("Reviser returned empty content");
      }

      // Patch boundary check: verify the reviser only modified targeted paragraphs.
      // Only runs when issues carry location data (shared AuditIssue model only).
      {
        const locationsWithRange = preRevision.auditResult.issues
          .filter((i): i is typeof i & { location: { startParagraph: number; endParagraph: number } } =>
            "location" in i &&
            (i as any).location?.startParagraph > 0 &&
            (i as any).location?.endParagraph > 0,
          )
          .map((i) => i.location);
        if (locationsWithRange.length > 0) {
          const targetSet = issueLocationsToParagraphSet(locationsWithRange);
          const splitParagraphs = (text: string) => text
            .split(/\r?\n\s*\r?\n/)
            .map((paragraph) => paragraph.trim())
            .filter(Boolean);
          const originalParas = splitParagraphs(content);
          const revisedParas = splitParagraphs(reviseOutput.revisedContent);
          const boundaryReport = checkPatchBoundary(originalParas, revisedParas, targetSet);
          if (!boundaryReport.withinBounds) {
            this.config.logger?.warn(
              `[patch-boundary] Chapter ${targetChapter}: ${boundaryReport.overstepCount} paragraph(s) modified outside target range. ` +
              `Target: ${targetSet.size} paragraphs, Modified within target: ${boundaryReport.targetModified}`,
            );
            if (stageLanguage === "zh") {
              this.config.logger?.warn(`[patch-boundary] 越界段落: ${boundaryReport.oversteps.slice(0, 3).join("; ")}`);
            } else {
              this.config.logger?.warn(`[patch-boundary] Oversteps: ${boundaryReport.oversteps.slice(0, 3).join("; ")}`);
            }
            // REJECT: boundary violation → fall back to original content
            this.config.logger?.warn(
              `[patch-boundary] Chapter ${targetChapter}: revision REJECTED due to boundary violation. ` +
              `Using original content instead.`,
            );
            // Return the original content unchanged — no revision applied
            return {
              chapterNumber: targetChapter,
              wordCount: countChapterLength(content, countingMode),
              fixedIssues: [],
              applied: false,
              status: "unchanged",
              skippedReason: `Revision rejected: ${boundaryReport.overstepCount} paragraph(s) modified outside target range`,
            };
          }
        }
      }

      const normalizedRevision = await this.normalizeDraftLengthIfNeeded({
        bookId,
        chapterNumber: targetChapter,
        chapterContent: reviseOutput.revisedContent,
        lengthSpec,
      });
      const postRevision = await this.evaluateMergedAudit({
        auditor,
        book,
        bookDir,
        chapterContent: normalizedRevision.content,
        chapterNumber: targetChapter,
        language,
        auditOptions: reviseControlInput
          ? {
              temperature: 0,
              chapterIntent: reviseControlInput.plan.intentMarkdown,
              chapterMemo: reviseControlInput.plan.memo,
              contextPackage: reviseControlInput.composed.contextPackage,
              ruleStack: reviseControlInput.composed.ruleStack,
              truthFileOverrides: {
                currentState: reviseOutput.updatedState !== "(状态卡未更新)" ? reviseOutput.updatedState : undefined,
                ledger: reviseOutput.updatedLedger !== "(账本未更新)" ? reviseOutput.updatedLedger : undefined,
                hooks: reviseOutput.updatedHooks !== "(伏笔池未更新)" ? reviseOutput.updatedHooks : undefined,
              },
            }
          : {
              temperature: 0,
              truthFileOverrides: {
                currentState: reviseOutput.updatedState !== "(状态卡未更新)" ? reviseOutput.updatedState : undefined,
                ledger: reviseOutput.updatedLedger !== "(账本未更新)" ? reviseOutput.updatedLedger : undefined,
                hooks: reviseOutput.updatedHooks !== "(伏笔池未更新)" ? reviseOutput.updatedHooks : undefined,
              },
            },
      });
      const effectivePostRevision = restoreActionableAuditIfLost(
        preRevision,
        postRevision,
      );
      const revisionBaseCount = countChapterLength(content, lengthSpec.countingMode);
      const lengthWarnings = this.buildLengthWarnings(
        targetChapter,
        normalizedRevision.wordCount,
        lengthSpec,
      );
      const lengthTelemetry = this.buildLengthTelemetry({
        lengthSpec,
        writerCount: revisionBaseCount,
        postWriterNormalizeCount: 0,
        postReviseCount: normalizedRevision.wordCount,
        finalCount: normalizedRevision.wordCount,
        normalizeApplied: normalizedRevision.applied,
        lengthWarning: lengthWarnings.length > 0,
      });

      const improvedBlocking = effectivePostRevision.blockingCount < preRevision.blockingCount;
      const improvedAITells = effectivePostRevision.aiTellCount < preRevision.aiTellCount;
      const blockingDidNotWorsen = effectivePostRevision.blockingCount <= preRevision.blockingCount;
      const criticalDidNotWorsen = effectivePostRevision.criticalCount <= preRevision.criticalCount;
      const aiDidNotWorsen = effectivePostRevision.aiTellCount <= preRevision.aiTellCount;
      const shouldApplyRevision = blockingDidNotWorsen
        && criticalDidNotWorsen
        && aiDidNotWorsen
        && (improvedBlocking || improvedAITells);

      if (!shouldApplyRevision) {
        return {
          chapterNumber: targetChapter,
          wordCount: revisionBaseCount,
          fixedIssues: [],
          applied: false,
          status: "unchanged",
          skippedReason: "Manual revision did not improve merged audit or AI-tell metrics; kept original chapter.",
        };
      }
      this.logLengthWarnings(lengthWarnings);

      // Save revised chapter file
      this.logStage(stageLanguage, {
        zh: `落盘第${targetChapter}章修订结果`,
        en: `persisting revision for chapter ${targetChapter}`,
      });
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const paddedNum = String(targetChapter).padStart(4, "0");
      const existingFile = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!existingFile) {
        throw new Error(`Chapter ${targetChapter} file not found in ${chaptersDir} (expected filename starting with ${paddedNum})`);
      }
      const reviseLang = book.language ?? gp.language;
      const reviseHeading = reviseLang === "en"
        ? `# Chapter ${targetChapter}: ${chapterMeta.title}`
        : `# 第${targetChapter}章 ${chapterMeta.title}`;
      await writeFile(
        join(chaptersDir, existingFile),
        `${reviseHeading}\n\n${normalizedRevision.content}`,
        "utf-8",
      );

      // Update truth files
      const storyDir = join(bookDir, "story");
      if (reviseOutput.updatedState !== "(状态卡未更新)") {
        await writeFile(join(storyDir, "current_state.md"), reviseOutput.updatedState, "utf-8");
      }
      if (gp.numericalSystem && reviseOutput.updatedLedger && reviseOutput.updatedLedger !== "(账本未更新)") {
        await writeFile(join(storyDir, "particle_ledger.md"), reviseOutput.updatedLedger, "utf-8");
      }
      if (reviseOutput.updatedHooks !== "(伏笔池未更新)") {
        await writeFile(join(storyDir, "pending_hooks.md"), reviseOutput.updatedHooks, "utf-8");
      }
      await this.syncLegacyStructuredStateFromMarkdown(bookDir, targetChapter);

      // Update index
      const updatedIndex = index.map((ch) =>
        ch.number === targetChapter
          ? {
              ...ch,
              status: (effectivePostRevision.auditResult.passed ? "ready-for-review" : "audit-failed") as ChapterMeta["status"],
              wordCount: normalizedRevision.wordCount,
              updatedAt: new Date().toISOString(),
              auditIssues: effectivePostRevision.auditResult.issues.map((i) => `[${i.severity}] ${i.description}`),
              lengthWarnings,
              lengthTelemetry,
            }
          : ch,
      );
      await this.state.saveChapterIndex(bookId, updatedIndex);
      const latestChapter = index.length > 0 ? Math.max(...index.map((chapter) => chapter.number)) : targetChapter;
      if (targetChapter === latestChapter) {
        await this.persistAuditDriftGuidance({
          bookDir,
          chapterNumber: targetChapter,
          issues: effectivePostRevision.auditResult.issues.filter(
            (issue) => issue.severity === "critical" || issue.severity === "warning",
          ),
          language,
        }).catch(() => undefined);
      }

      // Re-snapshot
      this.logStage(stageLanguage, {
        zh: `更新第${targetChapter}章索引与快照`,
        en: `updating chapter index and snapshots for chapter ${targetChapter}`,
      });
      await this.state.snapshotState(bookId, targetChapter);
      await this.syncNarrativeMemoryIndex(bookId);
      await this.syncCurrentStateFactHistory(bookId, targetChapter);

      await this.emitWebhook("revision-complete", bookId, targetChapter, {
        wordCount: normalizedRevision.wordCount,
        fixedCount: reviseOutput.fixedIssues.length,
      });

      return {
        chapterNumber: targetChapter,
        wordCount: normalizedRevision.wordCount,
        fixedIssues: reviseOutput.fixedIssues,
        applied: true,
        status: effectivePostRevision.auditResult.passed ? "ready-for-review" : "audit-failed",
        lengthWarnings,
        lengthTelemetry,
      };
    } finally {
      await releaseLock();
    }
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
    const sample = referenceText.trim();
    if (!sample) {
      throw new Error("Reference text is required for style extraction.");
    }

    const { analyzeStyle } = await import("../agents/style-analyzer.js");
    const bookDir = this.state.bookDir(bookId);
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    // Statistical fingerprint
    const profile = analyzeStyle(sample, sourceName);
    await writeFile(join(storyDir, "style_profile.json"), JSON.stringify(profile, null, 2), "utf-8");

    const book = await this.state.loadBookConfig(bookId);
    const { profile: gp } = await this.loadGenreProfile(book.genre);
    const lang = (book.language ?? gp.language) === "en" ? "en" as const : "zh" as const;

    let qualitativeGuide: string;
    if (sample.length < 500) {
      qualitativeGuide = this.buildDeterministicStyleGuide(profile, {
        language: lang,
        reason: lang === "en"
          ? `The sample is short (${sample.length} chars), so this guide uses the statistical fingerprint instead of LLM qualitative extraction.`
          : `样本文本较短（${sample.length}字），本次先使用统计指纹生成文风指南，不强行调用 LLM 做定性拆解。`,
      });
    } else {
      try {
        // LLM qualitative extraction
        const response = await chatCompletion(this.config.client, this.config.model, [
          {
            role: "system",
            content: `你是一位文学风格分析专家。分析参考文本的写作风格，提取可供模仿的定性特征。

输出格式（Markdown）：
## 叙事声音与语气
（冷峻/热烈/讽刺/温情/...，附1-2个原文例句）

## 对话风格
（角色说话的共性特征：句子长短、口头禅倾向、方言痕迹、对话节奏）

## 场景描写特征
（五感偏好、意象选择、描写密度、环境与情绪的关联方式）

## 转折与衔接手法
（场景如何切换、时间跳跃的处理方式、段落间的过渡特征）

## 节奏特征
（长短句分布、段落长度偏好、高潮/舒缓的交替方式）

## 词汇偏好
（高频特色用词、比喻/修辞倾向、口语化程度）

## 情绪表达方式
（直白抒情 vs 动作外化、内心独白的频率和风格）

## 独特习惯
（任何值得模仿的个人写作习惯）

分析必须基于原文实际特征，不要泛泛而谈。每个部分用1-2个原文例句佐证。`,
          },
          {
            role: "user",
            content: `分析以下参考文本的写作风格：\n\n${sample.slice(0, 20000)}`,
          },
        ], { temperature: 0.3 });
        qualitativeGuide = response.content.trim()
          ? response.content
          : this.buildDeterministicStyleGuide(profile, {
              language: lang,
              reason: lang === "en"
                ? "The LLM returned empty style analysis; using the statistical fingerprint fallback."
                : "LLM 未返回有效文风分析，本次使用统计指纹兜底生成文风指南。",
            });
      } catch (error) {
        qualitativeGuide = this.buildDeterministicStyleGuide(profile, {
          language: lang,
          reason: lang === "en"
            ? `LLM qualitative extraction failed: ${error instanceof Error ? error.message : String(error)}. Using the statistical fingerprint fallback.`
            : `LLM 定性拆解失败：${error instanceof Error ? error.message : String(error)}。本次使用统计指纹兜底生成文风指南。`,
        });
      }
    }

    const craftMethodology = buildWritingMethodologySection(lang);
    const fullStyleGuide = `${qualitativeGuide}\n\n${craftMethodology}`;
    await writeFile(join(storyDir, "style_guide.md"), fullStyleGuide, "utf-8");
    return fullStyleGuide;
  }

  private buildDeterministicStyleGuide(
    profile: {
      readonly avgSentenceLength: number;
      readonly sentenceLengthStdDev: number;
      readonly avgParagraphLength: number;
      readonly vocabularyDiversity: number;
      readonly topPatterns: ReadonlyArray<string>;
      readonly rhetoricalFeatures: ReadonlyArray<string>;
      readonly sourceName?: string;
    },
    options: { readonly language: "zh" | "en"; readonly reason: string },
  ): string {
    if (options.language === "en") {
      return [
        "# Style Guide",
        "",
        `> ${options.reason}`,
        "",
        "## Statistical Fingerprint",
        `- Source: ${profile.sourceName ?? "unknown"}`,
        `- Average sentence length: ${profile.avgSentenceLength}`,
        `- Sentence length variance: ${profile.sentenceLengthStdDev}`,
        `- Average paragraph length: ${profile.avgParagraphLength}`,
        `- Vocabulary diversity: ${Math.round(profile.vocabularyDiversity * 100)}%`,
        profile.topPatterns.length > 0 ? `- Repeated openings: ${profile.topPatterns.join(", ")}` : "- Repeated openings: none obvious in this sample",
        profile.rhetoricalFeatures.length > 0 ? `- Rhetorical features: ${profile.rhetoricalFeatures.join(", ")}` : "- Rhetorical features: none obvious in this sample",
        "",
        "## How To Use",
        "- Treat this as a lightweight style fingerprint, not a full imitation bible.",
        "- Keep sentence and paragraph rhythm close to the sample when drafting.",
        "- If this guide feels too thin, import a longer excerpt later; the file will be replaced.",
      ].join("\n");
    }

    return [
      "# 文风指南",
      "",
      `> ${options.reason}`,
      "",
      "## 统计风格指纹",
      `- 来源：${profile.sourceName ?? "unknown"}`,
      `- 平均句长：${profile.avgSentenceLength}`,
      `- 句长波动：${profile.sentenceLengthStdDev}`,
      `- 平均段落长度：${profile.avgParagraphLength}`,
      `- 词汇多样性：${Math.round(profile.vocabularyDiversity * 100)}%`,
      profile.topPatterns.length > 0 ? `- 高频句首/模式：${profile.topPatterns.join("、")}` : "- 高频句首/模式：样本内不明显",
      profile.rhetoricalFeatures.length > 0 ? `- 修辞特征：${profile.rhetoricalFeatures.join("、")}` : "- 修辞特征：样本内不明显",
      "",
      "## 使用方式",
      "- 这是一份轻量文风指纹，不是完整仿写圣经。",
      "- 后续写作优先参考句长、段落长度、节奏波动和可见修辞。",
      "- 如果想得到更稳定的定性拆解，后续可以导入更长片段覆盖本文件。",
    ].join("\n");
  }

  /**
   * Import canon from parent book for spinoff writing.
   * Reads parent's truth files, uses LLM to generate parent_canon.md in target book.
   */
  async importCanon(targetBookId: string, parentBookId: string): Promise<string> {
    // Validate both books exist
    const bookIds = await this.state.listBooks();
    if (!bookIds.includes(parentBookId)) {
      throw new Error(`Parent book "${parentBookId}" not found. Available: ${bookIds.join(", ") || "(none)"}`);
    }
    if (!bookIds.includes(targetBookId)) {
      throw new Error(`Target book "${targetBookId}" not found. Available: ${bookIds.join(", ") || "(none)"}`);
    }

    const parentDir = this.state.bookDir(parentBookId);
    const targetDir = this.state.bookDir(targetBookId);
    const storyDir = join(targetDir, "story");
    await mkdir(storyDir, { recursive: true });

    const readSafe = async (path: string): Promise<string> => {
      try { return await readFile(path, "utf-8"); } catch { return "(无)"; }
    };

    const parentBook = await this.state.loadBookConfig(parentBookId);

    // Phase 5: parent book may be on the new prose layout; prefer outline/.
    const readParentOutline = async (newRel: string, legacyRel: string): Promise<string> => {
      const preferred = await readSafe(join(parentDir, "story", newRel));
      if (preferred.trim() && preferred !== "(无)") return preferred;
      return readSafe(join(parentDir, "story", legacyRel));
    };

    const [storyBible, currentState, ledger, hooks, summaries, subplots, emotions, matrix] =
      await Promise.all([
        readParentOutline("outline/story_frame.md", "story_bible.md"),
        readSafe(join(parentDir, "story/current_state.md")),
        readSafe(join(parentDir, "story/particle_ledger.md")),
        readSafe(join(parentDir, "story/pending_hooks.md")),
        readSafe(join(parentDir, "story/chapter_summaries.md")),
        readSafe(join(parentDir, "story/subplot_board.md")),
        readSafe(join(parentDir, "story/emotional_arcs.md")),
        readSafe(join(parentDir, "story/character_matrix.md")),
      ]);

    const response = await chatCompletion(this.config.client, this.config.model, [
      {
        role: "system",
        content: `你是一位网络小说架构师。基于正传的全部设定和状态文件，生成一份完整的"正传正典参照"文档，供番外写作和审计使用。

输出格式（Markdown）：
# 正传正典（《{正传书名}》）

## 世界规则（完整，来自正传设定）
（力量体系、地理设定、阵营关系、核心规则——完整复制，不压缩）

## 正典约束（不可违反的事实）
| 约束ID | 类型 | 约束内容 | 严重性 |
|---|---|---|---|
| C01 | 人物存亡 | ... | critical |
（列出所有硬性约束：谁活着、谁死了、什么事件已经发生、什么规则不可违反）

## 角色快照
| 角色 | 当前状态 | 性格底色 | 对话特征 | 已知信息 | 未知信息 |
|---|---|---|---|---|---|
（从状态卡和角色矩阵中提取每个重要角色的完整快照）

## 角色双态处理原则
- 未来会变强的角色：写潜力暗示
- 未来会黑化的角色：写微小裂痕
- 未来会死的角色：写导致死亡的性格底色

## 关键事件时间线
| 章节 | 事件 | 涉及角色 | 对番外的约束 |
|---|---|---|---|
（从章节摘要中提取关键事件）

## 伏笔状态
| Hook ID | 类型 | 状态 | 内容 | 预期回收 |
|---|---|---|---|---|

## 资源账本快照
（当前资源状态）

---
meta:
  parentBookId: "{parentBookId}"
  parentTitle: "{正传书名}"
  generatedAt: "{ISO timestamp}"

要求：
1. 世界规则完整复制，不压缩——准确性优先
2. 正典约束必须穷尽，遗漏会导致番外与正传矛盾
3. 角色快照必须包含信息边界（已知/未知），防止番外中角色引用不该知道的信息`,
      },
      {
        role: "user",
        content: `正传书名：${parentBook.title}
正传ID：${parentBookId}

## 正传世界设定
${storyBible}

## 正传当前状态卡
${currentState}

## 正传资源账本
${ledger}

## 正传伏笔池
${hooks}

## 正传章节摘要
${summaries}

## 正传支线进度
${subplots}

## 正传情感弧线
${emotions}

## 正传角色矩阵
${matrix}`,
      },
    ], { temperature: 0.3 });

    // Append deterministic meta block (LLM may hallucinate timestamps)
    const metaBlock = [
      "",
      "---",
      "meta:",
      `  parentBookId: "${parentBookId}"`,
      `  parentTitle: "${parentBook.title}"`,
      `  generatedAt: "${new Date().toISOString()}"`,
    ].join("\n");
    const canon = response.content + metaBlock;

    await writeFile(join(storyDir, "parent_canon.md"), canon, "utf-8");

    // Also generate style guide from parent's chapter text if available
    const parentChaptersDir = join(parentDir, "chapters");
    const parentChapterText = await this.readParentChapterSample(parentChaptersDir);
    if (parentChapterText.length >= 500) {
      await this.tryGenerateStyleGuide(targetBookId, parentChapterText, parentBook.title);
    }

    return canon;
  }

  private async readParentChapterSample(chaptersDir: string): Promise<string> {
    try {
      const entries = await readdir(chaptersDir);
      const mdFiles = entries
        .filter((file) => file.endsWith(".md"))
        .sort()
        .slice(0, 5);
      const chunks: string[] = [];
      let totalLength = 0;
      for (const file of mdFiles) {
        if (totalLength >= 20000) break;
        const content = await readFile(join(chaptersDir, file), "utf-8");
        chunks.push(content);
        totalLength += content.length;
      }
      return chunks.join("\n\n---\n\n");
    } catch {
      return "";
    }
  }

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
    const releaseLock = await this.state.acquireBookLock(input.bookId);
    try {
      const book = await this.state.loadBookConfig(input.bookId);
      const bookDir = this.state.bookDir(input.bookId);
      const { profile: gp } = await this.loadGenreProfile(book.genre);
      const resolvedLanguage = book.language ?? gp.language;

      const startFrom = input.resumeFrom ?? 1;

      const log = this.config.logger?.child("import");

      // Step 1: Generate foundation on first run (not on resume)
      if (startFrom === 1) {
        log?.info(this.localize(resolvedLanguage, {
          zh: `步骤 1：从 ${input.chapters.length} 章生成基础设定...`,
          en: `Step 1: Generating foundation from ${input.chapters.length} chapters...`,
        }));
        const foundationSource = buildImportFoundationSource(input.chapters, resolvedLanguage);

        const architect = new ArchitectAgent(this.agentCtxFor("architect", input.bookId));
        const isSeries = input.importMode === "series";
        const foundation = isSeries
          ? await this.generateAndReviewFoundation({
              generate: (reviewFeedback) => architect.generateFoundationFromImport(book, foundationSource, undefined, reviewFeedback, { importMode: "series" }),
              reviewer: new FoundationReviewerAgent(this.agentCtxFor("foundation-reviewer", input.bookId)),
              mode: "series",
              language: resolvedLanguage === "en" ? "en" : "zh",
              stageLanguage: resolvedLanguage,
            })
          : await architect.generateFoundationFromImport(book, foundationSource);
        await architect.writeFoundationFiles(
          bookDir,
          foundation,
          gp.numericalSystem,
          resolvedLanguage,
        );
        await this.resetImportReplayTruthFiles(bookDir, resolvedLanguage);
        await this.state.saveChapterIndex(input.bookId, []);
        await this.state.snapshotState(input.bookId, 0);

        // Generate style guide from imported chapters
        if (foundationSource.length >= 500) {
          log?.info(this.localize(resolvedLanguage, {
            zh: "提取原文风格指纹...",
            en: "Extracting source style fingerprint...",
          }));
          await this.tryGenerateStyleGuide(input.bookId, foundationSource, book.title, resolvedLanguage);
        }

        log?.info(this.localize(resolvedLanguage, {
          zh: "基础设定已生成。",
          en: "Foundation generated.",
        }));
      }

      // Step 2: Sequential replay
      log?.info(this.localize(resolvedLanguage, {
        zh: `步骤 2：从第 ${startFrom} 章开始顺序回放...`,
        en: `Step 2: Sequential replay from chapter ${startFrom}...`,
      }));
      const analyzer = new ChapterAnalyzerAgent(this.agentCtxFor("chapter-analyzer", input.bookId));
      const writer = new WriterAgent(this.agentCtxFor("writer", input.bookId));
      const countingMode = resolveLengthCountingMode(book.language ?? gp.language);
      let totalWords = 0;
      let importedCount = 0;

      for (let i = startFrom - 1; i < input.chapters.length; i++) {
        const ch = input.chapters[i]!;
        // Use the plan's targetNumber when provided, otherwise fall back to sequential numbering
        const chapterNumber = ch.targetNumber ?? i + 1;
        const governedInput = await this.prepareWriteInput(book, bookDir, chapterNumber);

        log?.info(this.localize(resolvedLanguage, {
          zh: `分析章节 ${chapterNumber}/${input.chapters.length}：${ch.title}...`,
          en: `Analyzing chapter ${chapterNumber}/${input.chapters.length}: ${ch.title}...`,
        }));

        // Analyze chapter to get truth file updates
        const output = await analyzer.analyzeChapter({
          book,
          bookDir,
          chapterNumber,
          chapterContent: ch.content,
          chapterTitle: ch.title,
          chapterIntent: governedInput.chapterIntent,
          contextPackage: governedInput.contextPackage,
          ruleStack: governedInput.ruleStack,
        });

        // Save chapter file + core truth files (state, ledger, hooks)
        await writer.saveChapter(bookDir, {
          ...output,
          postWriteErrors: [],
          postWriteWarnings: [],
        }, gp.numericalSystem, resolvedLanguage);

        // Save extended truth files (summaries, subplots, emotional arcs, character matrix)
        await writer.saveNewTruthFiles(bookDir, {
          ...output,
          postWriteErrors: [],
          postWriteWarnings: [],
        }, resolvedLanguage);
        await this.syncLegacyStructuredStateFromMarkdown(bookDir, chapterNumber, output);
        await this.syncNarrativeMemoryIndex(input.bookId);

        // Update chapter index
        const existingIndex = await this.state.loadChapterIndex(input.bookId);
        const now = new Date().toISOString();
        const chapterWordCount = countChapterLength(ch.content, countingMode);
        const newEntry: ChapterMeta = {
          number: chapterNumber,
          title: output.title,
          status: "imported",
          wordCount: chapterWordCount,
          createdAt: now,
          updatedAt: now,
          auditIssues: [],
          lengthWarnings: [],
        };
        // Replace if exists (resume case), otherwise append
        const existingIdx = existingIndex.findIndex((e) => e.number === chapterNumber);
        const updatedIndex = existingIdx >= 0
          ? existingIndex.map((e, idx) => idx === existingIdx ? newEntry : e)
          : [...existingIndex, newEntry];
        await this.state.saveChapterIndex(input.bookId, updatedIndex);

        // Snapshot state after each chapter for rollback + resume support
        await this.state.snapshotState(input.bookId, chapterNumber);

        importedCount++;
        totalWords += chapterWordCount;
      }

      if (input.chapters.length > 0) {
        await this.markBookActiveIfNeeded(input.bookId);
        // Use the actual max chapter number for state sync, not array length
        const maxChapterNumber = Math.max(...input.chapters.map((ch) => ch.targetNumber ?? 0), input.chapters.length);
        await this.syncCurrentStateFactHistory(input.bookId, maxChapterNumber);
      }

      // Compute nextChapter from the actual target numbers, not array length
      const maxTargetNumber = input.chapters.reduce(
        (max, ch) => Math.max(max, ch.targetNumber ?? 0), 0
      );
      const nextChapter = maxTargetNumber > 0 ? maxTargetNumber + 1 : input.chapters.length + 1;
      log?.info(this.localize(resolvedLanguage, {
        zh: `完成。已导入 ${importedCount} 章，共 ${formatLengthCount(totalWords, countingMode)}。下一章：${nextChapter}`,
        en: `Done. ${importedCount} chapters imported, ${formatLengthCount(totalWords, countingMode)}. Next chapter: ${nextChapter}`,
      }));

      return {
        bookId: input.bookId,
        importedCount,
        totalWords,
        nextChapter,
      };
    } finally {
      await releaseLock();
    }
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
    const writerCount = countChapterLength(
      params.chapterContent,
      params.lengthSpec.countingMode,
    );
    if (!isOutsideHardRange(writerCount, params.lengthSpec)) {
      return {
        content: params.chapterContent,
        wordCount: writerCount,
        applied: false,
      };
    }

    const normalizer = new LengthNormalizerAgent(
      this.agentCtxFor("length-normalizer", params.bookId),
    );
    const normalized = await normalizer.normalizeChapter({
      chapterContent: params.chapterContent,
      lengthSpec: params.lengthSpec,
      chapterIntent: params.chapterIntent,
    });

    // Safety net: if normalizer output is less than 25% of original, it was too destructive.
    // Reject and keep original content.
    if (normalized.finalCount < writerCount * 0.25) {
      this.logWarn(this.languageFromLengthSpec(params.lengthSpec), {
        zh: `字数归一化被拒绝：第${params.chapterNumber}章 ${writerCount} -> ${normalized.finalCount}（砍了${Math.round((1 - normalized.finalCount / writerCount) * 100)}%，超过安全阈值）`,
        en: `Length normalization rejected for chapter ${params.chapterNumber}: ${writerCount} -> ${normalized.finalCount} (cut ${Math.round((1 - normalized.finalCount / writerCount) * 100)}%, exceeds safety threshold)`,
      });
      return {
        content: params.chapterContent,
        wordCount: writerCount,
        applied: false,
      };
    }

    this.logInfo(this.languageFromLengthSpec(params.lengthSpec), {
      zh: `审计前字数归一化：第${params.chapterNumber}章 ${writerCount} -> ${normalized.finalCount}`,
      en: `Length normalization before audit for chapter ${params.chapterNumber}: ${writerCount} -> ${normalized.finalCount}`,
    });

    return {
      content: normalized.normalizedContent,
      wordCount: normalized.finalCount,
      applied: normalized.applied,
      tokenUsage: normalized.tokenUsage,
    };
  }

  private assertChapterContentNotEmpty(content: string, chapterNumber: number, stage: string): void {
    if (content.trim().length > 0) return;
    throw new Error(`Chapter ${chapterNumber} has empty chapter content after ${stage}`);
  }

  private async syncCurrentStateFactHistory(bookId: string, uptoChapter: number): Promise<void> {
    const bookDir = this.state.bookDir(bookId);
    try {
      await this.rebuildCurrentStateFactHistory(bookDir, uptoChapter);
    } catch (error) {
      if (this.isMemoryIndexUnavailableError(error)) {
        if (this.canOpenMemoryIndex(bookDir)) {
          try {
            await this.rebuildCurrentStateFactHistory(bookDir, uptoChapter);
            return;
          } catch (retryError) {
            // eslint-disable-next-line no-ex-assign
            error = retryError;
          }
        } else {
          if (!this.memoryIndexFallbackWarned) {
            this.memoryIndexFallbackWarned = true;
            this.logWarn(await this.resolveBookLanguageById(bookId), {
              zh: "当前 Node 运行时不支持 SQLite 记忆索引，继续使用 Markdown 回退方案。",
              en: "SQLite memory index unavailable on this Node runtime; continuing with markdown fallback.",
            });
            await this.logMemoryIndexDebugInfo(bookId, error);
          }
          return;
        }
      }
      this.logWarn(await this.resolveBookLanguageById(bookId), {
        zh: `状态事实同步已跳过：${String(error)}`,
        en: `State fact sync skipped: ${String(error)}`,
      });
    }
  }

  private async syncLegacyStructuredStateFromMarkdown(
    bookDir: string,
    chapterNumber: number,
    output?: {
      readonly runtimeStateDelta?: WriteChapterOutput["runtimeStateDelta"];
      readonly runtimeStateSnapshot?: WriteChapterOutput["runtimeStateSnapshot"];
    },
  ): Promise<void> {
    if (output?.runtimeStateDelta || output?.runtimeStateSnapshot) {
      return;
    }

    await rewriteStructuredStateFromMarkdown({
      bookDir,
      fallbackChapter: chapterNumber,
    });
  }

  private async syncNarrativeMemoryIndex(bookId: string): Promise<void> {
    const bookDir = this.state.bookDir(bookId);
    try {
      await this.rebuildNarrativeMemoryIndex(bookDir);
    } catch (error) {
      if (this.isMemoryIndexUnavailableError(error)) {
        if (this.canOpenMemoryIndex(bookDir)) {
          try {
            await this.rebuildNarrativeMemoryIndex(bookDir);
            return;
          } catch (retryError) {
            // eslint-disable-next-line no-ex-assign
            error = retryError;
          }
        } else {
          if (!this.memoryIndexFallbackWarned) {
            this.memoryIndexFallbackWarned = true;
            this.logWarn(await this.resolveBookLanguageById(bookId), {
              zh: "当前 Node 运行时不支持 SQLite 记忆索引，继续使用 Markdown 回退方案。",
              en: "SQLite memory index unavailable on this Node runtime; continuing with markdown fallback.",
            });
            await this.logMemoryIndexDebugInfo(bookId, error);
          }
          return;
        }
      }
      this.logWarn(await this.resolveBookLanguageById(bookId), {
        zh: `叙事记忆同步已跳过：${String(error)}`,
        en: `Narrative memory sync skipped: ${String(error)}`,
      });
    }
  }

  private async rebuildCurrentStateFactHistory(bookDir: string, uptoChapter: number): Promise<void> {
    const memoryDb = await this.withMemoryIndexRetry(async () => {
      const db = tryCreateMemoryDB(bookDir);
      if (!db) {
        const err = new Error("No such built-in module: node:sqlite");
        (err as NodeJS.ErrnoException).code = "ERR_UNKNOWN_BUILTIN_MODULE";
        throw err;
      }
      try {
        db.resetFacts();

        const activeFacts = new Map<string, { id: number; object: string }>();

        for (let chapter = 0; chapter <= uptoChapter; chapter++) {
          const snapshotFacts = await loadSnapshotCurrentStateFacts(bookDir, chapter);
          if (snapshotFacts.length === 0) continue;
          const nextFacts = new Map<string, Omit<Fact, "id">>();

          for (const fact of snapshotFacts) {
            nextFacts.set(this.factKey(fact), {
              subject: fact.subject,
              predicate: fact.predicate,
              object: fact.object,
              validFromChapter: chapter,
              validUntilChapter: null,
              sourceChapter: chapter,
            });
          }

          for (const [key, previous] of activeFacts.entries()) {
            const next = nextFacts.get(key);
            if (!next || next.object !== previous.object) {
              db.invalidateFact(previous.id, chapter);
              activeFacts.delete(key);
            }
          }

          for (const [key, fact] of nextFacts.entries()) {
            if (activeFacts.has(key)) continue;
            const id = db.addFact(fact);
            activeFacts.set(key, { id, object: fact.object });
          }
        }

        return db;
      } catch (error) {
        db.close();
        throw error;
      }
    });

    try {
      // No-op: keep the db open only for the duration of the rebuild.
    } finally {
      memoryDb.close();
    }
  }

  private async rebuildNarrativeMemoryIndex(bookDir: string): Promise<void> {
    const memorySeed = await loadNarrativeMemorySeed(bookDir);

    const memoryDb = await this.withMemoryIndexRetry(() => {
      const db = tryCreateMemoryDB(bookDir);
      if (!db) {
        const err = new Error("No such built-in module: node:sqlite");
        (err as NodeJS.ErrnoException).code = "ERR_UNKNOWN_BUILTIN_MODULE";
        throw err;
      }
      try {
        db.replaceSummaries(memorySeed.summaries);
        db.replaceHooks(memorySeed.hooks);
        return db;
      } catch (error) {
        db.close();
        throw error;
      }
    });

    try {
      // No-op: keep the db open only for the duration of the rebuild.
    } finally {
      memoryDb.close();
    }
  }

  private canOpenMemoryIndex(bookDir: string): boolean {
    const memoryDb = tryCreateMemoryDB(bookDir);
    if (memoryDb) {
      memoryDb.close();
      return true;
    }
    return false;
  }

  private async logMemoryIndexDebugInfo(bookId: string, error: unknown): Promise<void> {
    if (process.env.INKOS_DEBUG_SQLITE_MEMORY !== "1") {
      return;
    }

    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
    const message = error instanceof Error
      ? error.message
      : String(error);

    this.logWarn(await this.resolveBookLanguageById(bookId), {
      zh: `SQLite 记忆索引调试：node=${process.version}; execArgv=${JSON.stringify(process.execArgv)}; code=${code || "(none)"}; message=${message}`,
      en: `SQLite memory debug: node=${process.version}; execArgv=${JSON.stringify(process.execArgv)}; code=${code || "(none)"}; message=${message}`,
    });
  }

  private async withMemoryIndexRetry<T>(operation: () => Promise<T> | T): Promise<T> {
    const retryDelaysMs = [0, 25, 75];
    let lastError: unknown;

    for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (!this.isMemoryIndexBusyError(error) || attempt === retryDelaysMs.length - 1) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt + 1]!));
      }
    }

    throw lastError;
  }

  private isMemoryIndexUnavailableError(error: unknown): boolean {
    if (!error) return false;

    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
    const message = error instanceof Error
      ? error.message
      : String(error);
    const normalizedMessage = message.trim();

    return /^No such built-in module:\s*node:sqlite$/i.test(normalizedMessage)
      || /^Cannot find module ['"]node:sqlite['"]$/i.test(normalizedMessage)
      || (code === "ERR_UNKNOWN_BUILTIN_MODULE" && /\bnode:sqlite\b/i.test(normalizedMessage));
  }

  private isMemoryIndexBusyError(error: unknown): boolean {
    if (!error) return false;

    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
    const message = error instanceof Error
      ? error.message
      : String(error);

    return code === "SQLITE_BUSY"
      || code === "SQLITE_LOCKED"
      || /\bSQLITE_BUSY\b/i.test(message)
      || /\bSQLITE_LOCKED\b/i.test(message)
      || /database is locked/i.test(message)
      || /database is busy/i.test(message);
  }

  private factKey(fact: Pick<Fact, "subject" | "predicate">): string {
    return `${fact.subject}::${fact.predicate}`;
  }

  private buildLengthWarnings(
    chapterNumber: number,
    finalCount: number,
    lengthSpec: LengthSpec,
  ): string[] {
    if (!isOutsideHardRange(finalCount, lengthSpec)) {
      return [];
    }
    return [
      this.localize(this.languageFromLengthSpec(lengthSpec), {
        zh: `第${chapterNumber}章经过一次字数归一化后仍超出硬区间（${lengthSpec.hardMin}-${lengthSpec.hardMax}，实际 ${finalCount}）。`,
        en: `Chapter ${chapterNumber} remains outside hard range (${lengthSpec.hardMin}-${lengthSpec.hardMax}, actual ${finalCount}) after a single normalization pass.`,
      }),
    ];
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
    return {
      target: params.lengthSpec.target,
      softMin: params.lengthSpec.softMin,
      softMax: params.lengthSpec.softMax,
      hardMin: params.lengthSpec.hardMin,
      hardMax: params.lengthSpec.hardMax,
      countingMode: params.lengthSpec.countingMode,
      writerCount: params.writerCount,
      postWriterNormalizeCount: params.postWriterNormalizeCount,
      postReviseCount: params.postReviseCount,
      finalCount: params.finalCount,
      normalizeApplied: params.normalizeApplied,
      lengthWarning: params.lengthWarning,
    };
  }

  private async persistAuditDriftGuidance(params: {
    readonly bookDir: string;
    readonly chapterNumber: number;
    readonly issues: ReadonlyArray<AuditIssue>;
    readonly language: LengthLanguage;
  }): Promise<void> {
    const storyDir = join(params.bookDir, "story");
    const driftPath = join(storyDir, "audit_drift.md");
    const statePath = join(storyDir, "current_state.md");
    const currentState = await readFile(statePath, "utf-8").catch(() => "");
    const sanitizedState = stripAuditDriftCorrectionBlock(currentState).trimEnd();

    if (sanitizedState !== currentState) {
      await writeFile(statePath, sanitizedState, "utf-8");
    }

    if (params.issues.length === 0) {
      await rm(driftPath, { force: true }).catch(() => undefined);
      return;
    }

    const block = [
      this.localize(params.language, {
        zh: "# 审计纠偏",
        en: "# Audit Drift",
      }),
      "",
      this.localize(params.language, {
        zh: "## 审计纠偏（自动生成，下一章写作前参照）",
        en: "## Audit Drift Correction",
      }),
      "",
      this.localize(params.language, {
        zh: `> 第${params.chapterNumber}章审计发现以下问题，下一章写作时必须避免：`,
        en: `> Chapter ${params.chapterNumber} audit found the following issues to avoid in the next chapter:`,
      }),
      ...params.issues.map((issue) => `> - [${issue.severity}] ${issue.category}: ${issue.description}`),
      "",
    ].join("\n");

    await writeFile(driftPath, block, "utf-8");
  }

  private logLengthWarnings(lengthWarnings: ReadonlyArray<string>): void {
    for (const warning of lengthWarnings) {
      this.config.logger?.warn(warning);
    }
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
    if (!this.config.notifyChannels || this.config.notifyChannels.length === 0) return;
    await dispatchWebhookEvent(this.config.notifyChannels, {
      event,
      bookId,
      chapterNumber,
      timestamp: new Date().toISOString(),
      data,
    });
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
