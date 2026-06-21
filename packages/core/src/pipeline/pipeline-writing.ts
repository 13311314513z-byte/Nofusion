/**
 * Pipeline Writing — extracted from runner.ts (B3).
 *
 * Contains _writeNextChapterLocked, the core chapter writing logic.
 * PipelineRunner delegates to this function via .bind(this) callbacks.
 */
import type { PipelineContext } from "./context.js";
import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { LengthLanguage } from "../utils/length-metrics.js";
import type { LengthSpec, LengthTelemetry, LengthCountingMode } from "../models/length-governance.js";
import type { ChapterPipelineResult } from "./pipeline-types.js";
import type { ChapterMeta } from "../models/chapter.js";
import type { ChapterMemo, ContextPackage, RuleStack } from "../models/input-governance.js";
import type { AuditIssue, AuditResult } from "../agents/continuity.js";
import { WriterAgent, type WriteChapterOutput, type WriteChapterInput } from "../agents/writer.js";
import type { ChapterReviewCycleUsage } from "./chapter-review-cycle.js";
import type { WebhookEvent } from "../notify/webhook.js";
import { ContinuityAuditor } from "../agents/continuity.js";
import { ReviserAgent } from "../agents/reviser.js";
import { StateValidatorAgent } from "../agents/state-validator.js";
import { BetaReader } from "../agents/beta-reader.js";
import { IssueNormalizer } from "../agents/issue-normalizer.js";
import { createIssue, resolveAuditIssue } from "../models/audit-issue.js";
import { analyzeAITells } from "../agents/ai-tells.js";
import { analyzeLongSpanFatigue } from "../utils/long-span-fatigue.js";
import { buildLengthSpec, countChapterLength, formatLengthCount } from "../utils/length-metrics.js";
import { anchorAuditIssues } from "../utils/location-anchor.js";
import { loadIssueConsecutiveCounts, saveIssueConsecutiveCounts, updateConsecutiveCounts } from "../utils/issue-persistence.js";
import { evaluateBetaReaderModelConstraint, persistBetaReaderShadow } from "../utils/beta-reader-runtime.js";
import { dispatchNotification, dispatchWebhookEvent } from "../notify/dispatcher.js";
import { validateChapterTruthPersistence } from "./chapter-truth-validation.js";
import { persistChapterArtifacts } from "./chapter-persistence.js";
import { runChapterReviewCycle } from "./chapter-review-cycle.js";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  loadChapterIntents,
  getChapterIntent,
  confirmChapterIntent,
  saveChapterIntents,
} from "../models/chapter-intent.js";
import {
  readStoryFrame,
} from "../utils/outline-paths.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WritingDeps {
  // State helpers
  ensureControlDocuments: (bookId: string) => Promise<void>;
  loadBookConfig: (bookId: string) => Promise<BookConfig>;
  bookDir: (bookId: string) => string;
  getNextChapterNumber: (bookId: string) => Promise<number>;
  loadChapterIndex: (bookId: string) => Promise<ReadonlyArray<ChapterMeta>>;
  saveChapterIndex: (bookId: string, index: ReadonlyArray<ChapterMeta>) => Promise<void>;
  snapshotState: (bookId: string, chapter: number) => Promise<void>;

  // Language / logging
  resolveBookLanguage: (book: Pick<BookConfig, "genre" | "language">) => Promise<LengthLanguage>;
  loadGenreProfile: (genre: string) => Promise<{ profile: GenreProfile }>;
  logStage: (lang: LengthLanguage, msg: { zh: string; en: string }) => void;
  logWarn: (lang: LengthLanguage, msg: { zh: string; en: string }) => void;
  logInfo: (lang: LengthLanguage, msg: { zh: string; en: string }) => void;

  // Chapter helpers
  assertNoPendingStateRepair: (bookId: string) => Promise<void>;
  prepareWriteInput: (book: BookConfig, bookDir: string, chapterNumber: number, externalContext?: string) => Promise<Pick<WriteChapterInput, "externalContext" | "chapterIntent" | "chapterMemo" | "chapterIntentData" | "contextPackage" | "ruleStack">>;
  buildPersistenceOutput: (bookId: string, book: BookConfig, bookDir: string, chapterNumber: number, output: WriteChapterOutput, finalContent: string, countingMode: LengthCountingMode, reducedControlInput?: { chapterIntent: string; contextPackage: ContextPackage; ruleStack: RuleStack }) => Promise<WriteChapterOutput>;
  normalizeDraftLengthIfNeeded: (params: { bookId: string; chapterNumber: number; chapterContent: string; lengthSpec: LengthSpec; chapterIntent?: string }) => Promise<{ content: string; wordCount: number; applied: boolean; tokenUsage?: ChapterReviewCycleUsage }>;
  assertChapterContentNotEmpty: (content: string, chapterNumber: number, stage: string) => void;
  buildLengthWarnings: (chapterNumber: number, wordCount: number, lengthSpec: LengthSpec) => ReadonlyArray<string>;
  buildLengthTelemetry: (params: { lengthSpec: LengthSpec; writerCount: number; postWriterNormalizeCount: number; postReviseCount: number; finalCount: number; normalizeApplied: boolean; lengthWarning: boolean }) => LengthTelemetry;
  logLengthWarnings: (warnings: ReadonlyArray<string>) => void;

  // Truth / sync
  syncLegacyStructuredStateFromMarkdown: (bookDir: string, chapter: number, output?: WriteChapterOutput) => Promise<void>;
  syncNarrativeMemoryIndex: (bookId: string) => Promise<void>;
  syncCurrentStateFactHistory: (bookId: string, uptoChapter: number) => Promise<void>;

  // Book management
  markBookActiveIfNeeded: (bookId: string) => Promise<void>;
  persistAuditDriftGuidance: (params: { bookDir: string; chapterNumber: number; issues: ReadonlyArray<AuditIssue>; language: LengthLanguage }) => Promise<void>;

  // Notify
  emitWebhook: (event: WebhookEvent, bookId: string, chapterNumber?: number, data?: Record<string, unknown>) => Promise<void>;

  // Static helper
  addUsage: (a: ChapterReviewCycleUsage, b?: ChapterReviewCycleUsage) => ChapterReviewCycleUsage;
}

