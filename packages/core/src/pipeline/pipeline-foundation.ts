/**
 * Pipeline Foundation Module
 * Extracted from PipelineRunner (C2-1).
 *
 * Handles: initBook, reviseFoundation, generateAndReviewFoundation,
 *          buildFoundationReviewFeedback, assertValidArchitectOutput,
 *          getFoundationRevision, copyDirShallow, copyDirRecursive.
 */
import { createHash } from "node:crypto";
import { mkdir,readdir,readFile,rename,rm,writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArchitectOutput } from "../agents/architect.js";
import { ArchitectAgent } from "../agents/architect.js";
import { FoundationReviewerAgent } from "../agents/foundation-reviewer.js";
import { readGenreProfile } from "../agents/rules-reader.js";
import {
persistFoundationSourceBundle,
} from "../import/foundation-source.js";
import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { LengthLanguage } from "../utils/length-metrics.js";
import {
readCharacterContext,
readStoryFrame,
readVolumeMap,
} from "../utils/outline-paths.js";
import type { PipelineContext } from "./context.js";
import type { InitBookOptions } from "./runner.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function loadGenreProfile(ctx: PipelineContext, genre: string): Promise<{ profile: GenreProfile }> {
  const parsed = await readGenreProfile(ctx.config.projectRoot, genre);
  return { profile: parsed.profile };
}

// ─── Foundation review loop ──────────────────────────────────────────────────

export async function generateAndReviewFoundation(
  ctx: PipelineContext,
  resolveBookLanguage: (book: Pick<BookConfig, "genre" | "language">) => Promise<LengthLanguage>,
  logStage: (language: LengthLanguage, message: { zh: string; en: string }) => void,
  logWarn: (language: LengthLanguage, message: { zh: string; en: string }) => void,
  params: {
    readonly generate: (reviewFeedback?: string) => Promise<ArchitectOutput>;
    readonly reviewer: FoundationReviewerAgent;
    readonly mode: "original" | "fanfic" | "series";
    readonly sourceCanon?: string;
    readonly styleGuide?: string;
    readonly language: "zh" | "en";
    readonly stageLanguage: LengthLanguage;
    readonly maxRetries?: number;
  },
): Promise<ArchitectOutput> {
  const maxRetries = params.maxRetries ?? ctx.config.foundationReviewRetries ?? 2;
  let foundation = await params.generate();

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    logStage(params.stageLanguage, {
      zh: `审核基础设定（第${attempt + 1}轮）`,
      en: `reviewing foundation (round ${attempt + 1})`,
    });

    const review = await params.reviewer.review({
      foundation,
      mode: params.mode,
      sourceCanon: params.sourceCanon,
      styleGuide: params.styleGuide,
      language: params.language,
    });

    ctx.config.logger?.info(
      `Foundation review: ${review.totalScore}/100 ${review.passed ? "PASSED" : "REJECTED"}`,
    );
    for (const dim of review.dimensions) {
      ctx.config.logger?.info(`  [${dim.score}] ${dim.name.slice(0, 40)}`);
    }

    if (review.passed) {
      return foundation;
    }

    logWarn(params.stageLanguage, {
      zh: `基础设定未通过审核（${review.totalScore}分），正在重新生成...`,
      en: `Foundation rejected (${review.totalScore}/100), regenerating...`,
    });

    foundation = await params.generate(buildFoundationReviewFeedback(review, params.language));
  }

  // Final review
  const finalReview = await params.reviewer.review({
    foundation,
    mode: params.mode,
    sourceCanon: params.sourceCanon,
    styleGuide: params.styleGuide,
    language: params.language,
  });
  ctx.config.logger?.info(
    `Foundation final review: ${finalReview.totalScore}/100 ${finalReview.passed ? "PASSED" : "ACCEPTED (max retries)"}`,
  );

  return foundation;
}

