# 《以 Agent 改进写作质量提升执行方案》调整与补充建议

> 审阅日期：2026-06-14  
> 对照文档：`reports/以Agent改进写作质量提升执行方案.md`  
> 对照代码基线：`fff6d76`  
> 审阅目标：减少重复建设，修正实验设计与阶段依赖，使方案能按当前项目真实状态执行

## 一、总体判断

原执行方案已经完成了三个重要修正：

1. 不再一次性实施全部 Agent。
2. 把主观质量判断放到人工校准之后。
3. 明确保留旧管线和 feature flag，降低回归风险。

这些方向合理。但方案仍有四个影响执行的结构性问题：

1. **文档状态落后于代码**：深度访谈、章节意图、Planner 注入、关键画面检查已经部分实现，仍按“待新建 P0”安排会重复建设。
2. **推荐路线前后不一致**：开头把 Prompt Compiler、ModelBehaviorProfile、T0-T2 记忆列入 23d 主线，正文却把 Prompt Compiler 和记忆增强放到 Phase 4，ModelBehaviorProfile 没有对应实施章节。
3. **部分组件与现有能力重复**：新的 SceneBlueprint、targetedRevise、Issue Arbiter 与现有 `AuthorScenePlan`、Reviser patch/rewrite 路由、审校问题分层存在重叠。
4. **实验样本和门禁不足以支撑结论**：3-5 章、10 章、3 位读者适合探索，不适合用 `r >= 0.7` 决定是否产品化。

因此不建议直接按当前 Phase 编号开始开发。应先做一次“实施状态重置”，将路线改成：

```text
现有意图系统收口
  → 评测与调用追踪
  → Prompt Manifest Lite
  → 确定性质量规则
  → Beta Reader 影子评测
  → 按数据选择场景、角色或叙事架构改造
```

---

## 二、必须先修正的文档内容

### 2.1 增加“当前实现状态”章节

建议在原报告最前面增加状态表，避免后续开发者重复创建已有模块。

| 能力 | 当前状态 | 建议 |
|---|---|---|
| `AuthorChapterIntent` | 已实现 | 不再新建同类章节意图模型 |
| Studio 章节访谈界面 | 已实现基础版本 | 继续增强，不另建 Proactive UI |
| 提问建议器 | 已实现并接入 API | 将其作为默认零成本方案 |
| `Interviewer` Agent | 类已实现，但未发现实际调用 | 暂不再增加入口，先决定是否需要 LLM 提问 |
| Planner 意图注入 | 已实现 | 纳入基线实验，不应视为未来 Phase |
| 关键画面/核心叙述检查 | 已实现关键词启发式 | 标记为 advisory，补误报评测 |
| `IntentCommitment` SQLite API | 已实现表与方法，但未发现调用方 | 接线或删除，不能视为已形成闭环 |
| Reviser 局部修订 | 已有 `spot-fix` 和自动 patch/rewrite 路由 | 不新增第二套 `targetedRevise()` |
| Scene 计划 | `AuthorChapterIntent.scenes` 已存在 | 在现有模型上扩展，不新增平行事实源 |
| Token 使用统计 | 已有章节级统计 | 增加阶段级、延迟和 prompt hash |
| `qualityBudget` | 当前配置 Schema 中不存在 | 应加入 `WritingConfigSchema`，不能放在 LLM 配置上 |

### 2.2 P0 应拆成“已完成基础”和“可选提醒”

当前 P0 把主动提问、章节意图和管线中断混在一起。建议拆分：

#### P0-A：章节意图基础，已基本完成

- 数据模型；
- 持久化；
- Studio 编辑；
- 提问建议；
- Planner 注入；
- 写后启发式检查。

剩余工作是收口和验证，不再按 3d 新项目估算。

#### P0-B：Proactive Reminder，可选

只负责发现未填写字段并提示，不建议默认中断写作流程。

推荐行为：

