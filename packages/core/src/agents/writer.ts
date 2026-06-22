import { BaseAgent } from "./base.js";
import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { BookRules } from "../models/book-rules.js";
import { buildWriterSystemPrompt, type FanficContext } from "./writer-prompts.js";
import { buildSettlerSystemPrompt, buildSettlerUserPrompt } from "./settler-prompts.js";
import { buildObserverSystemPrompt, buildObserverUserPrompt } from "./observer-prompts.js";
import {
  buildEndpointLockSection,
} from "../utils/intent-injection.js";
import type { OpeningFrame, ClosingFrame, PathConstraints } from "../models/chapter-intent.schema.js";
import { parseSettlerDeltaOutput } from "./settler-delta-parser.js";
import { parseSettlementOutput } from "./settler-parser.js";
import { readGenreProfile, readBookRules } from "./rules-reader.js";
import {
  detectCrossChapterRepetition,
  detectParagraphLengthDrift,
  normalizePostWriteSurface,
  validatePostWrite,
  type PostWriteViolation,
} from "./post-write-validator.js";
import { analyzeAITells } from "./ai-tells.js";
import type { ChapterIntent, ChapterMemo, ContextPackage, RuleStack } from "../models/input-governance.js";
import type { LengthSpec } from "../models/length-governance.js";
import type { RuntimeStateDelta } from "../models/runtime-state.js";
import { buildLengthSpec, countChapterLength } from "../utils/length-metrics.js";
import {
  capContextBlock,
  filterHooks,
  filterSummaries,
  filterSubplots,
  filterEmotionalArcs,
  filterCharacterMatrix,
} from "../utils/context-filter.js";
import { buildGovernedMemoryEvidenceBlocks } from "../utils/governed-context.js";
import {
  buildGovernedCharacterMatrixWorkingSet,
  buildGovernedHookWorkingSet,
  mergeCharacterMatrixMarkdown,
  mergeTableMarkdownByKey,
} from "../utils/governed-working-set.js";
import { extractPOVFromOutline, filterMatrixByPOV, filterHooksByPOV } from "../utils/pov-filter.js";
import { parseCreativeOutput } from "./writer-parser.js";
import { buildRuntimeStateArtifacts, saveRuntimeStateSnapshot, type RuntimeStateArtifacts } from "../state/runtime-state-store.js";
import type { RuntimeStateSnapshot } from "../state/state-reducer.js";
import { parsePendingHooksMarkdown } from "../utils/memory-retrieval.js";
import { analyzeHookHealth } from "../utils/hook-health.js";
import { buildEnglishVarianceBrief } from "../utils/long-span-fatigue.js";
import {
  buildNarrativeIntentBrief,
  renderMemoAsNarrativeBlock,
  renderNarrativeSelectedContext,
  sanitizeNarrativeEvidenceBlock,
} from "../utils/narrative-control.js";
import { logPromptManifest } from "../utils/prompt-tracing.js";
import { buildPromptManifest, getAvailableInputTokens, type PromptFragment } from "../models/prompt-manifest.js";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

import {
  LEGACY_WRITER_CONTEXT_BUDGET,
  type WriteChapterInput,
  type SettleChapterStateInput,
  type TokenUsage,
  type WriteChapterOutput,
} from "./writer-types.js";

import {
  saveChapter as saveWriterChapter,
  saveNewTruthFiles as saveWriterTruthFiles,
  appendChapterSummary as appendWriterChapterSummary,
  sanitizeFilename as sanitizeWriterFilename,
  type SaveChapterDeps,
} from "./writer-io.js";
import {
  renderDeltaSummaryRow as renderWriterDeltaSummaryRow,
  normalizeRuntimeStateDeltaChapter as normalizeWriterRuntimeStateDeltaChapter,
  buildRuntimeStateArtifactsIfPresent as buildWriterRuntimeStateArtifactsIfPresent,
  resolveRuntimeStateArtifactsForOutput as resolveWriterRuntimeStateArtifactsForOutput,
} from "./writer-runtime-state.js";
import {
  loadRecentChapters as loadWriterRecentChapters,
  readFileOrDefault as readWriterFileOrDefault,
  buildStyleFingerprint as buildWriterStyleFingerprint,
  extractDialogueFingerprints as extractWriterDialogueFingerprints,
  loadVoiceProfiles as loadWriterVoiceProfiles,
  findRelevantSummaries as findWriterRelevantSummaries,
} from "./writer-context.js";
import {
  runSettlementPhase,
  buildSettlerGovernedControlBlock,
  verifyPreWriteCheckAlignsWithMemo as verifyPreWriteCheckAlignsWithMemoFn,
  type SettlementHost,
  type SettlementParams,
} from "./writer-settlement.js";

// Re-export for package index backward compatibility
export type { WriteChapterInput, WriteChapterOutput, TokenUsage, SettleChapterStateInput };

import {
  readStoryFrame,
  readVolumeMap,
  readCharacterContext,
  readCurrentStateWithFallback,
} from "../utils/outline-paths.js";

export class WriterAgent extends BaseAgent {
  get name(): string {
    return "writer";
  }

  private localize(language: "zh" | "en", messages: { zh: string; en: string }): string {
    return language === "en" ? messages.en : messages.zh;
  }

  private logInfo(language: "zh" | "en", messages: { zh: string; en: string }): void {
    this.ctx.logger?.info(this.localize(language, messages));
  }

