/**
 * Pipeline Revision — extracted from runner.ts (B3).
 *
 * Contains _repairChapterStateLocked and _resyncChapterArtifactsLocked.
 * PipelineRunner delegates to these functions via .bind(this) callbacks.
 */
import type { PipelineContext } from "./context.js";
import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { LengthLanguage } from "../utils/length-metrics.js";
import type { ChapterPipelineResult } from "./pipeline-types.js";
import type { ContextPackage, RuleStack } from "../models/input-governance.js";
import { WriterAgent, type WriteChapterOutput } from "../agents/writer.js";
import {
  StateValidatorAgent,
  type ValidationResult,
} from "../agents/state-validator.js";
import {
  retrySettlementAfterValidationFailure,
  resolveStateDegradedBaseStatus,
  parseStateDegradedReviewNote,
} from "./chapter-state-recovery.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RepairDeps {
  resolveBookLanguage: (book: Pick<BookConfig, "genre" | "language">) => Promise<LengthLanguage>;
  loadGenreProfile: (genre: string) => Promise<{ profile: GenreProfile }>;
  readChapterContent: (bookDir: string, chapterNumber: number) => Promise<string>;
  logStage: (language: LengthLanguage, message: { zh: string; en: string }) => void;
  logWarn: (language: LengthLanguage, message: { zh: string; en: string }) => void;
  syncLegacyStructuredStateFromMarkdown: (
    bookDir: string,
    chapter: number,
    output?: {
      readonly runtimeStateDelta?: WriteChapterOutput["runtimeStateDelta"];
      readonly runtimeStateSnapshot?: WriteChapterOutput["runtimeStateSnapshot"];
    },
  ) => Promise<void>;
  syncNarrativeMemoryIndex: (bookId: string) => Promise<void>;
  syncCurrentStateFactHistory: (bookId: string, uptoChapter: number) => Promise<void>;
}

export interface ResyncDeps extends RepairDeps {
  createGovernedArtifacts: (
    book: BookConfig,
    bookDir: string,
    chapterNumber: number,
    externalContext?: string,
    opts?: { readonly reuseExistingIntentWhenContextMissing?: boolean },
  ) => Promise<{ plan: { intentMarkdown?: string }; composed: { contextPackage: ContextPackage; ruleStack: RuleStack } }>;
}

// ─── _repairChapterStateLocked ────────────────────────────────────────────────

