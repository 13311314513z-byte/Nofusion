import { describe, expect, it } from "vitest";
import { buildFoundationSourceBundle } from "../import/foundation-source.js";

describe("buildFoundationSourceBundle", () => {
  it("normalizes JSONL and deduplicates identical content across file names", () => {
    const raw = '{"content":"她站在门口，听见楼下传来脚步声。"}';
    const bundle = buildFoundationSourceBundle([
      { sourceName: "a.jsonl", fileType: "jsonl", text: raw, purpose: "world" },
      { sourceName: "b.jsonl", fileType: "jsonl", text: raw, purpose: "world" },
    ]);

    expect(bundle.sources).toHaveLength(1);
    expect(bundle.sources[0]?.text).toBe("她站在门口，听见楼下传来脚步声。");
    expect(bundle.warnings.some((warning) => warning.includes("重复"))).toBe(true);
  });

  it("rejects oversized bundles instead of silently truncating them", () => {
    expect(() => buildFoundationSourceBundle([{
      sourceName: "large.txt",
      fileType: "txt",
      text: "甲".repeat(1_000_001),
      purpose: "world",
      normalized: true,
    }])).toThrow("超出上限");
  });

  it("rejects invalid runtime enum values", () => {
    expect(() => buildFoundationSourceBundle([{
      sourceName: "bad.bin",
      fileType: "bin" as never,
      text: "content",
      purpose: "world",
    }])).toThrow("不支持的资料格式");
  });
});
