import { describe, it, expect } from "vitest";
import { createIssue, generateIssueId, type AuditIssue } from "../models/audit-issue.js";

describe("generateIssueId", () => {
  it("generates an id with the correct source prefix", () => {
    const id = generateIssueId("continuity");
    expect(id.startsWith("con-")).toBe(true);
    expect(id.length).toBeGreaterThan(10);
  });

  it("generates unique ids on successive calls", () => {
    const a = generateIssueId("post-write");
    const b = generateIssueId("post-write");
    expect(a).not.toBe(b);
  });

  it("uses 'gen-' prefix for genre-promises source", () => {
    const id = generateIssueId("genre-promises");
    expect(id.startsWith("gen-")).toBe(true);
  });
});

describe("createIssue", () => {
  it("creates a complete AuditIssue with defaults", () => {
    const issue = createIssue({
      source: "continuity",
      severity: "warning",
      category: "OOC Check",
      description: "Character acted out of character",
    });
    expect(issue.id).toBeTruthy();
    expect(issue.source).toBe("continuity");
    expect(issue.severity).toBe("warning");
    expect(issue.category).toBe("OOC Check");
    expect(issue.description).toBe("Character acted out of character");
    expect(issue.suggestion).toBe(""); // default
    expect(issue.fixScope).toBe("paragraph"); // default
    expect(issue.blocking).toBe(false); // non-critical defaults to false
    expect(issue.createdAt).toBeTruthy();
  });

  it("sets blocking=true when severity is critical", () => {
    const issue = createIssue({
      source: "continuity",
      severity: "critical",
      category: "Timeline Break",
      description: "Timeline contradiction detected",
    });
    expect(issue.blocking).toBe(true);
  });

  it("accepts optional fields", () => {
    const location = { startParagraph: 5, endParagraph: 8 };
    const issue = createIssue({
      source: "beta-reader",
      severity: "info",
      category: "Pacing",
      description: "Pacing slows down",
      location,
      evidence: ["Paragraph 5 feels padded"],
      confidence: 0.8,
      fixScope: "scene",
      blocking: true,
      suggestion: "Trim paragraph 5",
    });
    expect(issue.location).toEqual(location);
    expect(issue.evidence).toEqual(["Paragraph 5 feels padded"]);
    expect(issue.confidence).toBe(0.8);
    expect(issue.fixScope).toBe("scene");
    expect(issue.blocking).toBe(true);
    expect(issue.suggestion).toBe("Trim paragraph 5");
  });

  it("accepts genre-promises source", () => {
    const issue = createIssue({
      source: "genre-promises",
      severity: "info",
      category: "Genre Promise",
      description: "Promise overdue",
    });
    expect(issue.source).toBe("genre-promises");
  });
});
