/**
 * Pipeline Import — extracted from runner.ts (B3).
 *
 * Contains planFoundationImport, commitFoundationImport.
 */
import type { PipelineContext } from "./context.js";
import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import { ArchitectAgent, type ArchitectOutput, type ArchitectRole } from "../agents/architect.js";
import {
  buildFoundationSourceBundle,
  assembleFoundationContext,
  persistFoundationSourceBundle,
  type FoundationSourceBundle,
  type FoundationSourceInput,
} from "../import/foundation-source.js";
import {
  getFoundationRevision,
  assertValidArchitectOutput,
  copyDirShallow,
  copyDirRecursive,
} from "./pipeline-foundation.js";
import { readStoryFrame, readVolumeMap, readCharacterContext } from "../utils/outline-paths.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { readdir } from "node:fs/promises";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ImportDeps {
  loadBookConfig: (bookId: string) => Promise<BookConfig>;
  bookDir: (bookId: string) => string;
  loadGenreProfile: (genre: string) => Promise<{ profile: GenreProfile }>;
  scanExistingRoles: (bookDir: string) => Promise<string[]>;
  computeRoleChanges: (existing: string[], proposed: ReadonlyArray<ArchitectRole>, mode: "supplement" | "rebuild") => { added: string[]; updated: string[]; removed: string[] };
}

// ─── Helpers (G5: extracted from runner.ts) ───────────────────────────────────

/** Scan existing role files and return their names. */
export async function scanExistingRoles(bookDir: string): Promise<string[]> {
  const storyDir = join(bookDir, "story");
  const rolesDirs = [
    join(storyDir, "roles", "主要角色"),
    join(storyDir, "roles", "次要角色"),
    join(storyDir, "roles", "核心角色"),
    join(storyDir, "roles", "功能角色"),
    join(storyDir, "roles", "重要角色"),
    join(storyDir, "roles", "major"),
    join(storyDir, "roles", "minor"),
    join(storyDir, "roles", "core"),
    join(storyDir, "roles", "functional"),
  ];
  const results = await Promise.all(
    rolesDirs.map(async (dir) => {
      try {
        const entries = await readdir(dir);
        return entries.filter((e) => e.endsWith(".md")).map((e) => e.replace(/\.md$/, ""));
      } catch {
        return [] as string[];
      }
    }),
  );
  return results.flat();
}

/** Compute role changes between existing and proposed. */
export function computeRoleChanges(
  existing: string[],
  proposed: ReadonlyArray<ArchitectRole>,
  mode: "supplement" | "rebuild",
): { added: string[]; updated: string[]; removed: string[] } {
  const proposedNames = new Set(proposed.map((r) => r.name));
  const existingSet = new Set(existing);
  const added = proposed.filter((r) => !existingSet.has(r.name)).map((r) => r.name);
  const updated = proposed.filter((r) => existingSet.has(r.name)).map((r) => r.name);
  const removed = mode === "rebuild"
    ? existing.filter((name) => !proposedNames.has(name))
    : [];
  return { added, updated, removed };
}

// ─── planFoundationImport ─────────────────────────────────────────────────────

