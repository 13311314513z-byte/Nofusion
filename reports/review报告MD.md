# NoFusion / InkOS 全面代码审查报告

> 审查时间：2026-06-07  
> 目标版本：`@actalk/inkos` v1.4.1（commit `0bca161` + 工作区修改）  
> 审查范围：`packages/cli/`、`packages/core/src/`、`packages/studio/src/`、根配置与构建系统  

---

## 一、执行摘要

| 维度 | 评级 | 关键结论 |
|------|------|----------|
| **安全性** | 🔴 差 | 存在 P0 级路径遍历与任意文件写入；无认证；CORS 全开；硬编码 API 密钥存在于工作目录 |
| **架构质量** | 🟡 中等 | 单体文件过大（server.ts 6627 行、PipelineRunner 3782 行）；缺乏中间件分层；非原子文件操作普遍 |
| **前端质量** | 🟡 中等 | 无 Error Boundary；直接 DOM 操作；12,659 处硬编码中文；63+ 处 `as any`；孤儿组件 |
| **Core 业务逻辑** | 🟡 中等 | 神类/神函数密集；正则回溯风险；LLM 输出解析脆弱；非原子持久化 |
| **CLI 质量** | 🟡 中等 | `--json` 输出不一致；死代码；变量遮蔽；缺少边界处理 |
| **测试覆盖** | 🔴 差 | 72 处测试失败；构建系统静默失败导致级联测试崩溃；大量模块无单元测试 |
| **构建/配置** | 🔴 差 | `build:server` 因 `noEmit: true` 继承而静默无输出；无 ESLint/Prettier；`.gitignore` 缺口 |

### 问题统计

| 严重程度 | 数量 | 说明 |
|----------|------|------|
| **P0（崩溃/数据丢失/安全漏洞）** | 12 | 需立即修复 |
| **P1（影响正确性/用户可见故障）** | 45 | 需在下个 Sprint 修复 |
| **P2（不一致/边界 case/代码异味）** | 112 | 需在技术债 Sprint 处理 |
| **P3（轻微清理/风格）** | 18 | 可随日常开发顺手修复 |

---

## 二、安全审查（Security）

### 2.1 P0 — 必须立即修复

#### S-01 `export-save` 任意文件写入
- **文件**：`packages/studio/src/api/server.ts:4640-4649`
- **代码**：
  ```typescript
  const fmt = body.format as string;
  const outputPath = join(bookDir, `${id}.${fmt === "epub" ? "epub" : fmt}`);
  ```
- **影响**：`fmt` 来自用户 JSON body，无任何校验。构造 `format: "txt/../../../etc/passwd"` 可逃逸 `bookDir`，向任意路径写入文件。
- **修复**：在构造路径前白名单校验 `fmt ∈ { "txt", "md", "html", "epub" }`。

#### S-02 静态资源路径遍历
- **文件**：`packages/studio/src/api/server.ts:6594`
- **代码**：
  ```typescript
  const filePath = joinPath(options.staticDir!, c.req.path);
  ```
- **影响**：`c.req.path` 未过滤 `../` 序列。请求 `/assets/%2e%2e/%2e%2e/etc/passwd` 可读取 `staticDir` 外的任意文件。
- **修复**：解析后校验 `resolve(filePath).startsWith(resolve(options.staticDir))`。

#### S-03 硬编码 API 密钥存在于工作目录
- **文件**：`.env`、`.inkos/secrets.json`
- **影响**：虽然 `.gitignore` 已忽略这些文件，但它们存在于工作目录中。打包、复制或 CI 缓存时极易泄露。`secrets.json` 包含 moonshot、deepseek、volcengine、openai、kimi 等活跃密钥。
- **修复**：立即轮换所有密钥；从工作目录删除 `.env` 和 `secrets.json`；在 CI 中使用环境变量注入。

#### S-04 `safeChildPath` 边界情况允许访问根目录
- **文件**：`packages/core/src/utils/path-safety.ts:7`
- **代码**：
  ```typescript
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
  ```
- **影响**：当 `requestedPath` 解析为 `.` 或与 `root` 相同时，`rel === ""` 返回 `true`，函数返回 `root` 本身。调用者可能意外读取/写入根目录。
- **修复**：显式拒绝 `rel === ""` 的情况，或将 `.` 和空字符串加入拒绝列表。

### 2.2 P1 — 高优先级

#### S-05 CORS 允许所有来源 + 无认证
- **文件**：`packages/studio/src/api/server.ts:1608`
- **代码**：`app.use("/*", cors());`
- **影响**：任何网站都可调用 API。配合无认证设计，意味着任何能访问网络的人都能删除书籍、触发 LLM 管线、覆盖文件。
- **修复**：默认绑定 `127.0.0.1`；CORS 白名单限制为 `localhost`；或添加至少静态 API Key 中间件。

#### S-06 `x-project-root` 头注入
- **文件**：`packages/studio/src/api/server.ts:5910, 5927, 5966, 5989, 6028, 6071`
- **影响**：Style 端点接受客户端传来的 `x-project-root` 头切换项目根目录。虽然 `assertProjectRoot` 做了约束，但允许客户端控制根目录本身就是设计缺陷，且错误消息会泄露内部路径结构。
- **修复**：服务端从配置中读取项目根目录，拒绝客户端传入的 `x-project-root`。

#### S-07 Content-Disposition 头注入
- **文件**：`packages/studio/src/api/server.ts:4630`
- **代码**：`"Content-Disposition": \`attachment; filename="${artifact.fileName}"\``
- **影响**：`artifact.fileName` 中的 `"` 或 `\r\n` 可破坏响应头。
- **修复**：使用 Hono 的 `c.header()` 自动转义，或手动过滤 `fileName` 中的控制字符。

