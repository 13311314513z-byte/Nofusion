import { describe, it, expect } from "vitest";
import { checkPatchBoundary, issueLocationsToParagraphSet, selectReviseModeFromFixScope } from "../utils/patch-boundary.js";

describe("checkPatchBoundary", () => {
  const original = [
    "第 1 段：开头。",
    "第 2 段：发展。",
    "第 3 段：冲突。",
    "第 4 段：转折。",
    "第 5 段：结局。",
  ];

  it("passes when only target paragraphs are modified", () => {
    const revised = [...original];
    revised[2] = "第 3 段：修改后的冲突。";

    const report = checkPatchBoundary(original, revised, new Set([2]));
    expect(report.withinBounds).toBe(true);
    expect(report.overstepCount).toBe(0);
    expect(report.targetModified).toBe(1);
    expect(report.targetTotal).toBe(1);
  });

  it("reports oversteps when non-target paragraphs change", () => {
    const revised = [...original];
    revised[1] = "第 2 段：意外修改。";
    revised[2] = "第 3 段：目标修改。";

    const report = checkPatchBoundary(original, revised, new Set([2]));
    expect(report.withinBounds).toBe(false);
    expect(report.overstepCount).toBe(1);
    expect(report.oversteps[0]).toContain("段落 2");
    expect(report.targetModified).toBe(1);
    expect(report.targetTotal).toBe(1);
  });

  it("handles empty target set", () => {
    const revised = [...original];
    revised[0] = "修改。";

    const report = checkPatchBoundary(original, revised, new Set());
    expect(report.withinBounds).toBe(false);
    expect(report.overstepCount).toBe(1);
    expect(report.targetModified).toBe(0);
  });

  it("reports overstep when paragraph is added at the end", () => {
    const revised = [...original, "第 6 段：新增。"];

    const report = checkPatchBoundary(original, revised, new Set([2]));
    expect(report.withinBounds).toBe(false);
    expect(report.overstepCount).toBe(1); // new paragraph (index 5) is outside target
    expect(report.targetModified).toBe(0); // target paragraph (index 2) is unchanged
    expect(report.targetTotal).toBe(1);
  });

  it("correctly reports target modifications when paragraph count changes", () => {
    const revised = [...original];
    revised[2] = "第 3 段：修改。";
    revised.push("第 6 段：新增。");

    const report = checkPatchBoundary(original, revised, new Set([2]));
    expect(report.targetModified).toBe(1);
  });
});

describe("issueLocationsToParagraphSet", () => {
  it("converts locations to 0-based indices", () => {
    const locations = [
      { startParagraph: 2, endParagraph: 3 },
      { startParagraph: 5, endParagraph: 5 },
    ];
    const set = issueLocationsToParagraphSet(locations);
    expect(set.has(1)).toBe(true); // 2 → 1
    expect(set.has(2)).toBe(true); // 3 → 2
    expect(set.has(4)).toBe(true); // 5 → 4
    expect(set.has(0)).toBe(false);
    expect(set.size).toBe(3);
  });

  it("returns empty set for empty input", () => {
    const set = issueLocationsToParagraphSet([]);
    expect(set.size).toBe(0);
  });
});

describe("selectReviseModeFromFixScope", () => {
  it("returns spot-fix for word/sentence scopes", () => {
    expect(selectReviseModeFromFixScope(["word"])).toBe("spot-fix");
    expect(selectReviseModeFromFixScope(["sentence"])).toBe("spot-fix");
    expect(selectReviseModeFromFixScope(["word", "sentence"])).toBe("spot-fix");
  });

  it("returns spot-fix for paragraph scopes", () => {
    expect(selectReviseModeFromFixScope(["paragraph"])).toBe("spot-fix");
  });

  it("returns rewrite-only for scene scopes", () => {
    expect(selectReviseModeFromFixScope(["scene"])).toBe("rewrite-only");
  });

  it("returns rewrite-only for chapter scopes", () => {
    expect(selectReviseModeFromFixScope(["chapter"])).toBe("rewrite-only");
  });

  it("returns spot-fix when all scopes are word/sentence/paragraph", () => {
    expect(selectReviseModeFromFixScope(["word", "paragraph"])).toBe("spot-fix");
  });

  it("returns allow-full for mixed scene and paragraph scopes", () => {
    expect(selectReviseModeFromFixScope(["scene", "paragraph"])).toBe("allow-full");
  });

  it("returns patch-only for empty input", () => {
    expect(selectReviseModeFromFixScope([])).toBe("patch-only");
  });
});
