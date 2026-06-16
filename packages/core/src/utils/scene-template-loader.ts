/**
 * scene-template-loader.ts — Load scene templates for Planner consumption (M5).
 *
 * Scene templates are author-defined reusable scene patterns stored at
 * books/<bookId>/story/sources/scene_templates.json. The Planner reads them
 * to enrich the memo prompt with available narrative patterns.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

// ─── Types ──────────────────────────────────────────────────────────

export interface SceneTemplateRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Structural beats that define this template's narrative shape. */
  readonly beats: ReadonlyArray<string>;
  /** Emotional tone of the template. */
  readonly mood?: string;
  /** Suggested pacing. */
  readonly pacing?: "slow" | "medium" | "fast";
  /** Tags for categorization. */
  readonly tags?: ReadonlyArray<string>;
}

export interface SceneTemplatesIndex {
  readonly templates: ReadonlyArray<SceneTemplateRecord>;
  readonly updatedAt: string;
}

// ─── Loader ─────────────────────────────────────────────────────────

/**
 * Load scene templates from a book's state directory.
 * Returns an empty array if the file doesn't exist or is unparseable.
 */
export async function loadSceneTemplates(
  bookDir: string,
): Promise<ReadonlyArray<SceneTemplateRecord>> {
  try {
    const raw = await readFile(
      join(bookDir, "story", "sources", "scene_templates.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw) as SceneTemplatesIndex;
    return Array.isArray(parsed.templates) ? parsed.templates : [];
  } catch {
    return [];
  }
}

/**
 * Build a Markdown block describing available scene templates
 * for injection into the Planner's memo prompt.
 */
export function buildSceneTemplatesBlock(
  templates: ReadonlyArray<SceneTemplateRecord>,
  lang: "zh" | "en" = "zh",
): string {
  if (templates.length === 0) return "";

  const isEn = lang === "en";
  const lines: string[] = [];

  lines.push(
    isEn
      ? "## Available Scene Templates"
      : "## 可用场景模板",
  );
  lines.push("");

  for (const tpl of templates) {
    const mood = tpl.mood ? ` · ${tpl.mood}` : "";
    const pacing = tpl.pacing
      ? (isEn ? ` · pacing: ${tpl.pacing}` : ` · 节奏：${tpl.pacing}`)
      : "";
    lines.push(`### ${tpl.name}${mood}${pacing}`);
    lines.push("");
    lines.push(tpl.description);
    lines.push("");
    if (tpl.beats.length > 0) {
      lines.push(isEn ? "**Beats:**" : "**节拍：**");
      for (const beat of tpl.beats) {
        lines.push(`- ${beat}`);
      }
      lines.push("");
    }
    if (tpl.tags?.length) {
      lines.push(`> ${isEn ? "Tags" : "标签"}：${tpl.tags.join("、")}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}