#### S-08 SSRF 部分绕过
- **文件**：`packages/studio/src/api/server.ts:202-245`
- **影响**：`isBlockedStyleImportHostname` 仅阻止 `localhost` 和链路本地地址，不阻止解析到 RFC1918 私有 IP（`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`）的外部域名。
- **修复**：在 DNS 解析后、HTTP 请求前，再次校验目标 IP 是否属于私有范围。

### 2.3 P2 — 中优先级

#### S-09 `fetchUrl` SSRF
- **文件**：`packages/core/src/utils/web-search.ts:55-100`
- **影响**：`fetchUrl` 无域名白名单，可直接请求内网服务。
- **修复**：在 `base.ts` 的 `fetchUrl` 调用点增加域名白名单或私有 IP 拦截。

#### S-10 运行时文件路径校验不完整
- **文件**：`packages/studio/src/api/server.ts:2211-2221`
- **影响**：`resolveRuntimeFilePath` 拒绝 `..` 但允许 `.` 和空组件。存在 TOCTOU（检查与使用时差）窗口。
- **修复**：使用 `safeChildPath` 替代自定义校验；原子性操作避免 TOCTOU。

---

## 三、架构审查（Architecture）

### 3.1 P0 — 必须立即修复

#### A-01 `build:server` 静默失败（无输出）
- **文件**：`tsconfig.json:15`、`packages/studio/tsconfig.server.json`
- **根因**：根 `tsconfig.json` 设置 `"noEmit": true`，`tsconfig.server.json` 继承后未覆盖。`tsc` 编译成功但不输出任何文件。
- **影响**：`dist/api/index.js` 缺失，`build:verify` 失败，CLI publish 测试级联失败，无法分发 Studio 服务端。
- **修复**：在 `tsconfig.server.json` 中添加 `"noEmit": false`。

### 3.2 P1 — 高优先级

#### A-02 API 单体过大
- **文件**：`packages/studio/src/api/server.ts`（6627 行，~120 端点）
- **影响**：代码审查困难、合并冲突频繁、测试隔离性差、单文件热重载慢。
- **修复**：按领域拆分为 `routes/books.ts`、`routes/chapters.ts`、`routes/style.ts`、`routes/services.ts`、`routes/project.ts` 等。

#### A-03 PipelineRunner 神类
- **文件**：`packages/core/src/pipeline/runner.ts`（3782 行）
- **影响**：负责书籍初始化、修订、导入、章节写作、雷达扫描、风格指南生成等 10+ 种职责。难以测试、难以维护。
- **修复**：拆分为 `BookInitializer`、`ChapterPipeline`、`ImportPipeline`、`StylePipeline`、`RadarScanner` 等独立类。

#### A-04 WriterAgent 神类
- **文件**：`packages/core/src/agents/writer.ts`（1457 行）
- **影响**：同时处理创意写作、状态结算、运行时产物、文件 I/O。
- **修复**：拆分为 `CreativeWriter`、`StateSettler`、`ChapterPersister`。

#### A-05 非原子文件操作（多处）
- **文件**：
  - `agents/architect.ts:776-947` — `writeFoundationFiles` 用 `Promise.all` 并行写多个文件，无回滚
  - `agents/writer.ts:726-748` — `saveChapter` 同时写章节 + 状态文件，崩溃后状态不一致
  - `import/foundation-source.ts:367-373` — 重命名失败后的回滚不完整
  - `state/memory-db.ts:247-254, 281-286, 381-388` — `replaceCurrentFacts`/`replaceSummaries`/`replaceHooks` 无事务
- **影响**：部分失败导致书籍目录处于腐败状态。
- **修复**：
  - 使用 staging + 原子重命名模式（已用于 `initBook`，应推广到所有多文件写操作）
  - SQLite 操作使用显式 `BEGIN TRANSACTION` / `COMMIT`

### 3.3 P2 — 中优先级

#### A-06 缺少中间件分层
- **文件**：`packages/studio/src/api/server.ts`
- **缺失**：请求日志、速率限制、请求体大小限制、请求 ID 传播、认证。
- **修复**：在 Hono 应用初始化阶段添加基础中间件栈。

#### A-07 CLI 默认动作意外启动 Studio
- **文件**：`packages/cli/src/program.ts`
- **影响**：运行 `inkos` 不带任何参数时静默启动 Web 服务器和浏览器，而非显示帮助信息。
- **修复**：默认动作改为 `program.help()`。

#### A-08 `init.ts` `if (global)` 逻辑错误
- **文件**：`packages/cli/src/commands/init.ts:27`
- **影响**：Node.js 的 `global` 对象始终为 truthy，导致输出总是显示"Global LLM config detected"，即使不存在全局配置。
- **修复**：改为检查 `process.env.INKOS_LLM_API_KEY` 或配置文件存在性。

#### A-09 前端无 Error Boundary
- **文件**：`packages/studio/src/App.tsx`
- **影响**：任何未捕获异常导致整个 SPA 白屏。
- **修复**：在 App 根节点包裹 `<ErrorBoundary>`，在重页面（StyleManager、BookDetail）增加局部边界。

---

## 四、前端审查（Studio Frontend）

### 4.1 P0 — 必须立即修复

#### F-01 直接 DOM 操作破坏 React 声明式模型
- **文件**：
  - `ChapterReader.tsx:505` — `document.querySelector('textarea')`
  - `StyleManager.tsx:1325` — 类似模式
