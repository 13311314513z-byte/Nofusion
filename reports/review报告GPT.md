# NoFusion 当前代码 Review 报告

> 核查日期：2026-06-11  
> 核查基线：`0bca161 feat: expand nofusion workflows and reports` 加当前未提交工作区  
> 核查范围：`packages/core`、`packages/cli`、`packages/studio`、根目录构建与发布脚本、测试、前后端接口及主要用户链路

## 一、结论摘要

当前项目已经形成较完整的 AI 小说生产系统：Core 流水线、CLI、Studio、书籍工作区、服务商配置、文风分析、导入、审阅、续写、导出等模块均有实际代码和测试基础。Core 自动测试表现较好，类型检查全部通过，说明底层模型和主要算法并非原型状态。

但项目目前仍不适合直接作为稳定版本发布。主要原因不是页面或接口数量不足，而是少数关键闭环尚未收口：

1. Studio 服务端构建产物无法生成，根构建和发布包测试失败。
2. Studio 伏笔 CRUD 修改 Markdown 投影，Core 实际读取结构化 `hooks.json`，存在界面修改不生效及被后续写作覆盖的风险。
3. 书籍创建改为后台异步执行后，配置错误、状态转换、超时清理和既有测试契约没有同步完成。
4. 章节目标卡已经具备完整页面和 CRUD，但 Planner/Writer 不读取，属于“可配置但不生效”。
5. 章节正文版本保存、文风改写、Doctor 超时等功能存在可靠性或产品语义问题。

综合评估：

| 维度 | 估算完成度 | 判断 |
| --- | ---: | --- |
| Core 写作引擎 | 88% | 功能和测试较成熟，仍需加强统一状态边界 |
| CLI | 78% | 命令面较完整，Doctor 和发布测试未收口 |
| Studio 基础框架 | 80% | 页面覆盖广，路由和服务配置较完整 |
| 书籍工作区 | 72% | 多数页面可用，但伏笔、目标、版本链路存在断点 |
| 文风分析与调整 | 68% | 检测能力扩展明显，自动改写和部分组件尚未闭环 |
| 构建、发布与质量门禁 | 55% | build/test/lint/CI 当前均不能形成完整发布门禁 |
| **项目综合完成度** | **约 74%** | 已进入集成收口期，不应继续优先堆叠新页面 |

生产发布准备度低于功能完成度，约为 **60%**。下一轮应优先解决 P0 闭环和发布门禁。

---

## 二、P0 问题

### P0-01 Studio 服务端不产出构建文件，根构建和发布失败

**证据**

- 根 `tsconfig.json:15` 设置了 `"noEmit": true`。
- `packages/studio/tsconfig.server.json:2-8` 继承根配置，但没有覆盖 `noEmit`。
- `packages/studio/package.json:25-28` 在构建前删除 `dist/api`，随后执行 `tsc -p tsconfig.server.json`，最后强制检查：
  - `dist/api/index.js`
  - `dist/api/index.d.ts`
- 实测 `build:server` 返回成功，但没有生成上述文件，`build:verify` 报错：

```text
Missing: dist/api/index.js
```

**影响**

- `pnpm build` 失败。
- Studio npm 包的 `main` 和 `types` 指向不存在的文件。
- CLI 发布包测试无法包含 `package/dist/api/index.js`。
- 当前 `release` 脚本无法通过。

**建议**

1. 在 `packages/studio/tsconfig.server.json` 明确设置 `"noEmit": false`。
2. 明确设置服务端所需的 `declaration`、`declarationMap` 和输出结构。
3. 添加 Studio 服务端单独构建测试，不能只依赖文件存在检查。
4. 执行 `pnpm pack` 后检查压缩包，而不是只检查工作区 `dist`。

**验收标准**

- `pnpm build` 返回 0。
- `dist/api/index.js` 和 `dist/api/index.d.ts` 均存在。
- CLI `publish-package.test.ts` 通过。
- 三个 workspace 包均可完成 `pnpm pack --dry-run`。

### P0-02 伏笔编辑写入错误的数据层，可能不生效或丢失

**证据**

- Studio 的伏笔读取和 CRUD 直接操作 `story/pending_hooks.md`：
  - `packages/studio/src/api/server.ts:2470-2478`
  - `packages/studio/src/api/server.ts:2506-2583`
