# 0623 NoFusion 项目收尾测试报告（GPT 复核）

> 执行时间: 2026-06-23 12:08-12:35 CST  
> 执行人: Codex / GPT  
> Git HEAD: `521fffc`  
> Node.js: `v24.14.0`  
> pnpm: `11.5.2`  
> 测试依据: `reports/0622测试手册DS.md`、`AGENTS.md`、当前 `package.json` 脚本  
> 诚实声明: 本报告只把本轮终端实测和代码扫描作为 PASS 依据；未执行真实 LLM、外部通知、封面生成、破坏性业务数据写入和浏览器人工遍历的项目，均不标记为完整 PASS。

---

## 一、最终判定

| 维度 | 判定 | 证据 |
|---|---|---|
| 自动化基础门禁 | DEGRADED | typecheck/lint/build 通过，但 Studio 首轮测试失败、CLI 测试仍失败、bundle budget 失败 |
| Core 引擎 | PASS | `145 files / 1454 tests` 全通过 |
| Studio 前端/API | DEGRADED | 首轮全量 `2 failed / 277 passed / 279 total`；复跑 `279/279` 通过，存在超时不稳定 |
| CLI/TUI | FAIL | 首轮 `6 failed / 163 passed / 169 total`；复跑仍 `1 failed / 168 passed / 169 total` |
| Studio Bundle | FAIL | `Dist 16286.4 KB / 15500 KB`，超出 786.4 KB |
| 发布清单 | PASS | core / cli / studio 均 OK |
| 前端运行时入口 | PASS-SMOKE | `GET /` 返回 200，包含 `<div id="root">` |
| 后端 API 烟测 | PASS-SMOKE | `/api/v1/doctor`、`/api/v1/books`、`/api/v1/services` 均返回 200 |
| 人工 GUI 全遍历 | BLOCKED | 未执行浏览器人工逐项操作、未采集截图/Console 证据 |
| 真实 LLM/外部服务 | BLOCKED | 未执行真实 Key、外部通知、封面服务、真实写书闭环 |
| 工作区状态 | DIRTY | 测试后出现 `M packages/cli/src/tui/agent-input.ts`；破坏性测试前置门禁拒绝执行 |

**结论: 当前项目不能标记为“全量收尾交付完成”。**  
可确认的是：Core 自动化质量稳定，Studio 的代码构建与 API 大面通过但测试存在并发/超时不稳定，CLI/TUI 仍有真实断言失败，Studio bundle 已超过当前官方预算阈值。收尾标准至少需要关闭 CLI TUI 失败、bundle 超标、测试不稳定和 dirty worktree 后再复验。

---

## 二、环境与基线

| 项目 | 实测结果 |
|---|---|
| `git rev-parse --short HEAD` | `521fffc` |
| `git status -sb` 初始状态 | `master...origin/master [ahead 4]`，工作区干净 |
| `node -v` | `v24.14.0` |
| `.\pnpm.cmd -v` | `11.5.2` |
| 测试后工作区 | `M packages/cli/src/tui/agent-input.ts` |
| 残留测试进程 | 已清理 Vitest/Tinypool/npm pack/CLI 子进程；未停止用户已有 Studio dev server |

测试过程中出现的未提交修改：

```diff
packages/cli/src/tui/agent-input.ts
- const thinking = lastAssistant?.content.find((part) => part.type === "thinking")?.thinking;
+ const assistantThinking = lastAssistant && "thinking" in lastAssistant ? (lastAssistant as { thinking?: string }).thinking : undefined;
+ const thinking = assistantThinking ?? (
+   Array.isArray(lastAssistant?.content)
+     ? lastAssistant.content.find((part) => part.type === "thinking")?.thinking
+     : undefined
+ );
```

该修改不是本报告写入前由 Codex 编辑产生；报告按“当前工作区已经 dirty”处理，不把破坏性业务测试标记为已执行。

---

## 三、自动化门禁实测

