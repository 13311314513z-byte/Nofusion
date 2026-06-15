# NoFusion 书籍模块深度 Review 报告

> 审查时间：2026-06-12  
> 范围：`packages/core/src`（书籍核心逻辑）+ `packages/studio/src`（前端书籍模块）+ `packages/studio/src/api/server.ts`（后端 API）  
> 版本：`@actalk/inkos` v1.4.1 + 12 个未提交文件

---

## 一、执行摘要

当前 NoFusion 的「书籍模块」在功能覆盖上已较为完整：建书、章节写作、资料导入、世界观设定、审计、导出、守护进程调度等主链路均已打通。然而，**核心能力与前端 UI 之间存在多处未对接或对接不完整的裂缝**，部分工作流存在明显不合理的设计，且大量功能仍有改进空间。

| 维度 | 现状 | 关键问题数 |
|------|------|-----------|
| **前后端对接** | 约 85% 对齐 | P0×2、P1×4、P2×5 |
| **工作流合理性** | 基本可用，但多处存在摩擦 | 5 处明显不合理 |
| **改进余地** | 较大 | 10+ 项可优化 |
| **国际化/文案** | 较差 | 6 个核心文件硬编码中文 |

**最值得立即处理的问题**：
1. 章节导入 `startNumber` 在 commit 阶段被丢弃，导致用户指定的起始章节无效（P0）
2. 并发写操作缺乏请求级去重/排队，快速点击或刷新可能触发重复写作并因文件锁抛错（P0）
3. `BookCreate.tsx` 表单是死代码，与 Chat 建书流程重复（P1）
4. `incubating` 状态在前端缺失，状态生命周期断裂（P1）
5. `chapter-goals` 前端可写但 Planner 不读取，属于 orphan feature（P2）

---

## 二、后端能力清单（Core/API）

### 2.1 书籍 CRUD 与生命周期

| 能力 | 后端支持 | 端点 | 说明 |
|------|----------|------|------|
| 创建书籍 | ✅ | `POST /books/create` | 异步 Job，202 + jobId |
| 列表书籍 | ✅ | `GET /books` | 按状态/更新时间排序 |
| 获取书籍详情 | ✅ | `GET /books/:id` | 含 book.json + 运行时摘要 |
| 更新书籍元数据 | ✅ | `PUT /books/:id` | 支持 title/genre/platform/targetChapters/chapterWordCount 等 |
| 部分更新配置 | ✅ | `PATCH /books/:id/config` | **仅支持扩展字段**（volumeCount/keywords/serializationStatus 等），**不支持 targetChapters/chapterWordCount** |
| 删除书籍 | ✅ | `DELETE /books/:id` | 物理删除目录 |
| 状态枚举 | ✅ | `BookConfig.status` | `incubating`/`outlining`/`active`/`paused`/`completed`/`dropped` |

### 2.2 章节与写作

| 能力 | 后端支持 | 端点 | 说明 |
|------|----------|------|------|
| 读取章节 | ✅ | `GET /books/:id/chapters/:num` | 返回 content + meta |
| 写入章节 | ✅ | `PUT /books/:id/chapters/:num` | 含版本备份，per-chapter 内存锁 |
| 章节元数据 | ✅ | `PATCH /books/:id/chapters/:num/meta` | title/location/timeOfDay/type/tags 等 |
| AI 全管线写作 | ✅ | `POST /books/:id/write-next` | Planner→Composer→Writer→Auditor→Reviser |
| AI 仅草稿 | ✅ | `POST /books/:id/draft` | 不写 truth |
| 重写 | ✅ | `POST /books/:id/rewrite/:chapter` | |
| 润色 | ✅ | `POST /books/:id/revise/:chapter` | |
| 状态同步 | ✅ | `POST /books/:id/resync/:chapter` | 重新结算 truth |
| 审计 | ✅ | `POST /books/:id/audit/:chapter` | |
| 检测 | ✅ | `POST /books/:id/detect/:chapter`、`/detect-all` | |
| 版本历史 | ⚠️ | `GET /books/:id/chapters/:num/versions`、`:num/versions/:rev` | 后端保存版本但**无前端 UI** |
| 审批/拒绝 | ✅ | `POST /books/:id/chapters/:num/approve`、`/reject` | |

### 2.3 资料与导入