```text
无 intent
  → Studio 显示提醒
  → CLI 输出 warning
  → 用户显式开启 strictInterview 时才阻塞
```

原因：

- 自动写作、批量写作和 daemon 不适合等待交互输入；
- “未回答问题”不等于“无法写作”；
- 章节意图可能来自已有 ChapterGoal 或大纲，不应强迫重复填写。

### 2.3 修正“纯新增组件，不改核心 Agent”

原报告 Phase 1 需要修改：

- `post-write-validator.ts`；
- `runner.ts`；
- `reviser.ts`；
- Studio API；
- 项目配置 Schema。

因此不能标为“纯新增组件”。建议改成：

> 低侵入式增量接入：不重写 Planner/Writer 主生成逻辑，但会修改审校循环、配置和 Runner 接线。

### 2.4 统一推荐路线

报告开头的 23d Step 与正文 Phase 不一致，应只保留一套 WBS。尤其需要解决：

- Prompt Compiler 在 Step 1，却在正文 Phase 4 才实施；
- ModelBehaviorProfile 在 Step 3，但正文没有实现设计；
- T0-T2 记忆在 Step 3，但正文又在 Phase 4 才增强；
- Phase 0 标注“不动代码”，实际要新增评测模型和脚本。

建议采用本文第十节的新路线。

---

## 三、现有意图系统的收口建议

### 3.1 不要再建第二套 SceneBlueprint

当前 `AuthorChapterIntent` 已包含：

```ts
interface AuthorScenePlan {
  goal: string;
  location: string;
  povCharacter: string;
  targetEmotion?: string;
}
```

Phase 2 可以渐进扩展为：

```ts
interface AuthorScenePlan {
  id: string;
  goal: string;
  location: string;
  povCharacter: string;
  targetEmotion?: string;
  conflict?: string;
  outcome?: string;
  requiredBeats?: string[];
  forbiddenMoves?: string[];
  importance?: "bridge" | "normal" | "key";
}
```

只有当需要机器生成场景蓝图时，再增加：

```ts
interface PlannedScene extends AuthorScenePlan {
  source: "author" | "planner";
  confidence?: number;
}
```

作者输入和 Planner 推导可以共用结构，但必须保留来源，避免模型覆盖作者意图。

### 3.2 `readerTakeaway` 当前没有被真正验证

`validateAuthorIntentInContent()` 接收 `readerTakeaway`，但现有实现只检查 `keyMoment` 和 `coreNarrative`。

不建议继续用关键词检查“读者感受”，因为：

- 正文不需要出现“压抑”“感动”等目标情绪词；
- 情绪效果是读者反应，不是文本字面事实；
- 关键词命中会制造错误通过。

建议拆分：

| 意图字段 | 检查方式 | 严重级别 |
|---|---|---|
| `keyMoment` | 实体/动作证据或人工确认 | warning |
| `coreNarrative` | 事件完成与 required beat | warning |
| `readerTakeaway` | 人类盲测或校准后的 Beta Reader | info |
| `forbiddenMoves` | 确定性规则或审校 Agent | critical/warning |

### 3.3 IntentCommitment 必须二选一

当前存在：

- `chapter_intents.json`；
- `memory.db.intent_commitments`。

但 `addIntentCommitment()`、`verifyIntentCommitment()` 没有实际调用方。继续保留会形成双写风险。

建议二选一：

1. **推荐**：`chapter_intents.json` 作为作者意图唯一事实源；SQLite 只保存派生验证结果，并通过 `chapterNumber + intentRevision` 关联。
2. 删除 SQLite commitment 表，直接在章节运行 Trace 中保存检查结果。

不应把同一份作者答案同时维护在 JSON 和 SQLite 中。

### 3.4 为章节意图增加版本和状态

建议补充：

```ts
interface AuthorChapterIntent {
  // existing fields...
  revision: number;
  status: "draft" | "confirmed" | "superseded";
  updatedAt: string;
  source: "author" | "import" | "assistant-suggestion";
}
```