export async function repairChapterStateLocked(
  ctx: PipelineContext,
  bookId: string,
  chapterNumber: number | undefined,
  deps: RepairDeps,
): Promise<ChapterPipelineResult> {
  const book = await ctx.state.loadBookConfig(bookId);
  const bookDir = ctx.state.bookDir(bookId);
  const stageLanguage = await deps.resolveBookLanguage(book);
  const index = [...(await ctx.state.loadChapterIndex(bookId))];
  if (index.length === 0) {
    throw new Error(`Book "${bookId}" has no persisted chapters to repair.`);
  }

  const targetChapter = chapterNumber ?? index[index.length - 1]!.number;
  const targetIndex = index.findIndex((ch) => ch.number === targetChapter);
  if (targetIndex < 0) {
    throw new Error(`Chapter ${targetChapter} not found in "${bookId}".`);
  }
  const targetMeta = index[targetIndex]!;
  const latestChapter = Math.max(...index.map((ch) => ch.number));
  if (targetMeta.status !== "state-degraded") {
    throw new Error(`Chapter ${targetChapter} is not state-degraded.`);
  }
  if (targetChapter !== latestChapter) {
    throw new Error(`Only the latest state-degraded chapter can be repaired safely (latest is ${latestChapter}).`);
  }

  deps.logStage(stageLanguage, { zh: "修复章节状态结算", en: "repairing chapter state settlement" });
  const { profile: gp } = await deps.loadGenreProfile(book.genre);
  const pipelineLang = book.language ?? gp.language;
  const content = await deps.readChapterContent(bookDir, targetChapter);
  const storyDir = join(bookDir, "story");
  const [oldState, oldHooks] = await Promise.all([
    readFile(join(storyDir, "current_state.md"), "utf-8").catch(() => ""),
    readFile(join(storyDir, "pending_hooks.md"), "utf-8").catch(() => ""),
  ]);

  const writer = new WriterAgent(ctx.agentCtxFor("writer", bookId));
  let repairedOutput = await writer.settleChapterState({
    book,
    bookDir,
    chapterNumber: targetChapter,
    title: targetMeta.title,
    content,
    allowReapply: true,
  });
  const validator = new StateValidatorAgent(ctx.agentCtxFor("state-validator", bookId));
  let validation: ValidationResult = await validator.validate(
    content,
    targetChapter,
    oldState,
    repairedOutput.updatedState,
    oldHooks,
    repairedOutput.updatedHooks,
    pipelineLang,
  );

  if (!validation.passed) {
    const recovery = await retrySettlementAfterValidationFailure({
      writer,
      validator,
      book,
      bookDir,
      chapterNumber: targetChapter,
      title: targetMeta.title,
      content,
      oldState,
      oldHooks,
      originalValidation: validation,
      language: pipelineLang,
      logWarn: (message: { zh: string; en: string }) => deps.logWarn(pipelineLang, message),
      logger: ctx.config.logger,
    });
    if (recovery.kind !== "recovered") {
      throw new Error(
        recovery.issues[0]?.description
          ?? `State repair still failed for chapter ${targetChapter}.`,
      );
    }
    repairedOutput = recovery.output;
    validation = recovery.validation;
  }

  if (!validation.passed) {
    throw new Error(`State repair still failed for chapter ${targetChapter}.`);
  }

  await writer.saveChapter(bookDir, repairedOutput, gp.numericalSystem, pipelineLang);
  await writer.saveNewTruthFiles(bookDir, repairedOutput, pipelineLang);
  await deps.syncLegacyStructuredStateFromMarkdown(bookDir, targetChapter, repairedOutput);
  await deps.syncNarrativeMemoryIndex(bookId);
  await ctx.state.snapshotState(bookId, targetChapter);
  await deps.syncCurrentStateFactHistory(bookId, targetChapter);

  const baseStatus = resolveStateDegradedBaseStatus(targetMeta);
  const degradedMetadata = parseStateDegradedReviewNote(targetMeta.reviewNote);
  const injectedIssues = new Set(degradedMetadata?.injectedIssues ?? []);
  index[targetIndex] = {
    ...targetMeta,
    status: baseStatus,
    updatedAt: new Date().toISOString(),
    auditIssues: targetMeta.auditIssues.filter((issue) => !injectedIssues.has(issue)),
    reviewNote: undefined,
  };
  await ctx.state.saveChapterIndex(bookId, index);

  const repairedPassesAudit = baseStatus !== "audit-failed";
  return {
    chapterNumber: targetChapter,
    title: targetMeta.title,
    wordCount: targetMeta.wordCount,
    auditResult: {
      passed: repairedPassesAudit,
      issues: [],
      summary: repairedPassesAudit ? "state repaired" : "state repaired but chapter still needs review",
    },
    revised: false,
    status: baseStatus,
    lengthWarnings: targetMeta.lengthWarnings,
    lengthTelemetry: targetMeta.lengthTelemetry,
    tokenUsage: targetMeta.tokenUsage,
  };
}

// ─── _resyncChapterArtifactsLocked ─────────────────────────────────────────────

