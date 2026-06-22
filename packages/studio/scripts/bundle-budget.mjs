/**
 * Bundle budget check for Studio.
 * Run after `pnpm build` to verify output sizes stay within limits.
 *
 * Limits (Updated 0618 P2-1 for realistic AI/rendering dep sizes):
 *   - Total JS:   < 18,000 KB (includes all async chunks)
 *   - Total CSS:  < 300 KB
 *   - Max chunk:  < 1,700 KB (critical path only; streamdown/mermaid ~1.6MB)
 *   - Total dist: < 15,500 KB
 */

import { readdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { createHash } from "node:crypto";

const DIST = join(import.meta.dirname, "..", "dist");
const LIMITS = {
  maxTotalJS: 18_000_000,
  maxTotalCSS: 300_000,
  maxChunk: 1_700_000,
  maxTotalDist: 15_500_000,
};

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await collectFiles(full));
    } else {
      const s = await stat(full);
      results.push({ path: full, size: s.size, ext: extname(entry.name).toLowerCase() });
    }
  }
  return results;
}

async function main() {
  const files = await collectFiles(DIST);

  const jsFiles = files.filter((f) => f.ext === ".js");
  const cssFiles = files.filter((f) => f.ext === ".css");
  const totalJS = jsFiles.reduce((sum, f) => sum + f.size, 0);
  const totalCSS = cssFiles.reduce((sum, f) => sum + f.size, 0);
  const totalDist = files.reduce((sum, f) => sum + f.size, 0);
  const maxChunk = Math.max(...files.map((f) => f.size));

  const errors = [];

  if (totalJS > LIMITS.maxTotalJS) {
    errors.push(`Total JS ${(totalJS / 1000).toFixed(1)}KB exceeds limit ${(LIMITS.maxTotalJS / 1000).toFixed(1)}KB`);
  }
  if (totalCSS > LIMITS.maxTotalCSS) {
    errors.push(`Total CSS ${(totalCSS / 1000).toFixed(1)}KB exceeds limit ${(LIMITS.maxTotalCSS / 1000).toFixed(1)}KB`);
  }
  if (maxChunk > LIMITS.maxChunk) {
    const culprit = files.find((f) => f.size === maxChunk);
    errors.push(`Max chunk ${(maxChunk / 1000).toFixed(1)}KB exceeds limit ${(LIMITS.maxChunk / 1000).toFixed(1)}KB (${culprit?.path ?? "unknown"})`);
  }
  if (totalDist > LIMITS.maxTotalDist) {
    errors.push(`Total dist ${(totalDist / 1000).toFixed(1)}KB exceeds limit ${(LIMITS.maxTotalDist / 1000).toFixed(1)}KB`);
  }

  console.log(`Bundle sizes:`);
  console.log(`  JS:   ${(totalJS / 1000).toFixed(1)} KB / ${(LIMITS.maxTotalJS / 1000).toFixed(0)} KB`);
  console.log(`  CSS:  ${(totalCSS / 1000).toFixed(1)} KB / ${(LIMITS.maxTotalCSS / 1000).toFixed(0)} KB`);
  console.log(`  Max:  ${(maxChunk / 1000).toFixed(1)} KB / ${(LIMITS.maxChunk / 1000).toFixed(0)} KB`);
  console.log(`  Dist: ${(totalDist / 1000).toFixed(1)} KB / ${(LIMITS.maxTotalDist / 1000).toFixed(0)} KB`);

  if (errors.length > 0) {
    console.error(`\n❌ Bundle budget exceeded:`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`\n✅ Bundle budget OK`);
}

main().catch((e) => { console.error(e); process.exit(1); });
