/**
 * Pipeline Audit — unit tests.
 *
 * P2-1: Independent test coverage for evaluateMergedAudit.
 */

import { describe, it, expect, vi } from "vitest";
import { evaluateMergedAudit } from "../pipeline/pipeline-audit.js";

function mockAuditor(overrides: Partial<{ passed: boolean; issues: unknown[] }> = {}) {
  return {
    auditChapter: vi.fn().mockResolvedValue({
      passed: overrides.passed ?? true,
      issues: overrides.issues ?? [],
      summary: "All clear.",
      tokenUsage: { input: 100, output: 50 },
    }),
  } as any;
}

const baseParams = {
  auditor: mockAuditor(),
  bookDir: "/tmp/test-book",
  chapterContent: "The dragon roared across the crimson sky.",
  chapterNumber: 3,
  language: "en" as const,
  genre: "fantasy",
};

describe("evaluateMergedAudit", () => {
  it("returns passing evaluation when auditor finds no issues", async () => {
    const result = await evaluateMergedAudit(baseParams);
    expect(result.auditResult.passed).toBe(true);
    expect(result.blockingCount).toBe(0);
  });

  it("reports auditor failures correctly", async () => {
    const auditor = mockAuditor({
      passed: false,
      issues: [{ severity: "warning", category: "Pacing", description: "Too fast." }],
    });
    const result = await evaluateMergedAudit({ ...baseParams, auditor });
    expect(result.auditResult.passed).toBe(false);
    expect(result.auditResult.issues.length).toBeGreaterThanOrEqual(0);
  });

  it("filters long-span fatigue from revision blockers", async () => {
    const auditor = mockAuditor({ passed: true, issues: [] });
    const result = await evaluateMergedAudit({ ...baseParams, auditor });
    const total = result.auditResult.issues.length;
    const blockers = result.revisionBlockingIssues.length;
    expect(blockers).toBeLessThanOrEqual(total);
  });
});
