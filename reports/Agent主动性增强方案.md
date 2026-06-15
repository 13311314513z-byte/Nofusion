# Agent 主动性增强方案

> 如何让 NoFusion 的 Agent 在书籍建立与章节撰写过程中更具主动性——主动提问、主动厘清细节、主动帮助作者确认钩子。

---

## 一、现状评估

### 已有基础（已实现的）

| 组件 | 功能 | 主动性等级 |
|------|------|-----------|
| `Interviewer` Agent | 基于故事状态生成写作前问题（4级问题） | Level 1 — 被动调用 |
| `SuggestionGenerator` | 纯规则的问题建议生成（零 LLM 成本） | Level 1 — 被动调用 |
| `AuthorChapterIntent` | 作者意图数据模型 + 持久化 | Level 0 — 数据容器 |
| `IntentInjection` | 将作者意图注入 Planner/Auditor prompt | Level 0 — 管道 |
| `PostWriteValidator` | 校验关键画面是否出现在生成内容中 | Level 1 — 后处理 |
| `IntentCommitment` (memory-db) | 追踪作者的"承诺"并验证 | Level 1 — 记录 |

### 差距分析

**Agent 没有"主动意识"**：所有现有机制都是**被动触发的**——用户必须：
1. 手动打开 Studio UI 上的"写作前深度访谈"面板
2. 或者手动调用 `inkos agent "..."` 指令
3. 系统从不主动"敲门"

**关键场景缺失**：

| 场景 | 当前行为 | 期望行为 |
|------|---------|---------|
| 用户执行 `write next` | 直接规划→撰写→审计 | 先检查是否有未答关键问题 → 如有则暂停并提问 |
| 连续写多章后 | 每章独立运行，无跨章意识 | 每 N 章主动做一次"健康检查" |
| 伏笔挂了 10 章没推进 | 无人提醒 | Agent 主动提醒："第 12 章埋的'神秘信件'已搁置 8 章" |
| 某角色连续 15 章未出场 | 无人发现 | Agent 主动标记："配角'林薇'已 15 章未出现" |
| 质量评分连续下降 | 每章审计独立，无趋势感知 | Agent 主动预警："最近 5 章质量持续下降" |
| 用户暂停后回归 | 从断点继续，无上下文恢复 | Agent 主动总结："上次写第 23 章，当前有哪些待处理事项" |
| 章节生成后 | 审计通过即结束 | 主动问："这一章是否达到了你预期的读者感受？" |

---

## 二、主动性架构设计

### 核心思想：Proactivity Pipeline

在现有 Pipeline 中插入一个**主动层（Proactivity Layer）**，与现有 Agent 管线并行工作：

```
用户操作入口
    │
    ▼
┌─────────────────────────────────────┐
│        Proactivity Engine            │
│  ┌───────────┐  ┌────────────────┐  │
│  │ Rule-based │  │  LLM-assisted  │  │
│  │  Checks    │  │  (opt-in)      │  │
│  └─────┬─────┘  └───────┬────────┘  │
│        │               │            │
│        ▼               ▼            │
│  ┌─────────────────────────────────┐│
│  │    Priority Queue               ││
│  │  (urgent / normal / info)       ││
│  └──────────────┬──────────────────┘│
└─────────────────┼───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│        User Interaction Layer        │
│  (CLI prompt / Studio modal / TUI)  │
└─────────────────────────────────────┘
                  │
          (user answers or dismisses)
                  │
                  ▼
┌─────────────────────────────────────┐
│        Execution Decision            │
│  proceed / modify / abort           │
└─────────────────────────────────────┘
```

### 主动性等级定义

| 等级 | 名称 | 行为 | 实现方式 |
|------|------|------|---------|
| L0 | 静默 | 不提问，完全被动 | 纯管道，无交互 |
| L1 | 询问式 | 在关键节点弹出预设问题 | Rule-based + 模板 |
| L2 | 探测式 | 分析上下文后提针对性问题 | Rule-based + 状态分析 |
| L3 | 建议式 | 主动提出叙事建议 | LLM-assisted（可选） |
| L4 | 阻断式 | 关键信息缺失时阻止生成 | L2 + 门禁控制 |

---

## 三、具体实现方案

### 3.1 新建 `ProactiveEngine`（核心组件）

