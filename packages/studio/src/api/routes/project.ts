import { join, isAbsolute } from "node:path";
import { readFile } from "node:fs/promises";
import type { ServerContext } from "../server-context.js";
import { ApiError } from "../errors.js";

function resolveProjectImageFile(root: string, rawPath: string): { readonly resolved: string; readonly contentType: string } {
  let relPath: string;
  try {
    relPath = decodeURIComponent(rawPath).replace(/^\/+/u, "");
  } catch {
    throw new ApiError(400, "INVALID_PROJECT_FILE_PATH", "Invalid project file path");
  }

  if (
    !relPath
    || relPath.includes("\0")
    || isAbsolute(relPath)
    || relPath.split(/[\\/]+/u).includes("..")
  ) {
    throw new ApiError(400, "INVALID_PROJECT_FILE_PATH", "Invalid project file path");
  }
  if (!relPath.startsWith("shorts/") && !relPath.startsWith("covers/")) {
    throw new ApiError(400, "INVALID_PROJECT_FILE_PATH", "Only generated shorts/ and covers/ images can be previewed");
  }

  const ext = relPath.split(".").pop()?.toLowerCase() ?? "";
  const contentTypes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  };
  const contentType = contentTypes[ext];
  if (!contentType) {
    throw new ApiError(415, "UNSUPPORTED_PROJECT_FILE_TYPE", "Unsupported image format");
  }

  return { resolved: join(root, relPath), contentType };
}

/**
 * Project info and config routes.
 * GET  /api/v1/project           — current project metadata
 * PUT  /api/v1/project           — update project language/temperature/stream
 * GET  /api/v1/project/files/:file — serve project-level static files
 */
export function registerProjectRoutes(ctx: ServerContext): void {
  ctx.app.get("/api/v1/project", async (c) => {
    const currentConfig = await ctx.loadCurrentProjectConfig({ requireApiKey: false });
    // Check if language was explicitly set in inkos.json (not just the schema default)
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(await readFile(join(ctx.root, "inkos.json"), "utf-8"));
    } catch {
      raw = {};
    }
    const languageExplicit =
      typeof raw === "object" && raw !== null && "language" in raw && raw.language !== "";

    return c.json({
      name: currentConfig.name,
      language: currentConfig.language,
      languageExplicit,
      model: currentConfig.llm.model,
      provider: currentConfig.llm.provider,
      baseUrl: currentConfig.llm.baseUrl,
      stream: currentConfig.llm.stream,
      temperature: currentConfig.llm.temperature,
    });
  });

  ctx.app.get("/api/v1/project/files/:file{.+}", async (c) => {
    const file = resolveProjectImageFile(ctx.root, c.req.param("file"));
    try {
      const content = await readFile(file.resolved);
      return new Response(content, {
        headers: {
          "Content-Type": file.contentType,
          "Cache-Control": "no-store",
        },
      });
    } catch {
      return c.notFound();
    }
  });

  ctx.app.put("/api/v1/project", async (c) => {
    const updates = await c.req.json<Record<string, unknown>>();
    const configPath = join(ctx.root, "inkos.json");
    try {
      const raw = await readFile(configPath, "utf-8");
      if (!raw.trim()) {
        return c.json({ error: "inkos.json is empty — cannot update" }, 400);
      }
      const existing = JSON.parse(raw);
      // Merge LLM settings
      if (updates.temperature !== undefined) {
        existing.llm.temperature = updates.temperature;
      }
      if (updates.stream !== undefined) {
        existing.llm.stream = updates.stream;
      }
      if (updates.language === "zh" || updates.language === "en") {
        existing.language = updates.language;
      }
      const tmpPath = configPath + ".tmp." + Date.now().toString(36);
      const { writeFile: writeFileFs, rename: renameFs } = await import("node:fs/promises");
      await writeFileFs(tmpPath, JSON.stringify(existing, null, 2), "utf-8");
      await renameFs(tmpPath, configPath);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });
}
