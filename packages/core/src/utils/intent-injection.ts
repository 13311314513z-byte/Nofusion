/**
 * Intent Injection — renders the author's pre-writing answers into prompt
 * blocks for Planner, Writer, and Auditor.
 *
 * This is the bridge between "what the author said they want" (ChapterIntent)
 * and "what the Agent reads in its prompt". The output is a formatted markdown
 * block injected near the top of each Agent's context, before any task instructions.
 */

import type { AuthorChapterIntent } from "../models/chapter-intent.js";

/**
 * Build a markdown block from the author's chapter intent.
 *
 * The output is designed to be injected near the **top** of the Agent prompt,
 * right after the system prompt and before the task instructions, so the Agent
 * reads "the author wants this" before it reads "your job is to write this".
 */
export function buildAuthorIntentBlock(intent: AuthorChapterIntent): string {
  const lines: string[] = [];

  lines.push("📝 作者说这一章：");
  lines.push("");

  // Level 1: Core — always present
  if (intent.coreNarrative) {
    lines.push(`  【核心】${intent.coreNarrative}`);
  }
  if (intent.readerTakeaway) {
    lines.push(`  【读者感受】${intent.readerTakeaway}`);
  }
  if (intent.keyMoment) {
    lines.push(`  【关键画面】${intent.keyMoment}`);
  }
  lines.push("");

  // Level 2: Scenes
  if (intent.scenes && intent.scenes.length > 0) {
    lines.push(`  场景规划（${intent.scenes.length} 个场景）:`);
    for (let i = 0; i < intent.scenes.length; i++) {
      const s = intent.scenes[i];
      const emotion = s.targetEmotion ? ` [${s.targetEmotion}]` : "";
      lines.push(`    ${i + 1}. ${s.goal} | ${s.location} | ${s.povCharacter}${emotion}`);
    }
    lines.push("");
  }

  // Level 3: Character states
  if (intent.characterStates && intent.characterStates.length > 0) {
    lines.push("  🎭 角色状态:");
    for (const cs of intent.characterStates) {
      const rel = cs.relationshipChanges ? ` (关系: ${cs.relationshipChanges})` : "";
      lines.push(`    ${cs.characterId}: ${cs.emotion}${rel}`);
    }
    lines.push("");
  }

  // Level 4: Constraints
  const constraints: string[] = [];
  if (intent.requiredBeats && intent.requiredBeats.length > 0) {
    constraints.push(...intent.requiredBeats.map((b) => `  ✅ ${b}`));
  }
  if (intent.forbiddenMoves && intent.forbiddenMoves.length > 0) {
    constraints.push(...intent.forbiddenMoves.map((b) => `  ❌ ${b}`));
  }
  if (intent.pendingHookIds && intent.pendingHookIds.length > 0) {
    constraints.push(`  🔗 待回收伏笔: ${intent.pendingHookIds.join(", ")}`);
  }
  if (intent.narrativePosition) {
    constraints.push(`  📍 叙事位置: ${intent.narrativePosition}`);
  }
  if (intent.plotLine) {
    constraints.push(`  📖 故事线: ${intent.plotLine}`);
  }

  if (constraints.length > 0) {
    lines.push("  📋 约束与提醒:");
    lines.push(...constraints);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Build an "author commitment checklist" block for the Auditor.
 *
 * This tells the auditor: "the author promised these things; check if they
 * were delivered." Returns empty string if there are no checkable items.
 */
export function buildAuthorCommitmentChecklist(intent: AuthorChapterIntent): string {
  const items: string[] = [];

  if (intent.readerTakeaway) {
    items.push(`- [ ] 读者感受兑现: "${intent.readerTakeaway}"`);
  }
  if (intent.keyMoment) {
    items.push(`- [ ] 关键画面出现: "${intent.keyMoment}"`);
  }
  if (intent.requiredBeats && intent.requiredBeats.length > 0) {
    for (const beat of intent.requiredBeats) {
      items.push(`- [ ] 必达事件: "${beat}"`);
    }
  }
  if (intent.forbiddenMoves && intent.forbiddenMoves.length > 0) {
    for (const move of intent.forbiddenMoves) {
      items.push(`- [ ] 禁止事项未出现: "${move}"`);
    }
  }

  if (items.length === 0) return "";

  return [
    "",
    "📋 作者承诺清单（请在检查时逐项核对）:",
    ...items,
    "",
  ].join("\n");
}

/**
 * Format an intent summary suitable for the Writer prompt's opening section.
 * This is a concise version (no scene breakdown, just core + character states).
 */
export function buildWriterIntentBrief(intent: AuthorChapterIntent): string {
  const parts: string[] = [];

  if (intent.coreNarrative) {
    parts.push(`核心: ${intent.coreNarrative}`);
  }
  if (intent.readerTakeaway) {
    parts.push(`读者目标: ${intent.readerTakeaway}`);
  }
  if (intent.keyMoment) {
    parts.push(`关键时刻: ${intent.keyMoment}`);
  }
  if (intent.narrativePosition && (intent.coreNarrative || intent.readerTakeaway || intent.keyMoment)) {
    parts.push(`位置: ${intent.narrativePosition}`);
  }

  return parts.join(" | ");
}