// ─── _writeNextChapterLocked ──────────────────────────────────────────────────

export async function writeNextChapterLocked(
  ctx: PipelineContext,
  bookId: string,
  wordCount: number | undefined,
  temperatureOverride: number | undefined,
  externalContext: string | undefined,
  deps: WritingDeps,
): Promise<ChapterPipelineResult> {
  await deps.ensureControlDocuments(bookId);
  const book = await deps.loadBookConfig(bookId);
  const bookDir = deps.bookDir(bookId);
  await deps.assertNoPendingStateRepair(bookId);
  const chapterNumber = await deps.getNextChapterNumber(bookId);

  if (ctx.config.strictInterview) {
    const intentsIndex = await loadChapterIntents(bookDir);
    const intent = getChapterIntent(intentsIndex.intents, chapterNumber);
    const missingFields = [
      !intent?.coreNarrative?.trim() ? "coreNarrative" : "",
      !intent?.readerTakeaway?.trim() ? "readerTakeaway" : "",
      !intent?.keyMoment?.trim() ? "keyMoment" : "",
    ].filter(Boolean);
    if (missingFields.length > 0) {
      throw new Error(`Strict interview blocked chapter ${chapterNumber}: missing ${missingFields.join(", ")}`);
    }
  }

  const chapterIntentForRevision = getChapterIntent(
    (await loadChapterIntents(bookDir)).intents,
    chapterNumber,
  );
  const currentIntentRevision = chapterIntentForRevision?.revision;
  const stageLanguage = await deps.resolveBookLanguage(book);
  deps.logStage(stageLanguage, { zh: "准备章节输入", en: "preparing chapter inputs" });

  const writeInput = await deps.prepareWriteInput(book, bookDir, chapterNumber, externalContext);
  const reducedControlInput = writeInput.chapterIntent && writeInput.contextPackage && writeInput.ruleStack
    ? { chapterIntent: writeInput.chapterIntent, chapterMemo: writeInput.chapterMemo, chapterIntentData: writeInput.chapterIntentData, contextPackage: writeInput.contextPackage, ruleStack: writeInput.ruleStack }
    : undefined;

  const { profile: gp } = await deps.loadGenreProfile(book.genre);
  const pipelineLang = book.language ?? gp.language;
  const lengthSpec = buildLengthSpec(wordCount ?? book.chapterWordCount, pipelineLang);

  const { normalizePostWriteSurface, validatePostWrite: postWriteValidate, validateAuthorIntentInContent, validateEndpointLock } = await import("../agents/post-write-validator.js");
  const { validateHookLedger } = await import("../utils/hook-ledger-validator.js");
  const { readBookRules } = await import("../agents/rules-reader.js");
  const parsedBookRules = (await readBookRules(bookDir))?.rules ?? null;

  // 1. Write chapter
  const writer = new WriterAgent(ctx.agentCtxFor("writer", bookId));
  deps.logStage(stageLanguage, { zh: "撰写章节草稿", en: "writing chapter draft" });
  const output = await writer.writeChapter({
    book, bookDir, chapterNumber, ...writeInput, lengthSpec,
    ...(wordCount ? { wordCountOverride: wordCount } : {}),
    ...(temperatureOverride ? { temperatureOverride } : {}),
  } as WriteChapterInput);
  const writerCount = countChapterLength(output.content, lengthSpec.countingMode);

  let totalUsage: ChapterReviewCycleUsage = output.tokenUsage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const auditor = new ContinuityAuditor(ctx.agentCtxFor("auditor", bookId));
  const reviewResult = await runChapterReviewCycle({
    book: { genre: book.genre },
    bookDir, chapterNumber,
    initialOutput: output,
    reducedControlInput,
    lengthSpec,
    initialUsage: totalUsage,
    createReviser: () => new ReviserAgent(ctx.agentCtxFor("reviser", bookId)),
    auditor,
    normalizeDraftLengthIfNeeded: (chapterContent) => deps.normalizeDraftLengthIfNeeded({
      bookId, chapterNumber, chapterContent, lengthSpec,
      chapterIntent: writeInput.chapterIntent,
    }),
    normalizePostWriteSurface: (chapterContent) => normalizePostWriteSurface(chapterContent, pipelineLang),
    assertChapterContentNotEmpty: (content, stage) => deps.assertChapterContentNotEmpty(content, chapterNumber, stage),
    addUsage: deps.addUsage,
    analyzeAITells: (content) => analyzeAITells(content, pipelineLang),
    runPostWriteChecks: async (content) => {
      const baseIssues = postWriteValidate(content, gp, parsedBookRules, pipelineLang)
        .filter((v) => v.severity === "error")
        .map((v) => ({ severity: "critical" as const, category: v.rule, description: v.description, suggestion: v.suggestion }));
      const memoBody = writeInput.chapterMemo?.body ?? "";
      const ledgerIssues = memoBody ? validateHookLedger(memoBody, content) : [];
      const chapterIntentsIndex = await loadChapterIntents(bookDir);
      const chapterIntent = getChapterIntent(chapterIntentsIndex.intents, chapterNumber);
      const intentIssues = chapterIntent
        ? validateAuthorIntentInContent(content, chapterIntent.keyMoment ?? "", chapterIntent.coreNarrative ?? "", chapterIntent.readerTakeaway ?? "")
          .filter((v) => v.severity === "warning" || v.severity === "info")
          .map((v) => ({ severity: v.severity === "info" ? "info" as const : "warning" as const, category: v.rule, description: v.description, suggestion: v.suggestion }))
        : [];
      const endpointLockIssues = chapterIntent
        ? validateEndpointLock(content, chapterIntent.openingFrame, chapterIntent.closingFrame, chapterIntent.pathConstraints)
          .map((v) => ({ severity: v.severity === "error" ? "critical" as const : v.severity === "warning" ? "warning" as const : "info" as const, category: v.rule, description: v.description, suggestion: v.suggestion }))
        : [];
      return [...baseIssues, ...ledgerIssues, ...intentIssues, ...endpointLockIssues];
    },
    maxReviewIterations: ctx.config.writingReviewRetries,
    logWarn: (message: { zh: string; en: string }) => deps.logWarn(pipelineLang, message),
    logStage: (message: { zh: string; en: string }) => deps.logStage(stageLanguage, message),
  });
  totalUsage = reviewResult.totalUsage;
  const finalContent = reviewResult.finalContent;
  let finalWordCount = reviewResult.finalWordCount;
  const revised = reviewResult.revised;
  let auditResult: AuditResult = reviewResult.auditResult;
  const postReviseCount = reviewResult.postReviseCount;
  const normalizeApplied = reviewResult.normalizeApplied;

  // 3b. Hook promotion pass
  {
    const { rerunPromotionPass } = await import("../utils/hook-promotion.js");
    const { parsePendingHooksMarkdown, renderHookSnapshot } = await import("../utils/story-markdown.js");
    const promotionStoryDir = join(bookDir, "story");
    const ledgerPath = join(promotionStoryDir, "pending_hooks.md");
    const ledgerRaw = await readFile(ledgerPath, "utf-8").catch(() => "");
    if (ledgerRaw.trim()) {
      const hooks = parsePendingHooksMarkdown(ledgerRaw);
      if (hooks.length > 0) {
        const summariesRaw = await readFile(join(promotionStoryDir, "chapter_summaries.md"), "utf-8").catch(() => "");
        const promotionResult = rerunPromotionPass(hooks, summariesRaw);
        if (promotionResult.updated) {
          const ledgerLang: "zh" | "en" = /[\u4e00-\u9fff]/.test(ledgerRaw) ? "zh" : "en";
          await writeFile(ledgerPath, renderHookSnapshot([...promotionResult.hooks], ledgerLang), "utf-8");
          ctx.config.logger?.info(`[promotion] ${promotionResult.flippedCount} hook(s) promoted after chapter ${chapterNumber}`);
        }
      }
    }
  }

  // 4. Persistence
  deps.logStage(stageLanguage, { zh: "落盘最终章节", en: "persisting final chapter" });
  deps.logStage(stageLanguage, { zh: "生成最终真相文件", en: "rebuilding final truth files" });
  const chapterIndexBeforePersist = await deps.loadChapterIndex(bookId);
  const { resolveDuplicateTitle } = await import("../agents/post-write-validator.js");
  const initialTitleResolution = resolveDuplicateTitle(
    output.title, chapterIndexBeforePersist.map((ch) => ch.title), pipelineLang, { content: finalContent },
  );
  let persistenceOutput = await deps.buildPersistenceOutput(
    bookId, book, bookDir, chapterNumber,
    initialTitleResolution.title === output.title ? output : { ...output, title: initialTitleResolution.title },
    finalContent, lengthSpec.countingMode, reducedControlInput,
  );
  const finalTitleResolution = resolveDuplicateTitle(
    persistenceOutput.title, chapterIndexBeforePersist.map((ch) => ch.title), pipelineLang, { content: finalContent },
  );
  if (finalTitleResolution.title !== persistenceOutput.title) {
    persistenceOutput = { ...persistenceOutput, title: finalTitleResolution.title };
  }
  if (persistenceOutput.title !== output.title) {
    const description = pipelineLang === "en"
      ? `Chapter title "${output.title}" was auto-adjusted to "${persistenceOutput.title}".`
      : `章节标题"${output.title}"已自动调整为"${persistenceOutput.title}"。`;
    ctx.config.logger?.warn(`[title] ${description}`);
    auditResult = { ...auditResult, issues: [...auditResult.issues, createIssue({
      source: "post-write", severity: "warning", category: "title-dedup", description,
      suggestion: pipelineLang === "en" ? "If the auto-renamed title is weak, revise the chapter title manually." : "如果自动改名不理想，可以在后续手动修订章节标题。",
      fixScope: "word", confidence: 1,
    })] };
  }

  const longSpanFatigue = await analyzeLongSpanFatigue({
    bookDir, chapterNumber, chapterContent: finalContent,
    chapterSummary: persistenceOutput.chapterSummary, language: pipelineLang,
  });
  auditResult = { ...auditResult, issues: [
    ...auditResult.issues,
    ...longSpanFatigue.issues.map((issue) => resolveAuditIssue(issue, "long-span-fatigue")),
    ...(persistenceOutput.hookHealthIssues ?? []),
  ]};

  // Beta Reader
  const betaReaderMode = ctx.config.betaReaderMode ?? "off";
  const qualityBudget = ctx.config.qualityBudget ?? "economy";
  const betaReaderEnabled = betaReaderMode !== "off" && qualityBudget !== "economy";
  if (betaReaderMode !== "off" && !betaReaderEnabled) {
    ctx.config.logger?.info(`[beta-reader] Skipped for chapter ${chapterNumber}: qualityBudget=economy`);
  }
  if (betaReaderEnabled) {
    const writerModel = ctx.resolveOverride("writer").model;
    const readerModel = ctx.resolveOverride("beta-reader").model;
    const modelConstraint = evaluateBetaReaderModelConstraint(writerModel, readerModel, ctx.config.betaReaderModelFamily);
    if (!modelConstraint.allowed) {
      ctx.config.logger?.warn(`[beta-reader] Skipped for chapter ${chapterNumber}: ${modelConstraint.reason}. Writer="${writerModel}", reader="${readerModel}".`);
    } else try {
      const betaReader = new BetaReader(ctx.agentCtxFor("beta-reader", bookId));
      const betaResult = await betaReader.read({ chapterContent: finalContent, chapterNumber, genre: book.genre, title: persistenceOutput.title });
      try {
        let gitCommit = "";
        try {
          const { exec } = await import("node:child_process");
          const { promisify } = await import("node:util");
          const execAsync = promisify(exec);
          const { stdout } = await execAsync("git rev-parse HEAD", { timeout: 3000, encoding: "utf-8" });
          gitCommit = (stdout as string).trim().slice(0, 12);
        } catch { /* git not available */ }
        const { runId } = await persistBetaReaderShadow({
          bookDir, chapterNumber, title: persistenceOutput.title, gitCommit,
          writerModel, writerPromptHash: persistenceOutput.writerPromptHash ?? output.writerPromptHash,
          readerModel: betaResult.modelInfo, observations: betaResult.observations,
        });
        if (betaResult.observations.length > 0) {
          const positive = betaResult.observations.filter((o) => o.judgment === "positive").length;
          const negative = betaResult.observations.filter((o) => o.judgment === "negative").length;
          ctx.config.logger?.info(`[beta-reader] Chapter ${chapterNumber}: ${betaResult.observations.length} observations (${positive} positive, ${negative} negative) — shadow persisted (run ${runId})`);
        }
      } catch (persistError) {
        ctx.config.logger?.warn(`[beta-reader] Failed to persist shadow for chapter ${chapterNumber}: ${persistError}`);
      }
      if (betaReaderMode === "advisory" || betaReaderMode === "actionable") {
        const readerIssues: ReadonlyArray<AuditIssue> = betaResult.observations
          .filter((o) => o.judgment !== "positive")
          .map((o) => createIssue({
            source: "beta-reader", severity: o.judgment === "negative" ? "warning" : "info",
            category: `Beta Reader: ${o.dimension}`,
            description: o.evidence.map((e) => e.reason).join("; "),
            suggestion: pipelineLang === "en" ? "Review the cited paragraphs and decide whether a localized revision is warranted." : "请检查对应段落，并判断是否需要局部修订。",
            location: { startParagraph: Math.min(...o.evidence.map((e) => e.startParagraph)), endParagraph: Math.max(...o.evidence.map((e) => e.endParagraph)) },
            evidence: o.evidence.map((e) => e.reason), confidence: o.confidence, fixScope: "paragraph",
          }));
        auditResult = { ...auditResult, issues: [...auditResult.issues, ...readerIssues] };
      }
    } catch (e) { ctx.config.logger?.warn(`[beta-reader] Skipped for chapter ${chapterNumber}: ${e}`); }
  }

  finalWordCount = persistenceOutput.wordCount;
  const lengthWarnings = deps.buildLengthWarnings(chapterNumber, finalWordCount, lengthSpec);
  const lengthTelemetry = deps.buildLengthTelemetry({
    lengthSpec, writerCount,
    postWriterNormalizeCount: reviewResult.preAuditNormalizedWordCount,
    postReviseCount, finalCount: finalWordCount, normalizeApplied,
    lengthWarning: lengthWarnings.length > 0,
  });
  deps.logLengthWarnings(lengthWarnings);

  // Truth validation
  deps.logStage(stageLanguage, { zh: "校验真相文件变更", en: "validating truth file updates" });
  const storyDir = join(bookDir, "story");
  const [oldState, oldHooks, oldLedger, authorityStoryFrame, authorityBookRules, authorityChapterSummaries] = await Promise.all([
    readFile(join(storyDir, "current_state.md"), "utf-8").catch(() => ""),
    readFile(join(storyDir, "pending_hooks.md"), "utf-8").catch(() => ""),
    readFile(join(storyDir, "particle_ledger.md"), "utf-8").catch(() => ""),
    readStoryFrame(bookDir).catch(() => ""),
    readFile(join(storyDir, "book_rules.md"), "utf-8").catch(() => ""),
    readFile(join(storyDir, "chapter_summaries.md"), "utf-8").catch(() => ""),
  ]);
  const validator = new StateValidatorAgent(ctx.agentCtxFor("state-validator", bookId));
  const truthValidation = await validateChapterTruthPersistence({
    writer, validator, book, bookDir, chapterNumber,
    title: persistenceOutput.title, content: finalContent,
    persistenceOutput, auditResult,
    previousTruth: { oldState, oldHooks, oldLedger },
    authorityContext: { storyFrame: authorityStoryFrame, bookRules: authorityBookRules, chapterSummaries: authorityChapterSummaries },
    reducedControlInput, language: pipelineLang,
    logWarn: (message) => deps.logWarn(pipelineLang, message),
    logger: ctx.config.logger,
  });
  const chapterStatus: ChapterPipelineResult["status"] | null = truthValidation.chapterStatus;
  let degradedIssues: ReadonlyArray<AuditIssue> = truthValidation.degradedIssues;
  persistenceOutput = truthValidation.persistenceOutput;
  auditResult = truthValidation.auditResult;

  // Paragraph shape check
  {
    const { detectParagraphLengthDrift, detectParagraphShapeWarnings } = await import("../agents/post-write-validator.js");
    const chapDir = join(bookDir, "chapters");
    const recentFiles = (await readdir(chapDir).catch(() => [] as string[]))
      .filter((f) => f.endsWith(".md") && /^\d{4}/.test(f)).sort().slice(-5);
    const recentContent = (await Promise.all(recentFiles.map((f) => readFile(join(chapDir, f), "utf-8").catch(() => "")))).join("\n\n");
    const paragraphIssues = [...detectParagraphShapeWarnings(finalContent, pipelineLang), ...detectParagraphLengthDrift(finalContent, recentContent, pipelineLang)];
    if (paragraphIssues.length > 0) {
      for (const issue of paragraphIssues) ctx.config.logger?.warn(`[paragraph] ${issue.description}`);
      auditResult = { ...auditResult, issues: [...auditResult.issues, ...paragraphIssues.map((v) => createIssue({
        source: "post-write", severity: "warning", category: "paragraph-shape",
        description: v.description, suggestion: v.suggestion, fixScope: "paragraph", confidence: 1,
      }))] };
    }
  }

  // Location anchor + issue normalization
  {
    const anchorReport = anchorAuditIssues(finalContent, auditResult.issues);
    if (anchorReport.rejectedLocations > 0 || anchorReport.relocatedLocations > 0 || anchorReport.degradedIssues > 0) {
      ctx.config.logger?.info(`[location-anchor] ${anchorReport.rejectedLocations} rejected, ${anchorReport.relocatedLocations} relocated, ${anchorReport.degradedIssues} degraded`);
    }
    auditResult = { ...auditResult, issues: anchorReport.issues };
    const consecutiveCounts = await loadIssueConsecutiveCounts(bookDir);
    const updatedCounts = updateConsecutiveCounts(consecutiveCounts, auditResult.issues);
    const normalized = new IssueNormalizer().normalize(auditResult.issues, updatedCounts);
    auditResult = { ...auditResult, issues: normalized.issues };
    degradedIssues = new IssueNormalizer().normalize(degradedIssues, undefined, "state-validation").issues;
    await saveIssueConsecutiveCounts(bookDir, updatedCounts, chapterNumber);
  }

  const resolvedStatus = chapterStatus ?? (auditResult.passed ? "ready-for-review" : "audit-failed");
  await persistChapterArtifacts({
    chapterNumber, chapterTitle: persistenceOutput.title, status: resolvedStatus,
    auditResult, finalWordCount, lengthWarnings, lengthTelemetry,
    degradedIssues, tokenUsage: totalUsage, intentRevision: currentIntentRevision,
    loadChapterIndex: () => deps.loadChapterIndex(bookId),
    saveChapter: () => writer.saveChapter(bookDir, persistenceOutput, gp.numericalSystem, pipelineLang),
    saveTruthFiles: async () => {
      await writer.saveNewTruthFiles(bookDir, persistenceOutput, pipelineLang);
      await deps.syncLegacyStructuredStateFromMarkdown(bookDir, chapterNumber, persistenceOutput);
      deps.logStage(stageLanguage, { zh: "同步记忆索引", en: "syncing memory indexes" });
      await deps.syncNarrativeMemoryIndex(bookId);
    },
    saveChapterIndex: (index) => deps.saveChapterIndex(bookId, index),
    markBookActiveIfNeeded: () => deps.markBookActiveIfNeeded(bookId),
    persistAuditDriftGuidance: (issues) => deps.persistAuditDriftGuidance({ bookDir, chapterNumber, issues, language: stageLanguage }).catch(() => undefined),
    snapshotState: () => deps.snapshotState(bookId, chapterNumber),
    syncCurrentStateFactHistory: () => deps.syncCurrentStateFactHistory(bookId, chapterNumber),
    logSnapshotStage: () => deps.logStage(stageLanguage, { zh: "更新章节索引与快照", en: "updating chapter index and snapshots" }),
  });

  // Notify
  if (ctx.config.notifyChannels && ctx.config.notifyChannels.length > 0) {
    const statusEmoji = resolvedStatus === "state-degraded" ? "🧯" : auditResult.passed ? "✅" : "⚠️";
    const chapterLength = formatLengthCount(finalWordCount, lengthSpec.countingMode);
    await dispatchNotification(ctx.config.notifyChannels, {
      title: `${statusEmoji} ${book.title} 第${chapterNumber}章`,
      body: [`**${persistenceOutput.title}** | ${chapterLength}`,
        revised ? "📝 已自动修正" : "",
        resolvedStatus === "state-degraded" ? "状态结算: 已降级保存，需先修复 state 再继续" : `审稿: ${auditResult.passed ? "通过" : "需人工审核"}`,
        ...auditResult.issues.filter((i) => i.severity !== "info").map((i) => `- [${i.severity}] ${i.description}`),
      ].filter(Boolean).join("\n"),
    });
  }
  await deps.emitWebhook("pipeline-complete", bookId, chapterNumber, {
    title: persistenceOutput.title, wordCount: finalWordCount,
    passed: auditResult.passed, revised, status: resolvedStatus,
  });

  // Confirm intent
  if (currentIntentRevision !== undefined && chapterIntentForRevision) {
    try {
      const intentsIndex = await loadChapterIntents(bookDir);
      const intentToConfirm = intentsIndex.intents.find(
        (i) => i.chapterNumber === chapterNumber && i.revision === currentIntentRevision,
      );
      if (intentToConfirm && intentToConfirm.status !== "confirmed") {
        const confirmed = confirmChapterIntent(intentToConfirm);
        const updatedIntents = intentsIndex.intents.map((i) =>
          i.chapterNumber === chapterNumber && i.revision === currentIntentRevision ? confirmed : i);
        await saveChapterIntents(bookDir, updatedIntents);
        ctx.config.logger?.info(`[intent] Chapter ${chapterNumber} intent (rev ${currentIntentRevision}) confirmed`);
      } else if (!intentToConfirm) {
        ctx.config.logger?.warn(`[intent] Chapter ${chapterNumber} intent revision ${currentIntentRevision} not found — may have been superseded during generation`);
      }
    } catch (e) {
      ctx.config.logger?.warn(`[intent] Failed to confirm intent for chapter ${chapterNumber}: ${e}`);
    }
  }

  return {
    chapterNumber, title: persistenceOutput.title, wordCount: finalWordCount,
    auditResult, revised, status: resolvedStatus,
    lengthWarnings, lengthTelemetry, tokenUsage: totalUsage,
  };
}
