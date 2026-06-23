/**
 * Document reader — extract plain text from various file types.
 * Supports: .md, .txt, .jsonl, .json, .ts, .js, .html, .htm, .css
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export type DocumentFileType =
  | "md"
  | "txt"
  | "jsonl"
  | "json"
  | "ts"
  | "js"
  | "html"
  | "htm"
  | "css";

export interface ExtractedDocument {
  readonly sourceName: string;
  readonly fileType: DocumentFileType;
  readonly text: string;
  readonly charCount: number;
  readonly textHash: string;
  readonly warnings: ReadonlyArray<string>;
  // ---- 分片元信息 ----
  /** 是否因达到 maxChars 上限而被截断 */
  readonly truncated: boolean;
  /** 截断前原始提取长度（仅 truncated=true 时有意义） */
  readonly originalLength?: number;
  /** 总分片数 */
  readonly totalChunks: number;
  /** 当前分片索引（0-based） */
  readonly chunkIndex: number;
}

/** 单次提取最大字符数 */
export const MAX_CHARS = 5_000_000;
/** 每分片最大字符数（超过此值触发分片） */
export const MAX_CHARS_PER_CHUNK = 500_000;

function computeTextHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function detectFileType(filePath: string): DocumentFileType {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".jsonl.md") || lower.endsWith(".jsonl.markdown")) return "jsonl";
  if (lower.endsWith(".json.md") || lower.endsWith(".json.markdown")) return "json";
  if (lower.endsWith(".md")) return "md";
  if (lower.endsWith(".txt")) return "txt";
  if (lower.endsWith(".jsonl")) return "jsonl";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".ts")) return "ts";
  if (lower.endsWith(".js")) return "js";
  if (lower.endsWith(".html")) return "html";
  if (lower.endsWith(".htm")) return "htm";
  if (lower.endsWith(".css")) return "css";
  return "txt";
}

function stripMarkdownFrontmatter(text: string): string {
  return text.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();
}

function stripMarkdownMarkup(text: string): string {
  return (
    text
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/(\*{1,2}|_{1,2})(.+?)\1/g, "$2")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^-{3,}\s*$/gm, "")
      .replace(/^>\s?/gm, "")
      .replace(/<[^>]+>/g, "")
      .trim()
  );
}

// Priority text fields for JSON/JSONL extraction
const JSON_TEXT_FIELDS: ReadonlyArray<string> = [
  "text",
  "content",
  "message",
  "body",
  "prompt",
  "response",
  "instruction",
  "input",
  "output",
  "question",
  "answer",
  "dialogue",
  "conversation",
  "summary",
  "description",
  "title",
  "value",
];

// Metadata fields to explicitly exclude from extraction
const JSON_METADATA_FIELDS: ReadonlyArray<string> = [
  "timestamp",
  "created_at",
  "updated_at",
  "deleted_at",
  "id",
  "index",
  "cell",
  "metadata",
  "meta",
  "source",
  "version",
  "uuid",
  "guid",
  "date",
  "time",
  "datetime",
  "epoch",
  "offset",
  "row",
  "col",
  "line",
  "pos",
  "position",
  "status",
  "type",
  "kind",
  "category",
  "tag",
  "label",
  "format",
  "encoding",
  "lang",
  "language",
  "model",
  "temperature",
  "token",
  "tokens",
  "cell_id",
  "cell_type",
  "cell_index",
  "execution_count",
  "attachments",
  "outputs",
  "usage",
  "finish_reason",
  "role",
  "name",
  "path",
  "file",
  "filename",
  "mime",
  "url",
  "href",
  "thumbnail",
];

const JSON_WEAK_TEXT_FIELDS = new Set(["title", "summary", "description", "value"]);
const NOISE_MARKER_RE =
  /\b(?:cell)?(?:undefined|null|nan|none)\b|^\s*(?:true|false)\s*$/i;

function looksLikeKeyName(s: string): boolean {
  // Filter out short strings that look like JSON keys or enum values
  if (s.length <= 1) return true;
  if (/^[a-z_][a-z0-9_]*$/i.test(s) && s.length < 20 && !s.includes(" ")) return true;
  return false;
}

