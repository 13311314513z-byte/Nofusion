# NoFusion 项目当前状态报告

> 评估时间：2026-06-11 | 基线：`0bca161` + 当前工作区

---

## 零、再次核验结果

本轮按 **Core → Studio → CLI** 顺序隔离执行，避免多个测试任务同时重建共享包造成假失败。结果如下：

| 核验命令 | 结果 | 结论 |
|----------|------|------|
| `pnpm typecheck` | ✅ | Core / Studio / CLI 均通过 |
| `pnpm --filter @actalk/inkos-core test` | ✅ 1,294/1,294 | Core 基线稳定 |
| `pnpm --filter @actalk/inkos-studio test` | ✅ 267/267 | Studio 测试稳定 |
| `pnpm --filter @actalk/inkos test` | ❌ 168/171 | 3 项失败可稳定复现 |
| `pnpm --filter @actalk/inkos-studio build` | ❌ | `TS5093: --force may only be used with --build` |
| Studio `npm pack`（由 CLI 测试触发） | ❌ | 被 Studio 构建失败阻断 |

### 与原报告不一致的关键结论

1. **Studio 构建尚未修复。** 当前 `build:server` 为 `tsc -p tsconfig.server.json --force`，参数组合无效；应改为 `tsc -b tsconfig.server.json --force` 或采用其他可靠的增量构建清理方案。
2. **P0 安全项不能记为 4/4 完成。** `assertProjectRoot` 仍使用字符串 `startsWith`，同前缀兄弟目录仍可能绕过根目录约束。
3. **封面 Key 保留逻辑已实现，但回归验证不完整。** 前后端能够避免空值静默覆盖，但缺少“保留、显式清除、多服务商隔离”的完整测试，前端也没有明确的清除入口。
4. **文风统一上下文仍未接通。** `StyleSourceContext`、`StyleAnalysisSession`、`TextRangeIssue` 目前主要停留在类型定义，页面状态仍存在 `language="zh"` 等硬编码。
5. **Step 4 只完成展示接入。** 删除、合并、AI 改写、标记修复等部分操作仍是 `console.log`，尚未形成可验收的处理闭环。

---

## 一、总体现状

项目已进入 **「集成收口与发布治理阶段」**，但当前工作区仍存在确定性的构建门禁失败，暂不具备发布条件。

### 核心数据

| 指标 | 数据 |
|------|------|
| TypeScript 编译 | Core ✅ / Studio ✅ / CLI ✅ 均零错误 |
| Core 测试 | 1,294/1,294 ✅ |
| Studio 测试 | 267/267 ✅ |
| CLI 测试 | **168/171 (3 项失败)** |
| 构建产物 | ❌ `build:server` 参数错误，产物断言无法执行 |
| 安全漏洞 (P0) | ⚠️ 主体修复已落地，根目录前缀绕过仍存在 |
| 审计可达性 | ✅ 顶部 `audit` 步骤可进入应用区域 |
| 封面 Key 保留 | ⚠️ 逻辑已实现，回归测试与显式清除 UI 不完整 |

---

## 二、已完成修复清单

### 批次 A（发布修复）

| 问题 | 文件 | 修复内容 | 验证状态 |
|------|------|----------|:--------:|
| 构建产物缺失 | `package.json` | 已新增 `build:verify`，但 `tsc -p ... --force` 本身非法 | ❌ |
| 封面 Key 静默清空 | `server.ts` `ServiceListPage.tsx` | 后端空 key 保留；前端 `keyDirty` 跟踪；显式 `hasStoredKey` 提示 | ⚠️ 缺回归测试 |
| 审计 `apply` 区域不可达 | `StyleManager.tsx` | 顶部五步导航包含 `audit`，应用区域可进入 | ✅ |

### 批次 B（安全与契约）