export function buildFoundationReviewFeedback(
  review: {
    readonly dimensions: ReadonlyArray<{
      readonly name: string;
      readonly score: number;
      readonly feedback: string;
    }>;
    readonly overallFeedback: string;
  },
  language: "zh" | "en",
): string {
  const dimensionLines = review.dimensions
    .map((dimension) => (
      language === "en"
        ? `- ${dimension.name} [${dimension.score}]: ${dimension.feedback}`
        : `- ${dimension.name}（${dimension.score}分）：${dimension.feedback}`
    ))
    .join("\n");

  return language === "en"
    ? [
        "## Overall Feedback",
        review.overallFeedback,
        "",
        "## Dimension Notes",
        dimensionLines || "- none",
      ].join("\n")
    : [
        "## 总评",
        review.overallFeedback,
        "",
        "## 分项问题",
        dimensionLines || "- 无",
      ].join("\n");
}

// ─── Directory helpers ───────────────────────────────────────────────────────

export async function copyDirShallow(src: string, dest: string): Promise<void> {
  try {
    await mkdir(dest, { recursive: true });
    const entries = await readdir(src);
    await Promise.all(entries.map(async (entry) => {
      try {
        const content = await readFile(join(src, entry), "utf-8");
        await writeFile(join(dest, entry), content, "utf-8");
      } catch {
        // Skip unreadable files.
      }
    }));
  } catch {
    // Source directory does not exist.
  }
}

export async function copyDirRecursive(src: string, dest: string): Promise<void> {
  try {
    await mkdir(dest, { recursive: true });
    const entries = await readdir(src, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);
      if (entry.isDirectory()) {
        await copyDirRecursive(srcPath, destPath);
      } else if (entry.isFile()) {
        try {
          const content = await readFile(srcPath, "utf-8");
          await writeFile(destPath, content, "utf-8");
        } catch {
          // Skip unreadable files.
        }
      }
    }));
  } catch {
    // Source directory does not exist.
  }
}

// ─── Validation ──────────────────────────────────────────────────────────────

export function assertValidArchitectOutput(output: ArchitectOutput): void {
  const required = [
    ["storyBible", output.storyBible],
    ["volumeOutline", output.volumeOutline],
    ["bookRules", output.bookRules],
    ["currentState", output.currentState],
    ["pendingHooks", output.pendingHooks],
    ["storyFrame", output.storyFrame],
    ["volumeMap", output.volumeMap],
  ] as const;
  for (const [field, value] of required) {
    if (typeof value !== "string") {
      throw new Error(`无效的架构预览：${field} 必须是字符串`);
    }
  }
  if (!output.storyFrame?.trim() || !output.volumeMap?.trim()) {
    throw new Error("无效的架构预览：缺少 Phase 5 storyFrame 或 volumeMap");
  }
  if (output.roles !== undefined) {
    if (!Array.isArray(output.roles)) {
      throw new Error("无效的架构预览：roles 必须是数组");
    }
    for (const role of output.roles) {
      if (
        !role
        || (role.tier !== "major" && role.tier !== "minor")
        || typeof role.name !== "string"
        || !role.name.trim()
        || typeof role.content !== "string"
      ) {
        throw new Error("无效的架构预览：角色数据格式错误");
      }
    }
  }
}

// ─── Foundation hash ─────────────────────────────────────────────────────────

export async function getFoundationRevision(
  ctx: PipelineContext,
  bookId: string,
): Promise<string> {
  const bookDir = ctx.state.bookDir(bookId);
  const storyDir = join(bookDir, "story");
  const files = [
    join(storyDir, "outline", "story_frame.md"),
    join(storyDir, "outline", "volume_map.md"),
    join(storyDir, "story_bible.md"),
    join(storyDir, "volume_outline.md"),
    join(storyDir, "book_rules.md"),
    join(storyDir, "character_matrix.md"),
  ];
  const roleDirs = [
    "主要角色", "次要角色", "核心角色", "功能角色", "重要角色",
    "major", "minor", "core", "functional",
  ];
  for (const dirName of roleDirs) {
    const dir = join(storyDir, "roles", dirName);
    const entries = await readdir(dir).catch(() => [] as string[]);
    for (const entry of entries.filter((name) => name.endsWith(".md")).sort()) {
      files.push(join(dir, entry));
    }
  }

  const hash = createHash("sha256");
  for (const file of [...new Set(files)].sort()) {
    const content = await readFile(file, "utf-8").catch(() => "");
    hash.update(file.slice(bookDir.length));
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 24);
}

