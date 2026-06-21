# 0621 `runner.ts` 继续拆分分析报告

> **日期**: 2026-06-21  
> **范围**: `packages/core/src/pipeline/runner.ts`  
> **当前状态**: 2602 行，目标 <800 行  
> **依据**: 当前代码实测 + `0621Core功能列举.md`

---

## 一、当前拆分基线

| 指标 | 数值 |
|---|---|
| `runner.ts` 当前行数 | **2602** |
| 已委托外部模块 | `pipeline-foundation.ts`、`pipeline-import.ts`、`pipeline-fanfic.ts`、`pipeline-audit.ts`、`pipeline-writing.ts`、`pipeline-revision.ts` |
| 已拆出核心逻辑行数 | 约 1000 行 |
| 距离 <800 目标 | 仍需减少 **约 1800 行** |

### 已委托给外部模块的方法

| runner 方法 | 委托模块 |
|---|---|
| `initBook` / `reviseFoundation` / `generateAndReviewFoundation` / `assertValidArchitectOutput` / `getFoundationRevision` | `pipeline-foundation.ts` |
| `planFoundationImport` / `commitFoundationImport` | `pipeline-import.ts` |
| `importFanficCanon` | `pipeline-fanfic.ts` |
| `evaluateMergedAudit` | `pipeline-audit.ts` |
| `_writeNextChapterLocked` | `pipeline-writing.ts` |
| `_repairChapterStateLocked` / `_resyncChapterArtifactsLocked` | `pipeline-revision.ts` |

---

## 二、可进一步拆分的功能组

### 2.1 Truth Files / Book Status（低风险，48 行）

| 项 | 内容 |
|---|---|
| **涉及方法** | `readTruthFiles`, `getBookStatus` |
| **行数** | ~48 |
| **调用方** | 外部 CLI/Studio |
| **依赖** | `state.bookDir`, `state.loadBookConfig`, `state.loadChapterIndex`, `state.getNextChapterNumber` |
| **目标模块** | `pipeline/pipeline-book-status.ts` |
| **风险** | ⭐ 极低。纯查询，无内部依赖。 |

### 2.2 Memory / State Sync（低风险，232 行）

| 项 | 内容 |
|---|---|
| **涉及方法** | `syncCurrentStateFactHistory`, `syncLegacyStructuredStateFromMarkdown`, `syncNarrativeMemoryIndex`, `rebuildCurrentStateFactHistory`, `rebuildNarrativeMemoryIndex`, `canOpenMemoryIndex`, `logMemoryIndexDebugInfo`, `withMemoryIndexRetry`, `isMemoryIndexUnavailableError`, `isMemoryIndexBusyError`, `factKey` |
| **行数** | ~232 |
| **调用方** | `writeDraft`, `reviseDraft`, `importChapters`, `_writeNextChapterLocked`, `_repairChapterStateLocked`, `_resyncChapterArtifactsLocked` |
| **依赖** | `state.bookDir`, `logWarn`, `resolveBookLanguageById` |
| **目标模块** | `pipeline/pipeline-memory-sync.ts` |
| **风险** | ⭐ 低。自包含，调用方多但接口统一。 |

### 2.3 Style Guide Generation（低风险，161 行）

| 项 | 内容 |
|---|---|
| **涉及方法** | `generateStyleGuide`, `tryGenerateStyleGuide`, `buildDeterministicStyleGuide` |
| **行数** | ~161 |
| **调用方** | `initFanficBook`, `importCanon`, `importChapters` |
| **依赖** | `state.bookDir`, `state.loadBookConfig`, `loadGenreProfile`, `config.client`, `config.model`, `logWarn`, `resolveBookLanguageById` |
| **目标模块** | `pipeline/pipeline-style-guide.ts` |
| **风险** | ⭐ 低。独立功能，调用方少。 |

### 2.4 Length Governance / Audit Drift / Webhook（中低风险，175 行）

| 项 | 内容 |
|---|---|
| **涉及方法** | `addUsage`, `normalizeDraftLengthIfNeeded`, `assertChapterContentNotEmpty`, `buildLengthWarnings`, `buildLengthTelemetry`, `logLengthWarnings`, `persistAuditDriftGuidance`, `emitWebhook` |
| **行数** | ~175 |
| **调用方** | `writeDraft`, `reviseDraft`, `auditDraft`, `_writeNextChapterLocked` |
| **依赖** | `agentCtxFor`, `config.logger` / `config.notifyChannels`, `localize`, `languageFromLengthSpec`, `logInfo`, `logWarn` |
| **目标模块** | `pipeline/pipeline-length-governance.ts`<br>`pipeline/pipeline-audit-drift.ts`<br>`pipeline/pipeline-webhook.ts` |
| **风险** | ⭐⭐ 中低。方法间关联弱，可分拆到多个小模块。 |

