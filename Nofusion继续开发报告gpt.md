# NoFusion 继续开发报告 GPT

> 报告日期：2026-06-02  
> 基础项目：InkOS / NoFusion 当前工作区，版本 1.4.1  
> 生成目标：结合三份报告的优势，对 InkOS 当前功能中可低成本扩展的方向进行模块化整理，形成 NoFusion 后续开发路线。

---

## 一、融合后的总体判断

三份报告的共同结论是：InkOS 的核心价值不是“一键生成小说”，而是把长篇创作拆成可治理、可审计、可回滚的工程流程。继续开发不宜先做大规模插件系统或重写 Pipeline，而应优先利用现有强项做低成本增强。

本报告融合的三类优势如下：

| 报告优势 | 可吸收内容 | 对 NoFusion 的意义 |
|----------|------------|--------------------|
| 架构分析优势 | 明确 Core / CLI / Studio 三层架构、REST + SSE 通信、七阶段创作管线、真相文件体系 | 确认扩展应围绕现有模块边界推进，不破坏当前主流程 |
| 深度机制优势 | 梳理文风锁、37 维审计、伏笔生命周期、状态快照、模型服务管理 | 找到已有但尚未充分可视化、配置化的高价值能力 |
| 低成本清单优势 | 强调 Genre Profile、modelOverrides、Webhook、ChapterMeta、MemoryDB、LooseOp 等低侵入入口 | 将扩展重点从“新造系统”转为“复用现有接口加一层能力” |

总体建议：第一阶段应优先做“可观测性 + 配置化 + 结构化元数据”。这些改动不需要重写核心管线，却能显著提升后续扩展速度和用户可感知价值。

---

## 二、低成本扩展判定标准

本报告将以下类型视为低成本扩展：

| 标准 | 说明 |
|------|------|
| 配置驱动 | 通过 `inkos.json`、`book.json`、Genre Profile、外部 JSON 或 Markdown 真相文件完成 |
| 单模块改动 | 主要修改一个 schema、一个命令、一个页面或一个 API 分支 |
| 复用现有页面 | Studio 已有 Analytics、StyleManager、TruthFiles、DaemonControl、GenreManager 等页面基础 |
| 复用现有通信 | 继续使用 REST + SSE，不引入复杂双向 WebSocket 或多实例广播 |
| 不重写 Pipeline | 不改变七阶段主流程，仅拆分、暴露、记录或增强局部产物 |
| 向后兼容 | Zod 字段使用 `.optional()` / `.default()`，旧书籍与旧配置继续可用 |

不建议第一阶段投入：

| 方向 | 原因 |
|------|------|
| 完整运行时插件系统 | Agent、Pipeline、类型、安全边界都要重构，收益晚于成本 |
| PostgreSQL 替代 SQLite | 当前 markdown 真相文件 + SQLite 索引足够支撑单机创作 |
| 前后端彻底分离部署 | 当前 `inkos studio` 单进程部署是轻量使用优势 |
| 多用户 SaaS 化 | 权限、协同、数据隔离和部署复杂度都会明显上升 |

---

## 三、模块级扩展方向

### 1. Core / Pipeline 核心引擎

当前基础：

- `packages/core/src/pipeline/runner.ts` 约 3100 行，承担章节生成、审计、修订、持久化等主流程。
- 已有 `chapter-persistence.ts`、`chapter-review-cycle.ts`、`chapter-truth-validation.ts`、`short-fiction-runner.ts` 等可参考拆分模式。
- 章节运行时会产出 `story/runtime/chapter-XXXX.*`，但对普通用户的可见度仍不足。

低成本扩展方向：

