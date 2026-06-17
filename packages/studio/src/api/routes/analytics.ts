import { computeAnalytics } from "@actalk/inkos-core";
import type { ServerContext } from "../server-context.js";

/**
 * Book analytics route — chapter stats, word counts, token usage, audit trends.
 */
export function registerAnalyticsRoutes(ctx: ServerContext): void {
  ctx.app.get("/api/v1/books/:id/analytics", async (c) => {
    const id = c.req.param("id");
    try {
      const chapters = await ctx.state.loadChapterIndexStrict(id);
      return c.json(computeAnalytics(id, chapters));
    } catch {
      return c.json({ error: `Book "${id}" not found` }, 404);
    }
  });
}
