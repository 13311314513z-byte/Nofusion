import {
buildExportArtifact,
createInteractionToolsFromDeps,
processProjectInteractionRequest,
} from "@actalk/inkos-core";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { ApiError } from "../errors.js";
import type { ServerContext } from "../server-context.js";
import { withPipeline } from "../shared/pipeline.js";
import {
acquireWriteJob,
completeWriteJob,
failWriteJob,
timeoutWriteJob,
WRITE_JOB_TIMEOUT_MS,
} from "../shared/write-jobs.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function assertBookExists(state: ServerContext["state"], id: string): Promise<void> {
  try {
    await state.loadBookConfig(id);
  } catch {
    throw new ApiError(404, "BOOK_NOT_FOUND", `Book not found: ${id}`);
  }
}

// ─── Route Registration ──────────────────────────────────────────────────────

export function registerRevisionExportRoutes(ctx: ServerContext): void {
  const { app, state, root, broadcast, buildPipelineConfig } = ctx;

  // POST /api/v1/books/:id/revise/:chapter
  app.post("/api/v1/books/:id/revise/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const bookDir = state.bookDir(id);
    const body = await c.req
      .json<{ mode?: string; brief?: string }>()
      .catch(() => ({ mode: "spot-fix", brief: undefined }));

    broadcast("revise:start", { bookId: id, chapter: chapterNum });
    try {
      const _book = await state.loadBookConfig(id);
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const paddedNum = String(chapterNum).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);

      const pipelineConfig = await buildPipelineConfig({ externalContext: body.brief });
      const normalizedMode = body.mode ?? "spot-fix";
      const result = await withPipeline("revise-draft", pipelineConfig, async (pipeline) => {
        return pipeline.reviseDraft(
          id,
          chapterNum,
          normalizedMode as "polish" | "rewrite" | "rework" | "spot-fix" | "anti-detect",
        );
      });
      broadcast("revise:complete", { bookId: id, chapter: chapterNum });
      return c.json(result);
    } catch (e) {
      broadcast("revise:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // GET /api/v1/books/:id/export
  app.get("/api/v1/books/:id/export", async (c) => {
    const id = c.req.param("id");
    const format = (c.req.query("format") ?? "txt") as string;
    const approvedOnly = c.req.query("approvedOnly") === "true";

    try {
      const artifact = await buildExportArtifact(state, id, {
        format: format as "txt" | "md" | "epub" | "html",
        approvedOnly,
      });
      const responseBody = typeof artifact.payload === "string"
        ? artifact.payload
        : new Uint8Array(artifact.payload);
      return new Response(responseBody, {
        headers: {
          "Content-Type": artifact.contentType,
          "Content-Disposition": `attachment; filename="${artifact.fileName}"`,
        },
      });
    } catch {
      return c.json({ error: "Export failed" }, 500);
    }
  });

  // POST /api/v1/books/:id/export-save
  app.post("/api/v1/books/:id/export-save", async (c) => {
    const id = c.req.param("id");
    const { format, approvedOnly } = await c.req.json<{ format?: string; approvedOnly?: boolean }>().catch(() => ({ format: "txt", approvedOnly: false }));
    const ALLOWED_EXPORT_FORMATS = new Set(["txt", "md", "html", "epub"]);
    const fmt = format ?? "txt";
    if (!ALLOWED_EXPORT_FORMATS.has(fmt)) {
      return c.json({ error: `不支持的导出格式 "${fmt}"，仅支持 txt/md/html/epub` }, 400);
    }

    try {
      const result = await withPipeline("export-save", await buildPipelineConfig(), async (pipeline) => {
        const tools = createInteractionToolsFromDeps(pipeline, state);
        const bookDir = state.bookDir(id);
        const outputPath = join(bookDir, `${id}.${fmt === "epub" ? "epub" : fmt}`);
        const r = await processProjectInteractionRequest({
          projectRoot: root,
          request: {
            intent: "export_book",
            bookId: id,
            format: fmt as "txt" | "md" | "epub" | "html",
            approvedOnly,
            outputPath,
          },
          tools,
          activeBookId: id,
        });
        return {
          ok: true,
          path: (r.details?.outputPath as string | undefined) ?? outputPath,
          format: fmt,
          chapters: (r.details?.chaptersExported as number | undefined) ?? 0,
        };
      });
      return c.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("no chapters") || msg.includes("No chapters") || msg.includes("empty")) {
        return c.json({ error: "当前书籍没有可导出的章节，请先创作章节内容。" }, 400);
      }
      return c.json({ error: `导出失败：${msg}` }, 500);
    }
  });

  // POST /api/v1/books/:id/rewrite/:chapter
  app.post("/api/v1/books/:id/rewrite/:chapter", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const body: { brief?: string } = await c.req
      .json<{ brief?: string }>()
      .catch(() => ({}));

    const jobKey = acquireWriteJob(id, "rewrite");
    if (!jobKey) {
      return c.json({ error: "A write operation is already in progress for this book.", code: "WRITE_IN_PROGRESS" }, 409);
    }

    broadcast("rewrite:start", { bookId: id, chapter: chapterNum });
    try {
      const rollbackTarget = chapterNum - 1;
      const discarded = await state.rollbackToChapter(id, rollbackTarget);
      const pipelineConfig = await buildPipelineConfig({ externalContext: body.brief });
      withPipeline("rewrite-next", pipelineConfig, async (pipeline) => {
        const result = await pipeline.writeNextChapter(id);
        completeWriteJob(jobKey, result.chapterNumber);
        broadcast("rewrite:complete", { bookId: id, chapterNumber: result.chapterNumber, title: result.title, wordCount: result.wordCount });
      }, WRITE_JOB_TIMEOUT_MS).catch(
        (e) => {
          const message = e instanceof Error ? e.message : String(e);
          if (message.includes("timed out")) {
            timeoutWriteJob(jobKey);
          } else {
            failWriteJob(jobKey, message);
          }
          broadcast("rewrite:error", { bookId: id, error: message });
        },
      );
      return c.json({ status: "rewriting", bookId: id, chapter: chapterNum, rolledBackTo: rollbackTarget, discarded, jobKey });
    } catch (e) {
      failWriteJob(jobKey, String(e));
      broadcast("rewrite:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // POST /api/v1/books/:id/resync/:chapter
  app.post("/api/v1/books/:id/resync/:chapter", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const body: { brief?: string } = await c.req
      .json<{ brief?: string }>()
      .catch(() => ({}));

    try {
      const result = await withPipeline("resync-chapter", await buildPipelineConfig({ externalContext: body.brief }), async (pipeline) => {
        return pipeline.resyncChapterArtifacts(id, chapterNum);
      });
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });
}
