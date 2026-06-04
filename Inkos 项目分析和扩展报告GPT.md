# InkOS 项目分析和扩展报告

生成时间：2026-06-02  
分析范围：`D:\NoFusion` 本地项目源码、配置、Studio/CLI/Core 主要入口与创作流水线。

## 1. 项目定位

InkOS 是一个面向长篇小说、短篇小说、同人/衍生创作的 AI 写作操作系统。它不是单一的“调用大模型生成章节”工具，而是把小说生产拆成建书、规划、上下文装配、正文生成、状态沉淀、审计、修订、导出、可视化管理和对话协作的一整套闭环。

项目当前是 pnpm monorepo，核心分层如下：

| 层级 | 路径 | 作用 |
|---|---|---|
| Core | `packages/core` | 小说创作引擎、Agent、状态管理、审计、LLM 服务解析、短篇/封面/导出等核心能力 |
| CLI/TUI | `packages/cli` | 命令行入口、交互命令、Ink TUI、外部 Agent JSON 入口 |
| Studio | `packages/studio` | Web 工作台，提供书籍管理、章节审阅、对话、模型配置、日志、雷达、真相文件编辑等 UI |
| Skill | `skills/SKILL.md` | 给 OpenClaw/外部 Agent 的使用说明和推荐编排入口 |
| Runtime Data | `books/*`、`.inkos/*` | 书籍、章节、真相文件、会话、密钥、运行状态 |

根项目 `package.json` 描述为 autonomous AI novel writing CLI agent，脚本上通过 `pnpm -r build/test/typecheck` 统一调度三个包。当前项目配置位于 `inkos.json`，默认语言为中文，LLM 服务配置指向 `deepseek`，并启用 Studio 配置来源。

## 2. 整体构建思路

InkOS 的构建思路可以概括为：用可审计的工程状态包裹不稳定的模型生成。

传统 AI 写作工具通常把“世界观、人物、上一章、写作要求”一次性塞进 prompt，再等待模型输出。InkOS 更像一个写作流水线：

1. 先把作品信息、角色、世界、卷纲、当前焦点、作者意图沉淀为长期文件。
2. 每章开写前，由 Planner 生成本章意图和章节 memo。
3. Composer 根据章节意图检索相关上下文，生成 context package、rule stack、trace。
4. Writer 分两阶段工作：先写正文，再进行状态沉淀。
5. 审计器和规则检测器检查连续性、文风、伏笔、AI 味、敏感词、字数等。
6. Reviser 根据问题清单自动修订。
7. Chapter Persistence 把正文、真相文件、索引、快照、审计漂移建议持久化。

这个思路的优势在于，它把“模型的创造性”限制在明确的创作任务内，把“长期一致性”交给文件、schema、检索、审计和持久化机制。

## 3. 前端优势

Studio 前端位于 `packages/studio/src`，使用 React 19、Vite、Zustand、Hono API、SSE、lucide-react、Base UI/shadcn 风格组件。它的优势主要体现在：

| 优势 | 说明 |
|---|---|
| 可视化工作台 | 书籍、章节、真相文件、模型配置、日志、雷达、数据分析集中在 Web UI 中 |
| 对话式协作 | `ChatPage` 与 chat store 支持普通聊天、工具执行状态、thinking 流、正文 delta 流 |
| 实时反馈 | `useSSE` 订阅写作、审计、修订、导入、建书、Agent 工具执行等事件 |
| 类型合约 | `shared/contracts.ts` 维护前后端共享接口，降低 API 漂移 |
| 服务配置友好 | Studio 可以配置服务商、模型、API Key，并与 `.inkos/secrets.json` 分离 |
| 运行可观测 | ToolExecutionSteps、日志页、Run 状态、SSE 事件让长任务不再是黑箱 |

前端不是简单 CRUD，而是“写作控制台”。它把 Core 的复杂流水线拆成用户能理解的按钮、状态、面板和对话。