  private logWarn(language: "zh" | "en", messages: { zh: string; en: string }): void {
    this.ctx.logger?.warn(this.localize(language, messages));
  }

  async writeChapter(input: WriteChapterInput): Promise<WriteChapterOutput> {
    const { book, bookDir, chapterNumber } = input;

    const placeholder = "(文件尚未创建)";
    const [
      storyBible, volumeOutline, styleGuide, currentState, ledger, hooks,
      chapterSummaries, subplotBoard, emotionalArcs, characterMatrix, styleProfileRaw,
      parentCanon, fanficCanonRaw,
    ] = await Promise.all([
        readStoryFrame(bookDir, placeholder),
        readVolumeMap(bookDir, placeholder),
        this.readFileOrDefault(join(bookDir, "story/style_guide.md")),
        // Phase 5 consolidation: architect no longer emits an initial current_state
        // section. When the file is only a seed placeholder, derive initial state
        // from roles/*.Current_State + pending_hooks startChapter=0 rows so the
        // writer still sees substantive content instead of a runtime-append note.
        readCurrentStateWithFallback(bookDir, placeholder),
        this.readFileOrDefault(join(bookDir, "story/particle_ledger.md")),
        this.readFileOrDefault(join(bookDir, "story/pending_hooks.md")),
        this.readFileOrDefault(join(bookDir, "story/chapter_summaries.md")),
        this.readFileOrDefault(join(bookDir, "story/subplot_board.md")),
        this.readFileOrDefault(join(bookDir, "story/emotional_arcs.md")),
        readCharacterContext(bookDir, placeholder),
        this.readFileOrDefault(join(bookDir, "story/style_profile.json")),
        this.readFileOrDefault(join(bookDir, "story/parent_canon.md")),
        this.readFileOrDefault(join(bookDir, "story/fanfic_canon.md")),
      ]);

    const recentChapters = await this.loadRecentChapters(bookDir, chapterNumber);
    // Load more chapters for dialogue fingerprint extraction (voice consistency over longer span)
    const fingerprintChapters = await this.loadRecentChapters(bookDir, chapterNumber, 5);

    // Load genre profile + book rules
    const { profile: genreProfile, body: genreBody } =
      await readGenreProfile(this.ctx.projectRoot, book.genre);
    const parsedBookRules = await readBookRules(bookDir);
    const bookRules = parsedBookRules?.rules ?? null;
    const bookRulesBody = parsedBookRules?.body ?? "";

    const styleFingerprint = this.buildStyleFingerprint(styleProfileRaw);

    const dialogueFingerprints = this.extractDialogueFingerprints(fingerprintChapters, storyBible);
    const voiceProfileBlock = await this.loadVoiceProfiles(bookDir);
    const relevantSummaries = this.findRelevantSummaries(chapterSummaries, volumeOutline, chapterNumber);

    const hasParentCanon = parentCanon !== "(文件尚未创建)";
    const hasFanficCanon = fanficCanonRaw !== "(文件尚未创建)";
    const resolvedLanguage = book.language ?? genreProfile.language;
    const targetWords = input.lengthSpec?.target ?? input.wordCountOverride ?? book.chapterWordCount;
    const resolvedLengthSpec = input.lengthSpec ?? buildLengthSpec(targetWords, resolvedLanguage);
    const governedMemoryBlocks = input.contextPackage
      ? buildGovernedMemoryEvidenceBlocks(input.contextPackage, resolvedLanguage)
      : undefined;
    const englishVarianceBrief = resolvedLanguage === "en"
      ? await buildEnglishVarianceBrief({
          bookDir,
          chapterNumber,
        })
      : null;

    // Build fanfic context if fanfic_canon.md exists
    const fanficContext: FanficContext | undefined = hasFanficCanon && bookRules?.fanficMode
      ? {
          fanficCanon: fanficCanonRaw,
          fanficMode: bookRules.fanficMode,
          allowedDeviations: bookRules.allowedDeviations ?? [],
        }
      : undefined;

    // ── Phase 1: Creative writing (temperature 0.7) ──
    const creativeSystemPrompt = buildWriterSystemPrompt(
      book, genreProfile, bookRules, bookRulesBody, genreBody, styleGuide, styleFingerprint,
      chapterNumber, "creative", fanficContext, resolvedLanguage,
      input.chapterMemo ? "governed" : "legacy",
      resolvedLengthSpec,
    );

    // Inject voice profiles if available
    const creativePromptWithVoice = voiceProfileBlock
      ? `${creativeSystemPrompt}\n\n## 角色声音画像\n\n${voiceProfileBlock}`
      : creativeSystemPrompt;

    const creativeUserPrompt = input.chapterMemo && input.contextPackage && input.ruleStack
      ? this.buildGovernedUserPrompt({
          chapterNumber,
          chapterMemo: input.chapterMemo,
          chapterIntentData: input.chapterIntentData,
          contextPackage: input.contextPackage,
          ruleStack: input.ruleStack,
          externalContext: input.externalContext,
          lengthSpec: resolvedLengthSpec,
          language: book.language ?? genreProfile.language,
          varianceBrief: englishVarianceBrief?.text,
          selectedEvidenceBlock: this.joinGovernedEvidenceBlocks(governedMemoryBlocks),
          openingFrame: input.openingFrame,
          closingFrame: input.closingFrame,
          pathConstraints: input.pathConstraints,
        })
      : (() => {
          // Smart context filtering: inject only relevant parts of truth files
          const filteredHooks = filterHooks(hooks);
          const filteredSummaries = filterSummaries(chapterSummaries, chapterNumber);
          const filteredSubplots = filterSubplots(subplotBoard);
          const filteredArcs = filterEmotionalArcs(emotionalArcs, chapterNumber);
          const filteredMatrix = filterCharacterMatrix(characterMatrix, volumeOutline, bookRules?.protagonist?.name);

          // POV-aware filtering: limit context to what the POV character knows
          const povCharacter = extractPOVFromOutline(volumeOutline, chapterNumber);
          const povFilteredMatrix = povCharacter
            ? filterMatrixByPOV(filteredMatrix, povCharacter)
            : filteredMatrix;
          const povFilteredHooks = povCharacter
            ? filterHooksByPOV(filteredHooks, povCharacter, chapterSummaries)
            : filteredHooks;

          return this.buildUserPrompt({
            chapterNumber,
            storyBible,
            currentState,
            ledger: genreProfile.numericalSystem ? ledger : "",
            hooks: povFilteredHooks,
            recentChapters,
            lengthSpec: resolvedLengthSpec,
            externalContext: input.externalContext,
            chapterSummaries: filteredSummaries,
            subplotBoard: filteredSubplots,
            emotionalArcs: filteredArcs,
            characterMatrix: povFilteredMatrix,
            dialogueFingerprints,
            relevantSummaries,
            parentCanon: hasParentCanon ? parentCanon : undefined,
            language: book.language ?? genreProfile.language,
          });
        })();

    const creativeTemperature = input.temperatureOverride ?? 0.7;

    this.logInfo(resolvedLanguage, {
      zh: `阶段 1：创作正文（第${chapterNumber}章）`,
      en: `Phase 1: creative writing for chapter ${chapterNumber}`,
    });

    const maxTokens = getAvailableInputTokens(this.ctx.model);
    const creativeSysFragment: PromptFragment = {
      id: "writer-creative-system",
      source: "writer-creative",
      role: "system",
      slot: "system-prompt",
      priority: 100,
      content: creativePromptWithVoice,
      optional: false,
      estimatedTokens: Math.ceil(creativePromptWithVoice.length / 4),
    };
    const creativeUserFragment: PromptFragment = {
      id: "writer-creative-user",
      source: "writer-creative",
      role: "user",
      slot: "user-message",
      priority: 90,
      content: creativeUserPrompt,
      optional: false,
      estimatedTokens: Math.ceil(creativeUserPrompt.length / 4),
    };
    const creativeManifest = buildPromptManifest({
      stage: `${this.name}.creative`,
      fragments: [creativeSysFragment, creativeUserFragment],
      maxAllowedInputTokens: maxTokens,
    });
    if (creativeManifest.droppedFragments.length > 0) {
      this.log?.warn(`[writer.creative] Fragment(s) dropped: ${creativeManifest.droppedFragments.map((d) => d.fragmentId).join(", ")}`);
    }
    const creativeMessages: Array<{ role: "system" | "user"; content: string }> = [];
    for (const frag of creativeManifest.fragments) {
      if (frag.role === "system" || frag.role === "user") {
        creativeMessages.push({ role: frag.role, content: frag.content });
      }
    }
    logPromptManifest(`${this.name}.creative`, creativeMessages, this.ctx.model, this.log);

    const creativeResponse = await this.chat(creativeMessages, { temperature: creativeTemperature });
    if (creativeResponse.stopReason === "length") {
      this.log?.warn(
        resolvedLanguage === "en"
          ? `Chapter ${chapterNumber} creative response was truncated (stopReason=length). Content may be incomplete.`
          : `第${chapterNumber}章创作响应被截断（stopReason=length），内容可能不完整。`,
      );
    }
    const creativeUsage = creativeResponse.usage;

    const creative = parseCreativeOutput(chapterNumber, creativeResponse.content, resolvedLengthSpec.countingMode);

    // Phase 4: soft-check that PRE_WRITE_CHECK aligns with the chapter memo.
    // Memo was already parse-validated in the planner, so this only warns —
    // the LLM self-check may have skipped or abbreviated a row.
    if (input.chapterMemo) {
      this.verifyPreWriteCheckAlignsWithMemo(creative.preWriteCheck, chapterNumber, resolvedLanguage);
    }

    // ── Phase 2: State settlement (temperature 0.3) ──
    this.logInfo(resolvedLanguage, {
      zh: `阶段 2：状态结算（第${chapterNumber}章，${creative.wordCount}字）`,
      en: `Phase 2: state settlement for chapter ${chapterNumber} (${creative.wordCount} words)`,
    });
    const isGovernedSettlement = Boolean(input.chapterIntent && input.contextPackage && input.ruleStack);
    const filteredHooksForSettlement = isGovernedSettlement && input.contextPackage
      ? buildGovernedHookWorkingSet({
          hooksMarkdown: hooks,
          contextPackage: input.contextPackage,
          chapterIntent: input.chapterIntent,
          chapterNumber,
          language: resolvedLanguage,
        })
      : hooks;
    const filteredSubplotsForSettlement = isGovernedSettlement
      ? filterSubplots(subplotBoard)
      : subplotBoard;
    const filteredArcsForSettlement = isGovernedSettlement
      ? filterEmotionalArcs(emotionalArcs, chapterNumber)
      : emotionalArcs;
    const filteredMatrixForSettlement = isGovernedSettlement
      ? buildGovernedCharacterMatrixWorkingSet({
          matrixMarkdown: characterMatrix,
          chapterIntent: input.chapterIntent ?? volumeOutline,
          contextPackage: input.contextPackage!,
          protagonistName: bookRules?.protagonist?.name,
        })
      : characterMatrix;

    const settleResult = await this.settle({
      book,
      genreProfile,
      bookRules,
      chapterNumber,
      title: creative.title,
      content: creative.content,
      currentState,
      ledger: genreProfile.numericalSystem ? ledger : "",
      hooks: filteredHooksForSettlement,
      chapterSummaries: input.contextPackage ? filterSummaries(chapterSummaries, chapterNumber) : chapterSummaries,
      subplotBoard: filteredSubplotsForSettlement,
      emotionalArcs: filteredArcsForSettlement,
      characterMatrix: filteredMatrixForSettlement,
      volumeOutline,
      selectedEvidenceBlock: governedMemoryBlocks
        ? this.joinGovernedEvidenceBlocks(governedMemoryBlocks)
        : undefined,
      chapterIntent: input.chapterIntent,
      contextPackage: input.contextPackage,
      ruleStack: input.ruleStack,
      validationFeedback: undefined,
      originalHooks: hooks,
      originalSubplots: subplotBoard,
      originalEmotionalArcs: emotionalArcs,
      originalCharacterMatrix: characterMatrix,
    });
    const settlement = settleResult.settlement;
    const settleUsage = settleResult.usage;
    const runtimeStateArtifacts = await this.buildRuntimeStateArtifactsIfPresent(
      bookDir,
      settlement.runtimeStateDelta,
      resolvedLanguage,
      chapterNumber,
    );
    const resolvedRuntimeStateDelta = runtimeStateArtifacts?.resolvedDelta ?? settlement.runtimeStateDelta;
    const priorHookIds = new Set(parsePendingHooksMarkdown(hooks).map((hook) => hook.hookId));
    const hookHealthIssues = resolvedRuntimeStateDelta
      && (runtimeStateArtifacts?.snapshot ?? settlement.runtimeStateSnapshot)
      ? analyzeHookHealth({
          language: resolvedLanguage,
          chapterNumber,
          targetChapters: book.targetChapters,
          hooks: (runtimeStateArtifacts?.snapshot ?? settlement.runtimeStateSnapshot)!.hooks.hooks,
          delta: resolvedRuntimeStateDelta,
          existingHookIds: [...priorHookIds],
        })
      : [];

    // ── Post-write validation (regex + rule-based, zero LLM cost) ──
    const surfaceNormalizedContent = normalizePostWriteSurface(creative.content, resolvedLanguage);
    const surfaceNormalizedWordCount = countChapterLength(surfaceNormalizedContent, resolvedLengthSpec.countingMode);
    const ruleViolations = [
      ...validatePostWrite(surfaceNormalizedContent, genreProfile, bookRules, resolvedLanguage),
      ...detectCrossChapterRepetition(surfaceNormalizedContent, fingerprintChapters, resolvedLanguage),
      ...detectParagraphLengthDrift(surfaceNormalizedContent, fingerprintChapters, resolvedLanguage),
    ];
    const aiTellIssues = analyzeAITells(surfaceNormalizedContent, resolvedLanguage).issues;

    const postWriteErrors = ruleViolations.filter(v => v.severity === "error");
    const postWriteWarnings = ruleViolations.filter(v => v.severity === "warning");

    if (ruleViolations.length > 0) {
      this.logWarn(resolvedLanguage, {
        zh: `后写校验：第${chapterNumber}章 ${postWriteErrors.length} 个错误，${postWriteWarnings.length} 个警告`,
        en: `Post-write: ${postWriteErrors.length} errors, ${postWriteWarnings.length} warnings in chapter ${chapterNumber}`,
      });
      for (const v of ruleViolations) {
        this.ctx.logger?.warn(`[${v.severity}] ${v.rule}: ${v.description}`);
      }
    }
    if (aiTellIssues.length > 0) {
      this.logWarn(resolvedLanguage, {
        zh: `AI 味检查：第${chapterNumber}章发现 ${aiTellIssues.length} 个问题`,
        en: `AI-tell check: ${aiTellIssues.length} issues in chapter ${chapterNumber}`,
      });
      for (const issue of aiTellIssues) {
        this.ctx.logger?.warn(`[${issue.severity}] ${issue.category}: ${issue.description}`);
      }
    }
    if (hookHealthIssues.length > 0) {
      this.logWarn(resolvedLanguage, {
        zh: `伏笔健康：第${chapterNumber}章发现 ${hookHealthIssues.length} 条警告`,
        en: `Hook health: ${hookHealthIssues.length} warning(s) in chapter ${chapterNumber}`,
      });
      for (const issue of hookHealthIssues) {
        this.ctx.logger?.warn(`[${issue.severity}] ${issue.category}: ${issue.description}`);
      }
    }

    // ── Merge into WriteChapterOutput ──
    const tokenUsage: TokenUsage = {
      promptTokens: creativeUsage.promptTokens + settleUsage.promptTokens,
      completionTokens: creativeUsage.completionTokens + settleUsage.completionTokens,
      totalTokens: creativeUsage.totalTokens + settleUsage.totalTokens,
    };

    return {
      chapterNumber,
      title: creative.title,
      content: surfaceNormalizedContent,
      wordCount: surfaceNormalizedWordCount,
      preWriteCheck: creative.preWriteCheck,
      postSettlement: settlement.postSettlement,
      runtimeStateDelta: resolvedRuntimeStateDelta,
      runtimeStateSnapshot: runtimeStateArtifacts?.snapshot ?? settlement.runtimeStateSnapshot,
      updatedState: runtimeStateArtifacts?.currentStateMarkdown ?? settlement.updatedState,
      updatedLedger: settlement.updatedLedger,
      updatedHooks: runtimeStateArtifacts?.hooksMarkdown ?? settlement.updatedHooks,
      chapterSummary: resolvedRuntimeStateDelta
        ? this.renderDeltaSummaryRow(resolvedRuntimeStateDelta)
        : settlement.chapterSummary,
      updatedChapterSummaries: runtimeStateArtifacts?.chapterSummariesMarkdown,
      updatedSubplots: settlement.updatedSubplots,
      updatedEmotionalArcs: settlement.updatedEmotionalArcs,
      updatedCharacterMatrix: settlement.updatedCharacterMatrix,
      postWriteErrors,
      postWriteWarnings,
      hookHealthIssues,
      writerPromptHash: creativeManifest.promptHash,
      tokenUsage,
    };
  }

