/**
 * Memory index helpers extracted from runner.ts (Stage 1 split).
 *
 * All functions are module-level and receive explicit dependencies.
 * They do NOT import runner.ts to prevent circular dependencies.
 */
import type { WriteChapterOutput } from "../agents/writer.js";
import type { StateManager } from "../state/manager.js";
import { tryCreateMemoryDB,type Fact } from "../state/memory-db.js";
import { loadNarrativeMemorySeed,loadSnapshotCurrentStateFacts } from "../state/runtime-state-store.js";
import { rewriteStructuredStateFromMarkdown } from "../state/state-bootstrap.js";
import type { PipelineConfig } from "./context.js";

// ─── Dependency bag ──────────────────────────────────────────────────────────

export interface MemoryIndexDeps {
  readonly state: StateManager;
  readonly config: PipelineConfig;
  resolveBookLanguageById(bookId: string): Promise<"zh" | "en">;
  logWarn(language: "zh" | "en", message: { zh: string; en: string }): void;
  /** Call after emitting the fallback warning so it only fires once per runner lifetime. */
  markFallbackWarned(): void;
  isFallbackWarned(): boolean;
}

// ─── Helper ──────────────────────────────────────────────────────────────────

export function factKey(fact: Pick<Fact, "subject" | "predicate">): string {
  return `${fact.subject}::${fact.predicate}`;
}

// ─── Busy / unavailable detection ────────────────────────────────────────────

export function isMemoryIndexUnavailableError(error: unknown): boolean {
  if (!error) return false;

  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  const message = error instanceof Error
    ? error.message
    : String(error);
  const normalizedMessage = message.trim();

  return /^No such built-in module:\s*node:sqlite$/i.test(normalizedMessage)
    || /^Cannot find module ['"]node:sqlite['"]$/i.test(normalizedMessage)
    || (code === "ERR_UNKNOWN_BUILTIN_MODULE" && /\bnode:sqlite\b/i.test(normalizedMessage));
}

export function isMemoryIndexBusyError(error: unknown): boolean {
  if (!error) return false;

  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  const message = error instanceof Error
    ? error.message
    : String(error);

  return code === "SQLITE_BUSY"
    || code === "SQLITE_LOCKED"
    || /\bSQLITE_BUSY\b/i.test(message)
    || /\bSQLITE_LOCKED\b/i.test(message)
    || /database is locked/i.test(message)
    || /database is busy/i.test(message);
}

// ─── Retry wrapper ───────────────────────────────────────────────────────────

export async function withMemoryIndexRetry<T>(operation: () => Promise<T> | T): Promise<T> {
  const retryDelaysMs = [0, 25, 75];
  let lastError: unknown;

  for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isMemoryIndexBusyError(error) || attempt === retryDelaysMs.length - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt + 1]!));
    }
  }

  throw lastError;
}

// ─── Can-open check ──────────────────────────────────────────────────────────

export function canOpenMemoryIndex(bookDir: string): boolean {
  const memoryDb = tryCreateMemoryDB(bookDir);
  if (memoryDb) {
    memoryDb.close();
    return true;
  }
  return false;
}

// ─── Debug logging ───────────────────────────────────────────────────────────

export async function logMemoryIndexDebugInfo(
  deps: MemoryIndexDeps,
  bookId: string,
  error: unknown,
): Promise<void> {
  if (process.env.INKOS_DEBUG_SQLITE_MEMORY !== "1") {
    return;
  }

  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  const message = error instanceof Error
    ? error.message
    : String(error);

  deps.logWarn(await deps.resolveBookLanguageById(bookId), {
    zh: `SQLite 记忆索引调试：node=${process.version}; execArgv=${JSON.stringify(process.execArgv)}; code=${code || "(none)"}; message=${message}`,
    en: `SQLite memory debug: node=${process.version}; execArgv=${JSON.stringify(process.execArgv)}; code=${code || "(none)"}; message=${message}`,
  });
}

// ─── Rebuild functions ───────────────────────────────────────────────────────

