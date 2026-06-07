# NoFusion 0607 推进建议与执行方案

> 评估日期：2026-06-07  
> 评估依据：`文风分析调整方案.md` 要求与当前代码实现状态的逐项对照  
> 目标：以最少新增代码、最大复用现有能力的方式，补全"诊断→对比→计划→预览→调整"闭环的剩余能力  
> 原则：不重写、不拆现有页面、每批交付可独立使用

---

## 一、当前完成状态

### 已实现（阶段一完成，无需重复投入）

```
Core agents/
├── style-analyzer.ts        (原有)
├── style-fingerprint.ts     (原有)
├── ai-tells.ts              (原有)
├── post-write-validator.ts  (原有)
├── style-diagnostics.ts     ✅ 完成 — 6 个导出函数，33 项测试通过
│   ├── detectIntentRepetition()
│   ├── detectRepeatedDescriptions()
│   ├── detectTransitionClustering()
│   ├── detectClauseComplexity()
│   ├── summarizeAIStyleTags()
│   └── runFullDiagnostics()

API endpoints/
├── POST /style/diagnostics  ✅ 完成 — 调用 runFullDiagnostics()

Frontend components/
├── StyleDiagnosticsPanel    ✅ 完成 — 含 AI 风险仪表盘/意图重复/描写重复/转折/从句面板
├── StyleManager.tsx         ✅ 完成 — handleDiagnostics + diagnostics state 已接入
```

### 未实现（需要推进的部分）

```
Core agents/                  依赖关系      预估行数
├── style-comparator.ts      无外部依赖      ~180 行
├── style-adjuster.ts        依赖 diagnostics + comparator  ~200 行
├── style-rewriter.ts        依赖 LLM client + diagnostics  ~220 行

API endpoints/
├── POST /style/compare                       ~30 行
├── POST /style/adjustments/plan              ~40 行
├── POST /style/adjustments/preview           ~60 行

Frontend/
├── pages/style-manager/ 组件目录             需新建
├── AuthorStyleComparison.tsx                  ~180 行
├── AdjustmentSuggestionsPanel.tsx             ~250 行
├── AdjustmentDiffPreview.tsx                  ~150 行
├── style-adjustment-state.ts                  ~80 行

Infrastructure/
├── style-schemas.ts 扩展                      ~40 行
├── i18n keys 新增                             ~50-70 条
├── test fixtures                              ~150 行
```

---

## 二、复用策略：不重复造轮子的原则

在开始分批实施前，明确以下四条复用原则，避免不必要的新增代码：

### 原则 1：诊断结果直接喂给调整计划生成器

`style-adjuster.ts` 不自己调用诊断函数，而是接收 `runFullDiagnostics()` 的输出作为输入。这意味着：

- 诊断和调整计划之间是**纯数据管道**
- 诊断函数的改进（添加新检测维度）**自动增强**调整计划
- 不需要在 adjuster 中重复写正则或模式匹配

```typescript
// 正确做法：接收诊断结果
export function generateAdjustmentPlan(
  diagnostics: FullStyleDiagnostics,  // 复用已有诊断
  options?: { targetAuthorProfile?: AuthorStyleProfile },
): AdjustmentPlan { /* ... */ }
```

### 原则 2：对比函数直接复用现有分析工具

`style-comparator.ts` 不自己实现句法分析、指纹提取等，而是调用已导出的：

- `analyzeStyle()` — 句长/段落/TTR/句首/修辞
- `analyzeStyleFingerprint()` — 对话/动作/心理/感官/标点
- `getAuthorProfile()` — 从 style-library 加载目标档案

contrast 函数的职责是**比较两个已有的 Profile**，而不是重新分析文本。

### 原则 3：LLM 预览复用现有 chatCompletion

`style-rewriter.ts` 不创建 LLM 连接，不管理 API key，而是：

- 接收注入的 `LLMClient`（来自 Core 导出）
- 使用 `chatCompletion()` 发送请求
- 复用 `runFullDiagnostics()` 做调整前后的对比验证
- Token 统计复用 `LLMResponse.usage`

### 原则 4：前端组件读取 Core 类型，不重复声明

所有前端组件通过 `import type { ... } from "@actalk/inkos-core"` 获取类型，不在组件文件中重复定义接口。API 响应类型通过 `style-schemas.ts` 的 Zod schema 推导。

---

## 三、分批执行方案

