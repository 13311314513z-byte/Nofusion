/**
 * Style preprocess state — pure functions for the four-stage preprocessing workflow.
 *
 * This module contains ONLY logic that can be unit-tested without DOM or React:
 *   - Preset definitions & mapping to Core options
 *   - Stage state transitions
 *   - Risk classification & removal rate calculation
 *   - Inspection finding types
 *
 * It does NOT import React, browser APIs, or Core modules directly.
 */

// ---------------------------------------------------------------------------
// Types — stage model
// ---------------------------------------------------------------------------

/** The four immutable text stages in the preprocessing workflow. */
export type TextStage = "raw" | "extracted" | "cleaned" | "relayouted";

/** A snapshot of text at a given stage. */
export interface TextStageSnapshot {
  readonly stage: TextStage;
  readonly text: string;
  readonly charCount: number;
  readonly lineCount: number;
  readonly paragraphCount: number;
  readonly generatedAt: number;
}

/** Which stage is currently used as the analysis input. */
export type AnalysisSourceStage = "extracted" | "cleaned" | "relayouted";

// ---------------------------------------------------------------------------
// Types — preset
// ---------------------------------------------------------------------------

export type PresetId = "fidelity" | "conservative" | "chat-export" | "community" | "layout-only";

export interface PreprocessPreset {
  readonly id: PresetId;
  readonly labelKey: string;
  readonly descriptionKey: string;
  readonly risk: "low" | "medium" | "high";
  readonly preprocess: PreprocessOptions;
  readonly relayout: RelayoutOptions;
}

// Core option shapes (mirroring core types without importing)
export interface PreprocessOptions {
  readonly filterCode?: boolean;
  readonly filterRepeatedPrompts?: boolean;
  readonly filterUrls?: boolean;
  readonly filterStructuredData?: boolean;
  readonly stripMarkdown?: boolean;
  readonly minLineLength?: number;
  readonly deduplicateParagraphs?: boolean;
  readonly filterTimestamps?: boolean;
  readonly filterIds?: boolean;
  readonly filterNoiseMarkers?: boolean;
}

export interface RelayoutOptions {
  readonly mergeShortParagraphs?: boolean;
  readonly shortParagraphThreshold?: number;
  readonly formatDialogue?: boolean;
  readonly ensureParagraphSpacing?: boolean;
  readonly normalizeQuotes?: boolean;
  readonly compressBlankLines?: boolean;
}

// ---------------------------------------------------------------------------
// Types — risk & removal
// ---------------------------------------------------------------------------

export type RiskLevel = "low" | "medium" | "high";

export interface RemovalStats {
  readonly inputChars: number;
  readonly outputChars: number;
  readonly removedChars: number;
  readonly removalRate: number;
  readonly risk: RiskLevel;
  readonly highRiskOptions: readonly string[];
}

// ---------------------------------------------------------------------------
// Types — inspection (re-exported from shared contracts for convenience)
// ---------------------------------------------------------------------------

export type {
  InspectionCode,
  InspectionFinding,
  InspectionResult,
} from "../shared/contracts.js";

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const FIDELITY_PREPROCESS: PreprocessOptions = {
  filterCode: false,
  filterRepeatedPrompts: false,
  filterUrls: false,
  filterStructuredData: false,
  stripMarkdown: false,
  minLineLength: 0,
  deduplicateParagraphs: false,
  filterTimestamps: false,
  filterIds: false,
  filterNoiseMarkers: false,
};

const FIDELITY_RELAYOUT: RelayoutOptions = {
  mergeShortParagraphs: false,
  formatDialogue: false,
  ensureParagraphSpacing: false,
  normalizeQuotes: false,
  compressBlankLines: false,
};

const CONSERVATIVE_PREPROCESS: PreprocessOptions = {
  filterCode: true,
  filterRepeatedPrompts: false,
  filterUrls: true,
  filterStructuredData: false,
  stripMarkdown: true,
  minLineLength: 0,
  deduplicateParagraphs: true,
  filterTimestamps: true,
  filterIds: true,
  filterNoiseMarkers: true,
};

const CONSERVATIVE_RELAYOUT: RelayoutOptions = {
  ...FIDELITY_RELAYOUT,
};

const CHAT_EXPORT_PREPROCESS: PreprocessOptions = {
  filterCode: true,
  filterRepeatedPrompts: true,
  filterUrls: true,
  filterStructuredData: true,
  stripMarkdown: true,
  minLineLength: 0,
  deduplicateParagraphs: true,
  filterTimestamps: true,
  filterIds: true,
  filterNoiseMarkers: true,
};

const CHAT_EXPORT_RELAYOUT: RelayoutOptions = {
  ...FIDELITY_RELAYOUT,
};

const COMMUNITY_PREPROCESS: PreprocessOptions = {
  filterCode: false,
  filterRepeatedPrompts: false,
  filterUrls: true,
  filterStructuredData: false,
  stripMarkdown: true,
  minLineLength: 0,
  deduplicateParagraphs: true,
  filterTimestamps: true,
  filterIds: true,
  filterNoiseMarkers: true,
};

const COMMUNITY_RELAYOUT: RelayoutOptions = {
  ...FIDELITY_RELAYOUT,
};

const LAYOUT_ONLY_PREPROCESS: PreprocessOptions = {
  ...FIDELITY_PREPROCESS,
};

const LAYOUT_ONLY_RELAYOUT: RelayoutOptions = {
  mergeShortParagraphs: false,
  formatDialogue: false,
  ensureParagraphSpacing: true,
  normalizeQuotes: false,
  compressBlankLines: true,
};

