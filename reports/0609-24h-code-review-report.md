# 24h 代码变更审查报告

> **审查时间**：2026-06-09  
> **审查范围**：过去 24 小时内的全部代码变更（git diff 筛选）  
> **审查目标**：识别前端-后端类型不匹配、P0-P1 运行时缺陷、资源泄漏、安全隐患  
> **构建基线**：Core `tsc` ✅ | Studio client + server ✅ | Vitest 1294/1294 ✅

---

## 一、已修复的 P1 级缺陷

### 1.1 P1 · `/api/v1/agent` 端点 Pipeline 资源泄漏

**问题描述**：`PipelineRunner` 实例在多条代码路径中未被 `dispose()`，导致 `agentClients` Map 中的 LLM 客户端缓存无法释放，长期运行下造成内存泄漏。

**泄漏路径**：

| 路径 | 位置 | 原因 |
|------|------|------|
| `writeNextChapter` 成功 | `server.ts:3449` | `return c.json(...)` 直接返回，未调用 `disposePipeline()` |
| `runAgentSession` 异常 | `server.ts:3747-3770` | 外层 `catch` 块未调用 `disposePipeline()` |

**修复方式**：将 pipeline 使用逻辑整体包裹在 `try/finally` 块中，确保 `disposePipeline()` 在所有退出路径（正常返回、内部异常、外部异常）中都被执行。

```typescript
// 修复前（server.ts 原逻辑）
if (agentBookId && isWriteNextInstruction(instruction)) {
  try { /* ... */ return c.json({...}); }  // ← 遗漏 dispose
  catch (e) { disposePipeline(); return c.json({...}); }
}
// runAgentSession 路径...
disposePipeline(); // ← 只覆盖成功路径
return c.json({...});
// 外层 catch — 未调用 disposePipeline()

// 修复后
try {
  if (agentBookId && isWriteNextInstruction(instruction)) {
    try { /* ... */ return c.json({...}); }
    catch (e) { return c.json({...}); }  // finally 会覆盖
  }
  // runAgentSession 路径...
  return c.json({...});
} finally {
  disposePipeline();  // ← 所有路径统一释放
}
```

**验证**：Studio server `tsc` 构建通过 ✅

---

### 1.2 P1 · `/api/v1/style/authors/samples/write` 空 project root 安全隐患

**问题描述**：`prjRoot` 回退链为 `process.env.INKOS_PROJECT_ROOT || c.req.header("x-project-root") || ""`。当两者都为空时，`writeAuthorSample(prjRoot, raw)` 会接收到空字符串，导致 `join("", "style-library", ...)` 产生相对路径，可能将文件写入到 Node.js 当前工作目录以外的位置。

**修复方式**：在调用 `writeAuthorSample` 前增加前置校验，空 `prjRoot` 时立即返回 400。

```typescript
const prjRoot = process.env.INKOS_PROJECT_ROOT || c.req.header("x-project-root") || "";
if (!prjRoot) {
  return c.json({ error: "Project root not available. Set INKOS_PROJECT_ROOT env var or x-project-root header." }, 400);
}
```

**验证**：Studio server `tsc` 构建通过 ✅

---

## 二、审查确认的非缺陷项

### 2.1 `withPipeline` fire-and-forget 模式

在以下端点中 `withPipeline` 调用缺少 `await`：
- `POST /api/v1/books/create` (`server.ts:1775`)
- `POST /api/v1/books/:id/write-next` (`server.ts:2439`)
- `POST /api/v1/books/:id/draft` (`server.ts:2456`)
- `POST /api/v1/books/:id/rewrite/:chapter` (`server.ts:4690`)

**结论**：确认为 intentional fire-and-forget 设计。这些端点通过 SSE 推送进度/完成/错误状态，`.catch()` 已捕获所有异步异常，handler 立即返回任务状态响应。无需修复。

---

## 三、未修复的已知问题（P2-P3 / 功能不完整）