| 能力 | 后端支持 | 端点 | 说明 |
|------|----------|------|------|
| 列出来源 | ✅ | `GET /books/:id/sources` | |
| 删除来源 | ✅ | `DELETE /books/:id/sources/:sourceId` | 实际是归档到 `archive/` |
| Foundation 导入 Plan | ✅ | `POST /books/:id/import/foundation/plan` | 结果存内存 30 分钟 |
| Foundation 导入 Commit | ✅ | `POST /books/:id/import/foundation/commit` | |
| 章节导入 Plan | ✅ | `POST /books/:id/import/chapters/plan` | 返回 `targetNumber` |
| 章节导入 Commit | ✅ | `POST /books/:id/import/chapters/commit` | **丢弃 `targetNumber`** |
| 正典导入 | ✅ | `POST /books/:id/import/canon` | |
| 同人文初始化 | ✅ | `POST /fanfic/init` | |
| 刷新同人文 | ✅ | `POST /books/:id/fanfic/refresh` | |

### 2.4 世界观、角色、目标

| 能力 | 后端支持 | 端点 | 说明 |
|------|----------|------|------|
| Truth 文件列表 | ✅ | `GET /books/:id/truth` | |
| Truth 文件读写 | ✅ | `GET/PUT /books/:id/truth/:file` | legacy shim 返回只读标志 |
| 角色列表 | ✅ | `GET /books/:id/roles` | |
| 角色 CRUD | ✅ | `POST/PUT/DELETE /books/:id/roles/:roleId` | |
| 钩子 CRUD | ✅ | `GET/POST/PUT/DELETE /books/:id/hooks`、`:hookId` | |
| 章节目标 CRUD | ✅ | `GET/PUT/DELETE /books/:id/chapter-goals/:chapterNumber` | **完整后端，但 Planner 不读** |
| 场景聚合 | ✅ | 章节 `location` 字段 | 无独立 scene 实体 |

### 2.5 风格、导出、守护进程

| 能力 | 后端支持 | 端点 | 说明 |
|------|----------|------|------|
| 风格导入 | ✅ | `POST /books/:id/style/import` | |
| 应用作者画像 | ✅ | `POST /books/:id/style/apply-author` | |
| 导出 | ✅ | `GET /books/:id/export` | txt/md/html/epub |
| 导出保存 | ✅ | `POST /books/:id/export-save` | **存在 P0 路径遍历** |
| 守护进程状态 | ✅ | `GET /daemon` | |
| 启动/停止守护进程 | ✅ | `POST /daemon/start`、`/stop` | 全局单例 Scheduler |
| 书籍分析/健康 | ✅ | `GET /books/:id/analytics`、`/health` | |

---

## 三、前端暴露清单（Studio UI）

### 3.1 书籍列表与入口

| 页面/组件 | 暴露功能 | 后端能力 | 问题 |
|-----------|----------|----------|------|
| `Dashboard.tsx` | 列表、删除、写下一章、导出、进入工作台 | 完整 | 状态显示缺 `incubating`；未配置服务横幅硬编码中文 |
| `Sidebar.tsx` | 书籍列表、快捷操作 | 完整 | 部分文案硬编码 |
| `ChatPage.tsx` | 聊天式建书、book-create 流程 | 完整 | 大量按钮/占位符硬编码中文 |
| `BookCreate.tsx` | 表单式建书 | 完整 | **未被 `App.tsx` 引用，死代码** |
| `BookDetail.tsx` | 旧版书籍详情/设置 | 部分 | 仍挂载但 80% 功能被 workspace 替代；`BookStatus` 缺 `incubating` |

### 3.2 Workspace Sections