## 4. 后端优势

后端主要由 Core 与 Studio API 组成。Core 的优势是工程化程度高：

| 优势 | 说明 |
|---|---|
| 多 Agent 分工 | Architect、Planner、Composer、Writer、Auditor、Reviser、Detector、StyleAnalyzer 等职责分离 |
| 状态持久化 | `StateManager` 统一管理 `books/`、章节索引、控制文档、写作锁、真相文件 |
| 章节治理 | 每章有 intent、memo、context、rule stack、trace，可追溯输入来源 |
| 审计闭环 | LLM 审计 + AI tell 规则 + 敏感词 + deterministic post-write validator 共同工作 |
| 服务商抽象 | `llm/providers` 和 `service-resolver` 支持 OpenAI-compatible、国内模型、聚合商、Ollama 等 |
| 并发保护 | `StateManager.acquireBookLock` 用 `.write.lock` 防止同书并发写入 |
| 低耦合入口 | CLI、TUI、Studio、OpenClaw 都能复用同一套 Core 能力 |

后端的关键价值是把写作生产链路做成“可恢复、可审计、可替换模型、可接入多入口”的平台。

## 5. 前后端联系方式与对话通信路径

Studio 前端和后端主要通过三类方式通信。

### 5.1 REST API

前端通过 `packages/studio/src/hooks/use-api.ts` 中的 `fetchJson`、`postApi`、`putApi` 请求 `/api/v1/*`。后端路由集中在 `packages/studio/src/api/server.ts`。

关键接口包括：

| 类型 | 接口 | 用途 |
|---|---|---|
| 书籍 | `GET /api/v1/books` | 获取书籍列表 |
| 书籍详情 | `GET /api/v1/books/:id` | 获取单本书摘要与状态 |
| 建书 | `POST /api/v1/books/create` | 创建书籍基础结构 |
| 章节 | `GET/PUT /api/v1/books/:id/chapters/:num` | 查看/保存章节 |
| 写作 | `POST /api/v1/books/:id/write-next` | 启动完整写作流水线 |
| 草稿 | `POST /api/v1/books/:id/draft` | 只生成草稿 |
| 审核 | `POST /api/v1/books/:id/chapters/:num/approve` | 章节通过 |
| 回滚 | `POST /api/v1/books/:id/chapters/:num/reject` | 拒绝并回滚 |
| 真相文件 | `GET/PUT /api/v1/books/:id/truth/:file` | 查看/编辑设定和状态 |
| 对话会话 | `GET/POST /api/v1/sessions` | 管理 Studio chat session |
| Agent 对话 | `POST /api/v1/agent` | 发送自然语言指令给 Agent |
| 模型配置 | `/api/v1/services*` | 服务商、模型、密钥、连通性测试 |

### 5.2 SSE 实时事件

前端通过 `useSSE("/api/v1/events")` 建立 EventSource。后端在 `server.ts` 的 `/api/v1/events` 使用 `streamSSE` 推送事件。

事件包括：

- `write:start` / `write:complete` / `write:error`
- `draft:start` / `draft:complete` / `draft:error`
- `agent:start` / `agent:complete` / `agent:error`
- `tool:start` / `tool:update` / `tool:end`
- `draft:delta`
- `thinking:start` / `thinking:delta` / `thinking:end`
- `book:creating` / `book:created` / `book:error`
- `log`、`llm:progress`、`ping`

这套通信让长耗时写作任务可以边执行边展示，尤其适合章节生成、建书、修订、短篇生成这类不可瞬时完成的任务。

### 5.3 对话中的前后端链路

Studio 对话大致链路如下：

