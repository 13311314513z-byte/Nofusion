# 0621 Studio server 前后端功能对齐与拆分闭环报告

> **日期**: 2026-06-21  
> **Git HEAD**: `67e1ea9`（含未提交修改）  
> **范围**: `packages/studio/src/api/server.ts`、`packages/studio/src/api/routes/`、`packages/studio/src/pages/`  
> **来源**: 0621 三源交付完成度报告合并 + 当前代码实测

---

## 一、server.ts 拆分状态

### 1.1 整体结论

| 维度 | 状态 | 说明 |
|---|---|---|
| 内联 API 路由 | ✅ 已清零 | 全部端点已迁移到 `packages/studio/src/api/routes/` 下 30 个模块 |
| 路由注册 | ✅ 完整 | `createStudioServer` 中按序注册 30 个 `registerXxxRoutes(routeContext)` |
| 共享 helper 提取 | 🟡 部分完成 | `shared/pipeline.ts`、`shared/write-jobs.ts`、`shared/agent-helpers.ts` 等已存在，但 `server.ts` 仍保留大量可复用或已无人使用的内联函数 |
| 文件体积 | 🟡 仍偏大 | 当前 **1736 行**（0621 报告基线 1726 行），主要不是路由，而是内联 helper / server factory 逻辑 |

### 1.2 已拆分出的 30 个路由模块

按 `server.ts` 注册顺序：

1. `events.ts` — SSE 事件流
2. `daemon.ts` — 后台守护调度器
3. `cover.ts` — 封面生成配置
4. `project.ts` — 项目元数据、静态文件
5. `logs.ts` — 日志查看
6. `genres.ts` — 题材管理
7. `analytics.ts` — 书籍统计
8. `health.ts` — 单书健康度
9. `truth-browser.ts` — 真相文件目录
10. `language.ts` — 项目语言初始化
11. `project-config.ts` — 模型覆盖 + 通知配置
12. `sources.ts` — 基础素材源
13. `hooks.ts` — 伏笔 CRUD
14. `books.ts` — 书籍 CRUD
15. `services.ts` — LLM 服务商配置
16. `chapters.ts` — 章节读写、版本、审批
17. `audit.ts` — 审计配置与执行
18. `style.ts` — 风格分析/调整/预处理/导入
19. `chapter-intent.ts` — 章节目标/意图/访谈/建议
20. `import-foundation.ts` — 章节/基础设定/正典导入
21. `authors.ts` — 作者档案/蒸馏/样本
22. `event-chain.ts` — 事件链
23. `rhetoric.ts` — 修辞改写/检测
24. `runtime-truth.ts` — 真相文件/runtime 产物/状态变更日志
25. `voices-scene.ts` — 场景模板/角色声线
26. `sessions.ts` — 会话管理
27. `roles.ts` — 角色卡
28. `detect.ts` — AIGC/风格分检测
29. `writing.ts` — 写作预览/计划/执行
30. `revision-export.ts` — 修订/导出/重写/同步
31. `fanfic-radar-doctor.ts` — 同人/雷达/医生
32. `agent.ts` — Pi-Agent 会话

> 注：部分模块（`project-config.ts`、`revision-export.ts` 等）一个文件注册多个业务域，仍具备进一步拆分空间。

---

## 二、前端尚未体现的后端功能

以下端点/功能在后端已注册，但前端无实际调用或对应页面：

| 所属后端模块 | 未使用端点 | 现状与影响 |
|---|---|---|
| **`writing.ts`** | `GET /books/:id/plan-alternatives` | 可解析 `.plan.md` 的方案备选，前端无展示入口 |
| **`writing.ts`** | `GET /books/:id/write-status` | 查询当前写入任务状态，前端未轮询/展示 |
| **`chapter-intent.ts`** | `GET /books/:id/chapters/:num/endpoint-check` | 意图开篇/收尾/必达事件合规检查，前端未调用 |
| **`runtime-truth.ts`** | `GET /books/:id/state-changelog` | 状态变更日志，前端无对应页面 |
| **`authors.ts`** | `POST /style/authors/search` | 作者作品网络搜索，仅 `use-api` helper 导出 |
| **`authors.ts`** | `POST /style/authors/fetch` | 拉取作者作品，仅 helper 导出 |
| **`authors.ts`** | `POST /style/authors/samples/write` | 写入搜索到的作者样本，仅 helper 导出 |
| **`rhetoric.ts`** | `POST /style/rhetoric/aware-prompt` | 修辞感知提示注入，仅 helper 导出 |
| **`sessions.ts`** | `PUT /api/v1/sessions/:sessionId` | 会话重命名，前端无重命名 UI |
| **`books.ts`** | `PATCH /api/v1/books/:id/config` | legacy 配置补丁，前端已改用 `PUT /books/:id` |
| **`import-foundation.ts`** | `POST /books/:id/import/chapters` | legacy 直导，前端使用 plan+commit 两阶段接口 |
| **不存在** | `GET /books/:id/interview/panorama` | 死组件 `CreativePanorama.tsx` 调用了一个不存在的端点 |

