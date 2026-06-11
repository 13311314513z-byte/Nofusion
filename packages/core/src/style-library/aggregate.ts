/**
 * Style profile aggregation — merge multiple sample profiles into an author profile.
 */

import type { StyleProfile } from "../models/style-profile.js";
import type { StyleSourceDocument, AuthorStyleProfile, StyleLibraryIndex } from "./models.js";
import type { SentenceTypeDistribution, ParagraphRhythm, RhetoricBreakdown, DialogueFeatures } from "../utils/style-dimensions.js";

// ---------------------------------------------------------------------------
// New field merge helpers
// ---------------------------------------------------------------------------

function mergeSentenceTypeDistribution(
  profiles: ReadonlyArray<StyleProfile>,
  weights: ReadonlyArray<number>,
  totalWeight: number,
): SentenceTypeDistribution {
  let decl = 0, inter = 0, excl = 0, imper = 0;
  for (let i = 0; i < profiles.length; i++) {
    const d = profiles[i].fingerprint.sentenceTypeDistribution;
    const w = weights[i] / totalWeight;
    decl += (d?.declarative ?? 0) * w;
    inter += (d?.interrogative ?? 0) * w;
    excl += (d?.exclamatory ?? 0) * w;
    imper += (d?.imperative ?? 0) * w;
  }
  return {
    declarative: Math.round(decl * 100) / 100,
    interrogative: Math.round(inter * 100) / 100,
    exclamatory: Math.round(excl * 100) / 100,
    imperative: Math.round(imper * 100) / 100,
  };
}

function mergeParagraphRhythm(
  profiles: ReadonlyArray<StyleProfile>,
  weights: ReadonlyArray<number>,
  totalWeight: number,
): ParagraphRhythm {
  let short = 0, medium = 0, long = 0;
  const histAccum = new Map<string, number>();
  for (let i = 0; i < profiles.length; i++) {
    const r = profiles[i].fingerprint.paragraphRhythm;
    const w = weights[i] / totalWeight;
    short += (r?.shortParaRate ?? 0) * w;
    medium += (r?.mediumParaRate ?? 0) * w;
    long += (r?.longParaRate ?? 0) * w;
    if (r?.lengthHistogram) {
      for (const h of r.lengthHistogram) {
        histAccum.set(h.range, (histAccum.get(h.range) ?? 0) + h.count);
      }
    }
  }
  const lengthHistogram = [...histAccum.entries()]
    .map(([range, count]) => ({ range, count }))
    .sort((a, b) => a.range.localeCompare(b.range));
  return {
    shortParaRate: Math.round(short * 100) / 100,
    mediumParaRate: Math.round(medium * 100) / 100,
    longParaRate: Math.round(long * 100) / 100,
    lengthHistogram,
  };
}

function mergeRhetoricBreakdown(
  profiles: ReadonlyArray<StyleProfile>,
  weights: ReadonlyArray<number>,
  totalWeight: number,
): RhetoricBreakdown {
  let meta = 0, para = 0, pers = 0, hype = 0, rheq = 0, rep = 0;
  for (let i = 0; i < profiles.length; i++) {
    const r = profiles[i].fingerprint.rhetoricBreakdown;
    const w = weights[i] / totalWeight;
    meta += (r?.metaphorRate ?? 0) * w;
    para += (r?.parallelismRate ?? 0) * w;
    pers += (r?.personificationRate ?? 0) * w;
    hype += (r?.hyperboleRate ?? 0) * w;
    rheq += (r?.rhetoricalQuestionRate ?? 0) * w;
    rep += (r?.repetitionRate ?? 0) * w;
  }
  return {
    metaphorRate: Math.round(meta * 100) / 100,
    parallelismRate: Math.round(para * 100) / 100,
    personificationRate: Math.round(pers * 100) / 100,
    hyperboleRate: Math.round(hype * 100) / 100,
    rhetoricalQuestionRate: Math.round(rheq * 100) / 100,
    repetitionRate: Math.round(rep * 100) / 100,
  };
}

