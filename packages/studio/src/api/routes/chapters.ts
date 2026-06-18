import { readFile, readdir, writeFile, mkdir, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { ChapterMetaSchema, type ChapterMeta } from "@actalk/inkos-core";
import type { ServerContext } from "../server-context.js";

const MAX_CHAPTER_VERSIONS = 50;

async function assertBookExists(state: ServerContext["state"], bookId: string): Promise<void> {
  const { ApiError } = await import("../errors.js");
  try {
    await state.loadBookConfig(bookId);
  } catch {
    throw new ApiError(404, "BOOK_NOT_FOUND", `Book "${bookId}" not found`);
  }
}

/**
 * Chapter management routes.
 */
export function registerChaptersRoutes(ctx: ServerContext): void {
  // In-memory lock per chapter to prevent concurrent writes
  const chapterLocks = new Map<string, Promise<void>>();

  function withChapterLock<T>(bookId: string, chapterNum: number, fn: () => Promise<T>): Promise<T> {
    const key = `${bookId}:${chapterNum}`;
    const previous = chapterLocks.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => fn());
    chapterLocks.set(key, next as Promise<void>);
    next.finally(() => {
      if (chapterLocks.get(key) === (next as Promise<void>)) chapterLocks.delete(key);
    });
    return next;
  }

  // --- Read chapter ---
  ctx.app.get("/api/v1/books/:id/chapters/:num", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    const bookDir = ctx.state.bookDir(id);
    const chaptersDir = join(bookDir, "chapters");

    try {
      const files = await readdir(chaptersDir);
      const paddedNum = String(num).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);
      const content = await readFile(join(chaptersDir, match), "utf-8");
      return c.json({ chapterNumber: num, filename: match, content });
    } catch {
      return c.json({ error: "Chapter not found" }, 404);
    }
  });

  // --- Save chapter (with version backup) ---
  ctx.app.put("/api/v1/books/:id/chapters/:num", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    if (!Number.isFinite(num) || num < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    const body = await c.req.json<{ content?: unknown }>();
    if (typeof body.content !== "string") {
      return c.json({ error: "content must be a string" }, 400);
    }
    const content = body.content;
    if (content.length > 10_000_000) {
      return c.json({ error: "content too large" }, 413);
    }
    const bookDir = ctx.state.bookDir(id);
    const chaptersDir = join(bookDir, "chapters");

    return withChapterLock(id, num, async () => {
      try {
        await assertBookExists(ctx.state, id);
        await mkdir(chaptersDir, { recursive: true });
        const paddedNum = String(num).padStart(4, "0");
        const chapterFilePath = join(chaptersDir, `${paddedNum}.md`);

        // Read old content for version backup
        let oldContent = "";
        try {
          oldContent = await readFile(chapterFilePath, "utf-8");
        } catch { /* new chapter */ }

        // Version backup
        if (oldContent) {
          const oldHash = createHash("sha256").update(oldContent).digest("hex").slice(0, 8);
          const newHash = createHash("sha256").update(content).digest("hex").slice(0, 8);
          if (oldHash === newHash) {
            return c.json({ ok: true, chapterNumber: num, revision: 0, unchanged: true });
          }

          const versionsDir = join(bookDir, "chapters", "versions");
          await mkdir(versionsDir, { recursive: true });

          const existingVersions = await readdir(versionsDir).catch(() => []);
          const versionPrefix = `${paddedNum}_v`;
          let revisionCount = 0;
          const versionFiles: string[] = [];
          for (const f of existingVersions) {
            if (f.startsWith(versionPrefix) && f.endsWith(".md")) {
              versionFiles.push(f);
              const revNum = parseInt(f.slice(versionPrefix.length, -3), 10);
              if (!isNaN(revNum) && revNum > revisionCount) revisionCount = revNum;
            }
          }
          revisionCount++;

          await writeFile(join(versionsDir, `${paddedNum}_v${revisionCount}.md`), oldContent, "utf-8");

          if (versionFiles.length >= MAX_CHAPTER_VERSIONS) {
            const sorted = [...versionFiles].sort((a, b) => {
              const revA = parseInt(a.slice(versionPrefix.length, -3), 10);
              const revB = parseInt(b.slice(versionPrefix.length, -3), 10);
              return revA - revB;
            });
            const toRemove = sorted.slice(0, sorted.length - MAX_CHAPTER_VERSIONS + 1);
            for (const stale of toRemove) {
              await unlink(join(versionsDir, stale)).catch(() => {});
            }
          }
        }

        await writeFile(chapterFilePath, content, "utf-8");
        return c.json({ ok: true, chapterNumber: num, revision: oldContent ? 1 : 0 });
      } catch (e) {
        return c.json({ error: String(e) }, 500);
      }
    });
  });

  // --- List chapter versions ---
  ctx.app.get("/api/v1/books/:id/chapters/:num/versions", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    const bookDir = ctx.state.bookDir(id);
    const versionsDir = join(bookDir, "chapters", "versions");

    try {
      await assertBookExists(ctx.state, id);
      const files = await readdir(versionsDir).catch(() => []);
      const paddedNum = String(num).padStart(4, "0");
      const versionPrefix = `${paddedNum}_v`;
      const versions = files
        .filter((f) => f.startsWith(versionPrefix) && f.endsWith(".md"))
        .map((f) => {
          const revNum = parseInt(f.slice(versionPrefix.length, -3), 10);
          return { revision: revNum, filename: f };
        })
        .sort((a, b) => b.revision - a.revision);
      return c.json({ versions, chapterNumber: num });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Read specific version ---
  ctx.app.get("/api/v1/books/:id/chapters/:num/versions/:rev", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    const rev = parseInt(c.req.param("rev"), 10);
    const bookDir = ctx.state.bookDir(id);
    const versionsDir = join(bookDir, "chapters", "versions");

    try {
      await assertBookExists(ctx.state, id);
      const paddedNum = String(num).padStart(4, "0");
      const versionFile = `${paddedNum}_v${rev}.md`;
      const content = await readFile(join(versionsDir, versionFile), "utf-8");
      return c.json({ revision: rev, chapterNumber: num, content });
    } catch {
      return c.json({ error: "Version not found" }, 404);
    }
  });

  // --- Update chapter meta ---
  ctx.app.patch("/api/v1/books/:id/chapters/:num/meta", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({}));

    const cleanStr = (value: unknown): string | undefined => {
      if (typeof value !== "string") return undefined;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    };

    const cleanTags = (value: unknown): string[] => {
      const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,，\n]/) : [];
      return [...new Set(raw.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean))].slice(0, 12);
    };

    const cleanNum = (value: unknown): number | undefined => {
      if (value === null || value === undefined || value === "") return undefined;
      const numeric = typeof value === "number" ? value : Number(value);
      return Number.isFinite(numeric) ? numeric : undefined;
    };

    try {
      const index = [...(await ctx.state.loadChapterIndex(id))];
      const chapterIndex = index.findIndex((chapter) => chapter.number === num);
      if (chapterIndex < 0) return c.json({ error: "Chapter not found" }, 404);

      const current = index[chapterIndex]!;
      const moodScore = cleanNum(body.moodScore);
      const wordCountTarget = cleanNum(body.wordCountTarget);
      const revisionCount = cleanNum(body.revisionCount);
      const updated: ChapterMeta = ChapterMetaSchema.parse({
        ...current,
        tags: cleanTags(body.tags),
        povCharacter: cleanStr(body.povCharacter),
        location: cleanStr(body.location),
        chapterType: cleanStr(body.chapterType),
        timeOfDay: cleanStr(body.timeOfDay),
        moodScore: moodScore === undefined ? undefined : Math.max(-10, Math.min(10, moodScore)),
        wordCountTarget: wordCountTarget === undefined ? undefined : Math.max(1, Math.round(wordCountTarget)),
        revisionCount: revisionCount === undefined ? current.revisionCount ?? 0 : Math.max(0, Math.round(revisionCount)),
        updatedAt: new Date().toISOString(),
      });

      index[chapterIndex] = updated;
      await ctx.state.saveChapterIndex(id, index);
      return c.json({ ok: true, chapter: updated });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  });

  // --- Approve chapter ---
  ctx.app.post("/api/v1/books/:id/chapters/:num/approve", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(ctx.state, id);
    const num = parseInt(c.req.param("num"), 10);

    try {
      const index = await ctx.state.loadChapterIndex(id);
      const updated = index.map((ch) =>
        ch.number === num ? { ...ch, status: "approved" as const } : ch,
      );
      await ctx.state.saveChapterIndex(id, updated);
      return c.json({ ok: true, chapterNumber: num, status: "approved" });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Reject chapter ---
  ctx.app.post("/api/v1/books/:id/chapters/:num/reject", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(ctx.state, id);
    const num = parseInt(c.req.param("num"), 10);

    try {
      const index = await ctx.state.loadChapterIndex(id);
      const target = index.find((ch) => ch.number === num);
      if (!target) {
        return c.json({ error: `Chapter ${num} not found` }, 404);
      }
      const rollbackTarget = num - 1;
      const discarded = await ctx.state.rollbackToChapter(id, rollbackTarget);
      return c.json({
        ok: true, chapterNumber: num, status: "rejected",
        rolledBackTo: rollbackTarget, discarded,
      });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });
}
