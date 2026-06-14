/**
 * Suggestion Generator — lightweight, rule-based pre-writing question suggestions.
 *
 * This is a simpler alternative to the Interviewer Agent: it reads the current
 * story state and returns questions the author might want to answer, without
 * requiring any LLM call or Agent infrastructure.
 */

import { join } from "node:path";
import {
  readPendingHooks,
  readCharacterMatrix,
  readEmotionalArcs,
} from "../agents/planner-context.js";
import { readCurrentStateWithFallback } from "../utils/outline-paths.js";
import { loadChapterGoals } from "../models/chapter-goal.js";
import { loadChapterIntents, getChapterIntent } from "../models/chapter-intent.js";

export interface Suggestion {
  readonly id: string;
  readonly question: string;
  readonly context: string;
  readonly level: 1 | 2 | 3 | 4;
  readonly prefill?: string;
}

export async function generateSuggestions(
  bookDir: string,
  chapterNumber: number,
): Promise<ReadonlyArray<Suggestion>> {
  const storyDir = join(bookDir, "story");
  const suggestions: Suggestion[] = [];

  const [pendingHooks, characterMatrix, emotionalArcs, currentState, chapterGoalsIndex, chapterIntentsIndex] =
    await Promise.all([
      readPendingHooks(storyDir).catch(() => ""),
      readCharacterMatrix(storyDir).catch(() => ""),
      readEmotionalArcs(storyDir).catch(() => ""),
      readCurrentStateWithFallback(bookDir).catch(() => ""),
      loadChapterGoals(bookDir).catch(() => ({ goals: [] })),
      loadChapterIntents(bookDir).catch(() => ({ intents: [] })),
    ]);

  const existingIntent = getChapterIntent(chapterIntentsIndex.intents, chapterNumber);

  // ── Level 1: Core ──────────────────────────────────────────────
  if (!existingIntent?.coreNarrative) {
    const ctx = pendingHooks ? extractSummary(pendingHooks, 60) : "新章节";
    suggestions.push({
      id: "core_narrative",
      question: "用一句话说清：这一章在讲什么？",
      context: `当前待处理悬念: ${ctx}`,
      level: 1,
    });
  }

  if (!existingIntent?.readerTakeaway) {
    const ctx = emotionalArcs ? extractSummary(emotionalArcs, 60) : "未设定情感弧线";
    suggestions.push({
      id: "reader_takeaway",
      question: "你希望读者读完这章后的核心感受是什么？",
      context: `当前情感弧线: ${ctx}`,
      level: 1,
    });
  }

  if (!existingIntent?.keyMoment) {
    suggestions.push({
      id: "key_moment",
      question: "这一章最重要的一个时刻或画面是什么？",
      context: characterMatrix ? `角色矩阵已就绪` : "尚未建立角色矩阵",
      level: 1,
    });
  }

  // ── Level 2: Scene ─────────────────────────────────────────────
  if (!existingIntent?.scenes || existingIntent.scenes.length === 0) {
    if (currentState) {
      const line = extractSummary(currentState, 60);
      suggestions.push({
        id: "scene_start",
        question: "上一章结束时场景在哪里？这一章从同一场景继续还是切换？",
        context: `上一章结束时: ${line}`,
        level: 2,
      });
    }
  }

  // ── Level 3: Character ─────────────────────────────────────────
  if (!existingIntent?.characterStates || existingIntent.characterStates.length === 0) {
    const names = extractCharacterNames(characterMatrix);
    if (names.length > 0) {
      suggestions.push({
        id: "character_emotions",
        question: `这一章中主要角色（${names.slice(0, 3).join("、")}${names.length > 3 ? "等" : ""}）的情绪状态是怎样的？`,
        context: `角色矩阵中有 ${names.length} 个角色`,
        level: 3,
      });
    }
  }

  // ── Level 4: Constraints ───────────────────────────────────────
  suggestions.push({
    id: "required_beats",
    question: "这一章必须包含哪些关键事件？",
    context: "设定了必达事件后，Writer 会优先确保它们被覆盖",
    level: 4,
  });

  suggestions.push({
    id: "forbidden_moves",
    question: "这一章绝对不能出现什么？（比如：提前揭露某个秘密、让某个角色降智）",
    context: "设定禁止事项可以避免常见的写作陷阱",
    level: 4,
  });

  if (pendingHooks && getHookCount(pendingHooks) > 0) {
    suggestions.push({
      id: "hooks_to_advance",
      question: "有哪些之前埋下的伏笔需要在这一章推进或回收？",
      context: `当前有 ${getHookCount(pendingHooks)} 个待处理伏笔`,
      level: 4,
    });
  }

  return suggestions;
}

// ─── Helpers ──────────────────────────────────────────────────────

function extractSummary(text: string, maxLen: number): string {
  const first = text.split("\n").find((l) => l.trim().length > 0);
  if (!first) return text.slice(0, maxLen);
  return first.trim().slice(0, maxLen);
}

function extractCharacterNames(matrix: string): ReadonlyArray<string> {
  const names: string[] = [];
  for (const line of matrix.split("\n")) {
    const t = line.trim();
    if (t.startsWith("|") && !t.includes("---")) {
      const cells = t.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 2 && cells[0] && !cells[0].includes("角色") && !cells[0].includes("Character")) {
        names.push(cells[0]);
      }
    }
  }
  return names;
}

function getHookCount(hooksRaw: string): number {
  return hooksRaw.split("\n").filter((l) => l.trim().startsWith("|") && l.includes("|")).length;
}