function mergeDialogueFeatures(
  profiles: ReadonlyArray<StyleProfile>,
  weights: ReadonlyArray<number>,
  totalWeight: number,
): DialogueFeatures {
  let avgLen = 0, freq = 0;
  const tagAccum: Record<string, number> = {};
  for (let i = 0; i < profiles.length; i++) {
    const d = profiles[i].fingerprint.dialogueFeatures;
    const w = weights[i] / totalWeight;
    avgLen += (d?.avgDialogueLength ?? 0) * w;
    freq += (d?.dialogueFrequency ?? 0) * w;
    if (d?.dialogueTagRatio) {
      for (const [tag, count] of Object.entries(d.dialogueTagRatio)) {
        tagAccum[tag] = (tagAccum[tag] ?? 0) + count;
      }
    }
  }
  const totalTags = Object.values(tagAccum).reduce((a, b) => a + b, 0);
  const dialogueTagRatio: Record<string, number> = {};
  for (const [tag, count] of Object.entries(tagAccum)) {
    dialogueTagRatio[tag] = totalTags > 0 ? Math.round((count / totalTags) * 100) / 100 : 0;
  }
  return {
    avgDialogueLength: Math.round(avgLen),
    dialogueFrequency: Math.round(freq * 100) / 100,
    dialogueTagRatio,
  };
}

/**
 * Merge multiple StyleProfiles into a single aggregated profile.
 * Uses character-count weighted averaging for numerical fields.
 */