- **影响**：DOM 未就绪时崩溃；SSR/测试环境无 `document` 时崩溃；与 React 调度冲突。
- **修复**：使用 `useRef` 获取 DOM 引用。

#### F-02 阻塞原生对话框
- **文件**：
  - `BookDetail.tsx` — `window.prompt` ×3, `window.confirm`
  - `Dashboard.tsx` — `window.alert`
- **影响**：阻塞主线程；破坏自动化测试；移动设备体验极差。
- **修复**：使用现有的 `<ConfirmDialog>` 组件或 toast 系统替代。

#### F-03 无请求取消机制
- **文件**：`hooks/use-api.ts`
- **影响**：`useEffect` 在组件卸载后继续调用 `setState`；快速路由切换导致竞态条件。
- **修复**：在 `fetchJson` 中传入 `AbortController.signal`；`useApi` 的 `useEffect` 在 cleanup 中 abort。

#### F-04 重复 SSE 连接
- **文件**：
  - `App.tsx` — `useSSE()` 全局连接
  - `store/chat/slices/message/action.ts:337` — 额外创建 `EventSource`
- **影响**：浏览器连接数限制（6/域名）；重复消息处理；内存泄漏。
- **修复**：移除 `sendMessage` 中的独立 `EventSource`，复用全局 `sse` 实例。

### 4.2 P1 — 高优先级

#### F-05 12,659 处硬编码中文字符
- **文件**：81 个文件
- **最严重**：`StyleManager.tsx` (~1500+)、`ChapterReader.tsx` (~400+)、`ImportManager.tsx` (~240)
- **影响**：国际化（i18n）几乎不可能；英文用户无法使用。
- **修复**：系统性地用 `useI18n` 替换硬编码字符串。 worst offenders 优先。

#### F-06 单体页面
- **文件**：
  - `StyleManager.tsx` — 2176 行
  - `BookDetail.tsx` — 1346 行（且 80% 功能已被 workspace sections 替代）
  - `ChapterReader.tsx` — 1047 行
- **影响**：认知负荷高；重复逻辑；审查和测试困难。
- **修复**：按功能拆分为子组件目录。

#### F-07 数据获取重复
- **文件**：所有 workspace sections
- **影响**：每个 section 独立调用 `useApi<BookData>(/books/${id})`，造成 N+1 请求和重复重渲染。
- **修复**：在 workspace 层级创建 `BookDataProvider` Context，一次获取后共享。

#### F-08 不稳定列表键
- **文件**：40+ 处 `key={i}` / `key={idx}` / `key={index}`
- **影响**：列表重排或删除时 React reconciliation 错误。
- **修复**：使用稳定唯一 ID（如 entity id、chapter number、array item UUID）。

#### F-09 `setTimeout` 状态序列化
- **文件**：`ChapterReader.tsx:577,581,590,597`；`BookChaptersSection.tsx:634`
- **影响**：依赖时间的脆弱逻辑，在快速交互下易断。
- **修复**：使用 `useEffect` + 状态机，或 `requestAnimationFrame`。

#### F-10 孤儿组件
- **文件**：
  - `components/author/AuthorProfileCard.tsx` — 零外部引用
  - `components/author/AuthorSearchPanel.tsx` — 零外部引用
  - `components/readability/RhetoricHighlightEditor.tsx` — 零外部引用
- **影响**：增加 bundle 体积和维护负担。
- **修复**：确认无用后删除。

### 4.3 P2 — 中优先级

#### F-11 `useColors` 死代码
- **文件**：`hooks/use-colors.ts`
- **影响**：接受 `theme` 参数但返回固定 Tailwind 字符串，参数被忽略。
- **修复**：删除或实现真正的主题色彩映射。

#### F-12 `components/ai-elements/prompt-input.tsx` 过度工程
- **文件**：`components/ai-elements/prompt-input.tsx`（1455 行）
- **影响**：导出 30+ 子组件，但仅少数被消费；严重增加 bundle 体积。
- **修复**：精简 API 表面，删除未使用的子组件。

#### F-13 `BookDetail.tsx` 孤儿页面
- **文件**：`pages/BookDetail.tsx`
- **影响**：仍在 `book-settings` 路由挂载，但 80% 功能已被 workspace sections 替代。
- **修复**：将剩余独有功能迁移到 workspace，删除该页面。

---

## 五、后端 API 审查（Studio Backend）

### 5.1 P0 — 必须立即修复

#### B-01 `export-save` 格式未校验导致路径遍历（同 S-01）
- **修复**：严格白名单 `format`。

#### B-02 静态文件路径遍历（同 S-02）
- **修复**：解析后校验路径在 `staticDir` 内。

### 5.2 P1 — 高优先级

#### B-03 `PUT /books/:id/chapters/:num` 版本历史缺陷
- **文件**：`server.ts:1909-1947`
- **问题**：
  1. **无版本上限** — `versions/` 目录无限增长
  2. **无意义备份** — 内容未变更时也创建新版本
  3. **数据丢失** — `readFileFs(...).catch(() => "")` 读取失败时备份为空文件
  4. **竞态条件** — 并发保存可能覆盖同一版本号
- **修复**：
  - 添加 `MAX_VERSIONS = 50` 并自动清理旧版本
  - 比较内容哈希，未变更时不创建备份
  - 读取失败时抛出 500 而非静默写空文件
  - 使用原子计数器或文件锁