  async settleChapterState(input: SettleChapterStateInput): Promise<WriteChapterOutput> {
    const [
      currentState,
      ledger,
      hooks,
      chapterSummaries,
      subplotBoard,
      emotionalArcs,
      characterMatrix,
      volumeOutline,
    ] = await Promise.all([
      // Phase 5 consolidation fallback: derive initial state when only seed on disk.
      readCurrentStateWithFallback(input.bookDir, "(文件尚未创建)"),
      this.readFileOrDefault(join(input.bookDir, "story/particle_ledger.md")),
      this.readFileOrDefault(join(input.bookDir, "story/pending_hooks.md")),
      this.readFileOrDefault(join(input.bookDir, "story/chapter_summaries.md")),
      this.readFileOrDefault(join(input.bookDir, "story/subplot_board.md")),
      this.readFileOrDefault(join(input.bookDir, "story/emotional_arcs.md")),
      readCharacterContext(input.bookDir, "(文件尚未创建)"),
      readVolumeMap(input.bookDir, "(文件尚未创建)"),
    ]);

    const { profile: genreProfile } = await readGenreProfile(this.ctx.projectRoot, input.book.genre);
    const parsedBookRules = await readBookRules(input.bookDir);
    const bookRules = parsedBookRules?.rules ?? null;
    const resolvedLanguage = input.book.language ?? genreProfile.language;
    const governedMemoryBlocks = input.contextPackage
      ? buildGovernedMemoryEvidenceBlocks(input.contextPackage, resolvedLanguage)
      : undefined;

    const settleResult = await this.settle({
      book: input.book,
      genreProfile,
      bookRules,
      chapterNumber: input.chapterNumber,
      title: input.title,
      content: input.content,
      currentState,
      ledger: genreProfile.numericalSystem ? ledger : "",
      hooks,
      chapterSummaries,
      subplotBoard,
      emotionalArcs,
      characterMatrix,
      volumeOutline,
      selectedEvidenceBlock: governedMemoryBlocks
        ? this.joinGovernedEvidenceBlocks(governedMemoryBlocks)
        : undefined,
      chapterIntent: input.chapterIntent,
      contextPackage: input.contextPackage,
      ruleStack: input.ruleStack,
      validationFeedback: input.validationFeedback,
      originalHooks: hooks,
      originalSubplots: subplotBoard,
      originalEmotionalArcs: emotionalArcs,
      originalCharacterMatrix: characterMatrix,
    });
    const settlement = settleResult.settlement;
    const runtimeStateArtifacts = await this.buildRuntimeStateArtifactsIfPresent(
      input.bookDir,
      settlement.runtimeStateDelta,
      resolvedLanguage,
      input.chapterNumber,
      input.allowReapply,
    );

    return {
      chapterNumber: input.chapterNumber,
      title: input.title,
      content: input.content,
      wordCount: countChapterLength(
        input.content,
        resolvedLanguage === "en" ? "en_words" : "zh_chars",
      ),
      preWriteCheck: "",
      postSettlement: settlement.postSettlement,
      runtimeStateDelta: runtimeStateArtifacts?.resolvedDelta ?? settlement.runtimeStateDelta,
      runtimeStateSnapshot: runtimeStateArtifacts?.snapshot ?? settlement.runtimeStateSnapshot,
      updatedState: runtimeStateArtifacts?.currentStateMarkdown ?? settlement.updatedState,
      updatedLedger: settlement.updatedLedger,
      updatedHooks: runtimeStateArtifacts?.hooksMarkdown ?? settlement.updatedHooks,
      chapterSummary: settlement.runtimeStateDelta
        ? this.renderDeltaSummaryRow(settlement.runtimeStateDelta)
        : settlement.chapterSummary,
      updatedChapterSummaries: runtimeStateArtifacts?.chapterSummariesMarkdown,
      updatedSubplots: settlement.updatedSubplots,
      updatedEmotionalArcs: settlement.updatedEmotionalArcs,
      updatedCharacterMatrix: settlement.updatedCharacterMatrix,
      postWriteErrors: [],
      postWriteWarnings: [],
      tokenUsage: settleResult.usage,
    };
  }

