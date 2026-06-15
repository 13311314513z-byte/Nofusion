# 写作质量提升：Agent 管线深度改造建议

> 本报告聚焦**写作质量本身**的提升，不讨论工程治理、安全修复或 UI 完善。
> 核心问题：如何让 InkOS 的产出从"可供阅读"变为"让人想读下去"？
> 
> **目标**：将 Agent 管线从"规则遵守者"改造为"故事讲述者"。

---

## 一、根本问题：合规 ≠ 好看

### 1.1 当前管线优化的目标函数

```
当前管线优化目标：
  maximize(审计通过率, 字数达标率, Hook追踪率, 风格一致率)
  
目标管线优化目标：
  maximize(读者投入度, 情感共鸣度, 章节期待值, 角色真实感)
       subject to(审计通过, 字数达标, Hook回收)
```

当前管线所有 Agent 的 prompt 都在说"should"——你应该包含这个、你应该避免那个。没有一个 Agent 在问"读者此刻需要什么"。

### 1.2 合规写作的典型产出特征

| 特征 | 表现 | 读者感受 |
|------|------|----------|
| **安全但平庸** | 每段都符合规则，但没有任何段落让人印象深刻 | "读完了，然后呢？" |
| **完整但无高潮** | 所有 requiredBeats 都覆盖了，但节奏平铺直叙 | "好像每一章都差不多" |
| **正确但无灵魂** | 角色行为符合设定，但没有令人惊喜的瞬间 | "角色很扁平" |
| **连贯但无悬念** | Hook 都回收了，但读者永远不急于知道下一章 | "可以随时放下" |
| **规范但无细节** | 场景描写"正确"但缺乏感官沉浸 | "像是在看大纲，不是在看小说" |

### 1.3 价值写作的四个维度

```
                  读者投入度
                  (想读下一章吗?)
                      ↑
                      |
      角色真实感 ←────┼────→ 情感共鸣度
      (角色像真人吗?)   |   (这段触动我了吗?)
                      ↓
                  叙事满足感
                  (这个故事值得读)
```

| 维度 | 定义 | 当前管线评估方式 | 目标评估方式 |
|------|------|-----------------|-------------|
| **读者投入度** | 读者是否被吸引想继续读 | 未评估 | Beta Reader engagement score |
| **情感共鸣度** | 读者是否在情感上被触动 | 仅记录 emotional_arcs（事后） | Emotional Beat Map（事前设计）+ 事后校验 |
| **角色真实感** | 角色是否像有血有肉的人 | 仅检查角色卡字段是否完整 | Character Authenticity Index（见下文） |
| **叙事满足感** | 故事结构是否让读者满意 | Auditor 检查 continuity | Narrative Satisfaction Score（弧线完成度+主题收束+情感兑现） |

---

## 二、被忽略的前提：作者没有机会想清楚

### 2.1 当前管线的根本盲区

当前管线的完整流程是：

```
作者创建书籍 → 管线自动生成章节 → Auditor 检查 → 作者审阅修改
```

作者只有在**生成之后**才有机会说"这不是我想要的"。生**成之前**，管线只问了一组非常薄的问题（章节目标表单中的几个字段），然后就让 AI 去猜作者想写什么。

**这是一个效率极低的反饋环**：
- AI 花大量算力生成一个"它觉得好"的版本
- 作者看完说"不对，我要的不是这个"
- AI 重新生成
- 重复直到作者满意

文档后续提出的 17 个组件（Emotional Beat Map、Scene Blueprint、Beta Reader 等），本质上是试图让 AI **猜得更准**。但一个更根本的问题是：**作者自己是否清楚这一章要写什么？**

### 2.2 核心论断

> **在让 AI 学会"猜对"之前，先让作者学会"说清"。**
> 
> 作者脑中模糊的想法 → AI 提问帮助 crystallize → 清晰的写作意图 → AI 精确执行

这不是替代 AI 生成，而是在生成之前加一个**轻量级但高价值的步骤**：通过有结构的深度提问，让作者在动笔（让 AI 代笔）之前，自己想清楚。

### 2.3 与后续 17 个组件的关系

```
写作前深度访谈（本节，3-5d）
      ↓
作者带着清晰意图进入管线
      ↓
Planner 不再需要"猜"作者想写什么，
      而是将作者意图翻译为章节指令
      ↓
Writer 执行明确意图，而非靠 prompt 暗示
      ↓
Auditor / Story Value Evaluator 评估的是
      "作者意图的执行质量"而非"AI 猜测的叙事价值"
      ↓
修改反馈从"AI 觉得不好"变为
      "AI 检测到此处偏离了你的意图，是否要修正？"
```

**本节的定位**：这是后续所有组件的前提条件。没有它，后续组件是在"猜作者想什么"上堆叠更多算力。有了它，后续组件转变为"帮作者执行想清楚的事"。

---

## 【附】可行性前置评估

> ⚠️ **重要提示**：以下方案并非一个"小优化"，而是一个**写作范式的 paradigm shift**。在投入全量实施前，需要进行系统的假设验证。

### A.1 总体可行性评分

| 维度 | 评分 | 说明 |
|------|:----:|------|
| **方向价值** | ⭐⭐⭐⭐⭐ | 从"合规"转向"读者体验"，符合产品长期目标 |
| **技术可行性** | ⭐⭐⭐ | 多数模块可实现，但依赖 LLM 的"审美判断"，稳定性存疑 |
| **工程风险** | ⭐⭐⭐ | 主体为新增组件（~20d），Planner/Writer 核心方法需做结构化增强（~10.5d），非全链路重构，但新组件间集成调试复杂度高 |
| **成本可控性** | ⭐⭐ | 全量实现约 65 人日（含测试与集成），"纯新增不修改 Agent"版本约 23 人日。原估算 33-35d 因遗漏测试/集成成本而被低估约 2 倍 |
| **可验证性** | ⭐⭐ | "读者投入度"等主观指标缺乏客观基线，A/B 测试成本高 |

### A.2 核心风险点

**风险 1：LLM 作为"读者"和"评论家"并不可靠**

Beta Reader、Story Value Evaluator、Character Authenticity Index 本质上是让 LLM 评判"这章好不好看"。但：
- 同一章多次评分可能波动很大；
- LLM 容易偏好"更复杂""更戏剧化"的表达，可能与真实读者口味脱节；
- "8/10 读者投入度"这类目标没有定义评分标准和校准集。

**风险 2：场景化生成会显著增加成本和延迟**  

当前 Writer 一次性生成一章（1 次主要调用）。场景循环改造后每章 4-8 次 Writer 调用，每个场景还有 `evaluateScene` / `rewriteScene`，加上 Beta Reader、Story Value Evaluator 等评估调用。**保守估算**：单章 token 成本可能增加 3-8 倍，生成时间从分钟级延长到十分钟级。对于长连载项目，这是不可忽略的成本。  

**此外，原估算 33-35d 因遗漏测试（~19d）和管线集成（~12.5d）被低估约 2 倍。** 全量实现实际约 65 人日。如果接受"纯新增不修改 Agent 核心"的约束，可压缩到 ~23d，但会牺牲 Writer 场景循环、Planner 四层意图等核心改造带来的质量提升。

**风险 3：新增组件集成调试复杂**

新增组件（Prompt Compiler、Issue Arbiter、Beta Reader 等）之间存在输入输出依赖。虽然不重构现有 Agent，但集成调试时一旦输出质量下降，仍可能难以定位是哪个新组件的问题。建议 Phase 1 一次只引入 1-2 个新组件，稳定后再加。

**风险 4：数据格式和集成点未明确**

StoryIntent 存储在哪里？如何与现有 `book.json`、`story_frame.md`、`chapter_goals.json` 共存？Continuity Bible 与现有 memory-db/summaries/hooks 的关系是什么？Narrative Director 的触发条件是什么？这些集成细节需要在实施前明确。

**风险 5："合规"仍是底线，不能丢弃**

当前 Auditor 虽然被批评为"只检查规则"，但这些规则（Hook 回收、continuity、AI 痕迹、长度）是读者体验的**必要条件**。新体系必须保证在提升"好看"的同时不破坏"合规"，否则会出现"好看但前后矛盾"的章节。

---

## 三、范式转换：Planner 从"任务规划"到"叙事设计"

### 3.1 当前 Planner 做了什么

```
当前 Planner:
  输入: book + chapterNumber + externalContext
  输出: ChapterIntent + ChapterMemo
  核心逻辑:
    1. loadPlanningSeedMaterials()
    2. deriveGoal() —— 从 currentFocus 提取目标
    3. collectMustKeep() / collectMustAvoid()
    4. gatherPlanningMaterials() —— 记忆检索
    5. planChapterMemo() —— LLM 生成 memo
```

**本质**：Planner 是一个"上下文装配器 + 指令生成器"。它告诉 Writer"这一章要覆盖哪些 beats"，但从不告诉 Writer"这一章应该让读者**感受到什么**"。

### 3.2 目标 Planner：叙事架构师

```diff
- Planner 输出: "第 5 章需要覆盖 beat A、B、C，字数 3000"
+ Planner 输出: "第 5 章是主角第一次面对道德抉择，
+               读者应该从'认同主角'过渡到'质疑主角'，
+               章节结尾让读者感到'不安但想知道更多'。
+               建议场景序列: 日常(400字)→触发事件(600字)→
+               内心挣扎(800字)→决策(500字)→后果(700字)"
```

### 3.4 实施：写作前深度访谈

#### 3.4.1 问题设计原则

访谈不是"填表单"，而是**通过提问让作者产生自己未曾意识到的思考**。每个问题应该：

- ✅ 让作者**具体化**："这一章最重要的一个画面是什么？"
- ✅ 让作者**站在读者角度**："你希望读者读完这一章后，最强烈的一个感受是什么？"
- ✅ 让作者**面对约束**："上一章结尾主角已经知道真相，这一章不能假装他还不知道"
- ❌ 不要问 AI 可以替作者回答的问题："这一章应该是什么风格？"（AI 可以根据全书风格推断）
- ❌ 不要问作者无法提前回答的问题："这一章的具体措辞应该怎样？"（这是 Writer 的工作）

#### 3.4.2 问题层级

```
第一层（必答，3 个核心问题）：
  ┌────────────────────────────────────────────┐
  │  用一句话说清：这一章在讲什么？              │
  │  → "陈墨发现朋友在骗他，必须在信任和         │
  │     证据之间做选择"                         │
  ├────────────────────────────────────────────┤
  │  你希望读者读完后的核心感受是什么？          │
  │  → "从'震惊'过渡到'愤怒'，结尾留下          │
  │     '他会怎么做？'的悬念"                   │
  ├────────────────────────────────────────────┤
  │  这一章最重要的一个时刻/画面是什么？         │
  │  → "陈墨看到朋友手机里的消息记录时，         │
  │     表情从难以置信到愤怒的变化"              │
  └────────────────────────────────────────────┘

第二层（建议回答，场景规划）：
  ┌────────────────────────────────────────────┐
  │  这一章由几个场景组成？                     │
  │  每个场景的目标、地点、POV 是什么？         │
  │  → Scene 1: 陈墨在家消化背叛(客厅, 陈墨)   │
  │  → Scene 2: 与朋友对峙(咖啡厅, 陈墨)       │
  │  → Scene 3: 发现更大阴谋(办公室, 反派POV)  │
  └────────────────────────────────────────────┘

第三层（按需回答，角色状态）：
  ┌────────────────────────────────────────────┐
  │  出场角色当前的情绪状态？                   │
  │  角色之间的关系是否发生变化？               │
  │  → 陈墨: 愤怒但压抑, 表面冷静内心翻涌       │
  │  → 李鹤: 得意, 以为一切在掌控中             │
  │  → 陈墨与李鹤的关系: 从信任→怀疑           │
  └────────────────────────────────────────────┘

第四层（可选，约束与提醒）：
  ┌────────────────────────────────────────────┐
  │  必须覆盖的 beats / 绝对不能出现的事       │
  │  这一章在全书中处于什么位置？               │
  │  有什么之前埋下的伏笔需要回收？             │
  └────────────────────────────────────────────┘
```

#### 3.4.3 所需 Agent 与 TypeScript 工具支撑

当前实现（BookGoalsSection.tsx + chapter-goal.ts）是一个静态表单。要让"让作者思考"真正发生，需要以下工具性支撑：

**① 上下文感知的问题生成器（新增 Agent）**

```typescript
// packages/core/src/agents/interviewer.ts
// 职责：读取当前故事状态，生成作者此刻最应该思考的问题

interface InterviewQuestion {
  readonly id: string;
  readonly question: string;           // 问题文本
  readonly context: string;            // 为什么问这个问题（来自故事状态）
  readonly level: 1 | 2 | 3 | 4;      // 问题层级
  readonly suggestedAnswer?: string;   // AI 基于故事状态的建议答案（作者可接受/拒绝/修改）
  readonly dependsOn?: string[];       // 前置问题 ID（用于追问）
}

// 问题生成不是随机的，而是基于：
//   1. 当前章节的叙事位置（开篇/高潮/收尾）
//   2. 上一章的结尾状态（读者情绪、悬而未决的问题）
//   3. 到期的伏笔（第 5 章埋下，第 8 章该回收了）
//   4. 角色状态变化（关系破裂后需要后续处理）
//   5. 作者历史回答模式（作者总是忽略某个方面，就多问）
```

这个 Agent **不替作者做决定**，只生成"你可能想考虑的问题"。作者选择回答哪些、跳过哪些。

**② 意图承诺追踪器（扩展现有 memory-db）**

```typescript
// 当作者回答了一个问题，系统记录"作者承诺了X"
interface IntentCommitment {
  readonly chapterNumber: number;
  readonly question: string;           // 原问题
  readonly answer: string;             // 作者的答案
  readonly category: "core" | "scene" | "character" | "constraint";
  readonly verified: boolean;          // Writer 执行后是否兑现
  readonly verificationResult?: string; // 未兑现时说明原因
}
```

作用：在 Audition/审校阶段，检查输出是否兑现了作者的承诺。如果作者说"这一章的结尾应该是悬念"，但 Writer 产出的是一个闭合结局，直接标记为"偏离作者意图"而非"A罩觉得不好"。

