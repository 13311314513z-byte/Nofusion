/**
 * Style Library store — file-based storage for author style profiles.
 *
 * Directory structure:
 *   style-library/
 *     index.json
 *     authors/
 *       {author-id}/
 *         profile.json
 *         style_guide.md
 *         sources/
 *           {source-id}.json
 */

import { mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import type { AuthorStyleProfile, StyleLibraryIndex, StyleSourceDocument } from "./models.js";
import { buildLibraryIndex, buildAuthorProfile } from "./aggregate.js";
import { analyzeStyle } from "../agents/style-analyzer.js";
import { extractDocumentFromText, type DocumentFileType } from "../utils/document-reader.js";

const SAFE_STYLE_ID = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,127}$/u;
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function assertSafeStyleId(value: string, label: string): string {
  const trimmed = value.trim();
  if (
    !SAFE_STYLE_ID.test(trimmed) ||
    trimmed === "." ||
    trimmed === ".." ||
    WINDOWS_RESERVED_NAMES.test(trimmed)
  ) {
    throw new Error(`${label} must use only letters, numbers, dots, underscores, or hyphens`);
  }
  return trimmed;
}

function safeFileName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "sample";
  return basename(trimmed).replace(/[^\p{L}\p{N} ._()-]/gu, "_").slice(0, 160) || "sample";
}

