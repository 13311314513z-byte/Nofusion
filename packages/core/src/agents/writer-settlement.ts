/**
 * writer-settlement.ts — settle(), buildSettlerGovernedControlBlock, verifyPreWriteCheckAlignsWithMemo
 * extracted from writer.ts (Phase 5). Uses SettlementHost for LLM orchestration dependencies.
 */
import { buildObserverSystemPrompt, buildObserverUserPrompt } from "./observer-prompts.js";
import { buildSettlerSystemPrompt, buildSettlerUserPrompt } from "./settler-prompts.js";
import { parseSettlerDeltaOutput } from "./settler-delta-parser.js";
import { parseSettlementOutput } from "./settler-parser.js";
import { buildPromptManifest, getAvailableInputTokens, type PromptFragment } from "../models/prompt-manifest.js";
import { logPromptManifest } from "../utils/prompt-tracing.js";
import { mergeTableMarkdownByKey, mergeCharacterMatrixMarkdown } from "../utils/governed-working-set.js";
import {
  LEGACY_WRITER_CONTEXT_BUDGET,
  type TokenUsage,
} from "./writer-types.js";
import type { Logger } from "../utils/logger.js";
import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { BookRules } from "../models/book-rules.js";
import type { ContextPackage, RuleStack } from "../models/input-governance.js";
import type { RuntimeStateDelta } from "../models/runtime-state.js";
import type { RuntimeStateSnapshot } from "../state/state-reducer.js";
import { renderNarrativeSelectedContext, buildNarrativeIntentBrief } from "../utils/narrative-control.js";

// ─── SettlementHost — narrow interface for LLM orchestration ─────────────────

export interface SettlementHost {
  readonly name: string;
  readonly ctx: { model: string };
  readonly log?: Logger;
  chat(
    messages: Array<{ role: "system" | "user"; content: string }>,
    options: { temperature: number },
  ): Promise<{
    content: string;
    usage: TokenUsage;
    stopReason?: string;
  }>;
  logInfo(language: "zh" | "en", messages: { zh: string; en: string }): void;
  localize(language: "zh" | "en", messages: { zh: string; en: string }): string;
  capLegacyContext(label: string, content: string, maxChars: number): string;
}

// ─── buildSettlerGovernedControlBlock ────────────────────────────────────────