否则章节生成后作者修改意图，历史审校结果无法解释。

### 3.5 使用 Zod Schema 和迁移

当前读取逻辑主要检查少量字段，不能保证数组和枚举完整。建议：

- 建立 `AuthorChapterIntentSchema`；
- 老数据通过 migration 补默认值；
- API、Core 和 Studio 共用一份 contract；
- 不在 Studio 再复制一套 TypeScript interface。

---

## 四、质量基线与实验设计调整

### 4.1 Phase 0 不应宣称“客观质量基线”

人工阅读评分仍然具有主观性。建议改为：

> 建立可复现、可比较的当前质量基线。

基线至少记录：

- Git commit；
- 模型、provider 和模型版本；
- temperature、thinking budget；
- Prompt 版本或 hash；
- 作品输入版本；
- 随机性设置；
- 每阶段输入/输出 Token；
- 总延迟和重试；
- 是否人工修改。

### 4.2 样本应使用“任务单元”，不是只按章节数统计

9-15 章只能用于发现明显问题。正式决策建议：

- 探索集：12-18 个章节任务；
- 校准集：至少 30 个 A/B 对；
- 保留集：10-15 个从未参与 prompt 调整的任务；
- 至少覆盖开篇、过渡、冲突、高潮、收束五种章节职能。

每个任务必须使用相同输入条件生成旧版和新版，形成配对比较。

### 4.3 人工评测改用成对偏好

单独打 1-10 分容易出现不同读者量表不一致。优先提问：

```text
A 和 B 哪个更想继续读？
A 和 B 哪个角色更可信？
A 和 B 哪个情绪推进更自然？
无法判断 / 基本相同
```

保留 1-10 分作为辅助，不把平均分提高 1 分作为唯一门禁。

建议指标：

- 新版胜率；
- 平局率；
- 读者间一致性；
- 置信区间；
- 关键缺陷发生率；
- 单位 Token 的偏好收益。

### 4.4 读者不能只由项目成员组成

至少区分：

- 目标类型读者；
- 非目标类型普通读者；
- 项目成员。

项目成员知道改动目的，容易产生确认偏差。评测材料必须隐藏版本、模型和 prompt 信息。

### 4.5 实验不应组成单一串行链

四个实验并非严格依赖关系：

- 情绪蓝图和场景蓝图可以独立验证；
- Beta Reader 校准可并行进行；
- 成本实验应对每个候选方案分别执行。

建议使用组件级门禁，而不是“四个实验全部通过才能进入扩展路线”。

```text
Scene Blueprint 通过
  → 允许做场景结构增强

Beta Reader 校准通过
  → 允许进入 shadow evaluation

Beta Reader + 修订收益通过
  → 才允许自动触发 Reviser

成本门禁通过
  → 允许该组件进入 normal/premium 模式
```

### 4.6 成本实验必须运行真实流程

“一次调用后估算多场景调用”无法反映：

- 每次调用重复输入的 Token；
- 重试率；
- 场景连接修复；
- 并发限制；
- 输出截断；
- 审校后的返工。

成本实验至少实际运行 5 个章节任务，并报告 P50/P95：

- 总 Token；
- 调用数；
- 延迟；
- 重试数；
- 解析失败；
- 质量提升。

---

## 五、Beta Reader 方案调整

### 5.1 10 章不足以支持 `r >= 0.7`

10 个样本的相关系数极不稳定。建议：

- 至少 30 个配对样本，推荐 50 个；
- 同时报告 Pearson、Spearman 和置信区间；
- 报告“选对 A/B 优胜版本”的准确率；
- 计算人类评审间一致性，避免把人类分歧误判为模型失败。

### 5.2 不要让同一模型评价自己的输出

如果 Writer 和 Beta Reader 使用相同模型或同一模型家族，可能出现自我偏好。

建议：

- Writer 与 Reader 默认使用不同模型家族；
- 保存 Reader 模型、prompt hash 和版本；
- 定期用人工样本重新校准；
- 模型变更后自动使旧校准状态失效。

