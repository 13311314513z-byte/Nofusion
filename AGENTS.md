# NoFusion / InkOS — AGENTS.md

> 基于 0605–0623 迭代历程、194 份报告回溯、三源交叉审计及用户独立验证提炼。
> 本文件是项目的工作宪法：违反任何 🔴 红级约束即为阻断项。

---

## 项目目标

InkOS 是面向长篇小说的 AI 写作管线引擎：10+ Agent 协作，覆盖大纲规划、章节创作、修订、33 维连续性审计、风格克隆、去 AI 化、Beta Reader 偏好校准、真值文件事实追踪。

---

## 🔴 报告诚实（0621 审计后新增 — 最高优先级）

这是项目的**最高优先级规则**。0621 审计发现 DS 报告存在系统性虚假声明（选择性报告 CLI 结果、使用非官方测量方法、未披露工作区脏状态）。此后不可再犯。

### 报告规则

- **终端实测为唯一权威**：所有门禁结论必须以终端命令输出为依据，不允许手动估算、手动计算、手动推断。
- **必须使用官方命令**：Bundle 大小用 `pnpm build:budget`，不用 `Get-ChildItem` 求和；测试结果用 `vitest run` 输出，不手动数文件。
- **标注所有前提条件**：若 Bundle 为临时豁免阈值、CLI 依赖 store 手动同步、数据为合成占位符——必须在报告中显式声明。
- **禁止选择性报告**：若一项门禁多次运行中有一次失败，必须报告失败。不允许只报告首次通过而隐藏后续失败。
- **标注数据质量**：合成数据/模板占位符/单 Reader/全 tie 等必须在报告顶部警告。数量达标不等于质量达标。
- **标注统计方法与口径**：行数、any 数量等指标必须注明统计命令。三方分歧时取最保守值。
- **标注信任度**：每项结论标注置信度（高/中/低）及依据来源。
- **[KNOWN]/[COMPUTED]/[INFERRED]/[GUESS] 标记**：遵循 ALL 协议，所有声明必须打标签。FRAME→REALITY 禁止翻译。
- **"我不知道"优先于编造**：无法验证的结论不得推断为事实。

### 报告禁止的表述

| 禁止 | 原因 |
|------|------|
| "全部门禁通过，零阻塞项" | 除非所有前提条件均已满足 |
| "数据量充足，可考虑进入 X 模式" | 除非数据质量检测已通过 |
| "项目可交付" | 除非门禁+基线+人力验证三项均通过 |
| 不标注前提条件的 ✅ | 临时豁免、手动步骤必须与 ✅ 同时出现 |

---

## 🔴 代码门禁（阻断项）

每次 commit 前必须通过。任何一项失败即阻断。

```powershell
pnpm -r typecheck    # 三包 0 errors
pnpm -r lint         # 三包 0 errors（warnings 不阻断但需记录）
pnpm -r build        # 三包构建 + Studio build:verify
```

### 构建顺序依赖

```
core (tsc) → studio (Vite client + tsc server + verify) → cli (tsc)
```

不可并行构建 core 和依赖 core 的包。

### 测试

```powershell
# 分包执行（避免 prepack 竞态）：
pnpm --filter @actalk/inkos-core test     # 目标: 145+ files, 1454+ tests
pnpm --filter @actalk/inkos-studio test   # 目标: 25+ files, 277+ tests
pnpm --filter @actalk/inkos test          # 目标: 34 files, 169 tests
```

- **CLI 测试需 pnpm store 同步**：`pnpm build` 后必须手动复制 `packages/core/dist` 到 `.pnpm/store` 中的对应路径，否则 CLI 测试报 MODULE_NOT_FOUND。
- **禁止 `pnpm -r test`**：全量执行触发 prepack 竞态条件导致 CLI 测试不稳定。CI 应分三个独立 job。

---

## 🔴 代码风格与架构约束

### 文件大小

| 文件类型 | 硬上限 | 软上限（触发拆分讨论） |
|------|:--:|:--:|
| 生产代码 | 800 行 | 500 行 |
| 测试文件 | 1500 行 | 1000 行 |

- `runner.ts` 当前 ~1810 行（目标 <800，持续拆分中）
- `server.ts` 当前 ~1233 行（目标 <1200）
- `pipeline-runner.test.ts` ~4793 行（目标拆成 6 文件）
- `server.test.ts` ~3810 行（目标拆成 5 文件）

### 类型系统

- TypeScript strict mode
- `workspace:*` 保留在源码 `package.json` 中，发布时替换
- 禁止生产代码使用 `as any`（目标 <50）
- `catch(err: any)` → `catch(err)` + `instanceof Error` 窄化
- 导出类型与实现分离，CLI 依赖 core 的公共 API 面

### 模块组织

