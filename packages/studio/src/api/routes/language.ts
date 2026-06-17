import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { ServerContext } from "../server-context.js";

/**
 * Language setup route — update project language in inkos.json.
 */
export function registerLanguageRoutes(ctx: ServerContext): void {
  ctx.app.post("/api/v1/project/language", async (c) => {
    const { language } = await c.req.json<{ language: "zh" | "en" }>();
    const configPath = join(ctx.root, "inkos.json");
    try {
      const raw = await readFile(configPath, "utf-8");
      if (!raw.trim()) {
        return c.json({ error: "inkos.json is empty" }, 400);
      }
      const existing = JSON.parse(raw);
      existing.language = language;
      const tmpPath = configPath + ".tmp." + Date.now().toString(36);
      const { writeFile, rename } = await import("node:fs/promises");
      await writeFile(tmpPath, JSON.stringify(existing, null, 2), "utf-8");
      await rename(tmpPath, configPath);
      return c.json({ ok: true, language });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });
}
