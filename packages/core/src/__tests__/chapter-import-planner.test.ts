import { describe, it, expect } from "vitest";
import { planChapterImport } from "../import/chapter-import-planner.js";

describe("planChapterImport", () => {
  it("splits Chinese chapters and detects ok status", () => {
    const text = `第一章 开头
这是第一章的内容，字数足够多。${"这是一段很长的内容。".repeat(50)}

第二章 中间
这是第二章的内容，字数也足够多。${"这同样是一段很长的内容。".repeat(50)}`;

    const plan = planChapterImport(text);
    expect(plan.chapters).toHaveLength(2);
    expect(plan.chapters[0]!.title).toBe("开头");
    expect(plan.chapters[0]!.status).toBe("ok");
    expect(plan.chapters[1]!.status).toBe("ok");
    expect(plan.warnings).toHaveLength(0);
  });

  it("detects too-short chapters", () => {
    const text = `第一章 短章
很短。

第二章 正常
${"这是一段很长的内容。".repeat(50)}`;

    const plan = planChapterImport(text);
    expect(plan.chapters[0]!.status).toBe("too-short");
    expect(plan.chapters[1]!.status).toBe("ok");
    expect(plan.warnings.some((w) => w.type === "too-short")).toBe(true);
  });

  it("detects empty chapters", () => {
    const text = `第一章 有内容
${"内容。".repeat(50)}

第二章 空章

第三章 又有内容
${"内容。".repeat(50)}`;

    const plan = planChapterImport(text);
    expect(plan.chapters[1]!.status).toBe("empty");
    expect(plan.warnings.some((w) => w.type === "empty")).toBe(true);
  });

  it("detects duplicate titles", () => {
    const text = `第一章 同样的标题
${"内容。".repeat(50)}

第二章 同样的标题
${"内容。".repeat(50)}`;

    const plan = planChapterImport(text);
    expect(plan.chapters[0]!.status).toBe("duplicate-title");
    expect(plan.chapters[1]!.status).toBe("duplicate-title");
    expect(plan.warnings.some((w) => w.type === "duplicate-title")).toBe(true);
  });

  it("warns when no chapters found", () => {
    const plan = planChapterImport("这只是一段没有任何章节标题的普通文本。");
    expect(plan.chapters).toHaveLength(0);
    expect(plan.warnings.some((w) => w.type === "no-chapters")).toBe(true);
  });

  it("provides first and last paragraph previews", () => {
    const text = `第一章 预览
第一段开头。

中间段落。

最后一段结尾。`;

    const plan = planChapterImport(text);
    expect(plan.chapters[0]!.firstParagraph).toBe("第一段开头。");
    expect(plan.chapters[0]!.lastParagraph).toBe("最后一段结尾。");
  });

  it("respects startNumber option", () => {
    const text = `第一章 开头
${"内容。".repeat(50)}`;

    const plan = planChapterImport(text, { startNumber: 5 });
    expect(plan.chapters[0]!.targetNumber).toBe(5);
    expect(plan.suggestedStartNumber).toBe(5);
  });
});
