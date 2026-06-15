# NoFusion 各模块功能测试与扩展建议报告 GPT

> 报告日期：2026-06-12  
> 项目目录：`C:\Users\white\Downloads\Nofusion-main`  
> 版本基线：`@actalk/inkos` v1.4.1，Git `master`，当前提交 `5bef484` + 工作区未提交改动  
> 测试环境：Windows / Node.js v24.14.0 / pnpm 11.5.2  
> 测试原则：以本次实际执行结果为准；不把静态核查写成运行通过；不调用真实 LLM 生成任务，不消耗项目 API Key

---

## 一、执行结论

### 1.1 总体判断

项目核心创作能力、CLI、Studio API 和大部分前端状态逻辑已具备较高完整度。Core 与 Studio 自动化测试全绿，生产构建成功，Studio 本地启动及基础 API 冒烟成功。

当前仍不建议直接作为“全绿发布基线”，原因有三项：

1. **Studio 客户端类型检查失败**：`ImportManager.tsx` 有 4 个 `TS18047`。
2. **CLI 测试未全绿**：localhost 模型端点场景下 `doctor` 集成测试超过 5 秒。
3. **章节导入起始编号没有贯穿提交阶段**：预览阶段生成了 `targetNumber`，提交时只传 `title/content`，用户填写的 `startNumber` 会被静默丢弃。

### 1.2 自动化测试结果

| 工作区 | 测试文件 | 通过 | 失败 | 结果 |
|---|---:|---:|---:|---|
| `@actalk/inkos-core` | 121 | 1294 | 0 | 通过 |
| `@actalk/inkos` CLI | 34 | 170 | 1 | 未全绿 |
| `@actalk/inkos-studio` | 25 | 277 | 0 | 通过 |
| **合计** | **180** | **1741** | **1** | **基本健康，存在门禁失败** |

CLI 唯一失败：

```text
CLI integration > inkos doctor >
treats localhost OpenAI-compatible endpoints as API-key optional
Test timed out in 5000ms
```

### 1.3 工程门禁与冒烟结果

| 核验项 | 结果 | 说明 |
|---|---|---|
| Core typecheck | 通过 | `tsc --noEmit` |
| CLI typecheck | 通过 | 包含 workspace Core 预构建 |
| Studio server typecheck | 通过 | `tsc -p tsconfig.server.json --noEmit` |
| Studio client typecheck | **失败** | `foundationPlan.roleChanges` 可能为 `null`，4 处错误 |
| 根目录 `pnpm typecheck` | **失败** | 被 Studio 客户端类型错误阻断 |
| 根目录 `pnpm build` | 通过 | Core、Studio client/server、CLI 均生成产物 |
| 发布 manifest 校验 | 通过 | 三个包均无发布态 `workspace:*` 泄漏 |
| CLI `--version` / `--help` | 通过 | 输出 v1.4.1 与完整命令列表 |
| `doctor --skip-connectivity --json` | 通过 | 项目、Node、SQLite、配置、书籍迁移检查完成 |
| Studio 首页冒烟 | 通过 | HTTP 200，包含 React root |
| Studio `/api/v1/project` | 通过 | HTTP 200 |
| Studio `/api/v1/books` | 通过 | HTTP 200 |

注意：Studio 的 Vite 构建不执行完整客户端类型检查，因此出现了“`pnpm build` 通过，但 `pnpm typecheck` 失败”的门禁分裂。

### 1.4 本次未执行项

- 未发起真实 LLM 写书、审计、修订、封面生成，避免产生费用及修改用户书籍。
- 未向 Telegram、飞书、企业微信或自定义 Webhook 发送真实消息。
- 未执行真实 daemon 长时间调度。
- 未进行浏览器端人工视觉回归、移动端适配和长时间稳定性测试。

---

## 二、优先处理清单

