import { isAbsolute, resolve, relative, join } from "node:path";
import { readFile, readdir, lstat, writeFile, mkdir, access } from "node:fs/promises";
import type { ServerContext } from "../server-context.js";
import { ApiError } from "../errors.js";

// ─── Constants (moved from server.ts) ────────────────────────────────────────

const TRUTH_FLAT_FILES = [
  "author_intent.md", "current_focus.md",
  "story_bible.md", "book_rules.md", "volume_outline.md", "current_state.md",
  "particle_ledger.md", "pending_hooks.md", "chapter_summaries.md",
  "subplot_board.md", "emotional_arcs.md", "character_matrix.md",
  "style_guide.md", "parent_canon.md", "fanfic_canon.md",
];

const TRUTH_OUTLINE_FILES = [
  "outline/story_frame.md",
  "outline/volume_map.md",
  "outline/节奏原则.md",
  "outline/rhythm_principles.md",
];

const LEGACY_SHIM_FILES = new Set(["story_bible.md", "book_rules.md"]);

const MAX_RUNTIME_FILE_BYTES = 1024 * 1024;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function assertBookDirectoryExists(state: ServerContext["state"], id: string): Promise<void> {
  try {
    const info = await lstat(state.bookDir(id));
    if (!info.isDirectory()) {
      throw new Error("not a directory");
    }
  } catch {
    throw new ApiError(404, "BOOK_NOT_FOUND", `Book not found: ${id}`);
  }
}

function resolveTruthFilePath(bookDir: string, file: string): string | null {
  if (!file || file.includes("\0") || isAbsolute(file) || file.includes("..")) {
    return null;
  }
  const allowed =
    TRUTH_FLAT_FILES.includes(file)
    || TRUTH_OUTLINE_FILES.includes(file)
    || /^roles\/(核心角色|主要角色|重要角色|次要角色|功能角色|core|major|minor|functional)\/[^/]+\.md$/.test(file);
  if (!allowed) return null;

  const storyDir = resolve(bookDir, "story");
  const resolved = resolve(storyDir, file);
  const relativePath = relative(storyDir, resolved);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return null;
  }
  return resolved;
}

function resolveRuntimeFilePath(bookDir: string, file: string): string | null {
  if (!file || file.includes("\0") || isAbsolute(file) || file.includes("..")) {
    return null;
  }
  const runtimeDir = resolve(bookDir, "story", "runtime");
  const resolved = resolve(runtimeDir, file);
  const relativePath = relative(runtimeDir, resolved);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return null;
  }
  return resolved;
}

// ─── Route Registration ──────────────────────────────────────────────────────

export function registerRuntimeTruthRoutes(ctx: ServerContext): void {
  const { app, state } = ctx;

  // GET /api/v1/books/:id/truth/:file{.+}
  app.get("/api/v1/books/:id/truth/:file{.+}", async (c) => {
    const file = c.req.param("file");
    const id = c.req.param("id");
    await assertBookDirectoryExists(state, id);

    const bookDir = state.bookDir(id);
    const resolved = resolveTruthFilePath(bookDir, file);
    if (!resolved) {
      return c.json({ error: "Invalid truth file" }, 400);
    }

    const { isNewLayoutBook } = await import("@actalk/inkos-core");
    const legacy = LEGACY_SHIM_FILES.has(file) && await isNewLayoutBook(bookDir);

    try {
      const content = await readFile(resolved, "utf-8");
      return c.json({ file, content, ...(legacy ? { legacy: true } : {}) });
    } catch {
      return c.json({ file, content: null, ...(legacy ? { legacy: true } : {}) });
    }
  });

  // GET /api/v1/books/:id/runtime
  app.get("/api/v1/books/:id/runtime", async (c) => {
    const id = c.req.param("id");
    const bookDir = state.bookDir(id);
    const runtimeDir = resolve(bookDir, "story", "runtime");
    const files: Array<{ readonly name: string; readonly path: string; readonly size: number; readonly isDirectory: boolean }> = [];

    async function walk(dir: string, prefix = ""): Promise<void> {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => [] as import("fs").Dirent[]);
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        const fullPath = resolve(dir, entry.name);
        const relativePath = relative(runtimeDir, fullPath);
        if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
          continue;
        }
        const info = await lstat(fullPath).catch(() => null);
        if (info?.isSymbolicLink()) continue;
        files.push({
          name: entry.name,
          path: relPath,
          size: info?.size ?? 0,
          isDirectory: entry.isDirectory(),
        });
        if (entry.isDirectory()) {
          await walk(fullPath, relPath);
        }
      }
    }

    await walk(runtimeDir);
    return c.json({ files });
  });

  // GET /api/v1/books/:id/runtime/:file{.+}
  app.get("/api/v1/books/:id/runtime/:file{.+}", async (c) => {
    const id = c.req.param("id");
    const file = c.req.param("file");
    const bookDir = state.bookDir(id);
    const resolved = resolveRuntimeFilePath(bookDir, file);
    if (!resolved) {
      return c.json({ error: "Invalid runtime file" }, 400);
    }

    try {
      const info = await lstat(resolved);
      if (info.isSymbolicLink()) return c.json({ error: "Runtime symlinks are not supported" }, 400);
      if (info.isDirectory()) return c.json({ error: "Runtime path is a directory" }, 400);
      if (info.size > MAX_RUNTIME_FILE_BYTES) {
        return c.json({ error: "Runtime file is too large to preview" }, 413);
      }
      const content = await readFile(resolved, "utf-8");
      return c.json({ file, content });
    } catch {
      return c.json({ error: "Runtime file not found" }, 404);
    }
  });

  // PUT /api/v1/books/:id/truth/:file{.+}
  app.put("/api/v1/books/:id/truth/:file{.+}", async (c) => {
    const id = c.req.param("id");
    await assertBookDirectoryExists(state, id);
    const file = c.req.param("file");
    const body: { content?: unknown } = await c.req.json<{ content?: unknown }>().catch(() => ({}));
    if (typeof body.content !== "string") {
      return c.json({ error: "content must be a string" }, 400);
    }

    const bookDir = state.bookDir(id);
    const resolved = resolveTruthFilePath(bookDir, file);
    if (!resolved) {
      return c.json({ error: "Invalid truth file" }, 400);
    }
    if (LEGACY_SHIM_FILES.has(file)) {
      const { isNewLayoutBook } = await import("@actalk/inkos-core");
      if (await isNewLayoutBook(bookDir)) {
        return c.json(
          { error: "Read-only compatibility shim", authoritativePath: "outline/story_frame.md" },
          409,
        );
      }
    }
    const { dirname } = await import("node:path");
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, body.content, "utf-8");
    return c.json({ ok: true, file, size: body.content.length });
  });

  // GET /api/v1/books/:id/state-changelog
  app.get("/api/v1/books/:id/state-changelog", async (c) => {
    const id = c.req.param("id");
    const limit = Math.min(Math.max(Number(c.req.query("limit")) || 50, 1), 200);
    await assertBookDirectoryExists(state, id);
    try {
      const bookDir = state.bookDir(id);
      const changelogPath = join(bookDir, "story", "state", "state_changelog.jsonl");
      let entries: unknown[] = [];
      try {
        const raw = await readFile(changelogPath, "utf-8");
        entries = raw.trim().split("\n").slice(-limit).map(line => {
          try { return JSON.parse(line); } catch { return { raw: line }; }
        });
      } catch { /* no changelog yet */ }
      return c.json({ bookId: id, entries, totalEntries: entries.length });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });
}