  private async settle(params: SettlementParams): Promise<{
    settlement: ReturnType<typeof parseSettlementOutput> & {
      runtimeStateDelta?: RuntimeStateDelta;
      runtimeStateSnapshot?: RuntimeStateSnapshot;
    };
    usage: TokenUsage;
  }> {
    const host: SettlementHost = {
      name: this.name,
      ctx: this.ctx,
      log: this.log,
      chat: (msgs, opts) => this.chat(msgs, opts),
      logInfo: (l, m) => this.logInfo(l, m),
      localize: (l, m) => this.localize(l, m),
      capLegacyContext: (label, content, maxChars) => this.capLegacyContext(label, content, maxChars),
    };
    return runSettlementPhase(host, params);
  }

  async saveChapter(
    bookDir: string,
    output: WriteChapterOutput,
    numericalSystem: boolean = true,
    language: "zh" | "en" = "zh",
  ): Promise<void> {
    const deps: SaveChapterDeps = {
      resolveRuntimeStateArtifactsForOutput: this.resolveRuntimeStateArtifactsForOutput.bind(this),
    };
    return saveWriterChapter(deps, bookDir, output, numericalSystem, language);
  }

  private buildUserPrompt(params: {
    readonly chapterNumber: number;
    readonly storyBible: string;
    readonly currentState: string;
    readonly ledger: string;
    readonly hooks: string;
    readonly recentChapters: string;
    readonly lengthSpec: LengthSpec;
    readonly externalContext?: string;
    readonly chapterSummaries: string;
    readonly subplotBoard: string;
    readonly emotionalArcs: string;
    readonly characterMatrix: string;
    readonly dialogueFingerprints?: string;
    readonly relevantSummaries?: string;
    readonly parentCanon?: string;
    readonly language?: "zh" | "en";
  }): string {
    const currentState = this.capLegacyContext("current_state", params.currentState, LEGACY_WRITER_CONTEXT_BUDGET.currentState);
    const ledger = this.capLegacyContext("particle_ledger", params.ledger, LEGACY_WRITER_CONTEXT_BUDGET.ledger);
    const hooks = this.capLegacyContext("pending_hooks", params.hooks, LEGACY_WRITER_CONTEXT_BUDGET.hooks);
    const chapterSummaries = this.capLegacyContext(
      "chapter_summaries",
      params.chapterSummaries,
      LEGACY_WRITER_CONTEXT_BUDGET.chapterSummaries,
    );
    const subplotBoard = this.capLegacyContext("subplot_board", params.subplotBoard, LEGACY_WRITER_CONTEXT_BUDGET.subplotBoard);
    const emotionalArcs = this.capLegacyContext("emotional_arcs", params.emotionalArcs, LEGACY_WRITER_CONTEXT_BUDGET.emotionalArcs);
    const characterMatrix = this.capLegacyContext(
      "character_matrix",
      params.characterMatrix,
      LEGACY_WRITER_CONTEXT_BUDGET.characterMatrix,
    );
    const storyBible = this.capLegacyContext("story_bible", params.storyBible, LEGACY_WRITER_CONTEXT_BUDGET.storyBible);
    const parentCanon = params.parentCanon
      ? this.capLegacyContext("parent_canon", params.parentCanon, LEGACY_WRITER_CONTEXT_BUDGET.parentCanon)
      : undefined;
    const contextBlock = params.externalContext
      ? `\n## 外部指令\n以下是来自外部系统的创作指令，请在本章中融入：\n\n${params.externalContext}\n`
      : "";

    const ledgerBlock = ledger
      ? `\n## 资源账本\n${ledger}\n`
      : "";

    const summariesBlock = chapterSummaries !== "(文件尚未创建)"
      ? `\n## 章节摘要（全部历史章节压缩上下文）\n${chapterSummaries}\n`
      : "";

    const subplotBlock = subplotBoard !== "(文件尚未创建)"
      ? `\n## 支线进度板\n${subplotBoard}\n`
      : "";

    const emotionalBlock = emotionalArcs !== "(文件尚未创建)"
      ? `\n## 情感弧线\n${emotionalArcs}\n`
      : "";

    const matrixBlock = characterMatrix !== "(文件尚未创建)"
      ? `\n## 角色交互矩阵\n${characterMatrix}\n`
      : "";

    const fingerprintBlock = params.dialogueFingerprints
      ? `\n## 角色对话指纹\n${params.dialogueFingerprints}\n`
      : "";

    const relevantBlock = params.relevantSummaries
      ? `\n## 相关历史章节摘要\n${params.relevantSummaries}\n`
      : "";

    const canonBlock = parentCanon
      ? `\n## 正传正典参照（番外写作专用）
本书是番外作品。以下正典约束不可违反，角色不得引用超出其信息边界的信息。
${parentCanon}\n`
      : "";
    const lengthRequirementBlock = this.buildLengthRequirementBlock(params.lengthSpec, params.language ?? "zh");

    if (params.language === "en") {
      return `Write chapter ${params.chapterNumber}.
${contextBlock}
## Current State
${currentState}
${ledgerBlock}
## Plot Threads
${hooks}
${summariesBlock}${subplotBlock}${emotionalBlock}${matrixBlock}${fingerprintBlock}${relevantBlock}${canonBlock}
## Recent Chapters
${params.recentChapters || "(This is the first chapter, no previous text)"}

## Worldbuilding
${storyBible}

${lengthRequirementBlock}
- Output PRE_WRITE_CHECK first, then the chapter
- Output only PRE_WRITE_CHECK, CHAPTER_TITLE, and CHAPTER_CONTENT blocks`;
    }

    return `请续写第${params.chapterNumber}章。
${contextBlock}
## 当前状态卡
${currentState}
${ledgerBlock}
## 伏笔池
${hooks}
${summariesBlock}${subplotBlock}${emotionalBlock}${matrixBlock}${fingerprintBlock}${relevantBlock}${canonBlock}
## 最近章节
${params.recentChapters || "(这是第一章，无前文)"}

## 世界观设定
${storyBible}

${lengthRequirementBlock}
- 先输出写作自检表，再写正文
      - 只需输出 PRE_WRITE_CHECK、CHAPTER_TITLE、CHAPTER_CONTENT 三个区块`;
  }