| # | 门禁 | 命令 | 结果 | 实测摘要 |
|---:|---|---|---|---|
| G1 | Typecheck | `.\pnpm.cmd -r typecheck` | PASS | core / studio / cli 全部 `Done` |
| G2 | Lint | `.\pnpm.cmd -r lint` | PASS-WARN | 0 errors；core 180 warnings，studio 228 warnings，cli 15 warnings |
| G3 | Build | `.\pnpm.cmd -r build` | PASS-WARN | core/studio/cli 构建通过；Studio `Build artifacts verified` |
| G4 | Core Tests | `.\pnpm.cmd --filter @actalk/inkos-core test` | PASS | `145 files / 1454 tests` 全通过 |
| G5 | Studio Tests 首跑 | `.\pnpm.cmd --filter @actalk/inkos-studio test` | FAIL | `2 failed / 277 passed / 279 total`，两个 10s timeout |
| G6 | Studio Tests 复跑 | 同命令复跑失败文件时实际跑全量 | PASS-2 | `32 files / 279 tests` 全通过；标记为不稳定而非稳定 PASS |
| G7 | CLI Tests 首跑 | `.\pnpm.cmd --filter @actalk/inkos test` | FAIL | `2 failed files / 6 failed / 163 passed / 169 total` |
| G8 | CLI Tests 复跑 | 复跑 TUI 失败文件时实际跑全量 | FAIL | `1 failed / 168 passed / 169 total` |
| G9 | Bundle Budget | `.\pnpm.cmd --filter @actalk/inkos-studio build:budget` | FAIL | `Dist 16286.4 KB / 15500 KB` |
| G10 | Publish Manifest | `.\pnpm.cmd -w run verify:publish-manifests` | PASS | core / cli / studio 均 OK |
| G11 | Studio HTTP 首页 | `Invoke-WebRequest http://localhost:4577/` | PASS-SMOKE | 200，长度 712，包含 root 节点 |
| G12 | Studio API Doctor | `GET /api/v1/doctor` | PASS-SMOKE | 200，返回 `inkosJson/projectEnv/globalEnv/booksDir/llmConnected/bookCount` |
| G13 | Studio API Books | `GET /api/v1/books` | PASS-SMOKE | 200，返回 books 数组 |
| G14 | Studio API Services | `GET /api/v1/services` | PASS-SMOKE | 200，返回 services 数组 |
| G15 | CLI 入口 | `node packages/cli/dist/index.js --version` | PASS-SMOKE | 输出 `1.5.0` |
| G16 | CLI Doctor | `node packages/cli/dist/index.js doctor --skip-connectivity` | PASS-SMOKE | 退出码 0，跳过 API 连通性 |
| G17 | 破坏性测试前置门禁 | `node scripts/assert-clean-worktree-for-destructive-tests.mjs` | PASS-GUARD | dirty worktree 下拒绝执行 |

### 关键失败明细

| 编号 | 归属 | 失败点 | 证据 | 影响 |
|---|---|---|---|---|
| F1 | Studio API 测试稳定性 | `server-security.test.ts` 首跑超时 | `uses the real core bookId validator...` 10s timeout | 安全 mock / import validation 存在并发或环境敏感性 |
| F2 | Studio daemon 测试稳定性 | `server.test.ts` 首跑超时 | `returns from /api/daemon/start...` 10s timeout | daemon lifecycle 测试不可稳定作为交付门禁 |
| F3 | CLI integration 并发/测试基建 | 首跑 4 个 status 用例找不到 `packages/cli/dist/index.js` | `MODULE_NOT_FOUND` | publish/prepack 或并发测试会影响 CLI dist 可见性 |
| F4 | CLI TUI 功能/契约 | `tui-agent-session.test.ts` 仍失败 | 期望 session 末条 assistant message 含 `thinking: "internal"`，实际只含 `role/content/timestamp` | TUI agent 会话没有完整保留 thinking 元数据，交互闭环不达标 |
| F5 | Bundle budget | 官方预算失败 | `Dist 16286.4 KB / 15500 KB` | Studio 前端体积未达收尾标准 |

---

## 四、前端、后端、CLI 交互复核

### 4.1 前端入口

