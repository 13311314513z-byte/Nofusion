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
      type DedupeFinding = Parameters<typeof buildDedupePrompt>[1][number];
      type DedupeMode = Parameters<typeof buildDedupePrompt>[2];
      let findings: ReadonlyArray<DedupeFinding> | undefined;
      if (Array.isArray(raw.findings)) {
        findings = raw.findings.filter((finding): finding is DedupeFinding => {
          if (!finding || typeof finding !== "object") return false;
          const record = finding as Record<string, unknown>;
          return typeof record.category === "string"
            && typeof record.id === "string"
            && typeof record.label === "string"
            && typeof record.count === "number"
            && typeof record.perThousandChars === "number"
            && typeof record.severity === "string"
            && typeof record.confidence === "number"
            && Array.isArray(record.examples)
            && Array.isArray(record.ranges);
        });
      } else if (Array.isArray(raw.categories) && raw.categories.length) {
        findings = raw.categories.map((cat): DedupeFinding => ({
          id: `manual-${cat}`,
          category: cat as DedupeFinding["category"],
          label: cat,
          count: 0,
          perThousandChars: 0,
          severity: "low" as const,
          confidence: 1,
          examples: [] as Array<{ text: string; lineNumber: number }>,
          ranges: [],
        }));
      } else {
        const detected = detectDuplicateRhetoric(raw.text, "zh");
        findings = detected?.findings;
      }
      if (!Array.isArray(findings)) return c.json({ error: "findings must be an array" }, 400);
      const mode: DedupeMode = raw.mode === "delete" || raw.mode === "redistribute" ? raw.mode : "replace";
      const prompt = buildDedupePrompt(raw.text, findings, mode);
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
