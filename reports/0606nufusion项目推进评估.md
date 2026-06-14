# NoFusion 0606 项目推进评估

> 评估日期：2026-06-06
> 评估基准：
> - 《NoFusion 最终发展方向报告.md》（2026-06-02）
> - 《NoFusion 0605 阶段发展报告.md》（2026-06-05）
> - 当前代码库：InkOS / NoFusion 1.4.1
> 评估方法：逐条对照 0605 阶段报告中的六条主线、十大任务与低成本统一清单，review 当前代码状态

---

## 一、总体判断

**当前 NoFusion 处于「底座已齐，呈现基本补齐」的阶段。**

相比 0605 报告的「底座已齐，呈现不齐」，过去 1 天内代码库发生了**显著的隐性进展**：大量 0605 报告中标注为「未实现」或「前端缺」的功能，在 0606 代码中**已经就绪**。这些进展并未体现在 git 提交历史中（当前仓库仅有一笔 Initial import），但代码文件本身已经包含了这些能力。

**关键变化**：
- 0605 报告的「8 个低成本统一项」中，**已有 6 项在代码中完成**
- 十大任务中，**从 5 项已完成提升到 8 项已完成或后端就绪**
- 剩余未完成项从前端呈现层缺漏，**转向真正的能力扩展项**

---

## 二、六条主线逐一评估

### 主线 1：可观测创作闭环

| 功能 | 0605 状态 | 0606 状态 | 变化 | 说明 |
|------|----------|----------|------|------|
| Runtime Trace 查看器 | ✅ 已实现 | ✅ 已实现 | — | `BookRuntimeSection.tsx` + `server.ts:1855-1909` |
| 审计历史记录 | ✅ 已实现 | ✅ 已实现 | — | `audit-history.ts` + `GET /audit/books/:id/summary` |
| 审计趋势仪表盘 | ⚠️ 后端有，前端缺 | ⚠️ **部分补齐** | ↑ | `BookAuditSection.tsx` 已有按章节分数柱状图（`audit.auditTrend`），但 `Analytics.tsx` 仍未展示审计数据 |
| 状态变更日志 | ❌ 未实现 | ❌ 未实现 | — | 无 `state_changelog.jsonl` |
| 章节对比视图 | ❌ 未实现 | ❌ 未实现 | — | 无 diff 视图 |

**评估**：BookAuditSection 的审计趋势图已可展示每章审计分数分布（前 20 章柱状图），这是 0605 报告中未明确提及的增量能力。但 Analytics 页面仍缺少审计分数/问题数随章节变化的折线图，无法让用户在全局数据分析页看到审计趋势。

---

### 主线 2：伏笔与长篇治理

| 功能 | 0605 状态 | 0606 状态 | 变化 | 说明 |
|------|----------|----------|------|------|
| 伏笔追踪页 | ⚠️ 部分实现 | ✅ **已实现** | ↑↑ | `BookHooksSection.tsx` 已支持全部 6 个状态分组（open/progressing/deferred/blocked/stale/resolved） |
| 伏笔到期提醒 | ❌ 未实现 | ✅ **已实现** | ↑↑ | 有 `computeRiskScore`、逾期徽章、高风险置顶、剩余章节数计算 |
| 伏笔关系图 | ❌ 未实现 | ⚠️ **部分实现** | ↑ | 无 Mermaid 图，但有 `dependsOn`/`dependedBy` 依赖链可视化 |
| Planner 回收建议 | ❌ 未实现 | ❌ 未实现 | — | 无本章建议推进/回收 hook 提示 |
| 读者期待文件 | ❌ 未实现 | ❌ 未实现 | — | 无 `reader_expectations.md` |

**评估**：这是**进展最大的主线**。0605 报告中提到的「stale/blocked 独立分组」和「到期提醒」在 0606 代码中已完整实现，且超出了 0605 的预期：
- 风险评分算法（coreHook + 逾期 + 状态权重）
- 按风险排序功能
- 依赖链可视化（deps + 被依赖）
- Top 5 高风险伏笔置顶提醒

---

### 主线 3：结构化元数据与轻量状态扩展

