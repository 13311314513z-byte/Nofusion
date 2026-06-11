# 1 小时代码变更审查与测试报告

> **审查时间**：2026-06-09  
> **审查范围**：过去 1 小时内全部代码变更（git diff --since="1 hour ago"）  
> **审查目标**：识别类型不匹配、运行时缺陷、资源泄漏、API 契约偏差  
> **构建基线**：Core `tsc` ✅ | Studio client + server ✅ | Vitest 1294/1294 ✅

---

## 一、变更概览（17 个文件）

### Core 包（8 个文件）

| 文件 | 变更类型 | 摘要 |
|------|----------|------|
| `agents/style-analyzer.ts` | 重构 | 移除本地 `RHETORICAL_PATTERNS`，统一使用 `detectDuplicateRhetoric` + `computeExpandedFingerprint` |
| `agents/style-fingerprint.ts` | 重构 | 移除本地 `StyleFingerprint` 定义（改为从 models import），移除本地修辞正则，使用 `detectDuplicateRhetoric` |
| `models/style-profile.ts` | 扩展 | `StyleFingerprint` 新增 4 个可选维度字段 |
| `style-library/aggregate.ts` | 扩展 | 新增 4 个 merge 辅助函数，聚合逻辑填充扩展字段 |
| `style-library/models.ts` | 新增 | `AuthorStyleProfile` 新增 `sourceUrls`，新增 Distillation 完整模型定义 |
| `style-library/store.ts` | 扩展 | 默认 `fingerprint` 补全 4 个新字段零值 |
| `utils/web-search.ts` | 增强 | `fetchUrl` 增加语义标签正文提取（article/main/content div） |
| `index.ts` | 导出 | 新增语义查重、段落去重、可读性、修辞重写、文风维度、蒸馏等 20+ 导出 |

### Studio 包（5 个文件）

| 文件 | 变更类型 | 摘要 |
|------|----------|------|
| `api/server.ts` | 新增 + 修复 | 新增 7 个文风 API + 5 个蒸馏 API；修复 `disposePipeline` 泄漏；修复 `bookCreateStatus` timer 清理；修复 `prjRoot` 空值安全 |
| `api/style-preprocess-adapter.ts` | 扩展 | 接入 `detectDuplicateRhetoric`，10 种修辞检测映射到 `InspectionFinding` |
| `hooks/use-i18n.ts` | 扩展 | 新增 `style.rhetoricDetection` + 10 条修辞检测文案 |
| `pages/StyleManager.tsx` | 接入 | detection tab 接入 `RhetoricIssuePanel` + `convertToRhetoricFindings` |
| `shared/contracts.ts` | 扩展 | `InspectionCode` 新增 10 个 `duplicate-*` 码，`InspectionFinding` 新增 5 个扩展字段 |

### 其他（2 个文件）

- `style-library/index.json` — 数据更新
- `tsconfig.*.tsbuildinfo` — 构建产物（可忽略）

---

## 二、功能测试

### 2.1 构建测试

| 项目 | 命令 | 结果 |
|------|------|------|
| Core `tsc` | `pnpm --filter @actalk/inkos-core build` | ✅ 通过 |
| Studio client | `pnpm --filter @actalk/inkos-studio build:client` | ✅ 通过 |
| Studio server | `pnpm --filter @actalk/inkos-studio build:server` | ✅ 通过* |

> *Studio server 需要先完成 Core 构建，否则 `distillation` 等新导出不可见。

### 2.2 单元测试

```
Test Files    121 passed (121)
Tests         1294 passed (1294)
Duration      12.61s
```

### 2.3 运行时功能验证

**① `analyzeStyle` 扩展指纹**

```js
const profile = analyzeStyle(sampleText, 'test');
// 结果：
// rhetoricalFeatures: ['拟人手法(2处)']
// fingerprint.sentenceTypeDistribution: ✅ 存在
// fingerprint.paragraphRhythm: ✅ 存在
// fingerprint.rhetoricBreakdown: ✅ 存在
// fingerprint.dialogueFeatures: ✅ 存在
```

**② 语义查重 `detectDuplicateRhetoric`**

```js
const result = detectDuplicateRhetoric(sampleText, 'zh');
// findings count: 1
// categories: { personification: 2 }
```

**③ 段落去重 `detectDuplicateParagraphs`**

```js
const result = detectDuplicateParagraphs(text);
// 返回结构：{ duplicateGroups: [{ hash, content, lineNumber, duplicates: [{ lineNumber }] }], similarGroups: [] }
```

> ⚠️ **注意**：返回结构为 `{ duplicateGroups: Array<{hash, content, lineNumber, duplicates}> }`，`duplicates` 内仅含 `lineNumber`，不含完整段落内容。前端 `DuplicateParagraphPanel`（尚未接入）需适配此结构。

**④ 可读性评分 `computeReadabilityScore`**

```js
const score = computeReadabilityScore(text);
// 返回结构：{ overall: number, dimensions: { rhetoricVariety, vocabularyDiversity, sentenceVariety, paragraphCoherence, repetitionPenalty } }
```

> ⚠️ **注意**：返回字段为 `overall`（非 `overallScore`），无 `readabilityLevel` 字段。`GET /api/v1/style/readability/score` 端点直接透传此结构，前端需按实际字段消费。

**⑤ 蒸馏模块导出验证**

全部 12 个蒸馏函数已正确打包到 `dist/index.js`，导出验证通过 ✅

---

## 三、发现的问题

### 3.1 P1 · 构建顺序依赖（已解决）

**现象**：Studio server `tsc` 报 `Property 'generateDistillation' does not exist on type 'typeof import(...)'` 等 14 处错误。