export function buildSettlerGovernedControlBlock(
  chapterIntent: string,
  contextPackage: ContextPackage,
  ruleStack: RuleStack,
  language: "zh" | "en",
): string {
  const selectedContext = renderNarrativeSelectedContext(contextPackage.selectedContext, language)
    .replace(/^### /gm, "- ");
  const overrides = ruleStack.activeOverrides.length > 0
    ? ruleStack.activeOverrides
      .map((override) => `- ${override.from} -> ${override.to}: ${override.reason} (${override.target})`)
      .join("\n")
    : "- none";
  const narrativeIntent = buildNarrativeIntentBrief(chapterIntent, language);

  if (language === "en") {
    return `\n## Chapter Control Inputs
${narrativeIntent || "(none)"}

### Selected Context
${selectedContext || "- none"}

### Rule Stack
- Hard guardrails: ${ruleStack.sections.hard.join(", ") || "(none)"}
- Soft constraints: ${ruleStack.sections.soft.join(", ") || "(none)"}
- Diagnostic rules: ${ruleStack.sections.diagnostic.join(", ") || "(none)"}

### Active Overrides
${overrides}\n`;
  }

  return `\n## 本章控制输入
${narrativeIntent || "(无)"}

### 已选上下文
${selectedContext || "- none"}

### 规则栈
- 硬护栏：${ruleStack.sections.hard.join("、") || "(无)"}
- 软约束：${ruleStack.sections.soft.join("、") || "(无)"}
- 诊断规则：${ruleStack.sections.diagnostic.join("、") || "(无)"}

### 当前覆盖
${overrides}\n`;
}

// ─── verifyPreWriteCheckAlignsWithMemo ──────────────────────────────────────

export function verifyPreWriteCheckAlignsWithMemo(
  host: { logWarn(language: "zh" | "en", messages: { zh: string; en: string }): void },
  preWriteCheck: string,
  chapterNumber: number,
  language: "zh" | "en",
): void {
  if (!preWriteCheck || preWriteCheck.trim().length === 0) {
    host.logWarn(language, {
      zh: `第${chapterNumber}章 PRE_WRITE_CHECK 为空，无法对齐 chapter_memo`,
      en: `Chapter ${chapterNumber} PRE_WRITE_CHECK is empty; cannot verify memo alignment`,
    });
    return;
  }

  const missing: string[] = [];
  if (!preWriteCheck.includes("当前任务")) missing.push("当前任务");
  if (!preWriteCheck.includes("不要做")) missing.push("不要做");
  if (!preWriteCheck.includes("章尾")) missing.push("章尾必须发生的改变");

  if (missing.length > 0) {
    host.logWarn(language, {
      zh: `第${chapterNumber}章 PRE_WRITE_CHECK 缺少 memo 章节检查：${missing.join("、")}`,
      en: `Chapter ${chapterNumber} PRE_WRITE_CHECK missing memo sections: ${missing.join(", ")}`,
    });
  }
}

// ─── SettlementParams (extracted from settle() signature) ────────────────────

export interface SettlementParams {
  readonly book: BookConfig;
  readonly genreProfile: GenreProfile;
  readonly bookRules: BookRules | null;
  readonly chapterNumber: number;
  readonly title: string;
  readonly content: string;
  readonly currentState: string;
  readonly ledger: string;
  readonly hooks: string;
  readonly chapterSummaries: string;
  readonly subplotBoard: string;
  readonly emotionalArcs: string;
  readonly characterMatrix: string;
  readonly volumeOutline: string;
  readonly selectedEvidenceBlock?: string;
  readonly chapterIntent?: string;
  readonly contextPackage?: ContextPackage;
  readonly ruleStack?: RuleStack;
  readonly validationFeedback?: string;
  readonly originalHooks: string;
  readonly originalSubplots: string;
  readonly originalEmotionalArcs: string;
  readonly originalCharacterMatrix: string;
}

export interface SettlementResult {
  settlement: ReturnType<typeof parseSettlementOutput> & {
    runtimeStateDelta?: RuntimeStateDelta;
    runtimeStateSnapshot?: RuntimeStateSnapshot;
  };
  usage: TokenUsage;
}

// ─── runSettlementPhase ─────────────────────────────────────────────────────

export async function runSettlementPhase(
  host: SettlementHost,
  params: SettlementParams,
): Promise<SettlementResult> {
  // Phase 2a: Observer — extract all facts from the chapter
  const resolvedLang = params.book.language ?? params.genreProfile.language;
  const observerSystem = buildObserverSystemPrompt(params.book, params.genreProfile, resolvedLang);
  const observerUser = buildObserverUserPrompt(params.chapterNumber, params.title, params.content, resolvedLang);

  host.logInfo(resolvedLang, {
    zh: `阶段 2a：提取第${params.chapterNumber}章事实`,
    en: `Phase 2a: observing facts for chapter ${params.chapterNumber}`,
  });
  const maxTokensObs = getAvailableInputTokens(host.ctx.model);
  const obsSysFragment: PromptFragment = {
    id: "writer-observer-system",
    source: "writer-observer",
    role: "system",
    slot: "system-prompt",
    priority: 100,
    content: observerSystem,
    optional: false,
    estimatedTokens: Math.ceil(observerSystem.length / 4),
  };
  const obsUserFragment: PromptFragment = {
    id: "writer-observer-user",
    source: "writer-observer",
    role: "user",
    slot: "user-message",
    priority: 90,
    content: observerUser,
    optional: false,
    estimatedTokens: Math.ceil(observerUser.length / 4),
  };
  const observerManifest = buildPromptManifest({
    stage: `${host.name}.observer`,
    fragments: [obsSysFragment, obsUserFragment],
    maxAllowedInputTokens: maxTokensObs,
  });
  if (observerManifest.droppedFragments.length > 0) {
    host.log?.warn(`[writer.observer] Fragment(s) dropped: ${observerManifest.droppedFragments.map((d) => d.fragmentId).join(", ")}`);
  }
  const observerMessages: Array<{ role: "system" | "user"; content: string }> = [];
  for (const frag of observerManifest.fragments) {
    if (frag.role === "system" || frag.role === "user") {
      observerMessages.push({ role: frag.role, content: frag.content });
    }
  }
  logPromptManifest(`${host.name}.observer`, observerMessages, host.ctx.model, host.log);

  const observerResponse = await host.chat(observerMessages, { temperature: 0.5 });
  const observations = observerResponse.content;

  // Phase 2b: Reflector — merge observations into truth files
  host.logInfo(resolvedLang, {
    zh: "阶段 2b：把观察结果回写到真相文件",
    en: "Phase 2b: reflecting observations into truth files",
  });
  const settlerSystem = buildSettlerSystemPrompt(
    params.book, params.genreProfile, params.bookRules, resolvedLang,
  );
  const governedControlBlock = params.chapterIntent && params.contextPackage && params.ruleStack
    ? buildSettlerGovernedControlBlock(
        params.chapterIntent,
        params.contextPackage,
        params.ruleStack,
        resolvedLang,
      )
    : undefined;

  const settlerUser = buildSettlerUserPrompt({
    chapterNumber: params.chapterNumber,
    title: params.title,
    content: params.content,
    currentState: host.capLegacyContext("current_state", params.currentState, LEGACY_WRITER_CONTEXT_BUDGET.currentState),
    ledger: host.capLegacyContext("particle_ledger", params.ledger, LEGACY_WRITER_CONTEXT_BUDGET.ledger),
    hooks: host.capLegacyContext("pending_hooks", params.hooks, LEGACY_WRITER_CONTEXT_BUDGET.hooks),
    chapterSummaries: host.capLegacyContext(
      "chapter_summaries",
      params.chapterSummaries,
      LEGACY_WRITER_CONTEXT_BUDGET.chapterSummaries,
    ),
    subplotBoard: host.capLegacyContext("subplot_board", params.subplotBoard, LEGACY_WRITER_CONTEXT_BUDGET.subplotBoard),
    emotionalArcs: host.capLegacyContext("emotional_arcs", params.emotionalArcs, LEGACY_WRITER_CONTEXT_BUDGET.emotionalArcs),
    characterMatrix: host.capLegacyContext(
      "character_matrix",
      params.characterMatrix,
      LEGACY_WRITER_CONTEXT_BUDGET.characterMatrix,
    ),
    volumeOutline: host.capLegacyContext("volume_outline", params.volumeOutline, LEGACY_WRITER_CONTEXT_BUDGET.volumeOutline),
    observations,
    selectedEvidenceBlock: params.selectedEvidenceBlock,
    governedControlBlock,
    validationFeedback: params.validationFeedback,
  });

  const maxTokensSet = getAvailableInputTokens(host.ctx.model);
  const setSysFragment: PromptFragment = {
    id: "writer-settler-system",
    source: "writer-settler",
    role: "system",
    slot: "system-prompt",
    priority: 100,
    content: settlerSystem,
    optional: false,
    estimatedTokens: Math.ceil(settlerSystem.length / 4),
  };
  const setUserFragment: PromptFragment = {
    id: "writer-settler-user",
    source: "writer-settler",
    role: "user",
    slot: "user-message",
    priority: 90,
    content: settlerUser,
    optional: false,
    estimatedTokens: Math.ceil(settlerUser.length / 4),
  };
  const settlerManifest = buildPromptManifest({
    stage: `${host.name}.settler`,
    fragments: [setSysFragment, setUserFragment],
    maxAllowedInputTokens: maxTokensSet,
  });
  if (settlerManifest.droppedFragments.length > 0) {
    host.log?.warn(`[writer.settler] Fragment(s) dropped: ${settlerManifest.droppedFragments.map((d) => d.fragmentId).join(", ")}`);
  }
  const settlerMessages: Array<{ role: "system" | "user"; content: string }> = [];
  for (const frag of settlerManifest.fragments) {
    if (frag.role === "system" || frag.role === "user") {
      settlerMessages.push({ role: frag.role, content: frag.content });
    }
  }
  logPromptManifest(`${host.name}.settler`, settlerMessages, host.ctx.model, host.log);

  const response = await host.chat(settlerMessages, { temperature: 0.3 });

  let mergedSettlement: ReturnType<typeof parseSettlementOutput> & {
    runtimeStateDelta?: RuntimeStateDelta;
    runtimeStateSnapshot?: RuntimeStateSnapshot;
  };
  try {
    const deltaOutput = parseSettlerDeltaOutput(response.content);
    mergedSettlement = {
      postSettlement: deltaOutput.postSettlement,
      runtimeStateDelta: deltaOutput.runtimeStateDelta,
      updatedState: "",
      updatedLedger: "",
      updatedHooks: "",
      chapterSummary: "",
      updatedSubplots: "",
      updatedEmotionalArcs: "",
      updatedCharacterMatrix: "",
    };
  } catch {
    const settlement = parseSettlementOutput(response.content, params.genreProfile);
    mergedSettlement = governedControlBlock
      ? {
          ...settlement,
          updatedHooks: mergeTableMarkdownByKey(params.originalHooks, settlement.updatedHooks, [0]),
          updatedSubplots: settlement.updatedSubplots
            ? mergeTableMarkdownByKey(params.originalSubplots, settlement.updatedSubplots, [0])
            : settlement.updatedSubplots,
          updatedEmotionalArcs: settlement.updatedEmotionalArcs
            ? mergeTableMarkdownByKey(params.originalEmotionalArcs, settlement.updatedEmotionalArcs, [0, 1])
            : settlement.updatedEmotionalArcs,
          updatedCharacterMatrix: settlement.updatedCharacterMatrix
            ? mergeCharacterMatrixMarkdown(params.originalCharacterMatrix, settlement.updatedCharacterMatrix)
            : settlement.updatedCharacterMatrix,
        }
      : settlement;
  }

  return {
    settlement: mergedSettlement,
    usage: response.usage,
  };
}