### 5.3 从“打分器”改成“证据型读者模拟”

比起直接输出 1-10 分，更有用的输出是：

```ts
interface ReaderObservation {
  dimension: "engagement" | "clarity" | "emotion" | "character" | "expectation";
  judgment: "positive" | "mixed" | "negative";
  evidence: Array<{
    startParagraph: number;
    endParagraph: number;
    reason: string;
  }>;
  confidence: number;
}
```

要求每个判断绑定段落证据。没有证据的分数不应进入统计。

### 5.4 Beta Reader 分三个成熟度阶段

1. **Shadow**：只记录，不显示门禁结果。
2. **Advisory**：展示给作者，不自动修改。
3. **Actionable**：只有在人类校准和修订收益实验通过后，才能触发局部修订。

即使进入 Actionable，也不建议用单次低分触发整章重写。

### 5.5 不要只校准“评分相关性”

还要验证：

- 弱点定位是否正确；
- 建议执行后是否真的变好；
- 是否倾向把文本改得更模板化；
- 不同类型作品上的稳定性；
- 对开篇、高潮、过渡章是否存在系统偏差。

真正的门禁应是：

> Beta Reader 指出的问题经过局部修订后，人类偏好显著提升，且没有增加连续性错误。

---

## 六、Genre Pact 调整

### 6.1 不能用关键词判断题材承诺是否兑现

示例中的“玄幻主角有独特天赋或金手指”不是每章都需要出现，“天赋、血脉、丹田”等词也不等于承诺被兑现。

关键词方案会产生：

- 大量误报；
- 作者为了通过校验而机械塞词；
- 类型套路固化；
- 对隐性兑现和原创表达失效。

### 6.2 Pact 应具备作用域和兑现窗口

建议改为：

```ts
interface GenrePromise {
  id: string;
  description: string;
  importance: "core" | "expected" | "optional";
  scope: "book" | "arc" | "chapter-type";
  expectedWindow?: { from: number; to: number };
  appliesToChapterTypes?: string[];
  evidenceRules?: EvidenceRule[];
  overduePolicy: "info" | "warning" | "critical";
}
```

校验对象应是“承诺是否在约定窗口内有证据”，而不是“本章是否出现关键词”。

### 6.3 与现有 GenreProfile 合并

项目已有 `GenreProfile`。不建议再建立完全独立的 `GenrePact` 配置体系。

建议：

- `GenreProfile` 保留类型基础参数；
- 新增 `promises`、`chapterTypeRules`、`auditRules`；
- 允许项目级 override；
- 配置解析仍走现有 genre profile 加载路径。

这样可以避免 `genres/*.md` 和 `genres/pacts/*.json` 两套类型配置。

---

## 七、Issue Arbiter 与 Reviser 调整

### 7.1 先统一 Issue Schema，再做 Arbiter

当前 `AuditIssue` 没有稳定的 location、source、confidence 和 fix scope。只靠 `category + location` 无法可靠去重。

建议扩展：

```ts
interface AuditIssue {
  id: string;
  source: "continuity" | "post-write" | "beta-reader" | "human";
  severity: "critical" | "warning" | "info";
  category: string;
  description: string;
  suggestion: string;
  location?: { startParagraph: number; endParagraph: number };
  evidence?: string[];
  confidence?: number;
  fixScope: "word" | "sentence" | "paragraph" | "scene" | "chapter";
  blocking: boolean;
}
```

### 7.2 Issue Arbiter 首版应是确定性归一化器

首版只做：

- category 标准化；
- 相同来源和位置的精确去重；
- 近似描述聚类；
- 严重级别提升；
- 按 fixScope 分组。

“检测冲突建议”和“输出最小修改集”需要语义判断，1.5d 估算偏低。可以在第二版增加 LLM 仲裁，但必须记录原始问题，不能覆盖证据。

### 7.3 不新增第二套 targetedRevise