function looksLikeTimestamp(s: string): boolean {
  // ISO 8601: 2024-01-15T10:30:00.000Z, 2024-01-15 10:30:00
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.test(s)) return true;
  // Unix timestamp (10-13 digits)
  if (/^\d{10,13}$/.test(s)) return true;
  // Chinese date: 2024年01月15日, 2024/01/15
  if (/^\d{4}[年/-]\d{1,2}[月/-]\d{1,2}[日\sT]?/.test(s)) return true;
  return false;
}

function looksLikeId(s: string): boolean {
  // UUID
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true;
  // MongoDB ObjectId
  if (/^[0-9a-f]{24}$/i.test(s)) return true;
  // NanoID-like (21 chars, URL-safe)
  if (/^[A-Za-z0-9_-]{21}$/.test(s)) return true;
  return false;
}

function looksLikeNoiseMarker(s: string): boolean {
  const lower = s.toLowerCase();
  if (lower === "undefined" || lower === "null" || lower === "nan" || lower === "none") return true;
  if (lower === "cellundefined" || lower === "cellnull" || lower === "cellnan") return true;
  if (lower === "true" || lower === "false") return true;
  // Standalone numbers (likely IDs or counters)
  if (/^\d+$/.test(s) && s.length < 16) return true;
  return false;
}

function meaningfulCharCount(s: string): number {
  return (s.match(/[\p{L}\p{N}\u4e00-\u9fff]/gu) ?? []).length;
}

function chineseCharCount(s: string): number {
  return (s.match(/[\u4e00-\u9fff]/g) ?? []).length;
}

function looksLikePathOrFilename(s: string): boolean {
  if (/^[A-Za-z]:[\\/]/.test(s)) return true;
  if (/^[/\\]?[\w .-]+([/\\][\w .-]+)+$/.test(s)) return true;
  if (/^[\w\u4e00-\u9fff ._-]+\.(jsonl?|md|txt|docx?|pdf|png|jpe?g|webp|ts|js|css|html?)$/i.test(s)) return true;
  // URL path with query parameters (e.g. /thumbnail?type=persona&file=xxx.png)
  if (/^\/?\w[\w\-./]*\?\w+=/.test(s)) return true;
  return false;
}