### 优先级判断

- **高**：`CreativePanorama.tsx` 死组件必须处理（调用不存在的 API）。
- **中**：`plan-alternatives`、`write-status`、`endpoint-check` 已具备后端能力，补齐前端即可提升写作流程透明度。
- **低**：`state-changelog`、`authors/search/fetch/samples/write`、`rhetoric/aware-prompt` 等功能价值待产品确认，可暂不开放但应文档化。

---

## 三、已拆分但尚未闭环的功能

### 3.1 共享状态/辅助函数重复

| 问题 | 现状 | 闭环缺口 |
|---|---|---|
| **`bookCreateStatus` 共享状态** | `shared/book-create-state.ts` 已存在并被 `agent.ts` 使用 | `books.ts` 自己维护一份 Map，`server.ts` 也保留一份死代码，三处未统一 |
| **服务探测能力** | `server.ts` 与 `services.ts` 各有一套 `probeServiceCapabilities` | API 行为不一致；doctor 与 services 未复用同一实现 |
| **风格导入 URL 安全校验** | `server.ts`、`style.ts`、`authors.ts` 各自复制 `parseSafeStyleImportUrl` 等函数 | 应抽到 `shared/style-import-guards.ts` 统一 |
| **服务配置归一化** | `normalizeServiceConfig` / `mergeServiceConfig` / `syncTopLevelLlmMirror` 多处重复 | 应抽到 `shared/service-helpers.ts` |
| **静态资源服务** | 仍内联在 `startStudioServer` | 可拆为 `static-middleware.ts` |
| **`server.ts` 死代码** | `resolveProjectImageFile`、`assertBookExists`、`normalizeApiBookId`、radar helper、`modelListCache` 等已无人使用 | 未清理，导致文件虚胖 |
| **通知 webhook URL 校验** | `server.ts` 的 `normalizeSafeNotificationWebhookUrl` 完全未使用 | `project-config.ts` 另写了一套校验，未复用 |

### 3.2 路由模块内部可进一步拆分

| 模块 | 当前行数 | 问题 |
|---|---|---|
| `style.ts` | ~717 | 仍包含分析/诊断/改写/预处理/导入/修辞/可读性等多域，距 <600 目标差约 117 行 |
| `project-config.ts` | — | 同时注册 model-overrides 与 notify 两个域 |
| `revision-export.ts` | — | 同时注册 revise/export/rewrite/resync 多个动作 |
| `fanfic-radar-doctor.ts` | — | 同人/雷达/医生三域合一 |

---

## 四、server.ts 内联代码清单（按可拆分/可删除分类）

### 4.1 应立即删除的死代码

| 代码块 / 函数 | 位置 | 原因 |
|---|---|---|
| `bookCreateStatus` Map + 清理 timer | L519–542 | 已提取到 `shared/book-create-state.ts`，server.ts 副本从未使用 |
| `modelListCache` | L545 | 仅定义、未使用；`services.ts` 有自己的缓存 |
| `PIPELINE_STAGES` / `AGENT_LABELS` / `resolveToolLabel` / `summarizeResult` | L187–L387 | 已提取到 `shared/agent-helpers.ts` |
| `isTextChatModelId` / `filterTextChatModels` / `nonTextModelMessage` / `extractToolError` | L428–L468 | 与 `services.ts`、`audit.ts` 重复，server.ts 内无实际调用 |
| `compareServiceListItems` | L389–L400 | `services.ts` 有自己的实现 |
| `isHeaderSafeApiKey` | L402–L405 | `services.ts`、`cover.ts` 有自己的实现 |
| `assertBookExists` / `assertBookDirectoryExists` / `normalizeApiBookId` | L438–L451, L787–L804 | 各路由模块已自行实现或从 `shared/book-guards.ts` 导入 |
| `resolveProjectImageFile` | L470–L508 | `project.ts` 已内联同名函数 |
| `normalizeSafeNotificationWebhookUrl` | L305–L317 | 完全未使用；通知校验在 `project-config.ts` 中另写 |
| `saveRadarScan` / `loadRadarHistory` / `radarTimestampForFilename` | L952–L1012 | 已提取到 `fanfic-radar-doctor.ts` |
| `deriveBookIdFromTitle` / `resolveArchitectBookIdFromArgs` / `resolveCreatedBookIdFromToolExecs` | L592–L625 | 已提取到 `shared/agent-helpers.ts` |