现有 Reviser 已有：

- `spot-fix`；
- `patch-only`；
- `rewrite-only`；
- 根据问题类型自动选择修订范围。

Phase 1.5 应改成：

1. 给 `AuditIssue` 增加段落位置和 fixScope。
2. 强化现有 patch 协议。
3. 修订后只复检被修改段落及相关硬规则。
4. 检测 patch 是否越界修改。

这比再写一个按段落拼接的 `targetedRevise()` 更安全。

### 7.4 “新增组件失败不阻塞”需要分级

不是所有失败都应降级：

| 类型 | 失败策略 |
|---|---|
| Beta Reader、风格建议 | 记录并继续 |
| Prompt Trace、统计 | 记录并继续 |
| 结构化输出解析 | 重试后降级 |
| canon 冲突、禁写项、空稿 | 必须阻塞 |
| 状态持久化失败 | 必须阻塞或进入明确 degraded 状态 |

建议将组件策略定义为 `advisory | repairable | blocking`，而不是统一 non-blocking。

---

## 八、Prompt Compiler 的位置调整

### 8.1 Prompt Compiler 不应是 Phase 4 的 Agent

它是基础设施，不是创作 Agent。没有它，后续很难回答：

- 情绪蓝图实际插入在哪里；
- 新增 Character Voice 占了多少 Token；
- 哪条规则被截断；
- A/B 实验是否只改变了目标变量。

因此建议在评测基础之后立即实现“Lite 版”，但不替换全部上下文组装。

### 8.2 Prompt Manifest Lite 范围

第一版只做：

```ts
interface PromptFragment {
  id: string;
  source: string;
  role: "system" | "user" | "assistant";
  slot: string;
  priority: number;
  content: string;
  optional: boolean;
}

interface PromptManifest {
  stage: string;
  fragments: PromptFragment[];
  estimatedTokens: number;
  droppedFragments: string[];
  promptHash: string;
}
```

要求：

- 保持现有 prompt 文本和顺序不变；
- 只增加可观测性、Token 预算和 hash；
- 先接 Planner、Writer、Auditor；
- 新组件必须通过 Fragment 接入。

等 Lite 版稳定后，再做动态检索、压缩和模型适配。

### 8.3 Token 预算不能固定“保留 10% 输出空间”

不同模型有独立的 context window 和 max output。建议：

```text
availableInput =
  contextWindow
  - requestedMaxOutput
  - protocolOverhead
  - safetyMargin
```

安全余量可以按模型实测配置，不能统一为 10%。

---

## 九、场景、角色和 Narrative Director 调整

### 9.1 先做场景蓝图注入，不立即拆 Writer 循环

推荐顺序：

1. 在现有一次性 Writer 中注入场景计划。
2. 验证场景完成率和过渡自然度。
3. 仅对关键场景生成候选版本。
4. 最后才考虑逐场景调用。

全章场景循环不是质量提升的必然条件，反而可能造成：

- 场景之间重复铺垫；
- 人物语气和节奏断裂；
- 每次调用重复上下文；
- 章节整体弧线弱化。

### 9.2 优先“关键场景候选”，而不是所有场景拆分

对开篇、反转、高潮和结尾生成 2 个候选，再由作者或评估器选择，通常比把整章拆成 5-10 次调用更有收益。

建议新增：

```ts
importance: "bridge" | "normal" | "key"
```

仅 `key` 场景启用候选生成。

### 9.3 Emotional Beat Map 先作为 Scene 字段

在没有证明需要独立跨章情绪模型前，先使用：

```ts
emotionArc: {
  start?: string;
  peak?: string;
  end?: string;
  targetReaderFeeling?: string;
}
```

只有当需要跨章趋势分析时，再抽成 `EmotionalBeatMap`，避免模型数量膨胀。

### 9.4 Character Authenticity 不应优先做新的评分 Agent

更高收益的第一步是建立可验证的角色声音样本：

