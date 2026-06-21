/**
 * Chapter Goals & Intents routes — extracted from style.ts (B4).
 *
 * Handles chapter-goals CRUD, chapter-intents CRUD, suggestions,
 * endpoint-check, and interview endpoints.
 */
import type { ServerContext } from "../server-context.js";
import {
  loadChapterGoals, saveChapterGoals, getChapterGoal,
  upsertChapterGoal, removeChapterGoal,
  loadChapterIntents, saveChapterIntents, getChapterIntent,
  upsertChapterIntent, removeChapterIntent,
  AuthorChapterIntentSchema, generateSuggestions,
  type ChapterGoalCard, type AuthorChapterIntent,
} from "@actalk/inkos-core";
import { join } from "node:path";

export function registerChapterIntentRoutes(ctx: ServerContext): void {
  const { app, root, state: stateManager } = ctx;

  async function assertBookExists(state: ServerContext["state"], bookId: string): Promise<void> {
    try { await state.loadBookConfig(bookId); }
    catch { throw new Error(`Book not found: ${bookId}`); }
  }

  // --- Chapter Goals ---

  app.get("/api/v1/books/:id/chapter-goals", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(ctx.state, id);
    try {
      const bookDir = stateManager.bookDir(id);
      const index = await loadChapterGoals(bookDir);
      return c.json(index);
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.put("/api/v1/books/:id/chapter-goals/:chapterNumber", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(ctx.state, id);
    const chapterNumber = Number(c.req.param("chapterNumber"));
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) return c.json({ error: "Invalid chapter number" }, 400);
    const body = await c.req.json<Partial<ChapterGoalCard>>();
    try {
      const bookDir = stateManager.bookDir(id);
      const index = await loadChapterGoals(bookDir);
      const goal: ChapterGoalCard = { chapterNumber, ...getChapterGoal(index.goals, chapterNumber), ...body };
      const next = upsertChapterGoal(index.goals, goal);
      await saveChapterGoals(bookDir, next);
      return c.json({ ok: true, goal });
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.delete("/api/v1/books/:id/chapter-goals/:chapterNumber", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(ctx.state, id);
    const chapterNumber = Number(c.req.param("chapterNumber"));
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) return c.json({ error: "Invalid chapter number" }, 400);
    try {
      const bookDir = stateManager.bookDir(id);
      const index = await loadChapterGoals(bookDir);
      const next = removeChapterGoal(index.goals, chapterNumber);
      await saveChapterGoals(bookDir, next);
      return c.json({ ok: true });
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  // --- Chapter Intents (author interview) ---

  app.get("/api/v1/books/:id/chapter-intents", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(ctx.state, id);
    try {
      const bookDir = stateManager.bookDir(id);
      const index = await loadChapterIntents(bookDir);
      return c.json(index);
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.put("/api/v1/books/:id/chapter-intents/:chapterNumber", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(ctx.state, id);
    const chapterNumber = Number(c.req.param("chapterNumber"));
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) return c.json({ error: "Invalid chapter number" }, 400);
    const body = await c.req.json<Partial<AuthorChapterIntent>>();
    try {
      const bookDir = stateManager.bookDir(id);
      const index = await loadChapterIntents(bookDir);
      const existing = getChapterIntent(index.intents, chapterNumber);
      const parsedIntent = AuthorChapterIntentSchema.safeParse({
        chapterNumber, coreNarrative: body.coreNarrative ?? existing?.coreNarrative ?? "",
        readerTakeaway: body.readerTakeaway ?? existing?.readerTakeaway ?? "",
        keyMoment: body.keyMoment ?? existing?.keyMoment ?? "",
        scenes: body.scenes ?? existing?.scenes ?? [],
        characterStates: body.characterStates ?? existing?.characterStates ?? [],
        requiredBeats: body.requiredBeats ?? existing?.requiredBeats ?? [],
        forbiddenMoves: body.forbiddenMoves ?? existing?.forbiddenMoves ?? [],
        pendingHookIds: body.pendingHookIds ?? existing?.pendingHookIds ?? [],
        narrativePosition: body.narrativePosition ?? existing?.narrativePosition ?? "rising",
        plotLine: body.plotLine ?? existing?.plotLine,
        interviewCompletedAt: body.interviewCompletedAt ?? existing?.interviewCompletedAt,
      });
      if (!parsedIntent.success) return c.json({ error: "Invalid chapter intent", issues: parsedIntent.error.issues }, 400);
      const intent: AuthorChapterIntent = parsedIntent.data;
      const next = upsertChapterIntent(index.intents, intent);
      await saveChapterIntents(bookDir, next);
      return c.json({ ok: true, intent: getChapterIntent(next, chapterNumber) });
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.delete("/api/v1/books/:id/chapter-intents/:chapterNumber", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(ctx.state, id);
    const chapterNumber = Number(c.req.param("chapterNumber"));
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) return c.json({ error: "Invalid chapter number" }, 400);
    try {
      const bookDir = stateManager.bookDir(id);
      const index = await loadChapterIntents(bookDir);
      const next = removeChapterIntent(index.intents, chapterNumber);
      await saveChapterIntents(bookDir, next);
      return c.json({ ok: true });
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  // --- Chapter Intent Suggestions (rule-based, no LLM) ---

  app.get("/api/v1/books/:id/chapter-intents/:chapterNumber/suggestions", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(ctx.state, id);
    const chapterNumber = Number(c.req.param("chapterNumber"));
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) return c.json({ error: "Invalid chapter number" }, 400);
    try {
      const suggestions = await generateSuggestions(stateManager.bookDir(id), chapterNumber);
      return c.json({ suggestions });
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  // --- Endpoint Lock Check ---

  app.get("/api/v1/books/:id/chapters/:chapterNumber/endpoint-check", async (c) => {
    const id = c.req.param("id");
    const chapterNumber = Number(c.req.param("chapterNumber"));
    await assertBookExists(ctx.state, id);
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) return c.json({ error: "Invalid chapter number" }, 400);
    try {
      const bookDir = stateManager.bookDir(id);
      const { readFile, readdir: rd } = await import("node:fs/promises");
      const intentsIdx = await loadChapterIntents(bookDir).catch(() => ({ intents: [] as ReadonlyArray<AuthorChapterIntent> }));
      const intent = getChapterIntent(intentsIdx.intents, chapterNumber);
      const chaptersDir = join(bookDir, "chapters");
      let chapterContent = "";
      try {
        const files = await rd(chaptersDir);
        const padded = String(chapterNumber).padStart(4, "0");
        const match = files.find((f) => f.startsWith(padded) && f.endsWith(".md"));
        if (match) chapterContent = await readFile(join(chaptersDir, match), "utf-8");
      } catch { /* no chapters yet */ }
      const checks: Array<{ name: string; passed: boolean; detail: string }> = [];
      if (intent?.openingFrame) {
        const frame = intent.openingFrame.scene;
        const opening = chapterContent.slice(0, 200).toLowerCase();
        const hasOpening = opening.includes(frame.toLowerCase()) || frame.toLowerCase().split(/\s+/).filter((w: string) => w.length > 1).every((w: string) => opening.includes(w));
        checks.push({ name: "开篇框架", passed: hasOpening, detail: hasOpening ? "开篇与声明框架一致" : `预期开篇应包含："${frame}"` });
        if (intent.openingFrame.forbiddenOpenings?.length) {
          for (const fb of intent.openingFrame.forbiddenOpenings) {
            const found = opening.includes(fb.toLowerCase());
            checks.push({ name: `开篇禁止：${fb}`, passed: !found, detail: found ? "发现禁止的开篇模式" : "未发现禁止模式" });
          }
        }
      }
      if (intent?.closingFrame) {
        const frame = intent.closingFrame.scene;
        const closing = chapterContent.slice(-500).toLowerCase();
        const hasClosing = closing.includes(frame.toLowerCase()) || frame.toLowerCase().split(/\s+/).filter((w: string) => w.length > 1).every((w: string) => closing.includes(w));
        checks.push({ name: "收尾框架", passed: hasClosing, detail: hasClosing ? "收尾与声明框架一致" : `预期收尾应包含："${frame}"` });
      }
      if (intent?.requiredBeats?.length) {
        for (const beat of intent.requiredBeats) {
          const found = chapterContent.toLowerCase().includes(beat.toLowerCase());
          checks.push({ name: `必达事件：${beat}`, passed: found, detail: found ? "事件已达成" : "章节中未发现此事件" });
        }
      }
      if (intent?.forbiddenMoves?.length) {
        for (const move of intent.forbiddenMoves) {
          const found = chapterContent.toLowerCase().includes(move.toLowerCase());
          checks.push({ name: `禁用动作：${move}`, passed: !found, detail: found ? "章节中发现禁用动作！" : "未发现禁用动作" });
        }
      }
      return c.json({ chapterNumber, passed: checks.length > 0 ? checks.every((ch) => ch.passed) : true, checks, hasIntent: !!intent });
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  // --- Chapter Intent Interview ---

  app.get("/api/v1/books/:id/interview", async (c) => {
    const id = c.req.param("id");
    const chapterNumber = Number(c.req.query("chapter"));
    await assertBookExists(ctx.state, id);
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) return c.json({ error: "Invalid chapter number" }, 400);
    try {
      const bookDir = stateManager.bookDir(id);
      const intentsIdx = await loadChapterIntents(bookDir).catch(() => ({ intents: [] as ReadonlyArray<AuthorChapterIntent> }));
      const existingIntent = getChapterIntent(intentsIdx.intents, chapterNumber);
      const goalsIdx = await loadChapterGoals(bookDir).catch(() => ({ goals: [] as ReadonlyArray<ChapterGoalCard> }));
      const chapterGoal = getChapterGoal(goalsIdx.goals, chapterNumber);
      const questions: Array<{ id: string; question: string; context: string; level: number; prefill?: string }> = [];
      if (!existingIntent?.coreNarrative) questions.push({ id: "core_narrative", question: "用一句话说清：这一章在讲什么？", context: chapterGoal?.mainConflict ? `已设定核心矛盾：「${chapterGoal.mainConflict}」` : "还没有设定章节目标", level: 1 });
      if (!existingIntent?.readerTakeaway) questions.push({ id: "reader_takeaway", question: "读者读完这一章后，你最希望他们感受到什么？", context: "思考读者的情感体验——紧张、释然、好奇、愤怒、温暖？", level: 1 });
      if (!existingIntent?.keyMoment) questions.push({ id: "key_moment", question: "这一章最重要的一个画面或瞬间是什么？", context: "如果这一章只能让读者记住一个画面，那是什么？", level: 1 });
      if (!existingIntent?.scenes || existingIntent.scenes.length === 0) questions.push({ id: "scene_count", question: "这一章大概有几个场景？主要的场景切换是什么？", context: chapterGoal?.location ? `目标地点为「${chapterGoal.location}」` : "可以用地点切换来划分场景", level: 2, prefill: chapterGoal?.location ?? undefined });
      questions.push({ id: "character_emotion", question: "这一章出场的角色中，谁的情绪变化最大？从什么变为什么？", context: "角色的情绪变化是推动故事的情感引擎", level: 3 });
      questions.push({ id: "must_avoid", question: "这一章绝对不能出现什么？", context: "比如：主角不能示弱、秘密不能暴露、某角色不能出场", level: 4 });
      const triggers: Array<{ type: string; message: string; severity: "info" | "warning" | "critical" }> = [];
      try {
        const { readFile: rf } = await import("node:fs/promises");
        const hooksPath = join(bookDir, "story", "state", "hooks.json");
        const raw = await rf(hooksPath, "utf-8");
        const hooks = (JSON.parse(raw) as { hooks?: Array<{ hookId: string; status: string; halfLifeChapters?: number; lastAdvancedChapter: number }> }).hooks ?? [];
        const overdue = hooks.filter((h) => h.status !== "resolved" && h.halfLifeChapters && (chapterNumber - h.lastAdvancedChapter) > h.halfLifeChapters);
        if (overdue.length > 0) triggers.push({ type: "hooks_overdue", message: `${overdue.length} 条伏笔已逾期：${overdue.map((h) => h.hookId).join("、")}`, severity: overdue.length >= 3 ? "critical" : "warning" });
        if (hooks.filter((h) => h.status !== "resolved").length === 0) triggers.push({ type: "hooks_empty", message: "尚无活跃伏笔——建议在本章埋下至少一条新伏笔", severity: "info" });
      } catch { /* hooks.json not found */ }
      if (!chapterGoal) triggers.push({ type: "goal_missing", message: "未设定本章目标——建议先在「目标」面板填写核心矛盾和必达事件", severity: "warning" });
      return c.json({ chapterNumber, questions, triggers, hasExistingIntent: !!existingIntent });
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });
}
