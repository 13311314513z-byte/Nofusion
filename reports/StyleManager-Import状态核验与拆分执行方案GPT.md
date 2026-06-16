# StyleManager Import 状态核验与拆分执行方案 GPT

日期：2026-06-16

## 1. 核验结论

当前 Import 仍是“局部组件化”，不是完整 Tab 级拆分。

已完成：

- `StyleTextTab.tsx` 已承接基础文本导入 UI：来源名、URL 导入、本地文本导入、书籍章节导入、文本分析、诊断入口、profile/diagnostics 展示。
- 后端端点已能支撑当前导入链路：`/style/import-url`、`/style/analyze`、`/style/diagnostics`、`/style/extract-text`、`/style/preprocess`、`/style/relayout`、`/style/preprocess/inspect`、`/books/:id/style/import`、`/books/:id/chapters/:num/style-score`。
- `style-preprocess-state.ts` 已沉淀部分四阶段预处理纯函数：preset、stage、risk stats、snapshot、invalidated stages 等。

仍未完成：

- `StyleTextTab` 只是表单/展示组件，业务状态和 handler 仍由 `StyleManager.tsx` 持有。
- Import 的文件处理、文本提取、输入体检、预处理、重排、导出、风险确认弹窗仍直接写在 `StyleManager.tsx`。
- `StyleManager.tsx` 仍是 Import、Diagnose、Audit、Distillation 的共享父容器，Import 改动会继续污染父组件。

因此当前状态应评估为：Import 拆分约 35%-45%，可用性基本闭环，但架构闭环未完成。

## 2. 当前 Import 状态归属

### 2.1 应继续保留在父组件的共享状态

这些状态被多个 Tab 消费，暂时留在 `StyleManager.tsx` 更稳：

| 状态 | 原因 |
|---|---|
| `activeTab` / `setActiveTab` | 全局导航状态 |
| `text` / `setText` | Import、Diagnose、AI Detect、Deduplicate、Audit 共用 |
| `sourceName` / `setSourceName` | 文本来源会影响分析、保存、展示 |
| `profile` / `setProfile` | Diagnose / Audit 也会读写 |
| `diagnostics` / `setDiagnostics` | Import 现展示，Diagnose / Audit 也使用 |
| `loading` / `loadingDiagnostics` | 目前分析与诊断共用，后续可再拆为细粒度 loading |
| `analyzeStatus` / `setAnalyzeStatus` | 当前状态提示统一出口 |
| `libraryData` / `booksData` | Audit、Import、Distillation 周边均可能复用 |

### 2.2 应从父组件迁入 Import Controller 的状态

这些状态只服务 Import 导入链路，应迁出 `StyleManager.tsx`：

| 类别 | 状态 |
|---|---|
| URL 导入 | `urlSource` |
| 书籍章节导入 | `importBookId`、`importChapterNumber`、`chapterIndex` |
| 文件导入 | `fileText`、`fileSourceName`、`fileType`、`extractedDoc` |
| 分块提取 | `loadedChunks`、`loadingChunk` |
| 预处理 | `activePreset`、`analysisStage`、`preprocessedText`、`preprocessActions`、`showPreprocessPanel` |
| 预处理选项 | `filterCode`、`filterRepeatedPrompts`、`filterUrls`、`filterStructuredData`、`stripMarkdown`、`deduplicateParagraphs`、`filterTimestamps`、`filterIds`、`filterNoiseMarkers`、`minLineLength` |
| 重排 | `relayoutedText`、`showRelayoutPanel`、`mergeShortParagraphs`、`formatDialogue`、`ensureParagraphSpacing`、`normalizeQuotes`、`compressBlankLines` |
| 输入体检与风险 | `inspectionResult`、`showRiskConfirm`、`pendingRiskStats` |
| 导出 | `showExportPanel`、`exportFormat`、`exportStatus` |

`pendingRiskAction` 当前定义后未实际使用，可在拆分时删除或真正接入确认回调；否则它会继续增加无效复杂度。

## 3. 当前 handler 归属核验

### 3.1 应迁入 Import Controller

| handler | 当前职责 |
|---|---|
| `handleTextLocalFile` | 本地文本文件导入到共享 `text` |
| `handleImportUrl` | URL 抽取并写入共享 `text` |
| `handleImportBookChapter` | 书籍章节导入到共享 `text` |
| `handleSelectBook` | 获取章节列表 |
| `handleFileAnalysisLocalFile` | 文件预处理入口的本地文件读取 |
| `handleExtractText` | 调 `/style/extract-text`，随后触发 inspect/preprocess |
| `handleLoadNextChunk` | 分块补载 |
| `runPreprocess` | 调 `/style/preprocess` |
| `runRelayout` | 调 `/style/relayout` |
| `handleRunPreprocess` | 预处理风险确认入口 |
| `getStageText` | 根据四阶段状态选取分析文本 |
| `sampleLargeText` | 大文本 UI 采样 |
| `handleImportProcessedToTextAnalysis` | 将 extracted/cleaned/relayouted 写回共享 `text` 并切到 Diagnose |
| `handleExport` | 导出当前阶段文本 |

