/**
 * runner-import.ts — importCanon + importChapters extracted from runner.ts (Plan B).
 * Module functions receive a narrow interface to avoid circular imports.
 */
import { join } from "node:path";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { chatCompletion } from "../llm/provider.js";
import type { LLMClient } from "../llm/provider.js";
import type { BookConfig } from "../models/book.js";
import type { ChapterMeta } from "../models/chapter.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { AgentContext } from "../agents/base.js";
import type { ArchitectOutput } from "../agents/architect.js";
import type { WriteChapterOutput } from "../agents/writer.js";
import { resolveLengthCountingMode, countChapterLength, formatLengthCount, type LengthLanguage } from "../utils/length-metrics.js";
import type { ImportChaptersInput, ImportChaptersResult } from "./runner.js";
import type { generateAndReviewFoundation } from "./pipeline-foundation.js";

// ─── Host interface — all PipelineRunner methods needed by importCanon / importChapters ──

export interface ImportHost {
  readonly state: {
    listBooks(): Promise<ReadonlyArray<string>>;
    acquireBookLock(bookId: string): Promise<() => Promise<void>>;
    loadBookConfig(bookId: string): Promise<BookConfig>;
    bookDir(bookId: string): string;
    loadChapterIndex(bookId: string): Promise<ReadonlyArray<ChapterMeta>>;
    saveChapterIndex(bookId: string, index: ChapterMeta[]): Promise<void>;
    snapshotState(bookId: string, chapter: number): Promise<void>;
  };
  readonly config: {
    client: LLMClient;
    model: string;
    logger?: { child(name: string): { info(msg: string): void } | undefined };
  };
  loadGenreProfile(genre: string): Promise<{ profile: GenreProfile }>;
  localize(language: LengthLanguage, messages: { zh: string; en: string }): string;
  agentCtxFor(agent: string, bookId?: string): AgentContext;
  generateAndReviewFoundation(
    params: Parameters<typeof generateAndReviewFoundation>[4],
  ): Promise<ArchitectOutput>;
  resetImportReplayTruthFiles(bookDir: string, language: LengthLanguage): Promise<void>;
  tryGenerateStyleGuide(bookId: string, sampleText: string, sampleSource: string, language?: LengthLanguage): Promise<void>;
  prepareWriteInput(
    book: BookConfig,
    bookDir: string,
    chapterNumber: number,
  ): Promise<{
    chapterIntent: string;
    contextPackage: import("../models/input-governance.js").ContextPackage;
    ruleStack: import("../models/input-governance.js").RuleStack;
  }>;
  syncLegacyStructuredStateFromMarkdown(
    bookDir: string,
    chapterNumber: number,
    output?: Partial<Pick<WriteChapterOutput, "runtimeStateDelta" | "runtimeStateSnapshot">>,
  ): Promise<void>;
  syncNarrativeMemoryIndex(bookId: string): Promise<void>;
  syncCurrentStateFactHistory(bookId: string, uptoChapter: number): Promise<void>;
  markBookActiveIfNeeded(bookId: string): Promise<void>;
}

// ─── readParentChapterSample (extracted private helper) ────────────────────────

async function readParentChapterSample(chaptersDir: string): Promise<string> {
  try {
    const entries = await readdir(chaptersDir);
    const mdFiles = entries
      .filter((file) => file.endsWith(".md"))
      .sort()
      .slice(0, 5);
    const chunks: string[] = [];
    let totalLength = 0;
    for (const file of mdFiles) {
      if (totalLength >= 20000) break;
      const content = await readFile(join(chaptersDir, file), "utf-8");
      chunks.push(content);
      totalLength += content.length;
    }
    return chunks.join("\n\n---\n\n");
  } catch {
    return "";
  }
}

// ─── importCanon ──────────────────────────────────────────────────────────────