- Core 运行态首先读取结构化文件：
  - `packages/core/src/state/runtime-state-store.ts:30-39`
  - 实际来源是 `story/state/hooks.json`。
- 当 `hooks.json` 已存在且有效时，启动逻辑直接返回，不再从 Markdown 重新导入：
  - `packages/core/src/state/state-bootstrap.ts:249-267`
- Writer 根据结构化状态重新生成 `pending_hooks.md`：
  - `packages/core/src/agents/writer.ts:726-739`
- Studio 自建的 Markdown 序列化器与 Core 投影格式不一致：
  - Studio：`packages/studio/src/api/server.ts:2484-2504`
  - Core：`packages/core/src/state/state-projections.ts:15-71`
- Studio 序列化器没有保留 `promoted`，`dependsOn` 也没有按 Core 数组语义处理，并且没有统一的表格单元格转义。

**实际风险**

1. 用户在 Studio 修改伏笔后，下一次写作仍可能使用旧的 `hooks.json`。
2. Writer 完成章节后会重新生成 Markdown，覆盖 Studio 的修改。
3. 包含竖线、换行或扩展字段的数据可能损坏或丢失。
4. 前端显示成功不等于 Core 已接受修改。

**建议**

不要继续修补 Studio 私有 Markdown 解析器。应在 Core 提供统一的结构化伏笔服务：

1. 读取 `HooksState`。
2. 使用 Core schema 校验 `StoredHook`。
3. 在结构化状态上执行新增、更新和删除。
4. 原子保存 `hooks.json`。
5. 使用 `renderHooksProjection()` 重新生成 `pending_hooks.md`。
6. 必要时更新 manifest 和记忆索引。
7. Studio API 只调用 Core 服务，不再自行定义伏笔格式。

**验收标准**

- Studio 新增、编辑、删除伏笔后，`hooks.json` 与 Markdown 同步。
- 下一次 Writer 执行后修改仍然保留。
- `promoted`、依赖数组、特殊字符均可往返保存。
- 增加 API 到 Writer 的端到端测试。

### P0-03 书籍创建异步化后，接口契约和错误处理回归

**证据**

- 创建接口在 `packages/studio/src/api/server.ts:1802-1874` 启动 fire-and-forget 异步任务并立即返回。
- `buildPipelineConfig()`、LLM 配置检查和实际创建都在响应返回后执行。
- 超时 Promise 在 `packages/studio/src/api/server.ts:1824-1829` 创建，但成功或失败后没有清理定时器。
- 创建状态和清理定时器是模块级全局对象：
  - `packages/studio/src/api/server.ts:793-815`
- 实测 Studio 服务端有 5 项失败：
  1. `reports async create failures through the create-status endpoint`
  2. `surfaces LLM config errors during create instead of masking them as internal errors`
  3. `routes create requests through the shared structured interaction runtime`
  4. `omits empty blurb from create requests`
  5. `creates books with Studio Ollama config without requiring an API key`

**影响**

- 配置错误不能在创建请求阶段返回明确的 4xx。
- 请求返回时，测试和调用者不能确定运行时是否真正接收任务。
- 创建状态可能短时间一直为 `creating`。
- 定时器会在任务完成后继续存活至 10 分钟。
- 多个 Studio 实例共享同一状态 Map，存在测试污染和同 ID 冲突。

**建议**

1. 在入队前同步执行参数和 LLM 配置验证。
2. 创建显式任务对象，包含 `jobId`、`bookId`、`phase`、`startedAt`、`updatedAt`、`error`。
3. 成功入队返回 HTTP `202`，而不是普通 `200`。
4. 使用可取消任务或 `AbortController`，并在 `finally` 清理超时定时器。
5. 将状态表绑定到 `createStudioServer()` 实例，并提供 `dispose()`。
6. 测试使用可等待的任务调度器，避免依赖事件循环时序。

**验收标准**

- 上述 5 项测试全部通过。
- 配置无效时直接返回 400，任务不入队。
- 正常创建依次出现 `creating -> completed`。
- 异常创建依次出现 `creating -> error`，错误可由前端读取。
- 测试结束后无残留 timer 或后台任务。

---

## 三、P1 问题

### P1-01 章节目标卡没有进入 Planner/Writer

**证据**

