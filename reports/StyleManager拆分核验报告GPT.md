# StyleManager 拆分核验报告 GPT

> 日期：2026-06-16  
> 对照文件：`reports/StyleManager拆分评估方案.md`  
> 核验对象：`packages/studio/src/pages/StyleManager.tsx`、`packages/studio/src/pages/style-manager/*`、Style 相关 Studio API 与 Core style 模块。  

---

## 一、结论

当前 `StyleManager` 只完成了**部分拆分**：

```text
已拆分：AI Detect / Diagnose / Deduplicate / Distillation
未拆分：Import / Audit
StyleManager 当前规模：1892 行，43 个 useState
方案目标：约 150 行路由容器
当前完成度：约 45%-55%
```

功能验证层面，当前拆分没有造成 typecheck 或测试失败：

| 验证项 | 结果 |
|------|:---:|
| `pnpm typecheck` | ✅ 通过 |
| Studio 测试 | ✅ 25 files / 277 tests passed |
| Core 测试 | ✅ 131 files / 1400 tests passed |
| Style 相关 Core 测试 | ✅ 随 Core 全量通过 |

---

## 二、拆分状态核验

| Tab | 当前组件 | 是否独立 | 当前状态 |
|------|------|:---:|------|
| 文本导入 Import | `StyleTextTab` + `StyleManager.tsx` 内大段 File Processing / preprocess / relayout | ⚠️ 部分 | 基础导入组件已抽出，但大量状态和处理逻辑仍在父组件 |
| 文风诊断 Diagnose | `style-manager/StyleDiagnoseTab.tsx` | ✅ | 已独立，调用父组件传入的 `handleDiagnostics`，内含 StyleDriftScoreSection |
| AI 检测 AI Detect | `style-manager/StyleAiDetectTab.tsx` | ✅ | 已独立，包装 `AITellsPanel` |
| 修辞去重 Deduplicate | `style-manager/StyleDeduplicateTab.tsx` | ✅ | 已独立，内部管理 dedup/readability/rhetoric 状态 |
| 应用审计 Audit | `StyleManager.tsx` 内联 | ❌ | 作者库 CRUD、样本导入、应用到书籍、调整建议、风格对比仍在父组件 |
| 蒸馏规则 Distillation | `DistillationPage.tsx` | ✅ | 已独立，并已挂到 StyleManager 第 6 个 Tab |

---

## 三、当前 StyleManager 残留复杂度

| 指标 | 当前值 | 方案目标 | 判断 |
|------|:---:|:---:|:---:|
| 文件行数 | 1892 | ~150 | ❌ |
| `useState` 数量 | 43 | <10 | ❌ |
| Tab 数 | 6 | 6 | ✅ |
| 已独立 Tab 文件 | 3 + Distillation | 5 + Distillation | ⚠️ |
| Import 逻辑 | 父组件残留 | 独立 `StyleImportTab` | ❌ |
| Audit 逻辑 | 父组件残留 | 独立 `StyleAuditTab` | ❌ |

主要残留区：

1. `activeTab === "import"` 后仍有大段 File Processing、preprocess、relayout、export UI。
2. `activeTab === "audit"` 后仍有作者库、样本导入、reanalyze、apply、adjustment、comparison UI。
3. 父组件仍保留大量专属状态：preprocess/relayout、author CRUD、apply、file extraction 等。

---

## 四、各 Tab 功能执行状态

| Tab | 前端触发 | Studio API | Core 能力 | 测试状态 | 结论 |
|------|------|------|------|------|------|
| Import | URL/本地文件/书籍章节导入、文本分析、预处理、重排 | `/style/import-url`、`/style/extract-text`、`/style/analyze`、`/style/preprocess`、`/style/relayout` | style-analyzer、text extraction/preprocess | ✅ typecheck/test 通过 | 功能可执行，但未完成组件拆分 |
| Diagnose | 完整诊断、漂移评分 | `/style/diagnostics`、`/books/:id/chapters/:num/style-score` | style-diagnostics、style-comparator | ✅ | 已拆分且可执行 |
| AI Detect | 自动/手动 AI 痕迹检测 | `/style/ai-tells` | ai-tells detector | ✅ | 已拆分且可执行 |
| Deduplicate | 段落去重、修辞检测、可读性评分 | `/style/paragraph/dedup`、`/style/rhetoric/detect`、`/style/readability/score` | duplicate paragraph/rhetoric/readability | ✅ | 已拆分且可执行 |
| Audit | 作者库 CRUD、样本导入、应用作者风格、调整建议、风格对比 | `/style/authors*`、`/books/:id/style/apply-author`、`/style/adjustments/plan`、`/style/adjustments/preview`、`/style/compare` | style-library、style-adjuster、style-comparator | ✅ | 功能可执行，但未完成组件拆分 |
| Distillation | 蒸馏规则查看 | `/style/authors/:authorId/distillations/current` | style distillation store | ✅ | 已独立，入口已接 |