- **Pipeline 模块**：`pipeline-*.ts` 按领域职责拆分，禁止反向 import runner
- **路由模块**：`routes/*.ts` 每文件一个路由组，禁止 server.ts 内联路由
- **Shared helpers**：跨路由共用逻辑抽取到 `api/shared/*.ts`
- **不可变模式优先**：`{ ...obj, key: value }` 覆盖直接突变
- **空 catch 块**：必须注释原因或记录日志，不允许静默吞异常

### 依赖方向

```
外部依赖
  ↓
packages/core     ← 无 workspace 内部依赖
  ↓
packages/studio   ← 依赖 core
  ↓
packages/cli      ← 依赖 core
```

- CLI 不直接依赖 studio
- pipeline-* 模块不反向 import runner
- routes/ 不反向 import server.ts

---

## 🔴 已知陷阱（不可重犯）

| 陷阱 | 表现 | 预防 |
|------|------|------|
| **prepack 竞态** | `pnpm test` 中 prepack 修改 package.json 导致后续测试 MODULE_NOT_FOUND | 分包执行测试；store 同步 |
| **pnpm store 过期** | core build 后 store 未自动更新，CLI typecheck 报 TS2305 | build 后手动复制 dist 到 store |
| **非官方测量** | 用 `Get-ChildItem` 统计 Bundle 得到错误值（14,968 vs 官方 16,282 KB） | 只用官方 `build:budget` 命令 |
| **选择性报告** | 多次运行中只报最好的结果 | 报告最坏结果或全部结果 |
| **只看数量不看质量** | 校准脚本 ≥10 条即称"充足"，无视合成数据/全 tie/单 Reader | 先检查数据质量，再谈数量 |
| **删除导入时连带删除相邻 import** | 提取 SSRF guard 函数时误删之间的 `withPipeline` 导入 | 编辑后验证 typecheck，检查所有 import |
| **`const self = this` 未使用** | refactor 时遗留的脚手架代码触发 lint error | 每次 commit 前运行 lint |
| **大文件继续堆功能** | runner.ts 曾达 2600 行 | 接近 500 行预警，超过 800 行只做拆分不新增 |

---

## 🟡 测试规范

- **集成测试优先**：Agent 主流程、工具调用、Pipeline 阶段、版本恢复、会话状态变更
- **单元测试**：纯函数、解析器、边界条件、状态转换
- **新 Pipeline 模块必须有独立测试**：不可仅依赖 `pipeline-runner.test.ts` 间接覆盖
- **测试文件命名**：`*.test.ts` 或 `__tests__/*.test.ts`
- **禁止**：为静态常量写无意义测试；通过 `it.skip` 掩盖失败
- **修复 bug 时**：先写能复现的测试，再修代码
- **真实 LLM E2E** 作为 opt-in（`INKOS_RUN_REAL_LLM_E2E=1`），不计入默认门禁

---

## 🟡 报告系统

### 三源交叉验证流程（0621 确立）

当存在多份独立报告时：
1. 逐项对照三源数据
2. 以终端实测输出为最终裁决
3. 标注分歧项及分歧原因
4. 取最保守值作为合并结论
5. 标注各报告的可信度

### 报告模板

```markdown
# [日期] [主题]

> 执行时间 / Git HEAD / 方法 / 诚实声明

## 门禁结果
| 门禁 | 命令 | 结果 | 实测数据 |

## 前提条件（不可省略）
## 已知问题
## 与历史报告的差异（如有）
## 复现命令
```

---

## 🟡 Git 工作流

```bash
# 双远程推送
git push origin master    # GitHub
git push gitee master     # Gitee

# Commit 规范
<type>: <description>
# type: feat / fix / refactor / docs / test / chore / perf / ci

# 推送前检查
pnpm -r typecheck && pnpm -r lint && pnpm -r build
```

- Commit 原子化：一个逻辑变更一个 commit
- 工作区保持清洁：定期清理未跟踪文件和未提交修改

---

## 🔵 偏好风格

- 2-space 缩进
- 函数 <50 行
- `prefer-const`，禁止 `var`
- 早返回降低缩进层级
- `catch` 参数不重新赋值（`no-ex-assign`）
- `_` 前缀表示有意未使用变量
- 接口/类型优先于 `any`
- 泛型优先于类型断言

---

## 版本与合规

- 版本: v1.5.0
- 许可证: AGPL-3.0-only
- Node ≥ 20, pnpm ≥ 9
- TypeScript ^5.9
- 测试框架: vitest v3.2
- 构建工具: Vite v6.4 (studio), tsc (core/cli)

---

> **最后更新**: 2026-06-23（基于 0621 审计 + Nova 对照分析 + 全量门禁复核）  
> **本文件约束力**: 🔴 红级 = 阻断，🟡 黄级 = 强烈建议，🔵 蓝级 = 偏好  
> **修订记录**: 初始版本基于 CONTRIBUTING.md + 0621 欺骗项修正 + ALL 协议 + 三源合并报告
