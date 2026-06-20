import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BaseAgent } from "./base.js";
import type { BookConfig } from "../models/book.js";
import { readBookRules as readAuthoritativeBookRules } from "./rules-reader.js";
import {
  ChapterIntentSchema,
  type ChapterIntent,
  type ChapterMemo,
} from "../models/input-governance.js";
import { logPromptManifest } from "../utils/prompt-tracing.js";
import { buildPromptManifest, getAvailableInputTokens, type PromptFragment } from "../models/prompt-manifest.js";
import {
  renderHookSnapshot,
  renderSummarySnapshot,
} from "../utils/memory-retrieval.js";
import {
  gatherPlanningMaterials,
  loadPlanningSeedMaterials,
} from "../utils/planning-materials.js";
import {
  loadChapterGoals,
  type ChapterGoalCard,
} from "../models/chapter-goal.js";
import {
  loadChapterIntents,
  getChapterIntent,
  type AuthorChapterIntent,
} from "../models/chapter-intent.js";
import { buildAuthorIntentBlock } from "../utils/intent-injection.js";
import { loadSceneTemplates, buildSceneTemplatesBlock } from "../utils/scene-template-loader.js";
import { parseMemo, PlannerParseError } from "../utils/chapter-memo-parser.js";
import {
  buildPlannerUserMessage,
  getPlannerMemoSystemPrompt,
} from "./planner-prompts.js";
import {
  composeCurrentArcProse,
  extractCollaboratorRows,
  extractOpponentRows,
  extractProtagonistRow,
  extractRelevantThreads,
  formatRecentSummaries,
  formatRecyclableHooks,
  readBookRules,
  readCharacterMatrix,
  readEmotionalArcs,
  readPendingHooks,
  readSubplotBoard,
} from "./planner-context.js";
import type { StoredHook } from "../state/memory-db.js";

export interface PlanChapterInput {
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly externalContext?: string;
  /** When true, generates 2-3 alternative memo variants alongside the primary. */
  readonly generateAlternatives?: boolean;
}

/** A single alternative plan variant. */
export interface MemoVariant {
  /** Variant id, e.g. "variant-b", "variant-c". */
  readonly id: string;
  /** Human-readable label describing the variant's emphasis. */
  readonly label: string;
  /** Brief description of what makes this variant different. */
  readonly description: string;
  /** The variant's memo. */
  readonly memo: ChapterMemo;
  /** The variant's intent (differs from primary in goal/emphasis). */
  readonly intent: ChapterIntent;
}

/** Find the ChapterGoalCard for a specific chapter number. */
function getChapterGoalForChapter(
  goals: ReadonlyArray<ChapterGoalCard>,
  chapterNumber: number,
): ChapterGoalCard | undefined {
  return goals.find((g) => g.chapterNumber === chapterNumber);
}

/**
 * Build a prompt block from the chapter goal card for injection into the memo template.
 */
function buildChapterGoalBlock(
  goal: ChapterGoalCard | undefined,
  language: "zh" | "en",
): string {
  if (!goal) return "";
  const lines: string[] = [];
  const label = language === "en" ? "## Chapter Goal (user-set)" : "## 本章目标（用户设定）";

  if (goal.mainConflict) {
    lines.push(language === "en" ? `- Core conflict: ${goal.mainConflict}` : `- 核心矛盾：${goal.mainConflict}`);
  }
  if (goal.targetMood) {
    lines.push(language === "en" ? `- Target mood: ${goal.targetMood}` : `- 目标氛围：${goal.targetMood}`);
  }
  if (goal.requiredBeats?.length) {
    const beatLabel = language === "en" ? "Required beats (MUST include)" : "必达事件（必须包含）";
    lines.push(`- ${beatLabel}:`);
    for (const beat of goal.requiredBeats) {
      lines.push(`  - ${beat}`);
    }
  }
  if (goal.forbiddenMoves?.length) {
    const forbidLabel = language === "en" ? "Forbidden moves (MUST avoid)" : "禁用动作（严禁出现）";
    lines.push(`- ${forbidLabel}:`);
    for (const move of goal.forbiddenMoves) {
      lines.push(`  - ${move}`);
    }
  }
  if (goal.targetChars && goal.targetChars > 0) {
    lines.push(language === "en" ? `- Target length: ~${goal.targetChars} characters` : `- 目标字数：约 ${goal.targetChars} 字`);
  }
  if (goal.povCharacter) {
    lines.push(language === "en" ? `- POV: ${goal.povCharacter}` : `- 视角：${goal.povCharacter}`);
  }
  if (goal.location) {
    lines.push(language === "en" ? `- Location: ${goal.location}` : `- 地点：${goal.location}`);
  }
  if (goal.timeOfDay) {
    lines.push(language === "en" ? `- Time of day: ${goal.timeOfDay}` : `- 时段：${goal.timeOfDay}`);
  }
  if (goal.hookIdsToAdvance?.length) {
    const hookLabel = language === "en" ? "Hooks to advance in this chapter" : "本章需推进的伏笔";
    lines.push(`- ${hookLabel}:`);
    for (const hookId of goal.hookIdsToAdvance) {
      lines.push(`  - ${hookId}`);
    }
  }

  if (lines.length === 0) return "";
  return `\n${label}\n${lines.join("\n")}\n`;
}