1. 用户在前端 ChatPage 输入自然语言。
2. chat store 调用 `POST /api/v1/agent`，携带 `instruction`、`sessionId`、`activeBookId`、可选 service/model。
3. 后端校验 session、book、模型。
4. 如果是简单“继续写下一章”，后端可直接调用 `PipelineRunner.writeNextChapter`，同时广播 `tool:start/end`。
5. 更复杂的自然语言请求进入 `runAgentSession`。
6. Agent 根据系统提示选择工具：`sub_agent`、`read`、`grep`、`edit`、`write_truth_file`、`short_fiction_run`、`generate_cover` 等。
7. 工具执行状态通过 SSE 返回前端，正文/思考流通过 delta 事件进入 UI。
8. 会话写入 transcript，可恢复、可迁移到某本书。

CLI 对话入口是 `inkos interact --json --message "..."`，实现位于 `packages/cli/src/commands/interact.ts`。它调用 Core 的 `processProjectInteractionInput`，返回 request、responseText、session、currentExecution、pendingDecision、events。这个入口适合 OpenClaw 或外部 Agent 使用。

## 6. 整体构建逻辑

InkOS 的构建逻辑分为三条主线。

### 6.1 产品入口线

- Web 用户走 Studio。
- 命令行用户走 `inkos write next`、`inkos book create`、`inkos short run` 等 CLI 命令。
- 终端交互用户走 TUI。
- 外部 Agent 走 `inkos interact --json` 或 OpenClaw skill。

这几种入口最终都落到 Core 的 PipelineRunner、StateManager、Interaction Runtime、Agent Tools 上。

### 6.2 创作执行线

典型长篇章节生成流程：

1. `StateManager.getNextChapterNumber` 确定下一章。
2. `PlannerAgent.planChapter` 生成章节 intent 和 7 段 memo。
3. `ComposerAgent.composeChapter` 收集上下文、构建 rule stack、写入 trace。
4. `WriterAgent.writeChapter` 读取 story bible、volume map、style guide、current state、hooks、summaries、character matrix 等。
5. Writer 先生成 creative draft，再 settle chapter state。
6. `runChapterReviewCycle` 执行长度归一、审计、AI tell、敏感词、post-write 检查和自动修订。
7. `persistChapterArtifacts` 保存正文、真相文件、章节索引、状态快照和 audit drift。

### 6.3 状态治理线

状态治理不是单文件，而是一组互相补位的文件：

- `book.json`：书籍基础配置。
- `story/author_intent.md`：长期作者意图。
- `story/current_focus.md`：未来 1-3 章的焦点。
- `story/outline/story_frame.md`：故事框架/硬设定。
- `story/outline/volume_map.md`：卷纲。
- `story/current_state.md` 与 `story/state/*.json`：当前事实状态。
- `story/pending_hooks.md`：伏笔账本。
- `story/chapter_summaries.md`：章节摘要。
- `story/subplot_board.md`：支线。
- `story/emotional_arcs.md`：情感弧线。
- `story/roles/*`、`character_matrix`：人物上下文。
- `story/style_guide.md`、`story/style_profile.json`：文风约束。
- `story/runtime/chapter-XXXX.*`：单章运行痕迹。

这种设计让“小说连续性”从 prompt 记忆转化为项目文件系统中的权威资料。

## 7. 可审计分析路径：替代“黑箱思维链条”

项目里的“思维链条”不应理解为暴露模型内部推理，而应理解为可审计的外部决策轨迹。InkOS 的可审计路径包括：

| 阶段 | 可审计产物 | 价值 |
|---|---|---|
| 规划 | `chapter-XXXX.intent.md` | 说明本章要写什么、保留什么、避免什么 |
| 备忘 | ChapterMemo 7 段结构 | 控制任务、读者期待、兑现/暂不揭示、章节尾变化 |
| 上下文选择 | `chapter-XXXX.context.json` | 说明本章取用了哪些记忆、设定、伏笔 |
| 规则栈 | `chapter-XXXX.rule-stack.yaml` | 说明当前规则层级和覆盖关系 |
| Trace | `chapter-XXXX.trace.json` | 追踪输入来源和运行路径 |
| 审计 | audit issues、overallScore | 说明为什么通过或失败 |
| 修订 | fixedIssues、patch/revisedContent | 说明修了什么 |
| 持久化 | chapter index、state snapshot | 说明最终保存状态 |

