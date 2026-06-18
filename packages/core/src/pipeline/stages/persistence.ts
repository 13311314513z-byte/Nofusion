import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { StateManager } from "../../state/manager.js";
import type { Logger } from "../../utils/logger.js";
import type { ChapterMeta } from "../../models/chapter.js";

/**
 * Pipeline persistence stage — saves chapter artifacts, updates indices,
 * and syncs runtime state after a chapter write completes.
 *
 * Extracted from PipelineRunner to separate I/O concerns from orchestration.
 */
export interface PersistenceInput {
  /** State manager */
  state: StateManager;
  /** Logger */
  logger: Logger;
  /** Project root directory */
  projectRoot: string;
  /** Book ID */
  bookId: string;
  /** Chapter number */
  chapterNumber: number;
  /** Chapter content (markdown) */
  content: string;
  /** Chapter metadata */
  meta: ChapterMeta;
  /** Chapter title */
  title?: string;
}

export interface PersistenceOutput {
  /** Final word count */
  wordCount: number;
  /** Path to saved chapter file */
  chapterPath: string;
}

/**
 * Persist a chapter to disk and update the chapter index.
 */
export async function runPersistenceStage(input: PersistenceInput): Promise<PersistenceOutput> {
  const { state, logger, projectRoot, bookId, chapterNumber, content, meta, title } = input;

  const bookDir = state.bookDir(bookId);
  const chaptersDir = join(bookDir, "chapters");
  await mkdir(chaptersDir, { recursive: true });

  const paddedNum = String(chapterNumber).padStart(4, "0");
  const chapterPath = join(chaptersDir, `${paddedNum}.md`);

  await writeFile(chapterPath, content, "utf-8");
  logger?.info(`[persistence] Wrote chapter ${chapterNumber} for book ${bookId}`);

  // Update chapter index
  const index = await state.loadChapterIndex(bookId);
  const updatedIndex = index.map((ch) =>
    ch.number === chapterNumber
      ? { ...ch, ...meta, title: title ?? ch.title, updatedAt: new Date().toISOString() }
      : ch,
  );
  await state.saveChapterIndex(bookId, updatedIndex);

  const wordCount = content.replace(/\s/g, "").length; // CJK-friendly word count
  return { wordCount, chapterPath };
}