| Section | 前端功能 | 后端对接 | 主要问题 |
|---------|----------|----------|----------|
| `BookOverviewSection.tsx` | 概览、健康、分析入口 | 完整 | 部分状态徽章硬编码中文 |
| `BookChaptersSection.tsx` | 章节列表、元数据编辑、操作按钮 | 完整 | 章节类型预设 `CHAPTER_TYPE_PRESETS` 为中文枚举 |
| `BookCharactersSection.tsx` | 角色列表、CRUD、标签 | 完整 | 角色元信息区块硬编码中文；无关系可视化 |
| `BookScenesSection.tsx` | 按 location 聚合章节 | 只读 | **无场景卡编辑**；地点别名警告硬编码中文 |
| `BookSourceSection.tsx` | 来源列表、删除 | 列表/删除 | **无上传入口、无 purpose 选择**；删除按钮为 Trash 图标但实为归档 |
| `BookImportSection.tsx` / `ImportManager.tsx` | Foundation/章节/正典/同人导入 | Plan/Commit | 步骤文案硬编码中文；**章节 commit 丢失 `startNumber`** |
| `BookExportSection.tsx` | 导出、预检查 | 完整 | 较好 |
| `BookGoalsSection.tsx` | 章节目标 CRUD | 完整 | **目标写入后不影响写作**（Planner 不读） |
| `BookFanficSection.tsx` | 同人模式、刷新 | 完整 | 大量文案硬编码中文 |
| `BookTruthSection.tsx` / `TruthFiles.tsx` | Truth 文件编辑 | 读写 | legacy shim 只读提示已处理，较好 |
| `BookRuntimeSection.tsx` | 运行时文件只读 | 只读 | 无编辑能力（合理） |
| `BookAuditSection.tsx` | 审计、检测、结果展示 | 完整 | 较好 |
| `BookStyleSection.tsx` / `StyleManager.tsx` | 风格导入、作者画像 | 完整 | 大量硬编码中文；orphan 蒸馏端点 |
| `BookHooksSection.tsx` | Hook CRUD | 完整 | 风险徽章硬编码中文 |

### 3.3 侧边栏与 Chat

| 组件 | 功能 | 问题 |
|------|------|------|
| `BookSidebar.tsx` | 显示书籍结构、操作状态、Artifact 编辑 | `tool:start`/`tool:end` 事件未注册，操作指示器失灵；legacy truth shim 编辑未处理 409 |
| `DaemonControl.tsx` | 全局守护进程开关 | 无 per-book 调度状态 |

---

## 四、未形成对接的功能（Gap Analysis）

### 4.1 完全悬空的后端能力

| 后端能力 | 端点 | 前端状态 | 建议 |
|----------|------|----------|------|
| 版本历史读取 | `GET /books/:id/chapters/:num/versions`、`:rev` | ❌ 无 UI | 增加章节版本历史面板 |
| 章节目标消费 | `chapter-goals.json` 由 `prepareWriteInput` 读取 | ❌ 不读取 | 将目标接入 Planner/Writer |
| 书籍 PATCH config | `PATCH /books/:id/config` | ⚠️ 仅部分字段 | 统一配置编辑入口 |
| 守护进程 per-book 状态 | 后端 Scheduler 内部有书籍队列 | ❌ 未暴露 | 暴露调度队列/下次执行时间 |
| Writer 蒸馏 | 5 个 `/style/authors/:id/distillations/*` 端点 | ❌ 无 UI | 补齐蒸馏前端或删除端点 |
| 风格诊断历史 | `GET /style/authors/:id/diagnostics`、`:id` | ❌ 只保存不读取 | 增加诊断历史 UI |

### 4.2 前端有 UI 但后端未消费

| 前端功能 | 后端处理 | 问题 |
|----------|----------|------|
| `BookGoalsSection` 写入 chapter goals | `prepareWriteInput` 不读取 | 用户目标不生效 |
| `BookSourceSection` 期望直接上传来源 | 无上传端点，需走 ImportManager | workspace 与导入流程割裂 |
| 场景卡（BookScenesSection 显示 location） | 无 scene 实体 | location 只是字符串，无氛围/时间/关联角色 |

### 4.3 数据契约不一致

| 前端 | 后端 | 不一致点 |
|------|------|----------|
| `FoundationPlan` 要求 `planId`/`roleChanges` | 空结果时返回 `{ bundle, warnings, proposed: null }` | 缺少字段导致 TypeError 风险 |
| `ImportManager` commit 发送 `chapters[].targetNumber` | `server.ts` commit 只取 `title`/`content` | `startNumber` 被忽略 |
| `BookDetail.tsx` `BookStatus` 只有 5 种 | `BookConfig.status` 有 6 种 | `incubating` 缺失 |

---

## 五、工作流不合理之处

### 5.1 建书入口重复且默认值不透明

**现状**：
- `ChatPage.tsx` 聊天式建书是当前主要入口
- `BookCreate.tsx` 表单式建书已写好但**未被引用**（死代码）
- 默认值 `targetChapters=200`、`chapterWordCount=3000` 硬编码在 `buildStudioBookConfig` 和 `BookCreate.tsx` 两个地方

