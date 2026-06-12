/**
 * Interviewer — generates context-aware pre-writing questions for the author.
 *
 * Unlike other agents, the Interviewer does NOT make decisions or generate
 * content. It reads the current story state and produces questions that help
 * the author crystallize their intent before the pipeline runs.
 *
 * Two modes:
 *   1. Rule-based (default, zero LLM cost): generates questions from
 *      pending hooks, character states, and chapter position.
 *   2. LLM-assisted (opt-in): uses a cheap model to suggest richer questions
 *      based on full story context.
 */

import { BaseAgent, type AgentContext } from "./base.js";
import type { BookConfig } from "../models/book.js";
import type { StoredHook } from "../state/memory-db.js";
import {
  readPendingHooks,
  readCharacterMatrix,
  readEmotionalArcs,
} from "./planner-context.js";
import { loadChapterGoals, type ChapterGoalCard } from "../models/chapter-goal.js";
import { loadChapterIntents, getChapterIntent, type AuthorChapterIntent } from "../models/chapter-intent.js";

export interface InterviewQuestion {
  readonly id: string;
  readonly question: string;
  readonly context: string;
  readonly level: 1 | 2 | 3 | 4;
  readonly suggestedAnswer?: string;
}

export interface InterviewerInput {
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly book: BookConfig;
  readonly useLlm?: boolean;
}

export interface InterviewerOutput {
  readonly questions: ReadonlyArray<InterviewQuestion>;
}

/**
 * Generate a stable question ID from a string.
 */
function qId(prefix: string, index: number): string {
  return `${prefix}_${index}`;
}

export class Interviewer extends BaseAgent {
  constructor(ctx: AgentContext) {
    super(ctx);
  }

  get name(): string {
    return "interviewer";
  }

  async conduct(input: InterviewerInput): Promise<InterviewerOutput> {
    const storyDir = join(input.bookDir, "story");
    const questions: InterviewQuestion[] = [];

    // ── Load story state ──────────────────────────────────────────
    const [pendingHooks, characterMatrix, emotionalArcs, chapterGoalsIndex, chapterIntentsIndex] =
      await Promise.all([
        readPendingHooks(storyDir).catch(() => ""),
        readCharacterMatrix(storyDir).catch(() => ""),
        readEmotionalArcs(storyDir).catch(() => ""),
        loadChapterGoals(input.bookDir).catch(() => ({ goals: [] })),
        loadChapterIntents(input.bookDir).catch(() => ({ intents: [] })),
      ]);

    const chapterGoal = findGoal(chapterGoalsIndex.goals, input.chapterNumber);
    const existingIntent = getChapterIntent(chapterIntentsIndex.intents, input.chapterNumber);

    // ── Level 1: Core questions ───────────────────────────────────
    // Always ask these if not yet answered.
    if (!existingIntent?.coreNarrative) {
      questions.push({
        id: qId("core", questions.length),
        question: "用一句话说清：这一章在讲什么？",
        context: chapterGoal?.mainConflict
          ? `上一章的目标是"${chapterGoal.mainConflict}"`
          : "这是新的章节，还没有设定核心矛盾",
        level: 1,
      });
    }

    if (!existingIntent?.readerTakeaway) {
      questions.push({
        id: qId("core", questions.length),
        question: "你希望读者读完这章后的核心感受是什么？",
        context: pendingHooks
          ? `当前悬而未决的问题：${extractFirstLine(pendingHooks)}`
          : "还没有设定读者感受目标",
        level: 1,
      });
    }

    if (!existingIntent?.keyMoment) {
      questions.push({
        id: qId("core", questions.length),
        question: "这一章最重要的一个时刻或画面是什么？",
        context: emotionalArcs
          ? `当前情感弧线：${extractFirstLine(emotionalArcs)}`
          : "还没有设定关键画面",
        level: 1,
      });
    }

    // ── Level 2: Scene questions (only if scenes not yet planned) ──
    if (!existingIntent?.scenes || existingIntent.scenes.length === 0) {
      if (chapterGoal?.povCharacter) {
        questions.push({
          id: qId("scene", questions.length),
          question: `这一章从 ${chapterGoal.povCharacter} 的视角开始吗？如果不是，POV 是谁？`,
          context: `现有设定中本章 POV 为 ${chapterGoal.povCharacter}`,
          level: 2,
          suggestedAnswer: chapterGoal.povCharacter,
        });
      }

      if (chapterGoal?.location) {
        questions.push({
          id: qId("scene", questions.length),
          question: `这一章的主要场景在哪里？还是多个场景切换？`,
          context: `现有设定中本章地点为 ${chapterGoal.location}`,
          level: 2,
          suggestedAnswer: chapterGoal.location,
        });
      }
    }

    // ── Level 3: Character questions ──────────────────────────────
    if (characterMatrix) {
      const characterNames = extractCharacterNames(characterMatrix);
      if (characterNames.length > 0 && (!existingIntent?.characterStates || existingIntent.characterStates.length === 0)) {
        questions.push({
          id: qId("char", questions.length),
          question: `这一章涉及的角色中，哪些人的情绪状态与之前不同？`,
          context: `现有角色：${characterNames.slice(0, 5).join("、")}${characterNames.length > 5 ? "等" : ""}`,
          level: 3,
        });
      }
    }

    // ── Level 4: Constraint questions ─────────────────────────────
    if (!chapterGoal?.requiredBeats || chapterGoal.requiredBeats.length === 0) {
      questions.push({
        id: qId("constraint", questions.length),
        question: "这一章必须包含哪些事件或 beats？",
        context: "还没有设定必达事件，可能会导致章节偏离主线",
        level: 4,
      });
    }

    return { questions };
  }
}

// ─── Module-level helpers ──────────────────────────────────────────

import { join } from "node:path";

function findGoal(
  goals: ReadonlyArray<ChapterGoalCard>,
  chapterNumber: number,
): ChapterGoalCard | undefined {
  return goals.find((g) => g.chapterNumber === chapterNumber);
}

function extractFirstLine(text: string): string {
  return text.split("\n").find((l) => l.trim().length > 0)?.trim() ?? text.slice(0, 80);
}

function extractCharacterNames(matrix: string): ReadonlyArray<string> {
  // Parse markdown table rows for character names (first column)
  const names: string[] = [];
  for (const line of matrix.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|") && !trimmed.includes("---")) {
      const cells = trimmed.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 2 && cells[0] && !cells[0].includes("角色") && !cells[0].includes("Character")) {
        names.push(cells[0]);
      }
    }
  }
  return names;
}