**位置**：`packages/core/src/proactive/engine.ts`

这是整个主动性系统的中枢。它不直接继承 BaseAgent（因为不需要 LLM），但可以引用所有 Agent。

```typescript
// proactive/engine.ts

export interface ProactiveSignal {
  readonly id: string;
  readonly type: "question" | "suggestion" | "alert" | "reminder";
  readonly urgency: "urgent" | "normal" | "info";
  readonly source: string;       // 哪个检测器触发的
  readonly title: string;        // 简短标题
  readonly message: string;      // 要展示给用户的消息
  readonly context: string;      // 背后的上下文/理由
  readonly actions: ReadonlyArray<{
    readonly label: string;      // 用户可选的操作按钮
    readonly action: string;     // 操作标识符
  }>;
  readonly relatedChapter?: number;
  readonly createdAt: number;    // Date.now()
}

export interface ProactiveInput {
  readonly bookDir: string;
  readonly bookId: string;
  readonly chapterNumber: number;  // 当前/下一章编号
  readonly stage: "pre-write" | "post-write" | "inter-chapter" | "on-resume" | "periodic";
}

export async function runProactiveChecks(
  input: ProactiveInput,
  bookDir: string,
): Promise<ReadonlyArray<ProactiveSignal>> {
  const signals: ProactiveSignal[] = [];

  // 并行运行所有检测器
  const results = await Promise.allSettled([
    checkMissingIntent(input, bookDir),       // 意图缺失检查
    checkHookMaturity(input, bookDir),         // 伏笔成熟度检查
    checkCharacterAbsence(input, bookDir),     // 角色缺席检查
    checkSubplotDormancy(input, bookDir),      // 副线休眠检查
    checkQualityTrend(input, bookDir),         // 质量趋势检查
    checkContinuityDecay(input, bookDir),      // 连续性退化检查
    checkUnresolvedCliffhanger(input, bookDir), // 未解决悬念检查
  ]);

  for (const result of results) {
    if (result.status === "fulfilled" && result.value.length > 0) {
      signals.push(...result.value);
    }
  }

  // 按 urgency 排序：urgent > normal > info
  const priority = { urgent: 0, normal: 1, info: 2 };
  signals.sort((a, b) => priority[a.urgency] - priority[b.urgency]);

  return signals;
}
```

### 3.2 检测器实现（7个核心检测器）

#### ① 意图缺失检测 (`intent-gap-detector.ts`)

**功能**：在 `pre-write` 阶段，检查作者是否回答了关键问题。

```typescript
async function checkMissingIntent(
  input: ProactiveInput,
  bookDir: string,
): Promise<ReadonlyArray<ProactiveSignal>> {
  if (input.stage !== "pre-write") return [];

  const intentsIndex = await loadChapterIntents(bookDir).catch(() => null);
  if (!intentsIndex) return [];

  const intent = getChapterIntent(intentsIndex.intents, input.chapterNumber);
  const missing: string[] = [];

  if (!intent?.coreNarrative) missing.push("核心叙述（这一章在讲什么）");
  if (!intent?.readerTakeaway) missing.push("读者感受目标");
  if (!intent?.keyMoment) missing.push("关键画面/时刻");
  if (!intent?.scenes || intent.scenes.length === 0) missing.push("场景规划");

  if (missing.length === 0) return [];

  return [{
    id: `intent-gap-${input.chapterNumber}`,
    type: "question",
    urgency: missing.length >= 3 ? "urgent" : "normal",
    source: "intent-gap-detector",
    title: `第 ${input.chapterNumber} 章还有 ${missing.length} 个问题未回答`,
    message: `在开始写作前，建议先回答：${missing.join("、")}。\n不回答也可以继续，但写作质量可能不如预期。`,
    context: `缺失字段：${missing.join("、")}`,
    actions: [
      { label: "去回答", action: "open-interview" },
      { label: "跳过，直接写", action: "skip" },
    ],
    relatedChapter: input.chapterNumber,
    createdAt: Date.now(),
  }];
}
```

#### ② 伏笔成熟度检测 (`hook-maturity-detector.ts`)

**功能**：检测是否有伏笔挂了太久没推进。