function looksLikeStructuredFragment(s: string): boolean {
  const trimmed = s.trim();
  if (/^[[{].*[\]}]$/.test(trimmed) && trimmed.length < 120) return true;
  if (/^["']?[\w.-]+["']?\s*[:=]\s*["']?[\w.-]*["']?,?$/.test(trimmed)) return true;
  if (/^[-_*~=]{3,}$/.test(trimmed)) return true;
  return false;
}

function normalizeJsonCandidateText(s: string): string {
  return s
    .replace(NOISE_MARKER_RE, "")
    .replace(/\bcell(?:undefined|null|nan|none)\b/gi, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\uFFFD]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isValidTextValue(s: string, mode: "priority" | "weak" | "fallback" = "fallback"): boolean {
  const trimmed = normalizeJsonCandidateText(s);
  if (!trimmed) return false;
  if (looksLikeKeyName(trimmed)) return false;
  if (looksLikeTimestamp(trimmed)) return false;
  if (looksLikeId(trimmed)) return false;
  if (looksLikeNoiseMarker(trimmed)) return false;
  if (NOISE_MARKER_RE.test(trimmed)) return false;
  if (looksLikePathOrFilename(trimmed)) return false;
  if (looksLikeStructuredFragment(trimmed)) return false;
  if (trimmed.length > 0 && meaningfulCharCount(trimmed) / trimmed.length < 0.15) return false;

  const cjkCount = chineseCharCount(trimmed);
  const minMeaningful = mode === "priority" ? 2 : mode === "weak" ? 8 : 10;
  if (meaningfulCharCount(trimmed) < minMeaningful && !(mode === "fallback" && cjkCount >= 4)) {
    return false;
  }

  // Fallback extraction is deliberately stricter because arbitrary JSON string
  // values are often enum labels, UI state, ids, or exported table cells.
  if (mode === "fallback") {
    // Sentence-ending punctuation: require CJK punctuation or period followed by space/end
    const hasSentencePunctuation = /[。！？；;]/.test(trimmed) || /[.!?](?:\s|$)/.test(trimmed);
    const hasCjk = cjkCount >= 4;
    const hasEnoughWords = trimmed.split(/\s+/).filter(Boolean).length >= 4;
    if (!hasSentencePunctuation && !hasCjk && !hasEnoughWords) return false;
  }

  return true;
}

function pushNormalized(results: string[], value: string): void {
  const normalized = normalizeJsonCandidateText(value);
  if (normalized) results.push(normalized);
}

function extractTextFromJsonValue(value: unknown, mode: "priority" | "weak" | "fallback" = "fallback"): string[] {
  const results: string[] = [];
  if (typeof value === "string" && value.trim()) {
    if (isValidTextValue(value, mode)) {
      pushNormalized(results, value);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      results.push(...extractTextFromJsonValue(item, mode));
    }
  } else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    // 1. Try known text fields directly
    for (const field of JSON_TEXT_FIELDS) {
      if (field in record) {
        const v = record[field];
        const fieldMode = JSON_WEAK_TEXT_FIELDS.has(field) ? "weak" : "priority";
        if (typeof v === "string" && v.trim() && isValidTextValue(v, fieldMode)) {
          pushNormalized(results, v);
        } else if (Array.isArray(v)) {
          for (const item of v) {
            results.push(...extractTextFromJsonValue(item, fieldMode));
          }
        }
      }
    }
    // 2. Try OpenAI-style messages array
    if ("messages" in record && Array.isArray(record.messages)) {
      for (const msg of record.messages) {
        if (msg && typeof msg === "object") {
          const m = msg as Record<string, unknown>;
          const c = m.content ?? m.text ?? m.value ?? "";
          if (typeof c === "string" && c.trim() && isValidTextValue(c, "priority")) {
            pushNormalized(results, c);
          }
        }
      }
    }
    // 3. Fallback: recurse into values only if no known field was found
    if (results.length === 0) {
      for (const [key, v] of Object.entries(record)) {
        // Skip metadata fields entirely
        if (JSON_METADATA_FIELDS.includes(key.toLowerCase())) continue;
        results.push(...extractTextFromJsonValue(v, "fallback"));
      }
    }
  }
  return results;
}

function extractFromJsonl(text: string): string {
  const lines = text.split("\n");
  const results: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as unknown;
      if (obj === null || typeof obj !== "object") {
        // Primitive value (string/number/boolean)
        if (typeof obj === "string" && obj.trim() && isValidTextValue(obj, "fallback")) {
          pushNormalized(results, obj);
        }
        continue;
      }
      const extracted = extractTextFromJsonValue(obj);
      if (extracted.length > 0) {
        results.push(...extracted);
      }
    } catch {
      // Not valid JSON, treat as plain text
      if (isValidTextValue(trimmed, "fallback")) {
        pushNormalized(results, trimmed);
      }
    }
  }
  return results.join("\n\n");
}

function extractFromJson(text: string): string {
  try {
    const obj = JSON.parse(text) as unknown;
    if (obj === null || typeof obj !== "object") {
      if (typeof obj === "string" && obj.trim()) return obj.trim();
      return text;
    }
    const extracted = extractTextFromJsonValue(obj);
    if (extracted.length > 0) {
      return extracted.join("\n");
    }
  } catch {
    // Not valid JSON, treat as plain text
  }
  return text;
}

/**
 * 估算总分片数。
 */
function estimateTotalChunks(originalLength: number, maxChars: number): number {
  if (originalLength <= maxChars) return 1;
  return Math.ceil(originalLength / maxChars);
}

function* chunkExtractedText(
  text: string,
  maxCharsPerChunk: number,
): Generator<{ text: string; chunkIndex: number; isLast: boolean }> {
  const chunkSize = Math.max(1, maxCharsPerChunk);
  const totalChunks = Math.max(1, Math.ceil(text.length / chunkSize));
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const start = chunkIndex * chunkSize;
    yield {
      text: text.slice(start, start + chunkSize),
      chunkIndex,
      isLast: chunkIndex === totalChunks - 1,
    };
  }
}

/**
 * JSONL 分片提取迭代器 — 按行分批，每批达到 maxCharsPerChunk 时 yield。
 * 调用方可逐批消费，避免单次处理超大文件。
 */