export function mergeStyleProfiles(
  profiles: ReadonlyArray<StyleProfile>,
  weights: ReadonlyArray<number>,
  authorName: string,
): StyleProfile {
  if (profiles.length === 0) {
    throw new Error("Cannot merge empty profile list");
  }

  if (profiles.length === 1) {
    return { ...profiles[0], sourceName: authorName };
  }

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) {
    throw new Error("Total weight cannot be zero");
  }

  // Generic numeric field merger — reduces future extension omissions
  const mergeNum = (extractor: (p: StyleProfile) => number): number => {
    let sum = 0;
    for (let i = 0; i < profiles.length; i++) {
      sum += extractor(profiles[i]) * (weights[i] / totalWeight);
    }
    return Math.round(sum * 100) / 100;
  };

  // Weighted average for numerical fields
  const weightedAvgSentenceLength = mergeNum((p) => p.avgSentenceLength);
  const weightedAvgSentenceStdDev = mergeNum((p) => p.sentenceLengthStdDev);
  const weightedAvgParagraphLength = mergeNum((p) => p.avgParagraphLength);
  const weightedVocabDiversity = mergeNum((p) => p.vocabularyDiversity);

  let minParagraph = Infinity;
  let maxParagraph = 0;

  for (let i = 0; i < profiles.length; i++) {
    const p = profiles[i];
    minParagraph = Math.min(minParagraph, p.paragraphLengthRange.min);
    maxParagraph = Math.max(maxParagraph, p.paragraphLengthRange.max);
  }

  // Merge top patterns: collect all, count occurrences, sort by frequency
  const patternCounts: Record<string, number> = {};
  for (const p of profiles) {
    for (const pattern of p.topPatterns) {
      // Extract base pattern without count suffix
      const basePattern = pattern.replace(/\s*\(\d+次\)$/, "");
      patternCounts[basePattern] = (patternCounts[basePattern] ?? 0) + 1;
    }
  }
  const mergedTopPatterns = Object.entries(patternCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([pattern, count]) => `${pattern}...(${count}次)`);

  // Merge rhetorical features: collect all, count occurrences, sort
  const featureCounts: Record<string, number> = {};
  for (const p of profiles) {
    for (const feature of p.rhetoricalFeatures) {
      const baseFeature = feature.replace(/\s*\(\d+处\)$/, "");
      featureCounts[baseFeature] = (featureCounts[baseFeature] ?? 0) + 1;
    }
  }
  const mergedRhetoricalFeatures = Object.entries(featureCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([feature, count]) => `${feature}(${count}处)`);

  // Weighted average for fingerprint fields
  let weightedDialogueRatio = 0;
  let weightedActionDensity = 0;
  let weightedPsychologicalRatio = 0;
  let weightedSensoryDensity = 0;
  let weightedColloquialism = 0;
  let weightedRhetoricDensity = 0;
  let weightedAiTellRisk = 0;
  let weightedCommaRatio = 0;
  let weightedPeriodRatio = 0;
  let weightedQuestionRatio = 0;
  let weightedExclamationRatio = 0;
  let weightedEllipsisRatio = 0;
  let weightedSemicolonRatio = 0;
  let weightedVisual = 0;
  let weightedAuditory = 0;
  let weightedTactile = 0;
  let weightedOlfactory = 0;
  let weightedGustatory = 0;

  for (let i = 0; i < profiles.length; i++) {
    const w = weights[i] / totalWeight;
    const f = profiles[i].fingerprint;
    weightedDialogueRatio += f.dialogueRatio * w;
    weightedActionDensity += f.actionDensity * w;
    weightedPsychologicalRatio += f.psychologicalRatio * w;
    weightedSensoryDensity += f.sensoryDensity * w;
    weightedColloquialism += f.colloquialismScore * w;
    weightedRhetoricDensity += f.rhetoricDensity * w;
    weightedAiTellRisk += f.aiTellRisk * w;
    weightedCommaRatio += f.punctuationRhythm.commaRatio * w;
    weightedPeriodRatio += f.punctuationRhythm.periodRatio * w;
    weightedQuestionRatio += f.punctuationRhythm.questionRatio * w;
    weightedExclamationRatio += f.punctuationRhythm.exclamationRatio * w;
    weightedEllipsisRatio += f.punctuationRhythm.ellipsisRatio * w;
    weightedSemicolonRatio += f.punctuationRhythm.semicolonRatio * w;
    weightedVisual += f.sensoryBreakdown.visual * w;
    weightedAuditory += f.sensoryBreakdown.auditory * w;
    weightedTactile += f.sensoryBreakdown.tactile * w;
    weightedOlfactory += f.sensoryBreakdown.olfactory * w;
    weightedGustatory += f.sensoryBreakdown.gustatory * w;
  }

  return {
    avgSentenceLength: Math.round(weightedAvgSentenceLength * 10) / 10,
    sentenceLengthStdDev: Math.round(weightedAvgSentenceStdDev * 10) / 10,
    avgParagraphLength: Math.round(weightedAvgParagraphLength),
    paragraphLengthRange: {
      min: minParagraph === Infinity ? 0 : minParagraph,
      max: maxParagraph,
    },
    vocabularyDiversity: Math.round(weightedVocabDiversity * 1000) / 1000,
    topPatterns: mergedTopPatterns,
    rhetoricalFeatures: mergedRhetoricalFeatures,
    fingerprint: {
      dialogueRatio: Math.round(weightedDialogueRatio * 100) / 100,
      actionDensity: Math.round(weightedActionDensity * 100) / 100,
      psychologicalRatio: Math.round(weightedPsychologicalRatio * 100) / 100,
      sensoryDensity: Math.round(weightedSensoryDensity * 100) / 100,
      colloquialismScore: Math.round(weightedColloquialism * 100) / 100,
      rhetoricDensity: Math.round(weightedRhetoricDensity * 100) / 100,
      punctuationRhythm: {
        commaRatio: Math.round(weightedCommaRatio * 100) / 100,
        periodRatio: Math.round(weightedPeriodRatio * 100) / 100,
        questionRatio: Math.round(weightedQuestionRatio * 100) / 100,
        exclamationRatio: Math.round(weightedExclamationRatio * 100) / 100,
        ellipsisRatio: Math.round(weightedEllipsisRatio * 100) / 100,
        semicolonRatio: Math.round(weightedSemicolonRatio * 100) / 100,
      },
      aiTellRisk: Math.round(weightedAiTellRisk * 100) / 100,
      sensoryBreakdown: {
        visual: Math.round(weightedVisual * 100) / 100,
        auditory: Math.round(weightedAuditory * 100) / 100,
        tactile: Math.round(weightedTactile * 100) / 100,
        olfactory: Math.round(weightedOlfactory * 100) / 100,
        gustatory: Math.round(weightedGustatory * 100) / 100,
      },
      // 扩展字段（可选，向后兼容）
      sentenceTypeDistribution: mergeSentenceTypeDistribution(profiles, weights, totalWeight),
      paragraphRhythm: mergeParagraphRhythm(profiles, weights, totalWeight),
      rhetoricBreakdown: mergeRhetoricBreakdown(profiles, weights, totalWeight),
      dialogueFeatures: mergeDialogueFeatures(profiles, weights, totalWeight),
    },
    sourceName: authorName,
    analyzedAt: new Date().toISOString(),
  };
}

