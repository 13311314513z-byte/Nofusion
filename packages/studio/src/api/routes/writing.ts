import type { ServerContext } from "../server-context.js";
import { ApiError } from "../errors.js";
import { withPipeline } from "../shared/pipeline.js";
import {
  acquireWriteJob,
  completeWriteJob,
  failWriteJob,
  timeoutWriteJob,
  WRITE_JOB_TIMEOUT_MS,
  writeJobs,
  type WriteJobEntry,
} from "../shared/write-jobs.js";
import {
  loadChapterGoals,
  loadChapterIntents,
  getChapterGoal,
  getChapterIntent,
  type ChapterGoalCard,
  type AuthorChapterIntent,
} from "@actalk/inkos-core";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function assertBookExists(state: ServerContext["state"], id: string): Promise<void> {
  try {
    await state.loadBookConfig(id);
  } catch {
    throw new ApiError(404, "BOOK_NOT_FOUND", `Book not found: ${id}`);
  }
}

async function parsePlanAlternatives(planPath: string): Promise<Array<{ id: string; label: string; description: string; goal: string }>> {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(planPath, "utf-8");
    const altMatch = raw.match(/## Plan Alternatives[\s\S]*$/);
    if (altMatch) {
      const altBlocks = altMatch[0].split(/### Variant /).filter(Boolean);
      return altBlocks.map((block, i) => {
        const labelMatch = block.match(/^(\S[^\n]*)/);
        const goalMatch = block.match(/\*\*Goal\*\*:\s*(.+)/);
        const descMatch = block.match(/\*\*Description\*\*:\s*(.+)/);
        return {
          id: `variant-${String.fromCharCode(98 + i)}`,
          label: labelMatch?.[1]?.trim() || `方案 ${String.fromCharCode(65 + i)}`,
          description: descMatch?.[1]?.trim() || "",
          goal: goalMatch?.[1]?.trim() || "",
        };
      });
    }
  } catch { /* no plan file yet */ }
  return [];
}

// ─── Route Registration ──────────────────────────────────────────────────────

export function registerWritingRoutes(ctx: ServerContext): void {
  const { app, state, broadcast, buildPipelineConfig } = ctx;

  // GET /api/v1/books/:id/write-preview
  app.get("/api/v1/books/:id/write-preview", async (c) => {
    const id = c.req.param("id");
    const chapterNumber = Number(c.req.query("chapter"));
    await assertBookExists(state, id);
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }

    const bookDir = state.bookDir(id);

    try {
      const [chapterGoalsIndex, chapterIntentsIndex] = await Promise.all([
        loadChapterGoals(bookDir).catch(() => ({ goals: [] as ReadonlyArray<ChapterGoalCard> })),
        loadChapterIntents(bookDir).catch(() => ({ intents: [] as ReadonlyArray<AuthorChapterIntent> })),
      ]);

      const chapterGoal = getChapterGoal(chapterGoalsIndex.goals, chapterNumber);
      const chapterIntent = getChapterIntent(chapterIntentsIndex.intents, chapterNumber);

      let activeHooksCount = 0;
      let overdueHookIds: string[] = [];
      try {
        const { readFile } = await import("node:fs/promises");
        const { join } = await import("node:path");
        const hooksJsonPath = join(bookDir, "story", "state", "hooks.json");
        const raw = await readFile(hooksJsonPath, "utf-8");
        const parsed = JSON.parse(raw) as { hooks?: Array<{ hookId: string; status: string; halfLifeChapters?: number; lastAdvancedChapter: number }> };
        const hooks = parsed.hooks ?? [];
        activeHooksCount = hooks.filter((h) => h.status !== "resolved").length;
        overdueHookIds = hooks
          .filter((h) => h.status !== "resolved" && h.halfLifeChapters && (chapterNumber - h.lastAdvancedChapter) > h.halfLifeChapters)
          .map((h) => h.hookId);
      } catch { /* hooks.json not found */ }

      const contextSummary = {
        hasGoal: !!chapterGoal,
        goalMainConflict: chapterGoal?.mainConflict ?? null,
        hasIntent: !!(chapterIntent?.coreNarrative),
        intentCoreNarrative: chapterIntent?.coreNarrative ?? null,
        activeHooksCount,
        overdueHooksCount: overdueHookIds.length,
        overdueHookIds,
        hasPovCharacter: !!chapterGoal?.povCharacter,
        povCharacter: chapterGoal?.povCharacter ?? null,
        hasOpeningFrame: !!(chapterIntent as Record<string, unknown> | null)?.["openingFrame"],
        hasClosingFrame: !!(chapterIntent as Record<string, unknown> | null)?.["closingFrame"],
      };

      const warnings: string[] = [];
      if (!chapterGoal) warnings.push("未设定本章目标——建议先在「目标」面板填写");
      if (!chapterIntent?.coreNarrative) warnings.push("未完成创作访谈——建议先回答核心三问");
      if (overdueHookIds.length > 0) warnings.push(`${overdueHookIds.length} 条伏笔已逾期：${overdueHookIds.join("、")}`);

      const { join: jn2 } = await import("node:path");
      const padded = String(chapterNumber).padStart(4, "0");
      const planPath = jn2(bookDir, "story", "runtime", `chapter-${padded}.plan.md`);
      const planAlternatives = await parsePlanAlternatives(planPath);

      return c.json({ chapterNumber, contextSummary, warnings, planAlternatives });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // GET /api/v1/books/:id/plan-alternatives
  app.get("/api/v1/books/:id/plan-alternatives", async (c) => {
    const id = c.req.param("id");
    const chapterNumber = Number(c.req.query("chapter"));
    await assertBookExists(state, id);
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    try {
      const bookDir = state.bookDir(id);
      const { join } = await import("node:path");
      const padded = String(chapterNumber).padStart(4, "0");
      const planPath = join(bookDir, "story", "runtime", `chapter-${padded}.plan.md`);
      const alternatives = await parsePlanAlternatives(planPath);
      return c.json({ chapterNumber, alternatives });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // POST /api/v1/books/:id/write-next
  app.post("/api/v1/books/:id/write-next", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    const body = await c.req.json<{ wordCount?: number }>().catch(() => ({ wordCount: undefined }));

    const jobKey = acquireWriteJob(id, "write-next");
    if (!jobKey) {
      return c.json({ error: "A write operation is already in progress for this book. Wait for it to complete or check /api/v1/books/:id/write-status.", code: "WRITE_IN_PROGRESS" }, 409);
    }

    broadcast("write:start", { bookId: id });

    withPipeline("write-next", await buildPipelineConfig(), async (pipeline) => {
      const result = await pipeline.writeNextChapter(id, body.wordCount);
      completeWriteJob(jobKey, result.chapterNumber);
      broadcast("write:complete", { bookId: id, chapterNumber: result.chapterNumber, status: result.status, title: result.title, wordCount: result.wordCount });
    }, WRITE_JOB_TIMEOUT_MS).catch((e) => {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes("timed out")) {
        timeoutWriteJob(jobKey);
      } else {
        failWriteJob(jobKey, message);
      }
      broadcast("write:error", { bookId: id, error: message });
    });

    return c.json({ status: "writing", bookId: id, jobKey });
  });

  // POST /api/v1/books/:id/draft
  app.post("/api/v1/books/:id/draft", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    const body = await c.req.json<{ wordCount?: number; context?: string }>().catch(() => ({ wordCount: undefined, context: undefined }));

    const jobKey = acquireWriteJob(id, "draft");
    if (!jobKey) {
      return c.json({ error: "A write operation is already in progress for this book.", code: "WRITE_IN_PROGRESS" }, 409);
    }

    broadcast("draft:start", { bookId: id });

    withPipeline("draft", await buildPipelineConfig(), async (pipeline) => {
      const result = await pipeline.writeDraft(id, body.context, body.wordCount);
      completeWriteJob(jobKey, result.chapterNumber);
      broadcast("draft:complete", { bookId: id, chapterNumber: result.chapterNumber, title: result.title, wordCount: result.wordCount });
    }, WRITE_JOB_TIMEOUT_MS).catch((e) => {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes("timed out")) {
        timeoutWriteJob(jobKey);
      } else {
        failWriteJob(jobKey, message);
      }
      broadcast("draft:error", { bookId: id, error: message });
    });

    return c.json({ status: "drafting", bookId: id, jobKey });
  });

  // GET /api/v1/books/:id/write-status
  app.get("/api/v1/books/:id/write-status", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    const activeJobs: WriteJobEntry[] = [];
    for (const [, job] of writeJobs) {
      if (job.bookId === id) {
        activeJobs.push(job);
      }
    }
    return c.json({ bookId: id, jobs: activeJobs });
  });
}