### 4.2 应抽取到 shared 的重复逻辑

| 代码块 / 函数 | 位置 | 建议目标 |
|---|---|---|
| `isSafeStyleId` / `isTextStyleFileType` / `parseSafeStyleImportUrl` / `assertSafeStyleImportTarget` / `extractHtmlTitle` / `readStyleImportBody` | L212–L367 | `shared/style-import-guards.ts` |
| `serviceConfigKey` / `normalizeServiceConfig` / `mergeServiceConfig` / `syncTopLevelLlmMirror` / `isCustomServiceId` | L628–L753 | `shared/service-helpers.ts` |
| `loadRawConfig` / `saveRawConfig` | L756–L812 | `shared/config-io.ts` |
| `probeServiceCapabilities` 及全套 probe 辅助函数 | L1165–L1326 | `shared/service-probe.ts` |
| 静态资源服务 `app.get("/assets/*")` 与 SPA fallback `app.get("*")` | L1694–L1730 | `static-middleware.ts` |

---

## 五、建议执行路线

### 5.1 立即做（低风险、快速减少 server.ts 体积）

1. **清理 `server.ts` 死代码**：删除未引用的 helper、import、`bookCreateStatus` 副本、`modelListCache`、radar helper、style import helper、probe helper 等。
2. **统一书籍创建状态**：让 `books.ts` 改用 `shared/book-create-state.ts`，删除 `server.ts` 中的副本。

### 5.2 短期做（功能闭环）

3. **抽取共享层**：
   - `shared/service-probe.ts`：统一 `probeServiceCapabilities`
   - `shared/style-import-guards.ts`：统一 URL 安全校验
   - `shared/service-helpers.ts`：统一服务配置归一化
4. **处理死组件**：决定 `CreativePanorama.tsx` 取舍——要么补 `/interview/panorama` 端点，要么删除组件。
5. **补齐前端未体现功能（按优先级）**：
   - 中：在写作流程展示 `plan-alternatives` 与 `write-status`
   - 中：在「目标/意图」面板调用 `endpoint-check`
   - 低：决定是否开放 `state-changelog`、`authors/search/fetch/samples/write`、`rhetoric/aware-prompt` 的 UI

### 5.3 中期做

6. **静态资源服务中间件化**：把 `assets/*` 与 SPA fallback 抽到 `api/static-middleware.ts`。
7. **路由 diff 自动化**：增加脚本自动扫描 `routes/` 与 `server.ts` 注册是否一致。
8. **继续二级拆分**：将 `style.ts` 降至 <600 行；将 `project-config.ts`、`revision-export.ts`、`fanfic-radar-doctor.ts` 按业务域再拆分。

---

## 六、与 0621 合并报告的对比更新

| 报告项 | 0621 报告 | 当前核验 |
|---|---|---|
| `server.ts` 内联路由 | 0 ✅ | 0 ✅ |
| 路由模块数 | 25–27 | **30**（多个新增模块已落地） |
| `server.ts` 行数 | 1726 | **1736**（+10，基本持平） |
| 前后端对齐 | 🟡 | 🟡 略有改善，但仍存在未闭环端点 |
| 死代码/重复 helper | 报告中未重点列出 | **新增发现**：`server.ts` 存在大量已提取到 shared 但原实现未删除的代码 |
| 可进一步拆分的模块 | style.ts / runner.ts | `style.ts` 717 行仍偏大；`server.ts` 本身也是拆分对象 |

---

## 七、结论

- **形态完成**：Studio API 路由拆分形态已完成，`server.ts` 中不再内联端点。
- **共享层滞后**：大量 helper 已抽到 shared 模块，但 `server.ts` 中保留死代码/重复实现，导致文件仍 1700+ 行。
- **功能未释放**：部分已拆分的后端能力（如 `plan-alternatives`、`write-status`、`endpoint-check`）尚未在前端体现。
- **闭环重点**：死代码清理 → 共享层统一 → 前端补齐高优先级未闭环端点 → 继续二级拆分。