/** All built-in presets. */
export const PRESETS: ReadonlyArray<PreprocessPreset> = [
  {
    id: "fidelity",
    labelKey: "style.preset.fidelity",
    descriptionKey: "style.preset.fidelityDesc",
    risk: "low",
    preprocess: FIDELITY_PREPROCESS,
    relayout: FIDELITY_RELAYOUT,
  },
  {
    id: "conservative",
    labelKey: "style.preset.conservative",
    descriptionKey: "style.preset.conservativeDesc",
    risk: "low",
    preprocess: CONSERVATIVE_PREPROCESS,
    relayout: CONSERVATIVE_RELAYOUT,
  },
  {
    id: "chat-export",
    labelKey: "style.preset.chatExport",
    descriptionKey: "style.preset.chatExportDesc",
    risk: "high",
    preprocess: CHAT_EXPORT_PREPROCESS,
    relayout: CHAT_EXPORT_RELAYOUT,
  },
  {
    id: "community",
    labelKey: "style.preset.community",
    descriptionKey: "style.preset.communityDesc",
    risk: "medium",
    preprocess: COMMUNITY_PREPROCESS,
    relayout: COMMUNITY_RELAYOUT,
  },
  {
    id: "layout-only",
    labelKey: "style.preset.layoutOnly",
    descriptionKey: "style.preset.layoutOnlyDesc",
    risk: "medium",
    preprocess: LAYOUT_ONLY_PREPROCESS,
    relayout: LAYOUT_ONLY_RELAYOUT,
  },
];

/** Look up a preset by id. */
export function getPreset(id: PresetId): PreprocessPreset {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) return PRESETS[0]!;
  return preset;
}

/** Determine if a set of options matches a known preset (returns the preset id or "custom"). */
export function identifyPreset(preprocess: PreprocessOptions, relayout: RelayoutOptions): PresetId | "custom" {
  for (const preset of PRESETS) {
    if (shallowEqual(preprocess as any, preset.preprocess as any)
        && shallowEqual(relayout as any, preset.relayout as any)) {
      return preset.id;
    }
  }
  return "custom";
}

// ---------------------------------------------------------------------------
// Stage transitions
// ---------------------------------------------------------------------------

/** Determine which stages are available based on the current text availability. */
export function getAvailableStages(stageTexts: Record<TextStage, string | null>): TextStage[] {
  const stages: TextStage[] = ["raw"];
  if (stageTexts.extracted) stages.push("extracted");
  if (stageTexts.cleaned) stages.push("cleaned");
  if (stageTexts.relayouted) stages.push("relayouted");
  return stages;
}

/** Check if a stage transition is valid (no skipping). */
export function isValidTransition(from: TextStage, to: TextStage): boolean {
  const order: TextStage[] = ["raw", "extracted", "cleaned", "relayouted"];
  const fromIdx = order.indexOf(from);
  const toIdx = order.indexOf(to);
  if (fromIdx === -1 || toIdx === -1) return false;
  // Can only move forward, not backward (use reset for that)
  return toIdx >= fromIdx;
}

/** Stages that should be cleared when a prior stage is regenerated. */
export function getInvalidatedStages(regeneratedStage: TextStage): TextStage[] {
  const order: TextStage[] = ["raw", "extracted", "cleaned", "relayouted"];
  const idx = order.indexOf(regeneratedStage);
  if (idx === -1) return [];
  return order.slice(idx + 1);
}

// ---------------------------------------------------------------------------
// Removal & risk
// ---------------------------------------------------------------------------

const HIGH_RISK_OPTIONS: ReadonlyArray<keyof PreprocessOptions> = [
  "filterStructuredData",
  "filterRepeatedPrompts",
  "minLineLength",
];

const HIGH_RISK_RELAYOUT_OPTIONS: ReadonlyArray<keyof RelayoutOptions> = [
  "mergeShortParagraphs",
  "formatDialogue",
  "normalizeQuotes",
];

/**
 * Compute removal stats from Core's PreprocessResult-like data.
 * `actions` is optional; when provided, the removedChars is taken from
 * the Core result rather than recomputed.
 */
export function computeRemovalStats(
  inputChars: number,
  outputChars: number,
  preprocess: PreprocessOptions,
  relayout?: RelayoutOptions,
): RemovalStats {
  const removedChars = inputChars - outputChars;
  const removalRate = inputChars > 0 ? removedChars / inputChars : 0;

  const highRiskOptions: string[] = [];

  for (const key of HIGH_RISK_OPTIONS) {
    const val = preprocess[key];
    if (val === true || (typeof val === "number" && val > 0)) {
      highRiskOptions.push(key);
    }
  }

  if (relayout) {
    for (const key of HIGH_RISK_RELAYOUT_OPTIONS) {
      if (relayout[key] === true) {
        highRiskOptions.push(key);
      }
    }
  }

  let risk: RiskLevel = "low";
  if (removalRate > 0.35 || highRiskOptions.length >= 3) {
    risk = "high";
  } else if (removalRate > 0.15 || highRiskOptions.length >= 1) {
    risk = "medium";
  }

  return { inputChars, outputChars, removedChars, removalRate, risk, highRiskOptions };
}

/**
 * Determine whether a confirmation dialog should be shown before proceeding.
 */
export function requiresConfirmation(stats: RemovalStats): boolean {
  if (stats.removalRate > 0.15) return true;
  if (stats.risk === "high") return true;
  return false;
}

// ---------------------------------------------------------------------------
// Text statistics
// ---------------------------------------------------------------------------

export function countLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

export function countParagraphs(text: string): number {
  if (!text) return 0;
  return text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;
}

export function buildSnapshot(stage: TextStage, text: string): TextStageSnapshot {
  return {
    stage,
    text,
    charCount: text.length,
    lineCount: countLines(text),
    paragraphCount: countParagraphs(text),
    generatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}