| 优先级 | 问题 | 影响 | 建议验收标准 |
|---|---|---|---|
| P0 | Foundation Plan 可空契约导致 Studio typecheck 失败 | 发布门禁不全绿，空计划页面可能崩溃 | `pnpm typecheck` 全绿；空计划页面正常显示“无变更” |
| P0 | 章节导入 `startNumber` 提交时丢失 | 章节编号与用户预期不一致，可能导入到错误位置 | 从第 5 章导入后实际文件和 index 均从 5 开始 |
| P1 | CLI `doctor` localhost 集成测试超时 | 根测试和 release 失败 | CLI 全部 171 项通过；超时后底层请求被取消 |
| P1 | `release` 未显式执行 typecheck | 构建可绕过客户端 TS 错误 | `release = typecheck + build + test + manifest verify` |
| P1 | 章节版本历史只有后端 API | 已保存备份但用户无法查看、对比和恢复 | Studio 可列表、预览 diff、恢复指定版本 |
| P1 | Foundation Plan 只存在内存 30 分钟 | 服务重启或多实例时预览失效 | Plan 可持久化并可清理过期数据 |
| P1 | Source 工作区只能查看和删除 | 导入流程无法在书籍工作区闭环 | 支持上传、预览、用途选择和增量导入 |
| P2 | Studio 首屏主包约 2.75 MB | 首次加载和低配设备体验受影响 | 路由级拆包；主入口 gzip 显著下降 |

---

## 三、逐项模块测试与扩展建议

### 模块 1：项目初始化与配置管理

**已验证**

- CLI 初始化、项目配置读写、模型覆盖、运行时要求相关测试通过。
- Core 的配置加载、迁移、有效 LLM 配置、服务解析、Secrets 测试通过。
- `doctor --skip-connectivity --json` 能识别当前项目、Node 版本、SQLite、书籍和配置来源。
- 发布 manifest 校验通过。

**当前缺口**

- CLI `findProjectRoot()` 仍直接返回 `process.cwd()`，在项目子目录运行命令时不向上查找 `inkos.json`。
- 配置入口分布于项目配置、书籍配置、服务配置和环境变量，用户难以快速判断最终生效值。
- `doctor --skip-connectivity` 把 Connectivity 记录为 `ok: false`，但命令整体仍返回成功，机器消费语义不够明确。

**扩展建议**

| 优先级 | 建议 | 价值 |
|---|---|---|
| P1 | `findProjectRoot()` 向父目录遍历，直到找到 `inkos.json` | 支持在书籍、章节等子目录运行 CLI |
| P2 | 增加“最终有效配置”只读面板和配置来源链 | 降低 Studio/env/CLI 覆盖关系的排查成本 |
| P2 | 为 `doctor` 增加 `passed/skipped/failed` 三态 | 避免 skipped 被误解为 failed |
| P3 | 配置快照、diff 与回滚 | 降低模型和写作参数误改风险 |

---

### 模块 2：书籍创建与生命周期

**已验证**

- Core 书籍模型、Book Session、StateManager、项目交互测试通过。
- Studio 异步建书已采用 `202 + jobId`，并提供 `create-status` 轮询状态。
- Dashboard 和 Sidebar 可进入 Chat 建书流程。
- 书籍列表、详情、状态、删除和配置 API 均有自动化覆盖。

**当前缺口**

- `BookCreate.tsx` 已实现完整表单和轮询逻辑，但 App 当前把 `book-create` 路由渲染为 `ChatPage`，表单组件没有进入实际路由。
- Core 支持 `incubating`，Studio `BookDetail.tsx` 的 `BookStatus` 和下拉选项未包含该状态。
- Chat 建书与表单建书存在两套逻辑，继续并存会造成字段、校验和错误处理漂移。

**扩展建议**

| 优先级 | 建议 | 价值 |
|---|---|---|
| P1 | 明确单一建书入口：删除未使用表单，或将表单作为 Chat 的结构化前置步骤 | 消除重复实现 |
| P1 | Studio 补齐 `incubating` 状态及 i18n | 完整表达书籍生命周期 |
| P2 | 建书后增加配置确认页 | 避免默认章节数和字数不适配短篇 |
| P2 | 建书 Job 增加阶段、耗时和重试信息 | 提高长任务可观测性 |