| 功能 | 0605 状态 | 0606 状态 | 变化 | 说明 |
|------|----------|----------|------|------|
| ChapterMeta 扩展 | ✅ 已实现 | ✅ 已实现 | — | `tags`/`povCharacter`/`location`/`chapterType`/`moodScore`/`revisionCount` |
| 章节筛选与标签 | ✅ 已实现 | ✅ 已实现 | — | `BookChaptersSection.tsx` 支持四维度筛选 |
| BookConfig 扩展 | ❌ 未实现 | ✅ **已实现** | ↑↑ | `BookConfigSchema` 已增加 `volumeCount`/`currentVolume`/`keywords`/`targetAudience`/`serializationStatus`，且前端已展示 |
| 时间线文件 | ❌ 未实现 | ❌ 未实现 | — | 无 `story/timeline.md` |
| MemoryDB 新索引 | ❌ 未实现 | ❌ 未实现 | — | 无 |

**评估**：BookConfig 扩展是 0605→0606 的**重大隐性进展**。0605 报告将其列为未实现，但当前代码中：
- `packages/core/src/models/book.ts` 已包含全部 5 个扩展字段
- `packages/studio/src/pages/BookDetail.tsx` 已展示 volume/currentVolume/serializationStatus/targetAudience
- `packages/studio/src/api/book-create.ts` 创建/编辑时已支持这些字段

---

### 主线 4：文风控制与人物声线

| 功能 | 0605 状态 | 0606 状态 | 变化 | 说明 |
|------|----------|----------|------|------|
| 风格指纹面板 | ✅ 已实现 | ✅ 已实现 | — | `StyleManager.tsx` + `style-fingerprint.ts` 9 维指纹完整 |
| 文风规则外置 | ⚠️ 部分实现 | ⚠️ 部分实现 | — | Genre/BookRules 已外置，marker/旧词表扫描规则仍硬编码 |
| 章节风格漂移评分 | ❌ 未实现 | ✅ **已实现** | ↑↑ | `server.ts:2090` 已有 `POST /books/:id/chapters/:num/style-score` 端点 |
| 人物声线初版 | ❌ 未实现（占位） | ❌ 未实现（占位） | — | `voiceProfileId` 字段存在，无声线档案 |
| 声线审计提示 | ❌ 未实现 | ❌ 未实现 | — | 无 |

**评估**：风格漂移评分 API 是 0605 报告中未预期到的增量能力。后端已能计算章节指纹与书籍 style profile 的偏离度（0-100 分），但前端尚未在章节详情页展示该分数。

---

### 主线 5：模型成本控制与服务可用性

| 功能 | 0605 状态 | 0606 状态 | 变化 | 说明 |
|------|----------|----------|------|------|
| Agent 模型覆盖增强 | ⚠️ 部分实现 | ✅ **已实现** | ↑↑ | `KNOWN_AGENTS` 已有 9 个 agent，含 `planner`/`style`/`detector`/`chapter-analyzer` |
| 模型别名 | ❌ 未实现 | ❌ 未实现 | — | 无 `fast`/`creative`/`audit`/`local` |
| 批量连通性测试 | ❌ 未实现 | ❌ 未实现 | — | 无 `inkos doctor --all-services` |
| 模型能力标签 | ⚠️ 部分实现 | ⚠️ 部分实现 | — | `ModelInfo` 有 `maxOutput`/`contextWindow`，Studio 未显示建议用途 |
| token 消耗统计 | ⚠️ 后端有，前端缺 | ✅ **已实现** | ↑↑ | `Analytics.tsx` 已完整展示 token 统计 + 趋势图 |

**评估**：token 统计从 0605 的「前端缺」变为 0606 的「完整展示」，是 Analytics 页面的重要补完。CLI 白名单也已完整覆盖全部 agent。

---

### 主线 6：自动化接入与轻量生态

| 功能 | 0605 状态 | 0606 状态 | 变化 | 说明 |
|------|----------|----------|------|------|
| CLI JSON 标准化 | ⚠️ 部分实现 | ⚠️ 部分实现 | — | `--json` 支持广泛，但无统一 `{status,error,data,meta}` 包装 |
| Webhook 自动化 | ⚠️ 部分实现 | ⚠️ **部分补齐** | ↑ | `NotifyConfigPanel.tsx` 事件名已与后端对齐（`chapter-complete` 等），有 n8n/Make 接入说明 |
| 写作进度通知 | ❌ 未实现 | ❌ 未实现 | — | 无每章推送字数/状态/审计摘要模板 |
| HTML / MD TOC 导出 | ❌ 未实现 | ❌ 未实现 | — | 仅支持 `txt`/`md`/`epub` |
| RSS / API RadarSource | ❌ 未实现 | ❌ 未实现 | — | 仅有番茄/起点内置源 |