export async function importCanon(
  host: ImportHost,
  targetBookId: string,
  parentBookId: string,
): Promise<string> {
  // Validate both books exist
  const bookIds = await host.state.listBooks();
  if (!bookIds.includes(parentBookId)) {
    throw new Error(`Parent book "${parentBookId}" not found. Available: ${bookIds.join(", ") || "(none)"}`);
  }
  if (!bookIds.includes(targetBookId)) {
    throw new Error(`Target book "${targetBookId}" not found. Available: ${bookIds.join(", ") || "(none)"}`);
  }

  const parentDir = host.state.bookDir(parentBookId);
  const targetDir = host.state.bookDir(targetBookId);
  const storyDir = join(targetDir, "story");
  await mkdir(storyDir, { recursive: true });

  const readSafe = async (path: string): Promise<string> => {
    try { return await readFile(path, "utf-8"); } catch { return "(无)"; }
  };

  const parentBook = await host.state.loadBookConfig(parentBookId);

  // Phase 5: parent book may be on the new prose layout; prefer outline/.
  const readParentOutline = async (newRel: string, legacyRel: string): Promise<string> => {
    const preferred = await readSafe(join(parentDir, "story", newRel));
    if (preferred.trim() && preferred !== "(无)") return preferred;
    return readSafe(join(parentDir, "story", legacyRel));
  };

  const [storyBible, currentState, ledger, hooks, summaries, subplots, emotions, matrix] =
    await Promise.all([
      readParentOutline("outline/story_frame.md", "story_bible.md"),
      readSafe(join(parentDir, "story/current_state.md")),
      readSafe(join(parentDir, "story/particle_ledger.md")),
      readSafe(join(parentDir, "story/pending_hooks.md")),
      readSafe(join(parentDir, "story/chapter_summaries.md")),
      readSafe(join(parentDir, "story/subplot_board.md")),
      readSafe(join(parentDir, "story/emotional_arcs.md")),
      readSafe(join(parentDir, "story/character_matrix.md")),
    ]);

  const response = await chatCompletion(host.config.client, host.config.model, [
    {
      role: "system",
      content: `你是一位网络小说架构师。基于正传的全部设定和状态文件，生成一份完整的"正传正典参照"文档，供番外写作和审计使用。

输出格式（Markdown）：
# 正传正典（《{正传书名}》）

## 世界规则（完整，来自正传设定）
（力量体系、地理设定、阵营关系、核心规则——完整复制，不压缩）

## 正典约束（不可违反的事实）
| 约束ID | 类型 | 约束内容 | 严重性 |
|---|---|---|---|
| C01 | 人物存亡 | ... | critical |
（列出所有硬性约束：谁活着、谁死了、什么事件已经发生、什么规则不可违反）

## 角色快照
| 角色 | 当前状态 | 性格底色 | 对话特征 | 已知信息 | 未知信息 |
|---|---|---|---|---|---|
（从状态卡和角色矩阵中提取每个重要角色的完整快照）

## 角色双态处理原则
- 未来会变强的角色：写潜力暗示
- 未来会黑化的角色：写微小裂痕
- 未来会死的角色：写导致死亡的性格底色

## 关键事件时间线
| 章节 | 事件 | 涉及角色 | 对番外的约束 |
|---|---|---|---|
（从章节摘要中提取关键事件）

## 伏笔状态
| Hook ID | 类型 | 状态 | 内容 | 预期回收 |
|---|---|---|---|---|

## 资源账本快照
（当前资源状态）

---
meta:
  parentBookId: "{parentBookId}"
  parentTitle: "{正传书名}"
  generatedAt: "{ISO timestamp}"

要求：
1. 世界规则完整复制，不压缩——准确性优先
2. 正典约束必须穷尽，遗漏会导致番外与正传矛盾
3. 角色快照必须包含信息边界（已知/未知），防止番外中角色引用不该知道的信息`,
    },
    {
      role: "user",
      content: `正传书名：${parentBook.title}
正传ID：${parentBookId}

## 正传世界设定
${storyBible}

## 正传当前状态卡
${currentState}

## 正传资源账本
${ledger}

## 正传伏笔池
${hooks}

## 正传章节摘要
${summaries}

## 正传支线进度
${subplots}

## 正传情感弧线
${emotions}

## 正传角色矩阵
${matrix}`,
    },
  ], { temperature: 0.3 });

  // Append deterministic meta block (LLM may hallucinate timestamps)
  const metaBlock = [
    "",
    "---",
    "meta:",
    `  parentBookId: "${parentBookId}"`,
    `  parentTitle: "${parentBook.title}"`,
    `  generatedAt: "${new Date().toISOString()}"`,
  ].join("\n");
  const canon = response.content + metaBlock;

  await writeFile(join(storyDir, "parent_canon.md"), canon, "utf-8");

  // Also generate style guide from parent's chapter text if available
  const parentChaptersDir = join(parentDir, "chapters");
  const parentChapterText = await readParentChapterSample(parentChaptersDir);
  if (parentChapterText.length >= 500) {
    await host.tryGenerateStyleGuide(targetBookId, parentChapterText, parentBook.title);
  }

  return canon;
}

