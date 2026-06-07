/**
 * Document writer — export processed text to .txt / .md / .html.
 */

import { writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";

export type ExportFormat = "txt" | "md" | "html";

export interface ExportResult {
  readonly filePath: string;
  readonly format: ExportFormat;
  readonly charCount: number;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtml(text: string, options?: { title?: string; author?: string }): string {
  const paragraphs = text
    .split("\n\n")
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(options?.title ?? "Exported Document")}</title>
<style>
body { font-family: "Noto Serif CJK SC", "Source Han Serif SC", Georgia, serif; line-height: 1.8; max-width: 720px; margin: 48px auto; padding: 0 24px; color: #333; background: #fafafa; }
h1 { font-size: 1.8em; border-bottom: 1px solid #ddd; padding-bottom: 12px; margin-bottom: 24px; }
p { text-indent: 2em; margin: 0.8em 0; }
.meta { color: #888; font-size: 0.9em; margin-bottom: 32px; }
</style>
</head>
<body>
${options?.title ? `<h1>${escapeHtml(options.title)}</h1>` : ""}
${options?.author ? `<div class="meta">${escapeHtml(options.author)} · ${new Date().toLocaleDateString("zh-CN")}</div>` : ""}
${paragraphs}
</body>
</html>`;
}

/**
 * Export text to the specified format.
 */
export async function exportDocument(
  text: string,
  filePath: string,
  format: ExportFormat,
  options?: { title?: string; author?: string },
): Promise<ExportResult> {
  await mkdir(dirname(filePath), { recursive: true });

  switch (format) {
    case "txt":
      await writeFile(filePath, text, "utf-8");
      return { filePath, format, charCount: text.length };

    case "md": {
      const lines: string[] = [];
      if (options?.title) lines.push(`# ${options.title}\n`);
      if (options?.author) lines.push(`> ${options.author} · ${new Date().toLocaleDateString("zh-CN")}\n`);
      lines.push(text);
      await writeFile(filePath, lines.join("\n"), "utf-8");
      return { filePath, format, charCount: text.length };
    }

    case "html": {
      const html = buildHtml(text, options);
      await writeFile(filePath, html, "utf-8");
      return { filePath, format, charCount: text.length };
    }

    default:
      throw new Error(`Unsupported export format: ${format}`);
  }
}