### 2.5 Foundation Import Helpers 合并（极低风险，42 行）

| 项 | 内容 |
|---|---|
| **涉及方法** | `scanExistingRoles`, `computeRoleChanges` |
| **行数** | ~42 |
| **当前状态** | 仍在 runner 中，作为 deps 传给 `pipeline-import.ts` |
| **目标** | 直接合并进 `pipeline-import.ts` |
| **风险** | ⭐ 极低。 |

### 2.6 Canon Import（中低风险，163 行）

| 项 | 内容 |
|---|---|
| **涉及方法** | `importCanon`, `readParentChapterSample` |
| **行数** | ~163 |
| **调用方** | 外部 CLI/Studio |
| **依赖** | `state.listBooks`, `state.bookDir`, `state.loadBookConfig`, `tryGenerateStyleGuide`, `loadGenreProfile` |
| **目标模块** | `pipeline/pipeline-canon-import.ts` |
| **风险** | ⭐⭐ 中低。需处理 `tryGenerateStyleGuide` 的调用位置。 |

### 2.7 Chapter Import（中等风险，294 行）

| 项 | 内容 |
|---|---|
| **涉及方法** | `importChapters`, `resetImportReplayTruthFiles`, `buildImportReplayStateSeed`, `buildImportReplayHooksSeed`，以及模块级 `buildImportFoundationSource` |
| **行数** | ~294 |
| **调用方** | 外部 CLI/Studio |
| **依赖** | `state.acquireBookLock`, `state.loadBookConfig`, `state.bookDir`, `state.loadChapterIndex`, `state.saveChapterIndex`, `state.snapshotState`, `loadGenreProfile`, `resolveBookLanguage`, `generateAndReviewFoundation`, `prepareWriteInput`, `syncLegacyStructuredStateFromMarkdown`, `syncNarrativeMemoryIndex`, `syncCurrentStateFactHistory`, `markBookActiveIfNeeded`, `tryGenerateStyleGuide` |
| **目标模块** | `pipeline/pipeline-chapter-import.ts` |
| **风险** | ⭐⭐⭐ 中。依赖 `prepareWriteInput`、`generateAndReviewFoundation`、`sync*` 等 runner 方法，需通过 `deps` 传入。 |

### 2.8 Governed Artifacts / Plan Resolution（高风险，145 行）

| 项 | 内容 |
|---|---|
| **涉及方法** | `prepareWriteInput`, `createGovernedArtifacts`, `resolveGovernedPlan`, `buildPersistenceOutput`, `assertNoPendingStateRepair`, `markBookActiveIfNeeded` |
| **行数** | ~145 |
| **调用方** | `writeDraft`, `planChapter`, `composeChapter`, `reviseDraft`, `importChapters`, `_writeNextChapterLocked`, `_resyncChapterArtifactsLocked` |
| **依赖** | `config.inputGovernanceMode`, `config.externalContext`, `state.loadBookConfig`, `state.loadChapterIndex`, `state.saveBookConfig`, `state.getNextChapterNumber`, `agentCtxFor`, `loadGenreProfile` |
| **目标模块** | `pipeline/pipeline-governed-artifacts.ts` |
| **风险** | ⭐⭐⭐⭐ 高。核心枢纽，影响 `pipeline-writing.ts` 和 `pipeline-revision.ts` 的 deps 接口。 |

### 2.9 主流程入口（可选，高风险，520 行）

| 项 | 内容 |
|---|---|
| **涉及方法** | `writeDraft`, `reviseDraft`, `auditDraft` |
| **行数** | ~520 |
| **目标模块** | `pipeline/pipeline-write-draft.ts`<br>`pipeline/pipeline-revise-draft.ts`<br>`pipeline/pipeline-audit-draft.ts` |
| **风险** | ⭐⭐⭐⭐⭐ 很高。与治理、长度、记忆、审计模块交互密集。 |

---

## 三、推荐执行顺序

按 **风险低→高、收益高→低** 排序：