export interface PlanChapterOutput {
  readonly intent: ChapterIntent;
  readonly memo: ChapterMemo;
  readonly intentMarkdown: string;
  readonly plannerInputs: ReadonlyArray<string>;
  readonly runtimePath: string;
  /** Alternative plan variants (only populated when generateAlternatives is true). */
  readonly alternatives?: ReadonlyArray<MemoVariant>;
}

const MEMO_RETRY_LIMIT = 3;

/**
 * Phase 3 planner.
 *
 * Produces:
 *   - a simplified ChapterIntent (goal + outline + keep/avoid/style) —
 *     still deterministic, used for retrieval hints and the intent markdown.
 *   - a full ChapterMemo (YAML frontmatter + 7-section markdown body) via
 *     LLM call + strict parser.
 *
 * Retry policy: up to 3 attempts. Each failed parse appends an error
 * feedback block to the user message and re-invokes the LLM. On the third
 * failure we surface `PlannerParseError` — never silently truncate or
 * rename fields.
 */
export class PlannerAgent extends BaseAgent {
  get name(): string {
    return "planner";
  }

  async planChapter(input: PlanChapterInput): Promise<PlanChapterOutput> {
    const storyDir = join(input.bookDir, "story");
    const runtimeDir = join(storyDir, "runtime");
    await mkdir(runtimeDir, { recursive: true });

    const seedMaterials = await loadPlanningSeedMaterials({
      bookDir: input.bookDir,
      chapterNumber: input.chapterNumber,
    });
    const outlineNode = this.findOutlineNode(seedMaterials.volumeOutline, input.chapterNumber);
    // Load chapter goals from chapter_goals.json — inject user-set constraints
    // (requiredBeats, forbiddenMoves, targetChars, hookIdsToAdvance) into the
    // planner's intent and memo prompt so they actually influence writing.
    const chapterGoalsIndex = await loadChapterGoals(input.bookDir);
    const chapterGoal = getChapterGoalForChapter(chapterGoalsIndex.goals, input.chapterNumber);
    // Load author's chapter intent (from chapter_intents.json) — inject the
    // author's pre-writing answers (core narrative, reader takeaway, key moment)
    // into the memo prompt so the LLM reads "the author wants this" before it
    // writes anything.
    const chapterIntentsIndex = await loadChapterIntents(input.bookDir);
    const chapterIntent = getChapterIntent(chapterIntentsIndex.intents, input.chapterNumber);
    const authorIntentBlock = chapterIntent ? buildAuthorIntentBlock(chapterIntent) : "";
    // M5: Load scene templates and build prompt block for Planner consumption
    const sceneTemplates = await loadSceneTemplates(input.bookDir);
    const sceneTemplatesBlock = buildSceneTemplatesBlock(sceneTemplates, input.book.language ?? "zh");
    // Combine author intent + scene templates into a single injected block
    const enrichedIntentBlock = [authorIntentBlock, sceneTemplatesBlock]
      .filter(Boolean)
      .join("\n\n");
    const goal = this.deriveGoal(
      input.externalContext,
      seedMaterials.currentFocus,
      seedMaterials.authorIntent,
      outlineNode,
      input.chapterNumber,
    );
    // Phase hotfix 5: read structured rules through the Phase 5 authoritative
    // loader. It prefers outline/story_frame.md frontmatter, falls back to
    // legacy book_rules.md, and refuses to silently zero out rules when the
    // legacy file is just a compat shim. Reading raw bookRulesRaw via
    // parseBookRules() bypassed all of that.
    const parsedRules = await readAuthoritativeBookRules(input.bookDir);
    const prohibitions = parsedRules?.rules.prohibitions ?? [];
    const mustKeep = this.collectMustKeep(seedMaterials.currentState, seedMaterials.storyBible);
    const mustAvoid = this.collectMustAvoid(seedMaterials.currentFocus, prohibitions);
    const styleEmphasis = this.collectStyleEmphasis(seedMaterials.authorIntent, seedMaterials.currentFocus);
    // Inject chapter goal constraints into mustKeep/mustAvoid
    if (chapterGoal) {
      if (chapterGoal.requiredBeats?.length) {
        for (const beat of chapterGoal.requiredBeats) {
          if (!mustKeep.includes(beat)) mustKeep.push(beat);
        }
      }
      if (chapterGoal.forbiddenMoves?.length) {
        for (const move of chapterGoal.forbiddenMoves) {
          if (!mustAvoid.includes(move)) mustAvoid.push(move);
        }
      }
    }
    const materials = await gatherPlanningMaterials({
      bookDir: input.bookDir,
      chapterNumber: input.chapterNumber,
      goal,
      outlineNode,
      mustKeep,
      seed: seedMaterials,
    });
    const memorySelection = materials.memorySelection;
    const activeHookCount = memorySelection.activeHooks.filter(
      (hook) => hook.status !== "resolved" && hook.status !== "deferred",
    ).length;

    const arcContext = this.buildArcContext(
      input.book.language,
      seedMaterials.volumeOutline,
      outlineNode,
    );

    const intent = ChapterIntentSchema.parse({
      chapter: input.chapterNumber,
      goal,
      outlineNode,
      arcContext,
      mustKeep,
      mustAvoid,
      styleEmphasis,
    });

    const isGoldenOpening = this.isGoldenOpeningChapter(input.book.language, input.chapterNumber);
    const memo = await this.planChapterMemo({
      storyDir,
      bookDir: input.bookDir,
      chapterNumber: input.chapterNumber,
      isGoldenOpening,
      fallbackGoal: goal,
      chapterSummariesRaw: seedMaterials.chapterSummariesRaw,
      previousEndingExcerpt: seedMaterials.previousEndingExcerpt,
      brief: seedMaterials.brief,
      chapterContext: input.externalContext,
      // Pass chapter goal so the memo LLM prompt can render requiredBeats / forbiddenMoves
      chapterGoal,
      authorIntentBlock: enrichedIntentBlock,
      recyclableHooks: memorySelection.recyclableHooks,
      // Phase hotfix 4: thread book language through so the planner uses
      // English prompts (system + user template + golden opening guidance)
      // for English books instead of always-Chinese.
      language: input.book.language ?? "zh",
    });

    // memo.goal is LLM-produced and specific (<=50 chars, validated).
    // Overwrite intent.goal so downstream composer/retrieval gets the
    // concrete task statement instead of the outline-derived fallback.
    intent.goal = memo.goal;

    const runtimePath = join(runtimeDir, `chapter-${String(input.chapterNumber).padStart(4, "0")}.intent.md`);
    const intentMarkdown = this.renderIntentMarkdown(
      intent,
      memo,
      input.book.language ?? "zh",
      renderHookSnapshot(memorySelection.hooks, input.book.language ?? "zh"),
      renderSummarySnapshot(memorySelection.summaries, input.book.language ?? "zh"),
      activeHookCount,
    );
    await writeFile(runtimePath, intentMarkdown, "utf-8");

    // ── Plan variant generation (opt-in) ──────────────────────
    let alternatives: MemoVariant[] | undefined;
    if (input.generateAlternatives) {
      try {
        alternatives = await this.generateMemosWithVariants(input, {
          fallbackGoal: goal,
          chapterSummariesRaw: seedMaterials.chapterSummariesRaw,
          previousEndingExcerpt: seedMaterials.previousEndingExcerpt,
          brief: seedMaterials.brief,
          chapterContext: input.externalContext,
          chapterGoal,
          authorIntentBlock,
          recyclableHooks: memorySelection.recyclableHooks,
          language: input.book.language ?? "zh",
        });
      } catch (e) {
        this.log?.warn(`Plan variant generation failed: ${String(e)}, using primary only`);
      }
    }

    return {
      intent,
      memo,
      intentMarkdown,
      plannerInputs: materials.plannerInputs,
      runtimePath,
      alternatives: alternatives && alternatives.length > 0 ? alternatives : undefined,
    };
  }