```typescript
async function checkHookMaturity(
  input: ProactiveInput,
  bookDir: string,
): Promise<ReadonlyArray<ProactiveSignal>> {
  const storyDir = join(bookDir, "story");
  const hooksRaw = await readPendingHooks(storyDir).catch(() => "");
  if (!hooksRaw) return [];

  // 解析 pending_hooks.md 中的伏笔表格
  // 假设格式: | 伏笔ID | 埋入章节 | 描述 | 状态 | 计划回收章节 |
  const hooks = parseHooksTable(hooksRaw, input.chapterNumber);
  const signals: ProactiveSignal[] = [];

  for (const hook of hooks) {
    const chaptersSinceBuried = input.chapterNumber - hook.buriedAtChapter;
    const expectedRecovery = hook.plannedRecoveryAt
      ? hook.plannedRecoveryAt - input.chapterNumber
      : Infinity;

    // 阈值：埋入超过 5 章未推进
    if (chaptersSinceBuried >= 5 && hook.status === "pending") {
      const urgency = chaptersSinceBuried >= 10 ? "urgent" : "normal";
      signals.push({
        id: `hook-mature-${hook.id}`,
        type: "reminder",
        urgency,
        source: "hook-maturity-detector",
        title: `伏笔"${hook.desc}"已挂起 ${chaptersSinceBuried} 章`,
        message: `第 ${hook.buriedAtChapter} 章埋下的伏笔"${hook.desc}"已 ${chaptersSinceBuried} 章未推进。`
          + (expectedRecovery <= 3
            ? `计划 ${hook.plannedRecoveryAt} 章回收，建议本章考虑推进。`
            : "建议在本章或近期章节中提及。"),
        context: `${chaptersSinceBuried} 章未推进，状态：${hook.status}`,
        actions: [
          { label: "在本章推进", action: "advance-hook" },
          { label: "稍后提醒", action: "dismiss" },
        ],
        relatedChapter: input.chapterNumber,
        createdAt: Date.now(),
      });
    }
  }

  return signals;
}
```

#### ③ 角色缺席检测 (`character-absence-detector.ts`)

**功能**：检测重要角色太久没出场。

```typescript
async function checkCharacterAbsence(
  input: ProactiveInput,
  bookDir: string,
): Promise<ReadonlyArray<ProactiveSignal>> {
  const storyDir = join(bookDir, "story");
  const summariesRaw = await readChapterSummaries(storyDir).catch(() => "");
  const matrixRaw = await readCharacterMatrix(storyDir).catch(() => "");
  if (!summariesRaw || !matrixRaw) return [];

  const characters = parseCharacterMatrix(matrixRaw);
  const recentSummaries = parseRecentSummaries(summariesRaw, input.chapterNumber, 20);

  const signals: ProactiveSignal[] = [];
  for (const char of characters) {
    if (char.importance === "minor") continue; // 只检查主要角色

    const lastAppearance = findLastAppearance(char.name, recentSummaries);
    const chaptersAbsent = input.chapterNumber - lastAppearance;

    if (chaptersAbsent >= 10) {
      signals.push({
        id: `char-absent-${char.name}`,
        type: "alert",
        urgency: chaptersAbsent >= 20 ? "urgent" : "normal",
        source: "character-absence-detector",
        title: `"${char.name}"已 ${chaptersAbsent} 章未出场`,
        message: `${char.name}（${char.role}）最后一次出现在第 ${lastAppearance} 章。`
          + (chaptersAbsent >= 20
            ? "长期缺席可能导致读者遗忘这个角色。建议安排出场或通过其他角色提及。"
            : "如果这是有意的支线安排，可以忽略。"),
        context: `角色：${char.name}，角色：${char.role}，缺席章数：${chaptersAbsent}`,
        actions: [
          { label: "在规划中关注", action: "note-in-plan" },
          { label: "已知情，忽略", action: "dismiss" },
        ],
        relatedChapter: input.chapterNumber,
        createdAt: Date.now(),
      });
    }
  }

  return signals;
}
```

#### ④ 副线休眠检测 (`subplot-dormancy-detector.ts`)

**功能**：检测副线太久没进展。

