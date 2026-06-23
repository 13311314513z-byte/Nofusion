import { EPub } from "epub-gen-memory";
import { mkdir,readFile,readdir,writeFile } from "node:fs/promises";
import { dirname,join } from "node:path";

export interface ExportStateLike {
  readonly bookDir: (bookId: string) => string;
  readonly loadBookConfig: (bookId: string) => Promise<{ readonly title: string; readonly language?: string }>;
  readonly loadChapterIndex: (bookId: string) => Promise<ReadonlyArray<{
    readonly number: number;
    readonly status: string;
    readonly wordCount: number;
  }>>;
}

export interface ExportArtifact {
  readonly outputPath: string;
  readonly fileName: string;
  readonly chaptersExported: number;
  readonly totalWords: number;
  readonly format: "txt" | "md" | "epub" | "html";
  readonly contentType: string;
  readonly payload: string | Buffer;
}

function buildChapterFileLookup(files: ReadonlyArray<string>): ReadonlyMap<number, string> {
  const lookup = new Map<number, string>();
  for (const file of files) {
    if (!file.endsWith(".md") || !/^\d{4}/.test(file)) {
      continue;
    }
    const chapterNumber = parseInt(file.slice(0, 4), 10);
    if (!lookup.has(chapterNumber)) {
      lookup.set(chapterNumber, file);
    }
  }
  return lookup;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function markdownToSimpleHtml(markdown: string): { title: string; html: string } {
  const title = markdown.match(/^#\s+(.+)/m)?.[1]?.trim() ?? "Untitled Chapter";
  const html = markdown
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("\n");
  return { title, html };
}

export async function buildExportArtifact(
  state: ExportStateLike,
  bookId: string,
  options: {
    readonly format?: "txt" | "md" | "epub" | "html";
    readonly approvedOnly?: boolean;
    readonly outputPath?: string;
  },
): Promise<ExportArtifact> {
  const format = options.format ?? "txt";
  const index = await state.loadChapterIndex(bookId);
  const book = await state.loadBookConfig(bookId);
  const chapters = options.approvedOnly
    ? index.filter((chapter) => chapter.status === "approved")
    : index;

  if (chapters.length === 0) {
    throw new Error("No chapters to export.");
  }

  const bookDir = state.bookDir(bookId);
  const chaptersDir = join(bookDir, "chapters");
  const projectRoot = dirname(dirname(bookDir));
  const outputPath = options.outputPath ?? join(projectRoot, `${bookId}_export.${format}`);
  const chapterFiles = buildChapterFileLookup(await readdir(chaptersDir));
  const totalWords = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);

  if (format === "epub") {
    const epubChapters: Array<{ title: string; content: string }> = [];
    for (const chapter of chapters) {
      const match = chapterFiles.get(chapter.number);
      if (!match) {
        continue;
      }
      const markdown = await readFile(join(chaptersDir, match), "utf-8");
      const { title, html } = markdownToSimpleHtml(markdown);
      epubChapters.push({ title, content: html });
    }
    const epubInstance = new EPub(
      { title: book.title, lang: book.language === "en" ? "en" : "zh-CN" },
      epubChapters,
    );
    return {
      outputPath,
      fileName: `${bookId}.epub`,
      chaptersExported: chapters.length,
      totalWords,
      format,
      contentType: "application/epub+zip",
      payload: await epubInstance.genEpub(),
    };
  }

  // Build TOC for html/md; for txt just use plain title
  const _hasToc = format === "md" || format === "html";
  const parts: string[] = [];

  if (format === "html") {
    parts.push(`<!DOCTYPE html><html lang="${book.language === "en" ? "en" : "zh-CN"}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${escapeHtml(book.title)}</title>`);
    parts.push("<style>body{font-family:system-ui,-apple-system,sans-serif;line-height:1.8;max-width:720px;margin:40px auto;padding:0 20px;color:#1a1a1a}h1{font-size:1.8em;border-bottom:2px solid #eee;padding-bottom:.3em}h2{font-size:1.3em;margin-top:1.5em}.toc{background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:16px 24px;margin:24px 0}.toc h2{margin-top:0;font-size:1.1em}.toc a{display:block;padding:4px 0;color:#2563eb;text-decoration:none}.toc a:hover{text-decoration:underline}pre{white-space:pre-wrap;word-wrap:break-word;font-family:inherit;line-height:inherit}p{margin:.6em 0}hr{border:none;border-top:1px solid #eee;margin:1.5em 0}@media(prefers-color-scheme:dark){body{background:#121212;color:#e0e0e0}.toc{background:#1e1e1e;border-color:#333}.toc a{color:#60a5fa}h1{border-bottom-color:#333}}");
    parts.push(`</style></head><body><h1>${escapeHtml(book.title)}</h1>`);
    parts.push(`<div class="toc"><h2>目录</h2>`);
    for (const chapter of chapters) {
      const match = chapterFiles.get(chapter.number);
      if (!match) continue;
      const markdown = await readFile(join(chaptersDir, match), "utf-8");
      const { title } = markdownToSimpleHtml(markdown);
      parts.push(`<a href="#ch${chapter.number}">第${chapter.number}章 ${escapeHtml(title)}</a>`);
    }
    parts.push(`</div>`);
    for (const chapter of chapters) {
      const match = chapterFiles.get(chapter.number);
      if (!match) continue;
      const markdown = await readFile(join(chaptersDir, match), "utf-8");
      const { title, html } = markdownToSimpleHtml(markdown);
      parts.push(`<h2 id="ch${chapter.number}">第${chapter.number}章 ${escapeHtml(title)}</h2>\n${html}`);
    }
    parts.push(`</body></html>`);
  } else {
    parts.push(format === "md" ? `# ${book.title}\n\n---\n` : `${book.title}\n\n`);
    for (const chapter of chapters) {
      const match = chapterFiles.get(chapter.number);
      if (!match) continue;
      parts.push(await readFile(join(chaptersDir, match), "utf-8"));
      parts.push("\n\n");
    }
  }

  const contentTypeMap: Record<string, string> = {
    md: "text/markdown; charset=utf-8",
    html: "text/html; charset=utf-8",
    txt: "text/plain; charset=utf-8",
  };

  return {
    outputPath,
    fileName: `${bookId}.${format}`,
    chaptersExported: chapters.length,
    totalWords,
    format,
    contentType: contentTypeMap[format] ?? "text/plain; charset=utf-8",
    payload: format === "html"
      ? parts.join("")
      : format === "md"
        ? parts.join("\n---\n\n")
        : parts.join("\n"),
  };
}

export async function writeExportArtifact(
  state: ExportStateLike,
  bookId: string,
  options: {
    readonly format?: "txt" | "md" | "epub" | "html";
    readonly approvedOnly?: boolean;
    readonly outputPath?: string;
  },
): Promise<Omit<ExportArtifact, "payload" | "contentType" | "fileName">> {
  const artifact = await buildExportArtifact(state, bookId, options);
  await mkdir(dirname(artifact.outputPath), { recursive: true });
  await writeFile(artifact.outputPath, artifact.payload);
  return {
    outputPath: artifact.outputPath,
    chaptersExported: artifact.chaptersExported,
    totalWords: artifact.totalWords,
    format: artifact.format,
  };
}
