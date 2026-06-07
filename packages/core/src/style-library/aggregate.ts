/**
 * Style profile aggregation — merge multiple sample profiles into an author profile.
 */

import type { StyleProfile } from "../models/style-profile.js";
import type { StyleSourceDocument, AuthorStyleProfile, StyleLibraryIndex } from "./models.js";

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

  // Weighted average for numerical fields
  let weightedAvgSentenceLength = 0;
  let weightedAvgSentenceStdDev = 0;
  let weightedAvgParagraphLength = 0;
  let weightedVocabDiversity = 0;
  let minParagraph = Infinity;
  let maxParagraph = 0;

  for (let i = 0; i < profiles.length; i++) {
    const w = weights[i] / totalWeight;
    const p = profiles[i];
    weightedAvgSentenceLength += p.avgSentenceLength * w;
    weightedAvgSentenceStdDev += p.sentenceLengthStdDev * w;
    weightedAvgParagraphLength += p.avgParagraphLength * w;
    weightedVocabDiversity += p.vocabularyDiversity * w;
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