- Core 定义并持久化章节目标：
  - `packages/core/src/models/chapter-goal.ts:10-78`
- Studio 提供完整读取、编辑、删除界面：
  - `packages/studio/src/pages/book-workspace/BookGoalsSection.tsx:80-180`
- Studio API 提供 CRUD：
  - `packages/studio/src/api/server.ts:6288-6344`
- 全局调用关系中，`loadChapterGoals()` 和 `getChapterGoal()` 仅用于模型、测试、Studio API；Pipeline、Planner、Writer 和 CLI 写作命令没有消费目标卡。

**影响**

`requiredBeats`、`forbiddenMoves`、`hookIdsToAdvance`、`targetMood`、`targetChars` 等字段在用户视角看似有效，实际不会约束生成内容。

**建议**

在 PipelineRunner 构建章节意图时加载目标卡，并将字段合并到统一规则栈：

1. 章节目标应高于普通建议，低于不可违反的世界观事实。
2. `requiredBeats` 进入 Planner 的必达事件。
3. `forbiddenMoves` 进入 Reviewer 和 Reviser 的硬约束。
4. `hookIdsToAdvance` 必须与结构化伏笔状态校验。
5. `targetChars` 同时约束生成预算和验收偏差。
6. 运行产物应记录每条约束的来源和执行结果。

### P1-02 章节保存与版本管理存在并发覆盖和元数据脱节

**证据**

- 保存逻辑在 `packages/studio/src/api/server.ts:1924-1962`：
  - 扫描目录计算下一版本号。
  - 先写备份，再直接覆盖正文。
  - 没有锁、期望版本或 ETag。
- 两个并发保存可能得到相同 revision，正文仍是最后写入者覆盖。
- 正文和备份均不是临时文件加原子 rename。
- 保存正文不会同步 `chapters/index.json` 中的 `revisionCount`。
- `revisionCount` 反而可由客户端通过元数据接口单独提交：
  - `packages/studio/src/api/server.ts:2091-2105`
- 后端只有版本列表和版本内容 GET：
  - `packages/studio/src/api/server.ts:1966-2006`
- Studio 前端没有消费章节版本接口，也没有恢复入口。

**建议**

1. 使用书籍级写锁或 `expectedRevision` 乐观锁。
2. 正文、版本文件和章节索引在一个受控保存操作中更新。
3. 使用临时文件加 rename，避免半写入。
4. `revisionCount` 只能由服务端维护。
5. 增加版本比较、恢复和恢复前自动备份。

### P1-03 “AI 改写”实际没有调用模型生成改写结果

**证据**

- 后端 `/style/rhetoric/rewrite` 只返回 prompt：
  - `packages/studio/src/api/server.ts:5735-5770`
- API Hook 也明确声明返回 `{ prompt: string }`：
  - `packages/studio/src/hooks/use-api.ts:206-208`
- ChapterReader 将 prompt 复制到剪贴板后忽略，随后执行本地同义词随机替换：
  - `packages/studio/src/pages/ChapterReader.tsx:529-565`
- 本地函数一次只替换首个命中的词，参数 `pattern` 没有参与选择：
  - `packages/studio/src/pages/ChapterReader.tsx:385-418`
- 如果没有命中，同样会按成功流程返回原文。
- 改写后延迟分析使用闭包中的旧状态，且存在恒真条件：
  - `packages/studio/src/pages/ChapterReader.tsx:567-577`

**影响**

- “AI 改写”标签与真实行为不符。
- 随机替换不可复现，可能改变语义。
- 没有 diff、确认、撤销和失败提示。
- 改写后分析可能仍针对旧文本。

**建议**

短期应将按钮改名为“生成改写提示词”或“本地快速替换”。如果保留“AI 改写”：

1. 后端真正调用已选择的服务商并返回候选文本。
2. 前端展示原文/候选 diff。
3. 用户确认后再写入编辑器。
4. 提供单步撤销。
5. 分析函数直接接收替换后的文本，不能等待闭包状态更新。

### P1-04 `StateManager.bookDir()` 未在核心边界阻止路径穿越

**证据**

- `packages/core/src/state/manager.ts:202-208` 直接执行：

```ts
return join(this.booksDir, bookId);
```

- `StateManager` 是 Core 公共能力，被 CLI、Studio、Pipeline 和交互工具大量调用。
- Core 层没有统一拒绝 `../`、绝对路径、路径分隔符或 Windows 保留名。