export function* extractFromJsonlChunked(
  text: string,
  maxCharsPerChunk: number = MAX_CHARS_PER_CHUNK,
): Generator<{ text: string; chunkIndex: number; isLast: boolean }> {
  yield* chunkExtractedText(extractFromJsonl(text), maxCharsPerChunk);
}

/**
 * JSON 分片提取迭代器 — 对大型 JSON Array 按元素分批，Object 按顶层 key 分批。
 */
export function* extractFromJsonChunked(
  text: string,
  maxCharsPerChunk: number = MAX_CHARS_PER_CHUNK,
): Generator<{ text: string; chunkIndex: number; isLast: boolean }> {
  yield* chunkExtractedText(extractFromJson(text), maxCharsPerChunk);
}

/**
 * 分片提取的统一入口。根据 fileType 分发到对应分片提取器。
 * 如果文件较小（不分片），行为与 extractDocumentFromText 一致。
 */
export function extractDocumentChunked(
  text: string,
  sourceName: string,
  fileType: DocumentFileType = "txt",
  options?: {
    maxChars?: number;
    chunkSize?: number;
    chunkIndex?: number;
  },
): Generator<ExtractedDocument> {
  const maxChars = options?.maxChars ?? MAX_CHARS;
  const chunkSize = options?.chunkSize ?? MAX_CHARS_PER_CHUNK;

  function* generate(): Generator<ExtractedDocument> {
    const { text: fullyExtracted, originalLength } =
      processExtractedText(text, fileType, Number.MAX_SAFE_INTEGER);
    const capped = fullyExtracted.slice(0, maxChars);
    const truncated = originalLength > maxChars;
    const chunks = [...chunkExtractedText(capped, chunkSize)];
    const totalChunks = chunks.length;

    for (const chunk of chunks) {
      if (options?.chunkIndex !== undefined && options.chunkIndex !== chunk.chunkIndex) {
        continue;
      }
      yield buildChunkedDocument(
        chunk.text,
        sourceName,
        fileType,
        chunk.chunkIndex,
        totalChunks,
        truncated,
        originalLength,
      );
    }
  }

  return generate();
}

/** 辅助：构建分片 ExtractedDocument */
function buildChunkedDocument(
  chunkText: string,
  sourceName: string,
  fileType: DocumentFileType,
  chunkIndex: number,
  totalChunks: number,
  truncated: boolean,
  originalLength: number,
): ExtractedDocument {
  const warnings = validateExtractedText(chunkText, fileType);
  if (truncated) {
    warnings.push(`提取结果超过 ${MAX_CHARS.toLocaleString()} 字，超出部分未导入`);
  }
  return {
    sourceName: `${sourceName}#chunk${chunkIndex}`,
    fileType,
    text: chunkText,
    charCount: chunkText.length,
    textHash: computeTextHash(chunkText),
    warnings,
    truncated,
    originalLength,
    totalChunks,
    chunkIndex,
  };
}

function extractFromCode(text: string): string {
  const results: string[] = [];

  // Extract string literals (single quote, double quote, template literal)
  // Double quotes
  const dq = text.matchAll(/"([^"\\]|\\.)*"/g);
  for (const m of dq) {
    const s = m[0].slice(1, -1).replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').trim();
    if (s.length > 3 && /[\u4e00-\u9fa5]/.test(s)) results.push(s);
  }
  // Single quotes
  const sq = text.matchAll(/'([^'\\]|\\.)*'/g);
  for (const m of sq) {
    const s = m[0].slice(1, -1).replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\'/g, "'").trim();
    if (s.length > 3 && /[\u4e00-\u9fa5]/.test(s)) results.push(s);
  }
  // Template literals
  const tl = text.matchAll(/`([^`\\]|\\.)*`/g);
  for (const m of tl) {
    const s = m[0].slice(1, -1).replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\`/g, "`").trim();
    if (s.length > 3 && /[\u4e00-\u9fa5]/.test(s)) results.push(s);
  }

  // Extract comments
  const singleComments = text.matchAll(/\/\/\s*(.+)$/gm);
  for (const m of singleComments) {
    const s = m[1].trim();
    if (s.length > 3 && /[\u4e00-\u9fa5]/.test(s)) results.push(s);
  }
  const multiComments = text.matchAll(/\/\*\s*([\s\S]*?)\*\//g);
  for (const m of multiComments) {
    const s = m[1].replace(/\s*\*\s*/g, " ").trim();
    if (s.length > 3 && /[\u4e00-\u9fa5]/.test(s)) results.push(s);
  }

  return results.join("\n\n");
}

