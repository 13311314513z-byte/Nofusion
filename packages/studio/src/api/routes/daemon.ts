import { Scheduler } from "@actalk/inkos-core";
import type { ServerContext } from "../server-context.js";

/**
 * Daemon control routes.
 * GET  /api/v1/daemon       — check daemon status
 * POST /api/v1/daemon/start — start the background scheduler
 * POST /api/v1/daemon/stop  — stop the background scheduler
 */
export function registerDaemonRoutes(ctx: ServerContext): void {
  ctx.app.get("/api/v1/daemon", (c) => {
    return c.json({
      running: ctx.schedulerInstance.current?.isRunning ?? false,
    });
  });

  ctx.app.post("/api/v1/daemon/start", async (c) => {
    if (ctx.schedulerInstance.current?.isRunning) {
      return c.json({ error: "Daemon already running" }, 400);
    }
    try {
      const currentConfig = await ctx.loadCurrentProjectConfig();
      const pipelineConfig = await ctx.buildPipelineConfig() as Record<string, unknown>;
      const scheduler = new Scheduler({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(pipelineConfig as any),
        radarCron: currentConfig.daemon.schedule.radarCron,
        writeCron: currentConfig.daemon.schedule.writeCron,
        maxConcurrentBooks: currentConfig.daemon.maxConcurrentBooks,
        chaptersPerCycle: currentConfig.daemon.chaptersPerCycle,
        retryDelayMs: currentConfig.daemon.retryDelayMs,
        cooldownAfterChapterMs: currentConfig.daemon.cooldownAfterChapterMs,
        maxChaptersPerDay: currentConfig.daemon.maxChaptersPerDay,
        onChapterComplete: (bookId: string, chapter: number, status: string) => {
          ctx.broadcast("daemon:chapter", { bookId, chapter, status });
        },
        onError: (bookId: string, error: Error) => {
          ctx.broadcast("daemon:error", { bookId, error: error.message });
        },
      });
      ctx.schedulerInstance.current = scheduler;
      ctx.broadcast("daemon:started", {});
      void scheduler.start().catch((e: unknown) => {
        const error = e instanceof Error ? e : new Error(String(e));
        if (ctx.schedulerInstance.current === scheduler) {
          scheduler.stop();
          ctx.schedulerInstance.current = null;
          ctx.broadcast("daemon:stopped", {});
        }
        ctx.broadcast("daemon:error", { bookId: "scheduler", error: error.message });
      });
      return c.json({ ok: true, running: true });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  ctx.app.post("/api/v1/daemon/stop", (c) => {
    if (!ctx.schedulerInstance.current?.isRunning) {
      return c.json({ error: "Daemon not running" }, 400);
    }
    ctx.schedulerInstance.current.stop();
    ctx.schedulerInstance.current = null;
    ctx.broadcast("daemon:stopped", {});
    return c.json({ ok: true, running: false });
  });
}
