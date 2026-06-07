import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractDocument,
  extractDocumentChunked,
  extractDocumentFromText,
} from "../utils/document-reader.js";

describe("extractDocumentFromText", () => {
  describe("jsonl", () => {
    it("detects .jsonl.md files as jsonl exports", async () => {
      const dir = await mkdtemp(join(tmpdir(), "inkos-jsonl-md-"));
      try {
        const file = join(dir, "export.jsonl.md");
        await writeFile(
          file,
          '{"cell": "cellundefined"}\n{"content": "她站在门口，听见楼下传来极轻的脚步声。"}',
          "utf-8",
        );

        const doc = await extractDocument(file);

        expect(doc.fileType).toBe("jsonl");
        expect(doc.text).toBe("她站在门口，听见楼下传来极轻的脚步声。");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("extracts from text field", () => {
      const long1 = "Hello world, this is a significantly longer piece of text content that definitely exceeds the two hundred character threshold required to avoid the short text warning during document extraction.";
      const long2 = "Second line also needs to be long enough to avoid any warnings and ensure the extraction process considers this as valid substantial content for analysis.";
      const doc = extractDocumentFromText(`{"text": "${long1}"}\n{"text": "${long2}"}`, "test.jsonl", "jsonl");
      expect(doc.text).toContain("Hello world");
      expect(doc.text).toContain("Second line");
      expect(doc.warnings).toHaveLength(0);
    });

    it("extracts from content field", () => {
      const doc = extractDocumentFromText('{"content": "故事开始了"}', "test.jsonl", "jsonl");
      expect(doc.text).toBe("故事开始了");
    });

    it("extracts from instruction/input/output fields", () => {
      const doc = extractDocumentFromText(
        '{"instruction": "写一个故事", "input": "", "output": "从前有座山"}',
        "test.jsonl",
        "jsonl",
      );
      expect(doc.text).toBe("写一个故事\n\n从前有座山");
    });

    it("extracts OpenAI messages format", () => {
      const doc = extractDocumentFromText(
        '{"messages": [{"role": "user", "content": "你好"}, {"role": "assistant", "content": "有什么可以帮您？"}]}',
        "test.jsonl",
        "jsonl",
      );
      expect(doc.text).toBe("你好\n\n有什么可以帮您？");
    });

    it("extracts from array of objects", () => {
      const doc = extractDocumentFromText(
        '[{"role": "user", "content": "第一句"}, {"role": "assistant", "content": "第二句"}]',
        "test.jsonl",
        "jsonl",
      );
      expect(doc.text).toBe("第一句\n\n第二句");
    });

    it("falls back to plain text for non-JSON lines", () => {
      const doc = extractDocumentFromText("这是纯文本\n{\"text\": \"JSON行\"}", "test.jsonl", "jsonl");
      expect(doc.text).toBe("这是纯文本\n\nJSON行");
    });

    it("warns when no text extracted", () => {
      const doc = extractDocumentFromText('{"foo": "bar"}\n{"baz": 123}', "test.jsonl", "jsonl");
      expect(doc.text).toBe("");
      expect(doc.warnings.some((w) => w.includes("未提取到有效文字"))).toBe(true);
    });

    it("filters jsonl noise markers, metadata, paths, and non-json noise lines", () => {
      const doc = extractDocumentFromText(
        [
          "cellundefined",
          '{"cell": "cellundefined", "id": "507f1f77bcf86cd799439011", "filename": "sample.jsonl.md"}',
          '{"value": "cellundefined", "path": "C:/Users/white/Downloads/a.jsonl.md"}',
          '{"status": "ok", "type": "message", "kind": "cell"}',
          '{"paragraph": "她站在窗边，看见雨水沿着玻璃缓慢落下，像某种迟来的回答。"}',
          '{"content": "他低声说：这件事不能再拖了。"}',
        ].join("\n"),
        "test.jsonl",
        "jsonl",
      );

      expect(doc.text).toContain("她站在窗边");
      expect(doc.text).toContain("这件事不能再拖了");
      expect(doc.text).not.toContain("cellundefined");
      expect(doc.text).not.toContain("sample.jsonl");
      expect(doc.text).not.toContain("507f1f77bcf86cd799439011");
    });

    it("keeps priority text fields but rejects weak one-word values", () => {
      const doc = extractDocumentFromText(
        [
          '{"content": "你好"}',
          '{"value": "ok"}',
          '{"title": "draft"}',
          '{"summary": "她终于明白，这场沉默本身就是答案。"}',
        ].join("\n"),
        "test.jsonl",
        "jsonl",
      );

      expect(doc.text).toContain("你好");
      expect(doc.text).toContain("这场沉默本身就是答案");
      expect(doc.text).not.toContain("ok");
      expect(doc.text).not.toContain("draft");
    });
  });

  describe("json", () => {
    it("extracts from nested object", () => {
      const doc = extractDocumentFromText(
        '{"data": {"content": "嵌套内容"}}',
        "test.json",
        "json",
      );
      expect(doc.text).toBe("嵌套内容");
    });

    it("extracts all string values when no known field", () => {
      const doc = extractDocumentFromText(
        '{"foo": "标题文字", "bar": "描述文字内容"}',
        "test.json",
        "json",
      );
      expect(doc.text).toContain("标题文字");
      expect(doc.text).toContain("描述文字内容");
    });
  });

  describe("ts/js", () => {
    it("extracts Chinese string literals", () => {
      const doc = extractDocumentFromText(
        'const msg = "这是一个字符串";\n// 这是注释内容',
        "test.ts",
        "ts",
      );
      expect(doc.text).toContain("这是一个字符串");
      expect(doc.text).toContain("这是注释内容");
    });

    it("extracts template literals with Chinese", () => {
      const doc = extractDocumentFromText(
        'const t = `模板字符串中的文字`;',
        "test.ts",
        "ts",
      );
      expect(doc.text).toBe("模板字符串中的文字");
    });

    it("filters out non-Chinese short strings", () => {
      const doc = extractDocumentFromText(
        'const a = "hello"; const b = "world";',
        "test.ts",
        "ts",
      );
      expect(doc.text).toBe("");
    });
  });

  describe("html", () => {
    it("strips tags and keeps text", () => {
      const doc = extractDocumentFromText(
        "<html><body><p>段落文字</p></body></html>",
        "test.html",
        "html",
      );
      expect(doc.text).toBe("段落文字");
    });

    it("removes script and style content", () => {
      const doc = extractDocumentFromText(
        "<div>可见文字</div><script>alert('hi');</script><style>.red{}</style>",
        "test.html",
        "html",
      );
      expect(doc.text).toBe("可见文字");
    });
  });

  describe("chunked extraction", () => {
    it("returns every text chunk up to the total hard limit", () => {
      const input = "甲".repeat(1_200_000);
      const chunks = [...extractDocumentChunked(input, "large.txt", "txt", {
        maxChars: 1_000_000,
        chunkSize: 200_000,
      })];

      expect(chunks).toHaveLength(5);
      expect(chunks.map((chunk) => chunk.text).join("")).toBe("甲".repeat(1_000_000));
      expect(chunks.every((chunk) => chunk.totalChunks === 5)).toBe(true);
      expect(chunks.every((chunk) => chunk.truncated)).toBe(true);
      expect(chunks[0]?.originalLength).toBe(1_200_000);
    });

    it("does not parse normalized JSONL chunks a second time", () => {
      const input = Array.from({ length: 4 }, (_, index) => (
        JSON.stringify({ content: `第${index}段：${"内容".repeat(60_000)}` })
      )).join("\n");
      const chunks = [...extractDocumentChunked(input, "large.jsonl", "jsonl", {
        maxChars: 1_000_000,
        chunkSize: 150_000,
      })];
      const combined = chunks.map((chunk) => chunk.text).join("");

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.every((chunk) => chunk.charCount > 0)).toBe(true);
      expect(combined).toContain("第0段");
      expect(combined).toContain("第3段");
      expect(combined).not.toContain('{"content"');
    });
  });
});