  private capLegacyContext(label: string, content: string, maxChars: number): string {
    return capContextBlock(content, { label, maxChars });
  }

  private buildGovernedUserPrompt(params: {
    readonly chapterNumber: number;
    readonly chapterMemo: ChapterMemo;
    readonly chapterIntentData?: ChapterIntent;
    readonly contextPackage: ContextPackage;
    readonly ruleStack: RuleStack;
    readonly externalContext?: string;
    readonly lengthSpec: LengthSpec;
    readonly language?: "zh" | "en";
    readonly varianceBrief?: string;
    readonly selectedEvidenceBlock?: string;
    readonly openingFrame?: OpeningFrame;
    readonly closingFrame?: ClosingFrame;
    readonly pathConstraints?: PathConstraints;
  }): string {
    const language = params.language ?? "zh";
    const contextSections = renderNarrativeSelectedContext(
      params.contextPackage.selectedContext,
      language,
    );

    const diagnosticLines = params.ruleStack.sections.diagnostic.length > 0
      ? params.ruleStack.sections.diagnostic.join(", ")
      : "none";

    const lengthRequirementBlock = this.buildLengthRequirementBlock(params.lengthSpec, params.language ?? "zh");
    const varianceBlock = params.varianceBrief
      ? `\n${params.varianceBrief}\n`
      : "";
    const selectedEvidenceBlock = params.selectedEvidenceBlock
      ? `\n${sanitizeNarrativeEvidenceBlock(params.selectedEvidenceBlock, language)}\n`
      : "";
    const chapterContextBlock = this.buildChapterContextBlock(params.externalContext, language);
    const briefNarrative = renderMemoAsNarrativeBlock(params.chapterMemo, params.chapterIntentData, language);

    // ── Endpoint Lock section ──
    const endpointLockBlock = buildEndpointLockSection(
      params.openingFrame,
      params.closingFrame,
      params.pathConstraints,
    );

    if (params.language === "en") {
      return `Write chapter ${params.chapterNumber}.

${chapterContextBlock}

${briefNarrative}

## Selected Context
${contextSections || "(none)"}
${selectedEvidenceBlock}

## Rule Stack
- Hard: ${params.ruleStack.sections.hard.join(", ") || "(none)"}
- Soft: ${params.ruleStack.sections.soft.join(", ") || "(none)"}
- Diagnostic: ${diagnosticLines}

${varianceBlock}
${endpointLockBlock ? `\n${endpointLockBlock}\n` : ""}
${lengthRequirementBlock}
- Output PRE_WRITE_CHECK first, then the chapter
- Output only PRE_WRITE_CHECK, CHAPTER_TITLE, and CHAPTER_CONTENT blocks`;
    }

    return `请续写第${params.chapterNumber}章。

${chapterContextBlock}

${briefNarrative}

## 已选上下文
${contextSections || "(无)"}
${selectedEvidenceBlock}

## 规则栈
- 硬护栏：${params.ruleStack.sections.hard.join("、") || "(无)"}
- 软约束：${params.ruleStack.sections.soft.join("、") || "(无)"}
- 诊断规则：${diagnosticLines}

${varianceBlock}
${endpointLockBlock ? `\n${endpointLockBlock}\n` : ""}
${lengthRequirementBlock}
- 先输出写作自检表，再写正文
- 只需输出 PRE_WRITE_CHECK、CHAPTER_TITLE、CHAPTER_CONTENT 三个区块`;
  }