export async function planFoundationImport(
  ctx: PipelineContext,
  bookId: string,
  inputs: ReadonlyArray<FoundationSourceInput>,
  options: { mode?: "supplement" | "rebuild"; instruction?: string } | undefined,
  deps: ImportDeps,
): Promise<{
  bundle: FoundationSourceBundle;
  proposed?: ArchitectOutput;
  foundationRevision?: string;
  warnings: string[];
  roleChanges?: { added: string[]; updated: string[]; removed: string[] };
}> {
  const mode = options?.mode ?? "supplement";
  const warnings: string[] = [];
  const bundle = buildFoundationSourceBundle(inputs);
  warnings.push(...bundle.warnings);

  if (bundle.sources.length === 0) {
    return { bundle, warnings: [...warnings, "没有有效的资料可导入"] };
  }

  const foundationSources = bundle.sources.filter((s) => s.purpose !== "chapter" && s.purpose !== "style");
  if (foundationSources.length === 0) {
    return { bundle, warnings: [...warnings, "资料用途均为 chapter/style，不走架构导入"] };
  }
  const divertedCount = bundle.sources.length - foundationSources.length;
  if (divertedCount > 0) {
    warnings.push(`${divertedCount} 份资料被识别为 chapter/style，需通过对应入口导入`);
  }

  const instructionBlock = options?.instruction ? `\n\n## 用户补充指令\n${options.instruction}\n` : "";
  const fullContext = assembleFoundationContext(foundationSources) + instructionBlock;

  const book = await deps.loadBookConfig(bookId);
  const bookDir = deps.bookDir(bookId);
  const storyDir = join(bookDir, "story");
  const foundationRevision = await getFoundationRevision(ctx, bookId);

  let oldStoryBible = ""; let oldVolumeOutline = ""; let oldBookRules = ""; let oldCharacterMatrix = "";
  [oldStoryBible, oldVolumeOutline, oldCharacterMatrix] = await Promise.all([
    readStoryFrame(bookDir).catch(() => ""),
    readVolumeMap(bookDir).catch(() => ""),
    readCharacterContext(bookDir).catch(() => ""),
  ]);
  oldBookRules = await readFile(join(storyDir, "book_rules.md"), "utf-8").catch(() => "");

  const architect = new ArchitectAgent(ctx.agentCtxFor("architect", bookId));
  let proposed: ArchitectOutput;

  if (oldStoryBible.trim()) {
    proposed = await architect.generateFoundation(book, fullContext, undefined, {
      reviseFrom: {
        storyBible: oldStoryBible, volumeOutline: oldVolumeOutline,
        bookRules: oldBookRules, characterMatrix: oldCharacterMatrix,
        userFeedback: `补充以下资料：${foundationSources.map((s) => s.sourceName).join("、")}`,
      },
    });
  } else {
    proposed = await architect.generateFoundation(book, fullContext);
  }

  const existingRoles = await deps.scanExistingRoles(bookDir);
  const proposedRoles = proposed.roles ?? [];
  const roleChanges = deps.computeRoleChanges(existingRoles, proposedRoles, mode);

  return { bundle, proposed, foundationRevision, warnings, roleChanges };
}

// ─── commitFoundationImport ───────────────────────────────────────────────────

export async function commitFoundationImport(
  ctx: PipelineContext,
  bookId: string,
  proposed: ArchitectOutput,
  options: { mode?: "supplement" | "rebuild"; expectedRevision?: string; sourceBundle?: FoundationSourceBundle } | undefined,
  deps: ImportDeps,
): Promise<void> {
  const mode = options?.mode ?? "supplement";
  const bookDir = deps.bookDir(bookId);
  const storyDir = join(bookDir, "story");
  assertValidArchitectOutput(proposed);

  if (options?.expectedRevision) {
    const currentRevision = await getFoundationRevision(ctx, bookId);
    if (currentRevision !== options.expectedRevision) {
      throw new Error("书籍架构在预览后已发生变化，请重新生成导入预览");
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = join(storyDir, `.backup-foundation-${timestamp}`);
  await mkdir(backupDir, { recursive: true });

  const flatFiles = ["story_bible.md", "volume_outline.md", "book_rules.md", "character_matrix.md"];
  for (const fileName of flatFiles) {
    try {
      const content = await readFile(join(storyDir, fileName), "utf-8");
      await writeFile(join(backupDir, fileName), content, "utf-8");
    } catch { /* File may not exist */ }
  }

  await copyDirShallow(join(storyDir, "outline"), join(backupDir, "outline"));
  await copyDirRecursive(join(storyDir, "roles"), join(backupDir, "roles"));

  const book = await deps.loadBookConfig(bookId);
  const { profile: gp } = await deps.loadGenreProfile(book.genre);
  const architect = new ArchitectAgent(ctx.agentCtxFor("architect", bookId));
  const resolvedLanguage = (book.language ?? gp.language) as "zh" | "en";
  const writeMode = mode === "rebuild" ? "revise" as const : "merge" as const;
  await architect.writeFoundationFiles(bookDir, proposed, gp.numericalSystem, resolvedLanguage, writeMode);

  if (options?.sourceBundle) {
    await persistFoundationSourceBundle(bookDir, options.sourceBundle, mode);
  }

  ctx.config.logger?.info?.(`[commitFoundationImport] Foundation import complete (mode=${mode})`);
}
