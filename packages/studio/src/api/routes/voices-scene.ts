import { join } from "node:path";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import type { ServerContext } from "../server-context.js";
import { ApiError } from "../errors.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function assertBookExists(state: ServerContext["state"], id: string): Promise<void> {
  try {
    await state.loadBookConfig(id);
  } catch {
    throw new ApiError(404, "BOOK_NOT_FOUND", `Book not found: ${id}`);
  }
}

// P1-12: Cache compiled regex patterns keyed by escaped name
const dialogueRegexCache = new Map<string, ReadonlyArray<RegExp>>();

function getCachedDialogueRegex(escaped: string): ReadonlyArray<RegExp> {
  const cached = dialogueRegexCache.get(escaped);
  if (cached) return cached;
  const patterns = [
    new RegExp(`${escaped}[：:"：]\\s*["「](.+?)["」]`, "g"),
    new RegExp(`["「]${escaped}(.+?)["」]`, "g"),
    new RegExp(`${escaped}[说问道喊叫嚷叹答]\\s*[：:"：]\\s*(.+?)(?:[。！？!?]|$)`, "g"),
  ];
  if (dialogueRegexCache.size > 100) {
    dialogueRegexCache.delete(dialogueRegexCache.keys().next().value!);
  }
  dialogueRegexCache.set(escaped, patterns);
  return patterns;
}

function extractCharacterDialogue(content: string, characterId: string, characterName: string): string[] {
  const lines: string[] = [];
  const names = [characterName, characterId].filter(Boolean);
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const regex of getCachedDialogueRegex(escaped)) {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const dialogue = match[1]!.trim();
        if (dialogue.length > 1 && dialogue.length < 200) {
          lines.push(dialogue);
        }
      }
    }
  }
  return [...new Set(lines)].slice(0, 50);
}

// ─── Route Registration ──────────────────────────────────────────────────────

export function registerVoicesSceneRoutes(ctx: ServerContext): void {
  const { app, state, root } = ctx;

  // GET /api/v1/books/:id/scene-templates
  app.get("/api/v1/books/:id/scene-templates", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    try {
      const bookDir = state.bookDir(id);
      const path = join(bookDir, "story", "sources", "scene_templates.json");
      const raw = await readFile(path, "utf-8").catch(() => '{"templates":[]}');
      return c.json(JSON.parse(raw));
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // PUT /api/v1/books/:id/scene-templates
  app.put("/api/v1/books/:id/scene-templates", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    try {
      const bookDir = state.bookDir(id);
      const { SceneTemplateIndexSchema } = await import("@actalk/inkos-core");
      const body = await c.req.json();
      const validated = SceneTemplateIndexSchema.parse(body);
      const dir = join(bookDir, "story", "sources");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "scene_templates.json"), JSON.stringify(validated, null, 2), "utf-8");
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: String(e) }, e instanceof SyntaxError || (e as Record<string, unknown>).issues ? 400 : 500);
    }
  });

  // GET /api/v1/books/:id/voice-profiles
  app.get("/api/v1/books/:id/voice-profiles", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    try {
      const bookDir = state.bookDir(id);
      const profilesDir = join(bookDir, "story", "voice_profiles");
      const profiles: unknown[] = [];
      try {
        const files = await readdir(profilesDir);
        for (const file of files) {
          if (!file.endsWith(".json") || file === "index.json") continue;
          try {
            const raw = await readFile(join(profilesDir, file), "utf-8");
            profiles.push(JSON.parse(raw));
          } catch { /* skip unreadable files */ }
        }
      } catch { /* directory doesn't exist yet */ }

      const availableCharacters: Array<{ id: string; name: string }> = [];
      if (profiles.length === 0) {
        try {
          const rolesDir = join(bookDir, "story", "roles");
          const roleFiles = (await readdir(rolesDir)).filter(f => f.endsWith(".md"));
          for (const file of roleFiles) {
            try {
              const raw = await readFile(join(rolesDir, file), "utf-8");
              const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
              if (fmMatch) {
                const fm = fmMatch[1];
                const nameMatch = fm.match(/^name:\s*(.+)/m);
                const idMatch = fm.match(/^id:\s*(.+)/m) || [undefined, file.replace(/\.md$/, "")];
                if (nameMatch) {
                  availableCharacters.push({ id: idMatch[1], name: nameMatch[1] });
                }
              }
            } catch { /* skip unreadable role card */ }
          }
        } catch { /* roles dir doesn't exist */ }
      }

      return c.json({ profiles, availableCharacters });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // POST /api/v1/books/:id/voice-profiles/analyze
  app.post("/api/v1/books/:id/voice-profiles/analyze", async (c) => {
    const id = c.req.param("id");
    const characterId = c.req.query("character");
    await assertBookExists(state, id);
    if (!characterId) {
      return c.json({ error: "Missing character parameter" }, 400);
    }
    try {
      const { loadRoleCard } = await import("@actalk/inkos-core");
      const bookDir = state.bookDir(id);
      let characterName = characterId;

      try {
        const card = await loadRoleCard(bookDir, characterId);
        if (card) characterName = card.frontmatter.name;
      } catch {
        // Role card not found — continue with characterId as fallback name
      }

      const chaptersDir = join(bookDir, "chapters");
      const dialogueLines: string[] = [];
      const sourceChapters: number[] = [];
      const MAX_CHAPTERS = 5;

      try {
        const entries = (await readdir(chaptersDir))
          .filter(f => /^\d{4}_/.test(f) && f.endsWith(".md"))
          .sort()
          .slice(-MAX_CHAPTERS);

        for (const entry of entries) {
          const chapterNum = parseInt(entry.slice(0, 4), 10);
          const content = await readFile(join(chaptersDir, entry), "utf-8");
          const lines = extractCharacterDialogue(content, characterId, characterName);
          if (lines.length > 0) {
            dialogueLines.push(...lines);
            sourceChapters.push(chapterNum);
          }
        }
      } catch {
        // No chapters yet — proceed with empty dialogue
      }

      const { VoiceProfileAnalyzer } = await import("@actalk/inkos-core");
      const profile = await new VoiceProfileAnalyzer({
        client: undefined as never,
        model: "none",
        projectRoot: root,
        bookId: id,
      }).analyze({
        characterId,
        characterName,
        dialogueLines,
        sourceChapters,
        useLlm: false,
      });

      const profilesDir = join(bookDir, "story", "voice_profiles");
      await mkdir(profilesDir, { recursive: true });
      await writeFile(
        join(profilesDir, `${characterId}.json`),
        JSON.stringify(profile, null, 2),
        "utf-8",
      );

      return c.json({ profile });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });
}
