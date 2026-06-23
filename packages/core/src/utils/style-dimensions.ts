/**
 * Style dimensions — expanded author style analysis dimensions.
 *
 * Pure functions for computing:
 *   - Sentence type distribution (declarative/interrogative/exclamatory/imperative)
 *   - Paragraph rhythm (short/medium/long paragraph rates)
 *   - Rhetoric breakdown (per-category rates via detectDuplicateRhetoric)
 *   - Dialogue features (avg length, frequency, tag distribution)
 *   - Comprehensive expanded fingerprint
 *   - Dimension samples extraction
 */

import type { StyleFingerprint } from "../models/style-profile.js";
import { detectDuplicateRhetoric,type DuplicateRhetoricResult,type RhetoricCategory } from "../utils/semantic-duplication.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SentenceTypeDistribution {
  readonly declarative: number;
  readonly interrogative: number;
  readonly exclamatory: number;
  readonly imperative: number;
}

export interface ParagraphRhythm {
  readonly shortParaRate: number;
  readonly mediumParaRate: number;
  readonly longParaRate: number;
  readonly lengthHistogram: ReadonlyArray<{ readonly range: string; readonly count: number }>;
}

export interface RhetoricBreakdown {
  readonly metaphorRate: number;
  readonly parallelismRate: number;
  readonly personificationRate: number;
  readonly hyperboleRate: number;
  readonly rhetoricalQuestionRate: number;
  readonly repetitionRate: number;
}

export interface DialogueFeatures {
  readonly avgDialogueLength: number;
  readonly dialogueFrequency: number;
  readonly dialogueTagRatio: Record<string, number>;
}

export interface DimensionSample {
  readonly dimension: string;
  readonly label: string;
  readonly value: number;
  readonly samples: ReadonlyArray<{
    readonly text: string;
    readonly lineNumber: number;
    readonly highlightRange?: { readonly start: number; readonly end: number };
  }>;
  readonly benchmark?: {
    readonly average: number;
    readonly high: number;
  };
}

// ---------------------------------------------------------------------------
// Sentence type distribution
// ---------------------------------------------------------------------------

/**
 * Compute sentence type distribution based on ending punctuation.
 * - declarative: ends with 。or nothing
 * - interrogative: ends with ？
 * - exclamatory: ends with ！
 * - imperative: ends with ！or 。but contains imperative verbs
 */