**不合理之处**：
1. 维护两份建书逻辑，默认值分散
2. 用户在 Chat 中无法直观看到/修改目标章数字数
3. 200 章/3000 字的默认假设对短篇小说、散文、剧本等非长篇体裁完全不合适

**改进建议**：
- 复活 `BookCreate.tsx` 作为"高级模式"，或在 Chat 流程结束后让用户确认/修改默认值
- 将默认值提取到项目级配置或按题材模板化
- 在创建成功后显式展示 book config，允许用户一键调整

### 5.2 Foundation Import Plan 状态不持久

**现状**：
1. 用户上传资料 → 后端生成 plan → planId 存内存 30 分钟
2. 用户离开页面或后端重启 → planId 失效
3. commit 返回 409，用户必须重新 plan

**不合理之处**：
- 30 分钟 TTL 对复杂资料的审阅决策太短
- 服务器重启导致计划丢失，用户困惑
- 无"重新预览"引导

**改进建议**：
- 将 plan 持久化到 `story/runtime/foundation-plans/{planId}.json`
- 提供"我的导入计划"列表，支持删除/重试
- commit 失败时返回明确错误码和下一步操作

### 5.3 章节导入丢弃 `startNumber`

**现状**：
1. Plan 阶段用户可设置"从第 N 章开始导入"
2. Plan 返回 `targetNumber`
3. Commit 阶段 `server.ts` 只取 `title`/`content`，`targetNumber` 被丢弃
4. 实际导入从第 1 章或当前下一章开始

**不合理之处**：
- 用户明确指定的起始编号无效，属于功能欺诈
- 可能覆盖已有章节

**改进建议**：
- Commit 透传 `targetNumber` 到 `pipeline.importChapters`
- 在 Plan 阶段显示目标编号预览，让用户确认是否会覆盖

### 5.4 并发写操作缺乏请求级保护

**现状**：
1. 用户点击"AI 写作"
2. 前端本地 `isWriting` 禁用按钮
3. 请求立即返回 202
4. 后端 `acquireBookLock` 在 runner 内部执行，失败抛错并通过 SSE 暴露
5. 用户刷新页面可再次点击，触发第二个请求，第二个请求在 runner 内部因锁失败

**不合理之处**：
- 前端没有请求级去重/排队机制
- 文件锁失败信息通过 SSE 暴露，但用户可能未注意到
- 快速点击或刷新会导致重复 LLM 调用，浪费 token

**改进建议**：
- 后端在 action 层增加"忙"检测，返回 `409 bookBusy` + 当前操作信息
- 前端全局维护"正在操作的书籍集合"，收到 busy 响应后禁用按钮并显示进度
- 或后端引入轻量级等待队列（不推荐，增加复杂度）

### 5.5 Chapter Goals 前写后不读

**现状**：
1. `BookGoalsSection` 提供完整 CRUD UI
2. 用户认真填写本章目标、POV、地点、冲突、禁止事项
3. `prepareWriteInput` / `createGovernedArtifacts` 完全不读取 `chapter_goals.json`
4. 目标对写作/审计零影响

**不合理之处**：
- 功能存在但无效，严重误导用户
- 与用户的"写作前提示卡"需求高度相关但未被利用

**改进建议**：
- 在 Planner 中读取当前章节的 goal 并注入 `ChapterIntent` / `ChapterMemo`
- 将 `forbiddenMoves` 加入 `mustAvoid`，`requiredBeats` 加入 memo
- 此即用户提出的"写作前提示卡"功能的核心实现

### 5.6 Sources Section 与 ImportManager 割裂

**现状**：
1. `BookSourceSection` 只能列出和删除已有 sources
2. 上传/导入新来源必须切换到 `ImportManager`
3. 两个页面数据模型不同：`SourceSection` 展示的是已持久化的 `story/sources/`，`ImportManager` 处理的是 plan/commit 流程

**不合理之处**：
- 用户在 workspace 看到 sources 列表，但无法直接添加
- 添加资料需要离开当前书籍上下文，切换到全局导入管理器

**改进建议**：
- 在 `BookSourceSection` 增加"添加资料"按钮，直接弹出 purpose 选择 + 文件上传
- 上传后自动调用 `/import/foundation/plan` 并进入预览
- SourceSection 与 ImportManager 共享 plan 状态

