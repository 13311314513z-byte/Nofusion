import { describe, expect, it } from "vitest";
import { buildLocalStyleSourceId, buildStyleStatusNotice, inferLocalStyleFileType } from "./StyleManager";

describe("buildStyleStatusNotice", () => {
  it("surfaces analyze errors even when no profile is available yet", () => {
    expect(buildStyleStatusNotice("Error: analyze failed", "")).toEqual({
      tone: "error",
      message: "Error: analyze failed",
    });
  });

  it("falls back to import status when there is no analyze error", () => {
    expect(buildStyleStatusNotice("", "Style guide imported successfully!")).toEqual({
      tone: "success",
      message: "Style guide imported successfully!",
    });
  });

  it("returns null when there is nothing to show", () => {
    expect(buildStyleStatusNotice("", "")).toBeNull();
  });
});

describe("local style file helpers", () => {
  it("infers supported local style file types", () => {
    expect(inferLocalStyleFileType("sample.txt")).toBe("txt");
    expect(inferLocalStyleFileType("chapter.MD")).toBe("md");
    expect(inferLocalStyleFileType("notes.markdown")).toBe("md");
    expect(inferLocalStyleFileType("export.jsonl.md")).toBe("jsonl");
    expect(inferLocalStyleFileType("archive.json.markdown")).toBe("json");
    expect(inferLocalStyleFileType("book.docx")).toBeNull();
  });

  it("builds safe source ids from local file names", () => {
    expect(buildLocalStyleSourceId("鲁迅 样本.txt", 123, 2)).toBe("123-2-鲁迅-样本");
    expect(buildLocalStyleSourceId("../bad name.txt", 456, 0)).toBe("456-0-bad-name");
  });
});
