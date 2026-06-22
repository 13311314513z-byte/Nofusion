/**
 * writer-io.ts — saveChapter / saveNewTruthFiles / appendChapterSummary extracted from writer.ts (Phase 1).
 * Pure functions with explicit dependency injection. No dependency on WriterAgent.
 */
import { join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { saveRuntimeStateSnapshot } from "../state/runtime-state-store.js";
import type { RuntimeStateSnapshot } from "../state/state-reducer.js";
import type { WriteChapterOutput } from "./writer-types.js";
import type { RuntimeStateDelta } from "../models/runtime-state.js";

// ─── sanitizeFilename ────────────────────────────────────────────────────────

export function sanitizeFilename(title: string): string {
  return title
    .replace(/[/\\?%*:|"<>]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 50);
}

// ─── appendChapterSummary ────────────────────────────────────────────────────

export async function appendChapterSummary(
  storyDir: string,
  summary: string,
  language: "zh" | "en",
): Promise<void> {
  const summaryPath = join(storyDir, "chapter_summaries.md");
  let existing = "";
  try {
    existing = await readFile(summaryPath, "utf-8");
  } catch {
    // File doesn't exist yet — start with header
    existing = language === "en"
      ? "# Chapter Summaries\n\n| Chapter | Title | Characters | Key Events | State Changes | Hook Activity | Mood | Chapter Type |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n"
      : "# 章节摘要\n\n| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |\n|------|------|----------|----------|----------|----------|----------|----------|\n";
  }

  // Extract only the data row(s) from the summary (skip header lines)
  const dataRows = summary
    .split("\n")
    .filter((line) =>
      line.startsWith("|")
      && !line.startsWith("| 章节")
      && !line.startsWith("| Chapter")
      && !line.startsWith("|--")
      && !line.startsWith("| ---"),
    )
    .join("\n");

  if (dataRows) {
    // Deduplicate: remove existing rows with the same chapter number before appending
    const newChapterNums = new Set(
      dataRows.split("\n")
        .map((line) => line.split("|")[1]?.trim())
        .filter((ch) => ch && /^\d+$/.test(ch)),
    );
    const deduped = existing
      .split("\n")
      .filter((line) => {
        if (!line.startsWith("|")) return true;
        const chNum = line.split("|")[1]?.trim();
        return !chNum || !newChapterNums.has(chNum);
      })
      .join("\n");
    await writeFile(summaryPath, `${deduped.trimEnd()}\n${dataRows}\n`, "utf-8");
  }
}

// ─── saveChapter ─────────────────────────────────────────────────────────────

export interface SaveChapterDeps {
  resolveRuntimeStateArtifactsForOutput(
    bookDir: string,
    output: WriteChapterOutput,
    language: "zh" | "en",
  ): Promise<{
    snapshot: RuntimeStateSnapshot;
    resolvedDelta: unknown;
    currentStateMarkdown: string;
    hooksMarkdown: string;
    chapterSummariesMarkdown: string | undefined;
  } | null>;
}

export async function saveChapter(
  deps: SaveChapterDeps,
  bookDir: string,
  output: WriteChapterOutput,
  numericalSystem: boolean = true,
  language: "zh" | "en" = "zh",
): Promise<void> {
  const chaptersDir = join(bookDir, "chapters");
  const storyDir = join(bookDir, "story");
  await mkdir(chaptersDir, { recursive: true });

  const paddedNum = String(output.chapterNumber).padStart(4, "0");
  const filename = `${paddedNum}_${sanitizeFilename(output.title)}.md`;

  const heading = language === "en"
    ? `# Chapter ${output.chapterNumber}: ${output.title}`
    : `# 第${output.chapterNumber}章 ${output.title}`;
  const chapterContent = [
    heading,
    "",
    output.content,
  ].join("\n");
  const runtimeStateArtifacts = await deps.resolveRuntimeStateArtifactsForOutput(
    bookDir,
    output,
    language,
  );

  const writes: Array<Promise<void>> = [
    writeFile(join(chaptersDir, filename), chapterContent, "utf-8"),
    writeFile(join(storyDir, "current_state.md"), runtimeStateArtifacts?.currentStateMarkdown ?? output.updatedState, "utf-8"),
    writeFile(join(storyDir, "pending_hooks.md"), runtimeStateArtifacts?.hooksMarkdown ?? output.updatedHooks, "utf-8"),
  ];

  if (runtimeStateArtifacts?.chapterSummariesMarkdown) {
    writes.push(
      writeFile(join(storyDir, "chapter_summaries.md"), runtimeStateArtifacts.chapterSummariesMarkdown, "utf-8"),
    );
  }

  if (runtimeStateArtifacts?.snapshot ?? output.runtimeStateSnapshot) {
    writes.push(saveRuntimeStateSnapshot(bookDir, runtimeStateArtifacts?.snapshot ?? output.runtimeStateSnapshot!));
  }

  if (numericalSystem) {
    writes.push(
      writeFile(join(storyDir, "particle_ledger.md"), output.updatedLedger, "utf-8"),
    );
  }

  await Promise.all(writes);
}

// ─── saveNewTruthFiles ─────────────────────────────────────────────────────

export async function saveNewTruthFiles(
  appendChapterSummaryFn: (storyDir: string, summary: string, language: "zh" | "en") => Promise<void>,
  bookDir: string,
  output: WriteChapterOutput,
  language: "zh" | "en" = "zh",
): Promise<void> {
  const storyDir = join(bookDir, "story");
  const writes: Array<Promise<void>> = [];

  // Append chapter summary to chapter_summaries.md
  if (!output.runtimeStateDelta && output.updatedChapterSummaries) {
    writes.push(writeFile(
      join(storyDir, "chapter_summaries.md"),
      output.updatedChapterSummaries,
      "utf-8",
    ));
  } else if (!output.runtimeStateDelta && output.chapterSummary) {
    writes.push(appendChapterSummaryFn(storyDir, output.chapterSummary, language));
  }

  // Overwrite subplot board
  if (output.updatedSubplots) {
    writes.push(writeFile(join(storyDir, "subplot_board.md"), output.updatedSubplots, "utf-8"));
  }

  // Overwrite emotional arcs
  if (output.updatedEmotionalArcs) {
    writes.push(writeFile(join(storyDir, "emotional_arcs.md"), output.updatedEmotionalArcs, "utf-8"));
  }

  // Overwrite character matrix
  if (output.updatedCharacterMatrix) {
    writes.push(writeFile(join(storyDir, "character_matrix.md"), output.updatedCharacterMatrix, "utf-8"));
  }

  await Promise.all(writes);
}
