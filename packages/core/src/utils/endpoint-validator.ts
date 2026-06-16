/**
 * endpoint-validator.ts — Post-write endpoint lock validation (M2).
 *
 * Validates that a written chapter satisfies its declared openingFrame,
 * closingFrame, requiredBeats, and forbiddenMoves constraints.
 *
 * Called post-write by the Writer agent or Runner to surface endpoint-lock
 * violations before the chapter reaches the Auditor.
 */

import type { AuthorChapterIntent } from "../models/chapter-intent.schema.js";

// ─── Public types ──────────────────────────────────────────────────

export interface EndpointValidation {
  /** True when ALL checks pass. */
  readonly passed: boolean;
  /** Individual check results (one per constraint). */
  readonly checks: ReadonlyArray<EndpointCheck>;
}

export interface EndpointCheck {
  /** Human-readable check name (e.g. "Opening Frame", "Required Beat: 主角登场"). */
  readonly name: string;
  /** Whether this check passed. */
  readonly passed: boolean;
  /** Human-readable detail — explains why the check passed or failed. */
  readonly detail: string;
}

// ─── Main validation function ──────────────────────────────────────

/**
 * Validate that a written chapter satisfies its declared endpoint locks
 * as recorded in the AuthorChapterIntent.
 *
 * Checks performed:
 * 1. Opening frame: first ~200 chars must contain the declared opening scene
 * 2. Closing frame: last ~500 chars must contain the declared closing scene
 * 3. Required beats: each beat must be detectable in the chapter content
 * 4. Forbidden moves: none of the forbidden patterns may appear
 *
 * @param chapterContent - The full chapter text.
 * @param chapterIntent - The author's declared intent for this chapter.
 * @param chapterNumber - The chapter number (for logging).
 * @param lang - Language for human-readable check names/details.
 */