因此，本报告建议把“思维链条”表达为“创作决策审计链”。它能满足复盘、调试和人类审阅需要，同时避免依赖不可控的模型内部推理文本。

## 8. 文风锁机制

InkOS 的文风锁不是单点功能，而是四层约束：

1. `style_guide.md`：自然语言风格指南，Writer 和 Reviser 都会读取。
2. `style_profile.json`：由 `style-analyzer.ts` 从参考文本中抽取句长、段长、词汇多样性、开头模式、修辞特征等统计指纹。
3. Writer prompt：`writer-prompts.ts` 将 style guide、style fingerprint、genre rules、book rules 注入写作系统提示。
4. 审计与后处理：ContinuityAuditor 检查 Style Check、Lexical Fatigue、Cliche Density 等；`post-write-validator.ts` 检查报告腔、元叙事、重复标记词、章节号指称、段落形态等。

文风锁的优点：

- 能支持“仿写/迁移风格”，但不把风格完全交给模型主观理解。
- 统计指纹和文本指南互补：一个偏客观，一个偏审美。
- 修订器也读取风格上下文，避免越修越偏。
- deterministic validator 可以抓住 prompt 未必能稳定约束的问题。

可扩展点：

- 增加英文/中文分语言 style profile。
- 把 dialogue fingerprint 单独结构化，形成人物声线锁。
- 为不同平台建立 style presets，如番茄、起点、短篇反转、英文 KU。
- 增加章节级“风格漂移评分”，长期监测偏移。

## 9. 章节创作控制

章节控制是 InkOS 的核心工程能力，主要体现在以下机制。

### 9.1 Author Intent 与 Current Focus

`author_intent.md` 控制长期方向，`current_focus.md` 控制接下来 1-3 章的优先级。它们让用户可以在对话中改变方向，而不是直接干预底层状态。

### 9.2 Planner 的 7 段 Chapter Memo

Planner 要求输出章节 memo，包含：

- 当前任务。
- 读者此刻在等什么。
- 该兑现的 / 暂不揭的。
- 日常/过渡段承担什么任务。
- 关键抉择三连问。
- 章尾必须发生的改变。
- 本章 hook 账。
- 不要做。

这让每章不是“随便续写”，而是先确定功能，再生成正文。

### 9.3 Composer 的上下文治理

Composer 不直接把全书材料全部塞给 Writer，而是根据目标、outlineNode、mustKeep、hooks、memory selection 选择上下文。它会生成 context package、rule stack、trace，让输入可复盘。

### 9.4 字数与节奏控制

`buildLengthSpec` 定义 target、soft range、hard range。`runChapterReviewCycle` 先做 hard range 检查，必要时调用 LengthNormalizer，修订循环中也用长度作为硬门槛。

### 9.5 伏笔账本控制

`pending_hooks.md` 与 hook debt 逻辑让伏笔不只是“提过”，而是具备 open、advance、resolve、defer、stale、blocked、promoted 等治理维度。审计器会对过期核心伏笔、卷尾未处理核心 hook 等升级严重级别。

## 10. 审计逻辑

InkOS 的审计逻辑由 LLM 审计、规则检测、状态校验和修订循环组成。

### 10.1 LLM 维度审计

`ContinuityAuditor` 定义了 33+ 审计维度，基础维度包括：

- OOC 检查。
- 时间线检查。
- 设定冲突。
- 战力/能力体系。
- 数值一致性。
- 伏笔检查。
- 节奏检查。
- 文风检查。
- 信息越界。
- 词汇疲劳。
- 利益链断裂。
- 配角工具人化。
- 爽点虚化。
- 对话真实性。
- 流水账。
- POV 一致性。
- 段落等长。
- 套话密度。
- 公式化转折。
- 支线停滞。
- 情感弧线停滞。
- 读者期待管理。
- Chapter memo drift。