| 项目 | 结果 | 说明 |
|---|---|---|
| Vite client build | PASS-WARN | 构建通过，但有 `use-api.ts` 动静态混合导入 warning |
| 首屏静态入口 | PASS-SMOKE | `/` 返回 200，包含 root 节点 |
| Hash route 接入 | PASS-CODE | `#/book/new` 与 `book-create` route 在 `use-hash-route.ts`、`App.tsx` 有实现和测试 |
| 浏览器真实操作 | BLOCKED | 未执行 Playwright/人工截图，不能确认全部菜单、响应式、Console 状态 |

### 4.2 后端 API

| 项目 | 结果 | 说明 |
|---|---|---|
| API 编译 | PASS | `tsc -p tsconfig.server.json` 通过 |
| API 单测 | DEGRADED | 首跑 2 个 timeout；复跑全量通过 |
| 只读 API 烟测 | PASS | doctor/books/services 均 200 |
| 写入类 API | PARTIAL | 测试覆盖较多，但本轮未对真实项目执行破坏性写入 |
| 外部服务 API | BLOCKED | 未使用真实 LLM Key、外部通知、封面生成服务 |

### 4.3 CLI/TUI

| 项目 | 结果 | 说明 |
|---|---|---|
| CLI build | PASS | `packages/cli/dist/index.js` 存在 |
| CLI 入口 | PASS-SMOKE | `--version` 输出 1.5.0 |
| CLI doctor | PASS-SMOKE | `--skip-connectivity` 退出码 0 |
| CLI integration | DEGRADED | 首跑受 `dist/index.js` 不可见影响失败；复跑通过 |
| TUI agent session | FAIL | thinking 元数据未按测试契约持久化 |

---

## 五、30 模块覆盖矩阵

| 模块 | 覆盖层 | 本轮判定 | 证据与限制 |
|---|---|---|---|
| M01 项目初始化与环境 | CLI + Studio | PARTIAL | typecheck/build/CLI init 相关测试覆盖；dirty worktree 阻断破坏性全流程 |
| M02 LLM 服务配置 | Studio API | PARTIAL | `/api/v1/services` 200，服务测试单测通过；未测真实 Key 连通 |
| M03 书籍全生命周期 | Studio + CLI | PARTIAL | books API 200，book-create 单测通过；未真实创建/删除业务书籍 |
| M04 写作 Pipeline | Core + CLI | PARTIAL/BLOCKED | Core pipeline 测试通过；真实 LLM 写章未执行 |
| M05 章节管理 | Core + Studio | PARTIAL | 章节持久化/状态测试覆盖；未执行浏览器章节编辑 |
| M06 质量审计闭环 | Core + Studio | PARTIAL | audit/revise 相关测试复跑通过；真实 provider 审计未执行 |
| M07 风格分析系统 | Core + Studio | PARTIAL | style analyzer/diagnostics/rewriter 测试覆盖；真实文本 UI 流未截图 |
| M08 作者风格档案 | Studio | PARTIAL | 相关状态/接口有覆盖；URL 导入和前端比较未人工验证 |
| M09 Agent 自然语言交互 | Studio + CLI | FAIL | CLI TUI agent session 稳定失败；Studio agent API 复跑通过但首轮不稳定 |
| M10 会话管理 | Studio + CLI | DEGRADED | session 单测覆盖；TUI session thinking 元数据缺失 |
| M11 导入工作流 | Studio + CLI | PARTIAL/BLOCKED | import/planner 测试覆盖；真实文件导入写入未执行 |
| M12 导出功能 | Studio + CLI | DEGRADED | CLI export integration 复跑通过；首轮 CLI 包失败，未逐格式人工验产物 |
| M13 真值文件系统 | Studio + Core | DEGRADED | truth files 复跑通过；真实大项目 truth resync 未做人工核验 |
| M14 角色管理 | Studio | BLOCKED | 未执行真实角色 CRUD 与浏览器视图遍历 |
| M15 雷达与市场 | Studio + CLI | PARTIAL/BLOCKED | radar/doctor 测试复跑通过；外部市场源扫描未执行 |
| M16 守护进程 | Studio + CLI | DEGRADED | daemon 首跑 timeout、复跑通过；未启停真实长期守护写作 |
| M17 通知系统 | Studio | PARTIAL/BLOCKED | private webhook 安全测试通过；真实 Telegram/Feishu/WeChat 未发送 |
| M18 事件链 | Core + Studio | PARTIAL | core 事件链相关测试覆盖；跨章真实事件链未人工核验 |
| M19 场景模板 | Studio | PARTIAL/BLOCKED | 代码/间接测试覆盖；真实模板保存与写作调用未执行 |
| M20 流派管理 | Studio + CLI | PARTIAL | genre 相关测试覆盖；前端流派面板未人工遍历 |
| M21 封面生成 | Studio | BLOCKED | 未配置真实封面服务/Key，不能验收生成链路 |
| M22 短篇创作 | Core + CLI | PARTIAL/BLOCKED | short-fiction 单测覆盖；真实 LLM 短篇生成未执行 |
| M23 同人创作 | Core + CLI | PARTIAL/BLOCKED | fanfic 模型/维度测试覆盖；真实导入和生成未执行 |
| M24 可读性与去重 | Core + Studio | PARTIAL | readability/dedup 相关测试覆盖；真实跨章数据未人工核验 |
| M25 日志与监控 | Studio | PARTIAL/BLOCKED | `use-sse` 单测通过；未验证真实 SSE 日志面板 |
| M26 Doctor 诊断 | Studio + CLI | PARTIAL | `/api/v1/doctor` 200，CLI doctor skip-connectivity 通过；真实连通性未测 |
| M27 项目配置 | Studio + CLI | PARTIAL | config 相关测试覆盖；真实配置切换未人工确认 |
| M28 CLI 命令交互 | CLI | FAIL | CLI 包首跑失败，复跑仍 1 个 TUI 断言失败 |
| M29 前后端 API 闭环 | Studio API | DEGRADED | HTTP smoke 通过，但 Studio 全量测试首跑失败；无真实写入闭环 |
| M30 跨切面体验 | 全局 | PARTIAL/BLOCKED | theme/error/hash route 单测覆盖；未执行响应式、移动端、Console 人工验收 |