// ─── importChapters ───────────────────────────────────────────────────────────

// Forward references to agent classes (imported dynamically by runner.ts)
interface ArchitectAgentLike { new(ctx: AgentContext): any; }
interface FoundationReviewerAgentLike { new(ctx: AgentContext): any; }
interface ChapterAnalyzerAgentLike { new(ctx: AgentContext): any; }
interface WriterAgentLike { new(ctx: AgentContext): any; }

export async function importChapters(
  host: ImportHost,
  input: ImportChaptersInput,
  deps: {
    AgentClasses: {
      ArchitectAgent: ArchitectAgentLike;
      FoundationReviewerAgent: FoundationReviewerAgentLike;
      ChapterAnalyzerAgent: ChapterAnalyzerAgentLike;
      WriterAgent: WriterAgentLike;
    };
    buildImportFoundationSource: (
      chapters: ReadonlyArray<{ readonly title: string; readonly content: string }>,
      language: LengthLanguage,
      options?: {
        readonly maxFullTextChars?: number;
        readonly chapterExcerptChars?: number;
        readonly titleCatalogChars?: number;
        readonly edgeChapterCount?: number;
        readonly middleAnchorCount?: number;
      },
    ) => string;
  },
): Promise<ImportChaptersResult> {
  const releaseLock = await host.state.acquireBookLock(input.bookId);
  try {
    const book = await host.state.loadBookConfig(input.bookId);
    const bookDir = host.state.bookDir(input.bookId);
    const { profile: gp } = await host.loadGenreProfile(book.genre);
    const resolvedLanguage = book.language ?? gp.language;

    const startFrom = input.resumeFrom ?? 1;

    const log = host.config.logger?.child("import");

    // Step 1: Generate foundation on first run (not on resume)
    if (startFrom === 1) {
      log?.info(host.localize(resolvedLanguage, {
        zh: `步骤 1：从 ${input.chapters.length} 章生成基础设定...`,
        en: `Step 1: Generating foundation from ${input.chapters.length} chapters...`,
      }));
      const foundationSource = deps.buildImportFoundationSource(input.chapters as any, resolvedLanguage);

      const architect = new deps.AgentClasses.ArchitectAgent(host.agentCtxFor("architect", input.bookId));
      const isSeries = input.importMode === "series";
      const foundation = isSeries
        ? await host.generateAndReviewFoundation({
            generate: (reviewFeedback: string | undefined) =>
              architect.generateFoundationFromImport(book, foundationSource, undefined, reviewFeedback, { importMode: "series" }),
            reviewer: new deps.AgentClasses.FoundationReviewerAgent(host.agentCtxFor("foundation-reviewer", input.bookId)),
            mode: "series",
            language: resolvedLanguage === "en" ? "en" : "zh",
            stageLanguage: resolvedLanguage,
          } as any)
        : await architect.generateFoundationFromImport(book, foundationSource);
      await architect.writeFoundationFiles(
        bookDir,
        foundation,
        gp.numericalSystem,
        resolvedLanguage,
      );
      await host.resetImportReplayTruthFiles(bookDir, resolvedLanguage);
      await host.state.saveChapterIndex(input.bookId, []);
      await host.state.snapshotState(input.bookId, 0);

      // Generate style guide from imported chapters
      if (foundationSource.length >= 500) {
        log?.info(host.localize(resolvedLanguage, {
          zh: "提取原文风格指纹...",
          en: "Extracting source style fingerprint...",
        }));
        await host.tryGenerateStyleGuide(input.bookId, foundationSource, book.title, resolvedLanguage);
      }

      log?.info(host.localize(resolvedLanguage, {
        zh: "基础设定已生成。",
        en: "Foundation generated.",
      }));
    }

    // Step 2: Sequential replay
    log?.info(host.localize(resolvedLanguage, {
      zh: `步骤 2：从第 ${startFrom} 章开始顺序回放...`,
      en: `Step 2: Sequential replay from chapter ${startFrom}...`,
    }));
    const analyzer = new deps.AgentClasses.ChapterAnalyzerAgent(host.agentCtxFor("chapter-analyzer", input.bookId));
    const writer = new deps.AgentClasses.WriterAgent(host.agentCtxFor("writer", input.bookId));
    const countingMode = resolveLengthCountingMode(book.language ?? gp.language);
    let totalWords = 0;
    let importedCount = 0;

    for (let i = startFrom - 1; i < input.chapters.length; i++) {
      const ch = input.chapters[i]!;
      // Use the plan's targetNumber when provided, otherwise fall back to sequential numbering
      const chapterNumber = ch.targetNumber ?? i + 1;
      const governedInput = await host.prepareWriteInput(book, bookDir, chapterNumber);

      log?.info(host.localize(resolvedLanguage, {
        zh: `分析章节 ${chapterNumber}/${input.chapters.length}：${ch.title}...`,
        en: `Analyzing chapter ${chapterNumber}/${input.chapters.length}: ${ch.title}...`,
      }));

      // Analyze chapter to get truth file updates
      const output = await analyzer.analyzeChapter({
        book,
        bookDir,
        chapterNumber,
        chapterContent: ch.content,
        chapterTitle: ch.title,
        chapterIntent: governedInput.chapterIntent,
        contextPackage: governedInput.contextPackage,
        ruleStack: governedInput.ruleStack,
      });

      // Save chapter file + core truth files (state, ledger, hooks)
      await writer.saveChapter(bookDir, {
        ...output,
        postWriteErrors: [],
        postWriteWarnings: [],
      }, gp.numericalSystem, resolvedLanguage);

      // Save extended truth files (summaries, subplots, emotional arcs, character matrix)
      await writer.saveNewTruthFiles(bookDir, {
        ...output,
        postWriteErrors: [],
        postWriteWarnings: [],
      }, resolvedLanguage);
      await host.syncLegacyStructuredStateFromMarkdown(bookDir, chapterNumber, output);
      await host.syncNarrativeMemoryIndex(input.bookId);

      // Update chapter index
      const existingIndex = await host.state.loadChapterIndex(input.bookId);
      const now = new Date().toISOString();
      const chapterWordCount = countChapterLength(ch.content, countingMode);
      const newEntry: ChapterMeta = {
        number: chapterNumber,
        title: output.title,
        status: "imported",
        wordCount: chapterWordCount,
        createdAt: now,
        updatedAt: now,
        auditIssues: [],
        lengthWarnings: [],
      };
      // Replace if exists (resume case), otherwise append
      const existingIdx = existingIndex.findIndex((e) => e.number === chapterNumber);
      const updatedIndex = existingIdx >= 0
        ? existingIndex.map((e, idx) => idx === existingIdx ? newEntry : e)
        : [...existingIndex, newEntry];
      await host.state.saveChapterIndex(input.bookId, updatedIndex);

      // Snapshot state after each chapter for rollback + resume support
      await host.state.snapshotState(input.bookId, chapterNumber);

      importedCount++;
      totalWords += chapterWordCount;
    }

    if (input.chapters.length > 0) {
      await host.markBookActiveIfNeeded(input.bookId);
      // Use the actual max chapter number for state sync, not array length
      const maxChapterNumber = Math.max(...input.chapters.map((ch) => ch.targetNumber ?? 0), input.chapters.length);
      await host.syncCurrentStateFactHistory(input.bookId, maxChapterNumber);
    }

    // Compute nextChapter from the actual target numbers, not array length
    const maxTargetNumber = input.chapters.reduce(
      (max, ch) => Math.max(max, ch.targetNumber ?? 0), 0
    );
    const nextChapter = maxTargetNumber > 0 ? maxTargetNumber + 1 : input.chapters.length + 1;
    log?.info(host.localize(resolvedLanguage, {
      zh: `完成。已导入 ${importedCount} 章，共 ${formatLengthCount(totalWords, countingMode)}。下一章：${nextChapter}`,
      en: `Done. ${importedCount} chapters imported, ${formatLengthCount(totalWords, countingMode)}. Next chapter: ${nextChapter}`,
    }));

    return {
      bookId: input.bookId,
      importedCount,
      totalWords,
      nextChapter,
    };
  } finally {
    await releaseLock();
  }
}
