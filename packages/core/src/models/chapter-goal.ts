/**
 * Chapter Goal Card — per-chapter writing target and constraints.
 *
 * Persisted at: books/<bookId>/story/chapter_goals.json
 */

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";

export interface ChapterGoalCard {
  readonly chapterNumber: number;
  readonly title?: string;
  readonly povCharacter?: string;
  readonly location?: string;
  readonly timeOfDay?: string;
  readonly mainConflict?: string;
  readonly requiredBeats?: ReadonlyArray<string>;
  readonly forbiddenMoves?: ReadonlyArray<string>;
  readonly targetMood?: string;
  readonly hookIdsToAdvance?: ReadonlyArray<string>;
  readonly targetChars?: number;
}

export interface ChapterGoalsIndex {
  readonly goals: ReadonlyArray<ChapterGoalCard>;
  readonly updatedAt: string;
}

const FILENAME = "chapter_goals.json";

export async function loadChapterGoals(bookDir: string): Promise<ChapterGoalsIndex> {
  if (!bookDir) throw new Error("bookDir is required");
  const filePath = join(bookDir, "story", FILENAME);
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as ChapterGoalsIndex;
    const goals = Array.isArray(parsed.goals)
      ? parsed.goals.filter((g): g is ChapterGoalCard =>
          g !== null &&
          typeof g === "object" &&
          typeof g.chapterNumber === "number" &&
          Number.isInteger(g.chapterNumber) &&
          g.chapterNumber >= 1,
        )
      : [];
    return {
      goals,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { goals: [], updatedAt: new Date().toISOString() };
    throw e;
  }
}

export async function saveChapterGoals(
  bookDir: string,
  goals: ReadonlyArray<ChapterGoalCard>,
): Promise<void> {
  if (!bookDir) throw new Error("bookDir is required");
  const storyDir = join(bookDir, "story");
  await mkdir(storyDir, { recursive: true });
  const index: ChapterGoalsIndex = {
    goals: [...goals],
    updatedAt: new Date().toISOString(),
  };
  const targetPath = join(storyDir, FILENAME);
  const tmpPath = `${targetPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(index, null, 2), "utf-8");
  await rename(tmpPath, targetPath);
}

export function getChapterGoal(
  goals: ReadonlyArray<ChapterGoalCard>,
  chapterNumber: number,
): ChapterGoalCard | undefined {
  return goals.find((g) => g.chapterNumber === chapterNumber);
}

export function upsertChapterGoal(
  goals: ReadonlyArray<ChapterGoalCard>,
  goal: ChapterGoalCard,
): ChapterGoalCard[] {
  const existing = goals.findIndex((g) => g.chapterNumber === goal.chapterNumber);
  if (existing >= 0) {
    const next = [...goals];
    next[existing] = goal;
    return next;
  }
  return [...goals, goal];
}

export function removeChapterGoal(
  goals: ReadonlyArray<ChapterGoalCard>,
  chapterNumber: number,
): ChapterGoalCard[] {
  return goals.filter((g) => g.chapterNumber !== chapterNumber);
}