### 第一批：Core 对比 + 调整计划（无 LLM，纯函数）

**目标**：让"诊断→对比→计划"的后端链路跑通，前端可展示作家差异和调整建议列表。  
**预估代码量**：~380 行 Core 代码 + ~70 行 API 代码  
**预估工时**：1.5 天  
**不依赖**：LLM 配置、作家档案内容质量

#### 步骤 1.1：`style-comparator.ts`（~180 行）

**复用清单**：
| 需要的能力 | 来源 | 复用方式 |
|------------|------|----------|
| 文本分析 | `analyzeStyle()` | 直接调用 |
| 指纹提取 | `analyzeStyleFingerprint()` | 直接调用 |
| 目标档案 | `getAuthorProfile()` | 传入参数 |
| 样本充分度 | `diagnostics.sampleAdequacy` | 复用已有分级 |

**核心逻辑**（不重复计算，只做对比）：

```typescript
export function compareWithAuthorProfile(
  text: string,
  authorProfile: AuthorStyleProfile,
): StyleComparisonResult {
  // 1. 调用现有分析工具
  const currentProfile = analyzeStyle(text);
  const currentFingerprint = analyzeStyleFingerprint(text);

  // 2. 从 authorProfile.aggregateProfile 中提取目标值
  //    只比较 8 个核心统计指标：句长均值/标准差、对话比、动作密度、心理比、感官密度、TTR、标点节奏
  //    避免一次性对比 20+ 指标造成噪音

  // 3. 每个指标使用容差区间归一化
  //    目标值 = 0 时跳过（不计算百分比偏差）
  //    返回 normalizedDeviation [-1, 1]

  // 4. 根据 authorProfile.sampleStats 设置 sampleAdequacy

  // 5. overallMatchScore = 加权平均（指标越多权重越低，仅 8 项时不加权）
}
```

**文件清单**：
- `packages/core/src/agents/style-comparator.ts` — **新建**
- `packages/core/src/index.ts` — 新增 1 行导出
- `packages/core/src/__tests__/style-comparator.test.ts` — **新建**（~80 行）

#### 步骤 1.2：`style-adjuster.ts`（~200 行）

**复用清单**：
| 需要的能力 | 来源 | 复用方式 |
|------------|------|----------|
| 诊断结果 | `runFullDiagnostics()` 输出 | 参数传入 |
| 对比结果 | `compareWithAuthorProfile()` 输出 | 参数传入 |
| 位置信息 | diagnostics 中各 finding 的 `start/end` | 直接复用 |
| sourceHash | 已有 `diagnostics.sourceHash` | 透传到 plan |

**核心逻辑**（将诊断发现转为可执行建议）：

```typescript
export function generateAdjustmentPlan(
  diagnostics: FullStyleDiagnostics,
  options?: {
    targetAuthorProfile?: AuthorStyleProfile;
    comparison?: StyleComparisonResult;
    maxSuggestions?: number;
  },
): AdjustmentPlan {
  const suggestions: AdjustmentSuggestion[] = [];

  // 1. 遍历 intentRepetitions → 生成"合并重复动作"建议
  //    severity=high 且 kind=action-expression → 可自动应用 patch
  //    severity=high 且 kind=semantic-intent → 只 instruction，不提供 patch

  // 2. 遍历 transitionClustering → 生成"减少非必要转折词"建议
  //    consecutiveTransitions >= 3 → 可自动删除第二个转折词

  // 3. 遍历 clauseComplexity → 生成"拆分长句"建议（instruction 模式，不自动）

  // 4. 遍历 repeatedDescriptions → 生成"合并重复信息"建议

  // 5. 如果有 comparison → 生成"调整 XX 指标趋近目标"建议
  //    normalizedDeviation > 0.3 时输出

  // 6. 排序：critical > warning > info，同 severity 按置信度降序
  // 7. 截取 maxSuggestions（默认 15）
  // 8. 每个 suggestion.id = `${ruleVersion}/${category}/${position}/hash(${evidence})`
}
```

**确定性补丁的生成规则**（只处理明确可替换的场景）：

| 场景 | 原文匹配 | 替换为 |
|------|----------|--------|
| 连续"然而"在段落开头 | `然而`（段落首词） | 删除 |
| "他转过身""他回头"连续出现 | 第二个匹配的完整句 | 删除或合并 |
| 全场震惊模式 | 匹配的正则整句 | 删除 |
| 报告术语 | 匹配的术语词 | 替换为叙事语言 |

