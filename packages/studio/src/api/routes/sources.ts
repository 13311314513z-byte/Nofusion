import { listFoundationSources, archiveFoundationSource, buildFoundationSourceBundle, persistFoundationSourceBundle, isDocumentFileType, isFoundationSourcePurpose } from "@actalk/inkos-core";
import type { ServerContext } from "../server-context.js";

/**
 * Foundation sources routes for a book.
 * GET    /api/v1/books/:id/sources            — list sources
 * POST   /api/v1/books/:id/sources            — add a new source
 * DELETE /api/v1/books/:id/sources/:sourceId  — archive a source
 */
export function registerSourcesRoutes(ctx: ServerContext): void {
  ctx.app.get("/api/v1/books/:id/sources", async (c) => {
    const id = c.req.param("id");
    try {
      const sources = await listFoundationSources(ctx.state.bookDir(id));
      return c.json({ sources });
    } catch (error) {
      return c.json({ error: `Failed to list sources for "${id}": ${String(error)}` }, 500);
    }
  });

  ctx.app.post("/api/v1/books/:id/sources", async (c) => {
    const id = c.req.param("id");
    let bodyJson: Record<string, unknown> | null = null;
    try {
      bodyJson = await c.req.json<Record<string, unknown>>();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (!bodyJson) return c.json({ error: "Invalid JSON body" }, 400);
    const sourceName = typeof bodyJson.sourceName === "string" ? bodyJson.sourceName : "";
    const text = typeof bodyJson.text === "string" ? bodyJson.text : "";
    const fileType = typeof bodyJson.fileType === "string" ? bodyJson.fileType : "txt";
    const purpose = typeof bodyJson.purpose === "string" ? bodyJson.purpose : "auto";
    if (!sourceName.trim() || !text.trim()) {
      return c.json({ error: "sourceName and text are required" }, 400);
    }
    if (!isDocumentFileType(fileType)) {
      return c.json({ error: `Unsupported file type: ${fileType}` }, 400);
    }
    if (!isFoundationSourcePurpose(purpose)) {
      return c.json({ error: `Unsupported purpose: ${purpose}` }, 400);
    }
    const release = await ctx.state.acquireBookLock(id);
    try {
      const sourceBundle = buildFoundationSourceBundle([{
        sourceName: sourceName.trim(),
        fileType,
        text,
        purpose,
      }]);
      await persistFoundationSourceBundle(ctx.state.bookDir(id), sourceBundle, "supplement");
      return c.json({ ok: true, sourceName: sourceName.trim() });
    } catch (error) {
      return c.json({ error: String(error) }, 500);
    } finally {
      await release();
    }
  });

  ctx.app.delete("/api/v1/books/:id/sources/:sourceId", async (c) => {
    const id = c.req.param("id");
    const sourceId = c.req.param("sourceId");
    const release = await ctx.state.acquireBookLock(id);
    try {
      const archived = await archiveFoundationSource(ctx.state.bookDir(id), sourceId);
      if (!archived) {
        return c.json({ error: "Source not found" }, 404);
      }
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ error: `Failed to archive source: ${String(error)}` }, 500);
    } finally {
      await release();
    }
  });
}