同人/衍生创作还扩展到角色还原、世界规则遵守、关系动态、正典事件一致性等。

### 10.2 规则型 AI 味检测

`ai-tells.ts` 通过规则检测：

- 段落长度过于均匀。
- hedge words 密度高。
- 转折词反复出现。
- 连续句子开头模式相同。

### 10.3 Post-write Validator

`post-write-validator.ts` 做无 LLM 成本的硬检查，例如：

- 禁止某些公式句式。
- 禁止破折号/元叙事/报告腔。
- 检查高疲劳词。
- 检查章节号指称。
- 检查集体震惊套话。
- 检查连续短段、段落形态。

这些规则能弥补 LLM 审计不稳定的问题。

### 10.4 Review Cycle

`runChapterReviewCycle` 的默认逻辑是：

1. 对硬字数漂移进行归一。
2. 审计正文。
3. 合并 LLM audit、AI tells、敏感词、post-write issues。
4. 以 `passed && score >= 85 && lengthInRange` 作为通过条件。
5. 未通过则自动修订，默认最多 1 轮。
6. 对修订结果再次审计。
7. 选择更优 snapshot，避免修订越修越坏。

这是一个保守但实用的闭环：质量不靠模型自觉，而靠外部循环判断。

## 11. 可扩展边界

InkOS 已经预留了较清晰的扩展边界。

### 11.1 模型与服务商扩展

扩展路径：`packages/core/src/llm/providers/endpoints`、`service-presets.ts`、`service-resolver.ts`。

可以新增：

- 新模型服务商。
- OpenAI-compatible 聚合商。
- 非流式优先策略。
- 服务商能力矩阵。
- 模型归属校验。

边界注意：

- API Key 必须继续走 `.inkos/secrets.json` 或 env，不应写入 `inkos.json`。
- Studio 与 CLI 的配置优先级要保持隔离。
- 文本模型与图像/embedding/rerank 模型需要继续区分。

### 11.2 Agent 扩展

扩展路径：`packages/core/src/agents`、`agent-tools.ts`。

可新增：

- Market Analyst：分析平台题材趋势。
- Character Voice Auditor：人物声线审计。
- Foreshadowing Planner：专门管理伏笔生命周期。
- Scene Choreographer：战斗/动作场面编排。
- Translation/Localization Agent：中英互译与本地化。

边界注意：

- 新 Agent 应输出结构化结果，而不是只返回散文。
- 应能被 PipelineRunner 或 agent tool 明确调用。
- 需要测试解析失败、空输出、超长上下文和状态回滚。

### 11.3 审计维度扩展

扩展路径：`continuity.ts`、`ai-tells.ts`、`post-write-validator.ts`。

可以扩展：

- 平台合规审计。
- 商业节奏审计。
- 短剧化冲突密度审计。
- 人物声线漂移审计。
- 伏笔兑现满意度评分。
- 标题相似度和章节开头重复检测。

边界注意：

- Critical 不宜过多，否则自动修订会陷入噪声。
- LLM 审计适合语义判断，规则审计适合硬模式检测。
- 审计输出应能映射到 Reviser 可执行修复建议。

### 11.4 前端扩展

扩展路径：`packages/studio/src/pages`、`components`、`store`、`hooks`。

可新增：

- 伏笔账本可视化图。
- 角色关系动态图。
- 章节节奏热力图。
- 审计问题趋势图。
- Prompt/上下文 trace 查看器。
- 多模型路由面板。
- 短篇生产看板。

边界注意：

- 长任务继续走 SSE，不要用前端轮询硬等。
- 新页面应复用 `useApi`、contracts、store 模式。
- 涉及写操作必须考虑 API invalidation。

### 11.5 文件与状态扩展

扩展路径：`StateManager`、`models/*`、`state/*`、`story/runtime/*`。

可新增：