**不自动处理的场景**（留给 LLM 预览或人工）：
- 拆分长句（改变句子结构 → 需要语言生成能力）
- 调整对话占比/动作密度（需要重写段落 → LLM 预览）
- 外貌/环境重复描述（需要词汇多样性 → LLM 预览）

**文件清单**：
- `packages/core/src/agents/style-adjuster.ts` — **新建**
- `packages/core/src/index.ts` — 新增 1 行导出
- `packages/core/src/__tests__/style-adjuster.test.ts` — **新建**（~80 行）

#### 步骤 1.3：API 端点（~70 行）

**复用清单**：
| 需要的能力 | 来源 | 复用方式 |
|------------|------|----------|
| 文本校验 | `style-schemas.ts` 已有 `z.string().max()` | 复用模式 |
| 档案加载 | `getAuthorProfile()` | 直接调用 |
| 错误结构 | `errors.ts` 已有错误格式 | 复用 |

```typescript
// 两个端点，复用现有 server.ts 模式

// 端点 1：POST /style/compare
// 请求：{ text, targetAuthorId, language }
// 实现：校验 → getAuthorProfile → compareWithAuthorProfile → 返回
// 特殊处理：档案不存在 404，语言不匹配 400，样本不足时 response 中标记

// 端点 2：POST /style/adjustments/plan
// 请求：{ text, targetAuthorId?, maxSuggestions? }
// 实现：runFullDiagnostics → (可选用档) getAuthorProfile + compare → generateAdjustmentPlan → 返回
// 特殊处理：档案版本写入 plan 供后续校验
```

**文件清单**：
- `packages/studio/src/api/server.ts` — 新增 2 个端点（在 `/style/diagnostics` 附近）
- `packages/studio/src/api/style-schemas.ts` — 新增 2 个 Zod schema

#### 第一批验收标准

```
1. Core typecheck 通过
2. 所有测试通过（诊断 33 项 + 新增对比 ~8 项 + 调整计划 ~8 项 = ~49 项）
3. 同一文本、同一档案的对比结果可复现
4. 调整计划的 suggestion.id 根据文本内容稳定生成
5. 确定性 patch 的 expectedText 精确匹配时可用，不匹配时标记过期
```

---

### 第二批：API 校验 + 前端对比和调整面板（无 LLM）

**目标**：让用户在 StyleManager 中能看到作家档案对比和调整建议列表，可应用确定性补丁。  
**预估代码量**：~500 行前端组件 + ~40 行 API schema  
**预估工时**：2 天  
**不依赖**：LLM 配置

#### 步骤 2.1：扩展 style-schemas.ts（~40 行）

```typescript
export const DiagnosticsRequestSchema = z.object({
  text: z.string().min(1).max(MAX_PREPROCESS_TEXT_CHARS),
  language: z.enum(["zh", "en"]).optional(),
}).strict();

export const CompareRequestSchema = z.object({
  text: z.string().min(1).max(MAX_PREPROCESS_TEXT_CHARS),
  targetAuthorId: z.string().min(1).max(128),
  language: z.enum(["zh", "en"]).optional(),
}).strict();

export const AdjustmentPlanRequestSchema = z.object({
  text: z.string().min(1).max(MAX_PREPROCESS_TEXT_CHARS),
  targetAuthorId: z.string().max(128).optional(),
  maxSuggestions: z.number().int().min(1).max(50).optional(),
}).strict();
```

**复用策略**：`MAX_PREPROCESS_TEXT_CHARS` 已有定义，`z.string().max()` 复用同一上限。

#### 步骤 2.2：`AuthorStyleComparison.tsx`（~180 行）

**功能**：作家选择下拉 + 档案可信度提示 + 8 项指标对比表格。

**复用清单**：
| 需要的能力 | 来源 | 复用方式 |
|------------|------|----------|
| 作家列表 | 已有 `/style/authors` API | 复用 `useApi` |
| 对比 API | 第一步新增的 `/style/compare` | 调用 |
| UI 组件模式 | `StyleDiagnosticsPanel` 中的表格/卡片 | 复用布局模式 |