```typescript
async function checkSubplotDormancy(
  input: ProactiveInput,
  bookDir: string,
): Promise<ReadonlyArray<ProactiveSignal>> {
  const storyDir = join(bookDir, "story");
  const subplotRaw = await readSubplotBoard(storyDir).catch(() => "");
  if (!subplotRaw) return [];

  const subplots = parseSubplots(subplotRaw, input.chapterNumber);
  const signals: ProactiveSignal[] = [];

  for (const plot of subplots) {
    const chaptersSinceUpdate = input.chapterNumber - plot.lastAdvancedAt;

    if (chaptersSinceUpdate >= 8 && plot.status === "active") {
      signals.push({
        id: `subplot-dormant-${plot.id}`,
        type: "reminder",
        urgency: chaptersSinceUpdate >= 15 ? "urgent" : "normal",
        source: "subplot-dormancy-detector",
        title: `副线"${plot.name}"已 ${chaptersSinceUpdate} 章未推进`,
        message: `"${plot.name}"副线上次推进在第 ${plot.lastAdvancedAt} 章。`
          + "读者可能已经忘了这条线。建议在本章或近期章节中给出进展信号——"
          + "哪怕只是侧面提及也能保持存在感。",
        context: `副线：${plot.name}，状态：${plot.status}，上次推进：第 ${plot.lastAdvancedAt} 章`,
        actions: [
          { label: "在规划中推进", action: "note-in-plan" },
          { label: "这条线已结束", action: "mark-resolved" },
          { label: "忽略", action: "dismiss" },
        ],
        relatedChapter: input.chapterNumber,
        createdAt: Date.now(),
      });
    }
  }

  return signals;
}
```

#### ⑤ 质量趋势检测 (`quality-trend-detector.ts`)

**功能**：检测审计评分是否连续下降。

```typescript
async function checkQualityTrend(
  input: ProactiveInput,
  bookDir: string,
): Promise<ReadonlyArray<ProactiveSignal>> {
  if (input.stage !== "post-write" && input.stage !== "periodic") return [];

  // 从 memory-db 读取最近 N 章的审计评分
  const db = await tryCreateMemoryDB(bookDir).catch(() => null);
  if (!db) return [];

  const recentRatings = await db.getRecentChapterRatings(input.chapterNumber, 10);
  if (recentRatings.length < 5) return []; // 数据不足

  // 简单线性趋势计算：最近 5 章评分是否连续下降
  const last5 = recentRatings.slice(-5);
  let decliningCount = 0;
  for (let i = 1; i < last5.length; i++) {
    if (last5[i]!.score < last5[i - 1]!.score) decliningCount++;
  }

  if (decliningCount >= 4) {
    // 4/5 的章在下降
    return [{
      id: `quality-decline-${input.chapterNumber}`,
      type: "alert",
      urgency: "normal",
      source: "quality-trend-detector",
      title: "最近 5 章质量评分持续下降",
      message: `第 ${last5[0]!.chapterNumber}~${last5[4]!.chapterNumber} 章的评分依次为：`
        + last5.map((r) => `${r.chapterNumber}章:${r.score}`).join(" → ")
        + "。可能的原因：节奏问题、角色行为不一致、或作者疲劳。建议回顾这几章。",
      context: `最近 5 章评分：${last5.map((r) => r.score).join(", ")}`,
      actions: [
        { label: "查看趋势详情", action: "open-analytics" },
        { label: "知道了", action: "dismiss" },
      ],
      relatedChapter: input.chapterNumber,
      createdAt: Date.now(),
    }];
  }

  return [];
}
```

#### ⑥ 连续性退化检测 (`continuity-decay-detector.ts`)

**功能**：检测是否有角色状态出现不一致。

```typescript
async function checkContinuityDecay(
  input: ProactiveInput,
  bookDir: string,
): Promise<ReadonlyArray<ProactiveSignal>> {
  if (input.stage !== "post-write") return [];

  // 读取当前章的角色状态，与前一章对比
  const storyDir = join(bookDir, "story");
  const currentState = await readCurrentStateWithFallback(bookDir).catch(() => "");
  const prevSnapshotDir = join(storyDir, "snapshots", String(input.chapterNumber - 1));
  const prevStatePath = join(prevSnapshotDir, "state.json");

  let prevState: Record<string, unknown> | null = null;
  try {
    const prevRaw = await readFile(prevStatePath, "utf-8");
    prevState = JSON.parse(prevRaw);
  } catch {
    return []; // 没有前一章快照，无法对比
  }

  // 对比关键角色状态
  const inconsistencies = detectStateInconsistencies(currentState, prevState);
  if (inconsistencies.length === 0) return [];

  return [{
    id: `continuity-issue-${input.chapterNumber}`,
    type: "alert",
    urgency: "normal",
    source: "continuity-decay-detector",
    title: `检测到 ${inconsistencies.length} 处状态不一致`,
    message: inconsistencies.map((i) => `- ${i}`).join("\n"),
    context: inconsistencies.join("; "),
    actions: [
      { label: "修正", action: "fix-continuity" },
      { label: "这是有意为之", action: "acknowledge" },
    ],
    relatedChapter: input.chapterNumber,
    createdAt: Date.now(),
  }];
}
```