**根因**：`core/src/index.ts` 新增了大量导出，但 `packages/core/dist/index.js` 尚未重新生成，Studio server 编译时引用的是旧 build 产物。

**解决**：先执行 `pnpm --filter @actalk/inkos-core build`，再构建 Studio。

**建议**：在 monorepo 构建脚本中确保 Core -> Studio 的依赖顺序，或在 CI 中使用 `pnpm -r build` 按拓扑序构建。

---

### 3.2 P2 · `detectDuplicateParagraphs` 返回结构可能与前端预期不符

**详情**：`DedupResult.duplicateGroups` 的元素结构为 `{ hash, content, lineNumber, duplicates: [{ lineNumber }] }`，而非 `{ paragraphs: [...] }`。

**影响**：前端 `DuplicateParagraphPanel`（尚未接入页面）如果按常规段落数组渲染，会读到 undefined。

**建议**：接入 `DuplicateParagraphPanel` 时确认字段映射，或统一返回更丰富的段落信息。

---

### 3.3 P2 · `computeReadabilityScore` 返回字段命名

**详情**：返回 `{ overall, dimensions }`，而非 `{ overallScore, readabilityLevel }`。

**影响**：`GET /api/v1/style/readability/score` 端点直接透传此结构，前端 `ReadabilityDashboard`（尚未接入）需按实际字段消费。

**建议**：如需与前端预期对齐，可在 `server.ts` 端点层做字段映射，或更新前端类型定义。

---

### 3.4 P2 · `PATCH /distillations/current` 参数校验不足

**详情**：`body.overrides` 仅校验了 `!body.overrides`（truthy check），未校验是否为数组。

```typescript
if (!body.overrides) return c.json({ error: "overrides array is required" }, 400);
await saveDistillationOverrides(prjRoot, authorId, body.overrides as any);
```

**影响**：传入非数组值（如字符串、对象）会被强制 cast 为 `any` 写入文件，可能导致后续读取时解析失败。

**建议**：增加 `Array.isArray(body.overrides)` 校验。

---

### 3.5 P3 · `fetchUrl` 正则可能存在贪婪匹配问题

**详情**：`web-search.ts` 使用 `/<article[^>]*>([\s\S]*?)<\/article>/i` 匹配 `<article>` 内容。虽然使用了非贪婪量词 `*?`，但如果 HTML 中存在嵌套 `<article>` 或格式不标准的标签，可能提取到意外内容。

**影响**：极端情况下可能提取不完整内容。但文本分析对精度要求不高，属于可接受范围。

**建议**：后续可考虑使用轻量 HTML parser（如 `linkedom`）替代正则提取。

---

## 四、安全与资源审查

| 检查项 | 状态 | 说明 |
|--------|------|------|
| `prjRoot` 空值校验 | ✅ 已修复 | 所有涉及文件写入的端点已添加 `!prjRoot` 前置校验 |
| `disposePipeline` 泄漏 | ✅ 已修复 | `try/finally` 覆盖所有退出路径 |
| `bookCreateStatus` timer 清理 | ✅ 已修复 | timer 引用已保存，`beforeExit` 时清理 |
| SQL/命令注入 | N/A | 无 SQL 或 shell 命令拼接 |
| 路径遍历 | N/A | 作者 ID 未做 sanitize，但 `join(root, "style-library", "authors", authorId, ...)` 中 `authorId` 来自受控来源 |
| 正则 ReDoS | ⚠️ 低风险 | `web-search.ts` 正则均为简单模式，无回溯风险 |

---

## 五、前端-后端契约一致性

| 契约点 | 后端类型 | 前端类型 | 状态 |
|--------|----------|----------|------|
| `InspectionFinding.code` | `InspectionCode`（含 10 个 `duplicate-*`） | `InspectionCode` | ✅ 一致 |
| `InspectionFinding.ranges` | `?{ start, end }[]` | 同后端 | ✅ 一致 |
| `InspectionFinding.rhetoricSeverity` | `?"low" / "medium" / "high"` | 同后端 | ✅ 一致 |
| `InspectionFinding.perThousandChars` | `?number` | 同后端 | ✅ 一致 |
| `InspectionFinding.confidence` | `?number` | 同后端 | ✅ 一致 |
| `InspectionFinding.findingId` | `?string` | 同后端 | ✅ 一致 |
| `DuplicateRhetoricFinding` | `semantic-duplication.ts` | `@actalk/inkos-core` import | ✅ 一致 |
| `convertToRhetoricFindings` | `StyleManager.tsx` | `style-preprocess-adapter.ts` | ✅ 映射完整 |

---

## 六、总结

**无 P0 级缺陷。已发现并解决 1 个 P1 构建问题。**

本次 1 小时变更涵盖了：
1. **文风分析引擎重构** — 统一使用 `detectDuplicateRhetoric` 替代本地正则，消除重复检测逻辑
2. **指纹维度扩展** — 4 个新可选字段完整链路（计算 -> 聚合 -> 存储 -> 默认值）
3. **修辞检测前端接入** — `StyleManager` detection tab 已展示 `RhetoricIssuePanel`
4. **作家蒸馏系统** — 5 个新端点 + 完整模型 + 文件持久化
5. **资源管理修复** — `disposePipeline` 泄漏 + `bookCreateStatus` timer 清理 + `prjRoot` 空值安全

**下一步建议**：
- 接入 `DuplicateParagraphPanel`、`ReadabilityDashboard` 等 6 个悬空组件时，注意与后端返回结构对齐
- 为 `PATCH /distillations/current` 增加 `Array.isArray(body.overrides)` 校验
- 考虑在 `computeReadabilityScore` 端点层统一字段命名（如 `overallScore`）以提升前端一致性