| 阶段 | 任务 | 预计减少行数 | 风险 |
|---|---|---:|---|
| **Phase 1** | Truth Files / Book Status | ~48 | ⭐ |
| | Memory / State Sync | ~232 | ⭐ |
| | Style Guide Generation | ~161 | ⭐ |
| | Foundation Import Helpers 合并 | ~42 | ⭐ |
| **Phase 2** | Length / Audit Drift / Webhook Helpers | ~175 | ⭐⭐ |
| | Canon Import | ~163 | ⭐⭐ |
| | Chapter Import | ~294 | ⭐⭐⭐ |
| **Phase 3** | Governed Artifacts / Plan Resolution | ~145 | ⭐⭐⭐⭐ |
| | writeDraft / reviseDraft / auditDraft（如需要） | ~520 | ⭐⭐⭐⭐⭐ |

### 行数预估

| 阶段 | 累计减少 | runner.ts 预估剩余 |
|---|---:|---:|
| 当前 | 0 | 2602 |
| Phase 1 | ~483 | ~2120 |
| Phase 2 | ~1115 | ~1485 |
| Phase 3（不含主流程） | ~1260 | ~1340 |
| Phase 3（含主流程） | ~1780 | **~820 → 可达 <800** |

---

## 四、拆分后 runner.ts 应保留的最小职责

### 必须保留

| 职责 | 内容 |
|---|---|
| 公共 API 入口 | `runRadar`, `initBook`, `reviseFoundation`, `importFanficCanon`, `planFoundationImport`, `commitFoundationImport`, `initFanficBook`, `writeDraft`, `planChapter`, `composeChapter`, `auditDraft`, `reviseDraft`, `writeNextChapter`, `repairChapterState`, `resyncChapterArtifacts`, `importCanon`, `importChapters`, `readTruthFiles`, `getBookStatus`, `generateStyleGuide` |
| 生命周期管理 | `constructor`, `dispose`, `resetForReuse` |
| 委托包装 | 已委托模块的薄包装方法 |
| 通用上下文/日志代理 | `agentCtx`, `agentCtxFor`, `createAgentContext`, `resolveOverride`, `pathExists`, `loadGenreProfile`, `resolveBookLanguage`, `localize`, `logStage`, `logInfo`, `logWarn` |
| 委托属性 | `state`, `config`, `agentClients`, `chapterContentCache`, `memoryIndexFallbackWarned` |

### 建议完全移出

- ❌ SQLite 记忆索引操作 → `pipeline-memory-sync.ts`
- ❌ 导入逻辑 → `pipeline-import.ts` / `pipeline-chapter-import.ts` / `pipeline-canon-import.ts`
- ❌ 风格指南生成 → `pipeline-style-guide.ts`
- ❌ 字数归一化/遥测、审计纠偏、webhook → 各自小模块
- ❌ governed plan 解析与工件组装 → `pipeline-governed-artifacts.ts`
- ❌ truth files 读取与状态查询 → `pipeline-book-status.ts`
- ❌ （可选）`writeDraft` / `reviseDraft` / `auditDraft` → 各自流程模块

---

## 五、关键循环依赖风险与规避

| 风险点 | 说明 | 规避方案 |
|---|---|---|
| `pipeline-chapter-import.ts` ↔ `runner.ts` | `importChapters` 调用 `prepareWriteInput`、`generateAndReviewFoundation`、`sync*` | 通过 `deps` 对象传入回调，禁止新模块 `import` runner |
| `pipeline-governed-artifacts.ts` ↔ `pipeline-writing.ts` | `createGovernedArtifacts` 被 writing/revision 依赖 | 将返回类型抽象化，由 runner 统一注入 deps |
| `pipeline-style-guide.ts` ↔ `pipeline-canon-import.ts` | `importCanon` 调用 `tryGenerateStyleGuide` | canon import 返回文本样本，由 runner 决定是否调用 style guide |
| `pipeline-memory-sync.ts` ↔ `runner.ts` | `sync*` 使用 `logWarn` 和 `resolveBookLanguageById` | 通过 `deps` 传入 logger 和语言解析函数 |

---

## 六、结论与下一步

1. **最优先执行 Phase 1**：Truth Files/Book Status、Memory Sync、Style Guide、Foundation Import Helpers 合并。这 4 项风险极低，可立即减少约 **480 行**。
2. **其次执行 Phase 2**：Length/Audit Drift/Webhook、Canon Import、Chapter Import。再减少约 **630 行**。
3. **最后处理 Phase 3**：Governed Artifacts/Plan Resolution，以及必要时拆分 `writeDraft` / `reviseDraft` / `auditDraft` 主流程，以确保最终 **< 800 行**。

按此顺序执行，可在控制风险的同时逐步接近目标。
