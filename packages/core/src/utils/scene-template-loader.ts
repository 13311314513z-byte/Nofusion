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

/**
 * Scene template record consumed by the Planner.
 * Mirrors the fields from SceneTemplateSchema (scene-template.ts) so
 * that templates saved via the API are directly consumable without
 * field translation.
 */
export interface SceneTemplateRecord {
  readonly id: string;
  readonly name: string;
  /** Scene type tag (e.g. "药房取药", "军营审讯"). */
  readonly type?: string;
  /** Physical location. */
  readonly location?: string;
  /** Atmospheric / emotional tone — used as "mood" in Planner prompt. */
  readonly atmosphere?: string;
  /** Notable props. */
  readonly props?: ReadonlyArray<string>;
  /** Recurring routines or rituals — used as "beats" in Planner prompt. */
  readonly routines?: ReadonlyArray<string>;
  /** Default characters who appear in this scene type. */
  readonly defaultCharacters?: ReadonlyArray<string>;
  /** Free-form notes — used as "description" in Planner prompt. */
  readonly notes?: string;
  /** Tags for categorization (derived from type + linkedScene names). */
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
    const location = tpl.location ? ` · ${tpl.location}` : "";
    const atmosphere = tpl.atmosphere ? ` · ${tpl.atmosphere}` : "";
    lines.push(`### ${tpl.name}${location}${atmosphere}`);
    lines.push("");

    if (tpl.notes) {
      lines.push(tpl.notes);
      lines.push("");
    }

    const routines = tpl.routines ?? [];
    if (routines.length > 0) {
      lines.push(isEn ? "**Routines / Beats:**" : "**套路 / 节拍：**");
      for (const r of routines) {
        lines.push(`- ${r}`);
      }
      lines.push("");
    }

    const props = tpl.props ?? [];
    if (props.length > 0) {
      lines.push(isEn ? "**Props:**" : "**道具：**");
      lines.push(`  ${props.join("、")}`);
      lines.push("");
    }

    const characters = tpl.defaultCharacters ?? [];
    if (characters.length > 0) {
      lines.push(isEn ? "**Default Characters:**" : "**默认角色：**");
      lines.push(`  ${characters.join("、")}`);
      lines.push("");
    }

    const tags: string[] = [];
    if (tpl.type) tags.push(tpl.type);
    if (tpl.tags) tags.push(...tpl.tags);
    if (tags.length > 0) {
      lines.push(`> ${isEn ? "Tags" : "标签"}：${tags.join("、")}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}