export function validateEndpointLock(
  chapterContent: string,
  chapterIntent: AuthorChapterIntent,
  chapterNumber: number,
  lang: "zh" | "en" = "zh",
): EndpointValidation {
  const checks: EndpointCheck[] = [];

  // 1. Opening frame check
  if (chapterIntent.openingFrame) {
    const openingWords = chapterContent.slice(0, 200);
    const frameDesc = chapterIntent.openingFrame.scene;
    const hasOpening = fuzzyContains(openingWords, frameDesc);
    checks.push({
      name: lang === "en" ? "Opening Frame" : "开篇框架",
      passed: hasOpening,
      detail: hasOpening
        ? (lang === "en" ? "Opening matches declared frame" : "开篇与声明框架一致")
        : (lang === "en"
          ? `Expected opening to contain: "${frameDesc}"`
          : `预期开篇应包含："${frameDesc}"`),
    });
    // Also check forbidden opening patterns
    if (chapterIntent.openingFrame.forbiddenOpenings?.length) {
      for (const forbidden of chapterIntent.openingFrame.forbiddenOpenings) {
        const found = fuzzyContains(openingWords, forbidden);
        checks.push({
          name: lang === "en" ? `Opening Forbidden: ${forbidden}` : `开篇禁止：${forbidden}`,
          passed: !found,
          detail: found
            ? (lang === "en" ? "Forbidden opening pattern DETECTED" : "发现禁止的开篇模式")
            : (lang === "en" ? "Forbidden pattern absent" : "未发现禁止模式"),
        });
      }
    }
  }

  // 2. Closing frame check
  if (chapterIntent.closingFrame) {
    const closingWords = chapterContent.slice(-500);
    const frameDesc = chapterIntent.closingFrame.scene;
    const hasClosing = fuzzyContains(closingWords, frameDesc);
    checks.push({
      name: lang === "en" ? "Closing Frame" : "收尾框架",
      passed: hasClosing,
      detail: hasClosing
        ? (lang === "en" ? "Closing matches declared frame" : "收尾与声明框架一致")
        : (lang === "en"
          ? `Expected closing to contain: "${frameDesc}"`
          : `预期收尾应包含："${frameDesc}"`),
    });
    // Must-resolve threads
    if (chapterIntent.closingFrame.mustResolve?.length) {
      for (const thread of chapterIntent.closingFrame.mustResolve) {
        const resolved = fuzzyContains(closingWords, thread);
        checks.push({
          name: lang === "en" ? `Must Resolve: ${thread}` : `必须收束：${thread}`,
          passed: resolved,
          detail: resolved
            ? (lang === "en" ? "Thread resolved" : "线索已收束")
            : (lang === "en" ? "Thread NOT resolved in closing" : "收尾中未收束此线索"),
        });
      }
    }
  }

  // 3. Required beats check
  if (chapterIntent.requiredBeats?.length) {
    for (const beat of chapterIntent.requiredBeats) {
      const found = fuzzyContains(chapterContent, beat);
      checks.push({
        name: lang === "en" ? `Required Beat: ${beat}` : `必达事件：${beat}`,
        passed: found,
        detail: found
          ? (lang === "en" ? "Beat satisfied" : "事件已达成")
          : (lang === "en" ? "Beat NOT found in chapter" : "章节中未发现此事件"),
      });
    }
  }

  // 4. Forbidden moves check
  if (chapterIntent.forbiddenMoves?.length) {
    for (const move of chapterIntent.forbiddenMoves) {
      const found = fuzzyContains(chapterContent, move);
      checks.push({
        name: lang === "en" ? `Forbidden: ${move}` : `禁用动作：${move}`,
        passed: !found,
        detail: found
          ? (lang === "en" ? "Forbidden move DETECTED in chapter!" : "章节中发现禁用动作！")
          : (lang === "en" ? "Forbidden move absent" : "未发现禁用动作"),
      });
    }
  }

  // 5. Path constraints check
  if (chapterIntent.pathConstraints?.mustPassThrough?.length) {
    for (const node of chapterIntent.pathConstraints.mustPassThrough) {
      const found = fuzzyContains(chapterContent, node);
      checks.push({
        name: lang === "en" ? `Must Pass Through: ${node}` : `必经节点：${node}`,
        passed: found,
        detail: found
          ? (lang === "en" ? "Node passed through" : "已通过此节点")
          : (lang === "en" ? "Node NOT reached" : "未经过此节点"),
      });
    }
  }

  return {
    passed: checks.every((c) => c.passed),
    checks,
  };
}

// ─── Private helpers ────────────────────────────────────────────────

/**
 * Fuzzy content match using normalized substring + token overlap + CJK bigram overlap.
 * Three-tier matching: direct substring → token overlap → CJK character bigram overlap.
 */
function fuzzyContains(text: string, pattern: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const normText = norm(text);
  const normPattern = norm(pattern);

  // 1. Direct substring match (after normalization)
  if (normText.includes(normPattern)) return true;

  // 2. 70%+ token overlap (word-level)
  const patternTokens = new Set(
    normPattern.split(/\s+/).filter((t) => t.length > 1),
  );
  if (patternTokens.size > 0) {
    const textTokens = new Set(normText.split(/\s+/).filter((t) => t.length > 1));
    const overlap = [...patternTokens].filter((t) => textTokens.has(t)).length;
    if (overlap / patternTokens.size >= 0.7) return true;
  }

  // 3. CJK character bigram overlap (for Chinese/Japanese without word boundaries)
  const cjkPattern = normPattern.replace(/[a-z0-9\s]/gi, "");
  if (cjkPattern.length >= 4) {
    const bigrams = (s: string): Set<string> => {
      const bg = new Set<string>();
      for (let i = 0; i < s.length - 1; i++) {
        bg.add(s.slice(i, i + 2));
      }
      return bg;
    };
    const patternBigrams = bigrams(cjkPattern);
    const textCjk = normText.replace(/[a-z0-9\s]/gi, "");
    const textBigrams = bigrams(textCjk);
    if (patternBigrams.size > 0 && textBigrams.size > 0) {
      const overlap = [...patternBigrams].filter((b) => textBigrams.has(b)).length;
      if (overlap / patternBigrams.size >= 0.6) return true;
    }
  }

  return false;
}