**③ 多轮追问机制（非一次性表单）**

当前表单是"一次性填写，提交就结束"。深度访谈应该是：

```
第一次提问（基于故事状态）→ 作者回答
  → AI 根据回答生成追问（"你说这一章的核心是'信任破裂'，
     那陈墨在发现真相后的第一反应是什么？愤怒？悲伤？还是冷漠？"）
  → 作者回答追问
  → 继续直到作者觉得"我已经想清楚了"
```

这不需要新 Agent，而是 interviewer.ts 的一个循环：`generateQuestion() → authorAnswers() → generateFollowUp() → ...`

**④ 数据模型扩展**

```typescript
// packages/core/src/models/chapter-intent.ts
// 比现有 ChapterGoalCard 更丰富，存储作者的完整意图

interface ChapterIntent {
  readonly chapterNumber: number;
  
  // 核心（来自第一层问题）
  readonly coreNarrative: string;         // "这一章在讲什么"
  readonly readerTakeaway: string;        // "希望读者的感受"
  readonly keyMoment: string;             // "最重要的时刻"

  // 场景规划（来自第二层）
  readonly scenes: ReadonlyArray<{
    readonly goal: string;
    readonly location: string;
    readonly povCharacter: string;
    readonly targetEmotion?: string;
  }>;

  // 角色状态（来自第三层）
  readonly characterStates: ReadonlyArray<{
    readonly characterId: string;
    readonly emotion: string;
    readonly relationshipChanges?: string;
  }>;

  // 约束（来自第四层 + 原有）
  readonly requiredBeats: ReadonlyArray<string>;
  readonly forbiddenMoves: ReadonlyArray<string>;
  readonly pendingHooks: ReadonlyArray<string>;

  // 元信息
  readonly narrativePosition: "opening" | "rising" | "climax" | "falling" | "resolution";
  readonly plotLine?: string;
  readonly interviewCompletedAt?: string;  // 记录作者完成访谈的时间
}
```

**⑤ 意图注入器（扩展现有 planner-context.ts）**

作者的回答不能只存在数据库里，必须注入到 Planner 和 Writer 的 prompt 中，且位置要足够靠前——在 AI 生成任何内容之前，先让 AI 读到"作者说这一段要这样"。

当前 `buildChapterGoalBlock()` 已经在 memo 中插入了章节目标，扩展它：

```
📝 作者说这一章：

  核心: 陈墨发现朋友在骗他，必须在信任和证据之间做选择
  读者感受: 从"震惊"过渡到"愤怒"，结尾留下"他会怎么做？"的悬念
  关键时刻: 陈墨看到朋友手机里的消息记录时的表情变化

🎭 角色状态:
  陈墨: 愤怒但压抑，表面冷静内心翻涌
  李鹤: 得意，以为一切在掌控中
  陈墨→李鹤关系: 从信任变为怀疑

📋 作者承诺（Auditor 请检查）:
  [ ] 本章结尾是悬念，不是闭合结局
  [ ] 陈墨没有在证据确凿之前就摊牌
  [ ] 读者应该对李鹤的真实动机产生更多疑问
```

#### 3.4.4 代码改动汇总

| 改动 | 文件 | 工作量 |
|------|------|:------:|
| 新增数据模型 | `packages/core/src/models/chapter-intent.ts` | 0.5d |
| 新增 interviewer Agent | `packages/core/src/agents/interviewer.ts` | 1.5d |
| 意图承诺追踪 | `packages/core/src/state/memory-db.ts` 扩展 | 0.5d |
| 意图注入增强 | `packages/core/src/utils/intent-injection.ts` | 0.5d |
| Studio 访谈 UI | `BookGoalsSection.tsx` 重写 | 2d |
| API 端点扩展 | `server.ts` 现有端点增强 | 0.5d |
| **合计** | | **~5.5d** |

**这个方向与文档后续 17 个组件的关系**：它不是替代它们，而是让它们变得有意义。一个不知道作者想什么的 Beta Reader，只能评估"AI 觉得好不好"；一个知道作者想什么的 Beta Reader，可以评估"作者的意图是否被忠实执行了"。

### 3.3 新增：StoryIntent（故事意图）

#### 3.3.1 定位

当前管线中有 `ChapterIntent`（每章的规划输出）和 `AuthorChapterIntent`（每章写作前作者的答案），但缺少一个**贯穿全书的、稳定的、作者与 AI 共享的叙事蓝图**。

```
AuthorChapterIntent       ChapterIntent             StoryIntent
（每章，作者填写）         （每章，Planner 输出）     （全书，一次性设定）
     │                        │                        │
     │  "这一章在讲什么"       │  "覆盖 beat A/B/C"     │  "这本书在讲什么"
     │  "读者感受"            │  "字数 3000"           │  "读者读完后的整体感受"
     │  "关键画面"            │  "mustKeep/mustAvoid"  │  "角色弧线的起点与终点"
     └───────────┬────────────┘                       │
                 ▼                                     │
         Narrative Director                            │
         （当前章在全书中的职能）←───────────────────────┘
```

**StoryIntent 回答的是**：作者为什么写这本书？读者读完最后一章后应该感受到什么？角色从第一页到最后一页经历了怎样的变化？— 这些问题在创建书籍时确定，全书不变，是后续所有叙事决策的**宪法级约束**。

#### 3.3.2 数据模型

```typescript
// packages/core/src/models/story-intent.ts

interface StoryIntent {
  // ===== 故事核心（全书不变） =====
  readonly corePremise: string;          // "一个普通人在极端环境下被迫成长"
  readonly thematicStatement: string;    // "真正的力量来自承担责任"

  // ===== 读者旅程 =====
  readonly readerJourney: {
    /** 全书情感弧线（关键章节的情绪坐标） */
    readonly arc: EmotionalArc[];
    /** 给读者的承诺——读完这本书你不会失望的原因 */
    readonly promiseToReader: string;    // "这将是一个关于 sacrifice 的故事"
    /** 题材契约（Genre Pact），见 五 */
    readonly genrePacts: GenrePact[];
  };

  // ===== 角色弧线 =====
  readonly characterArcs: CharacterArc[];

  // ===== 全书节奏 =====
  readonly pacingBlueprint: {
    readonly earlyChapters: PacingMode;  // 开篇: 快速建立钩子
    readonly midChapters: PacingMode;    // 中段: 张弛有度
    readonly lateChapters: PacingMode;   // 收尾: 加速推向高潮
  };
}

interface CharacterArc {
  readonly characterId: string;
  readonly startingBelief: string;       // "主角相信力量决定一切"
  readonly endingBelief: string;         // "主角明白责任比力量更重要"
  /** 信念被挑战的关键节点 */
  readonly breakingPoints: Array<{
    readonly chapter: number;
    readonly event: string;
    readonly beliefShift: string;
  }>;
}
```

#### 3.3.3 存储与生命周期

| 阶段 | 动作 | 说明 |
|------|------|------|
| **创建书籍** | 生成初始 StoryIntent | 在书籍创建流程中，引导作者填写核心 premises + 读者承诺 + 主要角色弧线。如果跳过，则从 `story_frame.md` 中推断初始值 |
| **每章写作前** | 读取 | Planner 从 `story/story_intent.json` 加载，传递给 Narrative Director 作为全书上下文 |
| **每章写作后** | 不修改 | StoryIntent 全书稳定，不在单章管线中修改 |
| **卷/弧结束** | 允许微调 | 当 Narrative Director 检测到"当前弧线已完结，进入新弧线"时，可少量调整 pacingBlueprint 后续段 |
| **外部编辑** | 手动修改 | Studio 提供 StoryIntent 编辑页面，作者可随时调整 |

**存储路径**：`books/<bookId>/story/story_intent.json`

与现有文件的关系：

| 文件 | 关系 |
|------|------|
| `story_frame.md` | StoryIntent **替代** story_frame.md 中重复的结构化字段（premise、genre等）。story_frame.md 保留为人类可读的全书描述 |
| `book.json` | `book.genre` 决定默认的 GenrePact，StoryIntent.genrePacts 可覆盖 |
| `chapter_goals.json` | 每章的短期目标（mainConflict、requiredBeats），与 StoryIntent 的长期弧线互补 |
| `chapter_intents.json` | 作者的每章主观意图（coreNarrative、readerTakeaway），受 StoryIntent 的全书承诺约束 |
| `pending_hooks.md` | StoryIntent 中的角色弧线和技术悬念定义了"哪些 hooks 是必须回收的" |

#### 3.3.4 StoryIntent 与 AuthorChapterIntent 的分工

```
                    StoryIntent (全书, 一次性设定)
                         │
                         │ "读者的最终感受是 X"
                         │ "角色 A 的终点是 B"
                         ▼
               Narrative Director
                         │
                         │ "第 5 章在全书中承担什么职能"
                         │ "当前弧线到哪一个阶段了"
                         ▼
               AuthorChapterIntent (每章, 作者填写)
                         │
                         │ "这一章我想写什么"
                         │ "读者这一章应该感受到什么"
                         ▼
               ChapterIntent (Planner 输出)
                         │
                         │ "覆盖 beat A/B/C"
                         │ "mustKeep: ..., mustAvoid: ..."
                         ▼
                      Writer
```

- **StoryIntent**：全书不变的承诺。由作者在**创建书籍时**设定，AI 在**每章生成时**读取。
- **AuthorChapterIntent**：每章可变的主观意图。由作者在**每章写作前**填写，AI 在**该章生成时**读取。
- 两者不冲突：AuthorChapterIntent 是 StoryIntent 在当前章节的**实例化**。如果作者想在某一章打破全书节奏（比如在悬疑书中插入一章轻松日常），AuthorChapterIntent 可以 override StoryIntent 的 pacingBlueprint，但需要在提交时说明理由。

#### 3.3.5 Narrative Director 如何使用 StoryIntent

Narrative Director 是 Planner 的一个增强方法（`getNarrativeDirectorNote`），它接收 StoryIntent 和当前章节号，输出：

```typescript
interface DirectorNote {
  /** 当前章在全书中承担的故事职能 */
  readonly chapterFunction: "setup" | "escalate" | "twist" | "climax" | "resolve";

  /** 当前卷/弧的进度 */
  readonly arcProgress: {
    readonly arcName: string;
    readonly overallBeatCount: number;
    readonly completedBeats: number;
  };

  /** 当前章需要推进的角色弧线 */
  readonly activeCharacterArcs: Array<{
    readonly characterId: string;
    readonly beliefAtStart: string;
    readonly expectedShift: string;
  }>;

  /** 当前阶段建议的节奏模式 */
  readonly recommendedPacing: {
    readonly tensionLevel: "low" | "medium" | "high";
    readonly infoRevealRate: "slow" | "normal" | "fast";
  };
}
```

这个 DirectorNote 和 AuthorChapterIntent 一起，被 Planner 的 `planChapterMemo()` 消费，生成最终的 ChapterIntent。

#### 3.3.6 与现有基础设施的集成路径

StoryIntent 的实现不依赖新的 Agent，而是在现有数据模型层增加一个稳定的配置文件：

```
新增: packages/core/src/models/story-intent.ts        — 数据模型 + 持久化
新增: packages/core/src/agents/narrative-director.ts  — 根据 StoryIntent + 章节号 生成 DirectorNote
修改: planner-context.ts                              — 读取 StoryIntent 并传递给 Planner
修改: planner-prompts.ts                              — 在 memo prompt 中注入 directorNote
修改: server.ts                                       — GET/PUT /books/:id/story-intent
修改: Studio UI                                       — StoryIntent 编辑页面

工作量: ~3d（不含测试），~5d（含测试与集成）
```

**这个组件与我们已经实现的 AuthorChapterIntent 互补**：
- AuthorChapterIntent 是"作者说这一章要这样"
- StoryIntent 是"这本书的终极目标是这个"
- 两者一起形成了"长期 + 短期"的双层意图约束

### 3.4 Planner 改造：四层意图生成

```
                    StoryIntent
                         ↓
               Narrative Director
          (当前章在全书中的职能)
                         ↓
               ChapterIntent (增强)
          + Emotional Beat Map
          + Scene Blueprint
          + Style Target Profile
                         ↓
                   Writer
```

**Planner 的 planChapter() 方法改造**：

```typescript
// 改造前
async planChapter(input: PlanChapterInput): Promise<PlanChapterOutput> {
  const seedMaterials = await loadPlanningSeedMaterials(...);
  const goal = this.deriveGoal(...);
  const memo = await this.planChapterMemo(...);
  return { intent, memo, intentMarkdown, ... };
}

// 改造后
async planChapter(input: PlanChapterInput): Promise<PlanChapterOutput> {
  // 1. 加载故事级意图
  const storyIntent = await this.loadStoryIntent(input.bookDir);
  
  // 2. 获取叙事指导
  const directorNote = await this.getNarrativeDirectorNote(
    input.bookDir, input.chapterNumber, storyIntent
  );
  
  // 3. 设计读者情感旅程
  const emotionalBeatMap = await this.designEmotionalBeats(
    input.chapterNumber, directorNote
  );
  
  // 4. 设计场景序列
  const sceneBlueprints = await this.designScenes(
    emotionalBeatMap, storyIntent
  );
  
  // 5. 生成风格目标
  const styleTarget = this.deriveStyleTarget(
    directorNote.chapterFunction, input.book.language
  );
  
  // 6. 生成增强的 memo（含以上所有信息）
  const memo = await this.planChapterMemo({
    ...input,
    directorNote,
    emotionalBeatMap,
    sceneBlueprints,
    storyIntent,
  });
  
  return {
    intent: this.buildEnhancedIntent(intent, {
      directorNote, emotionalBeatMap, sceneBlueprints, styleTarget
    }),
    memo,
    intentMarkdown,
    plannerInputs: materials.plannerInputs,
    runtimePath,
  };
}
```

---

## 四、范式转换：Writer 从"文字生成器"到"场景工艺师"

### 4.1 当前 Writer 做了什么

```
当前 Writer:
  输入: chapterContent + chapterIntent + chapterMemo + governedRules
  输出: 完整章节 markdown
  核心:
    1. buildWriterSystemPrompt()
    2. renderWriterUserMessage() —— 装配上下文
    3. chat() —— 一次性生成全文
```