  /**
   * Invoke the LLM to produce a 7-section memo and parse it. Retries up to
   * 3 times on parse failure, injecting the error message back into the user
   * prompt so the LLM can correct itself.
   */
  async planChapterMemo(input: {
    readonly storyDir: string;
    readonly bookDir: string;
    readonly chapterNumber: number;
    readonly isGoldenOpening: boolean;
    readonly fallbackGoal: string;
    readonly chapterSummariesRaw: string;
    readonly previousEndingExcerpt?: string;
    readonly brief?: string;
    readonly chapterContext?: string;
    readonly recyclableHooks?: ReadonlyArray<StoredHook>;
    readonly language?: "zh" | "en";
    /** Optional chapter goal card — used to inject requiredBeats / forbiddenMoves / targetChars into the memo prompt. */
    readonly chapterGoal?: ChapterGoalCard;
    /** Optional author intent block — pre-formatted markdown from chapter_intents.json. */
    readonly authorIntentBlock?: string;
  }): Promise<ChapterMemo> {
    const [characterMatrix, subplotBoard, emotionalArcs, pendingHooks, bookRulesRaw] = await Promise.all([
      readCharacterMatrix(input.storyDir),
      readSubplotBoard(input.storyDir),
      readEmotionalArcs(input.storyDir),
      readPendingHooks(input.storyDir),
      readBookRules(input.storyDir),
    ]);

    const language = input.language ?? "zh";
    const noPriorChapter = language === "en"
      ? "(this is the opening chapter — no prior chapter)"
      : "（本章为起始章，无前章）";
    const noBookRules = language === "en"
      ? "(no book_rules entries)"
      : "（暂无 book_rules 条目）";
    const retryFeedbackHeader = language === "en"
      ? "## Error from previous output"
      : "## 上次输出的错误";
    const retryFeedbackTrailer = language === "en"
      ? "Fix and re-emit."
      : "请修正后重新输出。";

    const userMessage = buildPlannerUserMessage({
      chapterNumber: input.chapterNumber,
      previousChapterEndingExcerpt: input.previousEndingExcerpt?.trim()
        ? input.previousEndingExcerpt.trim()
        : noPriorChapter,
      recentSummaries: formatRecentSummaries(input.chapterSummariesRaw, input.chapterNumber, 3),
      currentArcProse: composeCurrentArcProse(subplotBoard, emotionalArcs, input.chapterNumber),
      protagonistMatrixRow: extractProtagonistRow(characterMatrix),
      opponentRows: extractOpponentRows(characterMatrix, 3),
      collaboratorRows: extractCollaboratorRows(characterMatrix, 3),
      relevantThreads: extractRelevantThreads(pendingHooks, subplotBoard),
      recyclableHooks: formatRecyclableHooks(
        input.recyclableHooks ?? [],
        input.chapterNumber,
        language,
      ),
      isGoldenOpening: input.isGoldenOpening,
      bookRulesRelevant: bookRulesRaw.trim().length > 0 ? bookRulesRaw.trim() : noBookRules,
      brief: input.brief ?? "",
      chapterContext: input.chapterContext ?? "",
      chapterGoalBlock: buildChapterGoalBlock(input.chapterGoal, language),
      authorIntentBlock: input.authorIntentBlock,
      language,
    });

    const systemPrompt = getPlannerMemoSystemPrompt(language);

    let currentUserMessage = userMessage;
    let lastError: PlannerParseError | undefined;

    for (let attempt = 0; attempt < MEMO_RETRY_LIMIT; attempt += 1) {
      // Stage 2: Use buildPromptManifest as the actual prompt assembly controller
      const maxAllowedInputTokens = getAvailableInputTokens(this.ctx.model);
      const systemFragment: PromptFragment = {
        id: "planner-system",
        source: "planner-memo",
        role: "system",
        slot: "system-prompt",
        priority: 100,
        content: systemPrompt,
        optional: false,
        estimatedTokens: Math.ceil(systemPrompt.length / 4),
      };
      const userFragment: PromptFragment = {
        id: "planner-user",
        source: "planner-memo",
        role: "user",
        slot: "user-message",
        priority: 80,
        content: currentUserMessage,
        optional: true,
        estimatedTokens: Math.ceil(currentUserMessage.length / 4),
      };
      const manifest = buildPromptManifest({
        stage: this.name,
        fragments: [systemFragment, userFragment],
        maxAllowedInputTokens,
      });

      if (manifest.droppedFragments.length > 0) {
        this.log?.warn(`[planner] Fragment(s) dropped due to token budget: ${manifest.droppedFragments.map((d) => d.fragmentId).join(", ")}`);
      }

      // Build messages from manifest fragments (preserving role order)
      const messages: Array<{ role: "system" | "user"; content: string }> = [];
      for (const fragment of manifest.fragments) {
        if (fragment.role === "system" || fragment.role === "user") {
          messages.push({ role: fragment.role, content: fragment.content });
        }
      }

      // Log the manifest for traceability
      logPromptManifest(this.name, messages, this.ctx.model, this.log);

      const response = await this.chat(messages, { temperature: this.ctx.temperature ?? 0.7 });

      try {
        return parseMemo(response.content, input.chapterNumber, input.isGoldenOpening);
      } catch (error) {
        if (!(error instanceof PlannerParseError)) {
          throw error;
        }
        lastError = error;
        this.log?.warn(`[planner] memo parse failed (attempt ${attempt + 1}/${MEMO_RETRY_LIMIT}): ${error.message}`);
        currentUserMessage = `${userMessage}\n\n${retryFeedbackHeader}\n${error.message}\n${retryFeedbackTrailer}`;
      }
    }

    throw lastError ?? new PlannerParseError("memo planner exhausted retries without a specific error");
  }