| 调整方向 | 具体做法 | 成本 | 优先级 |
|----------|----------|------|--------|
| Pipeline 阶段产物索引 | 为 `chapter-XXXX.intent.md`、`plan.md`、`context.json`、`trace.json` 建立只读索引 API | 0.5-1 天 | P0 |
| Runner 局部拆分 | 先拆 `writeNextChapter` 周边的 plan / compose / audit / persist 辅助函数，不改变外部调用 | 2-3 天 | P1 |
| 运行时 Trace 摘要 | 把 trace 中的模型、耗时、审计结果、状态变更摘要写入统一 JSONL | 1 天 | P1 |
| Pipeline 失败恢复提示 | 根据失败阶段输出“可重试 / 需人工处理 / 可回滚”的明确状态 | 1 天 | P1 |

收益：

- 让长任务不再是黑箱。
- 为 Studio Trace 查看器、CLI stats、后续 Agent 调试提供数据基础。
- 比直接做插件系统更稳，且能先降低维护难度。

---

### 2. 配置与规则层

当前基础：

- `ProjectConfigSchema` 已有 `llm`、`notify`、`detection`、`foundation`、`writing`、`daemon`、`modelOverrides`。
- `BookConfigSchema` 已有 `targetChapters`、`chapterWordCount`、`fanficMode` 等核心字段。
- Genre Profile 已支持题材规则解析，CLI 与 Studio 都有管理入口。

低成本扩展方向：

| 调整方向 | 具体做法 | 成本 | 优先级 |
|----------|----------|------|--------|
| Quality Gates 扩展 | 增加 `maxHookCount`、`maxTurnMarkerPerChapter`、`enableAutoRewrite` 等治理阈值 | 0.5-1 天 | P0 |
| Book 元数据增强 | 在 `book.json` 增加 `volumeCount`、`currentVolume`、`keywords`、`targetAudience`、`serializationStatus` | 0.5 天 | P0 |
| Genre Profile 团队库 | 支持在 `inkos.json` 配置额外 `genresDir`，优先读取团队题材库 | 1 天 | P1 |
| 文风规则外置 | 把 AI marker、疲劳词、段落硬尺等规则移动到 `style_patterns.json` 或 Genre frontmatter | 1 天 | P1 |

收益：

- 大量“硬编码偏好”变成用户可调参数。
- 不同题材、平台、团队可以形成各自模板。
- 对旧项目影响小，Zod 默认值即可保证兼容。

---

### 3. 数据、状态与记忆层

当前基础：

- `story/` 下已有真相文件、快照、runtime 文件。
- `MemoryDB` 当前包含 `facts`、`chapter_summaries`、`hooks` 三张表，并使用 `ensureColumn()` 做低风险迁移。
- `ChapterMetaSchema` 已有审计问题、字数、检测分数、token 使用等字段。

低成本扩展方向：

| 调整方向 | 具体做法 | 成本 | 优先级 |
|----------|----------|------|--------|
| ChapterMeta 扩展 | 增加 `tags`、`povCharacter`、`location`、`moodScore`、`chapterType`、`revisionCount` | 0.5-1 天 | P0 |
| 新增时间线真相文件 | 增加 `story/timeline.md`，供审计器和 Planner 读取 | 0.5 天 | P1 |
| 状态变更日志 | 每次 Settler / State 更新后写入 `state_changelog.jsonl` | 1 天 | P1 |
| MemoryDB 新索引 | 增加 `characters`、`locations` 或 hook 到期索引，先作为查询加速层 | 1-2 天 | P2 |
| LooseOp 通道利用 | 对 `subplotOps`、`emotionalArcOps`、`characterMatrixOps` 定义消费约定 | 1 天 | P2 |

收益：

- 章节从“文本列表”升级为“可筛选、可统计、可审计的结构化资产”。
- 长篇项目更容易按视角、地点、情绪、支线定位问题。
- 新增数据不必一次性改完整状态机。

---

### 4. Agent 与工具层

当前基础：

- Core 中已有 Architect、Planner、Composer、Writer、Continuity、Reviser、StyleAnalyzer、Radar 等 Agent。
- 交互工具层支持读写、编辑、子 Agent、导出、短篇生成等能力。
- `utils/web-search.ts` 已存在，可作为研究型工具扩展基础。

低成本扩展方向：