---

### 模块 3：资料与章节导入

**已验证**

- Core Foundation Source、Foundation Import、Chapter Import Planner 测试通过。
- 章节预览阶段支持 `splitRegex` 和 `startNumber`，并有 `respects startNumber option` 单测。
- Foundation 导入支持 Plan/Commit、revision 校验和 30 分钟过期。
- 正典导入、同人初始化端点存在并有相关覆盖。

**明确问题**

1. `ImportManager` 将 `roleChanges` 定义为可空，但页面直接调用 `.added/.updated/.removed`，产生 4 个类型错误。
2. 后端空计划返回 `planId: null`、`roleChanges: null`，前端缺少空态渲染。
3. 章节 Commit 将计划转换为 `{ title, content }` 后调用 `pipeline.importChapters`，`targetNumber` 被丢弃。
4. `BookSourceSection` 只有列表和删除，没有上传、预览或增量导入入口。
5. Foundation Plan 只保存在进程内 Map，重启或多实例部署会失效。
6. 当前导入格式仍以 txt/md/json/jsonl 为主，DOCX/PDF 未接入。

**扩展建议**

| 优先级 | 建议 | 价值 |
|---|---|---|
| P0 | 空计划统一返回非空 `roleChanges`，前端同时做 null guard | 修复类型门禁和运行时风险 |
| P0 | Commit 保留 `targetNumber`，并增加 API 集成测试 | 保证起始章节号真实生效 |
| P1 | Source 工作区增加上传、用途、预览和 Commit | 形成书内资料治理闭环 |
| P1 | Plan 持久化到 `.inkos/plans` 或数据库 | 支持重启恢复和多实例 |
| P2 | 接入 DOCX；PDF 先做文本型 PDF，扫描件单独 OCR | 覆盖常见手稿来源 |
| P2 | 导入前自动执行预处理并展示清洗 diff | 降低噪声进入 Architect 的风险 |

---

### 模块 4：世界观与 Truth 文件

**已验证**

- 新旧 Truth 路径兼容、Phase 5 authority、状态投影和 Truth 校验测试通过。
- Studio Truth 列表、读取和编辑端点存在。
- legacy shim 对新布局书籍会返回只读信息，避免写入无效旧文件。
- 结构化 JSON 状态与 Markdown 投影的主要链路有测试覆盖。

**当前缺口**

- Truth 文件缺少跨文件引用和反向引用。
- 变更历史、diff 和冲突检测尚未形成用户可见能力。
- legacy shim 的只读提示需要在所有入口保持一致，尤其 Chat 侧边栏和直接编辑入口。

**扩展建议**

| 优先级 | 建议 | 价值 |
|---|---|---|
| P1 | 统一处理 409 legacy shim，提供权威文件跳转 | 避免用户编辑无效文件 |
| P2 | 增加 Truth 变更历史和 diff | 可追踪世界观演进 |
| P2 | 建立角色、地点、伏笔、章节之间的反向链接 | 提升导航和核查效率 |
| P3 | 增加事实冲突扫描和修复建议 | 提高长篇一致性 |

---

### 模块 5：角色与实体管理

**已验证**

- Role Card 模型、解析、CRUD 和实体重命名相关测试通过。
- Studio 支持角色层级、标签、别名、状态和正文描述。
- 章节元数据已有 POV 字段，可用于角色出场统计的基础数据。

**当前缺口**

- 角色关系仍主要依赖 Markdown 自由文本，缺少可计算的关系动态模型。
- 没有完整 NER 导入流程，已有文本中的角色需要大量人工维护。
- 没有实体关系图和跨章节角色弧线可视化。

**扩展建议**

| 优先级 | 建议 | 价值 |
|---|---|---|
| P1 | 新增结构化 `relationship_dynamics` | 让 Planner/Auditor 可消费冲突、秘密和关系变化 |
| P2 | 自动提取角色候选并要求人工确认 | 降低导入维护成本 |
| P2 | 角色出场、POV、关系变化统计 | 支撑角色戏份和平衡分析 |
| P3 | 实体图谱与时间轴联动 | 增强复杂世界观理解 |