```typescript
// 组件结构（极简，不引入图表库）：
// 1. 作家选择器（复用现有 /style/authors 数据）
// 2. 档案样本充分度指示器（来自 comparison.sampleAdequacy）
// 3. 指标对比列表（每行：指标名 | 当前值 | 目标值 | 偏差指示条）
//    不使用雷达图——第一批用纯文字列表，减少图表依赖
// 4. "以此为目标生成调整建议"按钮（触发 /adjustments/plan）
```

**不做的**：雷达图（依赖图表库，第二批可追加）、颜色阈值（当前用文字 severity）。

#### 步骤 2.3：`AdjustmentSuggestionsPanel.tsx`（~250 行）

**功能**：在文本样本下方显示调整建议列表，支持分类筛选和确定性补丁应用。

**复用清单**：
| 需要的能力 | 来源 | 复用方式 |
|------------|------|----------|
| 建议数据 | `/style/adjustments/plan` API | 调用 |
| 分类标签 | diagnostics panel 的 severityBadge | 复用 |
| 可折叠面板 | diagnostics panel 的 ChevronDown/Up | 复用模式 |
| 文本状态 | StyleManager 的 `text` state | props 传入 |
| API 调用 | `fetchJson()` | 复用 |

```typescript
// 组件结构：
// 1. 目标作家选择器（复用现有 /style/authors）
// 2. "生成调整计划"按钮
// 3. 计划状态提示（来源 hash / 档案版本 / 是否过期）
// 4. 分类筛选标签（全部 / 意图重复 / 描写重复 / 转折 / 句式 / AI）
// 5. 建议卡片列表（每张卡片：severity 色标 + 类别 + 原文摘录 + 建议说明）
//    卡片底部：确定性补丁显示"应用"按钮 + 预期修改文本
//                LLM 建议显示"需预览调整"文本（灰色禁用）
// 6. 应用补丁后更新文本 → 自动标记计划过期 → 提示用户重新生成诊断
```

**撤销实现**：每次应用补丁前将当前 `text` 压入撤销栈（最多 20 步），`style-adjustment-state.ts` 管理此状态。

#### 步骤 2.4：`style-adjustment-state.ts`（~80 行）

```typescript
// 管理：loading / error / stale / plan / comparison / undoStack
// 不与 StyleManager 的现有 state 合并，保持独立

export interface AdjustmentState {
  readonly plan: AdjustmentPlan | null;
  readonly comparison: StyleComparisonResult | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly stale: boolean;        // 文本或档案版本变化后置为 true
  readonly undoStack: ReadonlyArray<{
    readonly text: string;
    readonly timestamp: number;
  }>;
}
```

#### 2.5：StyleManager.tsx 集成（~20 行）

在文本样本区域下方（分析按钮之后）插入：

```typescript
{/* 调整建议模块 */}
<AdjustmentSuggestionsPanel
  text={text}
  onTextChange={setText}
  authors={authors}
  diagnostics={diagnostics}
  nav={nav}
  t={t}
/>
```

在右侧分析标签区增加"作家对比"子标签：

```typescript
// 在现有基础分析 + 高级诊断标签基础上
// 当 diagnostics 存在时显示第三个标签
{tabs.map(tab => (
  <button key={tab.id} onClick={() => setActiveTab(tab.id)}>
    {tab.label}
  </button>
))}
// 标签列表根据是否有 diagnostics 动态调整
```

#### 第二批验收标准

```
1. 前端 typecheck 通过
2. 可选择作家并查看指标对比（纯文字，不需要雷达图）
3. 可生成调整建议列表，按 severity 排序
4. 确定性补丁可逐条应用，应用后文本更新
5. 应用补丁后 plan 标记过期，提示重新生成
6. 撤销栈正常工作（至少 5 步可回退）
7. 作家档案不足时给出提示，不妨碍查看对比
```

---

### 第三批：LLM 改写预览（依赖模型配置）

**目标**：实现"根据作家档案和调整计划预览改写"的核心功能。  
**预估代码量**：~220 行 Core + ~60 行 API  
**预估工时**：1.5 天  
**依赖**：LLM 配置就绪（已有 `chatCompletion` 和 `createLLMClient`）

#### 步骤 3.1：`style-rewriter.ts`（~220 行）

**复用清单**：
| 需要的能力 | 来源 | 复用方式 |
|------------|------|----------|
| LLM 调用 | `chatCompletion()` | 直接调用 |
| 温度配置 | `LLMClient` | 参数注入 |
| 调整前后诊断 | `runFullDiagnostics()` | 直接调用 |
| 作家档案 | `getAuthorProfile()` | 调用 |
| 调整计划 | `AdjustmentPlan` | 参数传入 |