| 调整方向 | 具体做法 | 成本 | 优先级 |
|----------|----------|------|--------|
| Agent 工具补齐 | 增加 `calculate`、`date_time`、`memory_query`、`count_tokens` 这类确定性工具 | 0.5-1 天/个 | P1 |
| Researcher 子 Agent | 基于现有 web search / read 工具做资料核查，不进入主 Pipeline | 1-2 天 | P2 |
| Dialogue Polisher | 面向审计问题中的“对话生硬 / 声线混杂”做局部修订 | 1-2 天 | P2 |
| Agent 模型覆盖增强 | CLI 白名单改为读取实际 Agent 名称，让所有 Agent 都可设置 `modelOverrides` | 0.5 天 | P0 |

收益：

- 增强 Agent 的确定性能力，减少算术、时间、事实类幻觉。
- 先从“工具能力”扩展，而不是直接改写主 Agent 生命周期。
- 模型覆盖可立刻降低成本，把强模型留给审计和修订。

---

### 5. 审计与修订系统

当前基础：

- ContinuityAuditor 已覆盖连续性、文风、伏笔、信息边界、AI 味、字数等多维审计。
- Reviser 支持多种修订模式。
- Studio 已有审计触发和结果展示入口，但问题聚合仍可增强。

低成本扩展方向：

| 调整方向 | 具体做法 | 成本 | 优先级 |
|----------|----------|------|--------|
| 审计历史 JSONL | 将每次审计结果追加到 `story/audit_history.jsonl` | 0.5 天 | P0 |
| 审计维度配置化 | 在 `inkos.json` 增加 `audit.dimensions`，允许启用、禁用、调整严重级别 | 1 天 | P0 |
| 审计问题聚合 | Analytics 增加按维度、章节、严重级别的趋势统计 | 1 天 | P0 |
| 修订模式推荐 | 根据问题类型推荐 `polish`、`rewrite-only`、`patch` 等模式 | 1 天 | P1 |
| 确定性规则外置 | PostWriteValidator 的 marker、短段落、禁用词阈值配置化 | 0.5-1 天 | P1 |

收益：

- 审计从“单章结果”变成“长期质量趋势”。
- 用户可以看出项目长期卡在哪类问题上。
- 配置化可以减少误报和不必要重写。

---

### 6. 文风控制与人物声线

当前基础：

- 已有 `style_profile.json`、StyleAnalyzer、PostWriteValidator、AI tells 检测。
- 文风锁已经能控制句长、marker、段落形状和反 AI 味规则。
- 现有问题是“统计结果可见，但人物声线还不够结构化”。

低成本扩展方向：

| 调整方向 | 具体做法 | 成本 | 优先级 |
|----------|----------|------|--------|
| 风格指纹面板 | 在 Studio StyleManager 展示句长、段落长度、marker 趋势 | 1-1.5 天 | P1 |
| 章节风格漂移评分 | 将每章与 `style_profile.json` 对比，写入 `ChapterMeta` | 1 天 | P1 |
| 人物声线草稿 | 从引号对话中提取说话人、句长、常用词，生成 `voice_profiles.json` | 1-2 天 | P1 |
| 声线审计维度 | ContinuityAuditor 增加“人物声线漂移”提示，不必第一阶段强制失败 | 1 天 | P2 |

收益：

- 让“写得像不像”从主观判断变成可观察指标。
- 长篇角色更稳定，尤其适合多角色、多卷本项目。
- 第一阶段可先做弱提示，避免误伤创作自由度。

---

### 7. 伏笔、支线与读者期待管理

当前基础：

- `pending_hooks.md`、hook debt、stale detection、promotion 规则已存在。
- Architect 已要求 hook 具备 `depends_on` 等关系字段。
- Planner 已能读取可回收伏笔，但 Studio 端可视化仍可增强。

低成本扩展方向：

