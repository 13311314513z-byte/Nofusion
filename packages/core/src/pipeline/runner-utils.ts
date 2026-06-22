/**
 * runner-utils.ts — cross-cutting utilities extracted from runner.ts (Phase 2).
 * Length warnings, telemetry, audit drift, webhook, and content assertions.
 */
import { join } from "node:path";
import { readFile, writeFile, rm } from "node:fs/promises";
import { LengthNormalizerAgent } from "../agents/length-normalizer.js";
import { countChapterLength, isOutsideHardRange, type LengthLanguage } from "../utils/length-metrics.js";
import { stripAuditDriftCorrectionBlock } from "./audit-helpers.js";
import { dispatchWebhookEvent } from "../notify/dispatcher.js";
import type { NotifyChannel } from "../models/project.js";
import type { WebhookEvent } from "../notify/webhook.js";
import type { LLMClient } from "../llm/provider.js";
import type { LengthSpec, LengthTelemetry } from "../models/length-governance.js";
import type { AgentContext } from "../agents/base.js";
import type { AuditIssue } from "../agents/continuity.js";

// ─── Host interface ──────────────────────────────────────────────────────────

export interface UtilsHost {
  readonly config: {
    client: LLMClient;
    model: string;
    logger?: { info(msg: string): void; warn(msg: string): void };
    notifyChannels?: ReadonlyArray<NotifyChannel>;
  };
  localize(language: LengthLanguage, messages: { zh: string; en: string }): string;
  languageFromLengthSpec(lengthSpec: Pick<LengthSpec, "countingMode">): LengthLanguage;
  agentCtxFor(agent: string, bookId?: string): AgentContext;
  logWarn(language: LengthLanguage, message: { zh: string; en: string }): void;
  logInfo(language: LengthLanguage, message: { zh: string; en: string }): void;
}

// ─── assertChapterContentNotEmpty ────────────────────────────────────────────

export function assertChapterContentNotEmpty(content: string, chapterNumber: number, stage: string): void {
  if (content.trim().length > 0) return;
  throw new Error(`Chapter ${chapterNumber} has empty chapter content after ${stage}`);
}

// ─── buildLengthWarnings ─────────────────────────────────────────────────────

export function buildLengthWarnings(
  host: UtilsHost,
  chapterNumber: number,
  finalCount: number,
  lengthSpec: LengthSpec,
): string[] {
  if (!isOutsideHardRange(finalCount, lengthSpec)) {
    return [];
  }
  return [
    host.localize(host.languageFromLengthSpec(lengthSpec), {
      zh: `第${chapterNumber}章经过一次字数归一化后仍超出硬区间（${lengthSpec.hardMin}-${lengthSpec.hardMax}，实际 ${finalCount}）。`,
      en: `Chapter ${chapterNumber} remains outside hard range (${lengthSpec.hardMin}-${lengthSpec.hardMax}, actual ${finalCount}) after a single normalization pass.`,
    }),
  ];
}

// ─── buildLengthTelemetry ────────────────────────────────────────────────────

export function buildLengthTelemetry(params: {
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

// ─── logLengthWarnings ───────────────────────────────────────────────────────

export function logLengthWarnings(
  host: UtilsHost,
  lengthWarnings: ReadonlyArray<string>,
): void {
  for (const warning of lengthWarnings) {
    host.config.logger?.warn(warning);
  }
}

// ─── normalizeDraftLengthIfNeeded ────────────────────────────────────────────

export async function normalizeDraftLengthIfNeeded(
  host: UtilsHost,
  params: {
    bookId: string;
    chapterNumber: number;
    chapterContent: string;
    lengthSpec: LengthSpec;
    chapterIntent?: string;
  },
): Promise<{
  content: string;
  wordCount: number;
  applied: boolean;
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
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
    host.agentCtxFor("length-normalizer", params.bookId),
  );
  const normalized = await normalizer.normalizeChapter({
    chapterContent: params.chapterContent,
    lengthSpec: params.lengthSpec,
    chapterIntent: params.chapterIntent,
  });

  // Safety net: if normalizer output is less than 25% of original, it was too destructive.
  if (normalized.finalCount < writerCount * 0.25) {
    host.logWarn(host.languageFromLengthSpec(params.lengthSpec), {
      zh: `字数归一化被拒绝：第${params.chapterNumber}章 ${writerCount} -> ${normalized.finalCount}（砍了${Math.round((1 - normalized.finalCount / writerCount) * 100)}%，超过安全阈值）`,
      en: `Length normalization rejected for chapter ${params.chapterNumber}: ${writerCount} -> ${normalized.finalCount} (cut ${Math.round((1 - normalized.finalCount / writerCount) * 100)}%, exceeds safety threshold)`,
    });
    return {
      content: params.chapterContent,
      wordCount: writerCount,
      applied: false,
    };
  }

  host.logInfo(host.languageFromLengthSpec(params.lengthSpec), {
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

// ─── persistAuditDriftGuidance ───────────────────────────────────────────────

export async function persistAuditDriftGuidance(
  host: UtilsHost,
  params: {
    readonly bookDir: string;
    readonly chapterNumber: number;
    readonly issues: ReadonlyArray<AuditIssue>;
    readonly language: LengthLanguage;
  },
): Promise<void> {
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
    host.localize(params.language, {
      zh: "# 审计纠偏",
      en: "# Audit Drift",
    }),
    "",
    host.localize(params.language, {
      zh: "## 审计纠偏（自动生成，下一章写作前参照）",
      en: "## Audit Drift Correction",
    }),
    "",
    host.localize(params.language, {
      zh: `> 第${params.chapterNumber}章审计发现以下问题，下一章写作时必须避免：`,
      en: `> Chapter ${params.chapterNumber} audit found the following issues to avoid in the next chapter:`,
    }),
    ...params.issues.map((issue) => `> - [${issue.severity}] ${issue.category}: ${issue.description}`),
    "",
  ].join("\n");

  await writeFile(driftPath, block, "utf-8");
}

// ─── emitWebhook ─────────────────────────────────────────────────────────────

export async function emitWebhook(
  host: UtilsHost,
  event: WebhookEvent,
  bookId: string,
  chapterNumber?: number,
  data?: Record<string, unknown>,
): Promise<void> {
  if (!host.config.notifyChannels || host.config.notifyChannels.length === 0) return;
  await dispatchWebhookEvent(host.config.notifyChannels, {
    event,
    bookId,
    chapterNumber,
    timestamp: new Date().toISOString(),
    data,
  });
}
