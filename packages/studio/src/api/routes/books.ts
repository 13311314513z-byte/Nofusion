import { access } from "node:fs/promises";
import { join } from "node:path";
import {
  StateManager,
  PipelineRunner,
  buildFoundationSourceBundle,
  persistFoundationSourceBundle,
  createInteractionToolsFromDeps,
  processProjectInteractionRequest,
  type BookConfig,
  type FoundationSourceBundle,
} from "@actalk/inkos-core";
import type { ServerContext } from "../server-context.js";
import { buildStudioBookConfig, type StudioCreateBookBody } from "../book-create.js";
import { loadStudioBookListSummary, normalizeStudioBookConfig } from "../shared/book-helpers.js";

const BOOK_CREATE_IN_PROGRESS_TTL_MS = 300_000;
const BOOK_CREATE_TTL_MS = 600_000;
const BOOK_CREATE_TIMEOUT_MS = 600_000;

interface BookCreateJob {
  status: "queued" | "creating" | "completed" | "failed";
  error?: string;
  phase?: string;
  createdAt: number;
  ttlMs: number;
}

/** Shared book creation job tracker */
const bookCreateStatus = new Map<string, BookCreateJob>();

function withPipeline(
  label: string,
  pipelineConfig: Record<string, unknown>,
  fn: (pipeline: PipelineRunner) => Promise<void>,
): Promise<void> {
  const pipeline = new PipelineRunner(pipelineConfig as never);
  return fn(pipeline).catch((e: unknown) => {
    console.error(`[studio] ${label} pipeline error:`, e);
  }).finally(async () => {
    const maybeDisposable = pipeline as { dispose?: () => void | Promise<void> };
    await maybeDisposable.dispose?.();
  });
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function cleanNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : undefined;
}

function cleanStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    const arr = value.split(/[,，\n]/).map((v) => v.trim()).filter(Boolean);
    return arr.length > 0 ? arr : undefined;
  }
  return undefined;
}

async function assertBookExists(state: StateManager, bookId: string): Promise<void> {
  const { ApiError } = await import("../errors.js");
  try {
    await state.loadBookConfig(bookId);
  } catch {
    throw new ApiError(404, "BOOK_NOT_FOUND", `Book "${bookId}" not found`);
  }
}

/**
 * Book management routes.
 */