```typescript
export async function rewriteWithAuthorProfile(
  request: StyleRewriteRequest,
  ctx: { client: LLMClient; model: string },
): Promise<StyleRewritePreview> {
  // 1. 校验 text 长度 <= 20,000
  // 2. 校验 sourceHash 与 text 一致
  // 3. 运行调整前诊断
  const beforeDiagnostics = runFullDiagnostics(request.text);

  // 4. 构建系统提示（只使用聚合统计和高层风格特征，不拼接原始样文）
  const systemPrompt = buildRewriteSystemPrompt(request.authorProfile, request.plan);

  // 5. 构建用户提示（原文 + selectedSuggestionIds 对应的 instruction 列表）
  const userPrompt = buildRewriteUserPrompt(request.text, request.plan, request.selectedSuggestionIds);

  // 6. 调用 LLM
  const response = await chatCompletion(ctx.client, ctx.model, [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ], { temperature: 0.3 });

  // 7. 解析响应 → 提取 adjustedText
  // 8. 运行调整后诊断
  const afterDiagnostics = runFullDiagnostics(adjustedText);

  // 9. 计算 diff（逐字符对比 → 提取 changedRanges）
  // 10. 返回预览结果（不保存）
  return {
    sourceHash: request.sourceHash,
    authorProfileVersion: request.authorProfile.version,
    adjustedText,
    changedRanges,
    beforeDiagnostics,
    afterDiagnostics,
    warnings,
    usage: response.usage,
  };
}
```

**系统提示模板**（不包含原始样文，只包含统计指标和风格标签）：

```
你是一位文学风格调整助手。你的任务是修改用户提供的文本，使其风格更接近目标作家特征。
修改时必须遵守以下约束：
1. 不改变人物、事实、时间顺序、视角
2. 不新增剧情事件或角色
3. 不改变对话的含义和语气强度
4. 只处理用户指定的修改类别

目标作家风格特征：
- 平均句长：{targetAvgSentenceLength}（当前：{currentAvgSentenceLength}）
- 对话占比：{targetDialogueRatio}（当前：{currentDialogueRatio}）
- 动作密度：{targetActionDensity}（当前：{currentActionDensity}）
- 风格标签：{tags}
```

#### 步骤 3.2：`POST /style/adjustments/preview` API（~60 行）

```typescript
// 请求：{ text, sourceHash, targetAuthorId, authorProfileVersion, selectedSuggestionIds }
// 实现：
//   1. 校验 text <= 20,000
//   2. 校验 sourceHash
//   3. 加载档案，校验 version
//   4. 生成调整计划（复用 plan 逻辑）
//   5. 调用 rewriteWithAuthorProfile()
//   6. 返回预览结果
//
// 特殊处理：
//   sourceHash 不匹配 → 409
//   档案 version 变化 → 409
//   LLM 不可用 → 503
//   超时或解析失败 → 422 + 部分结果
```

#### 步骤 3.3：`AdjustmentDiffPreview.tsx`（~150 行）

**功能**：显示改写前后的 diff 和诊断对比，支持接受/放弃。

```typescript
// 组件结构：
// 1. 左侧原文 / 右侧改写后的文本（并排，不可编辑）
// 2. 诊断指标对比（调整前 vs 调整后，绿色箭头表示改善，红色表示恶化）
// 3. "接受调整"按钮 → 更新 text，写入撤销栈，关闭预览
// 4. "放弃预览"按钮 → 关闭预览，不修改 text
// 5. Token 消耗提示
```

#### 第三批验收标准

```
1. 选择作家 + 选择建议 → 点击"预览调整" → 显示 diff
2. 接受调整后 text 更新，诊断自动重新运行
3. 放弃预览后 text 不变
4. 文本发生变化后旧预览不可用（sourceHash 校验）
5. LLM 不可用时，预览按钮禁用并有提示
6. 超过 20,000 字符时提示"请选段"
```

---

## 四、整体推进时间线

