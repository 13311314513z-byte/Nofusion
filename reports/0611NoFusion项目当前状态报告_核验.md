# 0611 NoFusion 项目当前状态报告 — 核验结果

**核验时间**：2026-06-11  
**核验基线**：`reports/0611NoFusion项目当前状态报告.md` vs 实际代码（commit `0bca161` + 工作区未提交改动）  
**核验方法**：逐项读取声称修复的文件/行号，对照 `git diff` 和工作区源码验证；运行 CLI 测试确认 168/171；grep 扫描确认剩余问题。

---

## 一、总体结论

报告对项目状态的描述 **大体可信**，但存在 **2 处数量性夸大** 和 **1 处安全修复的隐患未充分强调**。

| 维度 | 判定 |
|------|------|
| 安全漏洞修复 | 8 项中有 7 项 ✅ 已正确修复；1 项 ⚠️ 已修复但引入新隐患 |
| 功能改进 | 10 项全部 ✅ 已正确实现（在工作区未提交改动中） |
| 剩余问题 | 16 项全部 ✅ 确认仍存在 |
| 数量准确性 | 2 处将 **6 写成 7**（蒸馏端点数、use-api 契约对齐数） |
| 遗漏 | `use-i18n.ts` 新增翻译键未提及；`assertProjectRoot` 安全隐患描述偏轻 |

---

## 二、已修复项逐项核验

### 2.1 安全与契约修复（批次 B）

| # | 声称修复 | 核验结果 | 文件/行号 | 备注 |
|---|---------|:--------:|-----------|------|
| 1 | `rhetoric/rewrite` 500 | ✅ | `server.ts:5566-5601` | `Array.isArray` 三层校验 + undefined 保护 |
| 2 | 蒸馏路径遍历 | ✅ | `distillation-store.ts:65-71` | `assertSafeAuthorId` 已定义，10 个导出函数全部调用 |
| 3 | `x-project-root` 任意目录 | ⚠️ | `server.ts:1714-1721` | `assertProjectRoot` 已存在，但使用 `startsWith`，**同前缀目录可绕过** |
| 4 | `samples/write` 路径遍历 | ✅ | `server.ts:5711-5730` | `assertSafeAuthorId` + `assertProjectRoot` 双重校验 |
| 5 | `authors/fetch` SSRF | ✅ | `server.ts:5692-5705` | 复用 `parseSafeStyleImportUrl` + `assertSafeStyleImportTarget` |
| 6 | 裸 JSON.parse | ✅ | `server.ts:2962-2972` | `try/catch` 包裹，失败 fallback 为 `{}` |
| 7 | `paragraph/dedup` 输入校验 | ✅ | `server.ts:5629-5647` | `threshold`/`minLength` 类型+范围双重校验 |
| 8 | 修辞 ID 冲突 | ✅ | `semantic-duplication.ts:346` | `Date.now()` + `Math.random()` 后缀 |

**关于 #3 的详细说明**：
`assertProjectRoot` 实现为：
```ts
if (!candidate.startsWith(allowed) && candidate !== allowed)
```
这在 Windows/Unix 上均有**前缀遍历风险**。例如 `allowed = "/projects/foo"`，则 `candidate = "/projects/foobar"` 会通过校验。报告将其列为 P1 #3 剩余问题属实，但未指出这是**新引入代码自身的缺陷**（而非旧代码遗留）。

### 2.2 功能改进核验

| # | 声称改进 | 核验结果 | 文件/行号 | 备注 |
|---|---------|:--------:|-----------|------|
| 1 | 审计 `apply` 区域可达 | ✅ | `StyleManager.tsx:246-247, 1727-1751` | `library`/`apply` 切换按钮组已渲染 |
| 2 | 封面 Key 保留 | ✅ | `server.ts:2713-2728` / `ServiceListPage.tsx:103-211` | 后端空 key 不覆盖；前端 `keyDirty` 跟踪 |
| 3 | 章节选择器 | ✅ | `StyleTextTab.tsx:81-117` | 书籍→章节→导入三级 UI |
| 4 | 漂移评分真实章节号 | ✅ | `StyleManager.tsx:74,86,1221` | `chapterNumber` prop 已接入 |
| 5 | AI 检测防抖+取消 | ✅ | `AITellsPanel.tsx:34-116` | `AbortController` + 400ms debounce + shared `runDetection` |
| 6 | Step 4 接入 | ✅ | `StyleManager.tsx:1234-1295` | `ReadabilityDashboard` + `DuplicateParagraphPanel` + `RhetoricIssuePanel` 已渲染 |
| 7 | 诊断风险标注定位 | ✅ | `StyleDiagnosticsPanel.tsx:189-212` | 使用 `ex.start`/`ex.end` 切片原文 |
| 8 | Diagnostics `text` prop | ✅ | `StyleManager.tsx:1217` / `StyleDiagnosticsPanel.tsx:36-43` | `text` 已传递并用于风险标注 |