**问题**：Writer 在"写一篇 3000 字的文章"，而不是"构建一个有节奏的场景序列"。它不知道第 3 段应该是"紧张"还是"舒缓"，因为它一次性生成所有段落。

### 4.2 目标 Writer：场景感知的逐段生成

```typescript
interface SceneWriterInput {
  readonly sceneBlueprint: SceneBlueprint;  // 场景蓝图
  readonly previousSceneEnd?: string;        // 上一场景的最后一句（用于过渡）
  readonly emotionalContext: {
    readonly readerCurrentEmotion: string;   // 读者当前情绪
    readonly targetEmotion: string;          // 本场景目标情绪
    readonly intensity: number;              // 本场景目标强度
  };
  readonly styleTarget: {
    readonly avgSentenceLength: [number, number];
    readonly dialogueRatio: [number, number];
    readonly sensoryDensity: "low" | "medium" | "high";
  };
  readonly characterVoice: Map<string, VoiceProfile>;  // 出场角色声音
}
```

**Writer 改造为场景循环**：

```typescript
async writeChapter(input: WriteChapterInput): Promise<WriteChapterOutput> {
  const scenes = input.sceneBlueprints;  // 来自 Planner
  let fullChapter = "";
  let previousSceneEnd = "";
  
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    
    // 1. 计算当前情绪上下文
    const emotionalContext = this.computeEmotionalContext(
      input.emotionalBeatMap, i
    );
    
    // 2. 加载出场角色的声音配置
    const characterVoice = await this.loadCharacterVoices(
      input.bookDir, scene.povCharacter
    );
    
    // 3. 场景级 writer 调用
    const sceneContent = await this.writeSingleScene({
      sceneBlueprint: scene,
      previousSceneEnd,
      emotionalContext,
      styleTarget: this.deriveSceneStyleTarget(scene, input.styleTarget),
      characterVoice,
      chapterIntent: input.chapterIntent,
      chapterMemo: input.chapterMemo,
    });
    
    // 4. 场景后校验
    const sceneQuality = await this.evaluateScene(sceneContent, scene);
    if (sceneQuality < SCENE_QUALITY_THRESHOLD) {
      sceneContent = await this.rewriteScene(sceneContent, sceneQuality, scene);
    }
    
    fullChapter += sceneContent + "\n\n";
    previousSceneEnd = this.extractSceneEnd(sceneContent);
  }
  
  return { content: fullChapter, ... };
}
```

### 4.3 场景工艺指南（Scene Craft Guide）

每个场景的 Writer prompt 不再是"写一段"，而是：

```
─── 场景 #3/8 ───
类型: Scene（主动场景）
POV: 陈墨
地点: 废弃工厂二楼
时段: 黄昏

场景目标:
  陈墨需要找到账本，但反派已经派人守在工厂。

冲突:
  ▶ 外部: 三个打手堵住了楼梯口
  ▶ 内部: 陈墨的手在发抖——他从未真正打过架

灾难（场景结束时）:
  账本不在工厂，这是个陷阱——陈墨意识到自己被设计了。

感官重点:
  ▸ 视觉: 夕阳通过破碎的窗户投射出长长的影子
  ▸ 听觉: 脚步声在铁皮楼梯上回响
  ▸ 触觉: 握紧的拳头上暴起的青筋
  ▸ 嗅觉: 铁锈味混着血腥味

情绪弧线（本章）:
  紧张 ↗ 恐惧 ↗ 决心 — 读者在这一场景结束时应该为陈墨捏一把汗

字数控制:
  本场景目标 600-800 字 (本章总进度: 1800/3000 = 60%)

角色声音:
  陈墨 → 冷静短句，内心独白用问句（"我真的能做到吗？"）
  反派 → 傲慢，喜欢用比喻羞辱人

禁止事项:
  ✗ 陈墨突然变成格斗高手（他还没准备好）
  ✗ 解决所有冲突（这是中段场景，不是高潮）
```

---

## 五、新增：叙事契约系统（Genre Pact）

### 5.1 概念

每个题材（genre）都有读者**潜意识期待**的"契约"。玄幻读者期待"升级打怪"，悬疑读者期待"真相层层揭开"，言情读者期待"误会与和解"。违反契约会让读者失望，但完全遵守契约又显得套路化。

好的故事在"遵守契约"和"打破预期"之间找到平衡。

### 5.2 Genre Pact 模型

```typescript
interface GenrePact {
  readonly genre: string;
  
  // 契约条款——读者对这类故事的默认期待
  readonly promises: Array<{
    readonly promise: string;             // "主角会不断变强"
    readonly importance: "core" | "expected" | "optional";
    readonly chapters: [number, number];  // 在全书的哪个阶段兑现
    readonly fulfillment: Array<{
      readonly chapter: number;
      readonly how: string;               // 如何兑现
      readonly intensity: 1-10;
    }>;
  }>;
  
  // 预期违背——打破契约但让读者更惊喜
  readonly subversions: Array<{
    readonly expectation: string;         // "主角应该轻松获胜"
    readonly reality: string;             // "但这次他付出了惨痛代价"
    readonly chapter: number;
    readonly reason: string;              // "为了让读者意识到对手真的危险"
  }>;
}

// 内置契约示例：玄幻 Covenant
const XUANHUAN_PACT: GenrePact = {
  genre: "xuanhuan",
  promises: [
    { promise: "主角有独特天赋/金手指", importance: "core",
      chapters: [1, 5], fulfillment: [{ chapter: 3, how: "丹田异变揭示", intensity: 8 }] },
    { promise: "每卷至少一次升级突破", importance: "core",
      chapters: [1, 200], fulfillment: [] },
    { promise: "战斗场面要有层次感", importance: "expected",
      chapters: [1, 200], fulfillment: [] },
    { promise: "反派智商在线", importance: "optional",
      chapters: [1, 200], fulfillment: [] },
  ],
  subversions: [
    { expectation: "主角获得金手指后一路碾压",
      reality: "金手指有代价——每次使用消耗生命力",
      chapter: 15, reason: "增加 tension，避免无敌流无聊" },
  ],
};
```

### 5.3 Pact Enforcement in Writer

Writer 在生成每个场景时，会收到当前待兑现的 covenant 条款：

```
📋 待兑现契约（本章）:
  🔴 [core] 主角天赋揭示 —— 第 3 章前必须完成（当前第 2 章）
  🟡 [expected] 至少一场完整的战斗描写 —— 建议本章包含
  🟢 [optional] 反派出场并展现实力 —— 如有余力可以加入

📋 已违背契约警告:
  ⚠️ 第 7 章应完成'首次升级'，当前第 10 章仍未兑现
```

---

## 六、新增：角色真实感系统

### 6.1 Character Authenticity Index

```typescript
interface CharacterAuthenticityReport {
  readonly characterId: string;
  
  // 一致性评分
  readonly consistency: {
    readonly dialogueConsistency: number;    // 说话方式是否一致
    readonly behaviorConsistency: number;     // 行为是否符合性格
    readonly beliefConsistency: number;       // 信念是否连贯
    readonly overall: number;
  };
  
  // 深度评分
  readonly depth: {
    readonly hasInternalConflict: boolean;    // 内心矛盾
    readonly hasSurprisingButBelievableAction: boolean; // 意料之外情理之中的行为
    readonly hasVulnerabilityMoment: boolean;  // 示弱时刻
    readonly hasGrowthMoment: boolean;         // 成长时刻
    readonly complexityScore: number;
  };
  
  // 声音独特性
  readonly voiceUniqueness: {
    readonly distinctPatterns: string[];       // 独有语言模式
    readonly catchphrases: string[];           // 口头禅
    readonly speechVsNarration: number;        // 对话/叙述比
  };
  
  // 改进建议
  readonly suggestions: string[];
}
```

### 6.2 Observer 扩展：角色行为追踪

当前 Observer 提取 facts（事实性信息），但**不提取角色行为模式**。改造后，Observer 每章额外输出：

```typescript
interface CharacterBehaviorExtract {
  readonly character: string;
  readonly keyDecisions: Array<{
    readonly chapter: number;
    readonly decision: string;
    readonly motivation: string;          // 角色为什么这么做
    readonly alternativeNotChosen: string; // 角色没做什么（同样重要）
  }>;
  readonly emotionalRange: Array<{
    readonly emotion: string;
    readonly trigger: string;
    readonly expression: string;          // 如何表达这种情绪
    readonly authenticity: 1-10;          // 这种情绪表达对角色来说真实吗
  }>;
  readonly relationships: Array<{
    readonly target: string;
    readonly interactionType: "conflict" | "support" | "avoidance" | "intimacy";
    readonly change: string;              // 关系发生了什么变化
  }>;
}
```

### 6.3 Writer prompt 注入角色深度

```
🎭 角色深度检查（写完后逐条核对）:
  
  陈墨在本章中:
  [ ] 做了至少一个有内心矛盾的决定
  [ ] 展现了 vulnerability（示弱/犹豫/恐惧）
  [ ] 说话方式与之前章节一致（冷静短句，不用语气词）
  [ ] 行为让读者感到"意料之外，情理之中"
  [ ] 与其他角色的互动反映了当前关系状态（第 5 章破裂后仍未修复）
  
  ⚠️ 注意：本章如果让陈墨"突然变得勇敢"，
     需要铺垫他克服恐惧的心理过程——不要跳过 motivation。
```

---

## 七、新增：情感递进工程

### 7.1 当前问题

Writer 不知道 "上一章结尾读者是什么情绪"，因此每章的情绪起点都是"中性"。

### 7.2 跨章情感连接

```typescript
interface ChapterEmotionalBridge {
  // 上一章结尾时的读者情绪
  readonly readerStateAtChapterStart: {
    readonly dominantEmotion: string;
    readonly unresolvedFeelings: string[];  // "对反派的愤怒"、"对主角的担忧"
    readonly hangingQuestions: string[];     // "账本到底在哪？"
  };
  
  // 本章预期的读者情绪旅程
  readonly emotionalJourney: {
    readonly start: string;   // 承接上章结尾
    readonly mid: string;     // 本章中间点
    readonly end: string;     // 本章结尾（应为下一章留下钩子）
    readonly peak: {          // 本章情绪最高点
      readonly emotion: string;
      readonly scene: number;
      readonly intensity: 1-10;
    };
  };
  
  // 情绪对比设计
  readonly contrastArchitecture: {
    readonly previousChapterEnd: string;    // 上章结尾情绪: "震惊"
    readonly thisChapterStart: string;      // 本章开头情绪: "恐惧的余韵"
    readonly thisChapterEnd: string;        // 本章结尾情绪: "决心"
    readonly designRationale: string;       // "震惊后需要恐惧作为过渡，不能直接跳到决心"
  };
}
```

### 7.3 Writer 情绪感知 prompt

```
❤️ 情绪连接:
  上一章结尾读者感受: 震惊（账本不在工厂，是个陷阱）
  本章开头承接: 陈墨逃出工厂后的恐惧和愤怒
  
  本章情绪旅程:
    开头(恐惧未定) → 中段(愤怒→调查) → 高潮(发现新线索的紧张) → 结尾(决断的决心)
  
  情绪峰值: 场景 #5/7, 强度 9/10, "陈墨发现幕后黑手的真实身份"
  
  ⚠️ 注意：
    - 不要在前 2 段内让情绪降到"平静"（上章的冲击力还在）
    - 本章结尾情绪应该是"决心"而非"安心"（为下一章留钩子）
    - 情绪转换需要 trigger，不要让角色无缘无故情绪变化
```

---

## 八、新增：叙事节奏工程

### 8.1 三维节奏控制

```
节奏 = 事件密度 × 句式节奏 × 情感强度

事件密度: 每千字发生的重要事件数
  高潮场景: 3-4 事件/千字
  过渡场景: 1-2 事件/千字
  角色深度场景: 0.5-1 事件/千字 + 高内心活动

句式节奏: 平均句长
  紧张: 8-12 字/句（短促）
  叙事: 18-25 字/句（正常）
  描写: 25-35 字/句（舒缓）
  沉思: 15-20 字/句（流畅）

情感强度: 读者情绪唤起度 1-10
```

### 8.2 Pacing Blueprint 注入 Writer

```
⏱ 节奏控制本章:

  章节叙事职能: develop（推进主线）
  节奏曲线: 舒缓 → 紧张 → 紧张 → 紧张 → 释然
  
  段落级节奏指导:
    第 1-2 段(过渡): 句长 20-25, 承接上章结尾
    第 3-5 段(调查): 句长 15-20, 加快节奏
    第 6-8 段(对峙): 句长 8-12, 短促紧张
    第 9-10 段(发现): 句长 12-18, 新的线索揭示
    第 11 段(结尾): 句长 15-20, 情绪过渡到"决心"
  
  字数分配:
    第 1-2 段: 300 字 (10%)
    第 3-5 段: 600 字 (20%)
    第 6-8 段: 900 字 (30%)  ← 本章重点
    第 9-10 段: 600 字 (20%)
    第 11 段:  600 字 (20%)
```

---

## 九、新增：Story Value Evaluation（故事价值评估）

### 9.1 替代/补充当前的 Auditor

当前的 Auditor 检查的是"技术正确性"——连续性、Hook 健康、AI 痕迹、修辞问题。这些是**必要但不充分**的条件。

新增 **Story Value Evaluator**，在 Auditor 之后运行：

```typescript
interface StoryValueReport {
  readonly chapterNumber: number;
  
  // 叙事价值评分
  readonly narrativeValue: {
    readonly readerEngagement: number;       // 1-10 这章吸引人吗
    readonly emotionalImpact: number;         // 1-10 这章触动我吗
    readonly characterDepth: number;          // 1-10 角色有成长吗
    readonly plotProgression: number;         // 1-10 剧情推进了吗
    readonly thematicWeight: number;          // 1-10 主题深化了吗
    readonly overall: number;                 // 加权平均
  };
  
  // 亮点与弱点
  readonly highlights: string[];    // "第 3 段的反转令人意外"
  readonly weaknesses: string[];    // "第 7 段节奏拖沓"
  
  // 与之前章节的比较
  readonly trend: {
    readonly vsPreviousChapter: number;  // +/- 相比上一章进步/退步
    readonly runningAverage: number;      // 全书平均叙事价值
  };
  
  // 改进优先级
  readonly suggestedImprovements: Array<{
    readonly target: string;         // "第 5 段" / "角色对话" / "结尾"
    readonly reason: string;         // "拖累了整体节奏"
    readonly expectedImpact: number; // 修改后预期提升多少分
  }>;
}
```