#### B-04 错误处理不一致
- **文件**：`server.ts:1945, 1971, 2379, 4541, 4871`
- **影响**：多处 `catch (e) { return c.json({ error: String(e) }, 500) }` 直接字符串化原始错误，可能泄露内部路径、环境变量或 API 密钥。
- **修复**：顶层 `onError`（line 1611）应统一处理；内联 catch 仅记录日志，返回通用错误消息。

#### B-05 `withPipeline` TTL 参数未实现
- **文件**：`server.ts:765-787`
- **代码**：`_ttlMs` 带下划线前缀，函数体内从未使用。
- **影响**：LLM 管线挂起时请求永不超时。
- **修复**：实现 `Promise.race([pipelinePromise, sleep(ttlMs).then(() => throw new TimeoutError())])`。

#### B-06 `parseInt` 未校验 NaN
- **文件**：`server.ts:1911, 1953, 1977-1978, 2044`
- **影响**：`NaN` 传播到文件查找和数组索引，产生不可预测行为。
- **修复**：`const num = parseInt(raw, 10); if (!Number.isFinite(num) || num < 1) return c.json({ error: "Invalid chapter number" }, 400)`。

#### B-07 内容体无大小限制
- **文件**：`server.ts:1914`
- **影响**：`PUT /books/:id/chapters/:num` 接受任意长度 `content` 字符串，恶意多 GB 请求导致 OOM。
- **修复**：Hono `maxBodySize` 中间件或手动校验 `content.length <= 10_000_000`。

### 5.3 P2 — 中优先级

#### B-08 N+1 查询
- **文件**：`server.ts:1733-1737`
- **影响**：`GET /books` 对每个书籍调用 `loadStudioBookListSummary`，100+ 书籍 = 100+ 磁盘读取。
- **修复**：批量读取或添加缓存层。

#### B-09 同步 `existsSync` 阻塞事件循环
- **文件**：`server.ts:6521, 6575, 6601`
- **影响**：在 `/doctor` 和静态文件服务中调用同步文件检查。
- **修复**：改用异步 `stat()`。

#### B-10 模型列表缓存无上限
- **文件**：`server.ts:818, 3139`
- **影响**：`Map<string, { models; at }>` 无 LRU 驱逐，内存无限增长。
- **修复**：使用 `lru-cache` 或手动实现上限。

#### B-11 日志端点读取整个文件
- **文件**：`server.ts:3350-3353`
- **影响**：`GET /logs` 读取完整 `inkos.log`，分割所有行后取最后 100 行。
- **修复**：使用 `readLastLines` 或 `tail` 模式，只读文件末尾。

#### B-12 孤儿端点
- **端点**：
  - `PATCH /books/:id/config` — 无前端调用
  - `GET/GET /books/:id/chapters/:num/versions/:rev` — 版本历史 UI 不存在
  - `POST /books/:id/import/chapters` — 前端使用 `/plan` + `/commit`
  - `POST /style/authors/:authorId/distillations` — 前端未调用
  - `GET /style/authors/:authorId/distillations/versions` — 前端未调用
  - `GET /style/authors/:authorId/diagnostics/:diagnosticsId` — 前端只列诊断，不取单条
- **修复**：删除或标记为废弃；确认 `distillations` 端点的前端用途（writer 蒸馏前端缺失，见下文）。

#### B-13 静默 JSON 解析失败
- **文件**：`server.ts` 多处
- **代码**：`await c.req.json<...>().catch(() => ({}))`
- **影响**：无效 JSON 被静默转为空对象，调试困难且可能掩盖客户端 bug。
- **修复**：改为 `try/catch` 返回 400 Bad Request。

### 5.4 P3 — 低优先级

#### B-14 版本枚举 O(n)
- **文件**：`server.ts:1930-1937`
- **影响**：每次保存扫描整个 `versions/` 目录。
- **修复**：在 `versions/` 中维护一个 `version_counter.json` 原子文件。

---

## 六、Core 业务逻辑审查

### 6.1 P0 — 必须立即修复

#### C-01 `writeFoundationFiles` 无回滚机制
- **文件**：`packages/core/src/agents/architect.ts:776-947`
- **影响**：`Promise.all(writes)` 并行写多个文件，若其中一个失败，其他文件已写入，书籍目录处于半腐败状态。
- **修复**：使用 staging 目录 + 原子重命名（与 `initBook` 相同模式）。

#### C-02 `initBook` 昂贵检查在全部工作之后
- **文件**：`packages/core/src/pipeline/runner.ts:717-727`
- **影响**：生成 foundation、保存配置、写入文件后，才检查 `bookDir` 是否已存在。若存在，所有 LLM 调用和磁盘 I/O 全部浪费。
- **修复**：将存在性检查移到函数开头。

#### C-03 Writer 广泛的 catch 吞没非解析错误
- **文件**：`packages/core/src/agents/writer.ts:674`
- **代码**：`try { parseSettlerDeltaOutput(...) } catch { ... }`
- **影响**：任何错误（包括 `parseSettlerDeltaOutput` 自身的 bug）都被静默捕获并降级到 legacy 解析，掩盖真实故障。
- **修复**：只捕获特定的 ParseError，其他错误继续抛出。

#### C-04 `PartialResponseError` 误导性 stopReason
- **文件**：`packages/core/src/llm/provider.ts:1078-1083`
- **影响**：流式错误被标记为 `stopReason: "length"`，下游逻辑（如 Architect 的截断警告）可能误判。
- **修复**：使用独立的 stopReason，如 `"stream_error"`。