---

## 六、代码结构与规模扫描

| 指标 | 实测值 | 判定 |
|---|---:|---|
| TS/TSX 源文件数 | 769 | 信息项 |
| 测试相关 TS/TSX 文件数 | 216 | 信息项 |
| `packages/core/src/pipeline/runner.ts` | 1566 行 | 超 800 行目标，仍需拆分 |
| `packages/core/src/agents/writer.ts` | 989 行 | 超 800 行硬目标边界 |
| `packages/core/src/__tests__/pipeline-runner.test.ts` | 5192 行 | 巨型测试文件，需拆分 |
| `packages/studio/src/api/server.ts` | 1233 行 | 略超 1200 行目标 |
| `packages/studio/src/api/server.test.ts` | 146 行 | 已拆分成小文件 |
| 生产代码 `any` 粗略匹配 | 17 处 | 低于旧报告 200+，但仍需人工逐项确认 |
| BookCreate route | 已接入 | `#/book/new`、`book-create` route、Sidebar/Dashboard 入口均存在 |

补充说明：`any` 统计命令为 `rg -n --glob '!**/*.test.*' --glob '!**/__tests__/**' --glob '!**/dist/**' '\bas any\b|:\s*any\b|<any>' packages/core/src packages/studio/src packages/cli/src`，包含少量注释/文案命中，不能等同精确 AST 计数。

---

## 七、与 DS 收尾报告的差异

| DS 报告说法 | 本轮复核结论 | 原因 |
|---|---|---|
| 自动化门禁 14/14 通过 | 不成立 | Studio 首跑失败、CLI 测试失败、bundle budget 失败 |
| CLI Tests 169/169 通过 | 不成立 | 首跑 `6 failed`，复跑仍 `1 failed` |
| Bundle budget 通过 | 不成立 | 当前脚本 `maxTotalDist: 15_500_000`，实测 `16286.4 KB` |
| GUI 只需人工补测 | 部分成立 | 但自动化门禁本身未全绿，不能把问题降级为单纯 GUI 补测 |
| 项目可收尾 | 不成立 | 至少 F3/F4/F5 需要关闭后再复核 |

---

## 八、阻断项与修复建议

### P0 阻断

