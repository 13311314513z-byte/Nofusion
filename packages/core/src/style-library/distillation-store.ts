/**
 * Distillation store — file-based persistence for distillation drafts, evidence, and versions.
 *
 * Directory structure under style-library/authors/{authorId}/:
 *   distillation/
 *     current.json       ← 当前草稿或发布（指向 versions/{version}.json）
 *     current.md         ← Markdown 投影
 *     evidence.json      ← 样本证据
 *     overrides.json     ← 人工覆盖
 *     versions/
 *       1.json
 *       1.md
 *       ...
 */

import { mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { join, basename } from "node:path";
import type {
  AuthorDistillation,
  DistillationEvidence,
  DistillationStatus,
  DistillationRule,
} from "./models.js";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function distillationDir(root: string, authorId: string): string {
  return join(root, "style-library", "authors", authorId, "distillation");
}

function currentJsonPath(root: string, authorId: string): string {
  return join(distillationDir(root, authorId), "current.json");
}

function currentMdPath(root: string, authorId: string): string {
  return join(distillationDir(root, authorId), "current.md");
}

function evidencePath(root: string, authorId: string): string {
  return join(distillationDir(root, authorId), "evidence.json");
}

function overridesPath(root: string, authorId: string): string {
  return join(distillationDir(root, authorId), "overrides.json");
}

function versionDir(root: string, authorId: string): string {
  return join(distillationDir(root, authorId), "versions");
}

function versionJsonPath(root: string, authorId: string, version: number): string {
  return join(versionDir(root, authorId), `${version}.json`);
}

function versionMdPath(root: string, authorId: string, version: number): string {
  return join(versionDir(root, authorId), `${version}.md`);
}

// ---------------------------------------------------------------------------
// Safe JSON read
// ---------------------------------------------------------------------------

async function readJsonSafe<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Current distillation (draft or published)
// ---------------------------------------------------------------------------

export async function loadCurrentDistillation(
  root: string,
  authorId: string,
): Promise<AuthorDistillation | null> {
  return readJsonSafe<AuthorDistillation>(currentJsonPath(root, authorId));
}

export async function saveDistillationDraft(
  root: string,
  authorId: string,
  distillation: AuthorDistillation,
  markdown: string,
): Promise<void> {
  const dir = distillationDir(root, authorId);
  await mkdir(dir, { recursive: true });

  await writeFile(currentJsonPath(root, authorId), JSON.stringify(distillation, null, 2), "utf-8");
  await writeFile(currentMdPath(root, authorId), markdown, "utf-8");
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export async function loadDistillationEvidence(
  root: string,
  authorId: string,
): Promise<ReadonlyArray<DistillationEvidence>> {
  const data = await readJsonSafe<{ evidence: DistillationEvidence[] }>(evidencePath(root, authorId));
  return data?.evidence ?? [];
}

export async function saveDistillationEvidence(
  root: string,
  authorId: string,
  evidence: ReadonlyArray<DistillationEvidence>,
): Promise<void> {
  const dir = distillationDir(root, authorId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    evidencePath(root, authorId),
    JSON.stringify({ evidence }, null, 2),
    "utf-8",
  );
}

// ---------------------------------------------------------------------------
// Manual overrides
// ---------------------------------------------------------------------------

export async function loadDistillationOverrides(
  root: string,
  authorId: string,
): Promise<ReadonlyArray<DistillationRule>> {
  const data = await readJsonSafe<{ overrides: DistillationRule[] }>(overridesPath(root, authorId));
  return data?.overrides ?? [];
}

export async function saveDistillationOverrides(
  root: string,
  authorId: string,
  overrides: ReadonlyArray<DistillationRule>,
): Promise<void> {
  const dir = distillationDir(root, authorId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    overridesPath(root, authorId),
    JSON.stringify({ overrides }, null, 2),
    "utf-8",
  );
}

// ---------------------------------------------------------------------------
// Version management
// ---------------------------------------------------------------------------

export async function publishDistillation(
  root: string,
  authorId: string,
  distillation: AuthorDistillation,
  markdown: string,
): Promise<AuthorDistillation> {
  const published: AuthorDistillation = {
    ...distillation,
    status: "published",
    publishedAt: new Date().toISOString(),
    version: distillation.version,
  };

  // Create versioned files
  const vDir = versionDir(root, authorId);
  await mkdir(vDir, { recursive: true });
  await writeFile(versionJsonPath(root, authorId, published.version), JSON.stringify(published, null, 2), "utf-8");
  await writeFile(versionMdPath(root, authorId, published.version), markdown, "utf-8");

  // Update current pointer
  await saveDistillationDraft(root, authorId, published, markdown);

  // Clean old current.md (it's now versioned)
  return published;
}

export async function listDistillationVersions(
  root: string,
  authorId: string,
): Promise<ReadonlyArray<number>> {
  const vDir = versionDir(root, authorId);
  try {
    const entries = await readdir(vDir);
    const versions = entries
      .filter((f) => f.endsWith(".json"))
      .map((f) => parseInt(basename(f, ".json"), 10))
      .filter((n) => !isNaN(n))
      .sort((a, b) => b - a);
    return versions;
  } catch {
    return [];
  }
}

export async function loadDistillationVersion(
  root: string,
  authorId: string,
  version: number,
): Promise<AuthorDistillation | null> {
  return readJsonSafe<AuthorDistillation>(versionJsonPath(root, authorId, version));
}

// ---------------------------------------------------------------------------
// Status check
// ---------------------------------------------------------------------------

export interface DistillationStatusInfo {
  readonly exists: boolean;
  readonly status: DistillationStatus | null;
  readonly version: number | null;
  readonly authorProfileVersion: number | null;
  readonly isStale: boolean;
  readonly currentAuthorProfileVersion: number;
}

export async function getDistillationStatus(
  root: string,
  authorId: string,
  currentAuthorProfileVersion: number,
): Promise<DistillationStatusInfo> {
  const current = await loadCurrentDistillation(root, authorId);
  if (!current) {
    return {
      exists: false,
      status: null,
      version: null,
      authorProfileVersion: null,
      isStale: false,
      currentAuthorProfileVersion,
    };
  }

  return {
    exists: true,
    status: current.status,
    version: current.version,
    authorProfileVersion: current.authorProfileVersion,
    isStale: current.authorProfileVersion !== currentAuthorProfileVersion,
    currentAuthorProfileVersion,
  };
}