- 角色常用表达；
- 禁止表达；
- 正例对白；
- 反例对白；
- 知识边界；
- 当前关系状态。

先验证 Writer 使用这些例子后，人类能否更准确识别角色，再决定是否增加 Character Authenticity Agent。

### 9.5 Narrative Director 先做低频规划

不建议每章都调用 Director。推荐：

- 建书时生成全书承诺；
- 每卷或每 5 章生成一次 arc note；
- 发生连续低分、主线偏移或作者主动要求时重算；
- 每章只读取最近一次 DirectorNote。

这样能控制成本，也避免 Director 每章改变方向。

---

## 十、建议替换为新的执行路线

### Stage 0：实施状态重置与意图系统收口，2-3d

任务：

- 更新报告状态表；
- 建立 `AuthorChapterIntentSchema` 和迁移；
- 合并 Core/Studio contract；
- 决定 IntentCommitment 的唯一事实源；
- 为 intent 增加 revision/status；
- 将关键画面检查明确为 advisory；
- P0 提醒默认不阻塞。

验收：

- 不存在两套章节意图或场景计划；
- 老数据可读取；
- 自动写作不因未填写 intent 停摆；
- 每次生成记录使用的 intent revision。

### Stage 1：评测与运行追踪，4-6d

任务：

- 建立冻结的探索集、校准集和保留集；
- 生成配对 A/B 样本；
- 建立人工成对偏好工具；
- 记录模型、prompt hash、Token、延迟、重试；
- 输出阶段级 Trace；
- 固定基线报告模板。

验收：

- 任意两个方案可以在相同输入下比较；
- 评测者看不到版本信息；
- 可报告偏好胜率、置信区间和成本。

### Stage 2：Prompt Manifest Lite，3-5d

任务：

- Fragment/Manifest 数据结构；
- 保持现有 Prompt 行为不变；
- Planner、Writer、Auditor 接入；
- Token 预算和 dropped fragment Trace；
- 新组件禁止直接拼接大段 prompt。

验收：

- 同一输入下，接入前后 prompt hash 或等价快照一致；
- 可解释每个片段来源和 Token；
- 超预算行为可测试。

### Stage 3：确定性质量增强，4-6d

任务：

- GenreProfile 增加有时间窗口的 promises；
- 统一 AuditIssue Schema；
- Issue Normalizer；
- 强化 Reviser 现有 patch 模式；
- 复检修改范围和硬规则；
- 增加 `writing.qualityBudget` Schema。

验收：

- 不使用关键词判断每章类型承诺；
- 不新增第二套 targeted revise；
- advisory、repairable、blocking 策略明确；
- economy 模式不增加 LLM 调用。

### Stage 4：Beta Reader Shadow，3-5d 开发 + 校准周期

任务：

- 证据型 ReaderObservation；
- 使用不同模型家族；
- 保存 prompt/model 版本；
- 至少 30 个配对样本；
- 与人类偏好、问题定位和修订收益比较；
- 默认只记录。

升级条件：

- A/B 选择准确率和人类一致性达到预设范围；
- Reader 定位触发的局部修订在人类盲测中显著胜出；
- 连续性错误不增加；
- 成本在 normal 预算内。

### Stage 5：数据驱动选择一个专项，5-10d

只选择一个：

- 场景结构；
- 角色声音；
- 跨章节奏；
- Narrative Director。

禁止同时启动多个专项，否则无法归因质量变化。

### Stage 6：高成本架构，按需

候选：

- 关键场景多候选；
- 场景级 Writer；
- 混合记忆检索；
- StoryIntent / Arc Planner；
- 完整 Prompt Compiler。

必须有 Stage 1-5 的数据证明收益后再立项。

---

## 十一、补充配置建议

建议把质量预算放到 `WritingConfigSchema`：

