import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import type { ServerContext } from "../server-context.js";
import { ApiError } from "../errors.js";
import { analyzeStyleFingerprint, type StyleFingerprint } from "@actalk/inkos-core";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function assertBookExists(state: ServerContext["state"], id: string): Promise<void> {
  try {
    await state.loadBookConfig(id);
  } catch {
    throw new ApiError(404, "BOOK_NOT_FOUND", `Book not found: ${id}`);
  }
}

async function findChapterFile(root: string, bookId: string, chapterNumber: number): Promise<string | null> {
  const chaptersDir = join(root, "books", bookId, "chapters");
  const padded = String(chapterNumber).padStart(4, "0");
  const files = await readdir(chaptersDir).catch(() => [] as string[]);
  const match = files.find((file) => file.startsWith(`${padded}_`) && file.endsWith(".md"));
  return match ? join(chaptersDir, match) : null;
}

// ─── Route Registration ──────────────────────────────────────────────────────

export function registerDetectRoutes(ctx: ServerContext): void {
  const { app, state, root } = ctx;

  // POST /api/v1/books/:id/chapters/:num/style-score
  app.post("/api/v1/books/:id/chapters/:num/style-score", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    await assertBookExists(state, id);

    const chapterPath = await findChapterFile(root, id, num);
    if (!chapterPath) return c.json({ error: "Chapter not found" }, 404);

    try {
      const content = await readFile(chapterPath, "utf-8");
      const chapterFp = analyzeStyleFingerprint(content);

      const bookDir = state.bookDir(id);
      const profilePath = join(bookDir, "story", "style_profile.json");
      let profileFp: StyleFingerprint | undefined;
      try {
        const raw = await readFile(profilePath, "utf-8");
        const parsed = JSON.parse(raw) as { fingerprint?: StyleFingerprint };
        profileFp = parsed.fingerprint;
      } catch {
        // No style profile — score will be null
      }

      if (!profileFp) {
        return c.json({ score: null, chapterFingerprint: chapterFp, message: "No style profile found for this book" });
      }

      const dims = [
        Math.abs(chapterFp.dialogueRatio - profileFp.dialogueRatio),
        Math.abs(chapterFp.actionDensity - profileFp.actionDensity),
        Math.abs(chapterFp.psychologicalRatio - profileFp.psychologicalRatio),
        Math.abs(chapterFp.sensoryDensity - profileFp.sensoryDensity),
        Math.abs(chapterFp.colloquialismScore - profileFp.colloquialismScore),
        Math.abs(chapterFp.rhetoricDensity - profileFp.rhetoricDensity),
        Math.abs(chapterFp.aiTellRisk - profileFp.aiTellRisk),
      ];

      const sensoryDiffs = [
        Math.abs(chapterFp.sensoryBreakdown.visual - profileFp.sensoryBreakdown.visual),
        Math.abs(chapterFp.sensoryBreakdown.auditory - profileFp.sensoryBreakdown.auditory),
        Math.abs(chapterFp.sensoryBreakdown.tactile - profileFp.sensoryBreakdown.tactile),
        Math.abs(chapterFp.sensoryBreakdown.olfactory - profileFp.sensoryBreakdown.olfactory),
        Math.abs(chapterFp.sensoryBreakdown.gustatory - profileFp.sensoryBreakdown.gustatory),
      ];
      dims.push(sensoryDiffs.reduce((a, b) => a + b, 0) / sensoryDiffs.length);

      const punctDiffs = [
        Math.abs(chapterFp.punctuationRhythm.commaRatio - profileFp.punctuationRhythm.commaRatio),
        Math.abs(chapterFp.punctuationRhythm.periodRatio - profileFp.punctuationRhythm.periodRatio),
        Math.abs(chapterFp.punctuationRhythm.questionRatio - profileFp.punctuationRhythm.questionRatio),
        Math.abs(chapterFp.punctuationRhythm.exclamationRatio - profileFp.punctuationRhythm.exclamationRatio),
        Math.abs(chapterFp.punctuationRhythm.ellipsisRatio - profileFp.punctuationRhythm.ellipsisRatio),
        Math.abs(chapterFp.punctuationRhythm.semicolonRatio - profileFp.punctuationRhythm.semicolonRatio),
      ];
      dims.push(punctDiffs.reduce((a, b) => a + b, 0) / punctDiffs.length);

      const avgDiff = dims.reduce((a, b) => a + b, 0) / dims.length;
      const score = Math.round(Math.max(0, 1 - avgDiff) * 100);

      return c.json({ score, chapterFingerprint: chapterFp, profileFingerprint: profileFp });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "Failed to compute style score" }, 500);
    }
  });

  // POST /api/v1/books/:id/detect/:chapter
  app.post("/api/v1/books/:id/detect/:chapter", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const bookDir = state.bookDir(id);

    try {
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const paddedNum = String(chapterNum).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);

      const content = await readFile(join(chaptersDir, match), "utf-8");
      const { analyzeAITells } = await import("@actalk/inkos-core");
      const result = analyzeAITells(content);
      return c.json({ chapterNumber: chapterNum, ...result });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // POST /api/v1/books/:id/detect-all
  app.post("/api/v1/books/:id/detect-all", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    const bookDir = state.bookDir(id);

    try {
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const mdFiles = files.filter((f) => f.endsWith(".md") && /^\d{4}/.test(f)).sort();
      const { analyzeAITells } = await import("@actalk/inkos-core");

      const BATCH_SIZE = 10;
      const results: Array<{ chapterNumber: number; filename: string; flagCount?: number; flags?: unknown[] }> = [];
      for (let i = 0; i < mdFiles.length; i += BATCH_SIZE) {
        const batch = mdFiles.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (f) => {
            const num = parseInt(f.slice(0, 4), 10);
            const content = await readFile(join(chaptersDir, f), "utf-8");
            const result = analyzeAITells(content);
            return { chapterNumber: num, filename: f, ...result };
          }),
        );
        results.push(...batchResults);
      }
      return c.json({ bookId: id, results });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // GET /api/v1/books/:id/detect/stats
  app.get("/api/v1/books/:id/detect/stats", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    try {
      const { loadDetectionHistory, analyzeDetectionInsights } = await import("@actalk/inkos-core");
      const bookDir = state.bookDir(id);
      const history = await loadDetectionHistory(bookDir);
      const insights = analyzeDetectionInsights(history);
      return c.json(insights);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });
}