### 3.1 P2 · 前端组件悬空（6 个）

以下组件已创建（共 1310+ 行）但未接入任何页面：

| 组件 | 路径 | 状态 |
|------|------|------|
| `RhetoricHighlightEditor` | `components/readability/` | 未接入 |
| `ReadabilityDashboard` | `components/readability/` | 未接入 |
| `DuplicateParagraphPanel` | `components/readability/` | 未接入 |
| `AuthorSearchPanel` | `components/author/` | 未接入 |
| `AuthorProfileCard` | `components/author/` | 未接入 |
| `DimensionSamplePreview` | `components/author/` | 未接入 |

仅 `RhetoricIssuePanel` 已接入 `StyleManager.tsx` detection tab。

### 3.2 P2 · API hooks 缺失

`use-api.ts` 未提供新文风 API 的专用 hooks：
- `POST /style/rhetoric/rewrite`
- `POST /style/rhetoric/aware-prompt`
- `POST /style/paragraph/dedup`
- `GET /style/readability/score`
- `POST /style/authors/search`
- `POST /style/authors/fetch`
- `POST /style/authors/samples/write`

当前可通过通用 `postApi<T>()` / `useApi<T>()` 调用，但缺少类型安全的专用封装。

### 3.3 P2 · `/api/v1/style/library` 404

端点不存在。前端代码中无调用，但文档/设计中有提及。需补充路由实现或移除文档引用。

### 3.4 P3 · `pipeline-utils.ts` 死代码

`packages/studio/src/api/pipeline-utils.ts` 导出了带 `globalRegistry` 管理的 `withPipeline`，但没有任何文件引用它。`server.ts` 使用自己的本地 `withPipeline` 定义。建议后续统一使用 `pipeline-utils.ts` 或删除该文件。

### 3.5 P3 · `bookCreateStatus` timer 未保存

`server.ts:801` 的 `setInterval` 返回 timer 未被保存，进程退出时无法主动清理。Node.js 进程退出时会自动清理所有 timer，实际影响有限。

---

## 四、前端-后端类型兼容性检查

| 接口 | 前端类型 | 后端类型 | 状态 |
|------|----------|----------|------|
| `StyleFingerprint` | `models/style-profile.ts`（4 个扩展字段） | `models/style-profile.ts` | ✅ 一致 |
| `DuplicateRhetoricFinding` | `core/src/utils/semantic-duplication.ts` | `core/src/index.ts` re-export | ✅ 一致 |
| `InspectionFinding` | `shared/contracts.ts`（扩展字段） | `style-preprocess-adapter.ts` | ✅ 映射正确 |
| `RhetoricCategory` | `semantic-duplication.ts` | `semantic-duplication.ts` | ✅ 一致 |
| `convertToRhetoricFindings` | `StyleManager.tsx` | `style-preprocess-adapter.ts` | ✅ 映射完整 |

**InspectionFinding 扩展字段映射**：
- `ranges` ← `finding.ranges` ✅
- `rhetoricSeverity` ← `finding.severity`（`high`→`warning` 降级） ✅
- `perThousandChars` ← `finding.perThousandChars` ✅
- `confidence` ← `finding.confidence` ✅
- `findingId` ← `finding.id` ✅

---

## 五、构建与测试验证

| 项目 | 结果 |
|------|------|
| Core `tsc` | ✅ 0 错误 |
| Studio client build | ✅ 成功 |
| Studio server build | ✅ 0 错误 |
| Vitest 1294 tests | ✅ 121 files, 全部通过 |

---

## 六、修复摘要

| # | 文件 | 问题 | 修复 | 优先级 |
|---|------|------|------|--------|
| 1 | `server.ts` | `disposePipeline` 多处遗漏 | `try/finally` 统一释放 | P1 |
| 2 | `server.ts` | `writeAuthorSample` 空 root 写入 | 前置空值校验 400 | P1 |

**无 P0 级缺陷发现。**