---

### 模块 6：场景与地点管理

**已验证**

- 章节元数据支持 location、timeOfDay、moodScore。
- `BookScenesSection` 能按地点聚合章节，并提供地点别名提示。
- 章节列表支持按 location 筛选。

**当前缺口**

- location 仍是字符串，不是稳定实体。
- 没有场景卡、地点卡、感官信息、天气、空间关系和访问规则。
- Planner 还不能按 `sceneId` 注入稳定场景约束。

**扩展建议**

| 优先级 | 建议 | 价值 |
|---|---|---|
| P1 | 新增 `SceneCard/LocationCard` 数据模型 | 提升空间描写和地点命名一致性 |
| P2 | 章节元数据改为 `sceneId + displayName` | 避免纯字符串漂移 |
| P2 | Planner 注入氛围、感官、在场角色和场景禁忌 | 提高场景写作可控性 |
| P3 | 地图、移动路径和场景时间线 | 支撑复杂空间叙事 |

---

### 模块 7：章节规划、写作与版本

**已验证**

- Planner、Composer、Writer、Auditor、Reviser、长度归一化和完整 Pipeline 测试通过。
- `chapter_goals.json` 已由 Planner 读取，required beats、forbidden moves、target chars、hook IDs 已注入提示。
- Studio 已提供章节目标编辑页面。
- 章节保存有 per-chapter 锁、版本备份和最多 50 个版本的数字排序清理。
- 前序章节锁失败后，后续保存通过 `.catch(() => undefined)` 继续执行。

**当前缺口**

- 版本列表和读取 API 已存在，但 Studio 没有版本历史、diff 和恢复 UI。
- 保存接口没有 `expectedRevision`、ETag 或内容 hash 比对，多窗口编辑仍可能后写覆盖先写。
- 写作目标已接入 Planner，但缺少“实际生成结果是否满足目标”的结构化验收。
- 锁只在单进程内有效，多实例或外部编辑器并发时无保护。

**扩展建议**

| 优先级 | 建议 | 价值 |
|---|---|---|
| P1 | 增加版本历史、diff、恢复操作 | 把已有备份能力交付给用户 |
| P1 | 保存接口增加 `expectedRevision` 并在冲突时返回 409 | 防止静默覆盖 |
| P2 | 写后生成 Goal Fulfillment Report | 验证 required/forbidden/hook 是否兑现 |
| P2 | 将章节锁升级为文件锁或持久化 revision | 支持多进程 |
| P3 | 写作过程实时显示字数、目标和偏离 | 提升生成过程掌控感 |

---

### 模块 8：审计、检测与质量治理

**已验证**

- 连续性审计、AI 痕迹、章节真相校验、Hook 健康、语义重复和后写验证测试通过。
- Studio 支持单章审计、修订、全书检测、统计和审计工作区。
- 审计可读取风格蒸馏规则。

**当前缺口**

- 审计问题与正文的精确定位仍不统一。
- 缺少按规则、章节、时间统计的质量趋势。
- 自定义审计规则尚未形成受控的配置和验证机制。

**扩展建议**

| 优先级 | 建议 | 价值 |
|---|---|---|
| P1 | 审计 issue 统一携带字符范围和证据片段 | 支持一键定位与修复 |
| P2 | 增加质量趋势、复发问题和修订收益图 | 判断长期写作质量 |
| P2 | 支持书级自定义规则并提供 schema 校验 | 满足不同题材和平台要求 |
| P3 | 建立审计基准集和模型回归评测 | 防止 Prompt/模型升级造成质量退化 |

---

### 模块 9：文风、修辞与作家蒸馏

**已验证**

- Style Analyzer、Style Diagnostics、AI Tells、Style Comparator、Style Adjuster 等 Core 测试通过。
- Studio 文风分析、诊断、作者画像、对比、调整建议和自动复检链路存在。
- 章节阅读器可展示修辞检测并定位示例文本。
- 修辞相关旧编辑器已移除，当前实现集中到实际页面。

