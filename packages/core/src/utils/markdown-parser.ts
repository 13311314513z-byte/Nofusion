/**
 * Unified Markdown parser — Markdown → JSON (one-way).
 *
 * Parses human-editable Markdown back into structured data.
 * The parsed result is always merged into the existing JSON record —
 * this parser never replaces the authoritative JSON source directly.
 *
 * Re-exports existing parse functions from story-markdown.ts for
 * backward compatibility.
 *
 * @module
 */

import type { AuthorChapterIntent, AuthorScenePlan, AuthorCharacterState } from "../models/chapter-intent.schema.js";
import type { ChapterGoalCard } from "../models/chapter-goal.js";

// ─── Re-exports from story-markdown.ts ─────────────────────────────

export {
  normalizeHookId,
  parseChapterSummariesMarkdown,
  parseCurrentStateFacts,
  parsePendingHooksMarkdown,
} from "./story-markdown.js";

// ─── Helpers ───────────────────────────────────────────────────────

/** Extract the content under a Markdown heading. Returns "" if not found. */
function extractSection(markdown: string, heading: string): string {
  const idx = markdown.indexOf(heading);
  if (idx === -1) return "";
  const after = markdown.slice(idx + heading.length);
  // Find the next H2 heading, horizontal rule, or blockquote footer
  const nextMatch = after.match(/\n(?:##\s|---|\n> )/);
  const raw = nextMatch ? after.slice(0, nextMatch.index) : after;
  return raw.trim();
}

/** Parse a bullet list into string[] */
function parseBulletList(text: string): string[] {
  const lines = text.split("\n");
  const items: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ")) {
      items.push(trimmed.slice(2).trim());
    } else if (trimmed.startsWith("  - ")) {
      items.push(trimmed.slice(4).trim());
    }
  }
  return items.filter(Boolean);
}

/** Parse a key-value line like "- **Key**: Value" */
function parseKeyValue(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = text.split("\n");
  for (const line of lines) {
    const match = line.trim().match(/^-\s*\*\*(.+?)\*\*:\s*(.+)/);
    if (match) {
      result[match[1]!.trim()] = match[2]!.trim();
    }
  }
  return result;
}

// ─── Chapter Intent Parser ─────────────────────────────────────────

/**
 * Parse a Markdown string (produced by renderChapterIntentToMarkdown)
 * back into a Partial<AuthorChapterIntent>.
 *
 * The caller is responsible for merging the result with the existing
 * JSON record — this function only extracts what it can from the Markdown.
 *
 * @param markdown - The Markdown content to parse.
 * @param expectedChapterNumber - The expected chapter number (for validation).
 * @returns The parsed intent and any warnings.
 */
