/**
 * Patch boundary detection — ensures that localized revisions don't
 * overstep their intended scope.
 *
 * When Reviser emits a spot-fix or patch, this module verifies that only
 * the targeted paragraphs were changed and that surrounding context is
 * preserved verbatim.
 *
 * @module
 */

/**
 * Result of a boundary check.
 */
export interface PatchBoundaryReport {
  /** True if the patch stayed within its declared bounds. */
  readonly withinBounds: boolean;
  /** Number of paragraphs that were modified outside the target range. */
  readonly overstepCount: number;
  /** List of overstep descriptions. */
  readonly oversteps: ReadonlyArray<string>;
  /** Number of target paragraphs that were correctly modified. */
  readonly targetModified: number;
  /** Total target paragraphs. */
  readonly targetTotal: number;
}

/**
 * Check that a patch only modified the specified paragraph range.
 *
 * @param original - The original chapter content, split by paragraphs.
 * @param revised - The revised chapter content, split by paragraphs.
 * @param targetParagraphs - Set of 0-based paragraph indices that were targeted for revision.
 * @returns A report of what changed within and outside the target range.
 */
export function checkPatchBoundary(
  original: ReadonlyArray<string>,
  revised: ReadonlyArray<string>,
  targetParagraphs: ReadonlySet<number>,
): PatchBoundaryReport {
  const oversteps: string[] = [];
  let targetModified = 0;
  const maxLen = Math.max(original.length, revised.length);

  for (let i = 0; i < maxLen; i++) {
    const origPara = i < original.length ? original[i] : "";
    const revPara = i < revised.length ? revised[i] : "";

    if (origPara === revPara) continue; // Unchanged — good

    if (targetParagraphs.has(i)) {
      targetModified++;
    } else {
      oversteps.push(
        `段落 ${i + 1} 被修改但不在目标范围内 ` +
        `(原文: "${origPara.slice(0, 40)}...", 修改后: "${revPara.slice(0, 40)}...")`,
      );
    }
  }

  return {
    withinBounds: oversteps.length === 0,
    overstepCount: oversteps.length,
    oversteps,
    targetModified,
    targetTotal: targetParagraphs.size,
  };
}

/**
 * Extract paragraph ranges from AuditIssue locations.
 * Converts { startParagraph, endParagraph } into a set of 0-based indices.
 */
export function issueLocationsToParagraphSet(
  locations: ReadonlyArray<{
    readonly startParagraph: number;
    readonly endParagraph: number;
  }>,
): ReadonlySet<number> {
  const indices = new Set<number>();
  for (const loc of locations) {
    for (let i = loc.startParagraph - 1; i <= loc.endParagraph - 1; i++) {
      if (i >= 0) indices.add(i);
    }
  }
  return indices;
}

/**
 * Select the appropriate revision mode based on the fixScope of a set of issues.
 * This complements the existing structural vs local classification in Reviser.
 *
 * - "word" or "sentence": spot-fix
 * - "paragraph": patch
 * - "scene" or "chapter": rewrite or allow-full
 */
export function selectReviseModeFromFixScope(
  fixScopes: ReadonlyArray<"word" | "sentence" | "paragraph" | "scene" | "chapter">,
): "spot-fix" | "patch-only" | "rewrite-only" | "allow-full" {
  if (fixScopes.length === 0) return "patch-only";

  let hasSceneOrChapter = false;
  let hasParagraphOrSmaller = false;

  for (const scope of fixScopes) {
    if (scope === "scene" || scope === "chapter") {
      hasSceneOrChapter = true;
    } else {
      hasParagraphOrSmaller = true;
    }
  }

  // If any issue requires scene/chapter scope, prefer rewrite
  if (hasSceneOrChapter && !hasParagraphOrSmaller) {
    return "rewrite-only";
  }

  // Mixed — let the reviser decide
  if (hasSceneOrChapter && hasParagraphOrSmaller) {
    return "allow-full";
  }

  // All are word/sentence/paragraph — safe to patch
  return "spot-fix";
}
