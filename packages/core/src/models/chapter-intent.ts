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
import {
  ChapterIntentsIndexSchema,
  migrateIntentsIndex,
  type AuthorChapterIntent,
  type AuthorCharacterState,
  type AuthorScenePlan,
  type ChapterIntentsIndex,
} from "./chapter-intent.schema.js";

export type {
  AuthorChapterIntent,
  AuthorCharacterState,
  AuthorScenePlan,
  ChapterIntentsIndex,
} from "./chapter-intent.schema.js";

// ─── Persistence ──────────────────────────────────────────────────

function chapterIntentPath(bookDir: string): string {
  return join(bookDir, "story", "chapter_intents.json");
}

export async function loadChapterIntents(bookDir: string): Promise<ChapterIntentsIndex> {
  if (!bookDir) throw new Error("bookDir is required");
  const filePath = chapterIntentPath(bookDir);
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    // Apply migration to fill defaults for legacy data
    return migrateIntentsIndex(parsed);
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
  const index = ChapterIntentsIndexSchema.parse({
    intents: [...intents],
    updatedAt: new Date().toISOString(),
  });
  const targetPath = chapterIntentPath(bookDir);
  const tmpPath = `${targetPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(index, null, 2), "utf-8");
  await rename(tmpPath, targetPath);
}

export function getChapterIntent(
  intents: ReadonlyArray<AuthorChapterIntent>,
  chapterNumber: number,
): AuthorChapterIntent | undefined {
  const matches = intents.filter((intent) => intent.chapterNumber === chapterNumber);
  const active = matches.filter((intent) => intent.status !== "superseded");
  const candidates = active.length > 0 ? active : matches;
  return candidates.reduce<AuthorChapterIntent | undefined>((latest, candidate) => {
    if (!latest) return candidate;
    return (candidate.revision ?? 0) >= (latest.revision ?? 0) ? candidate : latest;
  }, undefined);
}

export function upsertChapterIntent(
  intents: ReadonlyArray<AuthorChapterIntent>,
  intent: AuthorChapterIntent,
): AuthorChapterIntent[] {
  const now = new Date().toISOString();
  const chapterVersions = intents.filter((item) => item.chapterNumber === intent.chapterNumber);
  const previous = getChapterIntent(intents, intent.chapterNumber);
  if (chapterVersions.length > 0) {
    const highestRevision = Math.max(...chapterVersions.map((item) => item.revision ?? 1));
    const next = intents.map((item) =>
      item.chapterNumber === intent.chapterNumber && item.status !== "superseded"
        ? { ...item, status: "superseded" as const, updatedAt: now }
        : item,
    );
    const updated: AuthorChapterIntent = {
      ...intent,
      revision: highestRevision + 1,
      status: "draft" as const,
      updatedAt: now,
      source: intent.source ?? previous?.source ?? ("author" as const),
    };
    next.push(updated);
    return next;
  }
  return [
    ...intents,
    {
      ...intent,
      revision: 1,
      status: "draft" as const,
      updatedAt: now,
      source: intent.source ?? ("author" as const),
    },
  ];
}

export function removeChapterIntent(
  intents: ReadonlyArray<AuthorChapterIntent>,
  chapterNumber: number,
): AuthorChapterIntent[] {
  return intents.filter((i) => i.chapterNumber !== chapterNumber);
}

/**
 * Mark an intent as "confirmed" after the chapter has been generated.
 * This does NOT increment revision — it only changes the status.
 */
export function confirmChapterIntent(
  intent: AuthorChapterIntent,
): AuthorChapterIntent {
  return {
    ...intent,
    status: "confirmed",
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Mark an intent as "superseded" when a newer version replaces it.
 */
export function supersedeChapterIntent(
  intent: AuthorChapterIntent,
): AuthorChapterIntent {
  return {
    ...intent,
    status: "superseded",
    updatedAt: new Date().toISOString(),
  };
}