  private buildChapterContextBlock(externalContext: string | undefined, language: "zh" | "en"): string {
    const trimmed = externalContext?.trim();
    if (!trimmed) return "";
    if (language === "en") {
      return `## Per-chapter user instruction (highest priority)
${trimmed}

Obey this direct instruction for the current chapter. If it specifies a chapter title, use that title exactly in CHAPTER_TITLE. Keep continuity, but do not replace this instruction with the outline fallback.`;
    }
    return `## 本章用户指令（最高优先级）
${trimmed}

这是用户对当前章节的直接指令。若其中指定章节标题，CHAPTER_TITLE 必须原样使用该标题。保持连续性，但不要用卷纲兜底替换这条指令。`;
  }

  private joinGovernedEvidenceBlocks(blocks: ReturnType<typeof buildGovernedMemoryEvidenceBlocks> | undefined): string | undefined {
    if (!blocks) {
      return undefined;
    }

    const joined = [
      blocks.titleHistoryBlock,
      blocks.moodTrailBlock,
      blocks.canonBlock,
      blocks.hookDebtBlock,
      blocks.hooksBlock,
      blocks.summariesBlock,
      blocks.volumeSummariesBlock,
    ]
      .filter((block): block is string => Boolean(block))
      .join("\n");

    return joined || undefined;
  }

