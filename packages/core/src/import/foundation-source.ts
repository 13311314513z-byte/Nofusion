/**
 * Foundation source — structured material bundle for ArchitectAgent.
 *
 * The caller prepares one or more FoundationSourceInput entries (parsed via
 * document-reader.ts), then calls buildFoundationSourceBundle() to deduplicate,
 * validate and assemble them into a stable context block that ArchitectAgent
 * can consume as its `externalContext`.
 *
 * This module does NOT:
 *   - generate or write foundation files
 *   - call any LLM
 *   - modify chapter / runtime state
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, stat, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  extractDocumentFromText,
  type DocumentFileType,
} from "../utils/document-reader.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** User-declared purpose for a foundation source. */
export type FoundationSourcePurpose =
  | "auto"
  | "world"
  | "character"
  | "era"
  | "plot"
  | "chapter"
  | "rule"
  | "style";

/** Raw input before processing (one per uploaded file or pasted text). */
export interface FoundationSourceInput {
  readonly sourceName: string;
  readonly fileType: DocumentFileType;
  readonly text: string;
  readonly purpose?: FoundationSourcePurpose;
  /** True when text has already passed through document-reader. */
  readonly normalized?: boolean;
}

/** A fully processed, validated and deduplicated source entry. */
export interface FoundationSource {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly fileType: DocumentFileType;
  readonly purpose: FoundationSourcePurpose;
  readonly text: string;
  readonly charCount: number;
  readonly textHash: string;
  readonly warnings: ReadonlyArray<string>;
}

