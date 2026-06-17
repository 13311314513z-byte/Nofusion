import { join } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { computeAnalytics, listFoundationSources, summarizePendingHookHealth } from "@actalk/inkos-core";
import type { ServerContext } from "../server-context.js";

type Metric<T> =
  | { readonly status: "available"; readonly value: T }
  | { readonly status: "unavailable"; readonly reason: string };

/**
 * Book health check route — audit pass rate, hook risks, import recency, style status.
 */
export function registerHealthRoutes(ctx: ServerContext): void {
  ctx.app.get("/api/v1/books/:id/health", async (c) => {
    const id = c.req.param("id");
    const bookDir = ctx.state.bookDir(id);
    const storyDir = join(bookDir, "story");

    try {
      const chapters = await ctx.state.loadChapterIndexStrict(id);
      const analytics = computeAnalytics(id, chapters);

      let hookRisks: Metric<{ total: number; stale: number; criticalIds: readonly string[] }>;
      try {
        const hooksRaw = await readFile(join(storyDir, "pending_hooks.md"), "utf-8").catch(() => "");
        const currentChapter = chapters.length > 0
          ? Math.max(...chapters.map((ch: { number: number }) => ch.number))
          : 0;
        const summary = summarizePendingHookHealth({ markdown: hooksRaw, chapterNumber: currentChapter });
        hookRisks = {
          status: "available",
          value: { total: summary.total, stale: summary.stale, criticalIds: summary.criticalIds },
        };
      } catch (error) {
        hookRisks = { status: "unavailable", reason: String(error) };
      }

      let recentImports: Metric<number>;
      try {
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const sources = await listFoundationSources(bookDir);
        recentImports = {
          status: "available",
          value: sources.filter((s: { importedAt: string }) => new Date(s.importedAt).getTime() > sevenDaysAgo).length,
        };
      } catch (error) {
        recentImports = { status: "unavailable", reason: String(error) };
      }

      const styleStatus: Metric<"profile-ready"> = await stat(join(storyDir, "style_profile.json"))
        .then(() => ({ status: "available" as const, value: "profile-ready" as const }))
        .catch(() => ({ status: "unavailable" as const, reason: "No style profile" }));

      const pipelineErrors: Metric<number> = {
        status: "unavailable",
        reason: "No durable pipeline error history",
      };

      return c.json({
        auditPassRate: analytics.auditPassRate,
        tokenStats: analytics.tokenStats ?? null,
        hookRisks,
        recentImports,
        styleStatus,
        pipelineErrors,
      });
    } catch (error) {
      return c.json({ error: `Health check failed for "${id}": ${String(error)}` }, 500);
    }
  });
}
