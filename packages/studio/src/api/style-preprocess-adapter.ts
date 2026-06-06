/**
 * Style preprocess adapter — Studio API layer for input inspection and
 * request validation, sitting between HTTP handlers and Core.
 *
 * This module performs ONLY read-only checks and option sanitization.
 * It does NOT call Core preprocessText/relayoutText.
 */

import type { InspectionCode, InspectionFinding, InspectionResult } from "../pages/style-preprocess-state.js";

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

const KNOWN_PREPROCESS_OPTIONS = new Set([
  "filterCode",
  "filterRepeatedPrompts",
  "filterUrls",
  "filterStructuredData",
  "stripMarkdown",
  "minLineLength",
  "deduplicateParagraphs",
  "filterTimestamps",
  "filterIds",
  "filterNoiseMarkers",
]);

const KNOWN_RELAYOUT_OPTIONS = new Set([
  "mergeShortParagraphs",
  "shortParagraphThreshold",
  "formatDialogue",
  "ensureParagraphSpacing",
  "normalizeQuotes",
  "compressBlankLines",
]);

/**
 * Validate and sanitize preprocess options from an untrusted request.
 * Returns the validated options or throws with a descriptive message.
 */
export function validatePreprocessOptions(raw: Record<string, unknown>): Record<string, unknown> {
  const errors: string[] = [];
  const validated: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (!KNOWN_PREPROCESS_OPTIONS.has(key) && !KNOWN_RELAYOUT_OPTIONS.has(key)) {
      errors.push(`未知选项: ${key}`);
      continue;
    }

    // Type-specific validation
    if (key === "minLineLength") {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
        errors.push(`${key} 必须在 0-100 之间`);
        continue;
      }
    } else if (key === "shortParagraphThreshold") {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 200) {
        errors.push(`${key} 必须在 1-200 之间`);
        continue;
      }
    } else if (typeof value !== "boolean") {
      errors.push(`${key} 必须是布尔值`);
      continue;
    }

    validated[key] = value;
  }

  if (errors.length > 0) {
    throw new Error(`选项校验失败: ${errors.join("; ")}`);
  }

  return validated;
}

// ---------------------------------------------------------------------------
// Input inspection (read-only)
// ---------------------------------------------------------------------------

const INSPECTION_LINE_LIMIT = 100_000;

/**
 * Run read-only inspection on extracted/preprocessed text.
 * Never modifies the input text.
 */
export function inspectText(text: string, checks?: InspectionCode[]): InspectionResult {
  const lines = text.split("\n");
  const charCount = text.length;
  const lineCount = lines.length;
  const paragraphCount = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;

  const findings: InspectionFinding[] = [];

  // Truncate for performance if text is very large
  const inspectText = text.length > INSPECTION_LINE_LIMIT * 80
    ? text.slice(0, INSPECTION_LINE_LIMIT * 80)
    : text;

  const shouldCheck = (code: InspectionCode): boolean =>
    !checks || checks.length === 0 || checks.includes(code);

  // --- Explicit think blocks ---
  if (shouldCheck("explicit-think-block")) {
    const thinkMatches = inspectText.matchAll(/<(think|thought|reasoning|analysis|cot)>[\s\S]*?<\/(?:think|thought|reasoning|analysis|cot)>/gi);
    const blocks: string[] = [];
    const lineNums: number[] = [];
    let count = 0;
    for (const m of thinkMatches) {
      if (count >= 5) break;
      blocks.push(m[0].slice(0, 120).replace(/\n/g, " "));
      // Find approximate line number
      const before = inspectText.slice(0, m.index);
      lineNums.push(before.split("\n").length);
      count++;
    }
    if (count > 0) {
      findings.push({
        code: "explicit-think-block",
        severity: "warning",
        count,
        lineNumbers: lineNums,
        samples: blocks,
        messageKey: "style.inspect.explicitThinkBlock",
      });
    }
  }

  // --- Encoded data (Base64-like long strings) ---
  if (shouldCheck("encoded-data")) {
    const b64Matches = inspectText.match(/[A-Za-z0-9+/=]{100,}/g);
    if (b64Matches) {
      const valid = b64Matches.filter((m) => {
        const base64Ratio = (m.match(/[A-Za-z0-9+/=]/g) ?? []).length / m.length;
        return base64Ratio > 0.95;
      });
      if (valid.length > 0) {
        findings.push({
          code: "encoded-data",
          severity: "info",
          count: valid.length,
          samples: valid.slice(0, 5).map((s) => s.slice(0, 80) + (s.length > 80 ? "…" : "")),
          messageKey: "style.inspect.encodedData",
        });
      }
    }
  }

  // --- Mixed language detection ---
  if (shouldCheck("mixed-language")) {
    const paras = inspectText.split(/\n\s*\n/).filter((p) => p.trim().length > 20);
    let zhParas = 0;
    let enParas = 0;
    let mixedParas = 0;

    for (const para of paras.slice(0, 200)) {
      const cjkCount = (para.match(/[\u4e00-\u9fff]/g) ?? []).length;
      const enCount = (para.match(/[a-zA-Z]/g) ?? []).length;
      const total = cjkCount + enCount;
      if (total === 0) continue;
      const ratio = cjkCount / total;
      if (ratio > 0.7) zhParas++;
      else if (ratio < 0.3) enParas++;
      else mixedParas++;
    }

    const total = zhParas + enParas + mixedParas;
    if (total > 0 && mixedParas / total > 0.3) {
      findings.push({
        code: "mixed-language",
        severity: "info",
        count: mixedParas,
        samples: [`中文段 ${zhParas} / 英文段 ${enParas} / 混合段 ${mixedParas}`],
        messageKey: "style.inspect.mixedLanguage",
      });
    }
  }

  // --- High whitespace ratio ---
  if (shouldCheck("high-whitespace")) {
    const whitespaceRatio = (text.match(/\s/g) ?? []).length / text.length;
    if (whitespaceRatio > 0.6) {
      findings.push({
        code: "high-whitespace",
        severity: "warning",
        count: 1,
        samples: [`空白比例: ${(whitespaceRatio * 100).toFixed(1)}%`],
        messageKey: "style.inspect.highWhitespace",
      });
    }
  }

  // --- Possible garbled text ---
  if (shouldCheck("possible-garbled-text")) {
    const garbledRatio = (text.match(/[\uFFFD\u0000-\u0008\u000B-\u000C\u000E-\u001F]/g) ?? []).length / text.length;
    if (garbledRatio > 0.05) {
      findings.push({
        code: "possible-garbled-text",
        severity: "warning",
        count: 1,
        samples: [`乱码比例: ${(garbledRatio * 100).toFixed(1)}%`],
        messageKey: "style.inspect.possibleGarbledText",
      });
    }
  }

  return { charCount, lineCount, paragraphCount, findings };
}

/**
 * Count total number of a regex pattern matches in text (up to a limit).
 */
function countMatches(text: string, pattern: RegExp, limit: number): number {
  let count = 0;
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  while (re.exec(text) !== null) {
    count++;
    if (count >= limit) break;
  }
  return count;
}