### 9.2 触发机制

```
Writer → Observer → Reflector → Beta Reader → Story Value Evaluator → 判定:
  ├── overall >= 7 AND trend >= 0  → 通过 ✓
  ├── overall >= 7 AND trend < 0   → 警告（记录下降趋势）
  ├── overall 5-7                  → 针对性修订（Reviser+）
  ├── overall < 5                  → 重新规划（Planner）→ 重写（Writer）
  └── overall < 4 连续 3 章        → 触发 Narrative Director 重新评估故事方向
```

---

## 十、改造后管线全景

```
┌──────────────────────────────────────────────────────────────────┐
│                    Prompt Compiler（新增统一层）                    │
│  从"各 Agent 自行拼接上下文" → "统一编译、按需分配"                │
│  功能:                                                           │
│    1. 收集所有候选 PromptFragment（规则/知识/状态/意图）          │
│    2. 激活规则计算（关键词/语义/章节范围/伏笔到期/状态条件）       │
│    3. 冲突组裁决 + 按 hard→slot→priority 排序                   │
│    4. 各层 Token 预算分配 + 软内容压缩                           │
│    5. 输出 PromptManifest（含激活原因、预算、来源版本）           │
│  [每个 Agent 调用前执行, 不改变 Agent 核心逻辑]                    │
└──────────────────────────┬───────────────────────────────────────┘
                           │ 每个 Agent 获得不同的编译结果
          ┌────────────────┼────────────────┬──────────────────┐
          ▼                ▼                ▼                  ▼
  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
  │  Director    │ │  Planner     │ │  Writer      │ │ Continuity   │
  │  全书承诺    │ │  章节目标    │ │  场景计划    │ │  事实图谱    │
  │  卷弧       │ │  当前状态    │ │  POV 可知    │ │  迁移    │
  │  长期节奏    │ │  相关人物    │ │  角色声音    │ │  相关证据    │
  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                       Narrative Director                          │
│  (StoryIntent + 弧线规划 + 章节职能 + 情感蓝图 + 节奏蓝图)         │
│  [全书级: 创建时初始化, 每章后更新]                                │
└──────┬────────────────────────────────────────────────┬──────────┘
       │ 每章前: directorNote                             │ 每章后: updateArcs
       ▼                                                 │
┌──────────────────────────────────────────────────────┐ │
│                    Arc Planner                         │ │
│  (5 章前瞻: hook铺设≈回收、节奏曲线、主题演进)           │ │
│  [每 5 章运行一次]                                     │ │
└──────────────────────┬───────────────────────────────┘ │
                       │                                  │
┌──────────────────────▼───────────────────────────────┐ │
│         Narrative Planner (原 Planner++)               │ │
│                                                        │ │
│  1. loadStoryIntent() ← StoryIntent 层                │ │
│  2. getNarrativeDirectorNote() ← Director 层          │ │
│  3. designEmotionalBeats() ← 情感工程层                │ │
│  4. designScenes() ← 场景工艺层                        │ │
│  5. deriveStyleTarget() ← 风格进化层                   │ │
│  6. queryContinuityBible() ← 连续性预防层              │ │
│  7. planChapterMemo() ← 原有 memo 增强                │ │
│                                                        │ │
│  输出: EnhancedChapterIntent (+ 场景蓝图 + 情绪地图     │ │
│        + 节奏配置 + 风格目标 + 连续性约束)              │ │
└──────────────────────┬───────────────────────────────┘ │
                       │                                  │
┌──────────────────────▼───────────────────────────────┐ │
│         Scene Craft Engine (原 Composer++)             │ │
│                                                        │ │
│  输入: EnhancedChapterIntent                            │ │
│  处理:                                                  │ │
│    1. 解析 intent 为场景序列                            │ │
│    2. 每个场景: 分配字数 + 设定感官+情绪+节奏           │ │
│    3. 校验: scene/sequel 交替合理性                     │ │
│    4. 加载: 每个场景出场角色的 voice profile            │ │
│  输出: SceneBlueprint[]                                  │ │
└──────────────────────┬───────────────────────────────┘ │
                       │                                  │
┌──────────────────────▼───────────────────────────────┐ │
│         Scene-Aware Writer (原 Writer++)               │ │
│                                                        │ │
│  for each scene in SceneBlueprint[]:                    │ │
│    1. buildScenePrompt(场景蓝图 + 情绪上下文)           │ │
│    2. writeSingleScene()                                │ │
│    3. evaluateScene() → 如果 < 阈值则 rewriteScene()    │ │
│    4. 注入过渡句到下一场景                              │ │
│                                                        │ │
│  实时控制: 每段后检查累计字数, 动态调整剩余段落节奏      │ │
│  风格执行: 每场景后检查 style compliance                │ │
│  角色声音: 每段对话检查 voice consistency               │ │
└──────────────────────┬───────────────────────────────┘ │
                       │                                  │
                       ▼                                  │
     ┌─────────────────────────────────────┐             │
     │    Observer + Reflector (增强)       │             │
     │    + CharacterBehaviorExtract        │             │
     │    + EmotionalResponse               │             │
     └──────────────┬──────────────────────┘             │
                    ▼                                     │
     ┌─────────────────────────────────────┐             │
     │        Beta Reader                    │             │
     │  (模拟读者体验)                       │─────────────┘
     │  输出: engagement + emotionalResponse │  如果 < 阈值
     └──────────────┬──────────────────────┘   → 重写
                    ▼
     ┌─────────────────────────────────────┐
     │    Story Value Evaluator (新增)      │
     │  (叙事价值评分 + 趋势分析)           │
     │  输出: narrativeValue + improvements │
     └──────────────┬──────────────────────┘
                    ▼
     ┌─────────────────────────────────────┐
     │    PostWriteValidator++              │
     │    + Style Compliance Check          │
     │    + Genre Pact Fulfillment          │
     │    + Character Authenticity          │
     │    + Length Normalizer               │
     └──────────────┬──────────────────────┘
                    ▼
     ┌─────────────────────────────────────┐
     │    Auditor (33 维度)                 │
     └──────────────┬──────────────────────┘
                    ▼
     ┌─────────────────────────────────────────┐
     │ Issue Arbiter（新增：审校结果收敛器）     │
     │  合并重复问题                           │
     │  识别互相冲突的修改建议                  │
     │  hard/soft 分级 + 读者影响 + 成本排序    │
     │  输出最小修改集 + 人工裁决标记           │
     └──────────────┬──────────────────────────┘
                    ▼
     ┌─────────────────────────────────────┐
     │    Reviser (增强)                    │
     │    + 针对性修订（非全文）             │
     │    + BetaReader 低分修复             │
     │    + Style 偏差修复                  │
     │    + 叙事价值提升建议执行             │
     │    + Issue Arbiter 最小修改集执行     │
     └─────────────────────────────────────┘
```

---

## 十一、核心改变总结

### 11.1 Planner 的改变

| 维度 | 当前 | 改造后 |
|------|------|--------|
| **视野** | 单章 | 全书 + 5 章前瞻 |
| **意图** | 章节目标 | 故事意图 + 读者情感旅程 |
| **输出** | ChapterIntent + memo | + EmotionalBeatMap + SceneBlueprint + StyleTarget |
| **约束来源** | currentFocus + bookRules | + StoryIntent + GenrePact + ContinuityBible |
| **质量观** | "覆盖了所有 beats" | "读者会想读下一章" |

### 11.2 Writer 的改变

| 维度 | 当前 | 改造后 |
|------|------|--------|
| **生成方式** | 一次性生成全文 | 逐场景生成 + 场景间校验 |
| **场景意识** | 无 | 场景类型 + 目标 + 冲突 + 灾难 |
| **情绪感知** | 无 | 跨章情绪连接 + 段内情绪弧线 |
| **节奏控制** | 事后 Normalizer 调整 | 事前 blueprint + 实时监控 |
| **角色声音** | 不追踪 | 每场景加载 voice profile |
| **风格进化** | 全部一致 | 按叙事职能动态调整 |
| **感官注入** | 随机 | 按场景蓝图刻意设计 |
| **质量门禁** | 无（写完后 Auditor 检查） | 每场景自检 + Beta Reader + StoryValue |

### 11.3 质量评估的改变

| 维度 | 当前 (Auditor) | 改造后 (Story Value Evaluator) |
|------|----------------|-------------------------------|
| **检查什么** | 规则合规 | 读者体验 |
| **标准** | 客观可枚举 | 主观但可衡量 |
| **输出** | Issue 列表 | 叙事价值评分 + 趋势 + 建议 |
| **触发** | 每章必检 | 每章必检 + 低分触发重规划 |
| **反馈到** | Reviser（修订） | Reviser + Planner + Director（全链路） |

---

## 十二、工作量估算

> ⚠️ **客观说明**：以下估算是基于实际代码审计的修正版。核心发现：
> - 核心代码库 77K 行/335 文件，其中 PipelineRunner 3442 行/85 个方法——任何新组件的管线集成都有不可忽略的「接线」成本
> - 现有测试 33K 行/121 文件——新增组件必须配套测试，按本项目的测试密度约需 1.5× 开发时间
> - 部分"新增"组件已有重叠的基础设施（context-assembly、input-governance、continuity 等），但管线集成仍需修改 runner
> - 下方表格分为「纯新增」「需修改 Agent」「需集成成本」三列，诚实反映每项的实际影响

### 12.1 组件成本明细

| # | 组件 | 开发(d) | 测试(d) | 集成(d) | 类型 | 前置依赖 | 实际影响 |
|:-:|------|:-------:|:-------:|:-------:|:----:|:--------:|----------|
| 1 | **StoryIntent 模型 + 初始化** | 1 | 0.5 | 0.5 | 🆕 | 无 | 新增数据模型，不触发现有代码 |
| 2 | **Narrative Director** | 3 | 1.5 | 1 | 🆕 | 1 | 独立 Agent，需在 runner 中注册新阶段 |
| 3 | **Genre Pact 系统** | 2 | 1 | 0.5 | 🆕 | 1 | 数据模型 + 校验逻辑，独立可测试 |
| 4 | **Continuity Bible** | 1.5 | 1 | 0.5 | 🆕 | 无 | 扩展现有 continuity.ts（714行），非全新 |
| 5 | **Planner 改造（四层意图）** | 1.5 | 1 | 0.5 | 🔧 | 1,2,3,4 | 在 planChapter() 中插入新步骤，不修改现有流程 |
| 6 | **Emotional Beat Map** | 1.5 | 1 | 0.5 | 🆕 | 5 | 新数据模型 + prompt 模板 |
| 7 | **Scene Craft Engine** | 2 | 1.5 | 1 | 🆕 | 5 | 增强 composer.ts（430行），非重写 |
| 8 | **Character Voice Tracker** | 1.5 | 1 | 0.5 | 🆕 | 无 | 独立模块，但在 Writer prompt 中注入需要修改 writer-prompts.ts |
| 9 | **Character Authenticity 系统** | 1.5 | 1 | 0.5 | 🆕 | 8 | 独立评估模块，不触发生成逻辑 |
| 10 | **Writer 场景化改造** | 1.5 | 1 | 1 | 🔧 | 7,8 | **关键项**：不重写 writeChapter()，而是在其内部增加场景循环分支（现有一次性路径保留） |
| 11 | **跨章情绪连接** | 1 | 0.5 | 0.5 | 🆕 | 6,10 | 数据传递逻辑，无 LLM 调用 |
| 12 | **节奏 blueprint + 实时控制** | 1 | 0.5 | 0.5 | 🆕 | 10 | 后处理规则，纯文本操作 |
| 13 | **Beta Reader** | 2 | 1 | 1 | 🆕 | 无 | 新 Agent，需在 runner 注册 + 配置 qualityBudget |
| 14 | **Story Value Evaluator** | 1.5 | 1 | 0.5 | 🆕 | 13 | 在 Beta Reader 输出上做聚合分析 |
| 15 | **Observer 行为提取扩展** | 1 | 0.5 | 0.5 | 🔧 | 8 | 在现有 Observer 输出中增加字段 |
| 16 | **PostWriteValidator 增强** | 1 | 0.5 | 0.5 | 🔧 | 9,12 | 扩展现有 post-write-validator.ts（766行） |
| 17 | **Reviser 针对性修订改造** | 0.5 | 0.5 | 0.5 | 🔧 | 14 | 修改现有 reviser.ts（600行），增量 |
| 18 | **Prompt Compiler** | 3 | 2 | 1 | 🆕 | 无 | 新增统一编译层，不修改 Agent，但需要逐步替换现有 context-assembly |
| 19 | **Issue Arbiter** | 1.5 | 1 | 0.5 | 🆕 | 14,16 | 审校结果收敛器，纯逻辑无 LLM 调用 |
| 20 | **ModelBehaviorProfile** | 1 | 0.5 | 0.5 | 🆕 | 无 | 数据模型 + 离线基准测试脚本 |
| 21 | **五层记忆系统** | 2 | 1.5 | 1 | 🆕 | 4 | 扩展现有 memory-db，非新建 |

### 12.2 汇总与修正

| 维度 | 原估算 | 修正后 | 差异原因 |
|:-----|:------:|:------:|----------|
| 开发工作量 | 33-35d | 33.5d | 基本一致，但重新分配了测试和集成时间 |
| **其中测试** | 未计入 | 19d | **原估算完全遗漏了测试成本**——本项目 121 测试文件/33K 行，新增组件必须配套 |
| **其中集成** | 未计入 | 12.5d | **原估算完全遗漏了管线集成成本**——Runner 3442 行，每个新阶段都需接入 |
| **实际总人日** | 33-35d | **~65d** | 约 2 倍差距，主要来自测试 (19d) + 集成 (12.5d) |
| 可并行度 | 未讨论 | 部分可并行 | 1-4-8-13-18-20 无依赖，可同步开发；5-6-7-10 必须串行 |
| 现有可复用 | 未讨论 | 约节省 5d | context-assembly、continuity、post-write-validator 已有部分能力，非从零开始 |

