/**
 * Shared pipeline types — used by runner.ts and extracted sub-modules
 * to avoid circular imports.
 */
import type { AuditResult, AuditIssue } from "../agents/continuity.js";
import type { LengthTelemetry } from "../models/length-governance.js";

export interface TokenUsageSummary {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface ChapterPipelineResult {
  readonly chapterNumber: number;
  readonly title: string;
  readonly wordCount: number;
  readonly auditResult: AuditResult;
  readonly revised: boolean;
  readonly status: "ready-for-review" | "audit-failed" | "state-degraded";
  readonly lengthWarnings?: ReadonlyArray<string>;
  readonly lengthTelemetry?: LengthTelemetry;
  readonly tokenUsage?: TokenUsageSummary;
}

export interface DraftResult {
  readonly chapterNumber: number;
  readonly title: string;
  readonly wordCount: number;
  readonly filePath: string;
  readonly lengthWarnings?: ReadonlyArray<string>;
  readonly lengthTelemetry?: LengthTelemetry;
  readonly tokenUsage?: TokenUsageSummary;
}

export interface PlanChapterResult {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly intentPath: string;
  readonly goal: string;
  readonly conflicts: ReadonlyArray<string>;
}