---

## 五、测试结果

本轮执行：

```bash
pnpm --filter @actalk/inkos-studio test -- style-manager style-preprocess style-adjustment
pnpm --filter @actalk/inkos-core test -- style-analyzer style-diagnostics style-comparator style-rewriter style-adjuster style-library-store
pnpm typecheck
```

结果：

```text
Studio: 25 test files / 277 tests passed
Core:   131 test files / 1400 tests passed
Typecheck: Core / Studio / CLI passed
```

说明：Vitest 参数在当前脚本下实际触发了整包测试，而不是只跑命名子集；这提高了回归覆盖度。

---

## 六、风险与问题

### P1：拆分目标未完成

方案目标是 `StyleManager.tsx ~150 行`，当前仍有 1892 行。Import 和 Audit 是主要阻塞。

### P1：Import Tab 仍然高度耦合父组件

`StyleTextTab` 只是导入表单层，文件提取、预处理、重排、导出、风险确认等逻辑仍在 `StyleManager.tsx`。这使 Import 后续改动仍会污染父组件。

### P1：Audit Tab 未拆

作者库 CRUD、样本导入、reanalyze、应用到书籍、AdjustmentSuggestionsPanel、AuthorStyleComparison 全部仍在父组件内。Audit 是当前最大残留块。

### P2：已拆 Tab 仍依赖父级共享状态

`StyleDiagnoseTab` 仍依赖父组件传入 `profile/diagnostics/handleDiagnostics/renderProfileCard`。这不是 bug，但说明它还不是完全自治 Tab。

### P2：缺少组件级交互测试

现有测试覆盖状态函数、API、Core 逻辑，但没有直接 render `StyleManager` 并点击 6 个 Tab 的组件测试。当前只能通过 typecheck + API/Core 测试证明没有静态/逻辑回归。

---

## 七、建议下一步

### Step 1：先拆 Audit

优先级高于 Import。Audit 逻辑边界更清晰，迁移风险低：

```text
StyleAuditTab.tsx
  - activeAuditSection
  - author CRUD state
  - selectedAuthorId / authorDetail
  - applyAuthorId / applyBookId
  - AdjustmentSuggestionsPanel
  - AuthorStyleComparison
```

拆完后 `StyleManager.tsx` 可减少约 350-450 行。

### Step 2：再拆 Import

Import 复杂度最高，建议一次迁移整个 File Processing 区块，而不是只拆 `StyleTextTab`：

```text
StyleImportTab.tsx
  - StyleTextTab
  - local/url/book import
  - file extraction
  - preprocess panel
  - relayout panel
  - export
  - risk confirmation modal
```

拆完后 `StyleManager.tsx` 才能真正降到路由容器级别。

### Step 3：补 Tab 级 smoke test

建议新增一个轻量测试：

```text
StyleManager renders six tabs:
  import / diagnose / ai-detect / deduplicate / audit / distillation
点击每个 tab 不抛错，并出现对应标题或关键按钮
```

这类测试能防止后续拆分时把 Tab 入口或 props 传递打断。

---

## 八、最终判定

`StyleManager` 当前功能执行状态是可用的，Core 与 Studio 测试均通过；但组件拆分没有达到方案目标。当前最准确的状态是：

```text
功能层：可运行
测试层：通过
拆分层：半完成
剩余关键工作：StyleAuditTab + StyleImportTab
```

不建议继续在 `StyleManager.tsx` 内增加新功能。后续所有新增文风工作台能力，应先完成 Import/Audit 拆分，或直接落在独立 Tab 组件中。