#### C-05 流式重试在 UI delta 回调激活时被禁用
- **文件**：`packages/core/src/llm/provider.ts:1073-1075`
- **代码**：`withTransientLLMRetry({ enabled: !onTextDelta })`
- **影响**：UI 流式场景下网络错误零重试，可靠性反而低于非流式。
- **修复**：允许流式场景重试，或在前端实现连接恢复。

### 6.2 P1 — 高优先级

#### C-06 正则灾难性回溯（多处）
- **文件与模式**：
  - `agents/architect.ts:73` — YAML frontmatter `([\s\S]*?)` 在多个 `---` 间回溯
  - `agents/style-diagnostics.ts:231` — `epistrophe` 模式 `([\u4e00-\u9fff]{2,4})\s*$\n\n[\s\S]*?\n\n[\s\S]{0,100}\1\s*$` 在多空行文本上严重回溯
  - `utils/document-reader.ts:67-81` — Markdown 标记剥离 `(.+?)` 在大量 `*`/`_` 时回溯
  - `utils/semantic-duplication.ts:231` — 同上 epistrophe
- **影响**：特定输入导致 CPU 100%、Node 进程卡死。
- **修复**：
  - 为 `([\s\S]*?)` 添加更严格的边界锚点
  - 将 epistrophe 检测改为基于字符串分割的算法，而非正则
  - 对所有用户输入的正则添加超时保护（`node:vm` 或 `re2`）

#### C-07 `findLineNumber` 返回错误行号
- **文件**：`packages/core/src/utils/paragraph-dedup.ts:49-70`
- **影响**：仅用段落前 20 字符作为搜索前缀，遇到重复开头（如对话标签 `""说"`）时指向错误位置。
- **修复**：使用段落全文哈希或更长的前缀 + 位置验证。

#### C-08 `extractBalancedJson` 大括号计数不区分字符串内大括号
- **文件**：`packages/core/src/agents/continuity.ts:767-777`
- **影响**：JSON 字符串值中包含 `{` 时导致提前终止。
- **修复**：实现真正的 JSON tokenizer 或使用 `JSON.parse` + 错误位置恢复。

#### C-09 `stripNegativeGuidance` 过度删除
- **文件**：`packages/core/src/utils/memory-retrieval.ts:309-316`
- **代码**：`text.replace(/\b(do not|don't|avoid|without|instead of)\b[\s\S]*$/i, " ")`
- **影响**：文本中只要出现 "do not" 就删除其后所有内容，包括后续的积极指导。
- **修复**：改为句子级过滤，仅删除包含否定词的那一句。

#### C-10 `resolveOverride` 读取任意环境变量
- **文件**：`packages/core/src/pipeline/runner.ts:586`
- **代码**：`process.env[override.apiKeyEnv]`
- **影响**：若 `apiKeyEnv` 被用户控制，可读取任意环境变量。
- **修复**：白名单校验 `apiKeyEnv` 格式（只允许 `INKOS_*` 或已知前缀）。

#### C-11 MemoryDB 非原子批量替换
- **文件**：`packages/core/src/state/memory-db.ts:247-254, 281-286, 381-388`
- **影响**：`DELETE` 后 `INSERT` 序列无事务包裹，崩溃后表为空。
- **修复**：`this.db.exec("BEGIN")` / `COMMIT` 包裹批量操作。

#### C-12 `rollbackToChapter` 永久删除 SQLite 文件
- **文件**：`packages/core/src/state/manager.ts:575-579`
- **影响**：回滚时直接 `rm(memory.db, memory.db-shm, memory.db-wal)`，无备份，误操作不可恢复。
- **修复**：先备份到 `.backup-memory-{timestamp}.db` 再删除。

#### C-13 `acquireBookLock` 无限递归
- **文件**：`packages/core/src/state/manager.ts:137`
- **影响**：`return this.acquireBookLock(bookId)` 在并发竞争时可能无限递归。
- **修复**：添加 `maxRetries` 和退避延迟。

#### C-14 `document-reader.ts` 无路径校验
- **文件**：`packages/core/src/utils/document-reader.ts:609-635`
- **影响**：`extractDocument` 接受任意 `filePath` 并读取，可被利用读取敏感文件。
- **修复**：使用 `safeChildPath` 限制在允许目录内。

#### C-15 `fetchUrl` SSRF
- **文件**：`packages/core/src/utils/web-search.ts:55-100`
- **影响**：无域名白名单，可请求内网服务。
- **修复**：添加私有 IP 拦截和域名白名单。

### 6.3 P2 — 中优先级

#### C-16 神函数
- **文件**：
  - `agents/architect.ts:205-407` — `buildChineseFoundationPrompt` ~200 行
  - `agents/architect.ts:409-603` — `buildEnglishFoundationPrompt` ~200 行
- **影响**：维护和审查极其困难。
- **修复**：拆分为 `buildWorldPrompt`、`buildCharacterPrompt`、`buildPlotPrompt` 等子函数。

#### C-17 Planner `findOutlineNode` O(n²)
- **文件**：`packages/core/src/agents/planner.ts:488-560`
- **影响**：三层嵌套循环遍历所有大纲行。
- **修复**：预处理大纲为 Map<number, OutlineNode>，实现 O(1) 查找。

#### C-18 Planner 正则在每次调用时重新编译
- **文件**：`packages/core/src/agents/planner.ts:642-646`
- **影响**：`new RegExp(...)` 在每次调用时创建，GC 压力大。
- **修复**：预编译正则或缓存。