| 问题 | 文件 | 修复内容 | 验证状态 |
|------|------|----------|:--------:|
| `rhetoric/rewrite` 500 | `server.ts` | `Array.isArray` 校验 + `undefined` 保护 | ✅ |
| 蒸馏路径遍历 | `distillation-store.ts` | 所有导出函数加 `assertSafeAuthorId` | ✅ |
| `x-project-root` 任意目录 | `server.ts` | 已增加校验，但 `startsWith` 可被同前缀兄弟目录绕过 | ⚠️ |
| `samples/write` 路径遍历 | `server.ts` | 已校验 author ID，但仍继承 `assertProjectRoot` 前缀绕过 | ⚠️ |
| `authors/fetch` SSRF | `server.ts` | 已复用 URL 解析和目标地址校验，缺少对应端点回归测试 | ⚠️ |
| 裸 `JSON.parse` | `server.ts` | `GET /api/v1/project` 加 `try/catch` | ✅ |
| `paragraph/dedup` 输入未校验 | `server.ts` | `threshold`/`minLength` 类型+范围校验 | ✅ |
| 修辞 ID 冲突 | `semantic-duplication.ts` | 加随机后缀 | ✅ |
| `use-api.ts` 契约不匹配 | `use-api.ts` | 对齐 7 处 payload/返回类型 | ✅ |
| 前端 `onClick` 重入 | `StyleManager.tsx` | 作者重分析按钮增加 `reanalyzing` 保护 | ✅ |

### 文风模块改进

| 问题 | 修复内容 | 状态 |
|------|----------|:----:|
| `StyleSourceContext`/`StyleAnalysisSession`/`TextRangeIssue` 类型 | 已定义，但尚未接入页面状态和诊断统一流 | ⚠️ |
| 章节选择器 | `StyleTextTab.tsx` 增加"书籍→章节→导入"三级 UI | ✅ |
| 漂移评分使用真实章节号 | `StyleDriftScoreSection` 接受 `chapterNumber` | ✅ |
| AI 检测防抖+取消 | `AITellsPanel.tsx` 增加 `AbortController`、400ms 防抖、共享 `runDetection` | ✅ |
| Step 4 接入 | 三个面板已渲染，但部分按钮仍只执行 `console.log` | ⚠️ |
| 诊断风险标注 | 已按 `start`/`end` 截取片段，尚未形成统一编辑器高亮定位 | ⚠️ |
| 诊断 `text` prop | 传递原文用于风险标注 | ✅ |

---

## 三、剩余问题与优先级

### P1 — 下一轮主迭代

| # | 问题 | 影响 | 文件 | 工作量 |
|---|------|------|------|:------:|
| **0** | Studio 构建脚本无效 | `tsc -p ... --force` 必然报 `TS5093`，同时阻断 `npm pack` | `studio/package.json` | 0.5h |
| **1** | CLI JSON 契约半迁移 | `analytics`/`doctor`/`export` 用 `formatJsonOutput`，其余未迁移；测试仍读扁平结构 | `cli/commands/*` | 2h |
| **2** | CLI `doctor` 本地端点超时 | localhost 未启动端点增加 2-3s 等待，`--json` 输出被日志污染 | `doctor.ts` | 2h |
| **3** | `assertProjectRoot` 用 `startsWith` | `Nofusion-main-evil` 同前缀目录可绕过；需改 `path.relative` | `server.ts:1714` | 1h |
| **4** | 修辞 issue 动作为 `console.log` | `ai-rewrite`/`mark-fixed` 无真实处理，用户点击无反馈 | `StyleManager.tsx:1265,1277` | 4h |
| **5** | 应用后无自动复检 | 接受 diff 后不触发重新诊断/AI 检测/对比 | `AdjustmentSuggestionsPanel.tsx` | 4h |
| **6** | `withPipeline` TTL 未实现 | 长时 Pipeline 无法强制释放；`dispose` 异常覆盖业务异常 | `server.ts:771` | 2h |
| **7** | 章节版本历史缺失 | `PUT` 章节前无 backup；`revisionCount` 仅字段无持久化 | `server.ts:1907` | 1d |
| **8** | `project-tools.ts` 静默吞异常 | 模型返回畸形 JSON 时无感知 | `project-tools.ts:517` | 1h |
| **9** | CLI 路径遍历 | `--context-file`/`--output` 未校验越界 | `cli/utils.ts:16`, `export.ts:22` | 2h |
| **10** | CLI `--format` 类型断言 | 非法格式不报错，生成错误扩展名文件 | `export.ts:20` | 1h |