**当前缺口**

- 修辞 rewrite API 仍主要返回 prompt，而不是稳定的服务端改写结果。
- 作家蒸馏已有生成、读取、更新、发布、版本 5 个后端端点，但前端没有完整工作台。
- 诊断可以保存，但历史读取、对比和回滚体验不足。

**扩展建议**

| 优先级 | 建议 | 价值 |
|---|---|---|
| P1 | 建立作家蒸馏工作台：规则证据、启停、编辑、发布、版本 | 交付已完成的后端能力 |
| P2 | 修辞改写返回候选文本、diff 和质量复检 | 避免用户手工复制 prompt |
| P2 | 诊断历史列表和版本对比 | 追踪文风调整效果 |
| P3 | 章节级风格目标与允许偏差 | 从被动检测升级为主动控制 |

---

### 模块 10：导出与发布物

**已验证**

- txt、md、html、epub 的构建与保存链路存在。
- Studio `export-save` 已增加运行时格式白名单。
- CLI 导出和交互式导出相关测试通过。
- 预导出检查可提示章节、审计和 Hook 状态。

**当前缺口**

- CLI 帮助只声明 txt/md/epub，底层类型允许 html，能力说明不完全一致。
- DOCX/PDF 导出缺失。
- 缺少版式模板、卷级导出和多书批量导出。

**扩展建议**

| 优先级 | 建议 | 价值 |
|---|---|---|
| P1 | 统一 Core、CLI、Studio 的格式枚举和帮助文案 | 避免契约漂移 |
| P2 | 增加 DOCX 导出 | 满足投稿、批注和编辑需求 |
| P2 | 增加字体、页眉、卷首、章节分页模板 | 提高交付物专业度 |
| P3 | 批量导出和外部存储目标 | 提高多项目运营效率 |

---

### 模块 11：Daemon、调度与通知

**已验证**

- Scheduler、daemon CLI 和 Studio daemon 生命周期测试通过。
- 配置支持 cron、并发书籍数、每周期章节数、重试、冷却和每日上限。
- 通知支持 Telegram、飞书、企业微信和 Webhook。
- 通知测试端点包含私网 URL 防护测试。

**当前缺口**

- Studio 只暴露全局 running 状态，缺少书级队列和下一次执行时间。
- 调度历史、失败重试历史和每日配额使用情况不可见。
- 通知测试结果主要存 localStorage，不是可审计的服务端历史。

**扩展建议**

| 优先级 | 建议 | 价值 |
|---|---|---|
| P1 | 增加 daemon 队列、当前任务、下次执行和配额面板 | 提升自动写作透明度 |
| P2 | 支持 per-book 暂停、恢复和优先级 | 精细控制自动化 |
| P2 | 持久化调度与通知历史 | 支持故障追踪 |
| P3 | 增加退避策略、熔断和费用上限 | 控制连续故障与模型费用 |

---

### 模块 12：Chat、Agent 与会话

**已验证**

- Interaction Runtime、自然语言路由、Agent Tools、Session Transcript 测试通过。
- Studio Chat 工具步骤、消息 parts、会话和 SSE 测试通过。
- 全局 SSE 已注册 `tool:start`、`tool:update`、`tool:end`，侧边栏状态链路已补齐。
- TUI 的布局、输入历史、slash 补全、dashboard 和会话测试通过。

**当前缺口**

- Chat、Studio、TUI、CLI 的 JSON/事件 schema 仍有局部差异。
- Agent 执行历史缺少按书籍、章节、工具和错误检索的归档界面。
- 部分 Studio 文案仍直接写在组件内。本次统计约 2067 行 Studio 源码包含中文字符，其中包含合理的中文内容和测试数据，也包含待提取 UI 文案。

**扩展建议**

