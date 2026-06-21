/**
 * Rhetoric deduplication routes — extracted from style.ts (B4).
 */
import type { ServerContext } from "../server-context.js";

export function registerRhetoricRoutes(ctx: ServerContext): void {
  const { app } = ctx;

  app.post("/api/v1/style/rhetoric/rewrite", async (c) => {
    const raw = await c.req.json<{ text: string; findings?: unknown[]; categories?: string[]; mode?: string }>();
    if (!raw.text?.trim()) return c.json({ error: "text is required" }, 400);
    try {
      const { buildDedupePrompt, detectDuplicateRhetoric } = await import("@actalk/inkos-core");
      let findings: unknown[] | undefined;
      if (Array.isArray(raw.findings)) {
        findings = raw.findings;
      } else if (Array.isArray(raw.categories) && raw.categories.length) {
        findings = raw.categories.map((cat) => ({
          category: cat, label: cat, count: 0, perThousandChars: 0,
          severity: "low" as const, examples: [] as Array<{ text: string }>,
        }));
      } else {
        const detected = detectDuplicateRhetoric(raw.text, "zh");
        findings = detected?.findings as unknown[] | undefined;
      }
      if (!Array.isArray(findings)) return c.json({ error: "findings must be an array" }, 400);
      const prompt = buildDedupePrompt(raw.text, findings as any[], (raw.mode ?? "replace") as any);
      return c.json({ prompt });
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.post("/api/v1/style/rhetoric/detect", async (c) => {
    const raw = await c.req.json<{ text: string; language?: string }>();
    if (!raw.text?.trim()) return c.json({ error: "text is required" }, 400);
    try {
      const { detectDuplicateRhetoric } = await import("@actalk/inkos-core");
      const language = raw.language === "en" ? "en" as const : "zh" as const;
      const result = detectDuplicateRhetoric(raw.text, language);
      const findings = Array.isArray(result?.findings) ? result.findings : [];
      return c.json({ findings });
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.post("/api/v1/style/rhetoric/aware-prompt", async (c) => {
    const raw = await c.req.json<{ basePrompt: string; contextText: string; maxPerThousandChars?: Record<string, number> }>();
    if (!raw.basePrompt || !raw.contextText) return c.json({ error: "basePrompt and contextText are required" }, 400);
    try {
      const { buildRhetoricAwarePrompt } = await import("@actalk/inkos-core");
      const prompt = buildRhetoricAwarePrompt(raw.basePrompt, raw.contextText, raw.maxPerThousandChars);
      return c.json({ prompt });
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });
}
