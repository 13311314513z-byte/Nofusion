/**
 * Chapter Artifacts — versioned directory structure for per-chapter runtime products.
 *
 * Migrates from flat file naming (chapter-NNNN.plan.md) to versioned directory
 * (chapter-NNNN/plan.v{N}.yaml) with an INDEX.json for version tracking.
 *
 * Backward compatible: load functions fall back to flat paths when the
 * versioned directory does not exist.
 *
 * @module
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

// ─── Path helpers ───────────────────────────────────────────────────

/** Root directory for all chapter runtime artifacts in a book. */
export function runtimeDir(bookDir: string): string {
  return join(bookDir, "story", "runtime");
}

/** Versioned directory for a specific chapter. */
export function chapterArtifactDir(bookDir: string, chapterNumber: number): string {
  return join(runtimeDir(bookDir), `chapter-${String(chapterNumber).padStart(4, "0")}`);
}

// ─── Version index ──────────────────────────────────────────────────

export interface ArtifactIndex {
  /** Current version number (monotonically increasing). */
  currentVersion: number;
  /** List of artifact names tracked in this directory. */
  artifacts: string[];
  /** ISO timestamp of last update. */
  updatedAt: string;
}

const INDEX_FILENAME = "INDEX.json";

const DEFAULT_INDEX: ArtifactIndex = {
  currentVersion: 0,
  artifacts: [],
  updatedAt: new Date(0).toISOString(),
};

/** Read the INDEX.json for a chapter artifact directory. */
export async function readArtifactIndex(
  artifactDir: string,
): Promise<ArtifactIndex> {
  try {
    const raw = await readFile(join(artifactDir, INDEX_FILENAME), "utf-8");
    const parsed = JSON.parse(raw);
    return {
      currentVersion:
        typeof parsed.currentVersion === "number" && Number.isInteger(parsed.currentVersion)
          ? parsed.currentVersion
          : 0,
      artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : [],
      updatedAt:
        typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return { ...DEFAULT_INDEX };
  }
}

/** Get the latest version number for a chapter's artifacts. */
export async function getLatestVersion(artifactDir: string): Promise<number> {
  const index = await readArtifactIndex(artifactDir);
  return index.currentVersion;
}

/** Write (or update) the INDEX.json for a chapter artifact directory. */
export async function writeArtifactIndex(
  artifactDir: string,
  index: ArtifactIndex,
): Promise<void> {
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    join(artifactDir, INDEX_FILENAME),
    JSON.stringify({ ...index, updatedAt: new Date().toISOString() }, null, 2),
    "utf-8",
  );
}

// ─── Artifact I/O ───────────────────────────────────────────────────

/** Map artifact logical name to file extension. */
const ARTIFACT_EXTENSIONS: Record<string, string> = {
  plan: ".yaml",
  context: ".json",
  "rule-stack": ".yaml",
  trace: ".json",
  "event-chain": ".json",
};

function resolveExtension(artifactName: string): string {
  // Check known names first
  if (ARTIFACT_EXTENSIONS[artifactName]) return ARTIFACT_EXTENSIONS[artifactName];
  // Heuristic: if name already ends with known ext, keep it
  if (artifactName.endsWith(".yaml") || artifactName.endsWith(".yml")) return "";
  if (artifactName.endsWith(".json")) return "";
  if (artifactName.endsWith(".md")) return "";
  // Default to JSON for structured data
  return ".json";
}

/**
 * Save a versioned artifact.
 *
 * @example
 *   await saveArtifact(chapterDir, 3, "plan", yamlContent);
 *   // Writes: chapter-0005/plan.v3.yaml
 */
export async function saveArtifact(
  artifactDir: string,
  version: number,
  artifactName: string,
  content: string,
): Promise<void> {
  await mkdir(artifactDir, { recursive: true });
  const ext = resolveExtension(artifactName);
  const filePath = join(artifactDir, `${artifactName}.v${version}${ext}`);
  await writeFile(filePath, content, "utf-8");
}

/**
 * Read a specific version of an artifact.
 */
export async function readArtifact(
  artifactDir: string,
  version: number,
  artifactName: string,
): Promise<string | null> {
  const ext = resolveExtension(artifactName);
  const filePath = join(artifactDir, `${artifactName}.v${version}${ext}`);
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Read the latest version of an artifact.
 */
export async function readLatestArtifact(
  artifactDir: string,
  artifactName: string,
): Promise<{ version: number; content: string } | null> {
  const index = await readArtifactIndex(artifactDir);
  if (index.currentVersion === 0) return null;

  // Try from latest version downward
  for (let v = index.currentVersion; v >= 1; v--) {
    const content = await readArtifact(artifactDir, v, artifactName);
    if (content !== null) return { version: v, content };
  }
  return null;
}

// ─── Bump + save convenience ────────────────────────────────────────

/**
 * Save an artifact, auto-incrementing the version from INDEX.json.
 * Returns the new version number.
 */
export async function saveArtifactAutoVersion(
  artifactDir: string,
  artifactName: string,
  content: string,
): Promise<number> {
  const index = await readArtifactIndex(artifactDir);
  const newVersion = index.currentVersion + 1;

  await saveArtifact(artifactDir, newVersion, artifactName, content);

  // Update index
  const updatedArtifacts = index.artifacts.includes(artifactName)
    ? index.artifacts
    : [...index.artifacts, artifactName];

  await writeArtifactIndex(artifactDir, {
    currentVersion: newVersion,
    artifacts: updatedArtifacts,
    updatedAt: new Date().toISOString(),
  });

  return newVersion;
}

// ─── Backward-compatible flat-path fallback ─────────────────────────

/**
 * Determine the effective artifact path, preferring the versioned directory
 * but falling back to the legacy flat path if the directory does not exist.
 *
 * Legacy flat pattern: story/runtime/chapter-NNNN.{artifactName}.{ext}
 */
export function resolveArtifactPath(
  bookDir: string,
  chapterNumber: number,
  artifactName: string,
  version?: number,
): { path: string; isLegacy: boolean } {
  const dir = chapterArtifactDir(bookDir, chapterNumber);

  if (existsSync(dir)) {
    const ext = resolveExtension(artifactName);
    const v = version ?? 1;
    return {
      path: join(dir, `${artifactName}.v${v}${ext}`),
      isLegacy: false,
    };
  }

  // Fallback to legacy flat path
  const padded = String(chapterNumber).padStart(4, "0");
  const ext = resolveExtension(artifactName);
  return {
    path: join(runtimeDir(bookDir), `chapter-${padded}.${artifactName}${ext}`),
    isLegacy: true,
  };
}

// ─── Bulk operations ────────────────────────────────────────────────

/**
 * List all versions available for a specific artifact in a chapter directory.
 */
export async function listArtifactVersions(
  artifactDir: string,
  artifactName: string,
): Promise<number[]> {
  const index = await readArtifactIndex(artifactDir);
  if (index.currentVersion === 0) return [];

  const versions: number[] = [];
  // Check each version from 1 to current
  for (let v = 1; v <= index.currentVersion; v++) {
    const content = await readArtifact(artifactDir, v, artifactName);
    if (content !== null) versions.push(v);
  }
  return versions;
}