export function parseChapterIntentFromMarkdown(
  markdown: string,
  expectedChapterNumber: number,
): { intent: Partial<AuthorChapterIntent>; warnings: string[] } {
  const warnings: string[] = [];
  const intent: Partial<AuthorChapterIntent> = {
    chapterNumber: expectedChapterNumber,
  };

  // Core narrative
  const coreSection = extractSection(markdown, "## 核心叙事")
    || extractSection(markdown, "## Core Narrative");
  if (coreSection) {
    intent.coreNarrative = coreSection;
  }

  // Reader takeaway
  const takeawaySection = extractSection(markdown, "## 读者感受")
    || extractSection(markdown, "## Reader Takeaway");
  if (takeawaySection) {
    intent.readerTakeaway = takeawaySection;
  }

  // Key moment
  const momentSection = extractSection(markdown, "## 关键瞬间")
    || extractSection(markdown, "## Key Moment");
  if (momentSection) {
    intent.keyMoment = momentSection;
  }

  // Scenes — parse ### Scene N: {goal} blocks
  const scenesSection = extractSection(markdown, "## 场景计划")
    || extractSection(markdown, "## Scenes");
  if (scenesSection) {
    // Split on ### headings, keeping the heading text
    const sceneBlocks = scenesSection.split(/\n(?=###\s)/).filter((b) => b.trim().startsWith("###"));
    const scenes: AuthorScenePlan[] = [];
    for (const block of sceneBlocks) {
      const goalMatch = block.match(/^###\s*(?:场景\s*\d+|Scene\s*\d+):\s*(.+)/m);
      const kv = parseKeyValue(block);
      const scene: AuthorScenePlan = {
        goal: goalMatch?.[1]?.trim() || "",
        location: kv["地点"] || kv["Location"] || undefined,
        povCharacter: kv["POV"] || undefined,
        targetEmotion: kv["目标情绪"] || kv["Target Emotion"] || undefined,
        conflict: kv["冲突"] || kv["Conflict"] || undefined,
        outcome: kv["结局"] || kv["Outcome"] || undefined,
        importance: (kv["重要性"] || kv["Importance"]) as "bridge" | "normal" | "key" | undefined,
      };
      // Parse required beats / forbidden moves from nested lists after ### heading
      const bodyAfterHeading = block.replace(/^###[^\n]*\n?/, "");
      const beatsKV = parseKeyValue(bodyAfterHeading);
      const beatsList = bodyAfterHeading.match(/\*\*(?:必达节拍|Required Beats)\*\*:\s*\n((?:\s{2}-[^\n]*\n?)*)/);
      if (beatsList) scene.requiredBeats = parseBulletList(beatsList[1]!);
      const movesList = bodyAfterHeading.match(/\*\*(?:禁止动作|Forbidden Moves)\*\*:\s*\n((?:\s{2}-[^\n]*\n?)*)/);
      if (movesList) scene.forbiddenMoves = parseBulletList(movesList[1]!);

      if (scene.goal) scenes.push(scene);
    }
    if (scenes.length > 0) intent.scenes = scenes;
  }

  // Character states
  const charSection = extractSection(markdown, "## 角色状态")
    || extractSection(markdown, "## Character States");
  if (charSection) {
    const states: AuthorCharacterState[] = [];
    const lines = charSection.split("\n");
    for (const line of lines) {
      const match = line.trim().match(/^-\s*\*\*(.+?)\*\*:\s*(.+)/);
      if (match) {
        const relMatch = lines.find((l, i) =>
          lines.indexOf(line) < i && l.trim().startsWith("  -") &&
          (l.includes("关系变化") || l.includes("Relationship"))
        );
        states.push({
          characterId: match[1]!.trim(),
          emotion: match[2]!.trim(),
          relationshipChanges: relMatch?.replace(/^\s*-\s*(?:关系变化|Relationship):\s*/, "").trim() || undefined,
        });
      }
    }
    if (states.length > 0) intent.characterStates = states;
  }

  // Required beats
  const beatsSection = extractSection(markdown, "## 必须包含")
    || extractSection(markdown, "## Required Beats");
  if (beatsSection) {
    intent.requiredBeats = parseBulletList(beatsSection);
  }

  // Forbidden moves
  const forbiddenSection = extractSection(markdown, "## 禁止出现")
    || extractSection(markdown, "## Forbidden Moves");
  if (forbiddenSection) {
    intent.forbiddenMoves = parseBulletList(forbiddenSection);
  }

  // Narrative position
  const posSection = extractSection(markdown, "## 叙事位置")
    || extractSection(markdown, "## Narrative Position");
  if (posSection) {
    const match = posSection.match(/-\s*(opening|rising|climax|falling|resolution)/);
    if (match) intent.narrativePosition = match[1] as AuthorChapterIntent["narrativePosition"];
  }

  return { intent, warnings };
}

// ─── Chapter Goal Card Parser ──────────────────────────────────────

/**
 * Parse a Markdown string (produced by renderChapterGoalToMarkdown)
 * back into a Partial<ChapterGoalCard>.
 */
export function parseChapterGoalFromMarkdown(
  markdown: string,
  expectedChapterNumber: number,
): { goal: Partial<ChapterGoalCard>; warnings: string[] } {
  const warnings: string[] = [];
  // Use a mutable accumulator to avoid readonly field assignment errors
  const acc: Record<string, unknown> = {
    chapterNumber: expectedChapterNumber,
  };

  // Title
  const titleSection = extractSection(markdown, "## 标题")
    || extractSection(markdown, "## Title");
  if (titleSection) acc.title = titleSection;

  // Core conflict
  const conflictSection = extractSection(markdown, "## 核心矛盾")
    || extractSection(markdown, "## Core Conflict");
  if (conflictSection) acc.mainConflict = conflictSection;

  // Target mood
  const moodSection = extractSection(markdown, "## 目标氛围")
    || extractSection(markdown, "## Target Mood");
  if (moodSection) acc.targetMood = moodSection;

  // Meta
  const metaSection = extractSection(markdown, "## 元信息")
    || extractSection(markdown, "## Meta");
  if (metaSection) {
    const kv = parseKeyValue(metaSection);
    if (kv["POV"]) acc.povCharacter = kv["POV"];
    if (kv["地点"] || kv["Location"]) acc.location = kv["地点"] || kv["Location"];
    if (kv["时段"] || kv["Time of Day"]) acc.timeOfDay = kv["时段"] || kv["Time of Day"];
    if (kv["目标字数"] || kv["Target Length"]) {
      const charMatch = (kv["目标字数"] || kv["Target Length"] || "").match(/\d+/);
      if (charMatch) acc.targetChars = Number(charMatch[0]);
    }
  }

  // Required beats
  const beatsSection = extractSection(markdown, "## 必达事件")
    || extractSection(markdown, "## Required Beats");
  if (beatsSection) acc.requiredBeats = parseBulletList(beatsSection);

  // Forbidden moves
  const forbiddenSection = extractSection(markdown, "## 禁用动作")
    || extractSection(markdown, "## Forbidden Moves");
  if (forbiddenSection) acc.forbiddenMoves = parseBulletList(forbiddenSection);

  // Hooks to advance
  const hooksSection = extractSection(markdown, "## 需推进的伏笔")
    || extractSection(markdown, "## Hooks to Advance");
  if (hooksSection) acc.hookIdsToAdvance = parseBulletList(hooksSection);

  return { goal: acc as unknown as Partial<ChapterGoalCard>, warnings };
}