/**
 * Build or rebuild an AuthorStyleProfile from its source documents.
 */
export function buildAuthorProfile(
  id: string,
  name: string,
  language: "zh" | "en",
  tags: ReadonlyArray<string>,
  sources: ReadonlyArray<StyleSourceDocument>,
  existing?: AuthorStyleProfile,
): AuthorStyleProfile {
  const readySources = sources.filter((s) => s.status === "ready");
  const profiles = readySources.map((s) => s.profile);
  const weights = readySources.map((s) => s.charCount);

  const aggregateProfile =
    profiles.length > 0
      ? mergeStyleProfiles(profiles, weights, name)
      : (existing?.aggregateProfile ?? {
          avgSentenceLength: 0,
          sentenceLengthStdDev: 0,
          avgParagraphLength: 0,
          paragraphLengthRange: { min: 0, max: 0 },
          vocabularyDiversity: 0,
          topPatterns: [],
          rhetoricalFeatures: [],
          fingerprint: {
            dialogueRatio: 0,
            actionDensity: 0,
            psychologicalRatio: 0,
            sensoryDensity: 0,
            colloquialismScore: 0,
            rhetoricDensity: 0,
            punctuationRhythm: { commaRatio: 0, periodRatio: 0, questionRatio: 0, exclamationRatio: 0, ellipsisRatio: 0, semicolonRatio: 0 },
            aiTellRisk: 0,
            sensoryBreakdown: { visual: 0, auditory: 0, tactile: 0, olfactory: 0, gustatory: 0 },
            sentenceTypeDistribution: { declarative: 0, interrogative: 0, exclamatory: 0, imperative: 0 },
            paragraphRhythm: { shortParaRate: 0, mediumParaRate: 0, longParaRate: 0, lengthHistogram: [] },
            rhetoricBreakdown: { metaphorRate: 0, parallelismRate: 0, personificationRate: 0, hyperboleRate: 0, rhetoricalQuestionRate: 0, repetitionRate: 0 },
            dialogueFeatures: { avgDialogueLength: 0, dialogueFrequency: 0, dialogueTagRatio: {} },
          },
          sourceName: name,
          analyzedAt: new Date().toISOString(),
        });

  const totalChars = readySources.reduce((sum, s) => sum + s.charCount, 0);

  return {
    id,
    name,
    language,
    tags,
    sourceIds: sources.map((s) => s.id),
    aggregateProfile,
    sampleStats: {
      sourceCount: sources.length,
      totalChars,
      avgCharsPerSource: sources.length > 0 ? Math.round(totalChars / sources.length) : 0,
    },
    version: (existing?.version ?? 0) + 1,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Build a StyleLibraryIndex from an array of AuthorStyleProfiles.
 */
export function buildLibraryIndex(
  profiles: ReadonlyArray<AuthorStyleProfile>,
): StyleLibraryIndex {
  return {
    authors: profiles.map((p) => ({
      id: p.id,
      name: p.name,
      language: p.language,
      tags: p.tags,
      sourceCount: p.sampleStats.sourceCount,
      updatedAt: p.updatedAt,
    })),
  };
}