function normalizeTags(tags: ReadonlyArray<string> | undefined): ReadonlyArray<string> {
  if (!tags) return [];
  return tags
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function libraryDir(projectRoot: string): string {
  return join(projectRoot, "style-library");
}

function authorsDir(projectRoot: string): string {
  return join(libraryDir(projectRoot), "authors");
}

function authorDir(projectRoot: string, authorId: string): string {
  return join(authorsDir(projectRoot), assertSafeStyleId(authorId, "authorId"));
}

function authorProfilePath(projectRoot: string, authorId: string): string {
  return join(authorDir(projectRoot, authorId), "profile.json");
}

function authorSourcesDir(projectRoot: string, authorId: string): string {
  return join(authorDir(projectRoot, authorId), "sources");
}

function authorDiagnosticsDir(projectRoot: string, authorId: string): string {
  return join(authorDir(projectRoot, authorId), "diagnostics");
}

function sourcePath(projectRoot: string, authorId: string, sourceId: string): string {
  return join(authorSourcesDir(projectRoot, authorId), `${assertSafeStyleId(sourceId, "sourceId")}.json`);
}

function diagnosticsPath(projectRoot: string, authorId: string, diagnosticsId: string): string {
  return join(authorDiagnosticsDir(projectRoot, authorId), `${assertSafeStyleId(diagnosticsId, "diagnosticsId")}.json`);
}

function indexPath(projectRoot: string): string {
  return join(libraryDir(projectRoot), "index.json");
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function readJsonSafe<T>(path: string): Promise<T | null> {
  try {
    const text = await readFile(path, "utf-8");
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}

async function loadAuthorProfile(projectRoot: string, authorId: string): Promise<AuthorStyleProfile | null> {
  return readJsonSafe<AuthorStyleProfile>(authorProfilePath(projectRoot, authorId));
}

async function loadAuthorSources(
  projectRoot: string,
  authorId: string,
): Promise<ReadonlyArray<StyleSourceDocument>> {
  const sourcesDir = authorSourcesDir(projectRoot, authorId);
  try {
    const entries = await readdir(sourcesDir);
    const sources: StyleSourceDocument[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const source = await readJsonSafe<StyleSourceDocument>(join(sourcesDir, entry));
      if (source) sources.push(source);
    }
    return sources;
  } catch {
    return [];
  }
}

async function saveAuthorProfile(
  projectRoot: string,
  profile: AuthorStyleProfile,
): Promise<void> {
  await ensureDir(authorDir(projectRoot, profile.id));
  await writeJson(authorProfilePath(projectRoot, profile.id), profile);
}

async function saveSourceDocument(
  projectRoot: string,
  source: StyleSourceDocument,
): Promise<void> {
  await ensureDir(authorSourcesDir(projectRoot, source.authorId));
  await writeJson(sourcePath(projectRoot, source.authorId, source.id), source);
}

async function rebuildIndex(projectRoot: string): Promise<void> {
  const aDir = authorsDir(projectRoot);
  const profiles: AuthorStyleProfile[] = [];
  try {
    const entries = await readdir(aDir);
    for (const entry of entries) {
      try {
        const profile = await loadAuthorProfile(projectRoot, entry);
        if (profile) profiles.push(profile);
      } catch {
        // Ignore manually-created directories that are not valid author ids.
      }
    }
  } catch {
    // no authors yet
  }
  const index = buildLibraryIndex(profiles);
  await ensureDir(libraryDir(projectRoot));
  await writeJson(indexPath(projectRoot), index);
}

// ─── Public API ───

export async function listAuthorProfiles(projectRoot: string): Promise<StyleLibraryIndex> {
  const index = await readJsonSafe<StyleLibraryIndex>(indexPath(projectRoot));
  if (index) return index;
  await rebuildIndex(projectRoot);
  return (await readJsonSafe<StyleLibraryIndex>(indexPath(projectRoot))) ?? { authors: [] };
}

export async function getAuthorProfile(
  projectRoot: string,
  authorId: string,
): Promise<{ profile: AuthorStyleProfile; sources: ReadonlyArray<StyleSourceDocument> } | null> {
  const profile = await loadAuthorProfile(projectRoot, authorId);
  if (!profile) return null;
  const sources = await loadAuthorSources(projectRoot, authorId);
  return { profile, sources };
}

export interface CreateAuthorProfileInput {
  readonly id: string;
  readonly name: string;
  readonly language?: "zh" | "en";
  readonly tags?: ReadonlyArray<string>;
}

export async function createAuthorProfile(
  projectRoot: string,
  input: CreateAuthorProfileInput,
): Promise<AuthorStyleProfile> {
  const id = assertSafeStyleId(input.id, "authorId");
  const name = input.name.trim();
  if (!name) throw new Error("name is required");
  const existing = await loadAuthorProfile(projectRoot, id);
  if (existing) throw new Error(`Author already exists: ${id}`);

  const profile: AuthorStyleProfile = {
    id,
    name,
    language: input.language ?? "zh",
    tags: normalizeTags(input.tags),
    sourceIds: [],
    aggregateProfile: {
      avgSentenceLength: 0,
      sentenceLengthStdDev: 0,
      avgParagraphLength: 0,
      paragraphLengthRange: { min: 0, max: 0 },
      vocabularyDiversity: 0,
      topPatterns: [],
      rhetoricalFeatures: [],
      fingerprint: {
        dialogueRatio: 0,
        actionDensity: 0,
        psychologicalRatio: 0,
        sensoryDensity: 0,
        colloquialismScore: 0,
        rhetoricDensity: 0,
        punctuationRhythm: { commaRatio: 0, periodRatio: 0, questionRatio: 0, exclamationRatio: 0, ellipsisRatio: 0, semicolonRatio: 0 },
        aiTellRisk: 0,
        sensoryBreakdown: { visual: 0, auditory: 0, tactile: 0, olfactory: 0, gustatory: 0 },
      },
      sourceName: input.name,
      analyzedAt: new Date().toISOString(),
    },
    sampleStats: { sourceCount: 0, totalChars: 0, avgCharsPerSource: 0 },
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveAuthorProfile(projectRoot, profile);
  await rebuildIndex(projectRoot);
  return profile;
}

export interface AddStyleSourceInput {
  readonly authorId: string;
  readonly sourceId: string;
  readonly fileName: string;
  readonly fileType: DocumentFileType;
  readonly text: string;
}

export async function addStyleSource(
  projectRoot: string,
  input: AddStyleSourceInput,
): Promise<StyleSourceDocument> {
  const authorId = assertSafeStyleId(input.authorId, "authorId");
  const sourceId = assertSafeStyleId(input.sourceId, "sourceId");
  const fileName = safeFileName(input.fileName);
  const author = await loadAuthorProfile(projectRoot, authorId);
  if (!author) throw new Error(`Author not found: ${input.authorId}`);

  const existingSources = await loadAuthorSources(projectRoot, authorId);
  if (existingSources.some((s) => s.id === sourceId)) {
    throw new Error(`Source already exists: ${sourceId}`);
  }

  const extracted = extractDocumentFromText(input.text, fileName, input.fileType);
  if (existingSources.some((s) => s.textHash === extracted.textHash)) {
    throw new Error(`Duplicate source text for author: ${authorId}`);
  }

  let profile: ReturnType<typeof analyzeStyle>;
  try {
    profile = analyzeStyle(extracted.text, fileName);
  } catch (e) {
    const failedSource: StyleSourceDocument = {
      id: sourceId,
      authorId,
      fileName,
      fileType: input.fileType,
      textHash: extracted.textHash,
      charCount: extracted.charCount,
      profile: {
        avgSentenceLength: 0,
        sentenceLengthStdDev: 0,
        avgParagraphLength: 0,
        paragraphLengthRange: { min: 0, max: 0 },
        vocabularyDiversity: 0,
        topPatterns: [],
        rhetoricalFeatures: [],
        fingerprint: {
          dialogueRatio: 0,
          actionDensity: 0,
          psychologicalRatio: 0,
          sensoryDensity: 0,
          colloquialismScore: 0,
          rhetoricDensity: 0,
          punctuationRhythm: { commaRatio: 0, periodRatio: 0, questionRatio: 0, exclamationRatio: 0, ellipsisRatio: 0, semicolonRatio: 0 },
          aiTellRisk: 0,
          sensoryBreakdown: { visual: 0, auditory: 0, tactile: 0, olfactory: 0, gustatory: 0 },
        },
        sourceName: fileName,
        analyzedAt: new Date().toISOString(),
      },
      status: "failed",
      error: e instanceof Error ? e.message : String(e),
      extractedAt: new Date().toISOString(),
    };
    await saveSourceDocument(projectRoot, failedSource);
    const allSources = await loadAuthorSources(projectRoot, authorId);
    const updatedAuthor = buildAuthorProfile(
      author.id,
      author.name,
      author.language,
      author.tags,
      allSources,
      author,
    );
    await saveAuthorProfile(projectRoot, updatedAuthor);
    await rebuildIndex(projectRoot);
    throw e;
  }

  const source: StyleSourceDocument = {
    id: sourceId,
    authorId,
    fileName,
    fileType: input.fileType,
    textHash: extracted.textHash,
    charCount: extracted.charCount,
    profile,
    status: "ready",
    extractedAt: new Date().toISOString(),
  };

  await saveSourceDocument(projectRoot, source);

  // Rebuild author profile with new source
  const allSources = await loadAuthorSources(projectRoot, authorId);
  const updatedAuthor = buildAuthorProfile(
    author.id,
    author.name,
    author.language,
    author.tags,
    allSources,
    author,
  );
  await saveAuthorProfile(projectRoot, updatedAuthor);
  await rebuildIndex(projectRoot);

  return source;
}

export async function reanalyzeAuthorProfile(
  projectRoot: string,
  authorId: string,
): Promise<AuthorStyleProfile> {
  const safeAuthorId = assertSafeStyleId(authorId, "authorId");
  const author = await loadAuthorProfile(projectRoot, safeAuthorId);
  if (!author) throw new Error(`Author not found: ${authorId}`);

  const sources = await loadAuthorSources(projectRoot, safeAuthorId);
  const updated = buildAuthorProfile(author.id, author.name, author.language, author.tags, sources, author);
  await saveAuthorProfile(projectRoot, updated);
  await rebuildIndex(projectRoot);
  return updated;
}

export async function deleteAuthorProfile(projectRoot: string, authorId: string): Promise<void> {
  const dir = authorDir(projectRoot, assertSafeStyleId(authorId, "authorId"));
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  await rebuildIndex(projectRoot);
}

export async function deleteStyleSource(
  projectRoot: string,
  authorId: string,
  sourceId: string,
): Promise<void> {
  const safeAuthorId = assertSafeStyleId(authorId, "authorId");
  const safeSourceId = assertSafeStyleId(sourceId, "sourceId");
  const sp = sourcePath(projectRoot, safeAuthorId, safeSourceId);
  try {
    await rm(sp, { force: true });
  } catch {
    // ignore
  }
  // Rebuild author profile
  const author = await loadAuthorProfile(projectRoot, safeAuthorId);
  if (author) {
    const sources = await loadAuthorSources(projectRoot, safeAuthorId);
    const updated = buildAuthorProfile(author.id, author.name, author.language, author.tags, sources, author);
    await saveAuthorProfile(projectRoot, updated);
  }
  await rebuildIndex(projectRoot);
}

export interface AuthorDiagnosticsEntry {
  readonly id: string;
  readonly authorId: string;
  readonly createdAt: string;
  readonly sampleAdequacy: string;
  readonly sourceHash: string;
  readonly heuristicRiskScore: number;
}

export async function saveAuthorDiagnostics(
  projectRoot: string,
  authorId: string,
  diagnosticsId: string,
  data: unknown,
): Promise<AuthorDiagnosticsEntry> {
  const safeAuthorId = assertSafeStyleId(authorId, "authorId");
  const safeDiagnosticsId = assertSafeStyleId(diagnosticsId, "diagnosticsId");
  const author = await loadAuthorProfile(projectRoot, safeAuthorId);
  if (!author) throw new Error(`Author not found: ${authorId}`);

  const entry: AuthorDiagnosticsEntry = {
    id: safeDiagnosticsId,
    authorId: safeAuthorId,
    createdAt: new Date().toISOString(),
    sampleAdequacy: (data as Record<string, unknown>)?.sampleAdequacy as string ?? "unknown",
    sourceHash: (data as Record<string, unknown>)?.sourceHash as string ?? "",
    heuristicRiskScore: (data as Record<string, unknown>)?.aiStyleTags ? ((data as Record<string, unknown>).aiStyleTags as Record<string, unknown>).heuristicRiskScore as number ?? 0 : 0,
  };

  await ensureDir(authorDiagnosticsDir(projectRoot, safeAuthorId));
  await writeJson(diagnosticsPath(projectRoot, safeAuthorId, safeDiagnosticsId), data);
  return entry;
}

export async function listAuthorDiagnostics(
  projectRoot: string,
  authorId: string,
): Promise<ReadonlyArray<AuthorDiagnosticsEntry>> {
  const safeAuthorId = assertSafeStyleId(authorId, "authorId");
  const dir = authorDiagnosticsDir(projectRoot, safeAuthorId);
  const entries: AuthorDiagnosticsEntry[] = [];
  try {
    const files = await readdir(dir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const data = await readJsonSafe<Record<string, unknown>>(join(dir, file));
      if (!data) continue;
      const id = file.replace(/\.json$/, "");
      const aiStyleTags = data.aiStyleTags as Record<string, unknown> | undefined;
      entries.push({
        id,
        authorId: safeAuthorId,
        createdAt: (data.createdAt as string) ?? new Date().toISOString(),
        sampleAdequacy: (data.sampleAdequacy as string) ?? "unknown",
        sourceHash: (data.sourceHash as string) ?? "",
        heuristicRiskScore: (aiStyleTags?.heuristicRiskScore as number) ?? 0,
      });
    }
  } catch {
    // no diagnostics yet
  }
  entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return entries;
}

export async function getAuthorDiagnostics(
  projectRoot: string,
  authorId: string,
  diagnosticsId: string,
): Promise<unknown | null> {
  const safeAuthorId = assertSafeStyleId(authorId, "authorId");
  const safeDiagnosticsId = assertSafeStyleId(diagnosticsId, "diagnosticsId");
  return readJsonSafe<unknown>(diagnosticsPath(projectRoot, safeAuthorId, safeDiagnosticsId));
}