| 调整方向 | 具体做法 | 成本 | 优先级 |
|----------|----------|------|--------|
| 伏笔看板 | Studio 读取 `pending_hooks.md` / `hooks.json`，按 open、advanced、stale、blocked、resolved 展示 | 1-1.5 天 | P0 |
| 伏笔到期提醒 | 根据 `lastAdvancedChapter` 和 `halfLifeChapters` 提醒即将失效的 hook | 0.5-1 天 | P0 |
| 伏笔关系图 | 解析 `depends_on`，生成 Mermaid 或前端关系图 | 1.5 天 | P1 |
| Planner 回收建议 | ChapterMemo 中增加“本章建议推进 / 回收 hook”字段 | 0.5 天 | P1 |
| 读者期待板 | 新增 `reader_expectations.md`，记录爽点、悬念、读者承诺 | 0.5 天 | P2 |

收益：

- 伏笔治理是 InkOS 的核心差异化能力，做成可视化后用户价值很直观。
- 对长篇连载最有帮助，也最符合 NoFusion 的持续开发方向。

---

### 8. LLM 提供商与模型服务

当前基础：

- Provider endpoints 很多，支持 OpenAI、Anthropic、DeepSeek、Moonshot、MiniMax、Ollama、OpenRouter 等。
- Studio 已有服务列表、服务详情、配置来源显示和模型覆盖接口。
- `modelOverrides` 已支持按 Agent 覆盖模型。

低成本扩展方向：

| 调整方向 | 具体做法 | 成本 | 优先级 |
|----------|----------|------|--------|
| 模型别名 | 在配置中支持 `fast`、`creative`、`audit` 等别名，CLI / Studio 统一解析 | 0.5-1 天 | P1 |
| 批量连通性检测 | `doctor --all-services` 或 Studio 服务页一键测试所有已配置服务 | 1 天 | P1 |
| 模型能力标签 | 在 Studio 展示 maxOutput、stream、thinking、建议用途 | 1 天 | P1 |
| Provider 模型卡外部化 | 把静态模型列表拆成 JSON，便于更新 | 1-2 天 | P2 |

收益：

- 用户更容易选择“哪个 Agent 用哪个模型”。
- 降低试错成本和 token 成本。
- 模型生态变化快，模型卡外部化可减少发版压力。

---

### 9. CLI / TUI 交互层

当前基础：

- CLI 已有大量命令：write、audit、revise、style、genre、import、export、analytics、daemon、doctor、studio 等。
- TUI 已有 slash autocomplete、dashboard、session store、input history。

低成本扩展方向：

| 调整方向 | 具体做法 | 成本 | 优先级 |
|----------|----------|------|--------|
| JSON 输出统一 | 定义 `CliJsonResult<T>`，逐步统一 `--json` 返回格式 | 1-2 天 | P1 |
| CLI stats 增强 | 输出字数、审计趋势、token、章节状态分布 | 0.5-1 天 | P0 |
| CLI compare | 比较两个章节或修订前后版本 | 0.5 天 | P2 |
| CLI backup | 创建、列出、恢复书籍快照 | 0.5-1 天 | P2 |
| TUI 快捷命令别名 | `/w`、`/s`、`/a`、`/r` 等别名 | 0.3 天 | P1 |

收益：

- CLI 是开发者和自动化系统最容易接入的入口。
- 统一 JSON 输出能让外部工具更容易编排 NoFusion。
- TUI 小改动能明显提升日常写作效率。

---

### 10. Studio Web 工作台

当前基础：

- Studio 使用 React + Vite + Hono，`server.ts` 约 3285 行。
- 已有 Dashboard、BookDetail、Analytics、StyleManager、TruthFiles、DaemonControl、RadarView、ImportManager、GenreManager、LogViewer 等页面。
- SSE 事件已有 40+ 类型，前端 `STUDIO_SSE_EVENTS` 统一订阅。

低成本扩展方向：