### 2.3 `use-api.ts` 契约对齐核验

报告声称 **7 处**契约对齐，实际 diff 中体现 **6 处**改动：

| # | 函数 | 改动内容 |
|---|------|----------|
| 1 | `rewriteRhetoric` | 返回 `{rewritten}` → `{prompt}` |
| 2 | `fetchRhetoricAwarePrompt` | 参数 `text` → `basePrompt, contextText` |
| 3 | `dedupParagraphs` | 新增 `threshold?`/`minLength?`；返回类型重构 |
| 4 | `searchAuthorWork` | 参数 `query` → `authorName, language?`；返回字段 `sources` → `results` |
| 5 | `fetchAuthorWork` | 新增 `maxChars?`；返回去掉 `title` |
| 6 | `writeAuthorSample` | 参数改为完整对象；返回 `{written}` → `{filePath}` |

> `fetchReadabilityScore` 在 diff 中**无修改**，因其原本就是 `POST`（与服务端修改后的方法一致）。若将此算作第 7 处，则报告数量正确，但 diff 本身只体现 6 处。

---

## 三、剩余问题核验

报告列出的 **16 项剩余问题全部确认存在**，以下是精确定位：

### P1 剩余问题

| # | 问题 | 确认位置 | 状态 |
|---|------|----------|:----:|
| 1 | CLI JSON 半迁移 | `cli/commands/*`（除 analytics/doctor/export 外均用原始 `JSON.stringify`） | ✅ 存在 |
| 2 | `doctor` 超时+`--json` 污染 | `doctor.ts:284` stdout 日志未 gate；probe 无 timeout | ✅ 存在 |
| 3 | `assertProjectRoot` `startsWith` | `server.ts:1717` 同前缀绕过 | ✅ 存在 |
| 4 | 修辞 issue `console.log` | `StyleManager.tsx:1265, 1277` | ✅ 存在 |
| 5 | 应用后无复检 | `AdjustmentSuggestionsPanel.tsx:82-101` 仅 `markStale()` | ✅ 存在 |
| 6 | `withPipeline` TTL 未实现 | `server.ts:771` `_ttlMs` 声明未引用 | ✅ 存在 |
| 7 | 章节版本历史缺失 | `server.ts:1907` 直接 `writeFile` 无 backup | ✅ 存在 |
| 8 | `project-tools.ts` 静默吞异常 | `project-tools.ts:517-520` 空 catch | ✅ 存在 |
| 9 | CLI 路径遍历 | `cli/utils.ts:16` / `export.ts:22` 无范围校验 | ✅ 存在 |
| 10 | CLI `--format` 类型断言 | `export.ts:20` 无运行时校验 | ✅ 存在 |

### P2 剩余问题

| # | 问题 | 确认位置 | 状态 |
|---|------|----------|:----:|
| 1 | 12 处 async `onClick` 无重入 | `App.tsx:148,157` / `BookDetail.tsx:741,1097,1107,1119` / `BookChaptersSection.tsx:931,942,1000` / `NotifyConfigPanel.tsx:284` / `AdjustmentSuggestionsPanel.tsx:383` | ✅ 存在 |
| 2 | `useAutoSave` 死代码 | `hooks/use-auto-save.ts` 零引用 | ✅ 存在 |
| 3 | `RhetoricHighlightEditor` 孤立 | `components/readability/RhetoricHighlightEditor.tsx` 零引用 | ✅ 存在 |
| 4 | book-workspace 硬编码中文 | 5 个文件共约 78 处（`BookHooksSection.tsx` 13+/`BookCharactersSection.tsx` 32+/`BookChaptersSection.tsx` 8/ `BookScenesSection.tsx` 5/`BookFanficSection.tsx` 20+） | ✅ 存在 |
| 5 | "一键检测全部"无真实 probe | `ServiceListPage.tsx:349-357` 仅刷新列表 | ✅ 存在 |
| 6 | 前端包体积 ~2.7MB | `mermaid`/`shiki` 静态导入无 code-splitting | ✅ 存在 |

