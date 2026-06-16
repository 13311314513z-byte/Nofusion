/**
 * Unified Markdown renderer — JSON → Markdown (one-way).
 *
 * Consolidates rendering functions previously scattered across:
 *   state-projections.ts / story-markdown.ts / planner.ts / narrative-control.ts
 *
 * Principle: JSON is the single source of truth. Markdown files are
 * rendering artifacts, never parsed back as authoritative data.
 *
 * @module
 */

import type {
  ChapterSummariesState,
  CurrentStateState,
  HooksState,
} from "../models/runtime-state.js";
import type { StoredHook, StoredSummary } from "../state/memory-db.js";
import type { AuthorChapterIntent, AuthorScenePlan, AuthorCharacterState } from "../models/chapter-intent.schema.js";
import type { ChapterGoalCard } from "../models/chapter-goal.js";
import {
  localizeHookPayoffTiming,
  resolveHookPayoffTiming,
} from "./hook-lifecycle.js";
import {
  computeHookDiagnostics,
  renderHookDiagnosticMarker,
} from "./hook-stale-detection.js";

// ─── Table helpers ─────────────────────────────────────────────────

function escapeTableCell(value: unknown): string {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function renderDependsOnCell(ids: ReadonlyArray<string>, language: "zh" | "en"): string {
  if (ids.length === 0) return language === "en" ? "none" : "无";
  return `[${ids.join(", ")}]`;
}

function renderCoreHookCell(isCore: boolean, language: "zh" | "en"): string {
  if (language === "en") return isCore ? "true" : "false";
  return isCore ? "是" : "否";
}

function renderHalfLifeCell(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "";
  return String(Math.trunc(value));
}

function renderPromotedCell(value: boolean | undefined, language: "zh" | "en"): string {
  if (value === undefined) return "";
  if (language === "en") return value ? "true" : "false";
  return value ? "是" : "否";
}

// ─── Hooks ─────────────────────────────────────────────────────────

/**
 * @deprecated Use renderHooksToMarkdown instead.
 * Kept for backward compatibility — re-exports the new function.
 */
export { renderHooksToMarkdown as renderHooksProjection };

export function renderHooksToMarkdown(
  state: HooksState,
  language: "zh" | "en" = "zh",
  options?: { readonly currentChapter?: number },
): string {
  const title = language === "en" ? "# Pending Hooks" : "# 伏笔池";
  const headers = language === "en"
    ? [
      "| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | payoff_timing | depends_on | pays_off_in_arc | core_hook | half_life | promoted | notes |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    : [
      "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 回收节奏 | 上游依赖 | 回收卷 | 核心 | 半衰期 | 升级 | 备注 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ];

  const currentChapter = options?.currentChapter;
  const diagnostics = typeof currentChapter === "number"
    ? computeHookDiagnostics({ hooks: state.hooks, currentChapter })
    : null;

  const rows = [...state.hooks]
    .sort((left, right) => (
      left.startChapter - right.startChapter
      || left.lastAdvancedChapter - right.lastAdvancedChapter
      || left.hookId.localeCompare(right.hookId)
    ))
    .map((hook) => {
      const diag = diagnostics?.get(hook.hookId);
      const marker = diag ? renderHookDiagnosticMarker(diag, language) : "";
      const statusCell = marker
        ? `${hook.status} (${marker})`
        : hook.status;
      return `| ${[
        hook.hookId,
        hook.startChapter,
        hook.type,
        statusCell,
        hook.lastAdvancedChapter,
        hook.expectedPayoff,
        localizeHookPayoffTiming(resolveHookPayoffTiming(hook), language),
        renderDependsOnCell(hook.dependsOn ?? [], language),
        hook.paysOffInArc ?? "",
        renderCoreHookCell(hook.coreHook === true, language),
        renderHalfLifeCell(hook.halfLifeChapters),
        renderPromotedCell(hook.promoted, language),
        hook.notes,
      ].map(escapeTableCell).join(" | ")} |`;
    });

  return [title, "", ...headers, ...rows, ""].join("\n");
}

/** Render hooks as a compact snapshot (for prompt injection). */
export function renderHookSnapshot(
  hooks: ReadonlyArray<StoredHook>,
  language: "zh" | "en" = "zh",
): string {
  if (hooks.length === 0) return "- none";
  return renderHooksToMarkdown(
    { hooks } as HooksState,
    language,
  );
}

// ─── Chapter Summaries ─────────────────────────────────────────────

/**
 * @deprecated Use renderSummariesToMarkdown instead.
 */
export { renderSummariesToMarkdown as renderChapterSummariesProjection };

export function renderSummariesToMarkdown(
  state: ChapterSummariesState,
  language: "zh" | "en" = "zh",
): string {
  const title = language === "en" ? "# Chapter Summaries" : "# 章节摘要";
  const headers = language === "en"
    ? [
      "| Chapter | Title | Characters | Key Events | State Changes | Hook Activity | Mood | Chapter Type |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    : [
      "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ];

  const rows = [...state.rows]
    .sort((a, b) => a.chapter - b.chapter)
    .map((row) => `| ${[
      row.chapter,
      row.title,
      row.characters,
      row.events,
      row.stateChanges,
      row.hookActivity,
      row.mood,
      row.chapterType,
    ].map(escapeTableCell).join(" | ")} |`);

  return [title, "", ...headers, ...rows, ""].join("\n");
}

/** Render summaries as a compact snapshot (for prompt injection). */
export function renderSummarySnapshot(
  summaries: ReadonlyArray<StoredSummary>,
  language: "zh" | "en" = "zh",
): string {
  if (summaries.length === 0) return "- none";
  return renderSummariesToMarkdown(
    { rows: summaries } as ChapterSummariesState,
    language,
  );
}

// ─── Current State ─────────────────────────────────────────────────

/**
 * @deprecated Use renderCurrentStateToMarkdown instead.
 */
export { renderCurrentStateToMarkdown as renderCurrentStateProjection };

export function renderCurrentStateToMarkdown(
  state: CurrentStateState,
  language: "zh" | "en" = "zh",
): string {
  const title = language === "en" ? "# Current State" : "# 当前状态";
  const headers = language === "en"
    ? ["| Category | Content |", "| --- | --- |"]
    : ["| 类别 | 内容 |", "| --- | --- |"];

  const rows = state.facts.map((fact) =>
    `| ${escapeTableCell(fact.subject)} | ${escapeTableCell(fact.object)} |`
  );

  return [title, "", ...headers, ...rows, ""].join("\n");
}

// ─── Chapter Intent (AuthorChapterIntent) ──────────────────────────

/**
 * Render an AuthorChapterIntent as human-readable Markdown.
 * This is the format the user sees and edits in the Studio interview panel.
 */
export function renderChapterIntentToMarkdown(
  intent: AuthorChapterIntent,
  language: "zh" | "en" = "zh",
): string {
  const isEn = language === "en";
  const sections: string[] = [];

  sections.push(`# ${isEn ? "Chapter Intent" : "创作访谈"}`);
  sections.push("");
  sections.push(`> ${isEn ? "Chapter" : "第"} ${intent.chapterNumber} ${isEn ? "" : "章"}`);
  sections.push("");

  // Level 1: Core
  if (intent.coreNarrative) {
    sections.push(`## ${isEn ? "Core Narrative" : "核心叙事"}`);
    sections.push("");
    sections.push(intent.coreNarrative);
    sections.push("");
  }

  if (intent.readerTakeaway) {
    sections.push(`## ${isEn ? "Reader Takeaway" : "读者感受"}`);
    sections.push("");
    sections.push(intent.readerTakeaway);
    sections.push("");
  }

  if (intent.keyMoment) {
    sections.push(`## ${isEn ? "Key Moment" : "关键瞬间"}`);
    sections.push("");
    sections.push(intent.keyMoment);
    sections.push("");
  }

  // Level 2: Scenes
  if (intent.scenes && intent.scenes.length > 0) {
    sections.push(`## ${isEn ? "Scenes" : "场景计划"}`);
    sections.push("");
    for (let i = 0; i < intent.scenes.length; i++) {
      const scene = intent.scenes[i]!;
      sections.push(`### ${isEn ? "Scene" : "场景"} ${i + 1}: ${scene.goal || `(untitled)`}`);
      sections.push("");
      if (scene.location) sections.push(`- **${isEn ? "Location" : "地点"}**: ${scene.location}`);
      if (scene.povCharacter) sections.push(`- **POV**: ${scene.povCharacter}`);
      if (scene.targetEmotion) sections.push(`- **${isEn ? "Target Emotion" : "目标情绪"}**: ${scene.targetEmotion}`);
      if (scene.conflict) sections.push(`- **${isEn ? "Conflict" : "冲突"}**: ${scene.conflict}`);
      if (scene.outcome) sections.push(`- **${isEn ? "Outcome" : "结局"}**: ${scene.outcome}`);
      if (scene.importance) sections.push(`- **${isEn ? "Importance" : "重要性"}**: ${scene.importance}`);
      if (scene.requiredBeats?.length) {
        sections.push(`- **${isEn ? "Required Beats" : "必达节拍"}**:`);
        for (const beat of scene.requiredBeats) sections.push(`  - ${beat}`);
      }
      if (scene.forbiddenMoves?.length) {
        sections.push(`- **${isEn ? "Forbidden Moves" : "禁止动作"}**:`);
        for (const move of scene.forbiddenMoves) sections.push(`  - ${move}`);
      }
      sections.push("");
    }
  }

  // Level 3: Character States
  if (intent.characterStates && intent.characterStates.length > 0) {
    sections.push(`## ${isEn ? "Character States" : "角色状态"}`);
    sections.push("");
    for (const cs of intent.characterStates) {
      sections.push(`- **${cs.characterId}**: ${cs.emotion}`);
      if (cs.relationshipChanges) sections.push(`  - ${isEn ? "Relationship" : "关系变化"}: ${cs.relationshipChanges}`);
    }
    sections.push("");
  }

  // Level 4: Constraints
  if (intent.requiredBeats?.length) {
    sections.push(`## ${isEn ? "Required Beats" : "必须包含"}`);
    sections.push("");
    for (const beat of intent.requiredBeats) sections.push(`- ${beat}`);
    sections.push("");
  }

  if (intent.forbiddenMoves?.length) {
    sections.push(`## ${isEn ? "Forbidden Moves" : "禁止出现"}`);
    sections.push("");
    for (const move of intent.forbiddenMoves) sections.push(`- ${move}`);
    sections.push("");
  }

  // Meta
  if (intent.narrativePosition) {
    sections.push(`## ${isEn ? "Narrative Position" : "叙事位置"}`);
    sections.push("");
    sections.push(`- ${intent.narrativePosition}`);
    sections.push("");
  }

  sections.push("---");
  sections.push(`> ${isEn ? "Last updated" : "最后更新"}: ${intent.updatedAt ?? ""}`);
  sections.push(`> ${isEn ? "Revision" : "版本"}: ${intent.revision ?? 1}`);

  return sections.join("\n");
}

// ─── Chapter Goal Card ─────────────────────────────────────────────

/**
 * Render a ChapterGoalCard as human-readable Markdown.
 */
export function renderChapterGoalToMarkdown(
  goal: ChapterGoalCard,
  language: "zh" | "en" = "zh",
): string {
  const isEn = language === "en";
  const sections: string[] = [];

  sections.push(`# ${isEn ? "Chapter Goal" : "章节目标"}`);
  sections.push("");
  sections.push(`> ${isEn ? "Chapter" : "第"} ${goal.chapterNumber} ${isEn ? "" : "章"}`);
  sections.push("");

  if (goal.title) {
    sections.push(`## ${isEn ? "Title" : "标题"}`);
    sections.push("");
    sections.push(goal.title);
    sections.push("");
  }

  if (goal.mainConflict) {
    sections.push(`## ${isEn ? "Core Conflict" : "核心矛盾"}`);
    sections.push("");
    sections.push(goal.mainConflict);
    sections.push("");
  }

  if (goal.targetMood) {
    sections.push(`## ${isEn ? "Target Mood" : "目标氛围"}`);
    sections.push("");
    sections.push(goal.targetMood);
    sections.push("");
  }

  const metaLines: string[] = [];
  if (goal.povCharacter) metaLines.push(`- **POV**: ${goal.povCharacter}`);
  if (goal.location) metaLines.push(`- **${isEn ? "Location" : "地点"}**: ${goal.location}`);
  if (goal.timeOfDay) metaLines.push(`- **${isEn ? "Time of Day" : "时段"}**: ${goal.timeOfDay}`);
  if (goal.targetChars) metaLines.push(`- **${isEn ? "Target Length" : "目标字数"}**: ${goal.targetChars} ${isEn ? "chars" : "字"}`);
  if (metaLines.length > 0) {
    sections.push(`## ${isEn ? "Meta" : "元信息"}`);
    sections.push("");
    sections.push(...metaLines);
    sections.push("");
  }

  if (goal.requiredBeats?.length) {
    sections.push(`## ${isEn ? "Required Beats" : "必达事件"}`);
    sections.push("");
    for (const beat of goal.requiredBeats) sections.push(`- ${beat}`);
    sections.push("");
  }

  if (goal.forbiddenMoves?.length) {
    sections.push(`## ${isEn ? "Forbidden Moves" : "禁用动作"}`);
    sections.push("");
    for (const move of goal.forbiddenMoves) sections.push(`- ${move}`);
    sections.push("");
  }

  if (goal.hookIdsToAdvance?.length) {
    sections.push(`## ${isEn ? "Hooks to Advance" : "需推进的伏笔"}`);
    sections.push("");
    for (const hId of goal.hookIdsToAdvance) sections.push(`- ${hId}`);
    sections.push("");
  }

  return sections.join("\n");
}

// ─── Chapter Memo (M1) ──────────────────────────────────────────────

import type { ChapterMemo } from "../models/input-governance.js";

/** Render a ChapterMemo (YAML frontmatter + body) to Markdown. */
export function renderMemoToMarkdown(
  memo: ChapterMemo,
  _lang: "zh" | "en" = "zh",
): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`chapter: ${memo.chapter}`);
  lines.push(`goal: "${memo.goal.replace(/"/g, '\\"')}"`);
  if (memo.isGoldenOpening) lines.push("isGoldenOpening: true");
  if (memo.threadRefs.length > 0) {
    lines.push(`threadRefs: [${memo.threadRefs.join(", ")}]`);
  }
  lines.push("---");
  lines.push("");
  lines.push(memo.body);
  return lines.join("\n");
}

// ─── Chapter Intent runtime (M1) ────────────────────────────────────

import type { ChapterIntent } from "../models/input-governance.js";

/** Render a ChapterIntent (Planner runtime output) to Markdown. */
export function renderChapterIntentRuntimeToMarkdown(
  intent: ChapterIntent,
  lang: "zh" | "en" = "zh",
): string {
  const isEn = lang === "en";
  const sections: string[] = [];
  sections.push(isEn ? `## Chapter ${intent.chapter} Writing Plan` : `## 第${intent.chapter}章 写作规划`);
  sections.push("");
  sections.push(`**${isEn ? "Goal" : "目标"}**：${intent.goal}`);
  sections.push("");
  if (intent.outlineNode) { sections.push(`### ${isEn ? "Outline" : "大纲"}`); sections.push(""); sections.push(intent.outlineNode); sections.push(""); }
  if (intent.arcContext) { sections.push(`### ${isEn ? "Arc" : "卷弧"}`); sections.push(""); sections.push(intent.arcContext); sections.push(""); }
  if (intent.mustKeep.length) { sections.push(`### ${isEn ? "Must Keep" : "必须保留"}`); sections.push(""); for (const k of intent.mustKeep) sections.push(`- ${k}`); sections.push(""); }
  if (intent.mustAvoid.length) { sections.push(`### ${isEn ? "Must Avoid" : "必须避免"}`); sections.push(""); for (const k of intent.mustAvoid) sections.push(`- ${k}`); sections.push(""); }
  if (intent.styleEmphasis.length) { sections.push(`### ${isEn ? "Style" : "风格"}`); sections.push(""); for (const k of intent.styleEmphasis) sections.push(`- ${k}`); sections.push(""); }
  return sections.join("\n");
}
