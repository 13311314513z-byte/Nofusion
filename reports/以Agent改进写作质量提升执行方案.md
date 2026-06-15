# 以 Agent 改进写作质量提升执行方案（第三版）

> **衍生自**：`写作质量提升管线Agent建议.md`  
> **审阅参考**：`以Agent改进写作质量提升执行方案_调整与补充建议.md`  
> **定位**：可参照的执行文档，将分析转化为分步实施动作  
> **核心变更**：本版放弃 Phase 编号制，改用 **Stage 制**——每个 Stage 产出可独立交付的价值，且完全基于当前代码真实状态安排任务。

---

## 目录

- [关键判断与推荐路线](#关键判断与推荐路线)
- [当前实现状态](#当前实现状态)
- [实施设计原则](#实施设计原则)
- [Stage 0：实施状态重置与意图系统收口](#stage-0实施状态重置与意图系统收口)
- [Stage 1：评测与运行追踪](#stage-1评测与运行追踪)
- [Stage 2：Prompt Manifest Lite](#stage-2prompt-manifest-lite)
- [Stage 3：确定性质量增强](#stage-3确定性质量增强)
- [Stage 4：Beta Reader 影子评测](#stage-4beta-reader-影子评测)
- [Stage 5：数据驱动选择专项质量改进](#stage-5数据驱动选择专项质量改进)
- [Stage 6：高成本架构（按需立项）](#stage-6高成本架构按需立项)
- [附录 A：文件变更总表](#附录-a文件变更总表)
- [附录 B：质量门禁检查清单](#附录-b质量门禁检查清单)
- [附录 C：风险和应对](#附录-c风险和应对)
- [附录 D：配置项汇总](#附录-d配置项汇总)
- [附录 E：成本跟踪模板](#附录-e成本跟踪模板)

---

# 关键判断与推荐路线

## 核心判断

原分析文档方向有价值，但逐 Phase 编号的执行方案存在五个结构性问题：

1. **文档状态落后于代码**。`AuthorChapterIntent`、Planner 注入、关键画面检查、Studio 访谈界面已在 fff6d76 基线中部分实现，原方案仍按"待新建 P0"安排，会造成重复建设。
2. **推荐路线前后不一致**。头部 Step 列表与正文 Phase 内容脱节（如 Prompt Compiler 在 Step 1 却在正文 Phase 4）。
3. **部分组件与现有能力重复**。`AuthorScenePlan`、Reviser patch/rewrite 路由、审校问题分层已存在，不应新建平行体系。
4. **实验样本量不足以支撑产品化门禁**。3-5 章、10 章适合探索，不适合用相关系数 ≥ 0.7 决定是否投入。
5. **五层记忆与现有 memory-db 大量重叠**，应增强现有系统而非另起新层。

## 推荐路线

本版采用 **Stage 制**替代 Phase 制，共 6 个 Stage。

```
Stage 0 (2-3d):  状态重置与收口            — 🔶 主体闭环，精确 revision 确认待修
Stage 1 (4-6d):  评测与运行追踪            — 🔶 评测工具完成，基线数据待建立
Stage 2 (3-5d):  Prompt Manifest Lite      — 🔶 Planner/Auditor 装配接入，Writer 待迁移
Stage 3 (4-6d):  确定性质量增强            — 🔶 手动边界拒绝完成，自动修订待接入
Stage 4 (3-5d):  Beta Reader 影子评测      — 🔶 shadow 已持久化，校准与异构约束待建立
Stage 5 (5-10d): 数据驱动选择单项质量改进   — ⏳ 依赖 Stage 1 基线数据
Stage 6 (按需):  高成本架构立项             — ⏳ 依赖 Stage 5 数据

推荐首轮工程投入：16-25 人日（不含人工评测时间）— 🔶 核心工程大部完成，产品验收未完成
```

---

# 当前实现状态

> 代码基线已超过 fff6d76。以下为 Stage 0-4 实施后的实际状态。

| 能力 | 状态 | 实现位置 |
|------|:----:|----------|
| `AuthorChapterIntent` 数据模型 + 持久化 | ✅ 已实现 | `models/chapter-intent.ts` |
| `AuthorChapterIntentSchema` Zod 校验 | ✅ 已实现 | `models/chapter-intent.schema.ts` |
| intent revision / status / source 追踪 | ✅ 已实现 | `models/chapter-intent.ts` |
| 自动 supersede 旧版本 | ✅ 已实现 | `upsertChapterIntent()` |
| 章节 `intentRevision` 关联 | ✅ 已接入 | `chapter-persistence.ts` + `runner.ts` |
| 章节成功后 intent 自动确认 | 🔶 有竞态风险 | 当前可能确认生成期间新增的 revision |
| Studio 章节访谈界面 | ✅ 已实现 | Studio `BookGoalsSection.tsx` |
| Studio 从 Core 导入类型（消除重复） | ✅ 已实现 | Studio → `@actalk/inkos-core` |
| 提问建议器（SuggestionGenerator） | ✅ 已实现 | API 接入 |
| Planner 意图注入 | ✅ 已实现 | `intent-injection.ts` |
| 关键画面检查（advisory 级别） | ✅ 已降级 | `post-write-validator.ts` |
| `IntentCommitment` SQLite 死代码 | ❌ 已删除 | 单一事实践 `chapter_intents.json` |
| Reviser 局部修订（spot-fix/patch/rewrite） | ✅ 已有 | `reviser.ts` |
| `AuditIssue` / `ResolvedAuditIssue` 两层契约 | ✅ 已实现 | `models/audit-issue.ts` |
| `IssueNormalizer` 确定性归一化器 + 管线集成 | ✅ 已接入 | `chapter-review-cycle.ts`、`reviser.ts`、`runner.ts` |
| Continuity/Beta Reader 位置与证据 | ✅ 已接入 | `continuity.ts`、`runner.ts` |
| Token 使用统计 | ✅ 章节级 | 内置 |
| `qualityBudget` / `strictInterview` / `betaReaderMode` 配置 | ✅ 已加入 | `models/project.ts` `WritingConfigSchema` |
| `qualityBudget` 消费（影响 reviewRetries） | ✅ 已实现 | `cli/utils.ts` `buildPipelineConfig()` |
| `strictInterview` CLI 消费 | ✅ 已完成 | `cli/commands/write.ts` `write next` |
| `keySceneCandidates` 消费 | ⏳ 待 Stage 5 | 配置就绪，依赖场景结构增强方向选择 |
| `PromptManifest`/`PromptFragment` | ✅ 已实现 | `models/prompt-manifest.ts` |
| Planner/Continuity Manifest 实际装配 | 🔶 message 粒度 | messages 从 Manifest 生成，但尚未拆内部组件 |
| Writer Manifest | 🔶 仅旁路日志 | creative/observer/settler 尚未由 fragments 组装 |
| Token 预算计算 | ✅ 已实现 | `getAvailableInputTokens()` |
| 新组件接入规范文档 | ✅ 已创建 | `docs/prompt-component-guide.md` |
| `BetaReader` Agent 证据型输出 | ✅ 已实现 | `agents/beta-reader.ts` |
| BetaReader 管线集成 | 🔶 部分接入 | 运行时和 shadow 持久化已接入；异构模型约束与校准尚未完成 |
| BetaReader shadow 记录 | 🔶 会覆盖历史 | 当前按章节号覆盖，缺 run ID 和人工样本关联 |
| BetaReader 三步成熟度模式 | ✅ 已实现 | `models/beta-reader-output.ts` |
| 成对偏好评测工具 | ✅ 已实现 | `evaluation/paired-preference.ts` |
| CLI 评测脚本 | ✅ 已创建 | `scripts/evaluate-chapter.mjs` / `preference-eval.mjs` |
| `GenreProfile` 承诺扩展（含 `overduePolicy`） | ✅ 已实现 | `models/genre-profile.ts` |
| 类型承诺检查器 + `overduePolicy` 映射 | ✅ 已实现 | `evaluation/genre-promises.ts` |
| `checkGenrePromises()` 管线集成 | ⏸️ 暂缓 | 缺少履约证据账本，已撤下生产接线 |
| Patch 边界检测 | ✅ 已实现 | `utils/patch-boundary.ts` |
| `selectReviseModeFromFixScope` Reviser 路由 | ✅ 已接入 | `reviser.ts` `resolveAutoOutputMode()` |
| `checkPatchBoundary` 修订后验证 | 🔶 手动路径 | `reviseDraft()` 会拒绝越界，自动 `runChapterReviewCycle()` 尚未接入 |
| 基线报告 | ❌ 待人工填写 | 模板已创建于 `reports/写作质量基线报告.md` |

---

# 实施设计原则

### 原则一：蓝图即约束，而非指令

注入 Writer prompt 的蓝图字段必须遵循：

- ✅ **好的约束**："本章结尾的情绪应该是'决心'而非'安心'"
- ❌ **坏的指令**："第 3 段句长必须是 8-12 字"
- 判断标准：删掉这个字段后，LLM 是否会产出显著更差的文本？

### 原则二：新增即可选，不阻塞主线

任何新组件上线时必须：
- 有 feature flag 或配置项可关闭
- 关闭后现有管线行为 **100% 不变**
- 失败策略分级（见下表），不统一 non-blocking

| 类型 | 失败策略 |
|------|----------|
| Beta Reader、风格建议 | 记录并继续（advisory） |
| Prompt Trace、统计 | 记录并继续（advisory） |
| 结构化输出解析 | 重试后降级（repairable） |
| canon 冲突、禁写项、空稿 | 必须阻塞（blocking） |
| 状态持久化失败 | 阻塞或进入明确 degraded 状态 |

### 原则三：评估组件必须可节流

所有新增 LLM 评估调用通过 `WritingConfigSchema.qualityBudget` 控制：

```typescript
const WritingConfigSchema = z.object({
  qualityBudget: z.enum(["economy", "normal", "premium"]).default("economy"),
  strictInterview: z.boolean().default(false),
  betaReaderMode: z.enum(["off", "shadow", "advisory", "actionable"]).default("off"),
  keySceneCandidates: z.number().int().min(1).max(3).default(1),
});
```

### 原则四：复用现有能力，不新建平行体系

- Scene 计划 → 扩展 `AuthorScenePlan`，不新建 `SceneBlueprint`
- 局部修订 → 增强现有 patch 路由，不新增 `targetedRevise()`
- 记忆系统 → 增强现有 `memory-db`，不另起"五层记忆"
- 类型配置 → 扩展现有 `GenreProfile`，不另建 `GenrePact` 配置体系
- Issue 去重 → 基于现有 `AuditIssue` 扩展，不新建独立 Schema

### 原则五：反馈回路优先于前馈控制

```
Writer → Beta Reader（Shadow） → 积累数据 → 决定是否投入事前设计
```

---

# Stage 0：实施状态重置与意图系统收口

**工作量**：2-3d | **前置条件**：无 | **是否可跳过**：不可跳过

## 目标

将现有意图系统（`AuthorChapterIntent`、`IntentCommitment`、Zod Schema、Studio 界面）收口为稳定的事实源，消除双写风险和版本混乱。

## 任务

### Task 1：建立 `AuthorChapterIntentSchema` Zod 校验（0.5d）

**新建** `packages/core/src/models/chapter-intent.schema.ts`

```typescript
import { z } from "zod";

export const AuthorScenePlanSchema = z.object({
  goal: z.string().min(1),
  location: z.string().optional(),
  povCharacter: z.string().optional(),
  targetEmotion: z.string().optional(),
  conflict: z.string().optional(),
  outcome: z.string().optional(),
  requiredBeats: z.array(z.string()).optional(),
  forbiddenMoves: z.array(z.string()).optional(),
  importance: z.enum(["bridge", "normal", "key"]).optional(),
});

export const AuthorChapterIntentSchema = z.object({
  chapterNumber: z.number().int().positive(),
  coreNarrative: z.string().optional(),
  readerTakeaway: z.string().optional(),
  keyMoment: z.string().optional(),
  scenes: z.array(AuthorScenePlanSchema).optional(),
  characterStates: z.array(z.object({
    characterId: z.string(),
    emotion: z.string(),
    relationshipChanges: z.string().optional(),
  })).optional(),
  requiredBeats: z.array(z.string()).optional(),
  forbiddenMoves: z.array(z.string()).optional(),
  narrativePosition: z.enum(["opening", "rising", "climax", "falling", "resolution"]).optional(),
  plotLine: z.string().optional(),
  // 新增追踪字段
  revision: z.number().int().default(1),
  status: z.enum(["draft", "confirmed", "superseded"]).default("draft"),
  updatedAt: z.string().datetime(),
  source: z.enum(["author", "import", "assistant-suggestion"]).default("author"),
});
```

**要求**：
- API、Core、Studio 共用同一份 Schema（通过 package 导出）
- 老数据读取时补默认值（migration 函数）

### Task 2：合并 Core/Studio contract，消除 interface 复制（0.5d）

- 从 Studio 中移除独立定义的 `AuthorChapterIntent` 接口
- Studio 改为从 `@actalk/inkos-core` 导入 Schema 类型
- 确保 `z.infer<typeof AuthorChapterIntentSchema>` 与现有读写路径兼容

### Task 3：决定 `IntentCommitment` 的唯一事实源（0.5d）

**推荐方案**：
- `chapter_intents.json` 作为作者意图的**唯一写入事实源**
- SQLite `intent_commitments` 表只保存派生验证结果
- 通过 `chapterNumber + intentRevision` 建立关联
- 删除未使用的 `addIntentCommitment()` / `verifyIntentCommitment()` 或增加接线测试

**备选方案**：如果确认无调用方且近期不计划使用，直接删除 SQLite 表及相关方法。

### Task 4：为 intent 增加 revision/status 追踪（0.5d）

- 每次作者修改 intent 时 `revision += 1`
- 章节生成后 intent 自动标记为 `confirmed`
- 修改已生成的 intent 时旧版本标记为 `superseded`
- 每次生成记录使用的 `intentRevision`

### Task 5：将关键画面检查明确为 advisory（0.5d）

当前 `validateAuthorIntentInContent()` 对 `keyMoment` 和 `coreNarrative` 做关键词检查。修改为：

- 输出级别从 `warning` 降为 `info`
- 结果标记为 `heuristic`，不作为审校门禁
- 增加误报率跟踪

`readerTakeaway` 字段 **不** 适用于关键词检查——情绪效果是读者反应，不是文本字面事实。

### Task 6：P0 提醒默认不阻塞（0.5d，可选）

- Studio 显示提醒（非模态）
- CLI 输出 warning（非交互中断）
- 用户显式开启 `strictInterview: true` 时才阻塞自动写作

自动写作、批量写作和 daemon 模式不受影响。

## Stage 0 验收标准

- [x] `AuthorChapterIntentSchema` 建立并通过 Zod 校验测试
- [x] Core/Studio 共用同一份 contract，无独立接口定义
- [x] IntentCommitment 唯一事实源已确定，不存在双写路径
- [ ] intent 的 revision/status/updatedAt 正常递增
- [x] 关键画面检查降级为 advisory，不阻塞管线
- [x] 自动写作不因未填写 intent 停摆

> revision 递增本身已实现；该项暂不勾选是因为生成期间新增 revision 可能被错误确认，且缺少对应 Runner 集成测试。

---

# Stage 1：评测与运行追踪

**工作量**：4-6d | **前置条件**：Stage 0 完成 | **是否可跳过**：不可跳过

## 目标

建立可复现、可比较的当前质量基线，为后续所有 Stage 提供"比什么"的参照系。

## 任务

### Task 1：建立评测样本集（1d）

**样本要求**：

| 用途 | 规模 | 说明 |
|------|:----:|------|
| 探索集 | 12-18 个章节任务 | 发现明显问题 |
| 校准集 | ≥ 30 个 A/B 对 | 用于评估器校准 |
| 保留集 | 10-15 个任务 | 从未参与 prompt 调整 |

**章节职能覆盖**：开篇、过渡、冲突、高潮、收束，每种至少 2 个样本。

**每个任务**：使用相同输入条件生成旧版和新版，形成配对比较。

### Task 2：建立人工成对偏好工具（1.5d）

不依赖 1-10 分制。采用成对偏好比较：

```typescript
export interface PairedPreference {
  readonly pairId: string;
  readonly versionA: string;
  readonly versionB: string;
  readonly questions: Array<{
    readonly id: string;
    readonly text: string;   // "哪个更想继续读？"
    readonly answer: "A" | "B" | "tie" | "unable";
    readonly confidence: 1-5;
    readonly freeform?: string;
  }>;
  readonly readerId: string;
  readonly timestamp: string;
  readonly blindingInfo: {
    readonly versionAMasked: boolean;
    readonly versionBMasked: boolean;
  };
}
```

**指标**：
- 新版胜率 + 置信区间
- 平局率
- 读者间一致性
- 关键缺陷发生率
- 单位 Token 的偏好收益

**工具实现**：

**新建** `packages/core/src/evaluation/paired-preference.ts`

```typescript
export function computePreferenceMetrics(
  pairs: ReadonlyArray<PairedPreference>,
): PreferenceMetrics {
  // 计算胜率、置信区间、一致性等
}

export interface PreferenceMetrics {
  readonly winRate: number;          // 新版胜率
  readonly ci95: [number, number];   // 95% 置信区间
  readonly tieRate: number;
  readonly interReaderAgreement: number;  // Fleiss' Kappa
}
```

**新建** `scripts/preference-eval.mjs`

```javascript
// 用法: node scripts/preference-eval.mjs <pair-csv> [--output report.md]
// 读取配对偏好数据 → 计算指标 → 产出报告
```

### Task 3：基线数据采集（1.5d）

**至少记录**：
- Git commit
- 模型、provider、模型版本
- temperature、thinking budget
- Prompt 版本或 hash（通过 Stage 2 的 Manifest）
- 作品输入版本
- 随机性设置
- 每阶段输入/输出 Token
- 总延迟和重试
- 是否人工修改

**读者要求**：
- 至少区分：目标类型读者、非目标类型普通读者、项目成员
- 项目成员知道改动目的，容易产生确认偏差——评测材料必须隐藏版本、模型和 prompt 信息
- 至少各 2 名读者，共 ≥ 6 人

### Task 4：产出基线报告（1d）

**新建** `reports/写作质量基线报告.md`

模板内容：

```markdown
# 写作质量基线报告
基线的 git commit: `fff6d76`
生成日期: YYYY-MM-DD

## 样本概览
| 题材 | 章节数 | 职能覆盖 | 平均 Token | 平均延迟 |

## 成对偏好结果
| 指标 | 值 | 95% CI |
|------|:---:|:------:|

## 当前最大痛点
1. ...
2. ...

## 推荐 Stage 5 专项方向
```

## Stage 1 验收标准

- [ ] 探索集 ≥ 12 个任务，覆盖 5 种章节职能
- [ ] 校准集 ≥ 30 个 A/B 对
- [ ] 保留集 ≥ 10 个任务
- [x] 成对偏好工具已实现，可计算胜率和置信区间
- [ ] 基线报告已生成
- [ ] 读者 ≥ 6 人，至少 3 种角色
- [x] 评测材料隐藏版本信息

---

# Stage 2：Prompt Manifest Lite

**工作量**：3-5d | **前置条件**：Stage 1 完成（或并行启动） | **是否可跳过**：可以跳过，但不建议

## 目标

为 Prompt 增加可观测性。不替换现有拼接逻辑，只增加 Fragment 元数据、Token 预算和 hash。

**为什么 Stage 2 优先于质量改造**：没有 Manifest，无法回答情绪蓝图插在哪、Character Voice 占多少 Token、哪条规则被截断、A/B 实验是否只改变了目标变量。

## 任务

### Task 1：定义 Fragment/Manifest 数据结构（0.5d）

**新建** `packages/core/src/models/prompt-manifest.ts`

```typescript
export interface PromptFragment {
  readonly id: string;
  readonly source: string;        // "book-rules" | "chapter-intent" | "character-voice" | ...
  readonly role: "system" | "user" | "assistant";
  readonly slot: string;          // 在 prompt 中的位置标识
  readonly priority: number;      // 0-100，越高越不可压缩
  readonly content: string;
  readonly optional: boolean;
  readonly estimatedTokens: number;
}

export interface PromptManifest {
  readonly stage: string;         // "planner" | "writer" | "auditor"
  readonly fragments: PromptFragment[];
  readonly totalEstimatedTokens: number;
  readonly maxAllowedInputTokens: number;
  readonly droppedFragments: Array<{
    readonly fragmentId: string;
    readonly reason: string;
  }>;
  readonly promptHash: string;    // 用于 A/B 实验追踪
}
```

### Task 2：Planner、Writer、Auditor 接入（2-3d）

要求：
- 保持现有 prompt 文本和顺序 **完全不变**
- 在每个 Agent 的 prompt 装配点插入 Manifest 构建
- 输出 Manifest 到 Trace 日志（不写入文件，不消耗磁盘）
- 当预估 Token 超过 `maxAllowedInputTokens` 时记录 dropped fragments

```typescript
// 接入示例（Agent 内）
const manifest = buildPromptManifest({
  stage: this.name,
  fragments: [
    { id: "book-rules", source: "rules-reader", role: "system", slot: "rules", priority: 100, content: rules, optional: false, estimatedTokens: countTokens(rules) },
    { id: "chapter-intent", source: "chapter-intent", role: "user", slot: "intent", priority: 80, content: intentBlock, optional: true, estimatedTokens: countTokens(intentBlock) },
  ],
  maxAllowedInputTokens: getAvailableInputTokens(this.ctx.model),
});
```

### Task 3：Token 预算计算工具（0.5d）

```typescript
export function getAvailableInputTokens(modelId: string, requestedMaxOutput?: number): number {
  const contextWindow = getModelContextWindow(modelId);
  const maxOutput = requestedMaxOutput ?? getModelDefaultMaxOutput(modelId);
  const protocolOverhead = estimateProtocolOverhead(modelId);
  const safetyMargin = getModelSafetyMargin(modelId);
  return contextWindow - maxOutput - protocolOverhead - safetyMargin;
}
```

**注意**：不固定"保留 10% 输出空间"。安全余量按模型实测配置。

### Task 4：新组件接入规范（0.5d）

写入开发规范：所有新增 prompt 内容必须通过 Fragment 接入，禁止直接拼接大段字符串。

## Stage 2 验收标准

- [ ] 同一输入下，接入前后 prompt hash 或等价快照一致
- [ ] Manifest 可解释每个片段来源和 Token
- [ ] 超预算时 dropped fragments 可追踪
- [ ] Planner、Writer、Auditor 三个 Agent 已接入
- [x] 新组件接入规范已写入

---

# Stage 3：确定性质量增强

**工作量**：4-6d | **前置条件**：Stage 0 + Stage 1 完成 | **是否可跳过**：不建议跳过

## 目标

在不引入新 LLM 调用的前提下，增强审校系统的确定性规则能力。

## 任务

### Task 1：Genre Profile 增强——有时间窗口的类型承诺（1.5d）

**不在** `GenrePact` 下另建一套配置体系，而是在现有 `GenreProfile` 中扩展：

**修改** `packages/core/src/models/genre-profile.ts`

```typescript
export interface GenrePromise {
  readonly id: string;
  readonly description: string;       // "主角有独特天赋或金手指"
  readonly importance: "core" | "expected" | "optional";
  readonly scope: "book" | "arc" | "chapter-type";
  readonly expectedWindow?: { from: number; to: number };
  readonly appliesToChapterTypes?: string[];
  readonly overduePolicy: "info" | "warning" | "critical";
  // evidenceRules 不使用关键词匹配，使用 LLM 判断或人工确认
}
```

**不基于关键词**做每章校验。关键词方案会产生误报、类型套路固化、隐性兑现失效等问题。

承诺的校验方式是：
- `core` + `scope: "book"`：全书完成后校验，非每章
- `core` + `scope: "chapter-type"`：在匹配的章节类型出现时校验
- `expected`：参考性提示，不设门禁

**不新建** `genres/pacts/*.json`。配置仍走现有 genre profile 加载路径。

### Task 2：统一 `AuditIssue` Schema（1d）

实现采用两层契约：`AuditIssue` 保留旧插件和历史四字段输入兼容性，`ResolvedAuditIssue` 要求完整的 source、fixScope、blocking、id 和 createdAt。所有生产消费边界通过 `createIssue()` 或 `IssueNormalizer` 转换为完整结构。

**修改** `packages/core/src/models/audit-issue.ts`

```typescript
export interface AuditIssue {
  readonly id: string;
  readonly source: "continuity" | "post-write" | "beta-reader" | "human";
  readonly severity: "critical" | "warning" | "info";
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
  readonly location?: { startParagraph: number; endParagraph: number };
  readonly evidence?: string[];
  readonly confidence?: number;
  readonly fixScope: "word" | "sentence" | "paragraph" | "scene" | "chapter";
  readonly blocking: boolean;
  readonly createdAt: string;
}
```

### Task 3：Issue Normalizer——确定性归一化器（1.5d）

**新建** `packages/core/src/agents/issue-normalizer.ts`

首版只做确定性操作：

```typescript
export class IssueNormalizer {
  normalize(issues: ReadonlyArray<AuditIssue>): NormalizedIssues {
    // 1. category 标准化（同义词合并）
    // 2. 相同 source + 相同 location 的精确去重
    // 3. 近似描述聚类（Levenshtein 距离）
    // 4. severity 提升（如果同一位置连续多章出现相同问题）
    // 5. 按 fixScope 分组
    // 不执行语义冲突检测——那需要 LLM，留给 Stage 6
  }
}
```

**不检测"冲突建议"**（如"加长对话" vs "减少对话"），这需要语义理解，1.5d 无法覆盖。

### Task 4：强化 Reviser 现有 patch 模式（1d）

**不新增** `targetedRevise()`。当前 Reviser 已有 `spot-fix`、`patch-only`、`rewrite-only` 路由。

增强方向：
1. 给 `AuditIssue` 增加段落位置和 `fixScope` 后，Reviser 自动选择最小修改范围
2. 强化现有 patch 协议（只修改指定段落，保留上下文）
3. 修订后只复检被修改段落及相关硬规则
4. 检测 patch 是否越界修改（修改了非目标段落视为违规）

```typescript
// Reviser 路由增强
export function selectReviseMode(issue: AuditIssue): "spot" | "patch" | "rewrite" {
  if (issue.fixScope === "word" || issue.fixScope === "sentence") return "spot";
  if (issue.fixScope === "paragraph") return "patch";
  return "rewrite";
}
```

### Task 5：增加 `WritingConfigSchema`（0.5d）

**新建** `packages/core/src/config/writing-config.ts`

```typescript
export const WritingConfigSchema = z.object({
  reviewRetries: z.number().int().min(0).max(10).default(1),
  qualityBudget: z.enum(["economy", "normal", "premium"]).default("economy"),
  strictInterview: z.boolean().default(false),
  betaReaderMode: z.enum(["off", "shadow", "advisory", "actionable"]).default("off"),
  keySceneCandidates: z.number().int().min(1).max(3).default(1),
});

export interface QualityComponentPolicy {
  enabled: boolean;
  failureMode: "continue" | "degrade" | "block";
  sampleRate: number;           // 0-1，抽样率
  maxCallsPerChapter: number;
  maxInputTokens: number;
}
```

`qualityBudget` 属于写作管线策略，不属于模型传输参数，应放在 `WritingConfigSchema` 而非 `defaultLLMConfig`。

## Stage 3 验收标准

- [x] GenreProfile 扩展完成，不依赖关键词判断类型承诺
- [x] `AuditIssue` Schema 扩展完成，包含 location/confidence/fixScope
- [x] Issue Normalizer 可在 category + 精确 location 维度去重
- [x] Reviser 根据 fixScope 自动选择最小修改范围
- [x] 检测 patch 越界修改
- [ ] patch 越界后执行拒绝、回滚或安全降级
- [x] WritingConfigSchema 就绪并接入
- [x] advisory / repairable / blocking 策略在代码中明确

---

# Stage 4：Beta Reader 影子评测

**工作量**：3-5d（开发）+ 等待人工校准周期 | **前置条件**：Stage 3 完成

## 目标

建立证据型读者模拟器，先做影子模式收集数据，不做门禁。校准"问题定位 + 修订收益"，不只校准分数。

## 重要前提

Beta Reader 不依赖 "10 章 + 相关系数 ≥ 0.7" 作为产品化门禁。改为：

1. **至少 30 个配对样本**，推荐 50 个
2. 同时报告 Pearson、Spearman、置信区间
3. 报告"选对 A/B 优胜版本"的准确率（比分数相关性更直接）
4. 计算人类评审间一致性，避免将人类分歧误判为模型失败
5. Writer 与 Reader **使用不同模型家族**，避免自我偏好

## 任务

### Task 1：证据型读者模拟器（2d）

**修改** `packages/core/src/agents/beta-reader.ts`

```typescript
export interface ReaderObservation {
  readonly dimension: "engagement" | "clarity" | "emotion" | "character" | "expectation";
  readonly judgment: "positive" | "mixed" | "negative";
  readonly evidence: Array<{
    readonly startParagraph: number;
    readonly endParagraph: number;
    readonly reason: string;
  }>;
  readonly confidence: number;
}

export interface BetaReaderOutput {
  readonly observations: ReadonlyArray<ReaderObservation>;
  readonly modelInfo: {
    readonly provider: string;
    readonly model: string;
    readonly promptHash: string;
    readonly version: string;
  };
  // 不输出聚合分数——分数由评估层从 evidence 计算
}
```

要求每个判断绑定段落证据。没有证据的 observation 不应进入统计。

### Task 2：三步成熟度模式（0.5d）

```typescript
export type BetaReaderMode = "off" | "shadow" | "advisory" | "actionable";
```

| 模式 | 行为 | 升级条件 |
|------|------|----------|
| **off** | 不调用 | 默认 |
| **shadow** | 调用并记录，结果不显示给任何人 | 完成 Task 1 |
| **advisory** | 显示给作者，不自动修改 | A/B 选择准确率 ≥ 预设阈值 |
| **actionable** | 可触发局部修订 | 修订收益实验通过 + 连续性错误不增加 |

### Task 3：校准流程（与开发并行）

1. 用 Stage 1 校准集（≥ 30 对）运行 Beta Reader
2. 对比 Reader 选择与人类选择的 A/B 优胜版本准确率
3. 对比 Reader 定位的问题段落与人类标注的问题段落
4. 如果准确率不足：调整 prompt / 切换模型 / 不升级

**门禁不是 r ≥ 0.7，而是**：

> Beta Reader 指出的问题经过局部修订后，人类偏好显著提升，且没有增加连续性错误。

## Stage 4 验收标准

- [x] Beta Reader 输出证据型 ReaderObservation
- [ ] Writer 与 Reader 使用不同模型家族
- [x] 记录 Reader 模型、prompt hash、版本
- [ ] 校准集 ≥ 30 配对样本
- [ ] 报告 A/B 选择准确率、Pearson、Spearman、置信区间
- [ ] 默认模式为 shadow
- [x] 影子评测失败不改变最终章节

---

# Stage 5：数据驱动选择专项质量改进

**工作量**：5-10d | **前置条件**：Stage 1 基线、Stage 4 Beta Reader 数据 | **类型**：每次只选一个专项

## 目标

基于 Stage 1 基线和 Stage 4 Beta Reader 数据，选择**一个**方向投入。**禁止同时启动多个**——否则无法归因质量变化。

## 可选方向

| 方向 | 前置条件 | 参考原文档 |
|------|----------|-----------|
| **场景结构增强** | Stage 2 已接入 Manifest | Phase 2（场景化改造的子集） |
| **角色声音改善** | Stage 1 基线显示"角色"是最大痛点 | Phase 1 Character Voice + Phase 3 |
| **跨章节奏优化** | Beta Reader 数据显示"节奏"问题 | Phase 2 节奏 blueprint |
| **Narrative Director（低频）** | Stage 0-3 全部完成 | Phase 4 Director 子集 |

## 选择依据

| 条件 | 推荐专项 |
|------|----------|
| Beta Reader 数据显示"场景平铺直叙"最常见 | 场景结构增强 |
| 人类成对偏好中"角色更可信"问题最大 | 角色声音改善 |
| 数据表明"读者在过渡章流失率最高" | 跨章节奏优化 |
| 全书连续性出现系统性偏差 | Narrative Director（低频） |

## 禁止事项

- **不立即拆 Writer 场景循环**。先做场景蓝图注入（一次性生成），验证通过后再考虑逐场景拆分。
- **不新增第二套 SceneBlueprint**。在现有 `AuthorScenePlan` 上扩展（详见下方场景结构增强设计）。
- **Character Authenticity 不优先做新评分 Agent**。先做角色声音样本（正例/反例对白），验证 Writer 使用后人类能否更准确识别角色，再决定是否 Agent 化。
- **Emotional Beat Map 先作为 Scene 字段**。不需要独立跨章模型时，使用 `AuthorScenePlan.emotionArc`。

## 场景结构增强设计（如被选择）

在 `AuthorScenePlan` 上扩展，不新建平行事实源：

```typescript
// 现有接口 + 渐进扩展
interface AuthorScenePlan {
  readonly id: string;
  readonly goal: string;
  readonly location: string;
  readonly povCharacter: string;
  readonly targetEmotion?: string;
  readonly conflict?: string;
  readonly outcome?: string;
  readonly requiredBeats?: string[];
  readonly forbiddenMoves?: string[];
  readonly importance?: "bridge" | "normal" | "key";
  readonly emotionArc?: {
    readonly start?: string;
    readonly peak?: string;
    readonly end?: string;
    readonly targetReaderFeeling?: string;
  };
}

// 只有需要机器生成时，才增加：
interface PlannedScene extends AuthorScenePlan {
  readonly source: "author" | "planner";
  readonly confidence?: number;
}
```

**关键场景候选**：对 `importance: "key"` 的场景生成 2 个候选，由作者或评估器选择。比把整章拆成 5-10 次调用更有收益。

## Stage 5 验收标准

- [ ] 只进行了一个专项（不并行）
- [ ] 基于 Stage 1 基线和 Stage 4 数据的选择有书面记录
- [ ] 专项完成后运行 Stage 1 评测流程，报告配对偏好结果
- [ ] 质量提升可归因到该专项

---

# Stage 6：高成本架构（按需立项）

**工作量**：按需 | **前置条件**：Stage 1-5 数据证明收益 | **类型**：仅在数据支撑下立项

## 候选项目

| 项目 | 参考原文档 | 启动条件 |
|------|-----------|----------|
| 关键场景多候选生成 | Phase 2 场景化（子集） | Stage 5 场景结构增强收益为正 |
| 场景级 Writer（逐场景调用） | Phase 2 Writer 拆分 | Stage 5 + 成本门禁通过 |
| 混合记忆检索 | Phase 3.5（子集） | 现有 memory-db 检索不满足需求 |
| StoryIntent + Arc Planner | Phase 4（子集） | 低频 Director 收益为正 |
| 完整 Prompt Compiler（替换现有拼接） | Phase 4 Prompt Compiler | Manifest Lite 运行稳定 ≥ 2 个月 |
| Narrative Director（每章） | Phase 4 Director | 低频 Director 收益为正 |

## 拒绝启动条件

以下任一条件满足时，不启动 Stage 6 中的对应项目：

- [ ] Stage 1-5 中对应方向的实验未通过
- [ ] 成本门禁未通过（成本增加 > 3 倍）
- [ ] 无可用工程资源连续投入 ≥ 10d
- [ ] 现有能力可满足需求（基于 Stage 1 数据）

---

# 附录 A：文件变更总表

## Stage 0-5 推荐路线

| 操作 | 文件路径 | Stage |
|:----:|---------|:-----:|
| 🆕 | `packages/core/src/models/chapter-intent.schema.ts` | 0 |
| 🔧 | `packages/core/src/models/chapter-intent.ts` | 0, 5 |
| 🔧 | `packages/core/src/agents/post-write-validator.ts` | 0, 3 |
| 🔧 | `packages/core/src/state/memory-db.ts` | 0 |
| 🔧 | `packages/studio/src/pages/book-workspace/*.tsx` | 0 |
| 🆕 | `packages/core/src/evaluation/paired-preference.ts` | 1 |
| 🆕 | `scripts/preference-eval.mjs` | 1 |
| 🆕 | `scripts/evaluate-chapter.mjs` | 1 |
| 🆕 | `packages/core/src/models/prompt-manifest.ts` | 2 |
| 🆕 | `packages/core/src/utils/prompt-tracing.ts` | 2 |
| 🔧 | `packages/core/src/agents/planner.ts` | 2 |
| 🔧 | `packages/core/src/agents/writer.ts` | 2 |
| 🔧 | `packages/core/src/agents/continuity.ts` | 2 |
| 🔧 | `packages/core/src/models/genre-profile.ts` | 3 |
| 🆕 | `packages/core/src/evaluation/genre-promises.ts` | 3 |
| 🆕 | `packages/core/src/models/audit-issue.ts` | 3 |
| 🆕 | `packages/core/src/agents/issue-normalizer.ts` | 3 |
| 🆕 | `packages/core/src/utils/patch-boundary.ts` | 3 |
| 🔧 | `packages/core/src/agents/reviser.ts` | 3 |
| 🔧 | `packages/core/src/agents/beta-reader.ts` | 4 |
| 🆕 | `packages/core/src/models/beta-reader-output.ts` | 4 |
| 🔧 | `packages/core/src/pipeline/runner.ts` | 0, 3, 4 |
| 🆕 | `docs/prompt-component-guide.md` | 2 |
| 🔧 | `packages/cli/src/utils.ts` | 3 |
| 🔧 | `packages/cli/src/commands/write.ts` | 0 |
| 🔧 | `packages/cli/src/localization.ts` | 0 |

**推荐路线总计**：🆕 新增 12 个文件 + 🔧 修改 19 个文件 = **31 个文件变更**

> 注：`config/writing-config.ts` 已在清理重复时删除，功能合并到 `models/project.ts` 的 `WritingConfigSchema`。

## Stage 5 专项（根据选择追加）

| 方向 | 文件变更 |
|------|----------|
| 场景结构增强 | 🔧 `AuthorScenePlan` + 🔧 `planner-prompts.ts` + 🆕 `pacing-utils.ts` ≈ 4 文件 |
| 角色声音改善 | 🆕 `character-voice-sample.ts` + 🔧 `writer-prompts.ts` ≈ 3 文件 |
| 跨章节奏优化 | 🆕 `pacing-controller.ts` + 🔧 `planner-prompts.ts` ≈ 3 文件 |
| Narrative Director（低频） | 🆕 `narrative-director.ts` + 🆕 `story-intent.ts` + 🔧 `planner.ts` ≈ 5 文件 |

## Stage 6（按需立项）

变更范围在立项时另行评估。

---

# 附录 B：质量门禁检查清单

## 测试门禁

- [x] `pnpm typecheck` 通过
- [x] `pnpm build` 通过
- [x] `pnpm test` 通过（Core 1377/1377, Studio 277/277, CLI 175/175）
- [x] `pnpm verify:publish-manifests` 通过（本地清单检查，无需 npm token）
- [x] Schema 变更有旧数据迁移测试（`chapter-intent.test.ts` 覆盖 migration）
- [ ] Prompt 变更有 Manifest 差异记录（依赖 Stage 2 日志人工审查）
- [x] 新 LLM 组件已补充测试（7 个文件，共 48 项测试）
  - `beta-reader.test.ts`: 有效 JSON / 缺失 evidence / 格式错误 / 空内容 / confidence 钳制 / 无效维度
  - `patch-boundary.test.ts`: 边界检测 / 段落增减 / fixScope 路由 / location 转换
  - `audit-issue.test.ts`: ID 生成 / createIssue 默认值 / 阻塞策略
  - `issue-normalizer.test.ts`: 去重 / 分类归一化 / 分组排序 / 遗留 issue 兼容
  - `genre-promises.test.ts`: 时间窗口 / overduePolicy / critical 过滤
- [ ] feature flag 关闭时与关闭前行为等价（待 Stage 5 验证）
- [x] 影子评测失败不改变最终章节（Beta Reader try/catch non-blocking ✅）
- [x] 自动修订已验证 patch 越界（`checkPatchBoundary` 接入 runner.ts `reviseDraft()` ✅）

## 产品质量门禁

| 指标 | 推荐路线门禁 |
|------|-------------|
| 人类 A/B 新版胜率（下置信界） | > 50%，或达到预设最小收益 |
| 连续性 critical | 不高于基线 |
| 每章 Token | economy 不增加；normal 增量有预算 |
| P95 延迟 | 不超过配置上限 |
| 解析失败率 | < 1%，且可降级 |
| 修订越界率 | 局部修订不得修改无关段落 |

不使用"平均分提高 1 分"、"Auditor 通过率不下降"、"单个相关系数 ≥ 0.7"作为门禁。

---

# 附录 C：风险和应对

| 风险 | 概率 | 影响 | 应对 |
|------|:----:|:----:|------|
| 文档状态长期落后于代码 | 高 | 中 | Stage 0 做状态重置；后续每个 Stage 完成时更新状态表 |
| LLM 评分与人类评分不相关 | 中 | 中 | Beta Reader 仅 shadow 模式；优先规则型检查 |
| Stage 5 同时启动多个专项 | 中 | 高 | Stage 5 明确"一次只选一个"，验收标准检查 |
| 五层记忆与 memory-db 冲突 | 中 | 高 | 本版不再提"五层记忆"，改为 memory-db 增强 |
| 场景化改造 Token 成本超预期 | 中 | 高 | 成本门禁通过前不启动场景化 |
| 新建平行事实源 | 高 | 中 | 设计原则四明确禁止；Stage 0 收口时清理 |
| Genre Pact 关键词误报 | 高 | 中 | 改为有时间窗口的承诺校验，不依赖关键词 |

---

# 附录 D：配置项汇总

```typescript
// packages/core/src/config/writing-config.ts

const WritingConfigSchema = z.object({
  // 质量预算——控制新增 LLM 评估调用频率
  qualityBudget: z.enum(["economy", "normal", "premium"]).default("economy"),

  // 严格访谈模式——开启后未填写 intent 会阻塞自动写作
  strictInterview: z.boolean().default(false),

  // Beta Reader 成熟度模式
  betaReaderMode: z.enum(["off", "shadow", "advisory", "actionable"]).default("off"),

  // 关键场景候选数——仅对 importance="key" 的场景生效
  keySceneCandidates: z.number().int().min(1).max(3).default(1),

  // 审校重试次数
  reviewRetries: z.number().int().min(0).max(10).default(1),
});

interface QualityComponentPolicy {
  enabled: boolean;
  failureMode: "continue" | "degrade" | "block";
  sampleRate: number;           // 0-1，抽样率
  maxCallsPerChapter: number;
  maxInputTokens: number;
}
```

---

# 附录 E：成本跟踪模板

每个 Stage 完成后，更新以下表格：

```markdown
## Stage [N] 实际成本

| 项目 | 预算 | 实际 | 偏差 |
|------|:----:|:----:|:----:|
| 工程人日 | | | |
| 人工评测小时 | | | |
| LLM 实验费用($) | | | |
| 日历时间 | | | |

## 完成标准检查

- [ ] 测试门禁全部通过
- [ ] 产品质量门禁满足
- [ ] 组件可独立关闭 / feature flag 就绪
- [ ] 状态表已更新

## 学到的教训

1. ...
2. ...
```

---

> **第三版核心变更**：
> 1. Phase 编号制 → Stage 制，每个 Stage 独立交付
> 2. 开篇增加"当前实现状态"表，避免重复建设
> 3. 实验样本从 3-5/10 提高到 12-18/30/10，改用成对偏好替代 1-10 分
> 4. Genre Pact 从关键词检查改为有时间窗口的类型承诺
> 5. Issue Arbiter 从"冲突检测"降为"确定性归一化"
> 6. 不新增 `targetedRevise()`、`SceneBlueprint`、五层记忆
> 7. Beta Reader 改为证据型 + 三步成熟度模式
> 8. Prompt Compiler 提前到 Stage 2（Manifest Lite）
> 9. Narrative Director 改为低频（每 5 章）
> 10. qualityBudget 放入 `WritingConfigSchema`