| 优先级 | 建议 | 价值 |
|---|---|---|
| P1 | 固化统一 Interaction Event Schema 并做契约测试 | 防止多端行为漂移 |
| P2 | Agent Run 历史、耗时、token 和错误检索 | 提升可观测性 |
| P2 | 分批提取高频页面硬编码文案 | 完善中英文支持 |
| P3 | Chat 内直接预览并确认 Truth/章节 diff | 减少页面跳转 |

---

### 模块 13：服务商、模型与密钥

**已验证**

- Provider schema、preset、lookup、resolver、temperature 约束和模型归属测试通过。
- Studio 支持服务配置、模型列表、单服务探测和 API Key 掩码。
- Secrets 独立保存与迁移测试通过。
- 本次未输出任何密钥明文。

**当前缺口**

- `doctor` 对 localhost 的连通性探测使用 `Promise.race`，超时后没有取消底层请求；默认 5 秒预算与测试 5 秒上限相同，子进程开销会稳定触发超时。
- Studio 没有全部服务的一键批量健康检查和历史成功率。
- 模型能力标签、上下文窗口、价格和推荐用途未形成统一可见模型卡。

**扩展建议**

| 优先级 | 建议 | 价值 |
|---|---|---|
| P1 | Doctor 使用可取消请求，并让总预算低于测试上限 | 修复 CLI 唯一失败和悬挂请求 |
| P2 | 批量健康检查、延迟和最近错误面板 | 快速判断服务可用性 |
| P2 | 模型能力/价格/上下文标签 | 辅助用户选择模型 |
| P3 | 按任务自动路由与成本预算 | 平衡质量、速度和费用 |

---

### 模块 14：Studio 前端基础设施

**已验证**

- Hash Route、API URL、缓存失效、主题、错误文案和页面状态测试通过。
- API 写操作后已能广播失效事件，减少部分手动刷新。
- Studio 生产构建成功，首页和基础 API 冒烟成功。

**当前缺口**

- 无全局 Error Boundary，组件异常仍可能导致页面白屏。
- 通用 `useApi` 没有 AbortController；快速切换页面时旧请求可能回写新页面状态。
- Studio client typecheck 与 Vite build 分离，构建无法阻止客户端类型错误进入产物。
- 主入口 JS 约 2748 KB，gzip 约 765 KB，且存在多个 500 KB 以上 chunk。
- `use-api.ts` 同时被动态和静态导入，当前动态导入不能形成有效拆包。

**扩展建议**

| 优先级 | 建议 | 价值 |
|---|---|---|
| P0 | 修复 ImportManager 类型错误，并把 client typecheck 纳入构建门禁 | 阻止不安全前端产物 |
| P1 | 增加 App 级和工作区级 Error Boundary | 避免整页白屏 |
| P1 | `useApi` 增加请求取消和过期响应保护 | 避免竞态与无效更新 |
| P2 | 按页面拆分 Style、Mermaid、Shiki 等重依赖 | 降低首屏体积 |
| P2 | 建立 Query Cache 或 BookDataProvider | 减少重复请求 |

---

### 模块 15：CLI 与 TUI

**已验证**

- CLI 版本、帮助、初始化、配置、书籍、状态、交互、导出、修订和发布包测试基本通过。
- TUI 的输入、布局、会话、命令和国际化测试通过。
- CLI typecheck 和 build 通过。

**当前缺口**

- `doctor` localhost 集成场景超时。
- `--json` 尚未覆盖所有命令，`formatJsonOutput` 使用范围有限。
- `findProjectRoot()` 不向上查找。
- 部分命令错误仍混用 stdout、stderr 和进程退出码。

**扩展建议**

| 优先级 | 建议 | 价值 |
|---|---|---|
| P1 | 修复 doctor 总预算和取消机制 | 恢复 171/171 |
| P1 | 统一 JSON envelope、错误码和 exit code | 提升脚本与 Agent 调用可靠性 |
| P2 | 项目根目录向上查找 | 改善日常 CLI 使用 |
| P2 | 为所有主要命令补 `--json` 契约测试 | 防止输出格式漂移 |
| P3 | Shell completion 和机器可读命令清单 | 提升专业 CLI 体验 |

