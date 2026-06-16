# StyleManager 拆分评估与执行方案

> 日期：2026-06-16
> 当前状态：~2190 行，6 个 Tab，45 个 useState，15 个 handler 函数
> 目标：拆分为 1 个路由容器 + 5 个独立 Tab 组件（第 6 个蒸馏 Tab 已独立）

---

## 一、当前状态诊断

### 1.1 规模度量

| 指标 | 数值 | 健康阈值 | 判定 |
|------|:----:|:--------:|:----:|
| 总行数 | ~2190 | <300 | ❌ 超标 7x |
| useState 调用 | 45 | <10 | ❌ 超标 4.5x |
| useRef 调用 | 3 | <3 | ✅ |
| useMemo/useCallback | 3 | — | ✅ |
| handler 函数 | 15 | <5 | ❌ 超标 3x |
| 条件渲染分支 | 6 Tab × 多子分支 | — | ⚠️ 复杂 |
| 已提取子组件 | 9 个 | — | ✅ 部分解耦 |

### 1.2 状态归属分析

```
共享状态（跨 Tab 使用）:
  text, sourceName           → Import/Diagnose/Dedup 共用
  libraryData, booksData     → Audit/Import 共用
  activeTab                  → 路由

Tab 专属状态（仅单 Tab 使用）:
  Import:   20 个 state（preprocess/relayout/export/file/extraction）
  Diagnose: 2 个 state（diagnostics, loadingDiagnostics）
  AI Detect: 0 个 state（完全由 AITellsPanel 自管理）
  Dedup:    5 个 state（dedupData, ignoredRhetoricIds, fixedRhetoricIds...）
  Audit:    14 个 state（author library CRUD + apply）
  Distillation: 0 个 state（DistillationPage 自管理）
```

### 1.3 已提取子组件（✅ 可直接复用）

| 子组件 | 用途 | Tab |
|--------|------|:---:|
| `StyleTextTab` | 文本导入/粘贴界面 | Import |
| `StyleDiagnosticsPanel` | 文风诊断图表 | Diagnose |
| `ReadabilityDashboard` | 可读性评分 | Diagnose |
| `AITellsPanel` | AI 特征检测 | AI Detect |
| `DuplicateParagraphPanel` | 段落去重 | Dedup |
| `RhetoricIssuePanel` | 修辞问题面板 | Dedup |
| `AdjustmentSuggestionsPanel` | 调整建议 | Audit |
| `AuthorStyleComparison` | 作者风格对比 | Audit |
| `DistillationPage` | 蒸馏规则 | Distillation |

---

## 二、拆分策略

### 2.1 原则

```
原则 A（单向数据流）：共享状态留在父组件，Tab 专属状态下沉
原则 B（零破坏）：先拆分、不重构 — 原逻辑原样迁移，不改变行为
原则 C（渐进式）：一次拆一个 Tab，拆完验证 typecheck + test
原则 D（props 契约）：每个 Tab 组件的 props 显式声明所需数据
```

### 2.2 目标架构

```
StyleManager.tsx (~150 行)
  ├── 共享状态: text, sourceName, libraryData, booksData, activeTab
  ├── Tab 导航栏（6 个按钮）
  └── 条件渲染:
      ├── activeTab="import"       → <StyleImportTab {...shared} />
      ├── activeTab="diagnose"     → <StyleDiagnoseTab {...shared} />
      ├── activeTab="ai-detect"    → <StyleAiDetectTab />
      ├── activeTab="deduplicate"  → <StyleDeduplicateTab {...shared} />
      ├── activeTab="audit"        → <StyleAuditTab {...shared} />
      └── activeTab="distillation" → <DistillationPage />  (已独立)

StyleImportTab.tsx (~400 行)
  ├── 状态: preprocess/relayout/export/file/extraction (~20 state)
  ├── 子组件: StyleTextTab
  └── 处理: 文件导入、URL 导入、书籍章节导入、分析、导出

StyleDiagnoseTab.tsx (~120 行)
  ├── 状态: diagnostics, loadingDiagnostics
  ├── 子组件: StyleDiagnosticsPanel, ReadabilityDashboard
  └── 处理: 文风诊断触发

StyleAiDetectTab.tsx (~80 行)
  └── 子组件: AITellsPanel（自管理，无需额外状态）

StyleDeduplicateTab.tsx (~200 行)
  ├── 状态: dedupData, ignoredRhetoricIds, fixedRhetoricIds
  ├── 子组件: DuplicateParagraphPanel, RhetoricIssuePanel
  └── 处理: 去重检测触发

StyleAuditTab.tsx (~550 行)
  ├── 状态: author CRUD, apply (~14 state)
  ├── 子组件: AdjustmentSuggestionsPanel, AuthorStyleComparison
  └── 处理: 作者库管理、应用到书籍
```

### 2.3 Props 契约

```typescript
// 共享 Props（所有 Tab 可能用到）
interface StyleTabSharedProps {
  readonly text: string;
  readonly setText: (v: string) => void;
  readonly sourceName: string;
  readonly setSourceName: (v: string) => void;
  readonly theme: Theme;
  readonly t: TFunction;
  readonly nav: Nav;
}

// Import Tab 专属（需要额外的共享数据）
interface StyleImportTabProps extends StyleTabSharedProps {
  readonly booksData: { books: ReadonlyArray<BookSummary> } | undefined;
}

// Audit Tab 专属
interface StyleAuditTabProps extends StyleTabSharedProps {
  readonly libraryData: { authors: ReadonlyArray<AuthorIndexItem> } | undefined;
  readonly refetchLibrary: () => void;
  readonly booksData: { books: ReadonlyArray<BookSummary> } | undefined;
}
```