```
第一批（1.5 天）
├── style-comparator.ts        ~180 行
├── style-adjuster.ts          ~200 行
├── index.ts 导出              2 行
├── API: compare + plan        ~70 行
├── 测试                        ~160 行
└── typecheck 通过

第二批（2 天）
├── style-schemas.ts 扩展      ~40 行
├── AuthorStyleComparison.tsx  ~180 行
├── AdjustmentSuggestionsPanel.tsx ~250 行
├── style-adjustment-state.ts  ~80 行
├── StyleManager.tsx 集成      ~20 行
├── i18n key                   ~30 条
└── typecheck 通过

第三批（1.5 天）
├── style-rewriter.ts          ~220 行
├── API: preview               ~60 行
├── AdjustmentDiffPreview.tsx  ~150 行
├── 测试                        ~100 行
└── typecheck + 集成测试 通过
─────────────────────────────────
总计：~5 天，约 1600 行新增代码
```

### 依赖关系

```
第一批 ─── 第二批 ─── 第三批
  (Core)      (前端)     (LLM)

第一批无阻塞，可立即开始。
第二批依赖第一批的 API 契约（请求/响应类型）。
第三批依赖 LLM 配置就绪（现有）。
```

### 可独立交付的边界

| 批次 | 可独立交付条件 | 即使下一批不做也不影响 |
|------|---------------|----------------------|
| 第一批 | Core typecheck + 测试通过 | 诊断面板已有 UI，对比和计划后续接入 |
| 第二批 | 前端 typecheck 通过 | LLM 预览不可用时，规则建议和工作流仍完整 |
| 第三批 | 端到端通过 | 规则功能可独立降级，预览不可用时不影响诊断和对比 |

---

## 五、工作量精算

### 新增代码行数明细

```
第一批
├── style-comparator.ts         ~180 行（含类型定义 + 对比逻辑 + 匹配度计算）
├── style-adjuster.ts           ~200 行（含类型定义 + 建议生成 + 确定性补丁）
├── style-comparator.test.ts    ~80 行
├── style-adjuster.test.ts      ~80 行
├── API server.ts (2 个端点)    ~70 行
├── style-schemas.ts (2 schema) ~20 行
├── index.ts (2 行导出)          ~2 行
└── 小计                         ~632 行

第二批
├── AuthorStyleComparison.tsx   ~180 行
├── AdjustmentSuggestionsPanel.tsx ~250 行
├── style-adjustment-state.ts   ~80 行
├── StyleManager.tsx 修改        ~20 行
├── style-schemas.ts (扩展)      ~20 行
├── i18n (30 条 key)            ~30 条
└── 小计                         ~580 行 + 30 条 key

第三批
├── style-rewriter.ts           ~220 行
├── style-rewriter.test.ts      ~60 行
├── AdjustmentDiffPreview.tsx   ~150 行
├── API server.ts (1 个端点)    ~60 行
├── style-schemas.ts (1 schema) ~10 行
└── 小计                         ~500 行

总计：约 1700 行新代码 + 30 条 i18n key
```

### 复用代码行数（未重复制造的部分）

| 模块 | 如果不复用需要自行实现的行数 | 通过复用节省的行数 |
|------|:---------------------------:|:-----------------:|
| style-comparator 中的文本分析 | ~250 行（句法/指纹/检测） | ~250 行 |
| style-adjuster 中的诊断逻辑 | ~400 行（重复 style-diagnostics） | ~400 行 |
| style-rewriter 中的 LLM 连接 | ~80 行（API key/错误重试） | ~80 行 |
| 前端 API 调用 | ~50 行（fetch/error 处理） | ~50 行 |
| **复用总计** | | **~780 行** |

---

## 六、风险清单

| 风险 | 批次 | 概率 | 影响 | 应对 |
|:----|:----:|:----:|:----:|------|
| 对比指标过多导致噪音 | 1 | 中 | 低 | 首版只对比 8 个核心指标，不一次性对比 20+ |
| 确定性补丁误删内容 | 1 | 低 | 中 | `expectedText` 精确匹配 + 撤销栈保护 |
| 作家档案样本不足 | 2 | 中 | 低 | `sampleAdequacy` 分级提示，不禁用查看 |
| LLM 改写改变事实 | 3 | 中 | 高 | 保真提示词 + 低温度(0.3) + diff 展示 + 人工确认 |
| LLM 超时或不可用 | 3 | 低 | 中 | 规则功能独立降级，预览按钮禁用并提示 |
| 前端面板过多 | 2 | 低 | 低 | 保持顶层 tab 不变，高级面板默认折叠 |
| textarea 无法高亮 | 2 | 低 | 低 | 首版用"证据卡片 + 位置标注"，不承诺行内高亮 |
