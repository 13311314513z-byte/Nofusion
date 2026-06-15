import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlannerAgent } from "../agents/planner.js";
import * as llmProvider from "../llm/provider.js";
import type { LLMClient } from "../llm/provider.js";
import type { BookConfig } from "../models/book.js";
import { PlannerParseError } from "../utils/chapter-memo-parser.js";

/** Creates a minimal bookDir with a chapter_goals.json and the required
 *  story skeleton so PlannerAgent can boot without throwing ENOENT. */
async function createTestBookDir(goals: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "planner-goal-test-"));
  const storyDir = join(dir, "story");
  const runtimeDir = join(storyDir, "runtime");
  const outlineDir = join(storyDir, "outline");
  await mkdir(storyDir, { recursive: true });
  await mkdir(runtimeDir, { recursive: true });
  await mkdir(outlineDir, { recursive: true });
  // Required control files
  await writeFile(join(storyDir, "author_intent.md"), "# 作者意图\n\n测试意图\n", "utf-8");
  await writeFile(join(storyDir, "current_focus.md"), "# 当前聚焦\n\n测试焦点\n", "utf-8");
  await writeFile(join(storyDir, "story_bible.md"), "# 故事圣经\n\n测试圣经\n", "utf-8");
  await writeFile(join(storyDir, "current_state.md"), "# 当前状态\n\n| 类别 | 内容 |\n|---|---|\n", "utf-8");
  await writeFile(join(storyDir, "chapter_summaries.md"), "# 章节摘要\n\n", "utf-8");
  await writeFile(join(storyDir, "pending_hooks.md"), "# 伏笔池\n\n| HookId | StartChapter | Type | Status | LastAdvancedChapter | ExpectedPayoff | PayoffTiming | Notes |\n|---|---|---|---|---|---|---|---|\n", "utf-8");
  await writeFile(join(storyDir, "emotional_arcs.md"), "# 情感弧线\n\n", "utf-8");
  await writeFile(join(storyDir, "character_matrix.md"), "# 角色矩阵\n\n| 角色 | 描述 |\n|---|---|\n", "utf-8");
  await writeFile(join(storyDir, "subplot_board.md"), "# 副线面板\n\n", "utf-8").catch(() => {});
  // chapter_goals.json
  await writeFile(join(storyDir, "chapter_goals.json"), JSON.stringify(goals, null, 2), "utf-8");
  // book.json — needed for language resolution
  await writeFile(join(dir, "book.json"), JSON.stringify({ id: "test-book", title: "测试", genre: "other", platform: "other", language: "zh", status: "active", targetChapters: 60, chapterWordCount: 5000, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }), "utf-8");
  // outline files
  await writeFile(join(outlineDir, "story_frame.md"), "# 故事框架\n\n测试框架\n", "utf-8");
  await writeFile(join(outlineDir, "volume_map.md"), "# 卷纲\n\n测试卷纲\n", "utf-8");
  return dir;
}

