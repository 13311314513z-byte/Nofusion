/**
 * Author sample writer — write fetched author samples as local MD files.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SampleMeta {
  readonly authorId: string;
  readonly authorName: string;
  readonly sourceUrl: string;
  readonly fetchedAt: string;
  readonly content: string;
  readonly charCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 100);
}

function extractTitle(url: string): string {
  try {
    const u = new URL(url);
    // Use last path segment as title, or hostname
    const segments = u.pathname.split("/").filter(Boolean);
    return segments.length > 0 ? segments[segments.length - 1].replace(/\.(html|htm)$/i, "") : u.hostname;
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Update sources index
// ---------------------------------------------------------------------------

interface SampleSourcesIndex {
  readonly samples: ReadonlyArray<{
    readonly fileName: string;
    readonly sourceUrl: string;
    readonly fetchedAt: string;
    readonly charCount: number;
  }>;
}

async function updateSampleSourcesIndex(
  sampleDir: string,
  entry: { fileName: string; sourceUrl: string; fetchedAt: string; charCount: number },
): Promise<void> {
  const indexPath = join(sampleDir, "sources.json");
  let index: SampleSourcesIndex;
  try {
    const existing = await import("node:fs/promises").then((m) => m.readFile(indexPath, "utf-8"));
    index = JSON.parse(existing) as SampleSourcesIndex;
  } catch {
    index = { samples: [] };
  }
  index = {
    samples: [...index.samples, entry],
  };
  await writeFile(indexPath, JSON.stringify(index, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Update author sample index (index.md)
// ---------------------------------------------------------------------------

async function updateAuthorSampleIndex(
  sampleDir: string,
  authorName: string,
  _authorId: string,
): Promise<void> {
  const indexPath = join(sampleDir, "..", "index.md");
  let existingContent = "";
  try {
    existingContent = await import("node:fs/promises").then((m) => m.readFile(indexPath, "utf-8"));
  } catch { /* file doesn't exist yet */ }

  // Read current samples
  let sampleCount = 0;
  let totalChars = 0;
  try {
    const sourcesIndex = await import("node:fs/promises")
      .then((m) => m.readFile(join(sampleDir, "sources.json"), "utf-8"))
      .then((c) => JSON.parse(c) as SampleSourcesIndex);
    sampleCount = sourcesIndex.samples.length;
    totalChars = sourcesIndex.samples.reduce((s, e) => s + e.charCount, 0);
  } catch { /* no sources index yet */ }

  const header = `# 作家文风档案：${authorName}

> 自动生成于 ${new Date().toISOString().slice(0, 10)} | 样本数: ${sampleCount} | 总字数: ${totalChars.toLocaleString()}

## 来源链接

`;

  // Build source links
  let linksSection = "";
  try {
    const sourcesIndex = await import("node:fs/promises")
      .then((m) => m.readFile(join(sampleDir, "sources.json"), "utf-8"))
      .then((c) => JSON.parse(c) as SampleSourcesIndex);
    linksSection = sourcesIndex.samples
      .map((s) => `- [${s.fileName.replace(/\.md$/, "")}](${s.sourceUrl}) — ${s.fetchedAt.slice(0, 10)} 抓取`)
      .join("\n");
  } catch { /* no sources yet */ }

  const content = header + linksSection + "\n";
  // Only write if content has changed
  if (content !== existingContent) {
    await writeFile(indexPath, content, "utf-8");
  }
}

// ---------------------------------------------------------------------------
// Main write function
// ---------------------------------------------------------------------------

/**
 * Write a fetched author sample to local MD file.
 * Returns the file path of the written sample.
 */
export async function writeAuthorSample(
  root: string,
  meta: SampleMeta,
): Promise<{ filePath: string }> {
  const sampleDir = join(root, "style-library", "authors", meta.authorId, "samples");
  await mkdir(sampleDir, { recursive: true });

  const dateStr = meta.fetchedAt.slice(0, 10).replace(/-/g, "");
  const fileName = `${dateStr}_${sanitizeFileName(extractTitle(meta.sourceUrl))}.md`;
  const filePath = join(sampleDir, fileName);

  const content = [
    `# 样本：${extractTitle(meta.sourceUrl)}`,
    "",
    `**来源：** ${meta.sourceUrl}`,
    `**抓取时间：** ${meta.fetchedAt}`,
    `**字数：** ${meta.charCount.toLocaleString()}`,
    `**文件类型：** 互联网抓取`,
    "",
    "---",
    "",
    meta.content,
    "",
    "---",
    "",
    "*本文档由 InkOS Studio 自动生成，原文版权归原作者所有。*",
    "",
  ].join("\n");

  await writeFile(filePath, content, "utf-8");

  // Update sources.json metadata index
  await updateSampleSourcesIndex(sampleDir, {
    fileName,
    sourceUrl: meta.sourceUrl,
    fetchedAt: meta.fetchedAt,
    charCount: meta.charCount,
  });

  // Update index.md summary card
  await updateAuthorSampleIndex(sampleDir, meta.authorName, meta.authorId);

  return { filePath };
}