| 调整方向 | 具体做法 | 成本 | 优先级 |
|----------|----------|------|--------|
| API 路由拆分 | 将 `server.ts` 拆为 books、chapters、services、agent、analytics、daemon、export 等路由文件 | 2-3 天 | P1 |
| 伏笔追踪页 | 复用 TruthFiles / Analytics 数据，增加 hook 状态过滤和到期提醒 | 1.5 天 | P0 |
| Trace 查看器 | 展示 `runtime/context.json`、`trace.json`、审计结果和状态 delta | 1.5 天 | P0 |
| 审计趋势图 | 在 Analytics 增加问题类别、严重级别、通过率趋势 | 1-2 天 | P0 |
| 章节标签与筛选 | 基于 `ChapterMeta.tags`、`povCharacter`、`location` 做筛选 | 1 天 | P1 |
| SSE 类型共享 | 将事件名从前端数组提升为共享契约，后端 broadcast 使用同一常量 | 0.5 天 | P1 |

收益：

- Studio 当前已经有页面骨架，新增“看板型”功能成本低。
- 可观测能力提升最容易被用户感知。
- 路由拆分是为了后续维护，不应阻塞 P0 可视化功能。

---

### 11. 导入、导出与发布

当前基础：

- 导出支持 `txt`、`md`、`epub`。
- 导入支持章节与 canon。
- Studio 和 CLI 均已有导入导出入口。

低成本扩展方向：

| 调整方向 | 具体做法 | 成本 | 优先级 |
|----------|----------|------|--------|
| HTML 导出 | 基于现有 Markdown 简单转换，增加目录与章节锚点 | 0.5-1 天 | P1 |
| DOCX 导出 | 使用 `docx` npm 包输出 Word 文档 | 1 天 | P2 |
| Markdown 目录增强 | 导出 MD 时增加 TOC、章节列表、字数统计 | 0.5 天 | P1 |
| 导入断点续传 | 根据章节号和标题避免重复导入 | 0.5 天 | P1 |
| 审计报告导出 | 导出正文时可选附带审计摘要 | 1 天 | P2 |

收益：

- 发布和迁移能力更完整。
- HTML / MD 目录增强成本很低，收益明显。
- DOCX / PDF 可作为后续面向投稿和打印的补齐项。

---

### 12. 守护进程、通知与自动化

当前基础：

- Scheduler 已支持 cron 写作和雷达调度。
- 通知渠道包括 Telegram、企业微信、飞书、Webhook。
- Webhook 已适合对接 n8n、Zapier、Make、自建服务。

低成本扩展方向：

| 调整方向 | 具体做法 | 成本 | 优先级 |
|----------|----------|------|--------|
| 写作进度通知 | 每章完成后推送字数、状态、审计是否通过 | 0.5 天 | P1 |
| 失败升级通知 | 连续失败达到阈值时发送“需人工介入”通知 | 0.3-0.5 天 | P1 |
| Discord / Slack | 基于 Webhook payload 新增渠道适配 | 0.5 天/个 | P2 |
| 守护进程状态 API | Studio 展示当前运行、暂停、错误、下一次执行时间 | 1 天 | P1 |
| Token 阈值告警 | token 使用超过配置阈值时发 SSE 和通知 | 1 天 | P2 |

收益：

- 自动写作的安全感更强。
- Webhook 方向几乎不需要大改架构，适合快速打开自动化生态。

---

### 13. Radar 与市场数据

当前基础：

- `RadarSource` 接口非常干净，已实现番茄、起点、文本数据源。
- RadarAgent 可并行抓取平台趋势并形成分析。

低成本扩展方向：

| 调整方向 | 具体做法 | 成本 | 优先级 |
|----------|----------|------|--------|
| RSS RadarSource | 增加通用 RSS 数据源 | 0.5-1 天 | P1 |
| API RadarSource | 支持用户在 `inkos.json` 配置自定义排行榜 API | 1 天 | P1 |
| 平台数据源扩展 | 增加纵横、晋江、Webnovel、豆瓣阅读等源 | 1 天/源 | P2 |
| Radar 结果入库 | 将趋势摘要写入 `story/marketing_notes.md` 或 JSONL | 0.5 天 | P1 |

收益：

- RadarSource 是当前最成熟的扩展接口之一。
- 市场数据可直接反哺 Planner、标题、简介和读者期待管理。

