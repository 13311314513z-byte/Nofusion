/**
 * Pipeline Memory Sync (D9) — extracted from runner.ts.
 *
 * Contains syncCurrentStateFactHistory, syncLegacyStructuredStateFromMarkdown,
 * and syncNarrativeMemoryIndex.
 */
import type { WriteChapterOutput } from "../agents/writer.js";
import { rewriteStructuredStateFromMarkdown } from "../state/state-bootstrap.js";
import type { LengthLanguage } from "../utils/length-metrics.js";
import type { PipelineContext } from "./context.js";

export interface MemorySyncDeps {
  bookDir: (bookId: string) => string;
  resolveBookLanguageById: (bookId: string) => Promise<LengthLanguage>;
  logWarn: (lang: LengthLanguage, msg: { zh: string; en: string }) => void;
  isMemoryIndexUnavailableError: (error: unknown) => boolean;
  canOpenMemoryIndex: (bookDir: string) => boolean;
  logMemoryIndexDebugInfo: (bookId: string, error: unknown) => Promise<void>;
  rebuildCurrentStateFactHistory: (bookDir: string, uptoChapter: number) => Promise<void>;
  rebuildNarrativeMemoryIndex: (bookDir: string) => Promise<void>;
  get memoryIndexFallbackWarned(): boolean;
  set memoryIndexFallbackWarned(v: boolean);
  withMemoryIndexRetry: <T>(fn: () => Promise<T>) => Promise<T>;
}

export async function syncCurrentStateFactHistory(
  ctx: PipelineContext,
  bookId: string,
  uptoChapter: number,
  deps: MemorySyncDeps,
): Promise<void> {
  const bookDir = deps.bookDir(bookId);
  try {
    await deps.rebuildCurrentStateFactHistory(bookDir, uptoChapter);
  } catch (error) {
    let resolvedError: unknown = error;
    if (deps.isMemoryIndexUnavailableError(error)) {
      if (deps.canOpenMemoryIndex(bookDir)) {
        try {
          await deps.rebuildCurrentStateFactHistory(bookDir, uptoChapter);
          return;
        } catch (retryError) {
          resolvedError = retryError;
        }
      } else {
        if (!deps.memoryIndexFallbackWarned) {
          deps.memoryIndexFallbackWarned = true;
          deps.logWarn(await deps.resolveBookLanguageById(bookId), {
            zh: "当前 Node 运行时不支持 SQLite 记忆索引，继续使用 Markdown 回退方案。",
            en: "SQLite memory index unavailable on this Node runtime; continuing with markdown fallback.",
          });
          await deps.logMemoryIndexDebugInfo(bookId, resolvedError);
        }
        return;
      }
    }
    deps.logWarn(await deps.resolveBookLanguageById(bookId), {
      zh: `状态事实同步已跳过：${String(resolvedError)}`,
      en: `State fact sync skipped: ${String(resolvedError)}`,
    });
  }
}

export async function syncLegacyStructuredStateFromMarkdown(
  _ctx: PipelineContext,
  bookDir: string,
  chapterNumber: number,
  output?: {
    readonly runtimeStateDelta?: WriteChapterOutput["runtimeStateDelta"];
    readonly runtimeStateSnapshot?: WriteChapterOutput["runtimeStateSnapshot"];
  },
): Promise<void> {
  if (output?.runtimeStateDelta || output?.runtimeStateSnapshot) return;
  await rewriteStructuredStateFromMarkdown({ bookDir, fallbackChapter: chapterNumber });
}

export async function syncNarrativeMemoryIndex(
  ctx: PipelineContext,
  bookId: string,
  deps: MemorySyncDeps,
): Promise<void> {
  const bookDir = deps.bookDir(bookId);
  try {
    await deps.rebuildNarrativeMemoryIndex(bookDir);
  } catch (error) {
    let resolvedError: unknown = error;
    if (deps.isMemoryIndexUnavailableError(error)) {
      if (deps.canOpenMemoryIndex(bookDir)) {
        try {
          await deps.rebuildNarrativeMemoryIndex(bookDir);
          return;
        } catch (retryError) {
          resolvedError = retryError;
        }
      } else {
        if (!deps.memoryIndexFallbackWarned) {
          deps.memoryIndexFallbackWarned = true;
          deps.logWarn(await deps.resolveBookLanguageById(bookId), {
            zh: "当前 Node 运行时不支持 SQLite 记忆索引，继续使用 Markdown 回退方案。",
            en: "SQLite memory index unavailable on this Node runtime; continuing with markdown fallback.",
          });
          await deps.logMemoryIndexDebugInfo(bookId, resolvedError);
        }
        return;
      }
    }
    deps.logWarn(await deps.resolveBookLanguageById(bookId), {
      zh: `叙事记忆同步已跳过：${String(resolvedError)}`,
      en: `Narrative memory sync skipped: ${String(resolvedError)}`,
    });
  }
}
