/**
 * Text preprocessor — clean and filter source text before style analysis.
 */

export interface PreprocessOptions {
  /** Remove code blocks (```...```) and inline code */
  readonly filterCode?: boolean;
  /** Remove repeated system prompts / instruction blocks */
  readonly filterRepeatedPrompts?: boolean;
  /** Remove URLs, emails, paths */
  readonly filterUrls?: boolean;
  /** Remove JSON / XML / HTML tags */
  readonly filterStructuredData?: boolean;
  /** Remove markdown formatting */
  readonly stripMarkdown?: boolean;
  /** Remove lines shorter than N chars (likely noise) */
  readonly minLineLength?: number;
  /** Remove duplicate paragraphs */
  readonly deduplicateParagraphs?: boolean;
  /** Remove timestamps (ISO 8601, Unix epoch, Chinese dates) */
  readonly filterTimestamps?: boolean;
  /** Remove IDs (UUID, ObjectId, NanoID-like) */
  readonly filterIds?: boolean;
  /** Remove noise markers (undefined, null, cellundefined, NaN, standalone numbers) */
  readonly filterNoiseMarkers?: boolean;
}

export interface PreprocessResult {
  readonly text: string;
  readonly removedChars: number;
  readonly removedLines: number;
  readonly removedParagraphs: number;
  readonly actions: ReadonlyArray<string>;
}

const DEFAULT_OPTIONS: PreprocessOptions = {
  filterCode: true,
  filterRepeatedPrompts: true,
  filterUrls: true,
  filterStructuredData: true,
  stripMarkdown: true,
  minLineLength: 3,
  deduplicateParagraphs: true,
  filterTimestamps: true,
  filterIds: true,
  filterNoiseMarkers: true,
};

// Common prompt patterns to detect and remove
const PROMPT_PATTERNS: ReadonlyArray<RegExp> = [
  /system:\s*/gi,
  /user:\s*/gi,
  /assistant:\s*/gi,
  /human:\s*/gi,
  /ai:\s*/gi,
  /\[system\]/gi,
  /\[user\]/gi,
  /\[assistant\]/gi,
  /\[instruction\]/gi,
  /\[prompt\]/gi,
  /---\s*system\s*---/gi,
  /---\s*user\s*---/gi,
  /---\s*assistant\s*---/gi,
];

function removeCodeBlocks(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "");
}

function removeUrls(text: string): string {
  return text
    .replace(/https?:\/\/[^\s\)\]\>]+/g, "")
    .replace(/www\.[^\s\)\]\>]+/g, "")
    .replace(/[\w.-]+@[\w.-]+\.\w+/g, "");
}

function removeStructuredData(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/\{[\s\S]*?\}/g, "")
    .replace(/\[[\s\S]*?\]/g, "");
}

function removeMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*{1,2}|_{1,2})(.+?)\1/g, "$2")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "")
    .replace(/^>{1,}\s?/gm, "")
    .replace(/^-{3,}\s*$/gm, "");
}

function removePromptMarkers(text: string): { text: string; removedLines: number } {
  const lines = text.split("\n");
  const filtered: string[] = [];
  let removed = 0;
  for (const line of lines) {
    const isPrompt = PROMPT_PATTERNS.some((p) => p.test(line));
    if (isPrompt) {
      removed++;
      continue;
    }
    filtered.push(line);
  }
  return { text: filtered.join("\n"), removedLines: removed };
}

function removeTimestamps(text: string): string {
  return (
    text
      // ISO 8601: 2024-01-15T10:30:00.000Z or 2024-01-15 10:30:00+08:00
      .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})?/g, "")
      // Chinese date: 2024年01月15日 10:30:00
      .replace(/\d{4}[年/\-]\d{1,2}[月/\-]\d{1,2}[日\sT]?(\d{2}:\d{2}(:\d{2})?)?/g, "")
      // Unix epoch timestamps (10-13 digit standalone numbers)
      .replace(/(^|\s)\d{10,13}(\s|$)/g, " ")
  );
}

function removeIds(text: string): string {
  return (
    text
      // UUID
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "")
      // MongoDB ObjectId
      .replace(/[0-9a-f]{24}/gi, "")
      // NanoID-like (21 chars URL-safe)
      .replace(/(^|\s)[A-Za-z0-9_-]{21}(\s|$)/g, " ")
  );
}

function removeNoiseMarkers(text: string): string {
  return (
    text
      // cellundefined, cellnull, cellnan, etc.
      .replace(/\bcell(?:undefined|null|nan|none)\b/gi, "")
      // standalone undefined / null / NaN / None
      .replace(/\b(?:undefined|null|nan|none)\b/gi, "")
      // standalone true / false (when not part of a sentence)
      .replace(/(^|\s)(?:true|false)(\s|$)/gi, " ")
  );
}