export function computeSentenceTypeDistribution(text: string): SentenceTypeDistribution {
  const sentences = text.split(/[。！？\n]/).filter((s) => s.trim().length > 0);
  if (sentences.length === 0) {
    return { declarative: 0, interrogative: 0, exclamatory: 0, imperative: 0 };
  }

  const IMPERATIVE_MARKERS = /[请让别勿禁止必须定要]/;

  let declarative = 0;
  let interrogative = 0;
  let exclamatory = 0;
  let imperative = 0;

  // Re-split with punctuation capture
  const rawSentences = text.split(/(?<=[。！？\n])/);
  for (const s of rawSentences) {
    const trimmed = s.trim();
    if (trimmed.length < 2) continue;

    if (trimmed.endsWith("？") || trimmed.endsWith("?")) {
      interrogative++;
    } else if (trimmed.endsWith("！") || trimmed.endsWith("!")) {
      if (IMPERATIVE_MARKERS.test(trimmed)) imperative++;
      else exclamatory++;
    } else {
      // Ends with 。or other
      if (IMPERATIVE_MARKERS.test(trimmed)) imperative++;
      else declarative++;
    }
  }

  const total = declarative + interrogative + exclamatory + imperative;
  if (total === 0) return { declarative: 0, interrogative: 0, exclamatory: 0, imperative: 0 };

  return {
    declarative: Math.round((declarative / total) * 100) / 100,
    interrogative: Math.round((interrogative / total) * 100) / 100,
    exclamatory: Math.round((exclamatory / total) * 100) / 100,
    imperative: Math.round((imperative / total) * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Paragraph rhythm
// ---------------------------------------------------------------------------

/**
 * Compute paragraph length distribution.
 * Short: <35 chars, Medium: 35-200 chars, Long: >200 chars.
 */
export function computeParagraphRhythm(text: string): ParagraphRhythm {
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  if (paragraphs.length === 0) {
    return { shortParaRate: 0, mediumParaRate: 0, longParaRate: 0, lengthHistogram: [] };
  }

  let short = 0;
  let medium = 0;
  let long = 0;

  const histogram = new Map<string, number>();
  const ranges = ["0-20", "21-35", "36-50", "51-80", "81-120", "121-200", "201-300", "301+"];

  for (const p of paragraphs) {
    const len = p.replace(/\s/g, "").length;
    if (len < 35) short++;
    else if (len <= 200) medium++;
    else long++;

    const range =
      len <= 20 ? "0-20" :
      len <= 35 ? "21-35" :
      len <= 50 ? "36-50" :
      len <= 80 ? "51-80" :
      len <= 120 ? "81-120" :
      len <= 200 ? "121-200" :
      len <= 300 ? "201-300" : "301+";
    histogram.set(range, (histogram.get(range) ?? 0) + 1);
  }

  const total = paragraphs.length;
  return {
    shortParaRate: Math.round((short / total) * 100) / 100,
    mediumParaRate: Math.round((medium / total) * 100) / 100,
    longParaRate: Math.round((long / total) * 100) / 100,
    lengthHistogram: ranges.map((r) => ({ range: r, count: histogram.get(r) ?? 0 })),
  };
}

// ---------------------------------------------------------------------------
// Rhetoric breakdown
// ---------------------------------------------------------------------------

/**
 * Compute per-category rhetoric rates (occurrences per 1000 chars).
 * Reuses detectDuplicateRhetoric for consistency.
 */
export function computeRhetoricBreakdown(
  text: string,
  language: "zh" | "en" = "zh",
  precomputed?: import("../utils/semantic-duplication.js").DuplicateRhetoricResult,
): RhetoricBreakdown {
  const result = precomputed ?? detectDuplicateRhetoric(text, language);
  const totalChars = text.length;
  const perThousand = (count: number) => totalChars > 0 ? (count / totalChars) * 1000 : 0;

  const findByCategory = (cat: RhetoricCategory) =>
    result.findings.find((f) => f.category === cat);

  return {
    metaphorRate: perThousand(findByCategory("metaphor")?.count ?? 0),
    parallelismRate: perThousand(findByCategory("parallelism")?.count ?? 0),
    personificationRate: perThousand(findByCategory("personification")?.count ?? 0),
    hyperboleRate: perThousand(findByCategory("hyperbole")?.count ?? 0),
    rhetoricalQuestionRate: perThousand(findByCategory("rhetorical-question")?.count ?? 0),
    repetitionRate: perThousand(findByCategory("repetition")?.count ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Dialogue features
// ---------------------------------------------------------------------------

const DIALOGUE_TAGS = ["说", "道", "问", "回答", "喊", "叫", "骂", "嚷", "吼", "答", "应", "嘀咕", "嘟囔", "吩咐", "嘱咐", "告诉", "解释", "强调", "补充", "打断"];

/**
 * Compute dialogue features from text.
 * Detects dialogue lines (text between quotes 「」 or "").
 */
export function computeDialogueFeatures(
  text: string,
  _language: "zh" | "en" = "zh",
): DialogueFeatures {
  const lines = text.split("\n");
  let dialogueChars = 0;
  let dialogueCount = 0;
  const tagCounts: Record<string, number> = {};

  for (const line of lines) {
    // Detect Chinese dialogue: 「...」 or "..."
    const zhDialogue = line.match(/「[^」]*」|"[^"]*"/g);
    if (zhDialogue) {
      for (const d of zhDialogue) {
        dialogueChars += d.length;
        dialogueCount++;
      }
    }

    // Detect dialogue tags
    for (const tag of DIALOGUE_TAGS) {
      if (line.includes(tag)) {
        tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
      }
    }
  }

  const totalChars = text.replace(/\s/g, "").length;
  const avgDialogueLength = dialogueCount > 0 ? Math.round(dialogueChars / dialogueCount) : 0;
  const dialogueFrequency = totalChars > 0 ? (dialogueCount / totalChars) * 1000 : 0;

  // Normalize tag ratios
  const totalTags = Object.values(tagCounts).reduce((a, b) => a + b, 0);
  const dialogueTagRatio: Record<string, number> = {};
  for (const [tag, count] of Object.entries(tagCounts)) {
    dialogueTagRatio[tag] = totalTags > 0 ? Math.round((count / totalTags) * 100) / 100 : 0;
  }

  return {
    avgDialogueLength,
    dialogueFrequency: Math.round(dialogueFrequency * 100) / 100,
    dialogueTagRatio,
  };
}

// ---------------------------------------------------------------------------
// Expanded fingerprint
// ---------------------------------------------------------------------------

export interface ExpandedFingerprint extends StyleFingerprint {
  readonly sentenceTypeDistribution: SentenceTypeDistribution;
  readonly paragraphRhythm: ParagraphRhythm;
  readonly rhetoricBreakdown: RhetoricBreakdown;
  readonly dialogueFeatures: DialogueFeatures;
}

export function computeExpandedFingerprint(
  text: string,
  baseFingerprint: StyleFingerprint,
  precomputedRhetoric?: DuplicateRhetoricResult,
): ExpandedFingerprint {
  return {
    ...baseFingerprint,
    sentenceTypeDistribution: computeSentenceTypeDistribution(text),
    paragraphRhythm: computeParagraphRhythm(text),
    rhetoricBreakdown: computeRhetoricBreakdown(text, "zh", precomputedRhetoric),
    dialogueFeatures: computeDialogueFeatures(text),
  };
}

// ---------------------------------------------------------------------------
// Dimension samples extraction
// ---------------------------------------------------------------------------

const ACTION_VERBS = [
  "走", "跑", "跳", "抓", "拿", "放", "推", "拉", "打", "踢",
  "站", "坐", "蹲", "躺", "爬", "翻", "转", "冲", "退", "进",
  "举", "抬", "低", "仰", "侧", "弯", "伸", "缩", "握", "抱",
  "扔", "抛", "接", "撕", "扯", "折", "敲", "拍", "按", "捏",
];

const PSYCH_VERBS = [
  "想", "觉得", "感到", "认为", "以为", "猜测", "怀疑", "相信",
  "希望", "渴望", "害怕", "担心", "忧虑", "后悔", "自责",
  "回忆", "记起", "忘记", "思", "考量",
];

/**
 * Extract representative samples for each dimension.
 */
export function extractDimensionSamples(
  text: string,
  fingerprint: ExpandedFingerprint,
  language: "zh" | "en" = "zh",
): ReadonlyArray<DimensionSample> {
  const samples: DimensionSample[] = [];
  const sentences = text.split(/[。！？\n]/).filter((s) => s.trim().length > 0);
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

  // Helper: find line number for a substring
  const findLine = (sub: string): number => {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(sub.slice(0, Math.min(15, sub.length)))) return i + 1;
    }
    return 0;
  };

  // 1. Dialogue samples
  if (fingerprint.dialogueRatio > 0.1) {
    const dialogueLines = paragraphs
      .filter((p) => /「[^」]*」/.test(p))
      .sort((a, b) => b.length - a.length)
      .slice(0, 2)
      .map((p) => ({
        text: p.length > 120 ? p.slice(0, 120) + "…" : p,
        lineNumber: findLine(p),
      }));
    if (dialogueLines.length > 0) {
      samples.push({
        dimension: "dialogue",
        label: "对话占比",
        value: fingerprint.dialogueRatio,
        samples: dialogueLines,
      });
    }
  }

  // 2. Action density samples
  if (fingerprint.actionDensity > 0.1) {
    const scored = sentences
      .map((s) => ({
        text: s.trim(),
        score: ACTION_VERBS.reduce((sum, v) => sum + (s.includes(v) ? 1 : 0), 0),
      }))
      .filter((a) => a.score >= 3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map((a) => ({
        text: a.text.length > 120 ? a.text.slice(0, 120) + "…" : a.text,
        lineNumber: findLine(a.text),
      }));
    if (scored.length > 0) {
      samples.push({
        dimension: "action",
        label: "动作密度",
        value: fingerprint.actionDensity,
        samples: scored,
      });
    }
  }

  // 3. Psychological description samples
  if (fingerprint.psychologicalRatio > 0.1) {
    const psychSamples = sentences
      .filter((s) => PSYCH_VERBS.some((v) => s.includes(v)))
      .slice(0, 2)
      .map((s) => ({
        text: s.trim().length > 120 ? s.trim().slice(0, 120) + "…" : s.trim(),
        lineNumber: findLine(s),
      }));
    if (psychSamples.length > 0) {
      samples.push({
        dimension: "psychological",
        label: "心理占比",
        value: fingerprint.psychologicalRatio,
        samples: psychSamples,
      });
    }
  }

  // 4. Metaphor samples (via detectDuplicateRhetoric)
  const rhetoricResult = detectDuplicateRhetoric(text, language);
  const metaphorFinding = rhetoricResult.findings.find((f) => f.category === "metaphor");
  if (metaphorFinding && metaphorFinding.count >= 2) {
    samples.push({
      dimension: "metaphor",
      label: "比喻手法",
      value: metaphorFinding.perThousandChars,
      samples: metaphorFinding.examples.slice(0, 2).map((ex) => ({
        text: ex.text.length > 120 ? ex.text.slice(0, 120) + "…" : ex.text,
        lineNumber: ex.lineNumber,
      })),
    });
  }

  // 5. Parallelism samples
  const parallelFinding = rhetoricResult.findings.find((f) => f.category === "parallelism");
  if (parallelFinding && parallelFinding.count >= 2) {
    samples.push({
      dimension: "parallelism",
      label: "排比句式",
      value: parallelFinding.perThousandChars,
      samples: parallelFinding.examples.slice(0, 2).map((ex) => ({
        text: ex.text.length > 120 ? ex.text.slice(0, 120) + "…" : ex.text,
        lineNumber: ex.lineNumber,
      })),
    });
  }

  return samples;
}
