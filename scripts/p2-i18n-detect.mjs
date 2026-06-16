/**
 * P2-2: Hardcoded Chinese string detector
 *
 * Scans Studio source files for hardcoded Chinese strings that should
 * be extracted to use-i18n.ts for proper zh/en bilingual support.
 *
 * Usage: node scripts/p2-i18n-detect.mjs
 * Output: reports/p2-i18n-report.txt
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const srcDir = join(projectRoot, "packages", "studio", "src");

// Chinese character range: \u4e00-\u9fff
const CHINESE_RE = /[\u4e00-\u9fff]{2,}/g;

// Files to skip (test files, already i18n'd)
const SKIP_PATTERNS = [
  /\.test\.tsx?$/,
  /use-i18n\.ts$/,
  /node_modules/,
];

// (Type annotations removed for .mjs compatibility)

async function scanDir(dir, findings) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      await scanDir(fullPath, findings);
    } else if (entry.isFile() && /\.(tsx|ts)$/.test(entry.name)) {
      if (SKIP_PATTERNS.some(p => p.test(fullPath))) continue;
      const content = await readFile(fullPath, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip comments and i18n calls
        if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) continue;
        if (/\bt\(["']/.test(line) || /\bi18n\(/.test(line)) continue;
        // Find Chinese strings NOT inside t() calls
        const cleaned = line.replace(/\bt\(["'][^"']*["']\)/g, ""); // Remove t("...") calls
        const matches = cleaned.match(CHINESE_RE);
        if (matches) {
          for (const match of matches) {
            if (match.length >= 2) {
              findings.push({ file: fullPath.replace(projectRoot, ""), line: i + 1, text: match });
            }
          }
        }
      }
    }
  }
}

async function main() {
  console.log("P2-2: Scanning for hardcoded Chinese strings...");
  const findings: Finding[] = [];
  await scanDir(srcDir, findings);

  // Group by file
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byFile.get(f.file) || [];
    list.push(f);
    byFile.set(f.file, list);
  }

  // Generate report
  const lines: string[] = [
    "# P2-2: Hardcoded Chinese String Report",
    `# Generated: ${new Date().toISOString()}`,
    `# Total findings: ${findings.length} across ${byFile.size} files`,
    "",
  ];

  for (const [file, items] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`## ${file} (${items.length} strings)`);
    lines.push("");
    for (const item of items.slice(0, 5)) { // Show first 5 per file
      lines.push(`  L${item.line}: "${item.text}"`);
    }
    if (items.length > 5) lines.push(`  ... and ${items.length - 5} more`);
    lines.push("");
  }

  const reportPath = join(projectRoot, "reports", "p2-i18n-report.txt");
  await writeFile(reportPath, lines.join("\n"), "utf-8");
  console.log(`Report written to ${reportPath}`);
  console.log(`Total: ${findings.length} strings in ${byFile.size} files`);
}

main().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