export function registerBooksRoutes(ctx: ServerContext): void {
  // --- List all books ---
  ctx.app.get("/api/v1/books", async (c) => {
    const bookIds = await ctx.state.listBooks();
    const books = await Promise.all(bookIds.map((id) => loadStudioBookListSummary(ctx.state, id)));
    return c.json({ books });
  });

  // --- Get single book ---
  ctx.app.get("/api/v1/books/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const book = normalizeStudioBookConfig(id, await ctx.state.loadBookConfig(id) as Record<string, unknown>);
      const chapters = await ctx.state.loadChapterIndex(id);
      const nextChapter = await ctx.state.getNextChapterNumber(id);
      return c.json({ book, chapters, nextChapter });
    } catch {
      return c.json({ error: `Book "${id}" not found` }, 404);
    }
  });

  // --- Create book (async) ---
  ctx.app.post("/api/v1/books/create", async (c) => {
    let body: StudioCreateBookBody;
    try {
      body = await c.req.json<StudioCreateBookBody>();
    } catch {
      return c.json({ error: "请求体 JSON 解析失败" }, 400);
    }
    let sourceBundle: FoundationSourceBundle | undefined;
    try {
      sourceBundle = body.foundationSources?.length
        ? buildFoundationSourceBundle(body.foundationSources)
        : undefined;
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }

    const now = new Date().toISOString();
    const bookConfig = buildStudioBookConfig(body, now);
    const bookId = bookConfig.id;
    const bookDir = ctx.state.bookDir(bookId);

    try {
      await access(join(bookDir, "book.json"));
      await access(join(bookDir, "story", "story_bible.md"));
      return c.json({ error: `Book "${bookId}" already exists` }, 409);
    } catch {
      // Not fully initialized — proceed
    }

    ctx.broadcast("book:creating", { bookId, title: body.title });
    bookCreateStatus.set(bookId, { status: "queued", createdAt: Date.now(), ttlMs: BOOK_CREATE_IN_PROGRESS_TTL_MS });

    const blurb = [body.blurb?.trim(), sourceBundle?.contextBlock.trim()]
      .filter((part): part is string => Boolean(part))
      .join("\n\n");

    (async () => {
      try {
        bookCreateStatus.set(bookId, { status: "creating", createdAt: Date.now(), ttlMs: BOOK_CREATE_IN_PROGRESS_TTL_MS });
        const pipelineConfig = await ctx.buildPipelineConfig() as unknown as Record<string, unknown>;
        withPipeline("create-book", pipelineConfig, async (pipeline) => {
          const tools = createInteractionToolsFromDeps(pipeline, ctx.state);

          const creationPromise = processProjectInteractionRequest({
            projectRoot: ctx.root,
            request: {
              intent: "create_book",
              title: body.title,
              genre: body.genre,
              language: body.language === "en" ? "en" : body.language === "zh" ? "zh" : undefined,
              platform: body.platform,
              chapterWordCount: body.chapterWordCount,
              targetChapters: body.targetChapters,
              ...(blurb ? { blurb } : {}),
            },
            tools,
          });

          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("书籍创建超时（10 分钟）")), BOOK_CREATE_TIMEOUT_MS);
          });

          try {
            const result = await Promise.race([creationPromise, timeoutPromise]);
            const r = result as {
              readonly session: { readonly activeBookId?: string };
              readonly details?: Readonly<Record<string, unknown>>;
            };
            const createdBookId = (r.details?.bookId as string | undefined) ?? r.session.activeBookId ?? bookId;
            if (sourceBundle) {
              await persistFoundationSourceBundle(ctx.state.bookDir(createdBookId), sourceBundle, "create");
            }
            if (bookConfig.volumeCount !== undefined || bookConfig.currentVolume !== undefined ||
                bookConfig.keywords !== undefined || bookConfig.targetAudience !== undefined ||
                bookConfig.serializationStatus !== undefined) {
              try {
                const existing = await ctx.state.loadBookConfig(createdBookId);
                const patched = {
                  ...existing,
                  ...(bookConfig.volumeCount !== undefined ? { volumeCount: bookConfig.volumeCount } : {}),
                  ...(bookConfig.currentVolume !== undefined ? { currentVolume: bookConfig.currentVolume } : {}),
                  ...(bookConfig.keywords !== undefined ? { keywords: bookConfig.keywords } : {}),
                  ...(bookConfig.targetAudience !== undefined ? { targetAudience: bookConfig.targetAudience } : {}),
                  ...(bookConfig.serializationStatus !== undefined ? { serializationStatus: bookConfig.serializationStatus } : {}),
                  updatedAt: new Date().toISOString(),
                };
                await ctx.state.saveBookConfig(createdBookId, patched);
              } catch { /* best-effort */ }
            }
            const book = await loadStudioBookListSummary(ctx.state, createdBookId).catch(() => undefined);
            bookCreateStatus.set(bookId, { status: "completed", createdAt: Date.now(), ttlMs: BOOK_CREATE_TTL_MS });
            ctx.broadcast("book:created", { bookId: createdBookId, ...(book ? { book } : {}) });
          } catch (e: unknown) {
            const error = e instanceof Error ? e.message : String(e);
            bookCreateStatus.set(bookId, { status: "failed", error, createdAt: Date.now(), ttlMs: BOOK_CREATE_TTL_MS });
            ctx.broadcast("book:error", { bookId, error });
          }
        });
      } catch (e: unknown) {
        const error = e instanceof Error ? e.message : String(e);
        bookCreateStatus.set(bookId, { status: "failed", error: `管道初始化失败: ${error}`, createdAt: Date.now(), ttlMs: BOOK_CREATE_TTL_MS });
        ctx.broadcast("book:error", { bookId, error: `管道初始化失败: ${error}` });
      }
    })();

    return c.json({ jobId: bookId, status: "queued" }, 202);
  });

  // --- Check creation status ---
  ctx.app.get("/api/v1/books/:id/create-status", async (c) => {
    const id = c.req.param("id");
    const status = bookCreateStatus.get(id);
    if (!status) {
      return c.json({ status: "missing" }, 404);
    }
    const elapsed = Date.now() - status.createdAt;
    const remaining = Math.max(0, BOOK_CREATE_TIMEOUT_MS - elapsed);
    return c.json({
      status: status.status,
      error: status.error,
      phase: status.phase,
      elapsedMs: elapsed,
      remainingMs: remaining,
      createdAt: status.createdAt,
    });
  });

  // --- Delete book ---
  ctx.app.delete("/api/v1/books/:id", async (c) => {
    const id = c.req.param("id");
    const bookDir = ctx.state.bookDir(id);
    try {
      const { rm } = await import("node:fs/promises");
      await rm(bookDir, { recursive: true, force: true });
      ctx.broadcast("book:deleted", { bookId: id });
      return c.json({ ok: true, bookId: id });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Update book ---
  ctx.app.put("/api/v1/books/:id", async (c) => {
    const id = c.req.param("id");
    const updates = await c.req.json<{
      chapterWordCount?: number; targetChapters?: number; status?: string;
      language?: string; volumeCount?: number; currentVolume?: number;
      keywords?: string[]; targetAudience?: string; serializationStatus?: string;
    }>();
    try {
      const book = await ctx.state.loadBookConfig(id);
      const updated = {
        ...book,
        ...(updates.chapterWordCount !== undefined ? { chapterWordCount: Number(updates.chapterWordCount) } : {}),
        ...(updates.targetChapters !== undefined ? { targetChapters: Number(updates.targetChapters) } : {}),
        ...(updates.status !== undefined ? { status: updates.status as typeof book.status } : {}),
        ...(updates.language !== undefined ? { language: updates.language as "zh" | "en" } : {}),
        ...(updates.volumeCount !== undefined ? { volumeCount: Number(updates.volumeCount) } : {}),
        ...(updates.currentVolume !== undefined ? { currentVolume: Number(updates.currentVolume) } : {}),
        ...(updates.keywords !== undefined ? { keywords: updates.keywords } : {}),
        ...(updates.targetAudience !== undefined ? { targetAudience: updates.targetAudience } : {}),
        ...(updates.serializationStatus !== undefined ? { serializationStatus: updates.serializationStatus as "draft" | "serializing" | "completed" | "hiatus" } : {}),
        updatedAt: new Date().toISOString(),
      };
      await ctx.state.saveBookConfig(id, updated);
      return c.json({ ok: true, book: updated });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Legacy config patch ---
  ctx.app.patch("/api/v1/books/:id/config", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(ctx.state, id);
    const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));

    try {
      const book = await ctx.state.loadBookConfig(id);
      const updated: BookConfig = {
        ...book,
        ...(cleanStringArray(body.keywords) !== undefined ? { keywords: cleanStringArray(body.keywords) } : {}),
        ...(cleanNumber(body.chapterWordCount) !== undefined ? { chapterWordCount: cleanNumber(body.chapterWordCount) } : {}),
        ...(cleanNumber(body.targetChapters) !== undefined ? { targetChapters: cleanNumber(body.targetChapters) } : {}),
        ...(cleanNumber(body.volumeCount) !== undefined ? { volumeCount: cleanNumber(body.volumeCount) } : {}),
        ...(cleanNumber(body.currentVolume) !== undefined ? { currentVolume: cleanNumber(body.currentVolume) } : {}),
        ...(cleanString(body.targetAudience) !== undefined ? { targetAudience: cleanString(body.targetAudience) } : {}),
        ...(typeof body.serializationStatus === "string" && ["draft", "serializing", "completed", "hiatus"].includes(body.serializationStatus)
          ? { serializationStatus: body.serializationStatus as "draft" | "serializing" | "completed" | "hiatus" }
          : {}),
        ...(cleanStringArray(body.genreTags) !== undefined ? { genreTags: cleanStringArray(body.genreTags) } : {}),
        ...(cleanStringArray(body.contentWarnings) !== undefined ? { contentWarnings: cleanStringArray(body.contentWarnings) } : {}),
      };
      await ctx.state.saveBookConfig(id, updated);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "Failed to update config" }, 500);
    }
  });
}
