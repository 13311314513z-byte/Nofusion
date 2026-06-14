import { describe, it, expect } from "vitest";
import { IssueNormalizer } from "../agents/issue-normalizer.js";
import type { AuditIssue } from "../models/audit-issue.js";

function makeIssue(overrides: Partial<AuditIssue> & { description: string }): AuditIssue {
  return {
    id: `test-${Math.random().toString(36).slice(2, 6)}`,
    source: "continuity",
    severity: "warning",
    category: "OOC Check",
    suggestion: "",
    fixScope: "paragraph",
    blocking: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("IssueNormalizer", () => {
  const normalizer = new IssueNormalizer();

  it("passes through a single issue unchanged", () => {
    const issue = makeIssue({ description: "Character acts oddly" });
    const result = normalizer.normalize([issue]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].description).toBe("Character acts oddly");
    expect(result.mergedCount).toBe(0);
  });

  it("deduplicates exact duplicates (same source + same location + same description)", () => {
    const issues = [
      makeIssue({ description: "重复问题", location: { startParagraph: 1, endParagraph: 2 } }),
      makeIssue({ description: "重复问题", location: { startParagraph: 1, endParagraph: 2 } }),
    ];
    const result = normalizer.normalize(issues);
    expect(result.issues).toHaveLength(1);
    expect(result.mergedCount).toBeGreaterThanOrEqual(1);
  });

  it("keeps different issues separate", () => {
    const issues = [
      makeIssue({ description: "问题甲", category: "OOC Check", location: { startParagraph: 1, endParagraph: 2 } }),
      makeIssue({ description: "问题乙", category: "Pacing Check", location: { startParagraph: 5, endParagraph: 6 } }),
    ];
    const result = normalizer.normalize(issues);
    expect(result.issues).toHaveLength(2);
  });

  it("normalizes category synonyms to canonical form", () => {
    const issues = [
      makeIssue({ description: "Out of character behavior", category: "out of character" }),
      makeIssue({ description: "角色行为不一致", category: "角色行为不一致" }),
    ];
    const result = normalizer.normalize(issues);
    for (const issue of result.issues) {
      expect(issue.category).toBe("OOC Check");
    }
  });

  it("groups by fixScope", () => {
    const issues = [
      makeIssue({ description: "局部问题", fixScope: "paragraph" }),
      makeIssue({ description: "场景问题", fixScope: "scene" }),
      makeIssue({ description: "章节问题", fixScope: "chapter" }),
    ];
    const result = normalizer.normalize(issues);
    expect(result.byFixScope["paragraph"]).toHaveLength(1);
    expect(result.byFixScope["scene"]).toHaveLength(1);
    expect(result.byFixScope["chapter"]).toHaveLength(1);
  });

  it("resolves legacy issues into the complete pipeline contract", () => {
    const legacyIssue = {
      severity: "warning" as const,
      category: "OOC Check",
      description: "Legacy issue without fixScope",
      suggestion: "",
    };
    const result = normalizer.normalize([legacyIssue], undefined, "post-write");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      source: "post-write",
      fixScope: "paragraph",
      blocking: false,
    });
    expect(result.issues[0]!.id).toBeTruthy();
    expect(result.issues[0]!.createdAt).toBeTruthy();
  });

  it("sorts by severity then fixScope", () => {
    const issues = [
      makeIssue({ description: "Z info", severity: "info", fixScope: "chapter" }),
      makeIssue({ description: "A critical", severity: "critical", fixScope: "paragraph" }),
      makeIssue({ description: "B warning", severity: "warning", fixScope: "scene" }),
    ];
    const result = normalizer.normalize(issues);
    expect(result.issues[0].severity).toBe("critical");
    expect(result.issues[1].severity).toBe("warning");
    expect(result.issues[2].severity).toBe("info");
  });
});