---

## 四、优先级矩阵

| 优先级 | 模块 | 建议事项 | 预估成本 | 价值 |
|--------|------|----------|----------|------|
| P0 | 审计 | 审计历史 JSONL + 趋势统计 | 1.5 天 | 高 |
| P0 | Studio | 伏笔追踪页 + Trace 查看器 | 3 天 | 高 |
| P0 | 数据 | ChapterMeta 增加 tags / POV / location | 1 天 | 高 |
| P0 | 配置 | Quality Gates 扩展 | 1 天 | 高 |
| P0 | LLM | Agent 模型覆盖白名单动态化 | 0.5 天 | 高 |
| P1 | 文风 | 风格漂移评分 + voice_profiles.json 初版 | 2-3 天 | 高 |
| P1 | Core | Pipeline 阶段产物索引与局部拆分 | 3 天 | 中高 |
| P1 | CLI | stats 增强 + JSON 输出统一 | 2 天 | 中高 |
| P1 | 导出 | HTML / MD TOC 导出 | 1 天 | 中 |
| P1 | 通知 | 写作进度通知 + 失败升级 | 1 天 | 中 |
| P2 | Agent | Researcher / Dialogue Polisher | 2-4 天 | 中 |
| P2 | Radar | 自定义 API / 新平台源 | 2-4 天 | 中 |
| P2 | 导出 | DOCX / 审计报告导出 | 2 天 | 中 |
| P3 | 架构 | 完整插件系统 | 1-2 周以上 | 延后 |

---

## 五、推荐落地路线

### 第一阶段：1 周内

目标：让当前系统更可观察、更可配置。

1. 增加 `audit_history.jsonl`，Analytics 展示审计问题趋势。
2. 扩展 `ChapterMetaSchema`，支持 tags、POV、location、chapterType。
3. Studio 增加 Trace 查看器雏形，先只读 runtime JSON。
4. 增强 CLI `analytics` 或新增 `stats` 输出。
5. 扩展 Quality Gates，加入常用治理阈值。

### 第二阶段：2-4 周

目标：强化长篇创作控制能力。

1. 做伏笔追踪页，包含状态、沉寂、到期、依赖关系。
2. 生成 `voice_profiles.json`，增加人物声线基础统计。
3. 做章节风格漂移评分，并接入 StyleManager。
4. 增加模型别名和批量连通性检测。
5. 做 HTML 导出和 Markdown TOC 增强。

### 第三阶段：1-2 个月

目标：向可扩展创作平台演进。

1. 局部拆分 `runner.ts`，按阶段沉淀可复用函数。
2. 增加 Researcher、Dialogue Polisher 等轻量专项 Agent。
3. 增加 RSS / API RadarSource，并将结果写入市场笔记。
4. 增加 Discord / Slack / 钉钉等通知渠道。
5. 评估是否需要标准化 Agent、导出格式、审计维度的插件契约。

---

## 六、结论

NoFusion 继续开发的最佳切入点不是马上重做 InkOS，而是把 InkOS 已经很强的工程化写作能力“显出来、调得动、接得上”。

优先路线可以概括为：

| 方向 | 关键词 |
|------|--------|
| 显出来 | Trace、审计趋势、伏笔看板、风格面板 |
| 调得动 | Quality Gates、审计维度、文风规则、模型覆盖 |
| 接得上 | CLI JSON、Webhook、RadarSource、导入导出 |
| 稳得住 | ChapterMeta、状态变更日志、人物声线、伏笔到期提醒 |

如果第一阶段只选 5 个事项，建议选择：

1. 审计历史与趋势统计。
2. 伏笔追踪页。
3. Runtime Trace 查看器。
4. ChapterMeta 结构化字段。
5. Agent 模型覆盖增强。

这 5 项成本可控，直接贴合 InkOS 的现有能力，也最能把 NoFusion 从“能跑的小说生成工具”推进为“可观察、可治理、可持续扩展的创作工作台”。