export async function resyncChapterArtifactsLocked(
  ctx: PipelineContext,
  bookId: string,
  chapterNumber: number | undefined,
  deps: ResyncDeps,
): Promise<ChapterPipelineResult> {
  const book = await ctx.state.loadBookConfig(bookId);
  const bookDir = ctx.state.bookDir(bookId);
  const stageLanguage = await deps.resolveBookLanguage(book);
  const index = [...(await ctx.state.loadChapterIndex(bookId))];
  if (index.length === 0) {
    throw new Error(`Book "${bookId}" has no persisted chapters to sync.`);
  }

  const targetChapter = chapterNumber ?? index[index.length - 1]!.number;
  const targetIndex = index.findIndex((ch) => ch.number === targetChapter);
  if (targetIndex < 0) {
    throw new Error(`Chapter ${targetChapter} not found in "${bookId}".`);
  }

  const targetMeta = index[targetIndex]!;
  const latestChapter = Math.max(...index.map((ch) => ch.number));
  if (targetChapter !== latestChapter) {
    throw new Error(`Only the latest persisted chapter can be synced safely (latest is ${latestChapter}).`);
  }

  deps.logStage(stageLanguage, { zh: "根据已编辑正文同步真相文件与索引", en: "syncing truth files and indexes from edited chapter body" });
  const { profile: gp } = await deps.loadGenreProfile(book.genre);
  const pipelineLang = book.language ?? gp.language;
  const content = await deps.readChapterContent(bookDir, targetChapter);
  const storyDir = join(bookDir, "story");
  const [oldState, oldHooks] = await Promise.all([
    readFile(join(storyDir, "current_state.md"), "utf-8").catch(() => ""),
    readFile(join(storyDir, "pending_hooks.md"), "utf-8").catch(() => ""),
  ]);

  const reducedControlInput = (ctx.config.inputGovernanceMode ?? "v2") === "legacy"
    ? undefined
    : await deps.createGovernedArtifacts(
      book,
      bookDir,
      targetChapter,
      ctx.config.externalContext,
      { reuseExistingIntentWhenContextMissing: true },
    );

  const writer = new WriterAgent(ctx.agentCtxFor("writer", bookId));
  let syncedOutput = await writer.settleChapterState({
    book,
    bookDir,
    chapterNumber: targetChapter,
    title: targetMeta.title,
    content,
    chapterIntent: reducedControlInput?.plan.intentMarkdown,
    contextPackage: reducedControlInput?.composed.contextPackage,
    ruleStack: reducedControlInput?.composed.ruleStack,
    allowReapply: true,
  });
  const validator = new StateValidatorAgent(ctx.agentCtxFor("state-validator", bookId));
  let validation: ValidationResult = await validator.validate(
    content,
    targetChapter,
    oldState,
    syncedOutput.updatedState,
    oldHooks,
    syncedOutput.updatedHooks,
    pipelineLang,
  );

  if (!validation.passed) {
    const recovery = await retrySettlementAfterValidationFailure({
      writer,
      validator,
      book,
      bookDir,
      chapterNumber: targetChapter,
      title: targetMeta.title,
      content,
      reducedControlInput: reducedControlInput
        ? {
          chapterIntent: reducedControlInput.plan.intentMarkdown ?? "",
          contextPackage: reducedControlInput.composed.contextPackage,
          ruleStack: reducedControlInput.composed.ruleStack,
        }
        : undefined,
      oldState,
      oldHooks,
      originalValidation: validation,
      language: pipelineLang,
      logWarn: (message: { zh: string; en: string }) => deps.logWarn(pipelineLang, message),
      logger: ctx.config.logger,
    });
    if (recovery.kind !== "recovered") {
      throw new Error(
        recovery.issues[0]?.description
          ?? `Chapter sync still failed for chapter ${targetChapter}.`,
      );
    }
    syncedOutput = recovery.output;
    validation = recovery.validation;
  }

  if (!validation.passed) {
    throw new Error(`Chapter sync still failed for chapter ${targetChapter}.`);
  }

  await writer.saveChapter(bookDir, syncedOutput, gp.numericalSystem, pipelineLang);
  await writer.saveNewTruthFiles(bookDir, syncedOutput, pipelineLang);
  await deps.syncLegacyStructuredStateFromMarkdown(bookDir, targetChapter, syncedOutput);
  await deps.syncNarrativeMemoryIndex(bookId);
  await ctx.state.snapshotState(bookId, targetChapter);
  await deps.syncCurrentStateFactHistory(bookId, targetChapter);

  const finalStatus: "ready-for-review" | "audit-failed" = targetMeta.status === "state-degraded"
    ? resolveStateDegradedBaseStatus(targetMeta)
    : "ready-for-review";

  if (targetMeta.status === "state-degraded") {
    const degradedMetadata = parseStateDegradedReviewNote(targetMeta.reviewNote);
    const injectedIssues = new Set(degradedMetadata?.injectedIssues ?? []);
    index[targetIndex] = {
      ...targetMeta,
      status: finalStatus,
      updatedAt: new Date().toISOString(),
      auditIssues: targetMeta.auditIssues.filter((issue) => !injectedIssues.has(issue)),
      reviewNote: undefined,
    };
  } else {
    index[targetIndex] = {
      ...targetMeta,
      status: "ready-for-review",
      updatedAt: new Date().toISOString(),
    };
  }
  await ctx.state.saveChapterIndex(bookId, index);

  return {
    chapterNumber: targetChapter,
    title: targetMeta.title,
    wordCount: targetMeta.wordCount,
    auditResult: {
      passed: finalStatus !== "audit-failed",
      issues: [],
      summary: finalStatus === "audit-failed"
        ? "chapter truth/state resynced from edited body, but chapter still needs audit fixes"
        : "chapter truth/state resynced from edited body",
    },
    revised: false,
    status: finalStatus,
    lengthWarnings: targetMeta.lengthWarnings,
    lengthTelemetry: targetMeta.lengthTelemetry,
    tokenUsage: targetMeta.tokenUsage,
  };
}