---

## 六、仍有改进余地的功能

### 6.1 场景卡系统（Scene Card）

**当前**：`BookScenesSection` 仅按 `chapter.location` 字符串聚合章节，无独立场景实体。

**改进方向**：
- 新增 `story/scenes/{id}.md` 实体，含：地点、时间、氛围、感官细节、关联角色、关联事件
- 在章节元数据编辑中选择 `sceneId`
- Planner 自动拉取场景氛围注入 memo
- 与"写作前提示卡"联动

**价值**：提升空间描写一致性，支持用户主动设计场景。

### 6.2 关系动态（Relationship Dynamics）

**当前**：角色卡 body 中有"关系网络"章节，但无跨角色的显式关系动态实体。

**改进方向**：
- 新增 `story/relationship_dynamics.json`
- 定义关系类型：冲突/同盟/秘密/竞争/师徒
- 支持表面关系 + 潜层张力（如"B 另有所图"）
- 关联场景卡，Planner 在匹配场景中注入关系动态

**价值**：实现用户提出的"角色 A 与 B 立场冲突"提示。

### 6.3 版本历史 UI

**当前**：后端自动备份版本到 `versions/`，但前端无版本列表/对比/回滚。

**改进方向**：
- `ChapterReader` 增加"历史版本"侧边栏
- 显示版本时间、字数、变更摘要
- 支持两版本 diff 对比
- 支持一键回滚到指定版本

**价值**：解决已知的 P1 问题，提升编辑安全感。

### 6.4 守护进程可视化

**当前**：只有全局开关，用户不知道调度队列、下次执行时间、冷却/日限。

**改进方向**：
- `DaemonControl` 显示全局队列
- 每本书 card 显示"下次自动写作时间"
- 显示今日已写章节数、剩余额度
- 支持 per-book 暂停/恢复调度

**价值**：用户对自动写作有掌控感。

### 6.5 书籍配置统一入口

**当前**：
- `targetChapters`/`chapterWordCount` 在 `PUT /books/:id`
- `volumeCount`/`keywords` 在 `PATCH /books/:id/config`
- 前端分散在 BookDetail 和（缺失的）设置页

**改进方向**：
- 统一为 `BookSettings` workspace section
- 显式展示并允许编辑：目标章数、单章字数、卷数、连载状态、关键词
- 在创建成功后提示用户检查默认配置

### 6.6 书籍模板/题材模板

**当前**：新建书籍时无模板选择，所有书籍默认 200 章/3000 字。

**改进方向**：
- 提供短篇/中篇/长篇/剧本/散文模板
- 模板预置不同的 `targetChapters`、`chapterWordCount`、`genre`、`platform`
- 用户可保存自定义模板

### 6.7 同人文/正典联动增强

**当前**：同人文和正典导入已实现，但 UI 中母本关系展示弱。

**改进方向**：
- Dashboard 中显示"同人作品→母本"关系链
- 母本更新时提示同步正典
- 同人文 diff 显示与母本的偏离点

### 6.8 书籍分析看板

**当前**：`GET /books/:id/analytics` 已返回数据，但前端展示较简单。

**改进方向**：
- 总字数、章节完成率、平均字数趋势图
- Hook 健康度仪表盘
- 角色出场频率热力图
- 审计问题趋势

### 6.9 Source 预览与编辑

**当前**：上传 source 后用户无法预览提取内容，无法编辑 purpose/名称。

**改进方向**：
- Source 卡片展开显示前 500 字符
- 支持重命名 source
- 支持重新指定 purpose
- 显示预处理摘要（去除了多少噪声）

### 6.10 导入冲突检测

**当前**：章节导入时无覆盖警告。

**改进方向**：
- Plan 阶段检测目标章节是否已存在
- 显示"将覆盖 N 个已有章节"
- 支持"跳过已存在"选项

---

## 七、优先级改进路线图

### Phase 1：修复 P0 数据流问题（1 周）

| 任务 | 文件 | 预期产出 |
|------|------|----------|
| 章节导入透传 `targetNumber` | `server.ts:6178`，`importChapters` | `startNumber` 生效 |
| 并发写请求级忙检测 | `server.ts` action 层 | 返回 `409 bookBusy`，前端据此禁用按钮 |
| Foundation plan 持久化 | `server.ts:6285`，`foundation-source.ts` | plan 写入 `story/runtime/foundation-plans/` |
| `export-save` 格式白名单 | `server.ts:4640` | 消除 P0 安全漏洞 |