### 12.3 被低估的三个隐藏成本

**1. 测试成本（原估算：0d，实际：~19d）**

本项目的测试密度较高（121 测试文件，33K 行）。新增组件涉及：
- 新 Agent → 需要 mock LLM 调用的测试（如 planner.test.ts 1299 行、writer.test.ts 1299 行）
- 新数据模型 → schema 校验测试
- 管线集成 → runner.test.ts 4789 行，集成测试复杂度极高

如果缩减测试覆盖（只做核心路径 + schema 校验），可压缩到 ~12d，但风险上升。

**2. PipelineRunner 集成成本（原估算：0d，实际：~12.5d）**

文档假设新增组件是"独立添加的模块"，但实际上每个新组件都要：
- 在 runner.ts 的 3442 行/85 方法中找到合适的接入点
- 处理与现有阶段的顺序依赖（Composer → Writer → Observer → ...）
- 处理错误恢复和重试逻辑（runner 中有复杂的重试机制）
- 处理现有测试的回归（runner.test.ts 4789 行）

即使 Prompt Compiler 本身是新增模块不修改 Agent，它在 runner 中的接入仍然需要修改 runner.ts。

**3. 现有 Agent 的"非修改"成本（原估算被低估）**

文档说"Character Voice Tracker 不修改 Writer 核心"，但：
- Writer 的 `renderWriterUserMessage()` 需要增加 voice profile 的装配
- Writer prompt 模板（writer-prompts.ts 651 行）需要增加 voice 段落
- 这些不是"核心逻辑修改"，但仍然是现有代码的修改

诚实地说，约 5-6d 的所谓"纯新增"组件实际需要修改现有 Agent 的 prompt 装配逻辑。

### 12.4 如果只做新增、不做 Agent 修改的最低成本路径

| 范围 | 工作量 | 说明 |
|------|:------:|------|
| Prompt Compiler | 6d | 新增统一编译层，逐步替换现有 context-assembly |
| Genre Pact（纯校验） | 3.5d | 只做规则校验，不注入 Writer prompt |
| Beta Reader | 4d | 新 Agent，后续独立关闭不影响管线 |
| ModelBehaviorProfile | 2d | 数据模型 + 基线脚本 |
| Issue Arbiter | 3d | 审校收敛器 |
| 五层记忆（基础） | 4.5d | 扩展现有 memory-db |
| **合计** | **~23d** | 不修改 planner.ts/writer.ts/continuity.ts 的核心逻辑 |
| 其中测试 | ~8d | |
| 其中集成 | ~4d | |

---

## 十三、各模块成本分析与执行建议

> 本节对报告中涉及的所有模块进行成本/风险评级，给出详细执行建议和可扩展方向。
> 评级标准：成本 = 开发+测试+集成人日；风险 = 对现有架构的侵入程度 + LLM 依赖度。

### 13.1 高成本高风险模块（建议审慎推进）

#### ① Prompt Compiler（#18）

| 维度 | 评估 |
|------|------|
| **成本** | ⭐⭐⭐ 6d（最高单项） |
| **风险** | ⭐⭐⭐⭐ 涉及上下文装配机制的全面替换，影响所有 Agent |
| **核心价值** | 解决"各 Agent 自行拼接上下文"导致的 Token 浪费和指令稀释 |

**执行建议（分三步走）：**

```
Step 1（1d）: 定义 PromptFragment / PromptManifest 接口，
              与现有 context-assembly.ts 中的 buildGovernedRuleStack 并列存在
              → 不修改任何现有 Agent，纯新增数据模型

Step 2（2d）: 在 composer.ts 中创建新的编译路径，
              与现有 composeGovernedChapter 并行运行（开关控制）
              → 现有路径保持不变，新路径逐步验证

Step 3（3d）: 验证通过后，逐步将各 Agent 迁移到新路径，
              每次迁移一个 Agent，观察 2-3 章产出后再迁移下一个
              → 避免一次性切换导致的问题无法定位
```

**可扩展方向：**
- 上下文可视化调试面板（Prompt Inspector）：实时查看每个 Agent 最终收到的 prompt 结构
- A/B 测试框架：对比"旧拼接方式"和"新编译方式"下同一章节的产出质量
- 多模型适配：不同模型对 prompt 结构敏感度不同，Compiler 可为不同模型生成不同布局

---

#### ② Writer 场景化改造（#10）

| 维度 | 评估 |
|------|------|
| **成本** | ⭐⭐ 3.5d（非最高，但风险极大） |
| **风险** | ⭐⭐⭐⭐⭐ 修改 Writer 核心生成循环，1297 行中最关键的逻辑 |
| **核心价值** | 从"一次性生成全文"变为"逐场景生成"，是品质提升的关键杠杆 |

**执行建议（保守推进）：**

```
前提条件: Phase 0.5 实验 2（Scene Blueprint 注入验证）必须通过。
          如果 LLM 连"按 blueprint 一次性生成"都做不到，
          场景循环拆分就是浪费成本。

Step 1（0.5d）: 在 writeChapter() 中增加场景循环分支
                ─ 保留现有一次性生成路径作为 fallback
                ─ 新路径通过配置开关启用（默认关闭）
                ─ 不修改现有代码结构，只在 writeChapter 方法内增加 if/else

Step 2（1d）: 实现 writeSingleScene() 方法
              ─ 复用现有 buildWriterSystemPrompt 的大部分逻辑
              ─ 增加 SceneBlueprint 相关的 prompt 段落
              ─ 场景间续写锚点（ContinuationAnchor）保证拼接连贯性

Step 3（2d）: 集成 + 测试
              ─ 重点测试：场景数量变化（2-8 场景）、截断续写、情绪连贯性
              ─ 回归测试：确保一次性路径完全不受影响
```

**可扩展方向：**
- 场景并行生成：无依赖的场景可并行调用（需要 Provider 支持并发）
- 场景温度差异化：高潮场景用低温度（更精确），日常场景用高温度（更创意）
- 场景后校验：evaluateScene 可以扩展为场景级 LLM 评估，但成本较高

---

### 13.2 中等成本中等风险模块（建议按序推进）

#### ③ Narrative Director（#2）

| 维度 | 评估 |
|------|------|
| **成本** | ⭐⭐⭐ 5.5d |
| **风险** | ⭐⭐⭐ 新 Agent 需要 runner 注册，但逻辑独立 |
| **核心价值** | 将 StoryIntent 翻译为章节级叙事指导，是"全书意识"的核心 |

**执行建议：**
```
1. 先实现 StoryIntent 数据模型和持久化（#1，1d）
2. 再实现 Narrative Director 的 DirectorNote 接口和 LLM prompt（2d）
3. 最后集成到 Planner 的 planChapterMemo 中（1.5d）
4. Narrative Director 的 LLM prompt 必须包含明确的输出结构（JSON Schema），
   避免 LLM 输出不符合 DirectorNote 接口
```

**可扩展方向：**
- 多弧线追踪：同时追踪多条角色弧线和技术弧线
- 自动弧线检测：当 LLM 产出偏离 StoryIntent 时，自动建议调整 StoryIntent
- 弧线健康度面板：可视化显示每条弧线的完成进度和剩余章节预算

---

#### ④ Scene Craft Engine（#7）

| 维度 | 评估 |
|------|------|
| **成本** | ⭐⭐⭐ 4.5d |
| **风险** | ⭐⭐⭐ 增强 composer.ts（430行），非重写但逻辑复杂 |
| **核心价值** | 将 Planner 的意图解析为可执行的场景序列，是 Writer 场景循环的前提 |

**执行建议：**
```
1. Scene Craft Engine 不新增 Agent，而是在 composer.ts 中增强场景解析逻辑
2. 输入：EnhancedChapterIntent → 输出：SceneBlueprint[]
3. 解析逻辑应当是确定性的（规则+数学），不要依赖 LLM 来判断"一个场景应该多少字"
4. 字数分配基于全书节奏曲线计算，而非每章独立分配
```

**可扩展方向：**
- 场景类型化：Scene/Sequel 交替模式（主动场景/被动场景）
- 场景强度曲线：根据全书节奏自动计算每个场景的 tension 值
- 场景冲突检测：检测连续 N 个同类型场景导致节奏单一

---

#### ⑤ 五层记忆系统（#21）

| 维度 | 评估 |
|------|------|
| **成本** | ⭐⭐⭐ 4.5d |
| **风险** | ⭐⭐ 扩展现有 memory-db，不修改 Agent |
| **核心价值** | 解决长文创作中的"近因偏差"和"关键事实遗忘" |

**执行建议：**
```
1. T0（不可变规则）和 T1（当前状态）可以直接复用现有 memory-db 的能力
2. T2（活跃叙事）需要新增"弧线状态追踪"表和"伏笔到期提醒"机制
3. T3（层级摘要）需要增量式摘要聚合，每次新章节加入后只更新受影响的摘要节点
4. T4（原始档案）不需要新存储，指向现有 chapter 文件路径即可
5. 各 Agent 的检索策略：Director 需要 T0+T2，Planner 需要 T1+T3，Writer 需要 T1+T2
```

**可扩展方向：**
- 混合检索评分（lexical + semantic + recency + hookDue），见十五的工程手段
- 摘要置信度标：标注"AI 推断"和"原文证据"，区分确定性事实和推理性总结
- 跨书记忆共享：同一世界观下的多本书可以共享角色状态（系列作品）

---

### 13.3 低成本低风险模块（建议优先实施）

#### ⑥ Genre Pact 基础版（#3）

| 维度 | 评估 |
|------|------|
| **成本** | ⭐ 3.5d |
| **风险** | ⭐ 纯数据模型 + 校验逻辑，独立可测试 |
| **核心价值** | 确保产出不偏离题材核心期待 |

**执行建议：**
```
1. 先将 GenrePact 定义为 JSON 配置文件，每种题材一个文件
2. 在 PostWriteValidator 中增加 Genre Pact 校验（纯规则，零 LLM 成本）
3. 验证通过后，再考虑注入 Writer prompt（这一步有成本，但非必须）
4. 建议优先实现 3-4 个主要题材（玄幻、都市、悬疑、言情），其余后续扩展
```

**可扩展方向：**
- 用户自定义 Genre Pact：高级用户可编辑 JSON 文件来定制题材契约
- Genre Pact 冲突检测：跨题材作品（如玄幻言情）需要合并多个契约
- 社区共享 Pact 库

---

#### ⑦ Beta Reader（#13）

| 维度 | 评估 |
|------|------|
| **成本** | ⭐⭐⭐ 4d（主要成本在 LLM 调用和结果可靠性验证） |
| **风险** | ⭐⭐⭐ LLM 评分可靠性存疑，但组件独立可随时关闭 |
| **核心价值** | 提供量化反馈，替代"我觉得还行"的主观判断 |

**执行建议：**
```
1. Beta Reader 必须绑定 Experiment 3（LLM vs 人类评分相关性验证）的通过标准
2. 初始实现只输出 engagement (1-10) 和 emotionalResponse 两个维度
3. 评分结果写入 memory-db，方便后续趋势分析
4. 不要将 Beta Reader 评分作为管线门禁（不可靠），只作为作者参考
5. 通过 qualityBudget 配置控制调用频率（economy = 仅高潮章，normal = 每章）
```

**可扩展方向：**
- 多读者人格轮换：随机切换"网文老白/悬疑爱好者/言情读者/挑剔编辑"人格
- 评分趋势仪表盘：按章节显示评分趋势，发现质量下降拐点
- 局部评分：不评分整章，只评分关键段落（开篇/高潮/结尾）

---

#### ⑧ Story Value Evaluator（#14）

| 维度 | 评估 |
|------|------|
| **成本** | ⭐⭐ 3d |
| **风险** | ⭐⭐ 依赖 Beta Reader 输出，聚合分析逻辑独立 |
| **核心价值** | 将单章评分转化为叙事趋势，识别系统性质量问题 |

**执行建议：**
```
1. 不新增 LLM 调用，只在 Beta Reader 的输出基础上做聚合统计
2. 滑动窗口统计（最近 5 章均值 + 趋势斜率）
3. 输出简化为三档：good / attention_needed / critical
4. critical 状态触发告警，但不自动干预——让作者决定是否重写
```

**可扩展方向：**
- 多维评分加权：根据题材调整各维度的权重（悬疑看重 plotProgression，言情看重 characterDepth）
- 预期评分与实际评分对比：Planner 预估"本章预期评分" vs Beta Reader 实际评分，偏差大说明意图执行有问题

---

#### ⑨ 其余低成本模块

| # | 模块 | 成本 | 建议优先级 | 理由 |
|:-:|------|:---:|:---------:|------|
| 15 | Observer 扩展 | 2d | 高 | 利用现有 Observer 输出结构，扩展字段即可，不涉及 LLM |
| 16 | PostWriteValidator 增强 | 2d | 高 | 纯规则检查，零 LLM 成本，立即生效 |
| 17 | Reviser 改造 | 1.5d | 中 | 依赖 Story Value Evaluator 就绪 |
| 19 | Issue Arbiter | 3d | 中 | 仅当多个审校器同时启用时才有意义 |
| 20 | ModelBehaviorProfile | 2d | 低 | 数据模型简单，但需要离线基准测试支撑 |
| 4 | Continuity Bible | 3d | 低 | 扩展现有 continuity.ts，当前连续性审计已相对完善 |
| 11 | 跨章情绪连接 | 2d | 低 | 依赖 Writer 场景化改造完成 |
| 12 | 节奏实时控制 | 2d | 低 | 依赖场景化改造完成 |

---

## 十四、平衡机制

> 任何写作质量改造方案在实施中都面临三层不可消除的张力——不是"解决"它们，而是"管理"它们。
> 本节详细阐述这些固有矛盾及对应的平衡机制。

### 14.1 三层固有矛盾