#### C-19 重试反馈无限增长上下文
- **文件**：`packages/core/src/agents/planner.ts:260`
- **影响**：错误消息未截断，3 次重试后用户消息可能膨胀数百 token，超出上下文窗口。
- **修复**：截断 `error.message` 到 200 字符。

#### C-20 `escapeXml` 不完整
- **文件**：`packages/core/src/import/foundation-source.ts:425-432`
- **影响**：未转义 `\n`、控制字符，属性值中含换行时破坏 XML 结构。
- **修复**：使用标准 XML 转义库。

#### C-21 `text-preprocessor` 过度删除
- **文件**：`packages/core/src/utils/text-preprocessor.ts`
- **问题**：
  - `removeStructuredData` 的 `<[^>]+>` 会删除数学表达式 `x < y > z`
  - `removeIds` 的 21 字符正则误删合法英文单词
  - `deduplicateParagraphs` 移除所有空格导致 "foo bar" ≈ "foobar"
- **修复**：更精确的 HTML 标签识别；ID 检测增加熵阈值；去重时保留至少一个空格。

#### C-22 `text-relayout` 段落拼接无分隔符
- **文件**：`packages/core/src/utils/text-relayout.ts:80-102`
- **影响**：`buffer + para` 直接拼接，两段之间可能合并成一个词。
- **修复**：拼接时确保至少一个空格或换行。

#### C-23 `context-filter` 误导性截断
- **文件**：`packages/core/src/utils/context-filter.ts:30-32`
- **影响**：`capContextBlock` 从开头截断，可能丢失尾部关键信息。
- **修复**：从中间截断并插入 `[...truncated...]` 标记。

#### C-24 `context-filter` 名称提取误匹配
- **文件**：`packages/core/src/utils/context-filter.ts:128-145`
- **影响**：`[\u4e00-\u9fff]{2,4}` 匹配任何 2-4 字中文词（如"今天"），非仅人名。
- **修复**：使用角色 ID 精确匹配，而非正则模糊匹配。

#### C-25 `selectRelevantSummaries` 排序破坏相关性
- **文件**：`packages/core/src/utils/memory-retrieval.ts:376-380`
- **影响**：先按分数降序取前 4，再按章节号升序重排，最终结果是按章节号而非相关性排序。
- **修复**：移除最后的重排序，或按 `(score, chapter)` 复合排序。

#### C-26 MemoryDB `lastInsertRowid` 精度丢失
- **文件**：`packages/core/src/state/memory-db.ts:172`
- **影响**：`Number(result.lastInsertRowid)` — SQLite rowid 超过 `MAX_SAFE_INTEGER` 时精度丢失。
- **修复**：保持为 `bigint` 或使用字符串。

#### C-27 MemoryDB WAL 无检查点管理
- **文件**：`packages/core/src/state/memory-db.ts:80`
- **影响**：WAL 文件可能无限增长。
- **修复**：定期执行 `PRAGMA wal_checkpoint(TRUNCATE)` 或配置 `PRAGMA wal_autocheckpoint`。

#### C-28 `chatCompletionViaPiAi` 重复 `monitor.stop()`
- **文件**：`packages/core/src/llm/provider.ts:1289, 1297`
- **影响**：`catch` 和 `finally` 都调用 `monitor.stop()`。
- **修复**：只在 `finally` 中调用。

#### C-29 `wrapLLMError` 子串匹配脆弱
- **文件**：`packages/core/src/llm/provider.ts:366, 386, 395`
- **影响**：`msg.includes("400")` 可能误匹配模型名（如 `gpt-4-400k`）或温度值（`0.400`）。
- **修复**：使用 HTTP 状态码整数匹配而非字符串包含。

#### C-30 SSE 解析不处理 `\r\n\r\n`
- **文件**：`packages/core/src/llm/provider.ts:637-662`
- **影响**：按 `\n\n` 分割，但 SSE 规范允许 `\r\n\r\n`。
- **修复**：标准化换行符后再分割。

---

## 七、CLI 审查

### 7.1 P1 — 高优先级

#### CLI-01 `--json` 输出不一致
- **文件**：`packages/cli/src/utils.ts`、`多个命令文件`
- **影响**：仅 `analytics`、`doctor`、`export` 使用 `formatJsonOutput`。其余 ~20 个命令使用各自的 `JSON.stringify({ error: String(e) })`，产生不一致的 schema（`{ error }` vs `{ status, error }` vs `{ status, data }`）。
- **修复**：所有命令统一调用 `formatJsonOutput`。

#### CLI-02 `detect.ts` 早期退出忽略 `--json`
- **文件**：`packages/cli/src/commands/detect.ts:26-27, 79-80`
- **影响**：配置禁用检测或目标章节 < 1 时，调用 `logError` + `process.exit(1)`，无视 `--json` 标志。
- **修复**：检查 `opts.json`，若启用则输出 JSON 错误后退出。

#### CLI-03 `genre.ts` 完全无 `--json` 支持
- **文件**：`packages/cli/src/commands/genre.ts`
- **影响**：`list`、`show`、`create`、`copy` 仅输出人类可读文本。
- **修复**：添加 `--json` 分支。

#### CLI-04 `config.ts` 大部分子命令无 `--json`
- **文件**：`packages/cli/src/commands/config.ts`
- **影响**：仅 `show-models` 和 `list-models` 支持 JSON。
- **修复**：为 `set`、`set-global`、`show` 添加 JSON 输出。

#### CLI-05 `short-fiction.ts` 错误不返回 exit code 1
- **文件**：`packages/cli/src/commands/short-fiction.ts`
- **影响**：`logCommandError` 仅打印日志，不 `process.exit(1)`，Shell 将错误视为成功。
- **修复**：统一错误处理为 `process.exit(1)`。