- `story/voice_profiles.json`：人物声线结构化锁定。
- `story/commercial_metrics.json`：爽点、钩子、反转、高潮密度。
- `story/reader_questions.json`：读者期待问题池。
- `story/revision_history.jsonl`：修订历史。
- `story/continuity_graph.json`：实体、事件、物品关系图。

边界注意：

- 新状态必须有 schema 校验。
- Markdown projection 适合人读，JSON 适合机器读，两者不要互相替代。
- 状态更新应可回滚、可重建、可从章节 replay。

## 12. 风险与改进建议

### 12.1 当前风险

1. 中文源码注释和 README 在当前 Windows 控制台出现编码乱码，说明跨终端阅读体验存在风险。
2. 审计维度很多，若没有良好 UI 聚合，用户可能难以判断哪些问题真正重要。
3. 自动修订默认轮数较少，保守稳定，但对复杂结构性问题可能修不干净。
4. 规则检测里大量中文模式依赖固定词表，面对不同文风可能误报或漏报。
5. Studio `/api/v1/agent` 逻辑很长，模型解析、会话、直接写作、工具流、fallback 混在一起，后续维护成本会升高。

### 12.2 优先改进

| 优先级 | 建议 | 价值 |
|---|---|---|
| P0 | 把 Studio agent route 拆分为 session、model resolution、direct action、agent streaming 四个模块 | 降低维护复杂度 |
| P0 | 增加 trace 可视化页面 | 让章节为什么这样写可被用户理解 |
| P1 | 建立审计问题分组和趋势分析 | 从单章问题升级为全书治理 |
| P1 | 增加人物声线 profile | 强化长篇角色稳定性 |
| P1 | 增加 prompt/runtime artifact 查看器 | 方便调试 Planner/Composer/Writer |
| P2 | 增加规则检测配置化 | 让不同题材/平台调整 AI 味阈值 |
| P2 | 增加短篇商业指标面板 | 服务短篇/小程序/短剧化场景 |

## 13. 推荐扩展路线图

### 阶段一：可观测增强

- 新增 Studio 页面：Runtime Trace Viewer。
- 展示 intent、memo、context、rule stack、audit issues、revision diff。
- 把 `story/runtime/chapter-XXXX.*` 作为核心数据源。

### 阶段二：人物声线锁

- 从已写章节中提取每个角色的口头禅、句长、用词、情绪表达、行动模式。
- 写入 `story/voice_profiles.json`。
- Writer prompt 注入相关角色声线。
- Auditor 增加 voice drift 维度。

### 阶段三：伏笔与读者期待图谱

- 把 pending hooks 转成图结构。
- 标记 hook 的 chapter、status、depends_on、promoted、expected payoff。
- Studio 展示过期/受阻/待兑现。
- Planner 自动优先处理高风险 hook。

### 阶段四：平台化写作模板

- 题材规则继续保留在 genres。
- 增加 platform profile：番茄、起点、飞卢、英文 KU、短篇反转、小程序短剧。
- Platform profile 控制开头、节奏、章节断点、爽点密度、标题策略。

### 阶段五：多人/多 Agent 协作

- 会话级权限与版本历史。
- 审稿人模式。
- 编辑意见转 current_focus 或 revision plan。
- 支持团队对一本书进行协同规划。

## 14. 总结

InkOS 的真正强项，是把小说写作从“单次生成”提升成“可治理的创作系统”。它已经具备成熟项目的几个关键特征：入口多样、核心复用、状态可持久化、章节可审计、模型可替换、前端可观测、外部 Agent 可接入。

如果继续扩展，最值得坚持的原则是：所有创作自由都应进入可记录的运行产物，所有模型判断都应被规则、状态和人类可读文件校正。这样 InkOS 才能在长篇创作中越写越稳，而不是随着章节数增加逐步失控。

一句话判断：InkOS 不是“AI 写章节”，而是“用工程系统管理 AI 写小说”。