### P2 — 技术债务

| # | 问题 | 影响 | 工作量 |
|---|------|------|:------:|
| **1** | 12 处 async `onClick` 重入保护 | BDD/批量检测等可重复提交 | 4h |
| **2** | `useAutoSave` 死代码 | 调用不存在端点（暂时安全） | 2h |
| **3** | `RhetoricHighlightEditor` 孤立 | 有定义无页面使用 | 2h |
| **4** | book-workspace 78 处硬编码中文 | 深色/英文界面不可读 | 1d |
| **5** | "一键检测全部"无真实 probe | 只刷新模型列表，名称误导 | 4h |
| **6** | 前端包体积 ~2.7 MB | Mermaid/Shiki 等未动态加载 | 1d |

---

## 四、发布就绪评估

### ✅ 已达标

| 验收项 | 状态 |
|--------|:----:|
| TypeScript 编译 | 三包均 ✅ |
| Core 测试 1,294/1,294 | ✅ |
| Studio 测试 267/267 | ✅ |
| 审计 `apply` 区域可达 | ✅ |

### ❌ 未达标

| 验收项 | 状态 | 影响 |
|--------|:----:|------|
| CLI 测试全绿 | ❌ 168/171 | 发布门禁未过 |
| Studio 构建 | ❌ `TS5093` | 服务端产物无法生成 |
| 构建产物断言 | ❌ 未执行到 | 被 `build:server` 提前阻断 |
| `npm pack` 内容验证 | ❌ 已执行但失败 | 发布包无法生成 |
| 封面 Key 保留语义 | ⚠️ 代码确认、测试不全 | 仍有回归风险 |
| 安全漏洞闭环 | ⚠️ 根路径校验未闭环 | 同前缀目录仍可绕过 |
| 浏览器全功能手测 | ❌ 未执行 | 文风/蒸馏串联未验证 |
| 文风功能闭环（检测→修改→复检） | ⚠️ 部分完成 | 动作无真实处理 |
| 作家蒸馏前端工作台 | ❌ 后端就绪前端缺失 | 5 个端点无 UI |
| 章节版本历史 | ❌ 无持久化 | 修改覆盖不可逆 |

---

## 五、建议执行顺序

```
批次 A（1天）→ 批次 B（2天）→ 批次 C（3-5天）→ 批次 D（2-3天）

当前 ████████████░░░░░░░░ 60% (批次A: 构建与打包仍未通过)
即将 → ██████████░░░░░░░░ 50% (批次B: 安全主体落地，边界未闭环)
下一轮 → ░░░░░░░░░░░░░░░  5%  (批次C: 文风闭环)
后续 → ░░░░░░░░░░░░░░░░  0%  (批次D: 章节治理)
```

### 建议立即执行（按顺序）

1. **先修复 Studio 构建脚本** — 将 `build:server` 改为合法的 build mode 调用，并实际验证三个目标产物。
2. **修复 CLI 其余 2 项失败** — 对齐 `export --json` 契约并消除 doctor 本地端点超时。
3. **`assertProjectRoot` 改为 `path.relative`** — 防同前缀目录绕过，并增加端点级安全回归测试。
4. **补封面 Key 回归测试和显式清除入口** — 覆盖保留、清除、多服务商隔离。
5. **实现修辞 issue 动作与应用后复检** — 删除当前 `console.log` 占位，形成检测→修改→复检闭环。
6. **章节保存前 snapshot** — `PUT` 前将旧内容写入 `story/chapter-versions/`。

### 可推迟项

- 作家蒸馏工作台 → P1（后端已就绪，缺少前端）
- 伏笔关系图/声线系统 → P3（中长期）
- 前端包体积 → P2（性能优化）
- 移动端适配 → 已否决或长期

---

## 六、一句话结论

> **项目主体功能和两套核心测试基线稳定，但发布链路尚未闭合。**  
> 当前首要风险是 Studio 构建必然失败，并连带阻断 `npm pack`；其次是根目录安全边界、CLI 契约和文风操作闭环。  
> **应先恢复构建与打包门禁，再处理安全回归和功能扩展；在此之前不建议标记为发布就绪。**
