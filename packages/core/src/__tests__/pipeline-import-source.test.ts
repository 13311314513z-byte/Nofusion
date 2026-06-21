/**
 * Tests for buildImportFoundationSource — extracted from pipeline-runner.test.ts (C11).
 */
import { describe, expect, it } from "vitest";
import { buildImportFoundationSource } from "../pipeline/runner.js";

describe("buildImportFoundationSource", () => {
  it("compacts large imported books into opening, middle anchors, ending, and title catalog", () => {
    const chapters = Array.from({ length: 36 }, (_, index) => {
      const n = index + 1;
      return {
        title: `第${n}章 标题${n}`,
        content: `OPEN-${n}\n${"正文".repeat(3000)}\nTAIL-${n}`,
      };
    });
    const fullText = chapters
      .map((chapter, index) => `第${index + 1}章 ${chapter.title}\n\n${chapter.content}`)
      .join("\n\n---\n\n");

    const source = buildImportFoundationSource(chapters, "zh", {
      maxFullTextChars: 20_000,
      chapterExcerptChars: 1_200,
      titleCatalogChars: 2_000,
    });

    expect(source.length).toBeLessThan(fullText.length / 2);
    expect(source).toContain("压缩资料包");
    expect(source).toContain("完整章节将在后续顺序回放");
    expect(source).toContain("第1章 第1章 标题1");
    expect(source).toContain("第36章 第36章 标题36");
    expect(source).toContain("OPEN-1");
    expect(source).toContain("TAIL-36");
    expect(source).not.toContain("正文".repeat(2500));
  });
});