  private isGoldenOpeningChapter(language: string | undefined, chapterNumber: number): boolean {
    const isZh = (language ?? "zh").toLowerCase().startsWith("zh");
    return isZh ? chapterNumber <= 3 : chapterNumber <= 5;
  }

  private buildArcContext(
    language: string | undefined,
    volumeOutline: string,
    outlineNode: string | undefined,
  ): string | undefined {
    if (!outlineNode) return undefined;
    if (volumeOutline === "(文件尚未创建)") return undefined;
    return this.isChineseLanguage(language)
      ? `卷纲节点：${outlineNode}`
      : `Outline node: ${outlineNode}`;
  }

  private deriveGoal(
    externalContext: string | undefined,
    currentFocus: string,
    authorIntent: string,
    outlineNode: string | undefined,
    chapterNumber: number,
  ): string {
    const first = this.extractFirstDirective(externalContext);
    if (first) return first;
    const localOverride = this.extractLocalOverrideGoal(currentFocus);
    if (localOverride) return localOverride;
    const outline = this.extractFirstDirective(outlineNode);
    if (outline) return outline;
    const focus = this.extractFocusGoal(currentFocus);
    if (focus) return focus;
    const author = this.extractFirstDirective(authorIntent);
    if (author) return author;
    return `Advance chapter ${chapterNumber} with clear narrative focus.`;
  }

