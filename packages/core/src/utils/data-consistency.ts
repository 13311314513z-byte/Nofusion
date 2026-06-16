/**
 * Data Consistency Utilities — validation functions for cross-file
 * consistency checks within a BookWorkspace.
 *
 * These utilities verify that runtime artifacts, truth files, and
 * chapter data remain internally consistent. They are invoked by
 * the pipeline runner after each write cycle.
 *
 * @module
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

// ─── Types ─────────────────────────────────────────────────────────

export interface ConsistencyIssue {
  readonly severity: "error" | "warning" | "info";
  readonly code: string;
  readonly message: string;
  readonly file?: string;
  readonly expectedValue?: string;
  readonly actualValue?: string;
}

export interface ConsistencyReport {
  readonly ok: boolean;
  readonly issues: ReadonlyArray<ConsistencyIssue>;
  readonly checkedAt: string;
  readonly durationMs: number;
}

// ─── Check functions ───────────────────────────────────────────────

/**
 * Verify that every chapter-NNNN directory under runtime/ has the
 * required artifacts (intent, plan, context, trace).
 */
export async function checkRuntimeArtifactCompleteness(
  runtimeDir: string,
): Promise<ConsistencyIssue[]> {
  const issues: ConsistencyIssue[] = [];
  const required = ["intent", "plan", "context", "trace"] as const;

  try {
    const dirs = await readdir(runtimeDir);
    const chapterDirs = dirs.filter(d => /^chapter-\d{4}$/.test(d));

    for (const dir of chapterDirs) {
      const chapterDir = join(runtimeDir, dir);
      const files = await readdir(chapterDir).catch(() => [] as string[]);

      for (const req of required) {
        const hasFile = files.some(f => f.startsWith(`${req}.`) || f.includes(`.${req}.`));
        if (!hasFile) {
          issues.push({
            severity: "warning",
            code: "MISSING_RUNTIME_ARTIFACT",
            message: `${dir} 缺少 ${req} 产物`,
            file: join(dir, `${req}.*`),
          });
        }
      }
    }
  } catch {
    // runtimeDir doesn't exist — not an error
  }

  return issues;
}

/**
 * Verify that chapter approval count ≤ runtime chapter count.
 */
export async function checkChapterCountConsistency(
  bookDir: string,
  approvedCount: number,
  runtimeChapterCount: number,
): Promise<ConsistencyIssue[]> {
  const issues: ConsistencyIssue[] = [];

  if (approvedCount > runtimeChapterCount) {
    issues.push({
      severity: "error",
      code: "APPROVED_EXCEEDS_RUNTIME",
      message: `已通过章节数 (${approvedCount}) 超过运行产物章数 (${runtimeChapterCount})`,
      expectedValue: String(runtimeChapterCount),
      actualValue: String(approvedCount),
    });
  }

  return issues;
}

/**
 * Verify that hook references in truth/ are not dangling.
 */
export async function checkHookReferences(
  hooksIndexPath: string,
  truthDir: string,
): Promise<ConsistencyIssue[]> {
  const issues: ConsistencyIssue[] = [];

  try {
    const hooksRaw = await readFile(hooksIndexPath, "utf-8");
    const hooksData = JSON.parse(hooksRaw) as { hooks?: Array<{ id: string }> };
    const hookIds = new Set((hooksData.hooks ?? []).map(h => h.id));

    // Check truth files for references to non-existent hooks
    const truthFiles = await readdir(truthDir).catch(() => [] as string[]);
    for (const file of truthFiles) {
      if (!file.endsWith(".md")) continue;
      const content = await readFile(join(truthDir, file), "utf-8").catch(() => "");
      const hookRefs = content.match(/hook-[a-zA-Z0-9_-]+/g) ?? [];
      for (const ref of hookRefs) {
        if (!hookIds.has(ref)) {
          issues.push({
            severity: "warning",
            code: "DANGLING_HOOK_REFERENCE",
            message: `${file} 引用了不存在的伏笔 "${ref}"`,
            file,
          });
        }
      }
    }
  } catch {
    // Files don't exist — skip
  }

  return issues;
}

/**
 * Verify that role references in chapter files match role card index.
 */
export async function checkRoleReferences(
  rolesIndexPath: string,
  chaptersDir: string,
): Promise<ConsistencyIssue[]> {
  const issues: ConsistencyIssue[] = [];

  try {
    const rolesRaw = await readFile(rolesIndexPath, "utf-8");
    const rolesData = JSON.parse(rolesRaw) as { roles?: Array<{ id: string; name: string }> };
    const roleNames = new Set((rolesData.roles ?? []).map(r => r.name));

    const chapterFiles = await readdir(chaptersDir).catch(() => [] as string[]);
    for (const file of chapterFiles) {
      if (!file.endsWith(".md")) continue;
      const content = await readFile(join(chaptersDir, file), "utf-8").catch(() => "");
      // Chinese name references: "角色名说" pattern
      const nameRefs = content.match(/[\u4e00-\u9fff]{2,4}(?=说|道|问|喊|叫|嚷|答|应)/g) ?? [];
      for (const ref of [...new Set(nameRefs)]) {
        if (!roleNames.has(ref)) {
          issues.push({
            severity: "info",
            code: "UNCATALOGUED_CHARACTER_NAME",
            message: `章节 ${file} 中出现了未录入角色卡的对话者 "${ref}"`,
            file,
          });
        }
      }
    }
  } catch {
    // Skip
  }

  return issues;
}

/**
 * Run all consistency checks and return a unified report.
 */
export async function runConsistencyChecks(bookDir: string): Promise<ConsistencyReport> {
  const start = Date.now();
  const allIssues: ConsistencyIssue[] = [];

  const runtimeDir = join(bookDir, "story", "runtime");
  const truthDir = join(bookDir, "story", "truth");
  const chaptersDir = join(bookDir, "story", "chapters");
  const hooksIndexPath = join(bookDir, "story", "hooks", "index.json");
  const rolesIndexPath = join(bookDir, "story", "roles", "index.json");

  const [runtimeIssues, hookIssues, roleIssues] = await Promise.all([
    checkRuntimeArtifactCompleteness(runtimeDir),
    checkHookReferences(hooksIndexPath, truthDir),
    checkRoleReferences(rolesIndexPath, chaptersDir),
  ]);

  allIssues.push(...runtimeIssues, ...hookIssues, ...roleIssues);

  return {
    ok: allIssues.every(i => i.severity !== "error"),
    issues: allIssues,
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
  };
}