```
写作价值改造方案在实施中面临三层不可消除的张力，
不是"解决"它们，而是"管理"它们。

第一层: 控制 vs 惊喜
  叙事蓝图越精细 → 产出越可控 → 但越 predictable → 读者越觉得"套路"
  叙事蓝图越宽松 → 产出越惊喜 → 但越 risky → 连续性/节奏越难保证

第二层: 审计成本 vs 质量收益
  Beta Reader      → +1 LLM call/章
  Story Evaluator  → +1 LLM call/章  
  Scene Self-Check → +0.5 LLM call/章
  Character Auth   → +0.5 LLM call/章
  合计: +3 LLM calls/章
  300 章小说 = 900 次额外调用 ≈ $15-30 成本
  问题: 读者是否能感知到这 $15 带来的质量提升？

第三层: 评估标准的主观性
  用 LLM 评估 LLM 的产出是否"动人"
  → 存在"自我认可偏差"风险
  → 一个模型觉得自己写得很好，另一个模型读完后也觉得很好
  → 但真实人类读者可能不这么认为
```

### 14.2 平衡机制一：蓝图即约束，而非指令

所有写入 Writer prompt 的蓝图字段必须遵循"**约束原则**"：

```
✅ 好的约束: "本章结尾的情绪应该是'决心'而非'安心'"
   （给了方向，留了创作自由）

❌ 坏的指令: "第 3 段句长必须是 8-12 字"
   （精确到段落，扼杀创造力）

判断标准：删掉这个字段后，LLM 是否会产出显著更差的文本？
  如果"是" → 这是约束，保留
  如果"不确定" → 这是噪音，删除
```

**落地规则**：
- SceneBlueprint 进入 Writer prompt 时，只保留 `goal`、`conflict`、`disaster`、`emotionArc`、`forbiddenMoves`、`sensoryHighlights`
- **不**传入 `expectedWordCount`（改为内部累计）
- **不**传入 `pacingProfile.segmentLevel`（段落级节奏是写入后的校验目标，不是写入时的约束）
- `sensoryHighlights` 只给关键词，不给"写一段 200 字的感官描写"

### 14.3 平衡机制二：评估组件节流（Throttle）

所有新增的 LLM 评估调用都必须具备"**质量-成本滑条**"：

```typescript
// 在 book.json 或 inkos.json 中可配置
interface QualityBudget {
  readonly evaluationDensity: "economy" | "normal" | "premium";
  // economy:   仅首章 + 高潮章 + 每 10 章抽样 → +0.3 LLM calls/章
  // normal:    每章运行 Beta Reader, 抽样 Story Value → +1.5 LLM calls/章  
  // premium:   每章全部评估 → +3 LLM calls/章

  readonly sceneSelfCheck: boolean;
  // false: 不校验场景质量（省 0.5 calls/章）
  // true:  每场景后校验

  readonly readerPersonaRotation: boolean;
  // false: 固定使用"普通读者"人格
  // true:  随机切换"网文老白/悬疑爱好者/言情读者/挑剔编辑"
  //        不同人格评分差异 > 3 分 → 标记"需人工判断"
}
```

**默认值**：`normal`。新用户使用 `economy`，付费/重度用户使用 `premium`。

### 14.4 平衡机制三：反馈回路优先于前馈控制

在投入 10 人日做"事前蓝图设计"之前，先用 0.5 人日做"事后效果评估"：

```
当前方案: 事前Blueprint → Writer → 事后评估
           ^^^^^^^^^^^^^^^    ^^^^^^    ^^^^^^^^
           10人日              原有       3人日

推荐:      Writer(当前) → Beta Reader → 反馈给 Director
            ^^^^^^         ^^^^^^^^^^^   ^^^^^^^^^^^^^^^^^
            原有            1.5人日       仅在需要时

理由: 事前控制是猜测"什么能让读者喜欢"
      事后反馈是测量"读者是否真的喜欢"
      没有后者之前，前者的效率无法验证
```

---

## 十五、工程化突破 LLM 能力限制

> 本节聚焦"在当前模型能力上限内，通过工程手段提升输出质量与效率"。
> 原则：不依赖模型自身进化，不改变 Agent 核心逻辑，不增加不必要的 LLM 调用。

### 15.1 上下文窗口限制

**问题**：各 Agent 独立拼接上下文，文件越多固定成本越高，无关内容稀释关键指令。

**工程对策**：

| 手段 | 实现方式 | 影响 |
|------|----------|------|
| **Prompt Compiler 动态预算** | 各 Agent 按角色分配 Token 上限，hard rule 禁止压缩，soft 信息按优先级淘汰 | 避免单 Agent 吞噬全部窗口 |
| **按任务检索，不共享全量** | Director/Planner/Writer/Continuity 各自获取不同的上下文清单 | 见 九 管线全景 |
| **五层记忆** | T0 不可变规则 → T1 当前状态 → T2 活跃叙事 → T3 层级摘要 → T4 原始档案，优先分配 T0/T1 | 降低基础上下文膨胀 |
| **先实体过滤，再向量召回** | 先按角色/地点/物品名称过滤候选，再对候选做语义相似度检索 | 减少无关向量干扰 |
| **软信息可压缩，硬规则禁止** | Compressible flag 标记可摘要的信息，hard=true 的规则原样保留 | 关键约束不被意外丢弃 |
| **保留 Token 安全余量** | 每 Agent 保留 10% 窗口作为输出空间，超出时触发上层摘要替换 | 防止截断导致格式损坏 |

**代码改动量**：Prompt Compiler 为新增模块，不修改现有 Agent 代码。

### 15.2 长输出截断

**问题**：一次性生成 3000+ 字时，模型可能在中间丢失上下文，或在达到输出上限时截断。

**工程对策**：

```typescript
// 续写锚点——Writer 在每次调用之间保存状态
interface ContinuationAnchor {
  readonly lastCompleteParagraph: string;    // 最后完整段落
  readonly unfinishedAction?: string;         // 未完成的动作
  readonly activeSpeakers: string[];          // 仍在对话中的角色
  readonly currentLocation: string;           // 当前场景地点
  readonly unresolvedBeatIds: string[];       // 尚未覆盖的 beats
  readonly forbiddenRepeats: string[];        // 最近已写过的内容（避免重复）
}
```

**落地规则**：
- 场景级生成（非全文一次性生成）天然降低单次输出长度
- 截断后从 `lastCompleteParagraph` 续写，而非从断句处
- 拼接时做重叠检测（最后 50 字与下一段开头 50 字比较）、重复结尾检测、标点完整性检查
- 不额外引入 LLM 调用，纯文本规则判断

### 15.3 指令遵循不稳定

**问题**：LLM 可能忽略深层 prompt 中的约束，或在复杂指令中选择性执行。

**工程对策**：

| 手段 | 实现方式 | 适用场景 |
|------|----------|----------|
| **JSON Schema 输出** | 规划/状态输出限定为结构化格式，不支持 Schema 的模型做后校验+修复 | Planner intent, Observer extract |
| **硬规则控制在 7±2 条** | 每个 Agent 的 hard rule 不超过 9 条，在 prompt 中靠近任务位置重申 | 所有 Agent |
| **正例 + 反例替代抽象禁令** | "像这样写（示例）" + "不要像这样写（反例）" 替代"请写得生动" | Character Voice, Style 场景 |
| **结构化输出优先** | 支持 structured output / constrained decoding 的模型优先用于 Schema 密集任务 | 规划/审计类任务 |
| **生成后机器校验 + 最小修复** | 正则/Schema 规则校验输出，仅修复违规部分，不重新生成全文 | 格式/命名/字数类约束 |
| **按模型维护 Prompt Adapter** | 为不同模型调整 prompt 格式（system/developer/user 角色、示例位置、强调方式） | 多模型场景 |

**代码改动量**：JSON Schema 输出已在部分 Agent 中实现（如 ChapterIntent），扩展即可。正例/反例可在现有 prompt 模板中增量添加。

### 15.4 单次生成质量上限

**问题**：单次 LLM 调用存在质量天花板，增加 prompt 长度不一定带来更好输出。

**工程对策**：

```
策略一：差异候选（新增，选择性启用）
  不生成两个近似随机样本，先生成两个差异明确的方案（如"发展 A 线"vs"发展 B 线"）
  评估器只做比较和定位，不直接重写
  仅在已启用 Beta Reader 且 qualityBudget ≥ normal 时启用

策略二：局部重写
  评估器定位低分段落 → Reviser 只重写该段落
  避免"全章重写导致原本好的部分也变了"
  不额外引入 LLM 调用（Reviser 已有此能力）

策略三：模型能力路由
  强模型（高推理能力）用于：架构设计、候选裁决、关键修订
  低成本模型用于：检索重排、格式校验、基础审校
  不改变现有 Agent 数量，仅在 Provider 调用时按任务选择模型
```

**落地方式**：上述策略均为"条件性启用"，默认关闭。用户通过 `qualityBudget` 配置控制（见 十八）。

### 15.5 模型差异与路由

当前模型卡只记录接口能力（上下文窗口、输出上限、图像/工具支持）。扩展为：

```typescript
// 新增：模型创作行为档案
interface ModelBehaviorProfile {
  readonly modelId: string;

  // 中文长文质量（项目实测，非厂商指标）
  readonly proseQuality: {
    readonly chineseLongform: 1-10;     // 中文长篇叙事质量
    readonly instructionFollowing: 1-10; // 指令遵循稳定性
    readonly jsonReliability: 1-10;     // JSON/Schema 输出可靠性
  };

  // 专有能力
  readonly strengths: string[];          // "角色声音保持", "悬念设计"
  readonly weaknesses: string[];         // "容易忘细节", "结尾仓促"

  // 工程指标
  readonly latencyPerToken: number;      // ms/token
  readonly pricePer1KTokens: number;     // $/1K tokens
  readonly maxConcurrency: number;
  readonly knownRefusals: string[];      // 已知拒答模式

  // 版本化成绩
  readonly benchmarkResults: Array<{
    readonly benchmarkId: string;
    readonly score: number;
    readonly date: string;
  }>;
}
```

**落地规则**：
- ModelBehaviorProfile 只记录，不自动选择。路由决策由 Pipeline Manifest 中的 `modelPolicy` 显式声明
- 不增加运行时开销，数据来自离线基准测试
- 默认路由保持当前逻辑（使用配置中的模型），仅当用户显式启用多模型路由时生效

### 15.6 外部资料提示注入防护

**问题**：世界设定、网页资料、用户上传文件中可能包含伪造的 system/developer 指令。

**工程对策**：

```
1. 外部资料包裹为引用数据（不可信内容标记）
2. 资料内容不允许改变系统角色或工具权限
3. 过滤伪造的 system/developer 指令（正则检测）
4. Lore 递归激活设置深度上限（默认 3 层）和 Token 上限（默认 500）
5. 外部内容只能提供事实证据，不能覆盖 hard rule
6. Trace 中显示资料导致的激活链（便于审查）
```

**代码改动量**：在 `context-transform.ts` 的整库注入处增加包裹逻辑，已有规则分层（hard/soft/diagnostic）可直接复用。

---

## 十六、实施策略：三段式务实路线

> 以下 Phase 结构建立在 十五 的工程约束之上。每个 Phase 的推进受 Prompt Compiler、分层记忆、模型路由等基础设施的成熟度制约，而非仅按功能清单线性推进。

### Phase 0：建立基线——先知道"现在写得怎么样"

**工作量**：2-3d | **前置条件**：无

**核心动作一：人工阅读评估**

```
1. 用当前管线生成 5 章（覆盖 3 个题材：玄幻、都市、悬疑）
2. 找 3-5 人（含自己）真实阅读
3. 回答 3 个问题：
   a. 你会想读第 6 章吗？（是/否 + 原因）
   b. 哪一段最无聊？（标注段落）
   c. 哪个角色让你觉得"不像真人"？（具体原因）
```

**核心动作二：建立评估工具**

```diff
+ packages/core/src/evaluation/human-reader-feedback.ts
+   interface HumanReaderFeedback {
+     readonly engagement: boolean;        // 想读下一章?
+     readonly boredSegments: string[];    // 无聊段落
+     readonly characterIssues: string[];  // 角色问题
+     readonly overallScore: 1-10;
+   }

+ scripts/evaluate-chapter.mjs
+   读取一章 → 输出格式化文本 → 人工评分 → 记录基线
```

**交付物**：
- 当前产出的**质量基线报告**（5 章 × 3 题材）
- 三个问题的量化答案
- 决定 Phase 1 的优先级

---

### Phase 0.5：Prompt 级假设验证（核心实验）

**工作量**：3-5d | **前置条件**：Phase 0 完成 | **原则**：不改代码，只改 prompt

在投入任何架构改造之前，先用 prompt 实验验证最关键的假设——**LLM 是否能按叙事意图产出更好内容**。以下四个实验按"验证链"排列：先验证"LLM 能理解意图"，再验证"LLM 能按蓝图施工"，再验证"LLM 能自我评估"，最后验证"成本可接受"。任何一环失败则暂停对应方向的投入。

---

#### 实验 1：Emotional Beat Map 注入验证（1d）

**目标**：验证"给 Writer 明确的情绪蓝图"是否能提升章节质量。

**方法**：
1. 选取 3-5 个已有章节（不同情绪类型：紧张、悲伤、悬疑、高潮）。
2. 不改代码，手工为每章写一个 Emotional Beat Map：
   ```
   开头情绪: 压抑（主角刚失去线索）
   中段情绪: 焦虑（发现反派已靠近）→ 愤怒（发现被欺骗）
   结尾情绪: 决心（决定直面反派，而非逃避）
   情绪峰值: 55% 处（发现被欺骗的真相揭露时刻）
   ```
3. 用这个 map 增强现有 Writer prompt，重写生成新版章节。
4. 盲测：2-3 位人类读者对原版和新版打分（1-10），统计"更想读下一章"的比例。
5. 同时记录 token 消耗。

**通过标准**：新版平均分提升 ≥ 1 分，且 token 成本增加 ≤ 50%。

---

#### 实验 2：Scene Blueprint 注入验证（1.5d）

**目标**：验证 LLM 能否按场景蓝图写出结构更合理的章节。

**方法**：
1. 选取 2 章，手工设计 Scene Blueprint（场景类型、字数、目标情绪）。
2. 让现有 Writer 按 blueprint **一次性生成全文**（不拆分多次调用）。
3. 检查：
   - 章节结构是否符合 blueprint？（场景顺序、字数比例）
   - 场景之间过渡是否自然？
   - Auditor 通过率是否变化？
   - 对比无 blueprint 的版本，是否更结构化？