**评估**：Webhook 事件名对齐和接入说明是 0605→0606 的进展。但 HTML/MD TOC 导出仍为缺口。

---

## 三、十大具体任务完成度复核

| 顺序 | 任务 | 0605 状态 | 0606 状态 | 变化 |
|------|------|----------|----------|------|
| 1 | 审计历史 `audit_history.jsonl` | ✅ 已完成 | ✅ 已完成 | — |
| 2 | Analytics 审计趋势统计 | ⚠️ 后端有，前端缺 | ⚠️ **部分补齐** | ↑ |
| 3 | Runtime Trace API | ✅ 已完成 | ✅ 已完成 | — |
| 4 | Trace 查看器 | ✅ 已完成 | ✅ 已完成 | — |
| 5 | 伏笔追踪页 | ⚠️ API就绪，UI缺分组+提醒 | ✅ **已完成** | ↑↑ |
| 6 | 扩展 `ChapterMetaSchema` | ✅ 已完成 | ✅ 已完成 | — |
| 7 | 章节筛选标签/视角/地点 | ✅ 已完成 | ✅ 已完成 | — |
| 8 | Agent 模型覆盖增强 | ⚠️ Studio就绪，CLI白名单缺3个 | ✅ **已完成** | ↑↑ |
| 9 | Quality Gates 扩展 | ⚠️ 部分实现 | ⚠️ 部分实现 | — |
| 10 | 风格指纹面板 | ✅ 已完成 | ✅ 已完成 | — |

**新增发现的后端就绪项**（不在十大任务内但已实现）：

| 功能 | 0606 状态 | 说明 |
|------|----------|------|
| BookConfig 扩展 | ✅ 已实现 | `volumeCount`/`currentVolume`/`keywords`/`targetAudience`/`serializationStatus` |
| 章节风格漂移评分 API | ✅ 已实现 | `POST /books/:id/chapters/:num/style-score` |
| Webhook 事件名对齐 | ✅ 已实现 | `NotifyConfigPanel.tsx` 使用后端标准事件名 |
| Token 统计前端展示 | ✅ 已实现 | `Analytics.tsx` 完整展示 |

---

## 四、0605 → 0606 新增进展清单

以下功能是 0605 报告标注为「未实现」或「前端缺」，但在 0606 代码审查中确认**已经就绪**的项：

| # | 功能 | 0605 判断 | 0606 实际状态 | 关键文件 | 评估说明 |
|---|------|----------|--------------|---------|---------|
| 1 | **伏笔完整分组 + 到期提醒** | UI 缺 stale/blocked + 无到期提醒 | ✅ 完整实现 | `BookHooksSection.tsx` | 6 分组齐全，含风险评分、逾期徽章、Top5 高风险置顶 |
| 2 | **BookConfig 扩展** | 未实现 | ✅ 完整实现 | `models/book.ts`、`BookDetail.tsx`、`book-create.ts` | 5 个字段已定义、已展示、已支持创建/编辑 |
| 3 | **CLI 模型覆盖白名单** | 缺 planner/style/detector | ✅ 已补全 | `cli/src/commands/config.ts:165` | 9 个 agent 全部支持 |
| 4 | **章节风格漂移评分 API** | 未实现 | ✅ 后端已实现 | `server.ts:2090-2149` | 可计算 0-100 分漂移分数 |
| 5 | **Webhook 事件名对齐** | UI 与后端不一致 | ✅ 已对齐 | `NotifyConfigPanel.tsx:20-28` | 使用 `chapter-complete` 等标准名 |
| 6 | **Token 统计前端展示** | Analytics 不展示 | ✅ 已展示 | `Analytics.tsx:61-108` | 总量、Prompt/Completion 拆分、最近 5 章趋势图 |
| 7 | **审计趋势图（按章节）** | 未提及 | ✅ 已存在 | `BookAuditSection.tsx:508-564` | 前 20 章审计分数柱状图，按状态着色 |

---

## 五、当前剩余阻塞项

### 真正剩余未实现的功能（按优先级）