---

## 四、报告不准确之处

### 4.1 数量夸大（2 处）

| 位置 | 报告描述 | 实际数量 | 差异原因 |
|------|---------|:--------:|----------|
| 批次 B #3 | "7 个蒸馏端点改用安全校验" | **6** 个端点 | grep 命中 7 次含 1 次函数定义本身 |
| 批次 B #9 | "`use-api.ts` 对齐 7 处" | **6** 处 diff | `fetchReadabilityScore` diff 中无修改（原本就是 POST） |

### 4.2 安全隐患描述偏轻

`assertProjectRoot` 的 `startsWith` 校验是**新引入代码**，报告将其列为 P1 "下一轮主迭代"中的普通改进项，未强调这是安全修复的**回退/未完成**状态。建议升级为 P0 或至少标注为 "安全修复遗留"。

### 4.3 遗漏项

- `use-i18n.ts` 新增 3 条翻译键（`style.importChapter`、`style.adjustmentSuggestions`、`style.compareWithAuthor`）未在报告中列出。
- `StyleManager.tsx` 的 `activeAuditSection` 状态和相关 UI 改进未单独列为完成项（隐含在 "审计 apply 区域可达"中）。

---

## 五、CLI 测试实测结果

```
Test Files: 2 failed | 32 passed (34)
Tests:      168 passed | 3 failed | 171 total
```

失败的 3 项：
1. `cli-integration.test.ts:580` — localhost OpenAI-compatible endpoint 超时（5000ms）
2. `cli-integration.test.ts:1026` — `inkos export` 自定义 outputPath 为 `undefined`
3. `publish-package.test.ts:36` — `npm pack` 执行失败

**报告声称 168/171 准确。**

---

## 六、修正后的状态评估

### 已达标（发布门禁）

| 验收项 | 状态 |
|--------|:----:|
| TypeScript 编译（Core/Studio/CLI） | ✅ |
| Core 测试 1294/1294 | ✅ |
| Studio 测试 267/267 | ✅ |
| 安全漏洞（路径遍历/SSRF/500崩溃） | ⚠️ 7/8 完全修复，1/8（`assertProjectRoot`）有前缀绕过 |
| 审计 `apply` 区域可达 | ✅ |
| 封面 Key 保留语义 | ✅ |

### 未达标

| 验收项 | 状态 | 阻塞度 |
|--------|:----:|:------:|
| CLI 测试全绿 | ❌ 168/171 | **高** — 发布门禁未过 |
| `npm pack` 内容验证 | ❌ 未执行 | 中 |
| `assertProjectRoot` 前缀绕过 | ⚠️ 存在 | **高** — 安全修复不完整 |
| 文风功能闭环（检测→修改→复检） | ⚠️ 动作无真实处理 | 中 |
| 作家蒸馏前端工作台 | ❌ 后端就绪前端缺失 | 低（可延期） |
| 章节版本历史 | ❌ 无持久化 | 中 |

---

## 七、建议修正动作

### 立即执行（今天）
1. **修复 `assertProjectRoot`**：将 `startsWith` 改为 `path.relative` 或 `startsWith(allowed + sep)`，消除前缀遍历风险。
2. **修复 CLI 3 项测试失败**：
   - `export --json` 契约对齐（`outputPath` undefined 问题）
   - `doctor` localhost 超时处理
   - `npm pack` 路径/权限问题

### 本轮迭代内（2-3 天）
3. 实现修辞 issue 动作（`ai-rewrite` / `mark-fixed`）的真实处理。
4. 应用 diff 后触发自动复检。
5. 章节保存前 snapshot。

### 报告勘误
6. 将 "7 个蒸馏端点" 修正为 "6 个蒸馏端点"。
7. 将 "`use-api.ts` 对齐 7 处" 修正为 "6 处 diff + 1 处原本一致"。
8. 将 `assertProjectRoot` 从 P1 升级为 P0 或标注为 "安全修复遗留"。

---

*核验完成时间：2026-06-11*  
*核验人员：Kimi Code CLI*  
*基线代码：commit `0bca161` + 工作区未提交改动（15 个文件）*