**通过标准**：≥ 80% 的场景按要求完成，Auditor 通过率不下降。

> 如果成功 → 说明 LLM 能按蓝图施工，后续场景循环拆分是可行的。
> 如果失败 → 说明 LLM 无法理解结构化蓝图，需要换方向（如只给情绪目标不给场景序列）。

---

#### 实验 3：LLM 作为 Beta Reader 的可靠性验证（1.5d）

**目标**：验证 LLM 评分是否与人类评分一致。这是 **"LLM 评估 LLM"范式是否成立**的关键实验。

**方法**：
1. 准备 10 个章节，覆盖不同质量层次（好/中/差）。
2. 让 LLM 按 `StoryValueReport` 维度评分（engagement、emotionalImpact、characterAuthenticity 等）。
3. 同时让 3 位人类盲评同样的章节。
4. 计算 LLM 与人类评分的相关性（Pearson / Spearman 相关系数）。

**通过标准**：相关系数 ≥ 0.7，且 LLM 能稳定区分"好"与"差"章节。

> 如果相关系数低 → Story Value Evaluator 无法作为质量门禁，需要先解决评分标准校准问题。
> 如果相关系数高 → LLM 可以用作低成本快速评估，但仍需抽检校准。

---

#### 实验 4：成本估算实验（1d）

**目标**：测算场景化生成的真实成本，避免"方向对了但用不起"。

**方法**：
1. 选取 1 章，模拟场景化流程（在 prompt 中要求按场景写，但仍是 1 次调用）：
   - 记录输入 token（含 blueprint、voice profile 等新增内容）
   - 记录输出 token（4-8 个场景的完整章节）
   - 对比现有无增强 prompt 的 token 消耗
2. 模拟全量场景化流程（纯估算，不实际拆分）：
   - Planner 生成 Scene Blueprint（已有）
   - 每场景调用 1 次 Writer（5-8 场景）
   - 每场景调用 1 次 evaluateScene
   - 调用 Beta Reader + Story Value Evaluator
   - 汇总总 token 和耗时

**通过标准**：总成本增加 ≤ 3 倍，单章耗时 ≤ 10 分钟。如果成本增加 > 5 倍，需要先优化 token 策略再继续。

---

### Phase 1：最小可行改进（MVP）

**工作量**：5-7d | **前置条件**：Phase 0 完成

根据 Phase 0 的反馈，从 17 个组件中选择 **3 个最高 ROI 的组件**实施。以下为预测选择：

| 组件 | 解决的问题 | 工作量 | 不改动 | 预期效果 |
|------|-----------|:------:|--------|----------|
| **Character Voice Tracker** | 角色说话千篇一律 | 2d | Planner/Writer 核心逻辑 | 最有感知度的提升 |
| **Beta Reader（轻量版）** | 不知道写得好不好 | 1.5d | 不介入 Writer | 给所有后续改进提供量化依据 |
| **Genre Pact 基础版** | 题材基调跑偏 | 1.5d | 不介入 Writer | 确保基础方向正确 |

**为什么这三个？**
- 它们都是在当前管线基础上**做加法**，不是做重构
- 不改造 Planner、不改造 Writer 的核心生成逻辑
- 每个组件独立可测试，不互相阻塞

**架构改动最小化原则**：

```diff
- 改造 Planner: loadStoryIntent() → getDirectorNote() → designEmotions() → ...
+ 不改造 Planner
+ 在 Writer 调用前的上下文装配阶段插入 Character Voice Profile
+ 在 Auditor 之后插入 Beta Reader
+ 在 Beta Reader 之后插入条件性的 Genre Pact 校验
```

---

### Phase 2：场景工艺改造

**工作量**：8-10d | **前置条件**：Phase 1 完成 + Beta Reader 数据表明"场景结构需要改进"

如果 Phase 1 的 Beta Reader 数据显示"场景平铺直叙"是核心问题，则启动此阶段。

```
仅在前置条件满足时启动:
  1. Scene Craft Engine（3d）—— Composer 增强
  2. Emotional Beat Map（2d）
  3. Writer 场景级拆分（3d）
  4. 跨章情绪连接（1.5d）
```

**否决条件**：
- 如果 Beta Reader 数据显示"角色问题是首要矛盾"，则优先 Phase 3
- 如果数据显示"读者投入度已经 > 7/10"，则暂缓本阶段

---

### Phase 3：角色与声音深度

**工作量**：4-5d | **前置条件**：Phase 1 完成 + Beta Reader 数据表明>需要

```
1. Character Authenticity 系统（2d）
2. Observer 行为提取扩展（1d）
3. Writer 角色声音深度注入（1d）
4. Style Evolution Engine 基础版（2d）
```

---

### Phase 4：叙事架构改造

**工作量**：5-7d | **前置条件**：Phase 0-3 全部完成 + CLI 测试全绿

这是最大的架构改造，必须在所有前置条件满足后才能启动：

```
1. StoryIntent 模型 + Narrative Director（4d）
2. Arc Planner（3d）
3. Planner 四层意图改造（3d）
4. Story Value Evaluator + Reviser 针对性修订（2d）
```

**启动门禁**：
```
□ Phase 0 完成: 有人工阅读基线数据
□ Phase 1 完成: Character Voice + Beta Reader + Genre Pact 已上线
□ Phase 2/3 按需完成
□ CLI 测试 171/171 全绿
□ 至少有一位真人用户确认"最近 10 章的产出稳定可接受"
```

---

## 十七、ProactiveEngine 主动提问引擎——P0 实施方案

> 本节是**文档 三 中"写作前深度访谈"的配套实现方案**，定位为 Phase 0 之前的 P0（先行验证）。
> 核心目标：在不动现有 Agent 管线的前提下，让系统在 `write next` 之前主动检测作者未回答的关键问题，并在 CLI/Studio 中暂停询问。
>
> **预估工时：3d**（框架 1d + 检测器 1d + CLI/Studio 集成 1d）
> **文件变更：6 新建 + 4 修改 ≈ 400 行**

### 17.1 为什么需要 P0

当前"写作前深度访谈"的所有基础设施（`AuthorChapterIntent`、`Interviewer` Agent、`SuggestionGenerator`）已经就位，但**它们都是被动触发的**：

- 用户必须手动打开 Studio 面板才能看到问题
- CLI 中没有任何预检查机制
- 管线在执行 `write next` 时从不检查"作者有没有回答关键问题"

P0 解决的就是这个"最后一公里"问题——让系统在写作前**主动跳出来问作者**。

### 17.2 架构设计

#### 核心组件：ProactiveEngine

不继承 `BaseAgent`（不需要 LLM），作为独立检测层插入现有管线：

```
write next (CLI) / 写章节按钮 (Studio)
      │
      ▼
┌─────────────────────────────┐
│    ProactiveEngine          │
│                             │
│  ┌───────────────────────┐  │
│  │ registerDetector(d)   │  │ ← 检测器注册
│  └───────────────────────┘  │
│             │               │
│             ▼               │
│  ┌───────────────────────┐  │
│  │ runProactiveChecks()  │  │ ← 并行运行所有检测器
│  └───────────────────────┘  │
│             │               │
│             ▼               │
│  ┌───────────────────────┐  │
│  │ 去重 + 按 urgency 排序 │  │
│  └───────────────────────┘  │
└─────────────┬───────────────┘
              │
              ▼
       如有 urgent 信号 ──→ 中断管线，展示给用户
              │                    │
              │              用户选择：
              │                [1] 去回答问题
              │                [2] 跳过继续写
              │                    │
              ▼                    ▼
         继续执行管线         退出或跳过
```

#### 核心数据结构

```typescript
// packages/core/src/proactive/types.ts

type Urgency = "urgent" | "normal" | "info";
type SignalType = "question" | "suggestion" | "alert" | "reminder";
type ProactiveStage = "pre-write" | "post-write" | "inter-chapter"
                     | "on-resume" | "periodic";

interface ProactiveSignal {
  readonly id: string;             // 用于去重
  readonly type: SignalType;
  readonly urgency: Urgency;
  readonly source: string;          // 哪个检测器触发的
  readonly title: string;
  readonly message: string;
  readonly context: string;
  readonly actions: ReadonlyArray<{
    readonly label: string;         // 按钮文本
    readonly action: string;        // 操作标识符
  }>;
  readonly relatedChapter?: number;
  readonly createdAt: number;
}

interface ProactiveInput {
  readonly bookDir: string;
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly stage: ProactiveStage;
}
```

#### 调度中心实现

```typescript
// packages/core/src/proactive/engine.ts

type Detector = (input: ProactiveInput) => Promise<ReadonlyArray<ProactiveSignal>>;
const DETECTORS: Detector[] = [];

export function registerDetector(detector: Detector): void {
  DETECTORS.push(detector);
}

export async function runProactiveChecks(
  input: ProactiveInput,
  dismissedIds?: ReadonlySet<string>,
): Promise<ReadonlyArray<ProactiveSignal>> {
  const results = await Promise.allSettled(DETECTORS.map((d) => d(input)));
  const signals: ProactiveSignal[] = [];

  for (const r of results) {
    if (r.status === "fulfilled") signals.push(...r.value);
  }

  // 排除已忽略的信号
  const filtered = dismissedIds?.size
    ? signals.filter((s) => !dismissedIds.has(s.id))
    : signals;

  // 按 urgency 排序: urgent → normal → info
  const priority = { urgent: 0, normal: 1, info: 2 };
  filtered.sort((a, b) => priority[a.urgency] - priority[b.urgency]);

  return filtered;
}
```

### 17.3 P0 检测器：intent-gap-detector

这是 P0 唯一实现的检测器——检查作者是否回答了三个核心问题。

```typescript
// packages/core/src/proactive/detectors/intent-gap-detector.ts

export async function checkMissingIntent(
  input: ProactiveInput,
): Promise<ReadonlyArray<ProactiveSignal>> {
  // 只在 pre-write 阶段运行
  if (input.stage !== "pre-write") return [];

  const intentsIndex = await loadChapterIntents(input.bookDir).catch(() => null);
  if (!intentsIndex) return [];

  const intent = getChapterIntent(intentsIndex.intents, input.chapterNumber);
  const missing: string[] = [];

  if (!intent?.coreNarrative) missing.push("核心叙述（这一章在讲什么）");
  if (!intent?.readerTakeaway) missing.push("读者感受目标（希望读者读完后的感受）");
  if (!intent?.keyMoment) missing.push("关键画面/时刻（本章最重要的一个场景）");

  if (missing.length === 0) return [];

  return [{
    id: `intent-gap-ch${input.chapterNumber}`,
    type: "question",
    urgency: missing.length >= 2 ? "urgent" : "normal",
    source: "intent-gap-detector",
    title: `第 ${input.chapterNumber} 章还有 ${missing.length} 个问题未回答`,
    message: `开始写作前，建议先回答：\n${missing.map((m, i) => `${i + 1}. ${m}`).join("\n")}`,
    context: `缺失字段：${missing.join("、")}`,
    actions: [
      { label: "去回答这些问题", action: "open-interview" },
      { label: "跳过，直接写作", action: "skip" },
    ],
    relatedChapter: input.chapterNumber,
    createdAt: Date.now(),
  }];
}
```

**设计要点**：
- 只检测 Level-1 的三个核心问题（coreNarrative / readerTakeaway / keyMoment）
- 缺少 ≥2 个问题时标记为 `urgent`（会中断管线），只缺 1 个时标记为 `normal`
- `id` 包含章节号确保跨章唯一，方便后续去重
- 不抛错——如果 `chapter_intents.json` 不存在，静默返回空

### 17.4 PipelineRunner 集成

修改 `writeNextChapter()` 方法，在规划阶段之前插入 ProactiveEngine 检查。

**方案**：不抛出异常，而是扩展返回值类型，让调用方通过类型判断是否中断。

```typescript
// runner.ts 新增类型
export interface ProactiveInterruptResult {
  readonly interrupt: "proactive";
  readonly signals: ReadonlyArray<ProactiveSignal>;
}

// writeNextChapter 返回值扩展为联合类型
export type WriteNextResult = ChapterPipelineResult | ProactiveInterruptResult;

// writeNextChapter 方法中的插入点（planChapter 调用之前）
const preSignals = await runProactiveChecks({
  bookDir, bookId,
  chapterNumber: nextChapter,
  stage: "pre-write",
});

const urgentSignals = preSignals.filter((s) => s.urgency === "urgent");
if (urgentSignals.length > 0) {
  // 将信号暂存到实例上，让上层读取
  this._pendingSignals = urgentSignals;
  return { interrupt: "proactive", signals: urgentSignals } as ProactiveInterruptResult;
}
```

**为什么不用 throw**：
- `writeNextChapter` 方法体极其庞大（3442 行/85 方法），抛异常可能导致资源清理遗漏
- 返回特殊 result 让调用方通过类型守卫区分，更安全

### 17.5 CLI 交互适配

在 `inkos write next` 命令中新增交互流程：

```
用户: inkos write next

系统: ── 写作前检查 ──
      ⚠ 第 24 章还有 2 个问题未回答：
        1. 核心叙述（这一章在讲什么）
        2. 关键画面/时刻（本章最重要的一个场景）

      操作：
        [1] 去回答问题
        [2] 跳过，直接写作

      请选择 [1-2]:
```

```typescript
// cli/src/commands/write.ts — write next action handler

if (!opts.skipQuestions) {
  const result = await pipeline.writeNextChapter(bookId, wordCount);

  if ("interrupt" in result && result.interrupt === "proactive") {
    // 展示信号
    for (const signal of result.signals) {
      console.log(`⚠ ${signal.title}`);
      console.log(signal.message);
    }

    // 询问用户
    const answer = await askUser("请选择 [1-2]: ", ["1", "2"]);
    if (answer === "1") {
      console.log("请通过 inkos intent edit <bookId> <chapter> 回答问题后重试");
      return;
    }
    // answer === "2": 跳过，继续执行
    result = await pipeline.writeNextChapter(bookId, wordCount);
  }
}
```

同时新增 `--skip-questions` 选项，供批量/自动化场景跳过检查：