#### CLI-06 `doctor.ts` 变量遮蔽
- **文件**：`packages/cli/src/commands/doctor.ts:317, 333`
- **影响**：外层 `probeTimeout` 被内层同名变量遮蔽，外层值实际未使用。
- **修复**：重命名内层变量。

#### CLI-07 `doctor.ts` 重复步骤编号
- **文件**：`packages/cli/src/commands/doctor.ts`
- **影响**：LLM 配置检查和书籍检查都标为 "5."。
- **修复**：重新编号。

#### CLI-08 `findProjectRoot()` 不向上查找
- **文件**：`packages/cli/src/utils.ts`
- **影响**：仅返回 `process.cwd()`，从子目录运行命令时失败。
- **修复**：遍历父目录查找 `inkos.json`。

### 7.2 P2 — 中优先级

#### CLI-09 `write.ts` 重复解析逻辑
- **文件**：`packages/cli/src/commands/write.ts`
- **影响**：`rewrite`/`sync`/`repair-state` 中复制粘贴相同的 `args.length === 1/2` 解析。
- **修复**：提取为 `parseBookAndChapter` 共享函数。

#### CLI-10 `daemon.ts` PID 文件竞态
- **文件**：`packages/cli/src/commands/daemon.ts`
- **影响**：`readFile` → `writeFile` 非原子，并发 `inkos up` 可能启动多个实例。
- **修复**：使用 `fs.open` + `O_EXCL` 原子创建。

#### CLI-11 `update.ts` 硬编码 npm
- **文件**：`packages/cli/src/commands/update.ts`
- **影响**：使用 `npm view` 和 `npm install -g`，忽略 pnpm/yarn 安装场景。
- **修复**：检测实际使用的包管理器。

#### CLI-12 `book.ts` 备份警告使用 `console.warn`
- **文件**：`packages/cli/src/commands/book.ts:56`
- **影响**：绕过日志接收器。
- **修复**：使用 `logError`。

#### CLI-13 `book.ts` 更新输出未掩码 API 密钥
- **文件**：`packages/cli/src/commands/book.ts:153`
- **影响**：输出完整 `BookConfig`，可能包含 API key。
- **修复**：掩码敏感字段。

### 7.3 P3 — 低优先级

#### CLI-14 测试缺口
- **缺失**：`utils.ts`、`detect.ts`、`style.ts`、`fanfic.ts` 无单元测试
- **修复**：补充基础单元测试。

---

## 八、测试与构建审查

### 8.1 P0 — 必须立即修复

#### T-01 `build:server` 静默无输出
- **文件**：`tsconfig.json:15`、`packages/studio/tsconfig.server.json`
- **根因**：根 `tsconfig.json` 设置 `"noEmit": true`，子配置继承后未覆盖。
- **影响**：`dist/api/index.js` 缺失；`build:verify` 失败；CLI publish 测试级联失败；无法分发服务端。
- **修复**：`tsconfig.server.json` 添加 `"noEmit": false`。

#### T-02 72 处测试失败
- **CLI 失败**（5 处）：
  - `cli-integration.test.ts` — 超时（doctor timeout、version timeout）
  - `publish-package.test.ts` — 因构建失败而失败
  - `tui-dashboard.test.tsx` — 超时
- **Studio 失败**（67 处）：
  - `server.test.ts` — 5 处断言错误（daemon 生命周期回归）
  - `v13-hotfix-round4.test.ts` — 2 处超时
  - 其余 60 处 — session/creation-draft 状态不匹配
- **修复**：先修复 T-01，再逐个定位断言不匹配和超时根因。

### 8.2 P1 — 高优先级

#### T-03 无 ESLint / Prettier
- **影响**：代码风格不一致；缺失变量、未使用导入等无法自动捕获。
- **修复**：添加 `eslint.config.js`（Flat Config）和 `.prettierrc`。

#### T-04 `.gitignore` 缺口
- **未忽略**：`.inkos/audit-config.json`、`.inkos/session.json`、`.tmp-test-logs/`
- **影响**：`git status` 显示未跟踪文件，易意外提交。
- **修复**：补充 `.gitignore` 条目。

#### T-05 仓库膨胀
- **数据**：`books/` (1.1 MB)、`reports/` (1.5 MB)、`assets/` (3.1 MB) 被追踪
- **影响**：`.git` 目录 22 MB，clone 慢，历史臃肿。
- **修复**：`git rm --cached` 移出大文件；使用 `git filter-repo` 清理历史（谨慎操作）。

### 8.3 P2 — 中优先级

#### T-06 CLI 集成测试单体过大
- **文件**：`cli/src/__tests__/cli-integration.test.ts`（1031 行）
- **影响**：覆盖 init、config、book、status、doctor、write、review、plan/compose、export，失败时难以定位。
- **修复**：按命令拆分为独立测试文件。

#### T-07 测试依赖编译产物而非源码
- **文件**：`cli/package.json`
- **影响**：`pretest` 运行 `pnpm run build`，测试针对编译后的 JS，可能隐藏 TypeScript 类型错误。
- **修复**：使用 `tsx` 或 `ts-node` 直接运行测试。

#### T-08 前端 chunk 过大
- **文件**：`packages/studio/vite.config.ts`
- **数据**：`dist/assets/index-*.js` 2.7 MB（764 kB gzipped）
- **修复**：配置 `manualChunks` 拆分 vendor bundle。