function stripHtmlTags(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .trim();
}

function stripCss(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/[.#][^{]+\{[^}]*\}/g, "")
    .replace(/@media[^{]*\{[\s\S]*?\}/g, "")
    .trim();
}

function validateExtractedText(text: string, fileType: string): string[] {
  const warnings: string[] = [];

  if (text.length === 0) {
    warnings.push(`未提取到有效文字（${fileType}）`);
  } else if (text.length < 200) {
    warnings.push(`文本过短（${text.length} 字），分析结果可能不稳定`);
  }

  const garbledRatio =
    // eslint-disable-next-line no-control-regex
    (text.match(/[\uFFFD\u0000-\u0008\u000B-\u000C\u000E-\u001F]/g) ?? []).length /
    text.length;
  if (garbledRatio > 0.05) {
    warnings.push("检测到乱码字符，建议检查原文件编码");
  }

  const whitespaceRatio = (text.match(/\s/g) ?? []).length / text.length;
  if (whitespaceRatio > 0.6) {
    warnings.push("空白字符比例过高，可能影响分析精度");
  }

  return warnings;
}

function processExtractedText(
  text: string,
  fileType: DocumentFileType,
  maxChars: number,
): { text: string; truncated: boolean; originalLength: number } {
  let processed = text;

  switch (fileType) {
    case "md":
      processed = stripMarkdownFrontmatter(processed);
      processed = stripMarkdownMarkup(processed);
      break;
    case "jsonl":
      processed = extractFromJsonl(processed);
      break;
    case "json":
      processed = extractFromJson(processed);
      break;
    case "ts":
    case "js":
      processed = extractFromCode(processed);
      break;
    case "html":
    case "htm":
      processed = stripHtmlTags(processed);
      break;
    case "css":
      processed = stripCss(processed);
      break;
  }

  const originalLength = processed.length;
  if (processed.length > maxChars) {
    processed = processed.slice(0, maxChars);
    return { text: processed, truncated: true, originalLength };
  }
  return { text: processed, truncated: false, originalLength };
}

export async function extractDocument(
  filePath: string,
  options?: { sourceName?: string; maxChars?: number },
): Promise<ExtractedDocument> {
  const maxChars = options?.maxChars ?? MAX_CHARS;
  const sourceName =
    options?.sourceName ?? filePath.split(/[/\\]/).pop() ?? "unknown";
  const fileType = detectFileType(filePath);

  const raw = await readFile(filePath, "utf-8");
  const { text: cleaned, truncated, originalLength } = processExtractedText(raw, fileType, maxChars);
  const warnings = validateExtractedText(cleaned, fileType);
  const totalChunks = truncated ? estimateTotalChunks(originalLength, maxChars) : 1;

  return {
    sourceName,
    fileType,
    text: cleaned,
    charCount: cleaned.length,
    textHash: computeTextHash(cleaned),
    warnings,
    truncated,
    originalLength: truncated ? originalLength : undefined,
    totalChunks,
    chunkIndex: 0,
  };
}

export function extractDocumentFromText(
  text: string,
  sourceName: string,
  fileType: DocumentFileType = "txt",
  options?: { maxChars?: number },
): ExtractedDocument {
  const maxChars = options?.maxChars ?? MAX_CHARS;

  const { text: cleaned, truncated, originalLength } = processExtractedText(text, fileType, maxChars);
  const warnings = validateExtractedText(cleaned, fileType);
  const totalChunks = truncated ? estimateTotalChunks(originalLength, maxChars) : 1;

  return {
    sourceName,
    fileType,
    text: cleaned,
    charCount: cleaned.length,
    textHash: computeTextHash(cleaned),
    warnings,
    truncated,
    originalLength: truncated ? originalLength : undefined,
    totalChunks,
    chunkIndex: 0,
  };
}