#### ⑦ 未解决悬念检测 (`cliffhanger-detector.ts`)

**功能**：检测上一章结尾的悬念是否在本章开头被忽略。

```typescript
async function checkUnresolvedCliffhanger(
  input: ProactiveInput,
  bookDir: string,
): Promise<ReadonlyArray<ProactiveSignal>> {
  if (input.stage !== "pre-write") return [];

  // 读取上一章的结尾和当前章的内容（如果已存在）
  const chaptersDir = join(bookDir, "chapters");
  const prevChapterContent = await readChapterContent(chaptersDir, input.chapterNumber - 1).catch(() => "");
  if (!prevChapterContent) return [];

  // 检测上一章是否以悬念结尾（最后一段包含问句、省略号、突然中断等）
  const lastParagraph = extractLastParagraph(prevChapterContent);
  const hasCliffhanger = detectCliffhanger(lastParagraph);

  if (!hasCliffhanger) return [];

  return [{
    id: `cliffhanger-${input.chapterNumber}`,
    type: "reminder",
    urgency: "normal",
    source: "cliffhanger-detector",
    title: "上一章以悬念结尾",
    message: `上一章结尾："${lastParagraph.slice(0, 80)}..."\n`
      + "建议在本章开头回应这个悬念，不要跳过或忽略。\n"
      + "不一定要立刻揭晓，但至少要提及角色对上一章事件的反应。",
    context: `悬念检测命中：${lastParagraph.slice(0, 100)}`,
    actions: [
      { label: "在规划中处理", action: "handle-in-plan" },
      { label: "已考虑，继续", action: "proceed" },
    ],
    relatedChapter: input.chapterNumber,
    createdAt: Date.now(),
  }];
}
```

---

## 四、集成到 Pipeline

### 4.1 在 `PipelineRunner` 中集成

修改 `packages/core/src/pipeline/runner.ts`，在关键阶段插入主动检测：

```typescript
// 在 writeNextChapter 方法中
async writeNextChapter(bookId: string, ...): Promise<ChapterPipelineResult> {
  const stageLanguage = await this.resolveBookLanguage(book);

  // ── 【新增】Pre-write 主动检测 ──────────────────────
  const preWriteSignals = await runProactiveChecks({
    bookDir, bookId,
    chapterNumber: nextChapter,
    stage: "pre-write",
  });

  const urgentSignals = preWriteSignals.filter(s => s.urgency === "urgent");
  if (urgentSignals.length > 0) {
    // 有紧急问题 → 暂停并展示
    await this.presentSignalsToUser(urgentSignals, stageLanguage);
    // 用户可以选择继续或取消
    const decision = await this.waitForUserDecision();
    if (decision === "abort") {
      throw new Error("User aborted due to unresolved issues");
    }
  }
  // ──────────────────────────────────────────────────

  this.logStage(stageLanguage, { zh: "规划下一章意图", en: "planning next chapter intent" });
  // ... existing plan chapter code ...
}
```

### 4.2 交互层适配

#### CLI 模式（`packages/cli/src/commands/write.ts`）

在 `write next` 命令中加入交互式问答环节：

```typescript
writeCommand
  .command("next")
  .option("--skip-questions", "跳过写作前提问", false)
  .action(async (...) => {
    // 如果未跳过提问，运行 ProactiveEngine
    if (!opts.skipQuestions) {
      const signals = await runProactiveChecks({ ... });
      if (signals.length > 0) {
        for (const signal of signals) {
          await presentSignalCLI(signal);
          const answer = await askUser(signal);
          // 处理用户回答
        }
      }
    }
    // ... proceed with writing
  });
```

#### Studio 模式（`packages/studio/src/api/server.ts`）