### 3.2 可留在父组件或后续拆为 shared analysis hook

| handler | 建议 |
|---|---|
| `handleAnalyze` | 暂留父组件或拆成 `useStyleAnalysisController`，因为 Import 和 Audit 都调用 |
| `handleDiagnostics` | 暂留父组件或拆成 `useStyleDiagnosticsController`，因为 Diagnose/Audit 共用 |
| `handleImport` | 当前是 style guide 导入，和 Import Tab 关系弱；建议后续移入 Audit/Library 语义区 |

## 4. UI 残留核验

`StyleManager.tsx` 当前仍直接渲染以下 Import 专属 UI：

- `activeTab === "import" && fileText` 下的大块 File Processing UI。
- Preprocess Panel。
- Relayout Panel。
- Export Panel。
- 右侧预处理结果预览。
- Risk confirmation modal。

这说明 `StyleTextTab` 之外仍有一个完整的“文件导入与预处理子系统”留在父组件。下一步拆分不应继续微拆按钮，而应建立 `StyleImportTab`，把 `StyleTextTab` 和文件处理区块一起迁入。

## 5. 发现的功能性小问题

预处理删除率显示存在运算优先级问题：

```ts
((extractedDoc?.text.length ?? 1 - preprocessedText.length) / (extractedDoc?.text.length ?? 1) * 100)
```

如果 `extractedDoc?.text.length` 存在，`??` 左侧直接返回原始长度，分子变成原始长度，删除率容易显示为 `100%`。应改为先计算原始长度和删除长度：

```ts
const originalLength = extractedDoc?.text.length ?? 1;
const removalRate = ((originalLength - preprocessedText.length) / originalLength) * 100;
```

建议把该计算抽成纯函数并加入 `style-manager-state.test.ts` 或新的 `style-import-state.test.ts`，作为拆分前的第一项修复。

## 6. 推荐拆分目标结构

```text
packages/studio/src/pages/style-manager/
  StyleImportTab.tsx
  ImportTextSourcePanel.tsx
  ImportFileProcessingPanel.tsx
  ImportPreprocessPanel.tsx
  ImportRelayoutPanel.tsx
  ImportExportPanel.tsx
  ImportRiskConfirmDialog.tsx
  useStyleImportController.ts
  style-import-state.ts
  style-import-state.test.ts
```

最小可行拆分不必一次创建全部组件。建议先建立：

1. `style-import-state.ts`：纯函数、类型、删除率、stage text、option builder。
2. `useStyleImportController.ts`：Import 专属 state 和 handler。
3. `StyleImportTab.tsx`：承接原 `StyleTextTab` + 文件处理 UI + 风险弹窗。

之后再按面板继续拆 `ImportPreprocessPanel`、`ImportRelayoutPanel`、`ImportExportPanel`。

## 7. 执行方法

### 阶段 A：先抽纯函数，降低迁移风险

目标：不移动 UI，只把可测试逻辑先从 `StyleManager.tsx` 拆出。

建议迁出：

- `sampleLargeText`
- `getStageText`
- `buildPreprocessOptions`
- `buildRelayoutOptions`
- `calculateRemovalRate`
- `applyPresetToImportOptions`
- `resetProcessedStagesAfterFileChange`

验收：

- 新增 `style-import-state.test.ts`。
- 覆盖删除率、stage text fallback、大文本采样、preset 应用、预处理选项生成。
- `pnpm --filter @actalk/inkos-studio test -- style-import-state style-manager-state style-preprocess-state` 通过。

### 阶段 B：抽 `useStyleImportController`

目标：把 Import 专属状态和 handler 从父组件迁出，但 UI 暂时可以仍在父组件或薄组件内。

Controller 输入建议：

```ts
interface UseStyleImportControllerArgs {
  readonly text: string;
  readonly setText: (text: string) => void;
  readonly sourceName: string;
  readonly setSourceName: (sourceName: string) => void;
  readonly setProfile: (profile: CoreStyleProfile | null) => void;
  readonly setDiagnostics: (diagnostics: FullStyleDiagnostics | null) => void;
  readonly setAnalyzeStatus: (status: string) => void;
  readonly setActiveTab: (tab: StyleTab) => void;
  readonly booksData: { books: ReadonlyArray<BookSummary> } | null;
  readonly t: TFunction;
}
```

Controller 输出建议：

```ts
interface StyleImportController {
  readonly urlSource: string;
  readonly setUrlSource: (url: string) => void;
  readonly file: ImportFileState;
  readonly preprocess: ImportPreprocessState;
  readonly relayout: ImportRelayoutState;
  readonly exportState: ImportExportState;
  readonly bookImport: ImportBookState;
  readonly actions: ImportActions;
}
```