/** The assembled bundle passed to ArchitectAgent. */
export interface FoundationSourceBundle {
  readonly sources: ReadonlyArray<FoundationSource>;
  readonly totalChars: number;
  readonly warnings: ReadonlyArray<string>;
  /** Assembled XML-like context block, ready to inject into the Architect prompt. */
  readonly contextBlock: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of files per bundle. */
export const MAX_SOURCES_PER_BUNDLE = 20;
/** Maximum total characters across all sources after processing. */
export const MAX_BUNDLE_CHARS = 1_000_000;

const DOCUMENT_FILE_TYPES = new Set<DocumentFileType>([
  "md", "txt", "jsonl", "json", "ts", "js", "html", "htm", "css",
]);
const FOUNDATION_PURPOSES = new Set<FoundationSourcePurpose>([
  "auto", "world", "character", "era", "plot", "chapter", "rule", "style",
]);

const PURPOSE_LABELS: Record<FoundationSourcePurpose, string> = {
  auto: "自动分类",
  world: "世界观",
  character: "人物",
  era: "时代背景",
  plot: "剧情",
  chapter: "正文章节",
  rule: "书籍规则",
  style: "文风样本",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function generateSourceId(sourceName: string, textHash: string): string {
  const stem = sourceName
    .replace(/\.[^.]+$/, "")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "source";
  return `${stem}-${textHash.slice(0, 12)}`;
}

/**
 * Determine if a source purpose is meant for foundation (Architect) processing
 * rather than being diverted to other import pipelines.
 */
export function isFoundationPurpose(purpose: FoundationSourcePurpose): boolean {
  return purpose !== "chapter" && purpose !== "style";
}

export function isDocumentFileType(value: string): value is DocumentFileType {
  return DOCUMENT_FILE_TYPES.has(value as DocumentFileType);
}

export function isFoundationSourcePurpose(value: string): value is FoundationSourcePurpose {
  return FOUNDATION_PURPOSES.has(value as FoundationSourcePurpose);
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a FoundationSourceBundle from raw inputs.
 *
 * Steps performed:
 * 1. Validate count and total size limits.
 * 2. Compute hash, deduplicate by (textHash + sourceName).
 * 3. Assign purpose (default "auto").
 * 4. Collect per-source and bundle-level warnings.
 * 5. Assemble the XML-like context block.
 */
export function buildFoundationSourceBundle(
  inputs: ReadonlyArray<FoundationSourceInput>,
): FoundationSourceBundle {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const sources: FoundationSource[] = [];
  let totalChars = 0;

  // --- limit checks ---
  if (inputs.length === 0) {
    warnings.push("未提供任何资料文件");
    return { sources: [], totalChars: 0, warnings, contextBlock: "" };
  }

  if (inputs.length > MAX_SOURCES_PER_BUNDLE) {
    throw new Error(`资料文件数量超出上限（最多 ${MAX_SOURCES_PER_BUNDLE} 个，实际 ${inputs.length} 个）`);
  }

  // --- process each input ---
  for (const input of inputs) {
    if (!input.sourceName.trim()) {
      throw new Error("资料文件名不能为空");
    }
    if (!isDocumentFileType(input.fileType)) {
      throw new Error(`不支持的资料格式：${String(input.fileType)}`);
    }
    if (input.purpose !== undefined && !isFoundationSourcePurpose(input.purpose)) {
      throw new Error(`不支持的资料用途：${String(input.purpose)}`);
    }

    const extracted = input.normalized
      ? {
          text: input.text,
          warnings: [] as string[],
        }
      : extractDocumentFromText(input.text, input.sourceName, input.fileType);
    const normalizedText = extracted.text;
    const textHash = computeHash(normalizedText);
    const dedupKey = textHash;

    if (seen.has(dedupKey)) {
      warnings.push(`跳过重复文件：${input.sourceName}（内容哈希相同）`);
      continue;
    }
    seen.add(dedupKey);

    const charCount = normalizedText.length;
    const purpose = input.purpose ?? "auto";

    // Collect warnings if text is empty or very short
    const sourceWarnings: string[] = [...extracted.warnings];
    if (charCount === 0) {
      sourceWarnings.push("文件内容为空");
    } else if (charCount < 200) {
      sourceWarnings.push(`文本过短（${charCount} 字），分析效果可能不佳`);
    }

    const source: FoundationSource = {
      sourceId: generateSourceId(input.sourceName, textHash),
      sourceName: input.sourceName,
      fileType: input.fileType,
      purpose,
      text: normalizedText,
      charCount,
      textHash,
      warnings: sourceWarnings,
    };

    sources.push(source);
    totalChars += charCount;
  }

  // --- bundle-level warnings ---
  if (totalChars > MAX_BUNDLE_CHARS) {
    throw new Error(
      `资料包总字符数（${totalChars.toLocaleString()}）超出上限（${MAX_BUNDLE_CHARS.toLocaleString()}）`,
    );
  }

  // --- build context block ---
  const contextBlock = assembleFoundationContext(sources);

  return { sources, totalChars, warnings, contextBlock };
}

// ---------------------------------------------------------------------------
// Context assembly
// ---------------------------------------------------------------------------

/**
 * Assemble processed sources into an XML-like tagged context block.
 * Each source is wrapped in `<foundation-source>` tags with metadata attributes.
 */
export function assembleFoundationContext(sources: ReadonlyArray<FoundationSource>): string {
  if (sources.length === 0) return "";

  const parts: string[] = [
    "<!-- 以下内容为外部导入的书籍资料，请按用途分类融入设定。 -->",
    "<!-- 同类冲突时，用户明确分类的资料优先于 auto 资料。 -->",
    "<!-- style 资料只用于文风分析，不得被当作剧情事实。 -->",
    "",
  ];

  for (const src of sources) {
    parts.push(`<foundation-source`);
    parts.push(`  name="${escapeXml(src.sourceName)}"`);
    parts.push(`  type="${src.fileType}"`);
    parts.push(`  purpose="${src.purpose}"`);
    parts.push(`  hash="${src.textHash}"`);
    parts.push(`  chars="${src.charCount}"`);
    parts.push(`>`);
    // Indent text content
    const indented = src.text
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n");
    parts.push(indented);
    parts.push(`</foundation-source>`);
    parts.push("");
  }

  return parts.join("\n");
}

export interface FoundationSourceIndexEntry {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly fileType: DocumentFileType;
  readonly purpose: FoundationSourcePurpose;
  readonly textHash: string;
  readonly charCount: number;
  readonly importedAt: string;
  readonly mode: "create" | "supplement" | "rebuild";
}

/** Atomically read and validate the source index for a book. */
async function readSourceIndex(
  bookDir: string,
): Promise<{ sources: FoundationSourceIndexEntry[] }> {
  const indexPath = join(bookDir, "story", "sources", "index.json");
  const raw = await readFile(indexPath, "utf-8");
  if (!raw.trim()) {
    throw new Error(`Source index is empty at ${indexPath}`);
  }
  const parsed = JSON.parse(raw) as { sources?: unknown };
  if (!Array.isArray(parsed.sources)) {
    throw new Error(`Source index is malformed at ${indexPath}: "sources" is not an array`);
  }
  return { sources: parsed.sources as FoundationSourceIndexEntry[] };
}

/**
 * List all foundation sources for a book.
 * Returns empty array if no index exists (not an error).
 * Throws if index exists but is corrupted, so callers can surface diagnostics.
 */
export async function listFoundationSources(
  bookDir: string,
): Promise<ReadonlyArray<FoundationSourceIndexEntry & { sourceFileExists: boolean }>> {
  const indexPath = join(bookDir, "story", "sources", "index.json");
  try {
    await stat(indexPath);
  } catch {
    return [];
  }

  const { sources } = await readSourceIndex(bookDir);
  const sourcesDir = join(bookDir, "story", "sources");
  return await Promise.all(
    sources.map(async (entry) => ({
      ...entry,
      sourceFileExists: await stat(join(sourcesDir, `${entry.sourceId}.md`))
        .then(() => true)
        .catch(() => false),
    })),
  );
}

/**
 * Archive a single foundation source:
 * 1. Remove the entry from index.json
 * 2. Move the source file to story/sources/archive/{sourceId}.md
 *
 * Uses atomic rename for index update. If any step fails, the operation is
 * rolled back. Acquire the book's write lock before calling this.
 */
export async function archiveFoundationSource(
  bookDir: string,
  sourceId: string,
): Promise<boolean> {
  // Validate sourceId is safe
  if (!/^[a-zA-Z0-9_-]+$/.test(sourceId)) {
    throw new Error(`Invalid sourceId: ${JSON.stringify(sourceId)}`);
  }

  const sourcesDir = join(bookDir, "story", "sources");
  const indexPath = join(sourcesDir, "index.json");
  const archiveDir = join(sourcesDir, "archive");
  const sourceFile = join(sourcesDir, `${sourceId}.md`);
  const archiveFile = join(archiveDir, `${sourceId}.md`);

  // Read current index
  const { sources } = await readSourceIndex(bookDir);
  const before = sources.length;
  const remaining = sources.filter((s) => s.sourceId !== sourceId);
  if (remaining.length === before) {
    return false; // sourceId not found
  }

  // Write new index to temp file
  const tmpIndex = join(sourcesDir, `.index.tmp.${Date.now().toString(36)}`);
  await mkdir(archiveDir, { recursive: true });
  await writeFile(tmpIndex, JSON.stringify({ sources: remaining }, null, 2) + "\n", "utf-8");

  try {
    // Move source file to archive
    await mkdir(archiveDir, { recursive: true });
    try {
      await rename(sourceFile, archiveFile);
    } catch {
      // Source file may not exist — that's okay, still update index
    }

    // Atomically replace index
    await rename(tmpIndex, indexPath);
  } catch (error) {
    // Rollback: try to restore source file from archive
    await rename(archiveFile, sourceFile).catch(() => undefined);
    await rm(tmpIndex).catch(() => undefined);
    throw error;
  }

  return true;
}

export async function persistFoundationSourceBundle(
  bookDir: string,
  bundle: FoundationSourceBundle,
  mode: FoundationSourceIndexEntry["mode"],
): Promise<void> {
  if (bundle.sources.length === 0) return;

  const sourcesDir = join(bookDir, "story", "sources");
  const indexPath = join(sourcesDir, "index.json");
  await mkdir(sourcesDir, { recursive: true });

  let existing: FoundationSourceIndexEntry[] = [];
  try {
    const parsed = JSON.parse(await readFile(indexPath, "utf-8")) as { sources?: FoundationSourceIndexEntry[] };
    existing = Array.isArray(parsed.sources) ? parsed.sources : [];
  } catch (e) {
    console.warn(`[foundation-source] Failed to read source index, starting fresh: ${e instanceof Error ? e.message : String(e)}`);
    existing = [];
  }

  const byHash = new Map(existing.map((entry) => [entry.textHash, entry]));
  const importedAt = new Date().toISOString();
  for (const source of bundle.sources) {
    await writeFile(join(sourcesDir, `${source.sourceId}.md`), source.text, "utf-8");
    byHash.set(source.textHash, {
      sourceId: source.sourceId,
      sourceName: source.sourceName,
      fileType: source.fileType,
      purpose: source.purpose,
      textHash: source.textHash,
      charCount: source.charCount,
      importedAt,
      mode,
    });
  }

  await writeFile(
    indexPath,
    JSON.stringify({ sources: [...byHash.values()] }, null, 2) + "\n",
    "utf-8",
  );
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Extract purpose label for display.
 */
export function getPurposeLabel(purpose: FoundationSourcePurpose): string {
  return PURPOSE_LABELS[purpose] ?? purpose;
}

/**
 * Summarise a bundle for logging / preview.
 */
export function summariseBundle(bundle: FoundationSourceBundle): string {
  const lines: string[] = [
    `资料包：${bundle.sources.length} 个文件，共 ${bundle.totalChars.toLocaleString()} 字`,
  ];
  for (const src of bundle.sources) {
    lines.push(`  [${getPurposeLabel(src.purpose)}] ${src.sourceName}（${src.charCount.toLocaleString()} 字）`);
    for (const w of src.warnings) {
      lines.push(`    ⚠ ${w}`);
    }
  }
  for (const w of bundle.warnings) {
    lines.push(`  ⚠ ${w}`);
  }
  return lines.join("\n");
}