新增端点让 Studio UI 获取主动信号：

```typescript
// GET /api/v1/books/:id/proactive-signals
app.get("/api/v1/books/:id/proactive-signals", async (c) => {
  const { id } = c.req.param();
  const bookDir = state.bookDir(id);
  const nextChapter = await state.getNextChapterNumber(id);

  const signals = await runProactiveChecks({
    bookDir,
    bookId: id,
    chapterNumber: nextChapter,
    stage: "inter-chapter",
  });

  return c.json({ signals });
});
```

---

## 五、改造现有 Agent 的主动性

除了新增 ProactiveEngine，还可以增强现有 Agent 本身的行为。

### 5.1 Interviewer 增强

现有的 `Interviewer` 已能生成问题，但缺乏**跨章感知**和**hook 追踪**。增强方向：

```typescript
// 在 interviewer.ts 的 conduct() 方法中新增

// ── Level 5: Hook-driven questions ─────────────────
// 检测是否有伏笔在本章附近计划回收
const hooks = parsePendingHooks(pendingHooks);
const dueHooks = hooks.filter(h =>
  h.plannedRecoveryAt &&
  Math.abs(h.plannedRecoveryAt - input.chapterNumber) <= 2 &&
  h.status === "pending"
);

for (const hook of dueHooks) {
  questions.push({
    id: qId("hook", questions.length),
    question: `之前计划在第 ${hook.plannedRecoveryAt} 章回收伏笔"${hook.desc}"，现在到了。你打算怎么处理？`,
    context: `伏笔埋入章节：第 ${hook.buriedAtChapter} 章`,
    level: 4,
  });
}
```

### 5.2 Planner 输出后提问

修改 `PlannerAgent.planChapter()`，在生成计划后自动提问：

```typescript
// planner.ts - planChapter() 末尾
const plan = await planner.planChapter(input);

// 【新增】规划完成后，自动生成反思问题
const reflectionQuestions = generatePlanReflections(plan, input);
if (reflectionQuestions.length > 0) {
  // 输出到 logger，让上层决定是否展示给用户
  this.log?.info(`[planner] 规划完成，有 ${reflectionQuestions.length} 个建议确认项`);
  for (const q of reflectionQuestions) {
    this.log?.info(`[planner] 确认：${q}`);
  }
}

function generatePlanReflections(
  plan: PlanChapterOutput,
  input: PlanChapterInput,
): string[] {
  const questions: string[] = [];
  
  // 检查规划中的冲突数量
  if (plan.intent.conflicts.length > 2) {
    questions.push(`本章有 ${plan.intent.conflicts.length} 个冲突点，是否需要调整规划以减少复杂度？`);
  }
  
  // 检查是否有明确的 POV
  if (!plan.intent.povCharacter) {
    questions.push("未指定本章 POV 角色，是否需要指定？");
  }
  
  return questions;
}
```

### 5.3 Writer 输出后自评

增强 `WriterAgent`，在完成章节后自动输出"自评注释"：

```typescript
// writer.ts - writeChapter() 末尾
const chapter = await writer.writeChapter(input);

// 【新增】写作自评
const selfNotes = generateWriterSelfNotes(chapter, input);
if (selfNotes.length > 0) {
  // 写入章节文件末尾作为注释（<!-- -->），不影响正文
  const notesBlock = selfNotes
    .map(n => `<!-- [writer-note] ${n} -->`)
    .join("\n");
  await appendToFile(chapter.filePath, `\n\n${notesBlock}\n`);
}

function generateWriterSelfNotes(
  chapter: WriteChapterOutput,
  input: WriteChapterInput,
): string[] {
  const notes: string[] = [];
  
  // 字数偏差提醒
  const deviation = chapter.wordCount - input.targetWordCount;
  if (Math.abs(deviation) > input.targetWordCount * 0.3) {
    notes.push(`字数偏差较大（目标${input.targetWordCount}，实际${chapter.wordCount}）`);
  }
  
  // 场景数提醒
  if (chapter.sceneCount <= 1 && input.expectedSceneCount > 2) {
    notes.push(`预计 ${input.expectedSceneCount} 个场景，实际写了 ${chapter.sceneCount} 个`);
  }
  
  return notes;
}
```

### 5.4 Auditor 输出后追问