function deduplicateParagraphs(text: string): { text: string; removed: number } {
  const paras = text.split(/\n\s*\n/);
  const seen = new Set<string>();
  const result: string[] = [];
  let removed = 0;
  for (const para of paras) {
    const normalized = para.trim().replace(/\s+/g, "");
    if (normalized.length === 0) continue;
    if (seen.has(normalized)) {
      removed++;
      continue;
    }
    seen.add(normalized);
    result.push(para);
  }
  return { text: result.join("\n\n"), removed };
}

function filterShortLines(text: string, minLength: number): { text: string; removed: number } {
  const lines = text.split("\n");
  const filtered = lines.filter((l) => l.trim().length >= minLength);
  return { text: filtered.join("\n"), removed: lines.length - filtered.length };
}

/**
 * Preprocess raw text for style analysis.
 */
export function preprocessText(
  text: string,
  options: PreprocessOptions = {},
): PreprocessResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const originalLen = text.length;
  const actions: string[] = [];
  let removedLines = 0;
  let removedParagraphs = 0;

  // 1. Remove code blocks
  if (opts.filterCode) {
    const before = text.length;
    text = removeCodeBlocks(text);
    if (text.length < before) {
      actions.push(`滤除代码块（-${before - text.length} 字）`);
    }
  }

  // 2. Remove structured data
  if (opts.filterStructuredData) {
    const before = text.length;
    text = removeStructuredData(text);
    if (text.length < before) {
      actions.push(`滤除结构化标记（-${before - text.length} 字）`);
    }
  }

  // 3. Remove markdown
  if (opts.stripMarkdown) {
    const before = text.length;
    text = removeMarkdown(text);
    if (text.length < before) {
      actions.push(`清理 Markdown 格式（-${before - text.length} 字）`);
    }
  }

  // 4. Remove URLs
  if (opts.filterUrls) {
    const before = text.length;
    text = removeUrls(text);
    if (text.length < before) {
      actions.push(`滤除 URL 和邮箱（-${before - text.length} 字）`);
    }
  }

  // 5. Remove timestamps
  if (opts.filterTimestamps) {
    const before = text.length;
    text = removeTimestamps(text);
    if (text.length < before) {
      actions.push(`滤除时间戳（-${before - text.length} 字）`);
    }
  }

  // 6. Remove IDs
  if (opts.filterIds) {
    const before = text.length;
    text = removeIds(text);
    if (text.length < before) {
      actions.push(`滤除 ID 标记（-${before - text.length} 字）`);
    }
  }

  // 7. Remove noise markers
  if (opts.filterNoiseMarkers) {
    const before = text.length;
    text = removeNoiseMarkers(text);
    if (text.length < before) {
      actions.push(`滤除噪音标记（-${before - text.length} 字）`);
    }
  }

  // 8. Remove prompt markers
  if (opts.filterRepeatedPrompts) {
    const r = removePromptMarkers(text);
    text = r.text;
    if (r.removedLines > 0) {
      removedLines += r.removedLines;
      actions.push(`滤除提示词标记（-${r.removedLines} 行）`);
    }
  }

  // 9. Filter short lines
  if (opts.minLineLength && opts.minLineLength > 0) {
    const r = filterShortLines(text, opts.minLineLength);
    text = r.text;
    if (r.removed > 0) {
      removedLines += r.removed;
      actions.push(`滤除短行（-${r.removed} 行）`);
    }
  }

  // 10. Deduplicate paragraphs
  if (opts.deduplicateParagraphs) {
    const r = deduplicateParagraphs(text);
    text = r.text;
    if (r.removed > 0) {
      removedParagraphs += r.removed;
      actions.push(`去重段落（-${r.removed} 段）`);
    }
  }

  return {
    text: text.trim(),
    removedChars: originalLen - text.trim().length,
    removedLines,
    removedParagraphs,
    actions,
  };
}

export type PreprocessExportFormat = "txt" | "md" | "html";

export interface PreprocessExportResult {
  readonly content: string;
  readonly mimeType: string;
  readonly extension: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Export preprocessed text to a specific format.
 */
export function exportPreprocessed(
  text: string,
  format: PreprocessExportFormat,
  title?: string,
): PreprocessExportResult {
  const safeTitle = (title || "export").replace(/[^\w\u4e00-\u9fa5._-]/g, "_");
  switch (format) {
    case "md":
      return {
        content: `# ${safeTitle}\n\n${text}`,
        mimeType: "text/markdown",
        extension: "md",
      };
    case "html": {
      const escaped = escapeHtml(text);
      return {
        content: `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${safeTitle}</title><style>body{font-family:system-ui,sans-serif;line-height:1.7;max-width:720px;margin:40px auto;padding:0 20px;color:#333}pre{white-space:pre-wrap;word-wrap:break-word;font-family:inherit;line-height:inherit}</style></head><body><pre>${escaped}</pre></body></html>`,
        mimeType: "text/html",
        extension: "html",
      };
    }
    default:
      return {
        content: text,
        mimeType: "text/plain",
        extension: "txt",
      };
  }
}
