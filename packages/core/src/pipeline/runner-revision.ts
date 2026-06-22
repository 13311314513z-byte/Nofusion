/**
 * runner-revision.ts — reviseDraft extracted from runner.ts (Stage 5).
 * Module function receives a narrow interface to avoid circular imports.
 */
import { join } from "node:path";
import { readdir, writeFile } from "node:fs/promises";
import { ContinuityAuditor } from "../agents/continuity.js";
import { ReviserAgent, DEFAULT_REVISE_MODE, type ReviseMode } from "../agents/reviser.js";
import { countChapterLength, buildLengthSpec, resolveLengthCountingMode, type LengthLanguage } from "../utils/length-metrics.js";
import type { LengthSpec, LengthTelemetry } from "../models/length-governance.js";
import { checkPatchBoundary, issueLocationsToParagraphSet } from "../utils/patch-boundary.js";
import { restoreActionableAuditIfLost, type MergedAuditEvaluation } from "./audit-helpers.js";
import type { BookConfig } from "../models/book.js";
import type { ChapterMeta } from "../models/chapter.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { ChapterIntent, ChapterMemo, ContextPackage, RuleStack } from "../models/input-governance.js";
import type { AgentContext } from "../agents/base.js";
import type { AuditIssue } from "../agents/continuity.js";
import type { WriteChapterOutput, TokenUsage } from "../agents/writer.js";
import { hasAuditIssueParagraphLocation } from "../models/audit-issue.js";

// ─── Local type (avoids circular import from runner.ts) ────────────────────

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

// ─── Narrow interface: only the methods reviseDraft actually uses ────────────

interface GovernedRevisionArtifacts {
  readonly plan: {
    readonly intentMarkdown: string;
    readonly memo: ChapterMemo;
    readonly intent: ChapterIntent;
  };
  readonly composed: {
    readonly contextPackage: ContextPackage;
    readonly ruleStack: RuleStack;
  };
}

interface EvaluateMergedAuditParams {
  readonly auditor: ContinuityAuditor;
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterContent: string;
  readonly chapterNumber: number;
  readonly language: LengthLanguage;
  readonly auditOptions?: {
    readonly temperature?: number;
    readonly chapterIntent?: string;
    readonly chapterMemo?: ChapterMemo;
    readonly contextPackage?: ContextPackage;
    readonly ruleStack?: RuleStack;
    readonly truthFileOverrides?: {
      readonly currentState?: string;
      readonly ledger?: string;
      readonly hooks?: string;
    };
  };
}

interface NormalizeDraftLengthParams {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly chapterContent: string;
  readonly lengthSpec: LengthSpec;
  readonly chapterIntent?: string;
}

interface LengthTelemetryParams {
  readonly lengthSpec: LengthSpec;
  readonly writerCount: number;
  readonly postWriterNormalizeCount: number;
  readonly postReviseCount: number;
  readonly finalCount: number;
  readonly normalizeApplied: boolean;
  readonly lengthWarning: boolean;
}

