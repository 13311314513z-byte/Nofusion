/**
 * Event Chain routes — extracted from style.ts (B4).
 */
import { join } from "node:path";
import type { ServerContext } from "../server-context.js";

export function registerEventChainRoutes(ctx: ServerContext): void {
  const { app, state: stateManager } = ctx;

  async function assertBookExists(state: ServerContext["state"], bookId: string): Promise<void> {
    try { await state.loadBookConfig(bookId); }
    catch { throw new Error(`Book not found: ${bookId}`); }
  }

  app.get("/api/v1/books/:id/event-chain", async (c) => {
    const id = c.req.param("id");
    const chapterNumber = Number(c.req.query("chapter"));
    await assertBookExists(ctx.state, id);
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    try {
      const bookDir = stateManager.bookDir(id);
      const { readArtifactIndex: _readArtifactIndex, readLatestArtifact } = await import("@actalk/inkos-core");
      const artifactDir = join(bookDir, "story", "runtime", `chapter-${String(chapterNumber).padStart(4, "0")}`);
      const latest = await readLatestArtifact(artifactDir, "event-chain");
      if (!latest) {
        return c.json({ chain: null, message: "No event chain generated yet. Use POST to extract." });
      }
      const chain = JSON.parse(latest.content);
      return c.json({ chain });
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.post("/api/v1/books/:id/event-chain/extract", async (c) => {
    const id = c.req.param("id");
    const chapterNumber = Number(c.req.query("chapter"));
    await assertBookExists(ctx.state, id);
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    try {
      const bookDir = stateManager.bookDir(id);
      const { readFile, readdir: rd } = await import("node:fs/promises");
      const { join: j } = await import("node:path");
      const { saveArtifactAutoVersion, EventChainExtractor } = await import("@actalk/inkos-core");

      const sourcesDir = j(bookDir, "story", "sources");
      const sourceFiles: Array<{ path: string; content: string; frontmatter: Record<string, unknown> }> = [];
      try {
        const files = await rd(sourcesDir);
        for (const file of files) {
          if (!file.endsWith(".md")) continue;
          const raw = await readFile(j(sourcesDir, file), "utf-8");
          const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
          const frontmatter: Record<string, unknown> = {};
          if (fmMatch) {
            for (const line of fmMatch[1].split("\n")) {
              const [k, ...v] = line.split(":");
              if (k && v.length > 0) frontmatter[k.trim()] = v.join(":").trim();
            }
          }
          const body = fmMatch ? raw.slice(fmMatch[0].length) : raw;
          sourceFiles.push({ path: file, content: body, frontmatter });
        }
      } catch { /* no sources dir */ }

      const characterDir = j(bookDir, "story", "characters");
      const characters: Array<{ id: string; name: string; traits?: string[] }> = [];
      try {
        const charFiles = await rd(characterDir);
        for (const file of charFiles) {
          if (!file.endsWith(".json")) continue;
          const charRaw = await readFile(j(characterDir, file), "utf-8");
          const charData = JSON.parse(charRaw) as { id?: string; name?: string; traits?: string[] };
          if (charData.id && charData.name) {
            characters.push({ id: charData.id, name: charData.name, traits: charData.traits });
          }
        }
      } catch { /* no characters dir */ }

      const extractor = new EventChainExtractor({} as never);
      const result = await extractor.execute({
        sources: sourceFiles.map((src) => ({
          path: src.path, content: src.content, frontmatter: src.frontmatter,
        })),
        chapterNumber,
        characters,
        useLlm: false,
      });

      const chain = {
        bookId: id, chapterNumber,
        events: result.events,
        generatedAt: new Date().toISOString(),
        confidence: result.confidence,
        warnings: result.warnings,
      };
      const artifactDir = j(bookDir, "story", "runtime", `chapter-${String(chapterNumber).padStart(4, "0")}`);
      await saveArtifactAutoVersion(artifactDir, "event-chain", JSON.stringify(chain, null, 2));

      return c.json({ chain });
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });
}