  private collectMustKeep(currentState: string, storyBible: string): string[] {
    return this.unique([
      ...this.extractListItems(currentState, 2),
      ...this.extractListItems(storyBible, 2),
    ]).slice(0, 4);
  }

  private collectMustAvoid(currentFocus: string, prohibitions: ReadonlyArray<string>): string[] {
    const avoidSection = this.extractSection(currentFocus, [
      "avoid",
      "must avoid",
      "禁止",
      "避免",
      "避雷",
    ]);
    const focusAvoids = avoidSection
      ? this.extractListItems(avoidSection, 10)
      : currentFocus
        .split("\n")
        .map((line) => line.trim())
        .filter((line) =>
          line.startsWith("-") &&
          /avoid|don't|do not|不要|别|禁止/i.test(line),
        )
        .map((line) => this.cleanListItem(line))
        .filter((line): line is string => Boolean(line));

    return this.unique([...focusAvoids, ...prohibitions]).slice(0, 6);
  }

  private collectStyleEmphasis(authorIntent: string, currentFocus: string): string[] {
    return this.unique([
      ...this.extractFocusStyleItems(currentFocus),
      ...this.extractListItems(authorIntent, 2),
    ]).slice(0, 4);
  }

  private extractFirstDirective(content?: string): string | undefined {
    if (!content) return undefined;
    return content
      .split("\n")
      .map((line) => line.trim())
      .find((line) =>
        line.length > 0
        && !line.startsWith("#")
        && !line.startsWith("-")
        && !this.isTemplatePlaceholder(line),
      );
  }

  private extractListItems(content: string, limit: number): string[] {
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-"))
      .map((line) => this.cleanListItem(line))
      .filter((line): line is string => Boolean(line))
      .slice(0, limit);
  }

  private extractFocusGoal(currentFocus: string): string | undefined {
    const focusSection = this.extractSection(currentFocus, [
      "active focus",
      "focus",
      "当前聚焦",
      "当前焦点",
      "近期聚焦",
    ]) ?? currentFocus;
    const directives = this.extractFocusStyleItems(focusSection, 3);
    if (directives.length === 0) {
      return this.extractFirstDirective(focusSection);
    }
    return directives.join(this.containsChinese(focusSection) ? "；" : "; ");
  }

  private extractLocalOverrideGoal(currentFocus: string): string | undefined {
    const overrideSection = this.extractSection(currentFocus, [
      "local override",
      "explicit override",
      "chapter override",
      "local task override",
      "局部覆盖",
      "本章覆盖",
      "临时覆盖",
      "当前覆盖",
    ]);
    if (!overrideSection) {
      return undefined;
    }

    const directives = this.extractListItems(overrideSection, 3);
    if (directives.length > 0) {
      return directives.join(this.containsChinese(overrideSection) ? "；" : "; ");
    }

    return this.extractFirstDirective(overrideSection);
  }

  private extractFocusStyleItems(currentFocus: string, limit = 3): string[] {
    const focusSection = this.extractSection(currentFocus, [
      "active focus",
      "focus",
      "当前聚焦",
      "当前焦点",
      "近期聚焦",
    ]) ?? currentFocus;
    return this.extractListItems(focusSection, limit);
  }

  private renderHookBudget(activeCount: number, language: "zh" | "en"): string {
    const cap = 12;
    if (activeCount < 10) {
      return language === "en"
        ? `### Hook Budget\n- ${activeCount} active hooks (capacity: ${cap})`
        : `### 伏笔预算\n- 当前 ${activeCount} 条活跃伏笔（容量：${cap}）`;
    }
    const remaining = Math.max(0, cap - activeCount);
    return language === "en"
      ? `### Hook Budget\n- ${activeCount} active hooks — approaching capacity (${cap}). Only ${remaining} new hook(s) allowed. Prioritize resolving existing debt over opening new threads.`
      : `### 伏笔预算\n- 当前 ${activeCount} 条活跃伏笔——接近容量上限（${cap}）。仅剩 ${remaining} 个新坑位。优先回收旧债，不要轻易开新线。`;
  }