export interface ReviseDraftHost {
  readonly state: {
    acquireBookLock(bookId: string): Promise<() => Promise<void>>;
    loadBookConfig(bookId: string): Promise<BookConfig>;
    bookDir(bookId: string): string;
    getNextChapterNumber(bookId: string): Promise<number>;
    loadChapterIndex(bookId: string): Promise<ReadonlyArray<ChapterMeta>>;
    saveChapterIndex(bookId: string, index: ChapterMeta[]): Promise<void>;
    snapshotState(bookId: string, chapter: number): Promise<void>;
  };
  readonly config: { logger?: { warn(msg: string): void }; inputGovernanceMode?: string; externalContext?: string };
  resolveBookLanguage(book: Pick<BookConfig, "genre" | "language">): Promise<LengthLanguage>;
  logStage(language: LengthLanguage, msg: { zh: string; en: string }): void;
  loadGenreProfile(genre: string): Promise<{ profile: GenreProfile }>;
  agentCtxFor(agent: string, bookId?: string): AgentContext;
  readChapterContent(bookDir: string, chapterNumber: number): Promise<string>;
  createGovernedArtifacts(book: BookConfig, bookDir: string, chapterNumber: number, externalContext?: string, opts?: { reuseExistingIntentWhenContextMissing?: boolean }): Promise<GovernedRevisionArtifacts>;
  evaluateMergedAudit(params: EvaluateMergedAuditParams): Promise<MergedAuditEvaluation>;
  normalizeDraftLengthIfNeeded(params: NormalizeDraftLengthParams): Promise<{ content: string; wordCount: number; applied: boolean; tokenUsage?: TokenUsage }>;
  buildLengthWarnings(chapterNumber: number, wordCount: number, lengthSpec: LengthSpec): string[];
  buildLengthTelemetry(params: LengthTelemetryParams): LengthTelemetry;
  logLengthWarnings(warnings: ReadonlyArray<string>): void;
  syncLegacyStructuredStateFromMarkdown(bookDir: string, chapterNumber: number, output?: Partial<Pick<WriteChapterOutput, "runtimeStateDelta" | "runtimeStateSnapshot">>): Promise<void>;
  syncNarrativeMemoryIndex(bookId: string): Promise<void>;
  syncCurrentStateFactHistory(bookId: string, uptoChapter: number): Promise<void>;
  persistAuditDriftGuidance(params: { readonly bookDir: string; readonly chapterNumber: number; readonly issues: ReadonlyArray<AuditIssue>; readonly language: LengthLanguage }): Promise<void>;
  emitWebhook(event: string, bookId: string, chapter: number, data: Record<string, unknown>): Promise<void>;
}

// ─── Helper (also used by runner.ts) ─────────────────────────────────────────

// ─── Main extraction ─────────────────────────────────────────────────────────