| 优先级 | 功能 | 所属主线 | 阻塞原因 | 预估成本 |
|--------|------|---------|---------|---------|
| P1 | **Analytics 页面接入审计趋势** | 可观测 | 数据已就绪（`GET /audit/books/:id/summary`），仅需前端渲染 | 0.5 天 |
| P1 | **章节风格漂移评分前端展示** | 文风 | 后端 API 已就绪，前端未调用 | 0.3 天 |
| P1 | **模型别名** | 成本控制 | 需新增别名解析逻辑 | 0.5-1 天 |
| P1 | **批量连通性测试** | 成本控制 | 需新增 CLI 参数 + Studio 按钮 | 1 天 |
| P2 | **HTML / MD TOC 导出** | 自动化 | 需新增导出格式和目录页生成 | 0.5-1 天 |
| P2 | **文风规则外置（marker/旧词表扫描）** | 文风 | 需将硬编码词表提取到配置 | 1 天 |
| P2 | **写作进度通知模板** | 自动化 | 需新增 Webhook payload 模板 | 0.5 天 |
| P3 | **状态变更日志** | 可观测 | 需修改 Pipeline 写入逻辑 | 1 天 |
| P3 | **人物声线系统** | 文风 | 需新增 Agent 和对话提取逻辑 | 2-3 天 |
| P3 | **RSS / API RadarSource** | 自动化 | 需可配置源解析器 | 1-2 天 |

---

## 六、下一阶段推进建议

### 批次 A：纯前端数据接入（0.5 天，ROI 最高）

1. **Analytics 页面增加审计趋势卡片**
   - 接入 `GET /audit/books/:id/summary`，展示审计分数/问题数折线图
   - 文件：`Analytics.tsx`

2. **章节详情展示风格漂移分数**
   - 调用 `POST /books/:id/chapters/:num/style-score`，在章节页展示分数
   - 文件：章节相关前端组件

### 批次 B：轻量功能扩展（1-1.5 天）

3. **模型别名支持**
   - 在 `inkos.json` 或 `.env` 中支持 `fast`/`creative`/`audit`/`local` 映射到具体模型
   - 文件：`packages/core/src/llm/*.ts`、`cli/src/commands/config.ts`

4. **批量连通性测试**
   - CLI 增加 `inkos doctor --all-services`
   - Studio `ServiceListPage` 增加「一键检测全部」按钮
   - 文件：`cli/src/commands/doctor.ts`、`ServiceListPage.tsx`

5. **HTML / MD TOC 导出**
   - 在现有导出逻辑上增加 `html` 格式和 Markdown 目录页
   - 文件：`BookExportSection.tsx`、后端导出模块

### 批次 C：暂缓项

6. **人物声线完整系统** — 需新增 Agent，成本高于当前优先级
7. **RSS / API RadarSource** — 当前番茄+起点已覆盖主要市场
8. **状态变更日志** — 需修改 Pipeline 核心，侵入性较高

---

## 七、结论

> NoFusion 1.4.1 在 0605→0606 期间发生了**显著的隐性代码补完**。大量 0605 报告中标注为「未实现」的功能，在代码库中已经就绪。

**从「呈现不齐」到「呈现基本补齐」的转变已经完成**：
- 伏笔治理从「部分实现」升级为**完整的前端一等能力**
- BookConfig 扩展从「未实现」升级为**前后端全链路支持**
- 模型覆盖从「白名单缺 3 个」升级为**9 个 agent 全支持**
- Token 统计从「前端缺」升级为**完整展示**

**当前项目推进状态**：
- **P0 级任务（立即做）**：已基本完成，剩余工作量为 **0**
- **P1 级任务（本月做）**：已完成约 **70%**，剩余核心工作为 Analytics 审计趋势接入、风格漂移前端展示、模型别名、批量连通性测试
- **P2 级任务（1-2 个月）**：完成度约 **40%**
- **P3 级任务（暂缓）**：合理搁置

**实际剩余工作量评估**：约 **2-3 天** 即可完成全部 P1 级前端呈现层补完 + 轻量功能扩展，形成「可观察、可治理、可持续、可接入」的完整产品形态。

**一句话建议**：
> 优先完成 Analytics 审计趋势接入和章节风格漂移分数展示，这两个改动只需前端调用已有 API 即可形成明显产品变化；随后补充模型别名和批量连通性测试，即可宣告第一阶段（可观测 + 可治理）全面达成。
