/**
 * Text relayout — reformat and restructure preprocessed text.
 */

export interface RelayoutOptions {
  /** Merge paragraphs shorter than N chars */
  readonly mergeShortParagraphs?: boolean;
  readonly shortParagraphThreshold?: number;
  /** Format dialogue lines (ensure each dialogue starts new line) */
  readonly formatDialogue?: boolean;
  /** Add blank line between paragraphs if missing */
  readonly ensureParagraphSpacing?: boolean;
  /** Normalize quotation marks to Chinese style */
  readonly normalizeQuotes?: boolean;
  /** Remove excessive blank lines */
  readonly compressBlankLines?: boolean;
}

export interface RelayoutResult {
  readonly text: string;
  readonly originalParagraphs: number;
  readonly finalParagraphs: number;
  readonly mergedParagraphs: number;
}

const DEFAULT_OPTIONS: RelayoutOptions = {
  mergeShortParagraphs: true,
  shortParagraphThreshold: 20,
  formatDialogue: true,
  ensureParagraphSpacing: true,
  normalizeQuotes: true,
  compressBlankLines: true,
};

function normalizeQuotes(text: string): string {
  return text
    .replace(/"/g, "\"")
    .replace(/"/g, "\"")
    .replace(/'/g, "'")
    .replace(/'/g, "'")
    .replace(/「/g, "\"")
    .replace(/」/g, "\"");
}

function formatDialogue(text: string): string {
  // Ensure dialogue lines start on new lines
  // Pattern: text followed by Chinese quotes
  const lines = text.split("\n");
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      result.push("");
      continue;
    }
    // Split by Chinese quotes if preceded by dialogue markers
    const dialoguePattern = /([^。！？\n]*?(?:说|道|问|答|喊|叫|笑|怒|叹)[^。！？\n]*?)([""].*?[""])/g;
    let match: RegExpExecArray | null;
    let lastIndex = 0;
    const parts: string[] = [];
    while ((match = dialoguePattern.exec(trimmed)) !== null) {
      if (match.index > lastIndex) {
        parts.push(trimmed.slice(lastIndex, match.index));
      }
      parts.push(match[1] + match[2]);
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < trimmed.length) {
      parts.push(trimmed.slice(lastIndex));
    }
    if (parts.length > 1) {
      result.push(...parts.filter((p) => p.trim()));
    } else {
      result.push(trimmed);
    }
  }
  return result.join("\n");
}

function mergeShortParagraphs(text: string, threshold: number): { text: string; merged: number } {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
  const result: string[] = [];
  let merged = 0;
  let buffer = "";

  for (const para of paras) {
    if (para.length < threshold) {
      buffer = buffer ? buffer + para : para;
      merged++;
    } else {
      if (buffer) {
        result.push(buffer);
        buffer = "";
      }
      result.push(para);
    }
  }
  if (buffer) {
    result.push(buffer);
  }
  return { text: result.join("\n\n"), merged };
}

function ensureParagraphSpacing(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let prevWasEmpty = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      if (!prevWasEmpty) {
        result.push("");
        prevWasEmpty = true;
      }
      continue;
    }
    if (result.length > 0 && !prevWasEmpty && trimmed.length > 20) {
      result.push("");
    }
    result.push(trimmed);
    prevWasEmpty = false;
  }
  return result.join("\n");
}

function compressBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n");
}

/**
 * Relayout preprocessed text into readable format.
 */
export function relayoutText(
  text: string,
  options: RelayoutOptions = {},
): RelayoutResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const originalParas = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;
  let merged = 0;

  if (opts.normalizeQuotes) {
    text = normalizeQuotes(text);
  }

  if (opts.formatDialogue) {
    text = formatDialogue(text);
  }

  if (opts.ensureParagraphSpacing) {
    text = ensureParagraphSpacing(text);
  }

  if (opts.mergeShortParagraphs && opts.shortParagraphThreshold) {
    const r = mergeShortParagraphs(text, opts.shortParagraphThreshold);
    text = r.text;
    merged = r.merged;
  }

  if (opts.compressBlankLines) {
    text = compressBlankLines(text);
  }

  const finalParas = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;

  return {
    text: text.trim(),
    originalParagraphs: originalParas,
    finalParagraphs: finalParas,
    mergedParagraphs: merged,
  };
}