export async function reviseDraft(
  host: ReviseDraftHost,
  bookId: string,
  chapterNumber?: number,
  mode: ReviseMode = DEFAULT_REVISE_MODE,
): Promise<ReviseResult> {
  const releaseLock = await host.state.acquireBookLock(bookId);
  try {
    const book = await host.state.loadBookConfig(bookId);
    const bookDir = host.state.bookDir(bookId);
    const targetChapter = chapterNumber ?? (await host.state.getNextChapterNumber(bookId)) - 1;
    if (targetChapter < 1) {
      throw new Error(`No chapters to revise for "${bookId}"`);
    }

    const stageLanguage = await host.resolveBookLanguage(book);
    host.logStage(stageLanguage, {
      zh: `加载第${targetChapter}章修订上下文`,
      en: `loading revision context for chapter ${targetChapter}`,
    });
    const index = await host.state.loadChapterIndex(bookId);
    const chapterMeta = index.find((ch) => ch.number === targetChapter);
    if (!chapterMeta) {
      throw new Error(`Chapter ${targetChapter} not found in index`);
    }

    const content = await host.readChapterContent(bookDir, targetChapter);
    const auditor = new ContinuityAuditor(host.agentCtxFor("auditor", bookId));
    const { profile: gp } = await host.loadGenreProfile(book.genre);
    const language = book.language ?? gp.language;
    const countingMode = resolveLengthCountingMode(language);
    const reviseControlInput = (host.config.inputGovernanceMode ?? "v2") === "legacy"
      ? undefined
      : await host.createGovernedArtifacts(book, bookDir, targetChapter, host.config.externalContext, { reuseExistingIntentWhenContextMissing: true });
    const preRevision = await host.evaluateMergedAudit({
      auditor, book, bookDir, chapterContent: content, chapterNumber: targetChapter, language,
      auditOptions: reviseControlInput
        ? { chapterIntent: reviseControlInput.plan.intentMarkdown, chapterMemo: reviseControlInput.plan.memo, contextPackage: reviseControlInput.composed.contextPackage, ruleStack: reviseControlInput.composed.ruleStack }
        : undefined,
    });

    if (preRevision.blockingCount === 0 && preRevision.aiTellCount === 0) {
      return { chapterNumber: targetChapter, wordCount: countChapterLength(content, countingMode), fixedIssues: [], applied: false, status: "unchanged", skippedReason: "No warning, critical, or AI-tell issues to fix." };
    }

    const chapterLengthTarget = chapterMeta.lengthTelemetry?.target ?? book.chapterWordCount;
    const lengthLanguage = chapterMeta.lengthTelemetry?.countingMode === "en_words" ? "en" : language;
    const lengthSpec = buildLengthSpec(chapterLengthTarget, lengthLanguage);

    const reviser = new ReviserAgent(host.agentCtxFor("reviser", bookId));
    host.logStage(stageLanguage, { zh: `修订第${targetChapter}章`, en: `revising chapter ${targetChapter}` });
    const reviseOutput = await reviser.reviseChapter(
      bookDir, content, targetChapter, preRevision.auditResult.issues, mode, book.genre,
      reviseControlInput
        ? { chapterIntent: reviseControlInput.plan.intentMarkdown, chapterMemo: reviseControlInput.plan.memo, chapterIntentData: reviseControlInput.plan.intent, contextPackage: reviseControlInput.composed.contextPackage, ruleStack: reviseControlInput.composed.ruleStack, lengthSpec }
        : { lengthSpec },
    );

    if (reviseOutput.revisedContent.length === 0) {
      throw new Error("Reviser returned empty content");
    }

    // Patch boundary check
    {
      const locationsWithRange = preRevision.auditResult.issues
        .filter(hasAuditIssueParagraphLocation)
        .map((issue) => issue.location);
      if (locationsWithRange.length > 0) {
        const targetSet = issueLocationsToParagraphSet(locationsWithRange);
        const splitParagraphs = (text: string) => text.split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean);
        const originalParas = splitParagraphs(content);
        const revisedParas = splitParagraphs(reviseOutput.revisedContent);
        const boundaryReport = checkPatchBoundary(originalParas, revisedParas, targetSet);
        if (!boundaryReport.withinBounds) {
          host.config.logger?.warn(`[patch-boundary] Chapter ${targetChapter}: ${boundaryReport.overstepCount} paragraph(s) modified outside target range.`);
          return { chapterNumber: targetChapter, wordCount: countChapterLength(content, countingMode), fixedIssues: [], applied: false, status: "unchanged", skippedReason: `Revision rejected: ${boundaryReport.overstepCount} paragraph(s) modified outside target range` };
        }
      }
    }

    const normalizedRevision = await host.normalizeDraftLengthIfNeeded({ bookId, chapterNumber: targetChapter, chapterContent: reviseOutput.revisedContent, lengthSpec });
    const postRevision = await host.evaluateMergedAudit({
      auditor, book, bookDir, chapterContent: normalizedRevision.content, chapterNumber: targetChapter, language,
      auditOptions: reviseControlInput
        ? { temperature: 0, chapterIntent: reviseControlInput.plan.intentMarkdown, chapterMemo: reviseControlInput.plan.memo, contextPackage: reviseControlInput.composed.contextPackage, ruleStack: reviseControlInput.composed.ruleStack, truthFileOverrides: { currentState: reviseOutput.updatedState !== "(状态卡未更新)" ? reviseOutput.updatedState : undefined, ledger: reviseOutput.updatedLedger !== "(账本未更新)" ? reviseOutput.updatedLedger : undefined, hooks: reviseOutput.updatedHooks !== "(伏笔池未更新)" ? reviseOutput.updatedHooks : undefined } }
        : { temperature: 0, truthFileOverrides: { currentState: reviseOutput.updatedState !== "(状态卡未更新)" ? reviseOutput.updatedState : undefined, ledger: reviseOutput.updatedLedger !== "(账本未更新)" ? reviseOutput.updatedLedger : undefined, hooks: reviseOutput.updatedHooks !== "(伏笔池未更新)" ? reviseOutput.updatedHooks : undefined } },
    });
    const effectivePostRevision = restoreActionableAuditIfLost(preRevision, postRevision);
    const revisionBaseCount = countChapterLength(content, lengthSpec.countingMode);
    const lengthWarnings = host.buildLengthWarnings(targetChapter, normalizedRevision.wordCount, lengthSpec);
    const lengthTelemetry = host.buildLengthTelemetry({ lengthSpec, writerCount: revisionBaseCount, postWriterNormalizeCount: 0, postReviseCount: normalizedRevision.wordCount, finalCount: normalizedRevision.wordCount, normalizeApplied: normalizedRevision.applied, lengthWarning: lengthWarnings.length > 0 });

    const improvedBlocking = effectivePostRevision.blockingCount < preRevision.blockingCount;
    const improvedAITells = effectivePostRevision.aiTellCount < preRevision.aiTellCount;
    const blockingDidNotWorsen = effectivePostRevision.blockingCount <= preRevision.blockingCount;
    const criticalDidNotWorsen = effectivePostRevision.criticalCount <= preRevision.criticalCount;
    const aiDidNotWorsen = effectivePostRevision.aiTellCount <= preRevision.aiTellCount;
    const shouldApplyRevision = blockingDidNotWorsen && criticalDidNotWorsen && aiDidNotWorsen && (improvedBlocking || improvedAITells);

    if (!shouldApplyRevision) {
      return { chapterNumber: targetChapter, wordCount: revisionBaseCount, fixedIssues: [], applied: false, status: "unchanged", skippedReason: "Manual revision did not improve merged audit or AI-tell metrics; kept original chapter." };
    }
    host.logLengthWarnings(lengthWarnings);

    // Save revised chapter
    host.logStage(stageLanguage, { zh: `落盘第${targetChapter}章修订结果`, en: `persisting revision for chapter ${targetChapter}` });
    const chaptersDir = join(bookDir, "chapters");
    const files = await readdir(chaptersDir);
    const paddedNum = String(targetChapter).padStart(4, "0");
    const existingFile = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
    if (!existingFile) throw new Error(`Chapter ${targetChapter} file not found in ${chaptersDir}`);
    const reviseLang = book.language ?? gp.language;
    const reviseHeading = reviseLang === "en" ? `# Chapter ${targetChapter}: ${chapterMeta.title}` : `# 第${targetChapter}章 ${chapterMeta.title}`;
    await writeFile(join(chaptersDir, existingFile), `${reviseHeading}\n\n${normalizedRevision.content}`, "utf-8");

    // Update truth files
    const storyDir = join(bookDir, "story");
    if (reviseOutput.updatedState !== "(状态卡未更新)") await writeFile(join(storyDir, "current_state.md"), reviseOutput.updatedState, "utf-8");
    if (gp.numericalSystem && reviseOutput.updatedLedger && reviseOutput.updatedLedger !== "(账本未更新)") await writeFile(join(storyDir, "particle_ledger.md"), reviseOutput.updatedLedger, "utf-8");
    if (reviseOutput.updatedHooks !== "(伏笔池未更新)") await writeFile(join(storyDir, "pending_hooks.md"), reviseOutput.updatedHooks, "utf-8");
    await host.syncLegacyStructuredStateFromMarkdown(bookDir, targetChapter);

    const updatedIndex = index.map((ch) =>
      ch.number === targetChapter
        ? { ...ch, status: (effectivePostRevision.auditResult.passed ? "ready-for-review" : "audit-failed") as ChapterMeta["status"], wordCount: normalizedRevision.wordCount, updatedAt: new Date().toISOString(), auditIssues: effectivePostRevision.auditResult.issues.map((issue) => `[${issue.severity}] ${issue.description}`), lengthWarnings, lengthTelemetry }
        : ch,
    );
    await host.state.saveChapterIndex(bookId, updatedIndex);
    const latestChapter = index.length > 0 ? Math.max(...index.map((ch) => ch.number)) : targetChapter;
    if (targetChapter === latestChapter) {
      await host.persistAuditDriftGuidance({ bookDir, chapterNumber: targetChapter, issues: effectivePostRevision.auditResult.issues.filter((issue) => issue.severity === "critical" || issue.severity === "warning"), language }).catch(() => undefined);
    }

    host.logStage(stageLanguage, { zh: `更新第${targetChapter}章索引与快照`, en: `updating chapter index and snapshots for chapter ${targetChapter}` });
    await host.state.snapshotState(bookId, targetChapter);
    await host.syncNarrativeMemoryIndex(bookId);
    await host.syncCurrentStateFactHistory(bookId, targetChapter);

    await host.emitWebhook("revision-complete", bookId, targetChapter, { wordCount: normalizedRevision.wordCount, fixedCount: reviseOutput.fixedIssues.length });

    return { chapterNumber: targetChapter, wordCount: normalizedRevision.wordCount, fixedIssues: reviseOutput.fixedIssues, applied: true, status: effectivePostRevision.auditResult.passed ? "ready-for-review" : "audit-failed", lengthWarnings, lengthTelemetry };
  } finally {
    await releaseLock();
  }
}