#### T-09 缺失传递依赖
- **文件**：`packages/studio/package.json`
- **数据**：`@emotion/is-prop-valid` 被 `motion`（Framer Motion）需要但未声明。
- **修复**：添加缺失依赖；清理未使用依赖（`@fontsource-variable/geist`、`shadcn`、`tw-animate-css`）。

---

## 九、已知问题对照（与历史上下文比对）

| 历史问题 | 状态 | 说明 |
|----------|------|------|
| `assertProjectRoot` startsWith 前缀遍历 | 🟡 部分缓解 | `startsWith` 仍存在，但已加了 `candidate !== allowed` 兜底。建议改用 `path.relative` |
| CLI 3 测试失败 | 🔴 恶化 | 实际 5 处失败（ doctor timeout, publish, tui, version） |
| `findLineNumber` 重复段落 | 🔴 未修复 | 仍然只匹配前 20 字符前缀 |
| `withPipeline` TTL 未实现 | 🔴 未修复 | `_ttlMs` 仍为死参数 |
| 章节版本历史缺失 | 🟡 部分存在 | `PUT` 有版本备份但竞态/无上限/无 UI |
| 12 处 async onClick 无重入守卫 | 🟡 需确认 | 前端审查发现多处，但未逐一统计 |
| `useAutoSave` 死代码 | 🔴 未修复 | 仍调用不存在端点 |
| 孤儿组件 | 🔴 未修复 | `RhetoricHighlightEditor`、`AuthorSearchPanel`、`AuthorProfileCard` 仍无引用 |
| 78 处硬编码中文 | 🔴 恶化 | 实际 12,659 处 CJK 字符 |
| "一键检测全部" 不探测服务 | 🔴 未修复 | 仍需审查 |
| `--json` 不一致 | 🔴 未修复 | ~20 个命令各自实现 |
| Writer 蒸馏前端缺失 | 🔴 未修复 | 5 个后端端点仍无前端 |
| Hooks graph / character voice | 🔴 未实现 | 仍为 P3 待办 |

---

## 十、优先修复清单（Top 20）

| 排名 | 问题 | 严重程度 | 文件 | 预估工作量 |
|------|------|----------|------|-----------|
| 1 | `export-save` 格式白名单校验 | P0 | `server.ts:4640` | 10 分钟 |
| 2 | 静态资源路径遍历 | P0 | `server.ts:6594` | 15 分钟 |
| 3 | 删除/轮换硬编码 API 密钥 | P0 | `.env`, `.inkos/secrets.json` | 30 分钟 |
| 4 | `tsconfig.server.json` 覆盖 `noEmit` | P0 | `tsconfig.server.json` | 5 分钟 |
| 5 | `safeChildPath` 拒绝空相对路径 | P0 | `path-safety.ts:7` | 10 分钟 |
| 6 | `initBook` 存在性检查前置 | P0 | `runner.ts:717` | 15 分钟 |
| 7 | Writer catch 缩小范围 | P0 | `writer.ts:674` | 15 分钟 |
| 8 | `writeFoundationFiles` staging + 原子重命名 | P0 | `architect.ts:776` | 2 小时 |
| 9 | CORS 白名单 + 默认绑定 localhost | P1 | `server.ts:1608` | 30 分钟 |
| 10 | 添加 API Key / 认证中间件 | P1 | `server.ts` | 2 小时 |
| 11 | `withPipeline` 实现 TTL 超时 | P1 | `server.ts:765` | 30 分钟 |
| 12 | 统一 `--json` 输出 | P1 | CLI 多文件 | 4 小时 |
| 13 | `PUT chapter` 版本上限 + 内容哈希 | P1 | `server.ts:1909` | 1 小时 |
| 14 | 前端 Error Boundary | P1 | `App.tsx` | 1 小时 |
| 15 | 替换 `window.alert/prompt/confirm` | P1 | `BookDetail.tsx`, `Dashboard.tsx` | 2 小时 |
| 16 | 正则回溯防护（epistrophe、YAML） | P1 | `style-diagnostics.ts`, `architect.ts` | 4 小时 |
| 17 | `findLineNumber` 修复 | P1 | `paragraph-dedup.ts` | 1 小时 |
| 18 | MemoryDB 事务包裹 | P1 | `memory-db.ts` | 1 小时 |
| 19 | `buildChineseFoundationPrompt` 拆分 | P2 | `architect.ts` | 4 小时 |
| 20 | 添加 ESLint + Prettier | P1 | 根目录 | 2 小时 |

---

## 十一、附录：审查方法论

本次审查采用以下方法：
1. **静态代码分析**：逐文件阅读关键路径，标记逻辑错误、安全隐患和性能问题
2. **模式匹配**：搜索反模式（`as any`、`catch {`、`document.querySelector`、`key={i}`、`process.exit`）
3. **架构审查**：评估模块职责、耦合度和内聚性
4. **安全审查**：路径遍历、SSRF、注入、认证、密钥管理
5. **测试执行**：运行现有测试套件，记录失败和超时
6. **构建验证**：检查构建脚本和产物完整性

**未覆盖领域**：
- 完整的 TUI 子系统深度审查（~15 个文件，表面扫描）
- 完整的 Style 蒸馏系统端到端测试（前端缺失）
- 实际 LLM 输出质量评估（仅审查代码逻辑，未调用 LLM）
- 性能基准测试（仅基于代码复杂度估算）

---

*报告完。共审查 ~250 个源文件，识别 187 处问题（P0×12、P1×45、P2×112、P3×18）。*