验收：

- `StyleManager.tsx` 中 Import 专属 `useState` 至少减少 25 个以上。
- `StyleManager.tsx` 只向 Import 传入共享状态和 controller。
- 原有 `/style/*` 端点调用路径不变。

### 阶段 C：抽 `StyleImportTab`

目标：父组件只保留一行 Import 渲染。

目标形态：

```tsx
{activeTab === "import" && (
  <StyleImportTab
    text={text}
    setText={setText}
    sourceName={sourceName}
    setSourceName={setSourceName}
    profile={profile}
    diagnostics={diagnostics}
    renderProfileCard={renderProfileCard}
    controller={importController}
    loading={loading}
    loadingDiagnostics={loadingDiagnostics}
    booksData={booksData}
    libraryData={libraryData}
    c={c}
    t={t}
  />
)}
```

验收：

- `StyleManager.tsx` 不再出现 `activeTab === "import" && fileText`。
- `StyleManager.tsx` 不再直接出现 `PRESETS.map`、`runPreprocess`、`runRelayout`、`handleExtractText`、`handleExport`。
- Risk modal 从父组件迁出。

### 阶段 D：按面板进一步拆分

目标：让 `StyleImportTab` 自身也不过度膨胀。

拆分顺序：

1. `ImportTextSourcePanel`：包装/替代当前 `StyleTextTab` 左侧导入表单。
2. `ImportFileProcessingPanel`：文件读取、文件类型、提取、分块。
3. `ImportPreprocessPanel`：preset、清洗开关、体检结果、删除率。
4. `ImportRelayoutPanel`：重排开关与结果。
5. `ImportExportPanel`：导出格式和导出状态。
6. `ImportRiskConfirmDialog`：风险确认弹窗。

验收：

- 单个组件建议控制在 250 行以内。
- `StyleImportTab` 只做布局编排，不直接写业务分支。
- `StyleManager.tsx` 目标降到 1000 行以下。

## 8. 前后端对齐判断

当前 Import 端点基本闭环：

| 前端调用 | 后端端点 | 状态 |
|---|---|---|
| `/style/import-url` | `POST /api/v1/style/import-url` | 已对齐 |
| `/style/analyze` | `POST /api/v1/style/analyze` | 已对齐 |
| `/style/diagnostics` | `POST /api/v1/style/diagnostics` | 已对齐 |
| `/style/extract-text` | `POST /api/v1/style/extract-text` | 已对齐 |
| `/style/preprocess` | `POST /api/v1/style/preprocess` | 已对齐 |
| `/style/relayout` | `POST /api/v1/style/relayout` | 已对齐 |
| `/style/preprocess/inspect` | `POST /api/v1/style/preprocess/inspect` | 已对齐 |
| `/books/:id/style/import` | `POST /api/v1/books/:id/style/import` | 已对齐 |
| `/books/:id/chapters/:num/style-score` | `POST /api/v1/books/:id/chapters/:num/style-score` | 已对齐 |

拆分时不需要改接口契约。重点是保持 request body 不变，并把接口调用集中到 controller，减少 UI 层散落的 `fetchJson`。

## 9. 优先级建议

P1：

1. 修复删除率显示计算，并补纯函数测试。
2. 抽 `style-import-state.ts`。
3. 抽 `useStyleImportController.ts`，迁出 Import 专属 state/handler。
4. 抽 `StyleImportTab.tsx`，迁移文件处理 UI 和风险弹窗。

P2：

1. 将 `StyleTextTab` 改名或重组为 `ImportTextSourcePanel`，避免和完整 Import Tab 概念混淆。
2. 将 diagnostics 与 author comparison 从 Import 右栏弱化，主要放到 Diagnose/Audit，以减少 Import Tab 职责。
3. 为 `/style/extract-text`、`/style/preprocess`、`/style/relayout` 增加前端 controller 层 mock 测试。
4. 清理 `pendingRiskAction`、`showCreateForm`、`newAuthor*` 等已不属于父组件的残留状态。

## 10. 下一步可直接执行的最小闭环

建议下一轮只做一个闭环，不要同时重构全部面板：

1. 新增 `style-import-state.ts` 与测试。
2. 修复删除率计算。
3. 新增 `StyleImportTab.tsx`，先整体搬迁 `StyleTextTab` 调用、文件处理区块和风险弹窗。
4. `StyleManager.tsx` 只保留 Import 渲染入口和共享状态。
5. 运行：

```bash
pnpm --filter @actalk/inkos-studio test -- style-import-state style-manager-state style-preprocess-state
pnpm --filter @actalk/inkos-studio typecheck
pnpm typecheck
```

完成这一轮后，再决定是否继续把 `StyleImportTab` 内部拆成多个小面板。
