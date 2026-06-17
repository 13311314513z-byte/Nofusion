import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import type { ServerContext } from "../server-context.js";

// Files that are shims when the book uses the new layout
const LEGACY_SHIM_FILES = new Set([
  "story_bible.md",
  "character_bible.md",
  "world_bible.md",
]);

/**
 * Truth files browser — list and browse story/ directory files for a book.
 */
export function registerTruthBrowserRoutes(ctx: ServerContext): void {
  ctx.app.get("/api/v1/books/:id/truth", async (c) => {
    const id = c.req.param("id");
    await assertBookDirectoryExists(ctx.state, id);
    const bookDir = ctx.state.bookDir(id);
    const storyDir = join(bookDir, "story");

    async function listDir(subdir: string): Promise<string[]> {
      try {
        const entries = await readdir(join(storyDir, subdir));
        return entries.filter((f) => f.endsWith(".md") || f.endsWith(".json"));
      } catch {
        return [];
      }
    }

    const { isNewLayoutBook } = await import("@actalk/inkos-core");
    const newLayout = await isNewLayoutBook(bookDir);

    async function describe(relPath: string): Promise<{
      readonly name: string;
      readonly size: number;
      readonly preview: string;
      readonly legacy?: true;
    } | null> {
      try {
        const content = await readFile(join(storyDir, relPath), "utf-8");
        const isShim = LEGACY_SHIM_FILES.has(relPath) && newLayout;
        return isShim
          ? { name: relPath, size: content.length, preview: content.slice(0, 200), legacy: true }
          : { name: relPath, size: content.length, preview: content.slice(0, 200) };
      } catch {
        return null;
      }
    }

    try {
      const flatFiles = (await listDir(".")).filter(
        (f) => !f.startsWith("outline") && !f.startsWith("roles"),
      );
      const outlineFiles = (await listDir("outline")).map((f) => `outline/${f}`);
      const majorRolesZh = (await listDir("roles/主要角色")).map((f) => `roles/主要角色/${f}`);
      const minorRolesZh = (await listDir("roles/次要角色")).map((f) => `roles/次要角色/${f}`);
      const coreRolesZh = (await listDir("roles/核心角色")).map((f) => `roles/核心角色/${f}`);
      const functionalRolesZh = (await listDir("roles/功能角色")).map((f) => `roles/功能角色/${f}`);
      const importantRolesZh = (await listDir("roles/重要角色")).map((f) => `roles/重要角色/${f}`);
      const majorRolesEn = (await listDir("roles/major")).map((f) => `roles/major/${f}`);
      const minorRolesEn = (await listDir("roles/minor")).map((f) => `roles/minor/${f}`);
      const coreRolesEn = (await listDir("roles/core")).map((f) => `roles/core/${f}`);
      const functionalRolesEn = (await listDir("roles/functional")).map((f) => `roles/functional/${f}`);

      const all = [
        ...flatFiles,
        ...outlineFiles,
        ...coreRolesZh, ...majorRolesZh, ...importantRolesZh, ...minorRolesZh, ...functionalRolesZh,
        ...coreRolesEn, ...majorRolesEn, ...minorRolesEn, ...functionalRolesEn,
      ];
      const described = await Promise.all(all.map(describe));
      const result = described.filter((x): x is NonNullable<typeof x> => x !== null);
      return c.json({ files: result });
    } catch {
      return c.json({ files: [] });
    }
  });
}

async function assertBookDirectoryExists(state: ServerContext["state"], bookId: string): Promise<void> {
  const { ApiError } = await import("../errors.js");
  try {
    await state.loadBookConfig(bookId);
  } catch {
    throw new ApiError(404, "BOOK_NOT_FOUND", `Book "${bookId}" not found`);
  }
}