**影响**

上游任一入口漏校验时，恶意或错误的 `bookId` 可能定位到 `books` 目录之外。该问题属于文件系统安全边界问题，不应依赖每个调用者自行防守。

**建议**

- 在 `bookDir()` 内实施统一校验或 resolved-prefix 断言。
- 允许合法中文和其他 Unicode 文字。
- 拒绝 `/`、`\`、`.`、`..`、绝对路径和 Windows 保留名。
- 增加中文 ID、路径穿越、盘符路径、UNC 路径测试。

### P1-05 CLI Doctor 的超时不是总预算，真实耗时可成倍增长

**证据**

- `packages/cli/src/commands/doctor.ts:317-325` 将总预算计算为：

```text
模型候选数 × 协议方案数 × 单次超时
```

- 每次探测又创建单独的 `Promise.race` 定时器：
  - `packages/cli/src/commands/doctor.ts:333-341`
- 定时器未在请求提前完成时清理。
- 底层请求超时后仍可能继续运行。
- CLI 实测 `localhost OpenAI-compatible endpoints` 测试因 5 秒测试预算内实际运行约 10 秒而失败。

**建议**

1. 将命令参数定义为明确的“总超时”或“单次探测超时”，不能混用。
2. 使用统一 deadline 和 AbortSignal。
3. 每轮探测按剩余时间分配预算。
4. 清理定时器并中止底层 HTTP 请求。
5. 限制候选模型数量，或对无依赖探测并发执行。

### P1-06 文风作家 ID 规则不一致，中文作者无法完成蒸馏链路

**证据**

- 主文风库允许 Unicode 字母和数字：
  - `packages/core/src/style-library/store.ts:22-35`
- 蒸馏存储仅允许 ASCII：
  - `packages/core/src/style-library/distillation-store.ts:65-70`
- Studio 又复制了一套 ASCII 校验：
  - `packages/studio/src/api/server.ts:1725-1728`

**影响**

用户可创建 `余华`、`鲁迅` 等正常作家档案，但在蒸馏、版本发布或部分 Studio API 中被判定为非法 ID。

**建议**

将 ID 规则收敛到 Core 的单一导出函数，Studio 不再复制。若文件系统目录需要额外稳定性，可使用展示名称与内部 opaque ID 分离。

---

## 四、P2 问题与工程债务

### P2-01 `useApi()` 存在旧请求覆盖新页面数据的竞态

`packages/studio/src/hooks/use-api.ts:127-179` 在 path 改变或组件卸载时没有取消请求，也没有请求序号校验。旧请求晚返回时可以覆盖新 path 的数据或 loading 状态。

建议增加 `AbortController` 或 generation token，并让 `fetchJson()` 接受 `signal`。

### P2-02 Hash 路由不能容忍畸形 URI 编码

`packages/studio/src/hooks/use-hash-route.ts:33-64` 直接调用 `decodeURIComponent()`。例如手工输入包含孤立 `%` 的 hash 会抛异常，可能中断首次渲染或 `hashchange`。

已新增的 chapter/truth 正常、中文 ID、章节 0、非数字章节号和往返序列化测试均通过，但仍建议补充 malformed encoding 测试并安全回退到 Dashboard。

### P2-03 ChapterReader 文风分析为全有或全无

`packages/studio/src/pages/ChapterReader.tsx:448-482` 使用一个 `Promise.all()` 同时请求基础分析、完整诊断和修辞检测。任一接口失败会导致其余成功结果也不显示。

此外：

- 诊断和修辞语言写死为 `zh`。
- `rhetoricLoading` 状态已定义但没有形成独立加载流程。
- `document.querySelector("textarea")` 会选择页面第一个 textarea，缺少组件 ref。
- 存在未接入的替换辅助函数。

建议改为 `Promise.allSettled()`，各卡片独立展示错误，并从书籍语言或检测结果决定语言。

### P2-04 多个已开发组件没有进入实际页面

以下组件只有定义，没有实际页面引用：

- `components/readability/RhetoricHighlightEditor.tsx`
- `components/author/AuthorSearchPanel.tsx`
- `components/author/AuthorProfileCard.tsx`
- `components/author/DimensionSamplePreview.tsx` 仅被未挂载的 AuthorProfileCard 使用

这说明作者搜索、完整档案卡和编辑器内高亮仍停留在组件层，不能计入用户可用完成度。应决定接入或删除，避免继续维护孤立实现。

### P2-05 Studio 首屏包体过大，页面没有路由级拆包

**实测**

- Studio client build 成功。
- 主文件约 `2746.57 kB`，gzip 后约 `764.33 kB`。
- 构建出现多个大于 500 kB 的 chunk 警告。

`packages/studio/src/App.tsx:5-25` 静态导入全部主要页面，没有 `React.lazy()`。文风、聊天、代码高亮等重模块会进入初始依赖图。

建议：

1. 对 Style、Import、Audit、Doctor、Cover、BookWorkspace 等非首屏页面使用路由级 lazy。
2. 审核 Streamdown、Shiki 语言包和主题是否全量打包。
3. 移除对 `use-api` 的无效动态 import；该模块已被全局静态导入，无法形成独立 chunk。
4. 建立 bundle size 门限。

### P2-06 根 lint 脚本不可执行，且没有 CI

- 根 `package.json:27` 定义 `"lint": "pnpm -r lint"`。
- Core、CLI、Studio 都没有 `lint` script。
- 实测 `pnpm lint` 失败。
- 仓库没有 `.github` 目录和 CI workflow。

建议先建立最小门禁：

```text
typecheck -> unit tests -> build -> pack verification
```

Lint 可在规则确定后加入，但根脚本不应长期处于必然失败状态。

### P2-07 Studio API 单文件规模过大

`packages/studio/src/api/server.ts` 已超过 6400 行并注册约 142 个路由。书籍、服务商、导入、文风、审阅、角色、章节目标等领域都集中在同一文件，导致：

- 模块级状态易互相污染。
- 私有 schema 和 Core schema 重复。
- 测试 mock 边界难以稳定。
- 新功能更容易绕过统一状态服务。

建议在 P0 修复后按领域拆分 router 和 service，但不要在修复 P0 时进行大规模重构。

### P2-08 运行数据与源码工作区缺乏隔离

当前工作区有约 413 条状态记录，`git diff` 显示 395 个文件变化、约 2187 行新增和 12012 行删除，其中包含大量 `books` 运行数据变化。

这会造成：

- 测试结果和业务样本混入提交。
- 难以判断真实代码 diff。
- 发布时容易误删或误提交书籍数据。

建议将自动测试统一放入临时根目录，将固定示例放入 `fixtures`，并明确哪些 `books` 内容属于版本资产。

---

## 五、功能模块遍历结果

说明：本轮“遍历”包括全仓文件和调用关系检索、API/页面映射、自动测试、构建及关键链路代码审查；不包含真实浏览器逐像素视觉验收，也没有使用真实付费 LLM Key 发起外网生成。

| 模块 | 前端状态 | 后端/Core 状态 | 端到端判断 | 主要问题 |
| --- | --- | --- | --- | --- |
| Dashboard / 书籍列表 | 已实现 | 书籍摘要和状态接口已实现 | 基本对齐 | 运行数据较多时需继续验证性能 |
| 新建书籍 | 页面、轮询、SSE 已实现 | 创建已改为异步任务 | **未收口** | P0-03，错误和测试契约回归 |
| 书籍总览 | 已实现 | 多类摘要接口已实现 | 基本对齐 | 依赖 bookId 和状态一致性 |
| 章节列表 | 已实现 | index、正文、元数据接口已实现 | 基本对齐 | revision 元数据不同步 |
| 章节阅读与编辑 | 已大幅扩展 | 正文保存和版本 GET 已实现 | 部分对齐 | 并发覆盖、无恢复 UI |
| 章节审阅 | 已实现 | Audit/Reviewer 能力较完整 | 基本对齐 | 需增加失败降级和长任务反馈 |
| 章节目标 | 完整 CRUD 页面 | Core 存储和 API 已实现 | **表面完成** | Planner/Writer 完全不消费 |
| 角色档案 | 页面和 CRUD 已实现 | Role Card API 已实现 | 基本对齐 | 应继续验证写作流水线实际引用 |
| 场景/世界观/真相 | 页面已实现 | 对应 story 文件和接口存在 | 基本对齐 | 应统一结构化状态来源 |
| 伏笔 | CRUD 页面已实现 | Studio 写 Markdown，Core 读 JSON | **严重不对齐** | P0-02 |
| 摘要/记忆 | 页面和 Core 能力存在 | 结构化摘要和记忆检索较成熟 | 较好 | 需统一所有手工编辑入口 |
| Fanfic / 衍生写作 | 页面和 Pipeline 能力存在 | Core 有专用流程 | 基本具备 | 需要浏览器端真实样本验收 |
| 导出 | 前后端和 CLI 均有实现 | 多格式导出能力存在 | 基本具备 | 发布构建失败会阻断交付 |
| Chat / Agent | 交互页和工具步骤已实现 | 结构化 interaction runtime 较完整 | 较好 | 书籍创建异步调用测试回归 |
| 服务商管理 | 页面、模型列表、测试连接已实现 | 分服务商配置和模型发现已实现 | 较好 | 仍需网络失败与超时统一 |
| API Key 输入 | 专用组件已实现 | 分服务商保存已有测试 | 较好 | 已加入密码管理器规避属性 |
| 文风分析 | 多标签和诊断面板已实现 | Core 检测能力较丰富 | 部分对齐 | 全有或全无、语言写死 |
| 文风调整 | 页面和建议组件已扩展 | Prompt 生成已实现 | **未完整实现** | “AI 改写”实际为本地随机替换 |
| 作家档案/蒸馏 | 后端能力和部分页面存在 | Store、distillation、版本能力存在 | 部分对齐 | 中文 ID 规则冲突，部分组件未挂载 |
| 导入/预处理 | 页面和接口较完整 | URL/文件处理含 SSRF 防护 | 较好 | 需继续做大文件和重定向实测 |
| Radar / Analytics | 页面已实现 | Core/接口已有统计来源 | 基本具备 | 需以真实多书籍数据验收准确性 |
| Doctor | Studio/CLI 均有入口 | 检测能力存在 | 部分可用 | CLI 超时预算错误 |
| Daemon / 自动化 | 控制页和调度器存在 | Core scheduler 已实现 | 基本具备 | 需测试退出时资源释放 |
| 日志 | 页面与日志来源存在 | 相关接口存在 | 基本具备 | 需验证大日志和脱敏 |
| 封面配置 | 页面和服务商能力存在 | 图像服务配置已扩展 | 基本具备 | 需真实服务商验收 |
| 国际化/主题 | 中英文和主题 Hook 已实现 | 不依赖后端 | 基本具备 | 新增文案仍需做缺失键扫描 |
| Hash 路由 | chapter/truth 已补齐 | 不涉及后端 | 已通过专项测试 | 畸形 URI 仍需容错 |

---

## 六、自动验证结果

### 1. 类型检查

命令：

```powershell
pnpm.cmd typecheck
```

结果：**通过**

- Core：通过
- Studio：通过
- CLI：通过

### 2. Core 测试

结果：**通过**

- 121 个测试文件通过
- 1294 项测试通过

这说明 Pipeline、State、Agent、Style、Memory、Import 等底层能力整体稳定，是当前项目最可靠的部分。

### 3. Studio 测试

结果：**失败**

- `server.test.ts`：90 项通过，5 项失败
- 失败项均集中于异步创建书籍契约，见 P0-03。

Hash 路由专项测试：

- 32 项全部通过。
- 已覆盖 chapter/truth 正常路由、中文 ID、章节 0、非数字章节号和序列化往返。

### 4. CLI 测试

独立执行结果：

- 169 项通过
- 2 项失败

失败原因：

1. Doctor 本地 OpenAI 兼容端点测试超时。
2. 发布包缺少 Studio `dist/api/index.js`。

### 5. 构建

命令：

```powershell
pnpm.cmd build
```

结果：**失败**

- Core 构建通过。
- Studio client 构建通过。
- Studio server 没有生成 `dist/api`。
- `build:verify` 因缺少 `dist/api/index.js` 失败。

### 6. Lint

命令：

```powershell
pnpm.cmd lint
```

结果：**失败**

原因：根脚本要求递归执行 lint，但三个 package 均没有 lint script。

### 7. 发布 manifest 校验

命令：

```powershell
pnpm.cmd verify:publish-manifests
```

结果：**通过**

说明 workspace 协议发布转换检查正常，但不能替代实际构建产物和 pack 校验。

---

## 七、当前代码中的可靠实现

以下部分不建议在下一轮大规模重写：

1. Core 测试覆盖和 Pipeline 主体已较成熟。
2. 结构化运行态、Markdown 投影和状态校验方向正确。
3. `chapter-goals.json` 使用临时文件加 rename，持久化方式优于 Studio 章节保存。
4. 服务商 API Key 已按服务商隔离，模型发现和下拉数据链路已有较多测试。
5. `ApiKeyInput` 已设置随机 name、`data-lpignore`、`data-1p-ignore`、`data-bwignore` 等属性，能降低密码管理器干扰。
6. URL 导入对本机、私网、重定向和响应大小已有安全约束。
7. Hash 路由补丁保持了较小改动面，专项测试已覆盖主要边界。
8. 发布 manifest 的 workspace 协议检查已通过。

下一轮应围绕这些现有机制补齐闭环，而不是另建平行存储或重复 schema。

---

## 八、建议迭代顺序

### 第一阶段：恢复发布门禁

目标：任何功能开发前，先让仓库具备可验证的发布基线。

1. 修复 Studio server emit。
2. 修复 Studio 5 项创建测试。
3. 修复 CLI 2 项失败。
4. 处理根 lint 脚本。
5. 增加最小 CI。

完成标准：

```text
typecheck PASS
test PASS
build PASS
pack verification PASS
```

### 第二阶段：统一书籍状态写入边界

1. 伏笔 CRUD 改为结构化状态服务。
2. 章节目标接入 Planner/Writer/Reviewer。
3. 手工编辑角色、真相、摘要等入口逐一确认是否修改 Core 真正读取的数据源。
4. 为每个工作区编辑页增加“UI 修改 -> 下一次写作读取 -> 写作后仍保留”的链路测试。

### 第三阶段：完成章节编辑闭环

1. 章节保存加锁或 revision 校验。
2. 正文、备份、index 原子更新。
3. 增加版本历史、diff、恢复和撤销。
4. 修正文风改写产品语义。
5. 分析结果改为独立失败、独立重试。

### 第四阶段：整理文风和作家档案

1. 合并 authorId 校验。
2. 接入孤立的作者搜索、档案卡和修辞高亮组件。
3. 实现真正的服务商改写调用。
4. 记录作家档案来源、版本、适用范围和改写依据。

### 第五阶段：性能与维护性

1. Studio 路由级拆包。
2. 拆分 `server.ts` 领域 router。
3. 为 API 建立统一输入 schema、错误格式和超时策略。
4. 隔离 fixtures、测试数据和用户书籍。
5. 建立 bundle size、路由数量和未引用组件检查。

---

## 九、下一轮建议验收清单

### 必须通过

- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] 三个包均可 pack，Studio 包含 `dist/api/index.js`
- [ ] 创建书籍成功、失败、超时、Ollama 无 Key 四条链路
- [ ] Studio 修改伏笔后 Core 下一章能读取
- [ ] 章节目标字段能影响 Planner 输入和 Reviewer 验收
- [ ] 两个并发章节保存不会静默覆盖
- [ ] 章节历史可查看并恢复
- [ ] 中文作家 ID 可完成档案到蒸馏全流程

### 建议通过

- [ ] Hash 畸形编码安全回退
- [ ] `useApi` 快速切页无旧数据覆盖
- [ ] 文风三个子分析可部分成功
- [ ] 中英文书籍分析语言正确
- [ ] Studio 首屏主包明显下降
- [ ] 测试后工作区不产生大量书籍数据 diff

---

## 十、最终判断

NoFusion 已经越过“概念验证”阶段，当前最需要的是系统集成和工程收口。Core 的功能深度与测试数量足以支撑继续发展，但 Studio 的若干新增页面没有沿用 Core 的结构化状态边界，造成“前端看似完成、后端真正执行时不生效”的问题。

建议暂停新增同类页面一轮，先完成以下四个结果：

1. 仓库能够完整构建、测试和打包。
2. 所有书籍工作区编辑操作都写入 Core 的唯一事实源。
3. 章节目标和伏笔真实进入写作决策。
4. 章节编辑具备并发保护、历史和恢复。

完成上述内容后，项目综合完成度预计可由约 74% 提升到 82% 至 85%，并具备更可信的试用发布条件。

