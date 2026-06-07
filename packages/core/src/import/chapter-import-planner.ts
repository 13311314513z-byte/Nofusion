/**
 * Chapter import planner — preview split results and detect anomalies
 * before committing to the filesystem.
 */

import { splitChapters } from "../utils/chapter-splitter.js";

export interface ChapterImportItem {
  readonly targetNumber: number;
  readonly title: string;
  readonly content: string;
  readonly wordCount: number;
  readonly firstParagraph: string;
  readonly lastParagraph: string;
  readonly status: "ok" | "too-short" | "too-long" | "empty" | "duplicate-title";
}

export interface ChapterImportWarning {
  readonly type: string;
  readonly message: string;
  readonly affectedNumbers: number[];
}

export interface ChapterImportPlan {
  readonly chapters: ChapterImportItem[];
  readonly warnings: ChapterImportWarning[];
  readonly suggestedStartNumber: number;
}

const TOO_SHORT_THRESHOLD = 200;
const TOO_LONG_THRESHOLD = 10000;

function countCjkChars(text: string): number {
  // Count CJK characters as words for Chinese text.
  // Covering: Basic CJK (U+4E00–U+9FFF), Extension A (U+3400–U+4DBF),
  // CJK Compatibility (U+F900–U+FAFF).
  // Note: Extensions B+ (supplementary plane) use surrogate pairs in JS;
  // the regex below captures the most common ranges used in modern Chinese text.
  const cjk = (
    text.match(
      // Basic CJK + Extension A + Compatibility
      /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g
    ) ?? []
  ).length;
  // Count English words roughly
  const enWords = (text.match(/[a-zA-Z]+/g) ?? []).length;
  return Math.max(cjk, enWords);
}

function extractPreviewParagraph(content: string, fromStart: boolean): string {
  const paras = content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (paras.length === 0) return "";
  const raw = fromStart ? paras[0] : paras[paras.length - 1];
  return raw.length > 120 ? raw.slice(0, 120) + "…" : raw;
}

export function planChapterImport(
  text: string,
  options?: { splitRegex?: string; startNumber?: number },
): ChapterImportPlan {
  let rawChapters: ReturnType<typeof splitChapters>;
  try {
    rawChapters = splitChapters(text, options?.splitRegex);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      chapters: [],
      warnings: [{ type: "invalid-regex", message: `拆分规则错误：${msg}`, affectedNumbers: [] }],
      suggestedStartNumber: 1,
    };
  }
  const startNumber = Math.max(1, Math.floor(options?.startNumber ?? 1));

  // First pass: count title occurrences
  const titleCounts = new Map<string, number[]>();
  for (let i = 0; i < rawChapters.length; i++) {
    const ch = rawChapters[i]!;
    const targetNumber = startNumber + i;
    const titleKey = ch.title.trim() || `__empty_${i}`;
    const existing = titleCounts.get(titleKey) ?? [];
    existing.push(targetNumber);
    titleCounts.set(titleKey, existing);
  }

  // Build duplicate set
  const duplicateNumbers = new Set<number>();
  for (const [title, numbers] of titleCounts.entries()) {
    if (numbers.length > 1 && !title.startsWith("__empty_")) {
      for (const n of numbers) duplicateNumbers.add(n);
    }
  }

  // Second pass: build items with final status
  const chapters: ChapterImportItem[] = [];
  for (let i = 0; i < rawChapters.length; i++) {
    const ch = rawChapters[i]!;
    const targetNumber = startNumber + i;
    const wordCount = countCjkChars(ch.content);

    let status: ChapterImportItem["status"];
    if (wordCount === 0) {
      status = "empty";
    } else if (wordCount < TOO_SHORT_THRESHOLD) {
      status = "too-short";
    } else if (wordCount > TOO_LONG_THRESHOLD) {
      status = "too-long";
    } else {
      status = "ok";
    }

    if (duplicateNumbers.has(targetNumber) && status !== "empty") {
      status = "duplicate-title";
    }

    chapters.push({
      targetNumber,
      title: ch.title,
      content: ch.content,
      wordCount,
      firstParagraph: extractPreviewParagraph(ch.content, true),
      lastParagraph: extractPreviewParagraph(ch.content, false),
      status,
    });
  }

  // Build warnings
  const warnings: ChapterImportWarning[] = [];

  const emptyChapters = chapters.filter((c) => c.status === "empty");
  if (emptyChapters.length > 0) {
    warnings.push({
      type: "empty",
      message: `发现 ${emptyChapters.length} 个空章节（无正文）`,
      affectedNumbers: emptyChapters.map((c) => c.targetNumber),
    });
  }

  const shortChapters = chapters.filter((c) => c.status === "too-short");
  if (shortChapters.length > 0) {
    warnings.push({
      type: "too-short",
      message: `发现 ${shortChapters.length} 个过短章节（< ${TOO_SHORT_THRESHOLD} 字）`,
      affectedNumbers: shortChapters.map((c) => c.targetNumber),
    });
  }

  const longChapters = chapters.filter((c) => c.status === "too-long");
  if (longChapters.length > 0) {
    warnings.push({
      type: "too-long",
      message: `发现 ${longChapters.length} 个超长章节（> ${TOO_LONG_THRESHOLD} 字）`,
      affectedNumbers: longChapters.map((c) => c.targetNumber),
    });
  }

  const dupChapters = chapters.filter((c) => c.status === "duplicate-title");
  if (dupChapters.length > 0) {
    warnings.push({
      type: "duplicate-title",
      message: `发现 ${dupChapters.length} 个重复标题章节`,
      affectedNumbers: dupChapters.map((c) => c.targetNumber),
    });
  }

  if (chapters.length === 0) {
    warnings.push({
      type: "no-chapters",
      message: "未识别到任何章节标题，请检查拆分规则",
      affectedNumbers: [],
    });
  }

  return {
    chapters,
    warnings,
    suggestedStartNumber: startNumber,
  };
}