// ─── initBook ────────────────────────────────────────────────────────────────

export async function initBook(
  ctx: PipelineContext,
  resolveBookLanguage: (book: Pick<BookConfig, "genre" | "language">) => Promise<LengthLanguage>,
  logStage: (language: LengthLanguage, message: { zh: string; en: string }) => void,
  book: BookConfig,
  options: InitBookOptions = {},
): Promise<void> {
  const architect = new ArchitectAgent(ctx.agentCtxFor("architect", book.id));
  const bookDir = ctx.state.bookDir(book.id);
  const stagingBookDir = join(
    ctx.state.booksDir,
    `.tmp-book-create-${book.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const stageLanguage = await resolveBookLanguage(book);
  const baseExternalContext = options.externalContext ?? ctx.config.externalContext;
  const sourceBundleContext = options.sourceBundle?.contextBlock.trim();
  if (options.sourceBundle && !sourceBundleContext) {
    ctx.config.logger?.warn("sourceBundle provided but contextBlock is empty after trim; it will be skipped");
  }
  const effectiveExternalContext = [
    baseExternalContext?.trim(),
    sourceBundleContext,
  ].filter(Boolean).join("\n\n") || undefined;

  logStage(stageLanguage, { zh: "生成基础设定", en: "generating foundation" });
  const { profile: gp } = await loadGenreProfile(ctx, book.genre);
  const reviewer = new FoundationReviewerAgent(ctx.agentCtxFor("foundation-reviewer", book.id));
  const resolvedLanguage = (book.language ?? gp.language) === "en" ? "en" as const : "zh" as const;
  const logWarn = (language: LengthLanguage, message: { zh: string; en: string }) => {
    ctx.config.logger?.warn(language === "en" ? message.en : message.zh);
  };
  const foundation = await generateAndReviewFoundation(
    ctx,
    resolveBookLanguage,
    logStage,
    logWarn,
    {
      generate: (reviewFeedback) => architect.generateFoundation(
        book,
        effectiveExternalContext,
        reviewFeedback,
      ),
      reviewer,
      mode: "original",
      language: resolvedLanguage,
      stageLanguage,
    },
  );
  try {
    logStage(stageLanguage, { zh: "保存书籍配置", en: "saving book config" });
    await ctx.state.saveBookConfigAt(stagingBookDir, book);

    logStage(stageLanguage, { zh: "写入基础设定文件", en: "writing foundation files" });
    await architect.writeFoundationFiles(
      stagingBookDir,
      foundation,
      gp.numericalSystem,
      book.language ?? gp.language,
    );

    if (effectiveExternalContext && effectiveExternalContext.trim().length > 0) {
      const storyDir = join(stagingBookDir, "story");
      await mkdir(storyDir, { recursive: true });
      await writeFile(join(storyDir, "brief.md"), effectiveExternalContext, "utf-8");
    }
    if (options.sourceBundle) {
      await persistFoundationSourceBundle(stagingBookDir, options.sourceBundle, "create");
    }

    logStage(stageLanguage, { zh: "初始化控制文档", en: "initializing control documents" });
    await ctx.state.ensureControlDocumentsAt(
      stagingBookDir,
      book.language ?? gp.language,
      options.authorIntent ?? effectiveExternalContext,
    );
    if (options.currentFocus?.trim()) {
      await writeFile(
        join(stagingBookDir, "story", "current_focus.md"),
        options.currentFocus.trimEnd() + "\n",
        "utf-8",
      );
    }

    await ctx.state.saveChapterIndexAt(stagingBookDir, []);

    logStage(stageLanguage, { zh: "创建初始快照", en: "creating initial snapshot" });
    await ctx.state.snapshotStateAt(stagingBookDir, 0);

    if (await ctx.pathExists(bookDir)) {
      if (await ctx.state.isCompleteBookDirectory(bookDir)) {
        throw new Error(`Book "${book.id}" already exists at books/${book.id}/. Use a different title or delete the existing book first.`);
      }
      const backupDir = bookDir + ".backup." + Date.now().toString(36);
      await rename(bookDir, backupDir);
      ctx.config.logger?.warn(`Moved incomplete book directory to ${backupDir} for safety`);
    }

    await rename(stagingBookDir, bookDir);
  } catch (error) {
    await rm(stagingBookDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

// ─── reviseFoundation ────────────────────────────────────────────────────────

export async function reviseFoundation(
  ctx: PipelineContext,
  bookId: string,
  feedback: string,
): Promise<void> {
  const bookDir = ctx.state.bookDir(bookId);
  const storyDir = join(bookDir, "story");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = join(storyDir, `.backup-phase5-${timestamp}`);
  await mkdir(backupDir, { recursive: true });

  const flatFiles = ["story_bible.md", "volume_outline.md", "book_rules.md", "character_matrix.md"];
  for (const fileName of flatFiles) {
    try {
      const content = await readFile(join(storyDir, fileName), "utf-8");
      await writeFile(join(backupDir, fileName), content, "utf-8");
    } catch {
      // Missing legacy shim files are fine for partially migrated books.
    }
  }

  // C6 (P2-16): Always backup Phase 5 directories
  await copyDirShallow(join(storyDir, "outline"), join(backupDir, "outline"));
  await copyDirRecursive(join(storyDir, "roles"), join(backupDir, "roles"));

  const book = await ctx.state.loadBookConfig(bookId);
  // C6: Always use Phase 5 read paths — utilities have built-in fallback for old books
  const [oldStoryBible, oldVolumeOutline, oldCharacterMatrix] = await Promise.all([
    readStoryFrame(bookDir),
    readVolumeMap(bookDir),
    readCharacterContext(bookDir),
  ]);
  const oldBookRules = await readFile(join(storyDir, "book_rules.md"), "utf-8").catch(() => "");

  const architect = new ArchitectAgent(ctx.agentCtxFor("architect", bookId));
  const foundation = await architect.generateFoundation(book, undefined, undefined, {
    reviseFrom: {
      storyBible: oldStoryBible,
      volumeOutline: oldVolumeOutline,
      bookRules: oldBookRules,
      characterMatrix: oldCharacterMatrix,
      userFeedback: feedback,
    },
  });

  const reviewer = new FoundationReviewerAgent(ctx.agentCtxFor("foundation-reviewer", bookId));
  const resolvedLanguage = (book.language ?? "zh") === "en" ? "en" as const : "zh" as const;
  try {
    const review = await reviewer.review({
      foundation,
      mode: "original",
      language: resolvedLanguage,
    } as Parameters<FoundationReviewerAgent["review"]>[0]);
    if (!review.passed) {
      ctx.config.logger?.warn?.(
        `[reviseFoundation] Foundation review did not pass; accepting rewrite. Feedback: ${review.overallFeedback ?? ""}`,
      );
    }
  } catch (error) {
    ctx.config.logger?.warn?.(
      `[reviseFoundation] Foundation review failed and was skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const outlineDir = join(storyDir, "outline");
  await mkdir(outlineDir, { recursive: true });
  await mkdir(join(storyDir, "roles", "主要角色"), { recursive: true });
  await mkdir(join(storyDir, "roles", "次要角色"), { recursive: true });

  const { profile: gp } = await loadGenreProfile(ctx, book.genre);
  await architect.writeFoundationFiles(
    bookDir,
    foundation,
    gp.numericalSystem,
    book.language ?? gp.language,
    "revise",
  );
}
