/**
 * Chapter Intent — author's pre-writing answers to deep interview questions.
 *
 * This is richer than ChapterGoalCard: it stores *why* the author wants
 * to write this chapter, not just *what* should appear.
 *
 * Persisted alongside chapter_goals.json as:
 *   books/<bookId>/story/chapter_intents/<chapterNumber>.json
 * or later merged into chapter_goals.json if the two models converge.
 */

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";

// ─── Author scene blueprint ───────────────────────────────────────

export interface AuthorScenePlan {
  /** What this scene is supposed to accomplish. */
  readonly goal: string;
  /** Where the scene takes place. */
  readonly location: string;
  /** Whose point of view. */
  readonly povCharacter: string;
  /** The emotion the author wants the reader to feel during this scene. */
  readonly targetEmotion?: string;
}

// ─── Character state snapshot ─────────────────────────────────────

export interface AuthorCharacterState {
  /** Character identifier (matches role card id). */
  readonly characterId: string;
  /** The character's dominant emotion at the start of the chapter. */
  readonly emotion: string;
  /** How the character's relationships changed since last chapter. */
  readonly relationshipChanges?: string;
}

// ─── The full intent ──────────────────────────────────────────────

export interface AuthorChapterIntent {
  readonly chapterNumber: number;

  // ── Level 1: Core (author must answer these) ────────────────
  /** "用一句话说清：这一章在讲什么？" */
  readonly coreNarrative: string;
  /** "你希望读者读完后的核心感受是什么？" */
  readonly readerTakeaway: string;
  /** "这一章最重要的一个时刻/画面是什么？" */
  readonly keyMoment: string;

  // ── Level 2: Scene planning (strongly recommended) ──────────
  readonly scenes: ReadonlyArray<AuthorScenePlan>;

  // ── Level 3: Character state (on demand) ────────────────────
  readonly characterStates: ReadonlyArray<AuthorCharacterState>;

  // ── Level 4: Constraints (inherited from ChapterGoalCard) ───
  readonly requiredBeats: ReadonlyArray<string>;
  readonly forbiddenMoves: ReadonlyArray<string>;
  readonly pendingHookIds: ReadonlyArray<string>;

  // ── Meta ────────────────────────────────────────────────────
  readonly narrativePosition: "opening" | "rising" | "climax" | "falling" | "resolution";
  readonly plotLine?: string;
  readonly interviewCompletedAt?: string;
}

// ─── Persistence ──────────────────────────────────────────────────

function chapterIntentPath(bookDir: string): string {
  return join(bookDir, "story", "chapter_intents.json");
}

export interface ChapterIntentsIndex {
  readonly intents: ReadonlyArray<AuthorChapterIntent>;
  readonly updatedAt: string;
}

export async function loadChapterIntents(bookDir: string): Promise<ChapterIntentsIndex> {
  if (!bookDir) throw new Error("bookDir is required");
  const filePath = chapterIntentPath(bookDir);
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as ChapterIntentsIndex;
    const intents = Array.isArray(parsed.intents)
      ? parsed.intents.filter((i): i is AuthorChapterIntent =>
          i !== null &&
          typeof i === "object" &&
          typeof i.chapterNumber === "number" &&
          Number.isInteger(i.chapterNumber) &&
          i.chapterNumber >= 1 &&
          typeof i.coreNarrative === "string",
        )
      : [];
    return {
      intents,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { intents: [], updatedAt: new Date().toISOString() };
    throw e;
  }
}

export async function saveChapterIntents(
  bookDir: string,
  intents: ReadonlyArray<AuthorChapterIntent>,
): Promise<void> {
  if (!bookDir) throw new Error("bookDir is required");
  const storyDir = join(bookDir, "story");
  await mkdir(storyDir, { recursive: true });
  const index: ChapterIntentsIndex = {
    intents: [...intents],
    updatedAt: new Date().toISOString(),
  };
  const targetPath = chapterIntentPath(bookDir);
  const tmpPath = `${targetPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(index, null, 2), "utf-8");
  await rename(tmpPath, targetPath);
}

export function getChapterIntent(
  intents: ReadonlyArray<AuthorChapterIntent>,
  chapterNumber: number,
): AuthorChapterIntent | undefined {
  return intents.find((i) => i.chapterNumber === chapterNumber);
}

export function upsertChapterIntent(
  intents: ReadonlyArray<AuthorChapterIntent>,
  intent: AuthorChapterIntent,
): AuthorChapterIntent[] {
  const existing = intents.findIndex((i) => i.chapterNumber === intent.chapterNumber);
  if (existing >= 0) {
    const next = [...intents];
    next[existing] = intent;
    return next;
  }
  return [...intents, intent];
}

export function removeChapterIntent(
  intents: ReadonlyArray<AuthorChapterIntent>,
  chapterNumber: number,
): AuthorChapterIntent[] {
  return intents.filter((i) => i.chapterNumber !== chapterNumber);
}
