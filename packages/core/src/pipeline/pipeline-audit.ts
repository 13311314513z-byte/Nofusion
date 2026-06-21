/**
 * Pipeline Audit — extracted from runner.ts (C2-ext).
 *
 * Contains the pure audit evaluation logic (evaluateMergedAudit).
 * PipelineRunner.auditDraft delegates to this module.
 */
import { ContinuityAuditor } from "../agents/continuity.js";
import type { ChapterMemo, ContextPackage, RuleStack } from "../models/input-governance.js";
import type { LengthLanguage } from "../utils/length-metrics.js";
import { analyzeAITells } from "../agents/ai-tells.js";
import { analyzeLongSpanFatigue } from "../utils/long-span-fatigue.js";
import { IssueNormalizer } from "../agents/issue-normalizer.js";
import { resolveAuditIssue } from "../models/audit-issue.js";
import type { MergedAuditEvaluation } from "./audit-helpers.js";
import type { AuditIssue } from "../agents/continuity.js";

/**
 * Merge LLM audit + AI tell detection + long-span fatigue into a single evaluation.
 * Extracted from PipelineRunner.evaluateMergedAudit (formerly private, L3424).
 */
export async function evaluateMergedAudit(params: {
  auditor: ContinuityAuditor;
  bookDir: string;
  chapterContent: string;
  chapterNumber: number;
  language: LengthLanguage;
  genre: string;
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
  const llmAudit = await params.auditor.auditChapter(
    params.bookDir,
    params.chapterContent,
    params.chapterNumber,
    params.genre,
    params.auditOptions,
  );
  const aiTells = analyzeAITells(params.chapterContent, params.language);
  const longSpanFatigue = await analyzeLongSpanFatigue({
    bookDir: params.bookDir,
    chapterNumber: params.chapterNumber,
    chapterContent: params.chapterContent,
    language: params.language,
  });
  const issues: ReadonlyArray<AuditIssue> = [
    ...llmAudit.issues,
    ...aiTells.issues,
    ...longSpanFatigue.issues.map((issue) => resolveAuditIssue(issue, "long-span-fatigue")),
  ];
  const normalizer = new IssueNormalizer();
  const normalized = normalizer.normalize(issues);
  const finalIssues: ReadonlyArray<AuditIssue> = normalized.issues;
  const revisionBlockingIssues: ReadonlyArray<AuditIssue> = finalIssues
    .filter((issue) => issue.source !== "long-span-fatigue");

  return {
    auditResult: {
      passed: llmAudit.passed,
      issues: finalIssues,
      summary: llmAudit.summary,
      tokenUsage: llmAudit.tokenUsage,
    },
    aiTellCount: aiTells.issues.length,
    blockingCount: revisionBlockingIssues.filter((issue) => issue.severity === "warning" || issue.severity === "critical").length,
    criticalCount: revisionBlockingIssues.filter((issue) => issue.severity === "critical").length,
    revisionBlockingIssues,
  };
}