  private buildSettlerGovernedControlBlock(
    chapterIntent: string,
    contextPackage: ContextPackage,
    ruleStack: RuleStack,
    language: "zh" | "en",
  ): string {
    return buildSettlerGovernedControlBlock(chapterIntent, contextPackage, ruleStack, language);
  }

  /**
   * Soft-check that the LLM's PRE_WRITE_CHECK output references the three
   * non-negotiable memo sections: 当前任务, 不要做, 章尾必须发生的改变.
   *
   * This is NOT a hard gate — the memo was already parse-validated in the
   * planner, and the writer prompt already tells the LLM to align to memo.
   * We only warn when the LLM skipped a section, so the chapter still ships.
   */
  private verifyPreWriteCheckAlignsWithMemo(
    preWriteCheck: string,
    chapterNumber: number,
    language: "zh" | "en",
  ): void {
    return verifyPreWriteCheckAlignsWithMemoFn(
      { logWarn: (l, m) => this.logWarn(l, m) },
      preWriteCheck,
      chapterNumber,
      language,
    );
  }

  private buildLengthRequirementBlock(lengthSpec: LengthSpec, language: "zh" | "en"): string {
    if (language === "en") {
      return `Requirements:
- Target length: ${lengthSpec.target} words
- Acceptable range: ${lengthSpec.softMin}-${lengthSpec.softMax} words`;
    }

    return `要求：
- 目标字数：${lengthSpec.target}字
- 允许区间：${lengthSpec.softMin}-${lengthSpec.softMax}字`;
  }