```bash
inkos write next --skip-questions      # 跳过写作前提问
inkos write next --count 5              # 连写 5 章（自动跳过提问）
```

### 17.6 Studio API 端点

在现有 server.ts 中新增端点，供 Studio 前端轮询主动信号：

```typescript
// GET /api/v1/books/:id/proactive-signals?chapter=N
app.get("/api/v1/books/:id/proactive-signals", async (c) => {
  const bookDir = state.bookDir(c.req.param("id"));
  const chapter = parseInt(c.req.query("chapter") || "0")
    || await state.getNextChapterNumber(c.req.param("id"));

  const signals = await runProactiveChecks({
    bookDir,
    bookId: c.req.param("id"),
    chapterNumber: chapter,
    stage: "pre-write",
  });

  return c.json({ signals, total: signals.length });
});
```

### 17.7 文件清单与执行顺序

| 操作 | 文件路径 | Day |
|------|---------|:---:|
| **新建** | `packages/core/src/proactive/types.ts` | 1 |
| **新建** | `packages/core/src/proactive/engine.ts` | 1 |
| **新建** | `packages/core/src/proactive/index.ts` | 1 |
| **新建** | `packages/core/src/proactive/detectors/intent-gap-detector.ts` | 2 |
| **新建** | `packages/core/src/__tests__/proactive-engine.test.ts` | 2 |
| **修改** | `packages/core/src/pipeline/runner.ts` | 3 |
| **修改** | `packages/core/src/index.ts` | 3 |
| **修改** | `packages/cli/src/commands/write.ts` | 3 |
| **修改** | `packages/studio/src/api/server.ts` | 3 |

**执行顺序**：
```
Day 1 (框架): types.ts → engine.ts → index.ts
  → 完成标志: registerDetector / runProactiveChecks 可调用，返回空数组

Day 2 (检测器): intent-gap-detector.ts → 单元测试
  → 完成标志: 对已有 chapter_intents.json 的项目可检测到缺失问题
  → 测试场景: 全部回答→无信号 / 全部未答→urgent / 仅缺一个→normal / 非pre-write→空

Day 3 (集成): runner.ts → CLI → Studio → 回归测试
  → 完成标志: inkos write next 可在写作前弹出提问窗口
```

### 17.8 与现有架构的关系

```
P0 新增组件（绿色）与现有组件（蓝色）的关系：

┌───────────────────┐
│  AuthorChapterIntent  │ ← 已有 (3.4 节)
│  (chapter_intents.json)│
└────────┬──────────┘
         │ 读取
         ▼
┌───────────────────┐
│  ProactiveEngine  │ ← 🆕 P0 新增
│  + intent-gap     │
└────────┬──────────┘
         │ 在 write next 之前调用
         ▼
┌───────────────────┐
│  PipelineRunner   │ ← 已有，修改
│  writeNextChapter │
└────────┬──────────┘
         │ 返回 interrupt 信号
         ▼
┌───────────────────┐
│  CLI / Studio     │ ← 已有，修改
│  展示 + 询问用户   │
└───────────────────┘
```

**不修改的组件**：
- `Interviewer` Agent（保持不变，仍为独立的问题生成器）
- `SuggestionGenerator`（保持不变，仍为 Studio 中的建议来源）
- `PlannerAgent` / `WriterAgent` / `ContinuityAuditor`（核心 Agent 不变）
- 所有现有测试不变

**与未来 Phase 1-4 的关系**：P0 是 Phase 0（建立基线）之前的先行步骤。P0 上线后，后续 Phase 可以在 `ProactiveEngine` 中注册更多检测器（如 hook-maturity-detector、character-absence-detector），逐步构建完整的主动提问体系。

---

## 十八、评估组件节流配置（inkos.json）

```json
{
  "writing": {
    "qualityBudget": "normal",
    "qualityOverrides": {
      "firstChapter": "premium",
      "climaxChapters": "premium",
      "volumeStart": "premium",
      "finalFiveChapters": "premium",
      "default": "normal",
      "economySampleRate": 0.2
    },
    "readerPersonaRotation": false,
    "sceneSelfCheck": false
  }
}
```

| 配置 | 默认值 | 说明 |
|------|:------:|------|
| `qualityBudget` | `normal` | `economy` / `normal` / `premium` |
| `firstChapter` | `premium` | 首章总是最高质量 |
| `climaxChapters` | `premium` | 高潮章节自动升级 |
| `economySampleRate` | 0.2 | economy 模式下 20% 抽样 |
| `readerPersonaRotation` | false | 多读者人格轮换（Beta Reader） |
| `sceneSelfCheck` | false | 场景后质量自检 |

---

## 十九、ROI 预测

| Phase | 工作量(原) | 工作量(修正) | 测试+集成 | 实际合计 | 成本($) | 预期质量提升 | 风险 |
|:-----:|:---------:|:-----------:|:---------:|:--------:|:-------:|:-----------:|:----:|
| **0** | 2-3d | 2-3d | 0d | 2-3d | $0 | 建立基线，零风险 | 无 |
| **1** | 5-7d | 4d | 3d | 7-8d | +0.5 calls/章 | 角色一致性 +30% | 低 |
| **2** | 8-10d | 6.5d | 4.5d | 11d | +1.5 calls/章 | 场景结构 +40% | 中 |
| **3** | 4-5d | 4d | 2.5d | 6.5d | +1 calls/章 | 角色深度 +50% | 中低 |
| **4** | 5-7d | 12d | 8d | 20d | +2 calls/章 | 全书叙事完整性 +60% | 高 |

**注**：修正后总量 ~46d，低于上文的 65d 上限，因为部分组件可并行且底层基础设施（context-assembly、continuity）有复用基础。65d 是串行全量实现的悲观值，46d 是合理预期。

### 推荐的投入曲线

```
成本($)
  ^
  |     Phase 4 (5-7d, +2 calls/章, 高风险)
  |        ┌─────
  |        │
  |     Phase 2 (8-10d, +1.5 calls/章, 中风险)
  |        ┌─────
  |        │
  |     Phase 1 (5-7d, +0.5 calls/章, 低风险)
  |  ┌─────
  |  │
  |  └── Phase 0 (2-3d, $0, 零风险)
  └──────────────────────────────> ROI
  
  先花 2-3d 确定方向是否正确
  再花 5-7d 做低成本高感知度的改进
  只有确认有效后，才投入大规模改造
```

---

## 二十、与现有关键指标的预期对比

| 质量指标 | 当前 | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|----------|:----:|:-------:|:-------:|:-------:|:-------:|
| Auditor pass rate | ~70% | 80% | 85% | 88% | 92% |
| 读者投入度 (Beta Reader) | N/A | N/A | 5.5/10 | 6.5/10 | 8/10 |
| Hook 回收率 | ~40% | 60% | 65% | 70% | 80% |
| 角色一致性 | 未衡量 | 未衡量 | 60% | 85% | 90% |
| 风格达标率 | 未衡量 | 50% | 65% | 80% | 90% |
| 废稿率（需大幅度修订） | ~60% | 50% | 35% | 25% | 15% |
| 读者"想读下一章"率 | N/A | N/A | 55% | 70% | 85% |

### 20.1 对目标指标的修正建议

上表中的部分指标缺乏基线，在 Phase 0 启动前建议调整：

| 原指标 | 问题 | 修正建议 |
|--------|------|----------|
| 读者投入度 8/10 | 没有定义评分标准 | 先建立 1-10 分的 rubric（包含节奏、角色、情感、悬念 4 个子维度），并经人类校准 |
| Hook 回收率 80% | 当前 ~40% 数据来源不明 | 先统计现有章节的实际回收率作为基线，数据化当前表现 |
| 废稿率 15% | 定义模糊 | 明确"废稿"三层标准：Auditor 不通过 / 人类评分 < 5 / 需要重写超过 30% 内容 |
| "想读下一章"率 85% | 需要真实读者 | 在 Phase 0 中建立人类盲测 + LLM 评分双轨制，确认相关系数后再做目标预测 |

**校准流程**：
1. Phase 0 中收集 5 章 × 3 题材的人类评分数据 → 建立基线
2. 在 Phase 0.5 实验中验证 LLM 评分与人类评分的相关性
3. 只有相关性 ≥ 0.7 后，上表中的预测值才有指导意义
4. 如果相关性低，先调整评分 rubric 和 LLM prompt，直到校准通过

---

## 二十一、核心哲学转变

| 当前哲学 | 目标哲学 |
|----------|----------|
| "写够字数，通过检查" | "让读者想读下去" |
| 每章独立生成 | 全书统一叙事意图 |
| 事后审计发现问题 | 事前设计预防问题 |
| 所有章节风格一致 | 风格随叙事进化 |
| Auditor 检查规则 | Story Value 检查体验 |
| Writer 自由发挥 + Reviser 修正 | Writer 按 blueprint 施工 |
| 连续性靠事后审计 | 连续性靠事前 Bible |
| 情感弧线是记录 | 情感弧线是设计蓝图 |
| **Planner 说"做什么"** | **Planner 说"为什么做 + 感觉如何"** |
| **Writer 生成文字** | **Writer 构建体验** |
| **审计通过 = 质量好** | **读者想读下一章 = 质量好** |

---

## 二十二、一个 Writer prompt 的前后对比

### 当前 Writer prompt（简化）
```
写第 5 章。本章需要覆盖:
  - beat A: 主角发现线索
  - beat B: 与反派对峙
  - beat C: 主角做出决定
字数 3000 字左右。
```

### 改造后 Writer prompt（简化）
```
─── 第 5 章: 真相的代价 ───

【这个故事在讲什么】
  一个普通人被卷入远超自己能力的阴谋，
  他必须在"安全的谎言"和"危险的真相"之间做选择。

【读者现在的位置】
  上一章结尾: 主角发现朋友在骗他 → 读者感到背叛和困惑
  本章目标: 读者应该经历"愤怒 → 调查 → 震惊 → 决心"
  本章结尾: 读者应该迫不及待想读第 6 章

【本章场景序列】
  Scene 1/4 (400字, 过渡) | 主角消化背叛 → 决定调查
  Scene 2/4 (800字, 紧张) | 跟踪线索 → 发现更大阴谋
  Scene 3/4 (1000字, 高潮) | 与真正幕后黑手第一次交锋
  Scene 4/4 (800字, 回落) | 后果 + 新的疑问

【节奏控制】
  场景 1: 句长 18-25, 情绪"压抑"
  场景 2: 句长 12-18, 情绪"紧张→兴奋"
  场景 3: 句长 8-12, 情绪"震惊→恐惧"
  场景 4: 句长 15-20, 情绪"困惑→决心"

【角色声音】
  陈墨: 冷静短句, 内心用问句 — "我真的了解他吗？"
  反派: 优雅但危险, 喜欢用比喻

【禁止事项】
  ✗ 主角突然获得新能力（这不是玄幻文）
  ✗ 本章解决所有疑问（要留悬念到第 6 章）
  ✗ 让反派降智来衬托主角

【写完后请自查】
  [ ] 读者会想读下一章吗？
  [ ] 每个场景都有不可替代的功能吗？
  [ ] 角色行为让读者感到"意料之外, 情理之中"吗？
  [ ] 有没有至少一段让人印象深刻的描写？
```

---

## 二十三、结论与实施建议

### 23.1 核心判断

这份方案的核心洞察——**"合规不等于好看"**——是正确的。当前 InkOS 的产出在"不出错"层面已经达到可接受水平，但在"让人想读下去"层面仍有显著差距。报告中提出的 17 个组件、4 个价值维度、范式转换方向，是 InkOS 从"写作工具"走向"写作伙伴"的必经之路。

### 23.2 但这不是一个可以一次性实施的方案

| 维度 | 现状 | 风险 |
|------|------|------|
| **成本** | 原估 33-35d，实际约 46-65d（含测试 19d + 集成 12.5d），另有数倍 token 成本 | 投入约为原估算 1.5-2 倍 |
| **验证** | 主观指标缺乏基线和校准 | 改造后可能"感觉更好"但无法量化 |
| **架构** | 一次性引入太多新组件 | 调试困难，问题定位成本高 |

### 23.3 推荐策略

> **用 1-2 周做 prompt 级 MVP 实验，再决定是否全量实施。** 原估算 33-35d 因遗漏测试与管线集成成本被低估约 2 倍，实际全量实施约 46-65d。以下是两条可选路径：

**路径 A：低成本验证（建议首选）**

```
Phase 0 + 0.5（实验期）：2-3d 基线 + 3-5d 实验
  └─ 不改代码，只做 prompt 注入 + 人类盲测
  └─ 验证链：情绪蓝图 → 场景蓝图 → LLM 评分可靠性 → 成本
  └─ 任何一环失败 → 暂停对应方向

如果实验通过 → 走路径 B（新增模式）：
  实现 Prompt Compiler + Beta Reader + Genre Pact 校验
  预算：~23d（含测试 8d + 集成 4d）
  不修改 planner.ts/writer.ts 核心逻辑
```

**路径 B：全量架构（高投入高风险）**

```
只有路径 A 上线 2 周且数据证明 ROI 为正时才启动：
  Phase 1: 7-8d | Character Voice + Beta Reader + Genre Pact
  Phase 2: 11d   | 场景工艺（条件性启动）
  Phase 3: 6.5d  | 角色深度（条件性启动）
  Phase 4: 20d   | 叙事架构（含大量集成测试）
  合计: ~46d（串行悲观值 65d）
  
  每个 Phase 有明确的启动门禁和否决条件
  门禁未满足 → 不启动，回到 Phase 1 迭代
```

### 23.4 关键结论

> 本报告的价值不在于 17 个组件的设计细节，而在于它定义了一个清晰的方向：**从"规则遵守者"到"故事讲述者"**。
>
> 实施它的正确方式不是照单全收，而是**先用最小成本验证最关键的假设，再根据实验数据决定哪些组件值得架构化**。
>
> 这样可以在 1 周内知道"方向对不对"，而不是在 3 个月后才发现"方向对了但代价承受不起"。

---

> **从"写对"到"写好"，从"合规"到"动人"，从"审计通过"到"读者想读下去"。**
> 这不是增量改进，这是 InkOS 写作质量的 paradigm shift。
