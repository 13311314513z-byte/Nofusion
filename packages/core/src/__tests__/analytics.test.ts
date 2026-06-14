import { describe, expect, it } from "vitest";
import { computeAnalytics } from "../utils/analytics.js";

describe("computeAnalytics", () => {
  it("treats legacy chapters without auditIssues as having no issues", () => {
    const analytics = computeAnalytics("legacy-book", [
      {
        number: 1,
        status: "drafted",
        wordCount: 1200,
      },
      {
        number: 2,
        status: "ready-for-review",
        wordCount: 1800,
        auditIssues: ["[warning] Continuity: timeline drift"],
      },
    ]);

    expect(analytics.totalChapters).toBe(2);
    expect(analytics.chaptersWithMostIssues).toEqual([{ chapter: 2, issueCount: 1 }]);
    expect(analytics.topIssueCategories).toEqual([{ category: "Continuity", count: 1 }]);
  });
});