---

### 模块 16：安全、构建与测试治理

**已验证**

- CORS 默认限制到 Studio origin，可通过 `STUDIO_ORIGIN` 配置。
- Studio 默认只监听 `127.0.0.1`。
- 静态资源路径执行 resolve/relative 边界校验。
- 导出格式有白名单。
- Author ID、项目根目录、书籍 ID、Webhook 私网目标等有安全校验。
- Core path safety 测试通过。
- Studio server `noEmit: false` 已修复，服务端产物验证通过。

**当前缺口**

- Studio API 没有用户认证；一旦显式绑定公网地址或错误配置反向代理，风险会显著上升。
- `safeChildPath(root, "")` 会返回 root 本身，调用方若预期必须是子文件，应额外拒绝空相对路径。
- 项目没有 ESLint/Prettier 独立规则，`lint` 实际只是 typecheck。
- `release` 目前是 `build && test`，不包含 typecheck 和发布 manifest 校验。
- 测试存在大量预期 ENOENT 日志，虽然不影响结果，但会淹没真实回归信号。

**扩展建议**

| 优先级 | 建议 | 价值 |
|---|---|---|
| P1 | release 增加 typecheck 和 manifest verify | 建立真实发布门禁 |
| P1 | 非 localhost 启动时要求显式认证配置 | 防止误暴露本地 API |
| P2 | 为必须是子文件的路径增加 non-empty 校验 | 增强防御纵深 |
| P2 | 引入 ESLint、Prettier 和 CI | 统一静态治理 |
| P2 | 收敛测试预期错误日志 | 提高 CI 可读性 |
| P3 | 增加覆盖率、契约测试和端到端浏览器测试 | 补足跨模块回归能力 |

---

## 四、建议实施路线图

### Phase 0：恢复全绿门禁（1-2 天）

1. 修复 `foundationPlan.roleChanges` 空值处理。
2. 修复章节导入 `targetNumber/startNumber` 提交链路。
3. 修复 CLI doctor 可取消超时和测试预算。
4. 将 `typecheck`、`build`、`test`、manifest verify 统一纳入 release。

**完成标准**

- Core `1294/1294`
- CLI `171/171`
- Studio `277/277`
- 根 `pnpm typecheck`、`pnpm build`、`pnpm test` 全绿

### Phase 1：交付已有后端能力（1-2 周）

1. 章节版本历史、diff、恢复 UI。
2. 作家蒸馏工作台。
3. Source 工作区上传和预览。
4. `incubating` 状态和统一建书入口。
5. Error Boundary 与 `useApi` 请求取消。

### Phase 2：增强写作控制（2-4 周）

1. SceneCard/LocationCard。
2. Relationship Dynamics。
3. Goal Fulfillment Report。
4. 审计问题精确定位和质量趋势。
5. Daemon 队列与 per-book 调度。

### Phase 3：生态与性能（持续）

1. Studio 路由级拆包和重依赖按需加载。
2. DOCX 导入/导出，后续评估 PDF/OCR。
3. 全端统一事件和 JSON schema。
4. 模型能力、成本和自动路由。
5. ESLint、Prettier、覆盖率与浏览器 E2E。

---

## 五、最终结论

NoFusion 当前不是“功能不可用”，而是“主体能力已成型，但发布门禁和若干跨层契约尚未闭合”。

最值得优先投入的不是继续增加独立页面，而是先完成以下四个闭环：

1. **类型闭环**：空计划契约与客户端类型一致。
2. **数据闭环**：章节导入预览编号与实际落盘编号一致。
3. **发布闭环**：typecheck、build、test、manifest verify 同时全绿。
4. **产品闭环**：把版本历史、蒸馏、Source 导入等已有后端能力交付到 Studio。

完成 Phase 0 后，项目可以获得可信的全绿基线；完成 Phase 1 后，现有功能的实际可用性和用户感知会明显高于继续横向增加新模块。