export async function rebuildCurrentStateFactHistory(
  deps: MemoryIndexDeps,
  bookDir: string,
  uptoChapter: number,
): Promise<void> {
  const memoryDb = await withMemoryIndexRetry(async () => {
    const db = tryCreateMemoryDB(bookDir);
    if (!db) {
      const err = new Error("No such built-in module: node:sqlite");
      (err as NodeJS.ErrnoException).code = "ERR_UNKNOWN_BUILTIN_MODULE";
      throw err;
    }
    try {
      db.resetFacts();

      const activeFacts = new Map<string, { id: number; object: string }>();

      for (let chapter = 0; chapter <= uptoChapter; chapter++) {
        const snapshotFacts = await loadSnapshotCurrentStateFacts(bookDir, chapter);
        if (snapshotFacts.length === 0) continue;
        const nextFacts = new Map<string, Omit<Fact, "id">>();

        for (const fact of snapshotFacts) {
          nextFacts.set(factKey(fact), {
            subject: fact.subject,
            predicate: fact.predicate,
            object: fact.object,
            validFromChapter: chapter,
            validUntilChapter: null,
            sourceChapter: chapter,
          });
        }

        for (const [key, previous] of activeFacts.entries()) {
          const next = nextFacts.get(key);
          if (!next || next.object !== previous.object) {
            db.invalidateFact(previous.id, chapter);
            activeFacts.delete(key);
          }
        }

        for (const [key, fact] of nextFacts.entries()) {
          if (activeFacts.has(key)) continue;
          const id = db.addFact(fact);
          activeFacts.set(key, { id, object: fact.object });
        }
      }

      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  });

  try {
    // No-op: keep the db open only for the duration of the rebuild.
  } finally {
    memoryDb.close();
  }
}

export async function rebuildNarrativeMemoryIndex(
  deps: MemoryIndexDeps,
  bookDir: string,
): Promise<void> {
  const memorySeed = await loadNarrativeMemorySeed(bookDir);

  const memoryDb = await withMemoryIndexRetry(() => {
    const db = tryCreateMemoryDB(bookDir);
    if (!db) {
      const err = new Error("No such built-in module: node:sqlite");
      (err as NodeJS.ErrnoException).code = "ERR_UNKNOWN_BUILTIN_MODULE";
      throw err;
    }
    try {
      db.replaceSummaries(memorySeed.summaries);
      db.replaceHooks(memorySeed.hooks);
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  });

  try {
    // No-op: keep the db open only for the duration of the rebuild.
  } finally {
    memoryDb.close();
  }
}

// ─── Top-level sync orchestrators ────────────────────────────────────────────

export async function syncCurrentStateFactHistory(
  deps: MemoryIndexDeps,
  bookId: string,
  uptoChapter: number,
): Promise<void> {
  const bookDir = deps.state.bookDir(bookId);
  try {
    await rebuildCurrentStateFactHistory(deps, bookDir, uptoChapter);
  } catch (error) {
    if (isMemoryIndexUnavailableError(error)) {
      if (canOpenMemoryIndex(bookDir)) {
        try {
          await rebuildCurrentStateFactHistory(deps, bookDir, uptoChapter);
          return;
        } catch (retryError) {
          // eslint-disable-next-line no-ex-assign
          error = retryError;
        }
      } else {
        if (!deps.isFallbackWarned()) {
          deps.markFallbackWarned();
          deps.logWarn(await deps.resolveBookLanguageById(bookId), {
            zh: "当前 Node 运行时不支持 SQLite 记忆索引，继续使用 Markdown 回退方案。",
            en: "SQLite memory index unavailable on this Node runtime; continuing with markdown fallback.",
          });
          await logMemoryIndexDebugInfo(deps, bookId, error);
        }
        return;
      }
    }
    deps.logWarn(await deps.resolveBookLanguageById(bookId), {
      zh: `状态事实同步已跳过：${String(error)}`,
      en: `State fact sync skipped: ${String(error)}`,
    });
  }
}

export async function syncNarrativeMemoryIndex(
  deps: MemoryIndexDeps,
  bookId: string,
): Promise<void> {
  const bookDir = deps.state.bookDir(bookId);
  try {
    await rebuildNarrativeMemoryIndex(deps, bookDir);
  } catch (error) {
    if (isMemoryIndexUnavailableError(error)) {
      if (canOpenMemoryIndex(bookDir)) {
        try {
          await rebuildNarrativeMemoryIndex(deps, bookDir);
          return;
        } catch (retryError) {
          // eslint-disable-next-line no-ex-assign
          error = retryError;
        }
      } else {
        if (!deps.isFallbackWarned()) {
          deps.markFallbackWarned();
          deps.logWarn(await deps.resolveBookLanguageById(bookId), {
            zh: "当前 Node 运行时不支持 SQLite 记忆索引，继续使用 Markdown 回退方案。",
            en: "SQLite memory index unavailable on this Node runtime; continuing with markdown fallback.",
          });
          await logMemoryIndexDebugInfo(deps, bookId, error);
        }
        return;
      }
    }
    deps.logWarn(await deps.resolveBookLanguageById(bookId), {
      zh: `叙事记忆同步已跳过：${String(error)}`,
      en: `Narrative memory sync skipped: ${String(error)}`,
    });
  }
}

// ─── Legacy markdown fallback ────────────────────────────────────────────────

export async function syncLegacyStructuredStateFromMarkdown(
  bookDir: string,
  chapterNumber: number,
  output?: {
    readonly runtimeStateDelta?: WriteChapterOutput["runtimeStateDelta"];
    readonly runtimeStateSnapshot?: WriteChapterOutput["runtimeStateSnapshot"];
  },
): Promise<void> {
  if (output?.runtimeStateDelta || output?.runtimeStateSnapshot) {
    return;
  }

  await rewriteStructuredStateFromMarkdown({
    bookDir,
    fallbackChapter: chapterNumber,
  });
}