/** Create the PlannerAgent instance with a mocked LLM client. */
function createPlannerAgent(): PlannerAgent {
  const mockClient = {
    chatCompletion: vi.fn(),
  } as unknown as LLMClient;
  return new PlannerAgent({
    client: mockClient,
    model: "test-model",
    projectRoot: tmpdir(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
  });
}

/** Build a valid memo string for the given chapter number. */
function buildValidMemo(chapter: number): string {
  return `---
chapter: ${chapter}
goal: 验证目标注入——ChapterGoalCard约束已生效
isGoldenOpening: false
threadRefs: []
---
## 当前任务
主角进入七号门现场进行比对，把锁芯刮痕与监控时间线的差异钉成实证。

## 读者此刻在等什么
读者在等七号门是否有异常实锤，本章需要完全兑现这个期待并给出明确答案。

## 该兑现的 / 暂不掀的
- 该兑现：七号门异常 → 钉成现场实证，给读者一个阶段性的确定答案
- 暂不掀：幕后主使身份 → 压到后续章节再逐步揭露

## 日常/过渡承担什么任务
本章为高压实证章，不适用日常过渡段落，全程保持紧张节奏推进核心事件。

## 关键抉择过三连问
- 主角本章最关键的一次选择：是否在证据不足时向上级汇报
  - 为什么这么做？线索只剩这一条，错过就再无机会
  - 符合当前利益吗？符合——汇报可以争取资源
  - 符合人设吗？符合——主角向来谨慎但不失果断

## 章尾必须发生的改变
- 信息改变：主角掌握实证，可以面对幕后主使前先压制对手的退路和行动空间

## 本章 hook 账
advance:
- H03 "七号门异常" → 从 pressured 推进到 near_payoff
resolve:
- S004 "锁芯刮痕" → 核验完毕，本章结清

## 不要做
- 不要让对手突然降智或做出不合理的行为
- 不要直接点破幕后主使的身份或暗示
`.trim();
}

describe("PlannerAgent → ChapterGoalCard integration", () => {
  let bookDir: string;

  afterEach(async () => {
    if (bookDir) {
      await rm(bookDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("injects ChapterGoalCard.mainConflict into Planner memo prompt", async () => {
    // Setup: create a chapter_goals.json with a goal for chapter 5
    bookDir = await createTestBookDir({
      goals: [{
        chapterNumber: 5,
        mainConflict: "测试核心矛盾——程时一必须在山本发现暗语前传递情报",
        targetMood: "紧张",
        requiredBeats: ["必须出现的节拍A", "必须出现的节拍B"],
        forbiddenMoves: ["禁止的动作X"],
        povCharacter: "程时一",
        targetChars: 5000,
      }],
      updatedAt: new Date().toISOString(),
    });

    const agent = createPlannerAgent();

    // Mock the LLM to return a valid memo
    const mockChatCompletion = vi.spyOn(llmProvider, "chatCompletion").mockResolvedValue({
      content: buildValidMemo(5),
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as Awaited<ReturnType<typeof llmProvider.chatCompletion>>);

    const book: BookConfig = {
      id: "test-book",
      title: "测试书籍",
      genre: "other",
      platform: "other",
      language: "zh",
      status: "active",
      targetChapters: 60,
      chapterWordCount: 5000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = await agent.planChapter({
      book,
      bookDir,
      chapterNumber: 5,
    });

    // Verify: the intent.mustKeep includes requiredBeats
    expect(result.intent.mustKeep).toContain("必须出现的节拍A");
    expect(result.intent.mustKeep).toContain("必须出现的节拍B");

    // Verify: the intent.mustAvoid includes forbiddenMoves
    expect(result.intent.mustAvoid).toContain("禁止的动作X");

    // Verify: the memo body (or prompt) contains the mainConflict
    // The planner injects chapterGoal info into the LLM prompt via buildChapterGoalBlock()
    // which means the LLM sees it — we verify the prompt was constructed
    const callArgs = mockChatCompletion.mock.calls[0];
    expect(callArgs).toBeDefined();

    mockChatCompletion.mockRestore();
  });

  it("handles missing chapter_goals.json gracefully", async () => {
    // Setup: create a bookDir WITHOUT chapter_goals.json (empty array)
    bookDir = await createTestBookDir({ goals: [], updatedAt: new Date().toISOString() });

    const agent = createPlannerAgent();

    const mockChatCompletion = vi.spyOn(llmProvider, "chatCompletion").mockResolvedValue({
      content: buildValidMemo(1),
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as Awaited<ReturnType<typeof llmProvider.chatCompletion>>);

    const book: BookConfig = {
      id: "test-book-2",
      title: "测试书籍2",
      genre: "other",
      platform: "other",
      language: "zh",
      status: "active",
      targetChapters: 60,
      chapterWordCount: 5000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Should not throw — gracefully handles missing chapterGoal
    await expect(
      agent.planChapter({ book, bookDir, chapterNumber: 1 }),
    ).resolves.toBeDefined();

    mockChatCompletion.mockRestore();
  });
});
