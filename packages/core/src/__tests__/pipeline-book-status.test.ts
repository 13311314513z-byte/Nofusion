/**
 * Pipeline Book Status — unit tests (G1-S1).
 *
 * Tests for readTruthFilesFromCtx and getBookStatusFromCtx
 * with mocked PipelineContext.state.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readTruthFilesFromCtx, getBookStatusFromCtx } from "../pipeline/pipeline-book-status.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

import { readFile } from "node:fs/promises";

function mockCtx(overrides: {
  bookDir?: string;
  bookConfig?: Record<string, unknown>;
  chapters?: Array<{ number: number; title: string; wordCount: number }>;
  nextChapter?: number;
}) {
  const bookDir = overrides.bookDir ?? "/tmp/test-book";
  return {
    state: {
      bookDir: vi.fn().mockReturnValue(bookDir),
      loadBookConfig: vi.fn().mockResolvedValue(
        overrides.bookConfig ?? { title: "Test Book", genre: "fantasy", platform: "web", status: "drafting" },
      ),
      loadChapterIndex: vi.fn().mockResolvedValue(
        overrides.chapters ?? [{ number: 1, title: "Ch1", wordCount: 3000 }],
      ),
      getNextChapterNumber: vi.fn().mockResolvedValue(overrides.nextChapter ?? 2),
    },
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("readTruthFilesFromCtx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty strings for missing files", async () => {
    vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));
    const ctx = mockCtx({ bookDir: "/tmp/missing-book" });
    const result = await readTruthFilesFromCtx(ctx, "missing-book");
    expect(result.currentState).toBe("(文件不存在)");
    expect(result.storyBible).toBe("(文件不存在)");
  });

  it("returns file contents when files exist", async () => {
    vi.mocked(readFile).mockResolvedValue("file content here");
    const ctx = mockCtx({ bookDir: "/tmp/real-book" });
    const result = await readTruthFilesFromCtx(ctx, "real-book");
    expect(result.currentState).toBe("file content here");
    expect(result.pendingHooks).toBe("file content here");
  });

  it("prefers outline/story_frame.md over story_bible.md", async () => {
    vi.mocked(readFile).mockImplementation(async (path: any) => {
      const p = String(path);
      // The code joins bookDir + "story" + relative path
      if (p.includes("outline") && p.includes("story_frame")) return "new outline content";
      if (p.includes("story_bible")) return "old legacy content";
      return "default content";
    });
    const ctx = mockCtx({ bookDir: "/tmp/outline-book" });
    const result = await readTruthFilesFromCtx(ctx, "outline-book");
    expect(result.storyBible).toBe("new outline content");
  });
});

describe("getBookStatusFromCtx", () => {
  it("returns status with chapter summaries", async () => {
    const ctx = mockCtx({
      chapters: [
        { number: 1, title: "Prologue", wordCount: 2000 },
        { number: 2, title: "The Beginning", wordCount: 4000 },
      ],
      nextChapter: 3,
    });
    const result = await getBookStatusFromCtx(ctx, "status-book");
    expect(result.bookId).toBe("status-book");
    expect(result.chaptersWritten).toBe(2);
    expect(result.totalWords).toBe(6000);
    expect(result.nextChapter).toBe(3);
  });

  it("handles zero chapters", async () => {
    const ctx = mockCtx({ chapters: [], nextChapter: 1 });
    const result = await getBookStatusFromCtx(ctx, "empty-book");
    expect(result.chaptersWritten).toBe(0);
    expect(result.totalWords).toBe(0);
  });
});
