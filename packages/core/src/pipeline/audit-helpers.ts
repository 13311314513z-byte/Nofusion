import type { AuditResult, AuditIssue } from "../agents/continuity.js";

/** Merged evaluation combining LLM audit + AI-tells + long-span analysis. */
export interface MergedAuditEvaluation {
  readonly auditResult: AuditResult;
  readonly aiTellCount: number;
  readonly blockingCount: number;
  readonly criticalCount: number;
  readonly revisionBlockingIssues: ReadonlyArray<AuditIssue>;
}

/**
 * Strip the audit drift correction block from the current state markdown.
 * This block is appended by the auditor and should be removed before the
 * next chapter write so stale corrections don't accumulate.
 */
export function stripAuditDriftCorrectionBlock(currentState: string): string {
  const headers = [
    "## 审计纠偏（自动生成，下一章写作前参照）",
    "## Audit Drift Correction",
    "# 审计纠偏",
    "# Audit Drift",
  ];

  let cutIndex = -1;
  for (const header of headers) {
    const index = currentState.indexOf(header);
    if (index >= 0 && (cutIndex < 0 || index < cutIndex)) {
      cutIndex = index;
    }
  }

  if (cutIndex < 0) {
    return currentState;
  }

  return currentState.slice(0, cutIndex).trimEnd();
}

/**
 * If the new audit lost all its issues (empty array) while the previous
 * audit had actionable ones, restore the previous issues to avoid
 * silently dropping revision blockers.
 */
export function restoreLostAuditIssues(previous: AuditResult, next: AuditResult): AuditResult {
  if (next.passed || next.issues.length > 0 || previous.issues.length === 0) {
    return next;
  }

  return {
    ...next,
    issues: previous.issues,
    summary: next.summary || previous.summary,
  };
}

/**
 * Restore previous audit's actionable findings when the new audit
 * appears to have lost them (e.g. LLM returned empty issue list).
 * Returns the original `next` if no restoration was needed.
 */
export function restoreActionableAuditIfLost(
  previous: MergedAuditEvaluation,
  next: MergedAuditEvaluation,
): MergedAuditEvaluation {
  const auditResult = restoreLostAuditIssues(previous.auditResult, next.auditResult);
  if (auditResult === next.auditResult) {
    return next;
  }

  return {
    ...next,
    auditResult,
    revisionBlockingIssues: previous.revisionBlockingIssues,
    blockingCount: previous.blockingCount,
    criticalCount: previous.criticalCount,
  };
}