```ts
const WritingConfigSchema = z.object({
  reviewRetries: z.number().int().min(0).max(10).default(1),
  qualityBudget: z.enum(["economy", "normal", "premium"]).default("economy"),
  strictInterview: z.boolean().default(false),
  betaReaderMode: z.enum(["off", "shadow", "advisory", "actionable"]).default("off"),
  keySceneCandidates: z.number().int().min(1).max(3).default(1),
});
```

不建议使用 `defaultLLMConfig.qualityBudget`，因为它不是模型传输参数，而是写作管线策略。

每个组件再声明：

```ts
interface QualityComponentPolicy {
  enabled: boolean;
  failureMode: "continue" | "degrade" | "block";
  sampleRate: number;
  maxCallsPerChapter: number;
  maxInputTokens: number;
}
```

---

## 十二、质量门禁补充

原报告的测试门禁应调整为：

```text
pnpm typecheck
pnpm build
pnpm test
pnpm verify:publish-manifests
```

同时增加：

- 不使用固定“171+ CLI 测试”描述，测试数量会变化；
- 检查构建后不存在意外的 `tsbuildinfo` 变更；
- Schema 变更必须有旧数据迁移测试；
- Prompt 变更必须有快照或 Manifest 差异；
- 新 LLM 组件必须测试超时、无效 JSON、截断和 provider 失败；
- feature flag 关闭时必须有行为等价测试；
- 影子评测失败不能改变最终章节；
- 自动修订必须验证没有丢失原始 hard constraint。

### 产品质量门禁

建议采用：

| 指标 | 推荐路线门禁 |
|---|---|
| 人类 A/B 新版胜率 | 下置信界高于 50%，或达到预设最小收益 |
| 连续性 critical | 不高于基线 |
| 每章 Token | economy 不增加；normal 增量有预算 |
| P95 延迟 | 不超过配置上限 |
| 解析失败率 | 小于 1%，且可降级 |
| 人工接受率 | Reader 建议被接受或保留的比例 |
| 修订越界率 | 局部修订不得修改无关段落 |

不建议只使用平均分提高 1 分、Auditor 通过率不下降或单个相关系数作为门禁。

---

## 十三、工作量重新估算

| 阶段 | 估算 | 说明 |
|---|---:|---|
| Stage 0 意图收口 | 2-3d | 复用当前实现 |
| Stage 1 评测与 Trace | 4-6d | 包含工具和实验资产 |
| Stage 2 Prompt Manifest Lite | 3-5d | 不替换现有组装 |
| Stage 3 确定性质量增强 | 4-6d | Schema、规则、Reviser 接线 |
| Stage 4 Beta Reader Shadow | 3-5d | 不含等待人工校准时间 |
| Stage 5 单项质量专项 | 5-10d | 每次只选一个 |

推荐首轮工程投入约 **16-25 人日**，另需独立计算人工评测周期。原报告把评测者时间、样本生成费用和校准等待混入或遗漏，建议分别统计：

- 工程人日；
- 人工评测小时；
- LLM 实验费用；
- 日历时间。

---

## 十四、最终建议

原报告最需要的不是再增加新的 Agent 设计，而是完成以下调整：

1. 先承认章节意图与访谈能力已经部分落地，做收口而不是重复实现。
2. 把 Prompt Compiler 改成早期的 Manifest 基础设施，不作为 Phase 4 Agent。
3. 复用 `AuthorScenePlan` 和现有 Reviser 路由，避免两套 Scene 与局部修订系统。
4. Genre Pact 从关键词检查改成有作用域、有兑现窗口的类型承诺。
5. Beta Reader 先做证据型影子评测，校准“问题定位和修订收益”，不只校准分数。
6. 将四个实验改为组件级独立门禁，不要求全部通过。
7. 把质量预算放入 WritingConfig，并为不同组件定义失败策略。
8. 每轮只实施一个质量专项，用配对盲测证明收益后再扩展。

按此调整后，执行方案会从“组件清单”变成真正可验证的迭代系统：每个 Agent 都有明确输入、成本、失败模式和退出条件，质量提升也能归因到具体改动。
