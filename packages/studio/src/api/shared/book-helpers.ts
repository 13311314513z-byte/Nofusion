/**
 * Book list helpers shared between server.ts and route modules.
 */
import type { StateManager } from "@actalk/inkos-core";

export interface StudioBookListSummary {
  readonly id: string;
  readonly title: string;
  readonly genre: string;
  readonly status: string;
  readonly chaptersWritten: number;
  readonly [key: string]: unknown;
}

export function normalizeStudioBookConfig(
  bookId: string,
  book: Record<string, unknown>,
): Record<string, unknown> & { id: string; title: string; genre: string; status: string } {
  const title =
    typeof book.title === "string" && book.title.trim()
      ? book.title
      : typeof book.name === "string" && book.name.trim()
        ? book.name
        : bookId;
  const name = title;
  const genre =
    typeof book.genre === "string" && book.genre.trim()
      ? book.genre
      : typeof book.genreProfileId === "string" && book.genreProfileId.trim()
        ? book.genreProfileId
        : "other";
  const genreProfileId = genre;

  return {
    ...book,
    id: bookId,
    title,
    name,
    genre,
    genreProfileId,
    status: typeof book.status === "string" && book.status.trim() ? book.status : "active",
  };
}

export async function loadStudioBookListSummary(
  state: StateManager,
  bookId: string,
): Promise<StudioBookListSummary> {
  const book = normalizeStudioBookConfig(bookId, await state.loadBookConfig(bookId) as Record<string, unknown>);
  const nextChapter = await state.getNextChapterNumber(bookId);
  return { ...book, chaptersWritten: nextChapter - 1 };
}
