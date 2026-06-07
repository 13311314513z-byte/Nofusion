/**
 * Style comparator — compares current text style against an author profile.
 *
 * Pure function, no LLM, no file I/O.
 * Reuses analyzeStyle() and analyzeStyleFingerprint() for text analysis,
 * then compares 8 core metrics against the author's aggregateProfile.
 */

import { analyzeStyle } from "./style-analyzer.js";
import { analyzeStyleFingerprint } from "./style-fingerprint.js";
import type { AuthorStyleProfile } from "../style-library/models.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Deviation {
  readonly metric: string;
  readonly currentValue: number;
  readonly targetValue: number;
  readonly normalizedDeviation: number;  // [-1, 1]; 0 = exact match
  readonly direction: "above" | "below" | "match";
  readonly suggestionKey: string;        // i18n key for suggestion text
}

export interface StyleComparisonResult {
  readonly targetAuthorId: string;
  readonly targetAuthor: string;
  readonly targetProfileVersion: number;
  readonly sampleAdequacy: "insufficient" | "limited" | "sufficient";
  readonly deviations: ReadonlyArray<Deviation>;
  readonly overallMatchScore: number;    // 0-100
}

// ---------------------------------------------------------------------------
// Metric definitions
// ---------------------------------------------------------------------------

interface MetricDef {
  readonly key: string;
  readonly labelKey: string;     // i18n
  readonly extract: (profile: ReturnType<typeof analyzeStyle>, fingerprint: ReturnType<typeof analyzeStyleFingerprint>) => number;
  readonly extractTarget: (authorProfile: AuthorStyleProfile) => number;
  readonly tolerance: number;    // acceptable relative difference before flagging
}

const METRICS: ReadonlyArray<MetricDef> = [
  {
    key: "avgSentenceLength",
    labelKey: "style.metric.avgSentenceLength",
    extract: (p) => p.avgSentenceLength,
    extractTarget: (p) => p.aggregateProfile.avgSentenceLength,
    tolerance: 0.2,
  },
  {
    key: "sentenceLengthStdDev",
    labelKey: "style.metric.sentenceLengthStdDev",
    extract: (p) => p.sentenceLengthStdDev,
    extractTarget: (p) => p.aggregateProfile.sentenceLengthStdDev,
    tolerance: 0.3,
  },
  {
    key: "avgParagraphLength",
    labelKey: "style.metric.avgParagraphLength",
    extract: (p) => p.avgParagraphLength,
    extractTarget: (p) => p.aggregateProfile.avgParagraphLength,
    tolerance: 0.25,
  },
  {
    key: "vocabularyDiversity",
    labelKey: "style.metric.vocabularyDiversity",
    extract: (p) => p.vocabularyDiversity,
    extractTarget: (p) => p.aggregateProfile.vocabularyDiversity,
    tolerance: 0.15,
  },
  {
    key: "dialogueRatio",
    labelKey: "style.metric.dialogueRatio",
    extract: (_p, f) => f.dialogueRatio,
    extractTarget: (p) => p.aggregateProfile.fingerprint.dialogueRatio,
    tolerance: 0.3,
  },
  {
    key: "actionDensity",
    labelKey: "style.metric.actionDensity",
    extract: (_p, f) => f.actionDensity,
    extractTarget: (p) => p.aggregateProfile.fingerprint.actionDensity,
    tolerance: 0.3,
  },
  {
    key: "psychologicalRatio",
    labelKey: "style.metric.psychologicalRatio",
    extract: (_p, f) => f.psychologicalRatio,
    extractTarget: (p) => p.aggregateProfile.fingerprint.psychologicalRatio,
    tolerance: 0.35,
  },
  {
    key: "sensoryDensity",
    labelKey: "style.metric.sensoryDensity",
    extract: (_p, f) => f.sensoryDensity,
    extractTarget: (p) => p.aggregateProfile.fingerprint.sensoryDensity,
    tolerance: 0.3,
  },
];

// ---------------------------------------------------------------------------
// Comparison logic
// ---------------------------------------------------------------------------

