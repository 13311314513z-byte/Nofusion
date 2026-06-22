/**
 * writer-runtime-state.ts — runtime state normalization and artifact helpers extracted from writer.ts (Phase 2).
 * Pure functions with explicit dependency injection.
 */
import { buildRuntimeStateArtifacts, type RuntimeStateArtifacts } from "../state/runtime-state-store.js";
import type { RuntimeStateDelta } from "../models/runtime-state.js";
import type { WriteChapterOutput } from "./writer-types.js";

// ─── renderDeltaSummaryRow ───────────────────────────────────────────────────

export function renderDeltaSummaryRow(delta: RuntimeStateDelta): string {
  if (!delta.chapterSummary) return "";
  const summary = delta.chapterSummary;
  const row = [
    summary.chapter,
    summary.title,
    summary.characters,
    summary.events,
    summary.stateChanges,
    summary.hookActivity,
    summary.mood,
    summary.chapterType,
  ].map((value) => String(value).replace(/\|/g, "\\|").trim()).join(" | ");

  return `| ${row} |`;
}

// ─── normalizeRuntimeStateDeltaChapter ───────────────────────────────────────

export function normalizeRuntimeStateDeltaChapter(
  delta: RuntimeStateDelta,
  authoritativeChapterNumber: number,
): RuntimeStateDelta {
  const hookOps = delta.hookOps ?? {
    upsert: [],
    mention: [],
    resolve: [],
    defer: [],
  };
  let changed = delta.chapter !== authoritativeChapterNumber;
  const normalizedUpserts = hookOps.upsert.map((hook) => {
    const startChapter = Math.min(hook.startChapter, authoritativeChapterNumber);
    const lastAdvancedChapter = Math.min(hook.lastAdvancedChapter, authoritativeChapterNumber);
    if (startChapter !== hook.startChapter || lastAdvancedChapter !== hook.lastAdvancedChapter) {
      changed = true;
    }
    if (startChapter === hook.startChapter && lastAdvancedChapter === hook.lastAdvancedChapter) {
      return hook;
    }
    return {
      ...hook,
      startChapter,
      lastAdvancedChapter,
    };
  });

  if (delta.chapterSummary?.chapter !== undefined && delta.chapterSummary.chapter !== authoritativeChapterNumber) {
    changed = true;
  }
  if (!changed) {
    return delta;
  }

  return {
    ...delta,
    chapter: authoritativeChapterNumber,
    hookOps: {
      ...hookOps,
      upsert: normalizedUpserts,
    },
    chapterSummary: delta.chapterSummary
      ? {
          ...delta.chapterSummary,
          chapter: authoritativeChapterNumber,
        }
      : undefined,
  };
}

// ─── buildRuntimeStateArtifactsIfPresent ─────────────────────────────────────

export async function buildRuntimeStateArtifactsIfPresent(
  bookDir: string,
  delta: RuntimeStateDelta | undefined,
  language: "zh" | "en",
  authoritativeChapterNumber?: number,
  allowReapply?: boolean,
): Promise<RuntimeStateArtifacts | null> {
  if (!delta) return null;
  const safeDelta = authoritativeChapterNumber === undefined
    ? delta
    : normalizeRuntimeStateDeltaChapter(delta, authoritativeChapterNumber);
  return buildRuntimeStateArtifacts({
    bookDir,
    delta: safeDelta,
    language,
    allowReapply,
  });
}

// ─── resolveRuntimeStateArtifactsForOutput ──────────────────────────────────

export async function resolveRuntimeStateArtifactsForOutput(
  bookDir: string,
  output: WriteChapterOutput,
  language: "zh" | "en",
): Promise<RuntimeStateArtifacts | null> {
  if (!output.runtimeStateDelta) return null;
  const safeDelta = normalizeRuntimeStateDeltaChapter(
    output.runtimeStateDelta,
    output.chapterNumber,
  );
  if (
    safeDelta === output.runtimeStateDelta
    && output.runtimeStateSnapshot
    && output.updatedChapterSummaries
    && output.updatedState
    && output.updatedHooks
  ) {
    return {
      snapshot: output.runtimeStateSnapshot,
      resolvedDelta: safeDelta,
      currentStateMarkdown: output.updatedState,
      hooksMarkdown: output.updatedHooks,
      chapterSummariesMarkdown: output.updatedChapterSummaries,
    };
  }

  return buildRuntimeStateArtifacts({
    bookDir,
    delta: safeDelta,
    language,
  });
}
