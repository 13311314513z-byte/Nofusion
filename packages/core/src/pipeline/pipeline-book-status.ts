/**
 * Pipeline Book Status (G1) — extracted from runner.ts.
 *
 * Contains readTruthFiles and getBookStatus implementations,
 * previously inline in PipelineRunner. Types remain in runner.ts
 * to avoid circular dependencies.
 *
 * @module
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PipelineContext } from "./context.js";

// ---------------------------------------------------------------------------
// Types (exported so runner.ts can use them without cast)
// ---------------------------------------------------------------------------

export interface TruthFiles {
  readonly currentState: string;
  readonly particleLedger: string;
  readonly pendingHooks: string;
  readonly storyBible: string;
  readonly volumeOutline: string;
  readonly bookRules: string;
}

export interface BookStatusResult {
  readonly bookId: string;
  readonly title: string;
  readonly genre: string;
  readonly platform: string;
  readonly status: string;
  readonly chaptersWritten: number;
  readonly totalWords: number;
  readonly nextChapter: number;
  readonly chapters: ReadonlyArray<{
    readonly number: number;
    readonly title: string;
    readonly wordCount: number;
  }>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Read all truth files for a book. */
export async function readTruthFilesFromCtx(
  ctx: PipelineContext,
  bookId: string,
): Promise<TruthFiles> {
  return readTruthFilesInternal((id) => ctx.state.bookDir(id), bookId);
}

/** Get book status overview. */
export async function getBookStatusFromCtx(
  ctx: PipelineContext,
  bookId: string,
): Promise<BookStatusResult> {
  return getBookStatusInternal(
    {
      loadBookConfig: (id) => ctx.state.loadBookConfig(id),
      loadChapterIndex: (id) => ctx.state.loadChapterIndex(id),
      getNextChapterNumber: (id) => ctx.state.getNextChapterNumber(id),
    },
    bookId,
  );
}

// ---------------------------------------------------------------------------
// Internal implementations
// ---------------------------------------------------------------------------

async function readTruthFilesInternal(
  bookDirFn: (bookId: string) => string,
  bookId: string,
): Promise<TruthFiles> {
  const bookDir = bookDirFn(bookId);
  const storyDir = join(bookDir, "story");
  const readSafe = async (path: string): Promise<string> => {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return "(文件不存在)";
    }
  };
  const readOutline = async (newRel: string, legacyRel: string): Promise<string> => {
    const preferred = await readSafe(join(storyDir, newRel));
    if (preferred.trim() && preferred !== "(文件不存在)") return preferred;
    return readSafe(join(storyDir, legacyRel));
  };
  const [currentState, particleLedger, pendingHooks, storyBible, volumeOutline, bookRules] =
    await Promise.all([
      readSafe(join(storyDir, "current_state.md")),
      readSafe(join(storyDir, "particle_ledger.md")),
      readSafe(join(storyDir, "pending_hooks.md")),
      readOutline("outline/story_frame.md", "story_bible.md"),
      readOutline("outline/volume_map.md", "volume_outline.md"),
      readSafe(join(storyDir, "book_rules.md")),
    ]);
  return { currentState, particleLedger, pendingHooks, storyBible, volumeOutline, bookRules };
}

async function getBookStatusInternal(
  deps: {
    loadBookConfig: (bookId: string) => Promise<{ title: string; genre: string; platform: string; status: string }>;
    loadChapterIndex: (bookId: string) => Promise<ReadonlyArray<{ number: number; title: string; wordCount: number }>>;
    getNextChapterNumber: (bookId: string) => Promise<number>;
  },
  bookId: string,
) {
  const book = await deps.loadBookConfig(bookId);
  const chapters = await deps.loadChapterIndex(bookId);
  const nextChapter = await deps.getNextChapterNumber(bookId);
  const totalWords = chapters.reduce((sum, ch) => sum + ch.wordCount, 0);

  return {
    bookId,
    title: book.title,
    genre: book.genre,
    platform: book.platform,
    status: book.status,
    chaptersWritten: chapters.length,
    totalWords,
    nextChapter,
    chapters: [...chapters],
  } as const;
}