function normalizeDeviation(
  current: number,
  target: number,
  tolerance: number,
): { normalizedDeviation: number; direction: "above" | "below" | "match" } {
  // Target is 0 or very small — skip meaningful comparison
  if (target < 0.001) {
    return { normalizedDeviation: 0, direction: "match" };
  }

  const diff = (current - target) / target;
  const absDiff = Math.abs(diff);

  if (absDiff <= tolerance) {
    return { normalizedDeviation: 0, direction: "match" };
  }

  // Clamp to [-1, 1]
  const clamped = Math.max(-1, Math.min(1, diff));
  return {
    normalizedDeviation: clamped,
    direction: clamped > 0 ? "above" : "below",
  };
}

function rankAdequacy(value: "insufficient" | "limited" | "sufficient"): number {
  switch (value) {
    case "sufficient": return 2;
    case "limited": return 1;
    default: return 0;
  }
}

function minAdequacy(
  a: "insufficient" | "limited" | "sufficient",
  b: "insufficient" | "limited" | "sufficient",
): "insufficient" | "limited" | "sufficient" {
  return rankAdequacy(a) <= rankAdequacy(b) ? a : b;
}

function textSampleAdequacy(textLength: number): "insufficient" | "limited" | "sufficient" {
  return textLength < 500 ? "insufficient"
    : textLength < 2000 ? "limited"
      : "sufficient";
}

function authorSampleAdequacy(authorProfile: AuthorStyleProfile): "insufficient" | "limited" | "sufficient" {
  const { sourceCount, totalChars } = authorProfile.sampleStats;
  if (sourceCount === 0 || totalChars < 1000) return "insufficient";
  if (sourceCount < 2 || totalChars < 3000) return "limited";
  return "sufficient";
}

/**
 * Compare a text's style against an author's aggregate profile.
 *
 * @param text - The text to analyze (min 100 chars for meaningful comparison)
 * @param authorProfile - The target author profile from style-library
 * @returns A structured comparison result with per-metric deviations
 */
export function compareWithAuthorProfile(
  text: string,
  authorProfile: AuthorStyleProfile,
): StyleComparisonResult {
  if (!text || text.trim().length < 50) {
    return {
      targetAuthorId: authorProfile.id,
      targetAuthor: authorProfile.name,
      targetProfileVersion: authorProfile.version,
      sampleAdequacy: "insufficient",
      deviations: [],
      overallMatchScore: 0,
    };
  }

  // 1. Analyze current text using existing tools
  const profile = analyzeStyle(text);
  const fingerprint = analyzeStyleFingerprint(text);

  // 2. Sample adequacy considers both the current text and target author profile.
  const sampleAdequacy = minAdequacy(
    textSampleAdequacy(text.length),
    authorSampleAdequacy(authorProfile),
  );

  // 3. Compare each metric
  const deviations: Deviation[] = [];
  let totalWeight = 0;
  let weightedScore = 0;

  for (const metric of METRICS) {
    const currentValue = metric.extract(profile, fingerprint);
    const targetValue = metric.extractTarget(authorProfile);

    const { normalizedDeviation, direction } = normalizeDeviation(
      currentValue,
      targetValue,
      metric.tolerance,
    );

    // Only include deviations that exceed tolerance
    if (normalizedDeviation !== 0) {
      deviations.push({
        metric: metric.key,
        currentValue: Math.round(currentValue * 100) / 100,
        targetValue: Math.round(targetValue * 100) / 100,
        normalizedDeviation: Math.round(normalizedDeviation * 100) / 100,
        direction,
        suggestionKey: `style.suggestion.${metric.key}.${direction}`,
      });
    }

    // Calculate match score (inverse of deviation, weighted by tolerance)
    const weight = 1 / Math.max(0.01, metric.tolerance);
    totalWeight += weight;
    const absDev = Math.abs(normalizedDeviation);
    const matchForMetric = Math.max(0, 1 - absDev);
    weightedScore += weight * matchForMetric;
  }

  const overallMatchScore = totalWeight > 0
    ? Math.round((weightedScore / totalWeight) * 100)
    : 0;

  return {
    targetAuthorId: authorProfile.id,
    targetAuthor: authorProfile.name,
    targetProfileVersion: authorProfile.version,
    sampleAdequacy,
    deviations,
    overallMatchScore,
  };
}