  private async loadRecentChapters(
    bookDir: string,
    currentChapter: number,
    count = 1,
  ): Promise<string> {
    return loadWriterRecentChapters(bookDir, currentChapter, count);
  }

  private async readFileOrDefault(path: string): Promise<string> {
    return readWriterFileOrDefault(path);
  }

  /** Save new truth files (summaries, subplots, emotional arcs, character matrix). */
  async saveNewTruthFiles(
    bookDir: string,
    output: WriteChapterOutput,
    language: "zh" | "en" = "zh",
  ): Promise<void> {
    return saveWriterTruthFiles(
      (storyDir, summary, lang) => appendWriterChapterSummary(storyDir, summary, lang),
      bookDir,
      output,
      language,
    );
  }

  private renderDeltaSummaryRow(delta: RuntimeStateDelta): string {
    return renderWriterDeltaSummaryRow(delta);
  }

  private normalizeRuntimeStateDeltaChapter(
    delta: RuntimeStateDelta,
    authoritativeChapterNumber: number,
  ): RuntimeStateDelta {
    return normalizeWriterRuntimeStateDeltaChapter(delta, authoritativeChapterNumber);
  }

  private async buildRuntimeStateArtifactsIfPresent(
    bookDir: string,
    delta: RuntimeStateDelta | undefined,
    language: "zh" | "en",
    authoritativeChapterNumber?: number,
    allowReapply?: boolean,
  ): Promise<RuntimeStateArtifacts | null> {
    return buildWriterRuntimeStateArtifactsIfPresent(bookDir, delta, language, authoritativeChapterNumber, allowReapply);
  }

  private async resolveRuntimeStateArtifactsForOutput(
    bookDir: string,
    output: WriteChapterOutput,
    language: "zh" | "en",
  ): Promise<RuntimeStateArtifacts | null> {
    return resolveWriterRuntimeStateArtifactsForOutput(bookDir, output, language);
  }

  private async appendChapterSummary(
    storyDir: string,
    summary: string,
    language: "zh" | "en",
  ): Promise<void> {
    return appendWriterChapterSummary(storyDir, summary, language);
  }

  private buildStyleFingerprint(styleProfileRaw: string): string | undefined {
    return buildWriterStyleFingerprint(styleProfileRaw);
  }


  /**
   * Extract dialogue fingerprints from recent chapters.
   * For each character with multiple dialogue lines, compute speaking style markers.
   */
  // P1-12: Module-level regex cache — avoids recompilation on every call
  private static readonly DIALOGUE_REGEX =
    /(?:(.{1,6})(?:说道|道|喝道|冷声道|笑道|怒道|低声道|大声道|喝骂道|冷笑道|沉声道|喊道|叫道|问道|答道)\s*[：:]\s*["""「]([^"""」]+)["""」])|["""「]([^"""」]{2,})["""」]|"([^"]{2,})"/g;

  private extractDialogueFingerprints(recentChapters: string, _storyBible: string): string {
    return extractWriterDialogueFingerprints(recentChapters);
  }

  /**
   * Load persisted voice profiles from story/voice_profiles/ and build a
   * compact summary block for the writer prompt. Each character gets at most
   * a single line describing their voice signature.
   */
  private async loadVoiceProfiles(bookDir: string): Promise<string | undefined> {
    return loadWriterVoiceProfiles(bookDir);
  }

  /**
   * Find relevant chapter summaries based on volume outline context.
   * Extracts character names and hook IDs from the current volume's outline,
   * then searches chapter summaries for matching entries.
   */
  private findRelevantSummaries(
    chapterSummaries: string,
    volumeOutline: string,
    chapterNumber: number,
  ): string {
    return findWriterRelevantSummaries(chapterSummaries, volumeOutline, chapterNumber);
  }

  private sanitizeFilename(title: string): string {
    return sanitizeWriterFilename(title);
  }
}