  private extractSection(content: string, headings: ReadonlyArray<string>): string | undefined {
    const targets = headings.map((heading) => this.normalizeHeading(heading));
    const lines = content.split("\n");
    let buffer: string[] | null = null;
    let sectionLevel = 0;

    for (const line of lines) {
      const headingMatch = line.match(/^(#+)\s*(.+?)\s*$/);
      if (headingMatch) {
        const level = headingMatch[1]!.length;
        const heading = this.normalizeHeading(headingMatch[2]!);

        if (buffer && level <= sectionLevel) {
          break;
        }

        if (targets.includes(heading)) {
          buffer = [];
          sectionLevel = level;
          continue;
        }
      }

      if (buffer) {
        buffer.push(line);
      }
    }

    const section = buffer?.join("\n").trim();
    return section && section.length > 0 ? section : undefined;
  }

  private normalizeHeading(heading: string): string {
    return heading
      .toLowerCase()
      .replace(/[*_`:#]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private cleanListItem(line: string): string | undefined {
    const cleaned = line.replace(/^-\s*/, "").trim();
    if (cleaned.length === 0) return undefined;
    if (/^[-|]+$/.test(cleaned)) return undefined;
    if (this.isTemplatePlaceholder(cleaned)) return undefined;
    return cleaned;
  }

  private isTemplatePlaceholder(line: string): boolean {
    const normalized = line.trim();
    if (!normalized) return false;

    return (
      /^\((describe|briefly describe|write)\b[\s\S]*\)$/i.test(normalized)
      || /^（(?:在这里描述|描述|填写|写下)[\s\S]*）$/u.test(normalized)
    );
  }

  private containsChinese(content: string): boolean {
    return /[\u4e00-\u9fff]/.test(content);
  }

  private findOutlineNode(volumeOutline: string, chapterNumber: number): string | undefined {
    const lines = volumeOutline.split("\n").map((line) => line.trim()).filter(Boolean);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const match = this.matchExactOutlineLine(line, chapterNumber);
      if (!match) continue;

      const inlineContent = this.cleanOutlineContent(match[1]);
      if (inlineContent) {
        return inlineContent;
      }

      const nextContent = this.findNextOutlineContent(lines, index + 1);
      if (nextContent) {
        return nextContent;
      }
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const match = this.matchRangeOutlineLine(line, chapterNumber);
      if (!match) continue;

      const inlineContent = this.cleanOutlineContent(match[3]);
      if (inlineContent) {
        return inlineContent;
      }

      const rangeStart = Number(match[1]);
      const sectionContent = this.extractSectionAroundRange(lines, index);
      if (sectionContent) {
        const beatIndex = chapterNumber - rangeStart;
        const specificBeat = this.extractNumberedBeat(sectionContent, beatIndex);
        return specificBeat ?? sectionContent;
      }

      const nextContent = this.findNextOutlineContent(lines, index + 1);
      if (nextContent) {
        return nextContent;
      }
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (!this.isOutlineAnchorLine(line)) continue;

      const exactMatch = this.matchAnyExactOutlineLine(line);
      if (exactMatch) {
        const inlineContent = this.cleanOutlineContent(exactMatch[1]);
        if (inlineContent) {
          return inlineContent;
        }
      }

      const rangeMatch = this.matchAnyRangeOutlineLine(line);
      if (rangeMatch) {
        const inlineContent = this.cleanOutlineContent(rangeMatch[3]);
        if (inlineContent) {
          return inlineContent;
        }
      }

      const nextContent = this.findNextOutlineContent(lines, index + 1);
      if (nextContent) {
        return nextContent;
      }

      break;
    }

    return this.extractFirstDirective(volumeOutline);
  }

  private cleanOutlineContent(content?: string): string | undefined {
    const cleaned = content?.trim();
    if (!cleaned) return undefined;
    if (/^[*_`~:：-]+$/.test(cleaned)) return undefined;
    return cleaned;
  }

  private extractSectionAroundRange(lines: ReadonlyArray<string>, rangeLineIndex: number): string | undefined {
    let headingIndex = -1;
    for (let i = rangeLineIndex - 1; i >= 0; i--) {
      if (lines[i]!.startsWith("#")) {
        headingIndex = i;
        break;
      }
      if (this.matchAnyRangeOutlineLine(lines[i]!) || this.matchAnyExactOutlineLine(lines[i]!)) {
        break;
      }
    }

    if (headingIndex < 0) {
      return undefined;
    }

    const headingLine = lines[headingIndex]!;
    const headingLevel = headingLine.match(/^(#+)/)?.[1]?.length ?? 3;

    const sectionLines: string[] = [];
    for (let i = headingIndex; i < lines.length; i++) {
      if (i > headingIndex) {
        const nextHeadingMatch = lines[i]!.match(/^(#+)/);
        if (nextHeadingMatch && (nextHeadingMatch[1]?.length ?? 0) <= headingLevel) {
          break;
        }
      }
      sectionLines.push(lines[i]!);
    }

    const content = sectionLines.join("\n").trim();
    return content.length > 0 ? content : undefined;
  }

  private extractNumberedBeat(section: string, beatIndex: number): string | undefined {
    if (beatIndex < 0) return undefined;

    const beats: string[] = [];
    for (const line of section.split("\n")) {
      const trimmed = line.trim();
      if (/^\d+[.)]\s/.test(trimmed)) {
        beats.push(trimmed.replace(/^\d+[.)]\s*/, ""));
      }
    }

    if (beats.length === 0 || beatIndex >= beats.length) return undefined;
    return beats[beatIndex];
  }

  private findNextOutlineContent(lines: ReadonlyArray<string>, startIndex: number): string | undefined {
    for (let index = startIndex; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (!line) {
        continue;
      }

      if (this.isOutlineAnchorLine(line)) {
        return undefined;
      }

      if (line.startsWith("#")) {
        continue;
      }

      const cleaned = this.cleanOutlineContent(line);
      if (cleaned) {
        return cleaned;
      }
    }

    return undefined;
  }

  private matchExactOutlineLine(line: string, chapterNumber: number): RegExpMatchArray | undefined {
    const patterns = [
      new RegExp(`^(?:#+\\s*)?(?:[-*]\\s+)?(?:\\*\\*)?Chapter\\s*${chapterNumber}(?!\\d|\\s*[-~–—]\\s*\\d)(?:[:：-])?(?:\\*\\*)?\\s*(.*)$`, "i"),
      new RegExp(`^(?:#+\\s*)?(?:[-*]\\s+)?(?:\\*\\*)?第\\s*${chapterNumber}\\s*章(?!\\d|\\s*[-~–—]\\s*\\d)(?:[:：-])?(?:\\*\\*)?\\s*(.*)$`),
    ];

    return patterns
      .map((pattern) => line.match(pattern))
      .find((result): result is RegExpMatchArray => Boolean(result));
  }

  private matchAnyExactOutlineLine(line: string): RegExpMatchArray | undefined {
    const patterns = [
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?Chapter\s*\d+(?!\s*[-~–—]\s*\d)(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?第\s*\d+\s*章(?!\s*[-~–—]\s*\d)(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
    ];

    return patterns
      .map((pattern) => line.match(pattern))
      .find((result): result is RegExpMatchArray => Boolean(result));
  }

  private matchRangeOutlineLine(line: string, chapterNumber: number): RegExpMatchArray | undefined {
    const match = this.matchAnyRangeOutlineLine(line);
    if (!match) return undefined;
    if (this.isChapterWithinRange(match[1], match[2], chapterNumber)) {
      return match;
    }

    return undefined;
  }

  private matchAnyRangeOutlineLine(line: string): RegExpMatchArray | undefined {
    const patterns = [
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?Chapter\s*(\d+)\s*[-~–—]\s*(\d+)\b(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?第\s*(\d+)\s*[-~–—]\s*(\d+)\s*章(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
      /^(?:[-*]\s+)?(?:\*\*)?章节范围(?:\*\*)?[：:]\s*(\d+)\s*[-~–—]\s*(\d+)\s*章\s*(.*)$/,
      /^(?:[-*]\s+)?(?:\*\*)?Chapter\s*[Rr]ange(?:\*\*)?[：:]\s*(\d+)\s*[-~–—]\s*(\d+)\b\s*(.*)$/i,
    ];

    return patterns
      .map((pattern) => line.match(pattern))
      .find((result): result is RegExpMatchArray => Boolean(result));
  }

  private isOutlineAnchorLine(line: string): boolean {
    return this.matchAnyExactOutlineLine(line) !== undefined
      || this.matchAnyRangeOutlineLine(line) !== undefined;
  }

  private isChapterWithinRange(startText: string | undefined, endText: string | undefined, chapterNumber: number): boolean {
    const start = Number.parseInt(startText ?? "", 10);
    const end = Number.parseInt(endText ?? "", 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    const lower = Math.min(start, end);
    const upper = Math.max(start, end);
    return chapterNumber >= lower && chapterNumber <= upper;
  }

  private renderIntentMarkdown(
    intent: ChapterIntent,
    memo: ChapterMemo,
    language: "zh" | "en",
    pendingHooks: string,
    chapterSummaries: string,
    activeHookCount: number,
  ): string {
    const mustKeep = intent.mustKeep.length > 0
      ? intent.mustKeep.map((item) => `- ${item}`).join("\n")
      : "- none";

    const mustAvoid = intent.mustAvoid.length > 0
      ? intent.mustAvoid.map((item) => `- ${item}`).join("\n")
      : "- none";

    const styleEmphasis = intent.styleEmphasis.length > 0
      ? intent.styleEmphasis.map((item) => `- ${item}`).join("\n")
      : "- none";

    const memoBody = memo.body.trim();
    const threadRefsLine = memo.threadRefs.length > 0
      ? memo.threadRefs.map((id) => `- ${id}`).join("\n")
      : "- (none)";

    return [
      "# Chapter Intent",
      "",
      "## Goal",
      intent.goal,
      "",
      "## Outline Node",
      intent.outlineNode ?? "(not found)",
      "",
      "## Arc Context",
      intent.arcContext ?? "(none)",
      "",
      "## Must Keep",
      mustKeep,
      "",
      "## Must Avoid",
      mustAvoid,
      "",
      "## Style Emphasis",
      styleEmphasis,
      "",
      "## Chapter Memo",
      `- isGoldenOpening: ${memo.isGoldenOpening ? "true" : "false"}`,
      "",
      "### Thread Refs",
      threadRefsLine,
      "",
      "### Body",
      memoBody,
      "",
      this.renderHookBudget(activeHookCount, language),
      "",
      "## Pending Hooks Snapshot",
      pendingHooks,
      "",
      "## Chapter Summaries Snapshot",
      chapterSummaries,
      "",
    ].join("\n");
  }

  private unique(values: ReadonlyArray<string>): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }

  private isChineseLanguage(language: string | undefined): boolean {
    return (language ?? "zh").toLowerCase().startsWith("zh");
  }

  // Kept for potential subclasses reading seed files directly.
  protected async readFileOrDefault(path: string): Promise<string> {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return "(文件尚未创建)";
    }
  }

  /**
   * Generate 2 alternate plan memo variants using the primary plan as context.
   * Makes onellama call with the primary memo as seed to generate a different variant.
   */
  private async generateMemosWithVariants(
    planInput: PlanChapterInput,
    _seedInput: {
      readonly fallbackGoal: string;
      readonly chapterSummariesRaw: string;
      readonly previousEndingExcerpt?: string;
      readonly brief?: string;
      readonly chapterContext?: string;
      readonly recyclableHooks?: ReadonlyArray<StoredHook>;
      readonly language?: "zh" | "en";
      readonly chapterGoal?: ChapterGoalCard;
      readonly authorIntentBlock?: string;
    },
  ): Promise<MemoVariant[]> {
    // Simple approach: make 2 additional LLM calls with varied temperatures.
    // The primary memo is already generated. We ask the LLM to produce
    // alternative versions with different emphasis.
    const language = _seedInput.language ?? "zh";
    const chapterNumber = planInput.chapterNumber;

    const emphasisPrompts = language === "en"
      ? [
          "Produce a variant of this chapter memo that emphasizes CONFLICT and PLOT PROGRESSION.",
          "Produce a variant of this chapter memo that emphasizes CHARACTER INTERIORITY and EMOTIONAL DEPTH.",
        ]
      : [
          "请生成一个本章 memo 的变体版本，更侧重**冲突推进和情节张力**。",
          "请生成一个本章 memo 的变体版本，更侧重**角色内心和情感深度**。",
        ];

    const labelTemplates = language === "en"
      ? ["Conflict-forward", "Character-inward"]
      : ["冲突推进优先", "角色内心优先"];

    const variants: MemoVariant[] = [];

    for (let i = 0; i < emphasisPrompts.length; i++) {
      try {
        const systemPrompt = getPlannerMemoSystemPrompt(language);
        const userMessage = `${emphasisPrompts[i]}

章号: ${chapterNumber}，目标是: ${_seedInput.fallbackGoal}

请以标准 YAML frontmatter + 7段正文格式输出。`;

        const messages: Array<{ role: "system" | "user"; content: string }> = [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ];

        const response = await this.chat(messages, { temperature: this.ctx.temperature ?? 0.85 });

        const parsed = parseMemo(response.content, chapterNumber, false);
        variants.push({
          id: `variant-${String.fromCharCode(98 + i)}`, // b, c
          label: labelTemplates[i],
          description: language === "en"
            ? `Alternative memo variant #${i + 1}`
            : `第 ${i + 1} 个备选 memo 方案`,
          memo: parsed,
          intent: {
            chapter: chapterNumber,
            goal: parsed.goal,
            mustKeep: [],
            mustAvoid: [],
            styleEmphasis: [],
          },
        });
      } catch {
        // Skip unparseable variants
      }
    }

    return variants;
  }
}