### Phase 2：统一入口与状态（1 周）

| 任务 | 文件 | 预期产出 |
|------|------|----------|
| Resurrect 或删除 `BookCreate.tsx` | `App.tsx`, `BookCreate.tsx` | 单一建书入口 |
| 补全 `incubating` 状态 | `BookDetail.tsx`, `Dashboard.tsx`, `models/book.ts` | 状态生命周期完整 |
| 统一书籍配置入口 | 新增 `BookSettingsSection.tsx` | targetChapters/chapterWordCount 等集中编辑 |
| 扩展 `PATCH /books/:id/config` | `server.ts` | 支持核心写作参数 |

### Phase 3：功能补完（2-3 周）

| 任务 | 文件 | 预期产出 |
|------|------|----------|
| `chapter-goals` 接入 Planner | `runner.ts:3039`，`planner.ts` | 目标真正影响写作 |
| SourceSection 增加上传入口 | `BookSourceSection.tsx` | workspace 内直接添加资料 |
| 版本历史 UI | 新增 `ChapterVersionHistory.tsx` | 章节可回溯 |
| 守护进程可视化 | `DaemonControl.tsx` | 显示队列与下次执行时间 |

### Phase 4：体验增强（2-3 周）

| 任务 | 文件 | 预期产出 |
|------|------|----------|
| 场景卡系统 | 新增 `scene-card.ts`，`BookScenesSection.tsx` | 独立场景实体 |
| 关系动态 | 新增 `relationship-dynamic.ts` | 跨角色冲突/秘密显式化 |
| 书籍模板 | `ChatPage.tsx`，`BookCreate.tsx` | 短篇/长篇等模板 |
| 分析看板 | `BookOverviewSection.tsx` | 趋势图/角色热力图 |

### Phase 5：国际化与清理（持续）

| 任务 | 文件 | 预期产出 |
|------|------|----------|
| 提取 `BookSidebar`、`ChatPage`、`BookScenesSection`、`BookFanficSection` 硬编码中文 | 多个文件 | i18n 覆盖核心书籍 UI |
| 后端错误码化 | `server.ts` | 前端根据 code 本地化 |
| 删除 orphan 蒸馏端点或补齐前端 | `server.ts`，`StyleManager.tsx` | 减少悬空 API |

---

## 八、风险与依赖

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 并发写修复改变用户习惯 | 中 | 用户等待时间增加 | 提供清晰进度指示和排队提示 |
| `chapter-goals` 接入 Planner 改变生成风格 | 中 | 老项目生成结果变化 | 默认关闭，用户可选启用 |
| 场景卡/关系动态引入新数据模型 | 高 | 需要 migration/兼容逻辑 | 文件不存在时优雅降级 |
| Foundation plan 持久化改变存储结构 | 中 | 需要清理旧 plan | plan 文件加入 `.gitignore` 或定时清理 |
| i18n 工作量大 | 高 | Phase 5 可能延期 | 仅提取核心书籍 UI（Top 6 文件），其余随日常开发顺手替换 |

---

## 九、结论

当前 NoFusion 书籍模块的**后端能力已经相当完整**，覆盖了从建书到导出、从角色管理到守护调度的完整创作链路。但**前端与核心之间存在明显的"最后一公里"问题**：

1. **数据流断裂**：`startNumber` 被丢弃、`chapter-goals` 不被读取、Foundation plan 不持久化
2. **入口重复**：`BookCreate.tsx` 死代码与 Chat 建书并存
3. **状态缺失**：`incubating` 未暴露、守护进程无 per-book 可见性
4. **功能悬空**：版本历史、场景卡、关系动态、蒸馏系统后端已就绪但前端缺失
5. **体验摩擦**：SourceSection 无法上传、Sources 与 ImportManager 割裂、硬编码中文严重

建议按"先修数据流 P0 → 统一入口与状态 → 补完功能 → 体验增强 → i18n"的顺序推进，预计 **4-6 周**可将书籍模块从"功能完整但断裂"推进到"流程闭环、体验流畅"。

---

*报告完。*
