import { mkdir,readFile,readdir,writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ApiError } from "../errors.js";
import type { ServerContext } from "../server-context.js";
import { withPipeline } from "../shared/pipeline.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function assertBookExists(state: ServerContext["state"], id: string): Promise<void> {
  try {
    await state.loadBookConfig(id);
  } catch {
    throw new ApiError(404, "BOOK_NOT_FOUND", `Book not found: ${id}`);
  }
}

function radarTimestampForFilename(ts: string): string {
  return ts.replace(/[:.]/g, "-").replace(/\s/g, "_").slice(0, 30);
}

async function saveRadarScan(root: string, result: unknown): Promise<string> {
  const radarDir = join(root, "radar");
  await mkdir(radarDir, { recursive: true });
  const timestamp = typeof result === "object" && result !== null && "timestamp" in result
    ? String((result as { timestamp?: unknown }).timestamp ?? "")
    : "";
  const fileName = `scan-${radarTimestampForFilename(timestamp)}.json`;
  const filePath = join(radarDir, fileName);
  await writeFile(filePath, JSON.stringify(result, null, 2), "utf-8");
  return filePath;
}

async function loadRadarHistory(root: string): Promise<Array<{
  readonly file: string;
  readonly timestamp: string;
  readonly marketSummary: string;
  readonly summaryPreview: string;
  readonly result: unknown;
}>> {
  const radarDir = join(root, "radar");
  let files: string[] = [];
  try {
    files = await readdir(radarDir);
  } catch {
    return [];
  }

  const scans = await Promise.all(
    files
      .filter((file) => /^scan-.+\.json$/.test(file))
      .map(async (file) => {
        const filePath = join(radarDir, file);
        try {
          const raw = await readFile(filePath, "utf-8");
          const result = JSON.parse(raw);
          const timestamp = typeof result === "object" && result !== null && "timestamp" in result
            ? String((result as { timestamp?: unknown }).timestamp ?? "")
            : "";
          const marketSummary = typeof result === "object" && result !== null && "marketSummary" in result
            ? String((result as { marketSummary?: unknown }).marketSummary ?? "")
            : "";
          const summaryPreview = marketSummary.slice(0, 120);
          return { file, timestamp, marketSummary, summaryPreview, result };
        } catch {
          return null;
        }
      }),
  );

  return scans.filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

// ─── Route Registration ──────────────────────────────────────────────────────

export function registerFanficRadarDoctorRoutes(ctx: ServerContext): void {
  const { app, state, root, broadcast, buildPipelineConfig, loadCurrentProjectConfig, probeServiceCapabilities } = ctx;

  // POST /api/v1/fanfic/init
  app.post("/api/v1/fanfic/init", async (c) => {
    const body = await c.req.json<{
      title: string; sourceText: string; sourceName?: string;
      mode?: string; genre?: string; platform?: string;
      targetChapters?: number; chapterWordCount?: number; language?: string;
    }>();
    if (!body.title || !body.sourceText) {
      return c.json({ error: "title and sourceText are required" }, 400);
    }

    const now = new Date().toISOString();
    const bookId = body.title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "-").replace(/-+/g, "-").slice(0, 30);

    const bookConfig = {
      id: bookId,
      title: body.title,
      platform: (body.platform ?? "other") as "other",
      genre: (body.genre ?? "other") as "xuanhuan",
      status: "outlining" as const,
      targetChapters: body.targetChapters ?? 100,
      chapterWordCount: body.chapterWordCount ?? 3000,
      fanficMode: (body.mode ?? "canon") as "canon",
      ...(body.language ? { language: body.language as "zh" | "en" } : {}),
      createdAt: now,
      updatedAt: now,
    };

    broadcast("fanfic:start", { bookId, title: body.title });
    try {
      await withPipeline("fanfic-init", await buildPipelineConfig(), async (pipeline) => {
        await pipeline.initFanficBook(bookConfig, body.sourceText, body.sourceName ?? "source", (body.mode ?? "canon") as "canon");
      });
      broadcast("fanfic:complete", { bookId });
      return c.json({ ok: true, bookId });
    } catch (e) {
      broadcast("fanfic:error", { bookId, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // GET /api/v1/books/:id/fanfic
  app.get("/api/v1/books/:id/fanfic", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    const bookDir = state.bookDir(id);
    try {
      const content = await readFile(join(bookDir, "story", "fanfic_canon.md"), "utf-8");
      return c.json({ bookId: id, content });
    } catch {
      return c.json({ bookId: id, content: null });
    }
  });

  // POST /api/v1/books/:id/fanfic/refresh
  app.post("/api/v1/books/:id/fanfic/refresh", async (c) => {
    const id = c.req.param("id");
    const { sourceText, sourceName } = await c.req.json<{ sourceText: string; sourceName?: string }>();
    if (!sourceText?.trim()) return c.json({ error: "sourceText is required" }, 400);

    broadcast("fanfic:refresh:start", { bookId: id });
    try {
      const book = await state.loadBookConfig(id);
      await withPipeline("fanfic-import-canon", await buildPipelineConfig(), async (pipeline) => {
        await pipeline.importFanficCanon(id, sourceText, sourceName ?? "source", (book.fanficMode ?? "canon") as "canon");
      });
      broadcast("fanfic:refresh:complete", { bookId: id });
      return c.json({ ok: true });
    } catch (e) {
      broadcast("fanfic:refresh:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // POST /api/v1/radar/scan
  app.post("/api/v1/radar/scan", async (c) => {
    broadcast("radar:start", {});
    try {
      const result = await withPipeline("radar-scan", await buildPipelineConfig(), async (pipeline) => {
        const r = await pipeline.runRadar();
        await saveRadarScan(root, r);
        return r;
      });
      broadcast("radar:complete", { result });
      return c.json(result);
    } catch (e) {
      broadcast("radar:error", { error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // GET /api/v1/radar/history
  app.get("/api/v1/radar/history", async (c) => {
    try {
      const items = await loadRadarHistory(root);
      return c.json({ items });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // GET /api/v1/doctor
  app.get("/api/v1/doctor", async (c) => {
    const { existsSync } = await import("node:fs");
    const { GLOBAL_ENV_PATH } = await import("@actalk/inkos-core");

    const checks = {
      inkosJson: existsSync(join(root, "inkos.json")),
      projectEnv: existsSync(join(root, ".env")),
      globalEnv: existsSync(GLOBAL_ENV_PATH),
      booksDir: existsSync(join(root, "books")),
      llmConnected: false,
      bookCount: 0,
    };

    try {
      const books = await state.listBooks();
      checks.bookCount = books.length;
    } catch { /* ignore */ }

    try {
      const currentConfig = await loadCurrentProjectConfig({ requireApiKey: false });
      const service = currentConfig.llm.service ?? currentConfig.llm.provider;
      const probe = await probeServiceCapabilities({
        root,
        service,
        apiKey: currentConfig.llm.apiKey,
        baseUrl: currentConfig.llm.baseUrl,
        preferredApiFormat: currentConfig.llm.apiFormat,
        preferredStream: currentConfig.llm.stream,
        preferredModel: currentConfig.llm.model,
        proxyUrl: currentConfig.llm.proxyUrl,
      });
      checks.llmConnected = probe.ok;
    } catch { /* ignore */ }

    return c.json(checks);
  });
}