---

## 三、执行清单

### Phase 1：StyleAiDetectTab（最简单，验证模式）

| 步骤 | 操作 | 预计 |
|:----:|------|:----:|
| 1.1 | 新建 `StyleAiDetectTab.tsx`，从 StyleManager 搬移 AI Detect 渲染分支 | 10min |
| 1.2 | StyleManager 中替换为 `<StyleAiDetectTab />` | 2min |
| 1.3 | `pnpm typecheck` + `pnpm --filter @actalk/inkos-studio test` | 2min |

### Phase 2：StyleDiagnoseTab

| 步骤 | 操作 | 预计 |
|:----:|------|:----:|
| 2.1 | 新建 `StyleDiagnoseTab.tsx`，搬移 diagnostics/loadingDiagnostics 状态 + Diagnose 渲染分支 | 15min |
| 2.2 | StyleManager 中替换，移除迁移的状态声明 | 5min |
| 2.3 | 验证 typecheck + test | 2min |

### Phase 3：StyleDeduplicateTab

| 步骤 | 操作 | 预计 |
|:----:|------|:----:|
| 3.1 | 新建 `StyleDeduplicateTab.tsx`，搬移 dedupData/handleFetchDedupData 等 | 20min |
| 3.2 | 需要 props: text, sourceName, theme, t, nav | 5min |
| 3.3 | 验证 | 2min |

### Phase 4：StyleImportTab（最大，最复杂）

| 步骤 | 操作 | 预计 |
|:----:|------|:----:|
| 4.1 | 新建 `StyleImportTab.tsx`，搬移 ~20 个 preprocess/relayout 状态 | 30min |
| 4.2 | 搬移所有 handler 函数（handleTextLocalFile, handleAnalyze, runPreprocess 等） | 20min |
| 4.3 | 搬移 Import 渲染分支（含 StyleTextTab） | 20min |
| 4.4 | StyleManager 中替换，移除迁移的状态和 handler | 10min |
| 4.5 | 需要 props: text, setText, sourceName, setSourceName, booksData, theme, t, nav | 5min |
| 4.6 | 验证 | 3min |

### Phase 5：StyleAuditTab

| 步骤 | 操作 | 预计 |
|:----:|------|:----:|
| 5.1 | 新建 `StyleAuditTab.tsx`，搬移 author CRUD + apply 状态 | 30min |
| 5.2 | 搬移 handleCreateAuthorOnly, handleApplyAuthor 等 handler | 15min |
| 5.3 | 搬移 Audit 渲染分支（library + apply 两个 section） | 25min |
| 5.4 | StyleManager 中替换，移除迁移的状态和 handler | 10min |
| 5.5 | 需要 props: libraryData, refetchLibrary, booksData, theme, t, nav | 5min |
| 5.6 | 验证 | 3min |

### Phase 6：收尾

| 步骤 | 操作 | 预计 |
|:----:|------|:----:|
| 6.1 | StyleManager.tsx 精简为 ~150 行路由容器 | 5min |
| 6.2 | 移除未使用的 imports（lucide-react icons 等分散到各 Tab） | 5min |
| 6.3 | 全量 typecheck + test 验证 | 3min |
| 6.4 | 提交 | 2min |

---

## 四、风险与注意事项

| 风险 | 缓解措施 |
|------|----------|
| sessionStorage 读写逻辑在 Import Tab 的 state 初始化中 | 原样迁移到 StyleImportTab，不改变逻辑 |
| `statusNotice` 跨 Tab 使用 | 保留在 StyleManager，通过 props 或独立 hook 传递 |
| `sourceHash` useMemo 依赖 text | 保留在 StyleManager（text 的共享消费者） |
| `StyleDriftScoreSection` 内嵌子组件 | 提取为独立文件 `StyleDriftScoreSection.tsx` |
| 现有 import 语句拆分 | 每个新 Tab 文件只 import 自己需要的 |

---

## 五、总工时估算

| Phase | 内容 | 预计 |
|:-----:|------|:----:|
| 1 | AI Detect | 15min |
| 2 | Diagnose | 20min |
| 3 | Dedup | 25min |
| 4 | Import | 1.5h |
| 5 | Audit | 1.5h |
| 6 | 收尾 | 15min |
| **总计** | | **~4h** |

---

## 六、拆分后收益

| 指标 | 拆分前 | 拆分后 | 改善 |
|------|:------:|:------:|:----:|
| StyleManager 行数 | 2190 | ~150 | 93% ↓ |
| 单文件最大行数 | 2190 | ~550 (Audit) | 75% ↓ |
| 单文件 useState | 45 | ~5 (共享) + 各 Tab 独立 | 解耦 |
| 可测试性 | 困难（巨型组件） | 每个 Tab 可独立测试 | ✅ |
| 新 Tab 添加 | 修改 2190 行文件 | 新建 ~100 行文件 + 1 行注册 | ✅ |
| 代码审查 | 全量阅读 | 按 Tab 审查 | ✅ |
