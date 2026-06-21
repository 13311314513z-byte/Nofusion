/**
 * Style Quality routes — paragraph dedup + readability score.
 * Extracted from style.ts (D11).
 */
import type { ServerContext } from "../server-context.js";

export function registerStyleQualityRoutes(ctx: ServerContext): void {
  const { app } = ctx;

  app.post("/api/v1/style/paragraph/dedup", async (c) => {
    const raw = await c.req.json<{ text: string; threshold?: number; minLength?: number }>();
    if (!raw.text?.trim()) return c.json({ error: "text is required" }, 400);
    const threshold = typeof raw.threshold === "number" && raw.threshold >= 0 && raw.threshold <= 1 ? raw.threshold : 0.8;
    const minLength = typeof raw.minLength === "number" && Number.isFinite(raw.minLength) && raw.minLength >= 1 ? Math.floor(raw.minLength) : 20;
    try {
      const { detectDuplicateParagraphs } = await import("@actalk/inkos-core");
      const result = detectDuplicateParagraphs(raw.text, { similarityThreshold: threshold, minParagraphLength: minLength });
      return c.json(result);
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.post("/api/v1/style/readability/score", async (c) => {
    const raw = await c.req.json<{ text: string; language?: string }>();
    if (!raw.text?.trim()) return c.json({ error: "text is required" }, 400);
    try {
      const { computeReadabilityScore } = await import("@actalk/inkos-core");
      return c.json(computeReadabilityScore(raw.text));
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });
}
