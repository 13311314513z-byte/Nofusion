import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendAuditHistory, loadAuditHistory } from "../utils/audit-history.js";

describe("audit-history", () => {
  let bookDir: string;

  beforeEach(async () => {
    bookDir = await mkdtemp(join(tmpdir(), "inkos-audit-"));
  });

  it("appends audit entries to jsonl", async () => {
    const auditResult = {
      passed: true,
      issues: [
        { severity: "warning" as const, category: "test", description: "d1", suggestion: "s1" },
      ],
      summary: "ok",
      overallScore: 88,
    };

    await appendAuditHistory(bookDir, 1, auditResult, 0);
    await appendAuditHistory(bookDir, 1, { ...auditResult, passed: false, overallScore: 72 }, 1);

    const history = await loadAuditHistory(bookDir);
    expect(history).toHaveLength(2);
    expect(history[0]!.chapterNumber).toBe(1);
    expect(history[0]!.passed).toBe(true);
    expect(history[0]!.overallScore).toBe(88);
    expect(history[0]!.revisionRound).toBe(0);
    expect(history[0]!.issueCount).toBe(1);
    expect(history[0]!.warningCount).toBe(1);
    expect(history[0]!.criticalCount).toBe(0);

    expect(history[1]!.passed).toBe(false);
    expect(history[1]!.overallScore).toBe(72);
    expect(history[1]!.revisionRound).toBe(1);
  });

  it("returns empty array when file does not exist", async () => {
    const history = await loadAuditHistory(bookDir);
    expect(history).toEqual([]);
  });

  it("creates story directory if missing", async () => {
    const auditResult = {
      passed: true,
      issues: [],
      summary: "good",
    };
    await appendAuditHistory(bookDir, 5, auditResult, 0);
    const raw = await readFile(join(bookDir, "story", "audit_history.jsonl"), "utf-8");
    expect(raw.trim().length).toBeGreaterThan(0);
  });
});
