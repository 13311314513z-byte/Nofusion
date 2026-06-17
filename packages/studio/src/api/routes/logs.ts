import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { ServerContext } from "../server-context.js";

/**
 * Log viewer route — returns the last 100 log entries from inkos.log.
 */
export function registerLogsRoutes(ctx: ServerContext): void {
  ctx.app.get("/api/v1/logs", async (c) => {
    const logPath = join(ctx.root, "inkos.log");
    try {
      const content = await readFile(logPath, "utf-8");
      const lines = content.trim().split("\n").slice(-100);
      const entries = lines.map((line) => {
        try { return JSON.parse(line); } catch { return { message: line }; }
      });
      return c.json({ entries });
    } catch {
      return c.json({ entries: [] });
    }
  });
}