在 `ContinuityAuditor` 审计完成后，如果发现可疑但不确定的项，标记为"需作者确认"：

```typescript
// continuity.ts - audit() 末尾
const result = await auditor.audit(input);

// 【新增】将低置信度的 issue 标记为"需确认"
for (const issue of result.issues) {
  if (issue.confidence < 0.6 && issue.severity !== "error") {
    issue.needsAuthorReview = true;
  }
}
```

---

## 六、Studio UI 集成

### 6.1 主动信号通知组件

在 `BookWorkspace.tsx` 中添加通知区域：

```tsx
// 在书工作区顶部添加主动信号栏
function ProactiveSignalBar() {
  const [signals, setSignals] = useState<ProactiveSignal[]>([]);

  useEffect(() => {
    // 每 30 秒轮询一次
    const interval = setInterval(async () => {
      const res = await fetch(`/api/v1/books/${bookId}/proactive-signals`);
      const data = await res.json();
      setSignals(data.signals.filter(s => s.urgency !== "info"));
    }, 30000);
    return () => clearInterval(interval);
  }, [bookId]);

  if (signals.length === 0) return null;

  return (
    <div className="proactive-bar">
      {signals.map(s => (
        <div key={s.id} className={`signal signal-${s.urgency}`}>
          <div className="signal-title">{s.title}</div>
          <div className="signal-message">{s.message}</div>
          <div className="signal-actions">
            {s.actions.map(a => (
              <button key={a.action} onClick={() => handleAction(a.action)}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

---

## 七、实施路线

### Phase 0（3d）：基础设施
- 实现 `ProactiveEngine` 框架（信号接口 + 调度 + 排序）
- 实现 `intent-gap-detector`（最简单，直接复用现有 `AuthorChapterIntent`）
- 在 CLI `write next` 中插入 pre-write 检查

### Phase 1（4d）：核心检测器
- 实现 `hook-maturity-detector`（解析 `pending_hooks.md`）
- 实现 `character-absence-detector`（解析 chapter summaries）
- 实现 `cliffhanger-detector`（文本分析）
- Studio UI 通知组件

### Phase 2（4d）：高级检测器
- 实现 `subplot-dormancy-detector`
- 实现 `quality-trend-detector`（需要 MemoryDB 存储评分历史）
- 实现 `continuity-decay-detector`
- 现有 Agent 增强（Interviewer/Planner/Writer/Auditor）

### Phase 3（2d）：完善与配置
- 可配置的 proactivity level（用户可以选择主动级别）
- 信号去重（同一问题不重复提醒）
- 用户"不再提醒此问题"功能
- 多语言支持

---

## 八、关键设计决策

### 1. 为什么不在每个 Agent 中单独实现，而是新增 ProactiveEngine？

| 方案 | 优点 | 缺点 |
|------|------|------|
| 在每个 Agent 中嵌入 | 耦合紧密，Agent 自身感知 | 重复代码；难以统一调度/去重/排序；修改 Agent 核心逻辑风险大 |
| **独立 ProactiveEngine** ✅ | 单一职责；可独立测试；可配置；不影响现有管线 | 需要额外的集成点 |

### 2. 为什么要区分 Rule-based 和 LLM-assisted？

- **Rule-based**（默认）：零 LLM 成本，确定性强，适合检测器（缺席、休眠、趋势）
- **LLM-assisted**（opt-in）：成本高但更智能，适合叙事建议、开放式问题

### 3. 什么情况下 Agent 应该"阻断"？

只有满足以下全部条件时才考虑阻断：
1. `urgency === "urgent"`
2. 用户尚未被告知该问题（首次检测）
3. 该检测器配置为 `blocking: true`

默认所有检测器均为非阻断，只提醒不强制。

---

## 九、总结：Agent 主动性的本质转变

```
当前状态：                                          目标状态：
                                                   
用户说"写" → Agent 执行                用户说"写" → Agent 检查状态
                                                    │
                                                    有未答问题？→ 提问
                                                    有搁置伏笔？→ 提醒
                                                    有质量下降？→ 预警
                                                    │
                                                    全部就绪 → 执行
```

核心变化：**Agent 从"指令执行者"变为"创作协作者"**——不是等着用户告诉它一切，而是主动发现用户可能忽略的维度，帮助用户成为更好的作者。