| 编号 | 问题 | 建议 |
|---|---|---|
| P0-1 | CLI TUI agent session 未保存 `thinking` 元数据 | 统一 `AgentSessionResult.messages` 与 TUI session message schema；修复后跑 `pnpm --filter @actalk/inkos test -- src/__tests__/tui-agent-session.test.ts`，再跑全 CLI 包 |
| P0-2 | Studio bundle 超预算 | 拆 `streamdown/shiki/mermaid` 等大依赖加载路径；修复后必须用官方 `build:budget` 验证，不用手工统计 |
| P0-3 | 工作区 dirty 阻断破坏性测试 | 明确保留或提交 `agent-input.ts` 修改；恢复 clean 后再跑破坏性前置门禁和隔离业务写入用例 |

### P1 必修

| 编号 | 问题 | 建议 |
|---|---|---|
| P1-1 | Studio 测试首轮超时、复跑通过 | 对 `server-security.test.ts`、`server.test.ts` 增加独立资源清理；检查 Hono server/pipeline mock 生命周期与 test isolation |
| P1-2 | CLI integration 与 publish-package 并发互相污染 dist | 将 `publish-package.test.ts` 与 `cli-integration.test.ts` 隔离为串行 job，或让 publish 测试使用临时复制目录而非仓库 dist |
| P1-3 | lint warnings 仍高 | 优先清理 unused import/vars；core 180、studio 228、cli 15 |
| P1-4 | 真实浏览器交互未闭环 | 引入 Playwright smoke：打开首页、BookCreate、BookWorkspace、Style、Doctor、Chat，采集截图与 console error |

### P2 收尾质量

| 编号 | 问题 | 建议 |
|---|---|---|
| P2-1 | `runner.ts`、`writer.ts`、`pipeline-runner.test.ts` 仍超大 | 延续 P3 拆分路线；优先拆测试以降低回归风险 |
| P2-2 | 外部服务类功能无真实验收 | 使用脱敏测试 Key 或 mock server 合同测试覆盖 LLM、Webhook、封面生成 |
| P2-3 | 模块报告仍有编码/历史结论污染 | 后续报告统一 UTF-8 输出，并把“首跑失败/复跑通过”写成 PASS-2 或 DEGRADED |

---

## 九、复现命令

```powershell
cd C:\Users\white\Downloads\Nofusion-main

git rev-parse --short HEAD
git status -sb
node -v
.\pnpm.cmd -v

.\pnpm.cmd -r typecheck
.\pnpm.cmd -r lint
.\pnpm.cmd -r build

Copy-Item packages/core/dist node_modules/.pnpm/@actalk+inkos-core@1.5.0/node_modules/@actalk/inkos-core/dist -Recurse -Force

.\pnpm.cmd --filter @actalk/inkos-core test
.\pnpm.cmd --filter @actalk/inkos-studio test
.\pnpm.cmd --filter @actalk/inkos test

.\pnpm.cmd --filter @actalk/inkos-studio build:budget
.\pnpm.cmd -w run verify:publish-manifests

Invoke-WebRequest -UseBasicParsing http://localhost:4577/
Invoke-WebRequest -UseBasicParsing http://localhost:4577/api/v1/doctor
Invoke-WebRequest -UseBasicParsing http://localhost:4577/api/v1/books
Invoke-WebRequest -UseBasicParsing http://localhost:4577/api/v1/services

node packages/cli/dist/index.js --version
node packages/cli/dist/index.js doctor --skip-connectivity
node scripts/assert-clean-worktree-for-destructive-tests.mjs
```

---

## 十、收尾结论

NoFusion 当前不是“测试全绿、可最终收尾”的状态。  
最保守、可溯源的判断是：

1. Core 引擎自动化验收通过。
2. Studio 构建和 HTTP/API 烟测可用，但测试首轮存在超时不稳定，bundle budget 明确失败。
3. CLI/TUI 仍有稳定测试失败，尤其是 Agent session thinking 元数据未按契约持久化。
4. 真实人机交互、真实 LLM、外部服务和破坏性写入没有完成验收，不能作为交付完成依据。

建议关闭 P0-1、P0-2、P0-3 后重新跑一次完整门禁，并在 clean worktree 下补充 Playwright/人工 GUI 证据，再进入最终交付判定。
