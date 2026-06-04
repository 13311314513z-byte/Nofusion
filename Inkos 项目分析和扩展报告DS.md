# Inkos 项目分析与扩展报告

> **项目版本**: 1.4.1  
> **许可证**: AGPL-3.0  
> **仓库**: https://github.com/Narcooo/inkos  
> **技术栈**: TypeScript (ES2022/Node16), React 19, Hono, Vite, Zustand, Ink (React CLI), pi-agent-core  
> **Monorepo 管理**: pnpm workspace (3 个 package)

---

## 目录

1. [项目构建思路与哲学](#1-项目构建思路与哲学)
2. [整体构建逻辑与架构全景](#2-整体构建逻辑与架构全景)
3. [思维链条：7 阶段智能体管线](#3-思维链条7-阶段智能体管线)
4. [文风锁（Style Lock）体系](#4-文风锁style-lock体系)
5. [章节创作控制（Governed Writing）](#5-章节创作控制governed-writing)
6. [审计逻辑（37 维度连续性审计）](#6-审计逻辑37-维度连续性审计)
7. [前后端优势分析](#7-前后端优势分析)
8. [前端与后端联系方式](#8-前端与后端联系方式)
9. [可扩展边界](#9-可扩展边界)
10. [总结与生态展望](#10-总结与生态展望)

---

## 1. 项目构建思路与哲学

### 1.1 核心使命

Inkos 是一个**多智能体自主小说写作系统**，核心理念是：

> **让 AI 写出有「人味」的长篇连续故事，而非碎片化的 AI 文本。**

它解决的痛点：
- 大语言模型在长文本创作中容易出现**连续性断裂**（角色 OOC、力量体系崩塌、伏笔丢失）
- AI 文本有明显的**模式化痕迹**（"然而""不禁""仿佛"泛滥、句式单调）
- 长篇小说需要**复杂的设定管理**（世界观、角色弧、力量体系、伏笔网络）

### 1.2 设计哲学

| 原则 | 说明 |
|------|------|
| **连续性至上** | 37 维审计 + 状态快照 + 伏笔生命周期管理，确保千章级叙事不断裂 |
| **治理式写作** | 多层规则栈（L1-L4）控制写作边界，AI 在约束内创作而非自由发挥 |
| **人味优先** | 去 AI 味方法论、反检测改写、风格指纹提取，让输出接近人类作家 |
| **确定性 + LLM 混合** | 纯规则校验（PostWriteValidator）零 LLM 成本；LLM 负责创意生成 |
| **人类在环** | 审计门、修订轮、手动模式，创作者始终掌握最终决策权 |
| **题材无关** | 支持 15+ 题材（玄幻、修仙、都市、灵异、LitRPG、科幻等），各题材独立 profile |
| **多语言** | 原生支持中文/英文，Prompt 模板全双语言设计 |

### 1.3 项目结构

```
inkos/
├── packages/
│   ├── core/          # 核心引擎 — 7 阶段多智能体管线
│   │   ├── src/
│   │   │   ├── agents/       # 15+ 智能体实现
│   │   │   ├── agent/        # pi-agent-core 集成层
│   │   │   ├── pipeline/     # 管线编排、调度、章节生命周期
│   │   │   ├── interaction/  # 自然语言交互路由、会话管理
│   │   │   ├── llm/          # LLM 提供商抽象（28+ 提供商）
│   │   │   ├── models/       # Zod 数据模型层
│   │   │   ├── state/        # 状态管理、快照、内存数据库
│   │   │   ├── prompts/      # 共享提示词片段
│   │   │   ├── notify/       # 通知渠道（Telegram/企微/飞书/Webhook）
│   │   │   └── utils/        # 工具库（分词器、上下文组装、方法论等）
│   │   └── genres/           # 15+ 题材 profile 文档
│   ├── cli/           # CLI 终端界面（Ink React + Commander）
│   │   └── src/
│   │       ├── commands/     # 25+ 子命令
│   │       ├── tui/          # 终端 UI（Ink 渲染）
│   │       └── interaction/  # CLI 交互工具实现
│   └── studio/        # Web 工作台（React + Hono + Vite）
│       └── src/
│           ├── api/          # Hono 后端服务
│           ├── components/   # React 组件（shadcn/ui 风格）
│           ├── store/        # Zustand 状态管理
│           └── shared/       # 前后端共享契约类型
├── books/             # 书籍数据存储（每书一个子目录）
└── scripts/           # 发布脚本
```

---

## 2. 整体构建逻辑与架构全景

### 2.1 三层架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                       用户界面层                             │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐                 │
│   │  Studio   │  │   CLI    │  │   TUI    │  ← OpenClaw     │
│   │ (Web UI)  │  │ (Term)   │  │ (Ink)    │                 │
│   └────┬─────┘  └────┬─────┘  └────┬─────┘                 │
│        │             │             │                        │
├────────┼─────────────┼─────────────┼────────────────────────┤
│        ▼             ▼             ▼                        │
│   ┌──────────────────────────────────────────────────────┐  │
│   │                交互层 (Interaction Layer)              │  │
│   │  ┌──────────┐  ┌──────────┐  ┌───────────────────┐   │  │
│   │  │ NL Router │→│ Request  │→│ InteractionRuntime │   │  │
│   │  │ (自然语言  │  │ Router   │  │ (工具调度 + 会话)  │   │  │
│   │  │  路由)    │  │ (校验)   │  │                    │   │  │
│   │  └──────────┘  └──────────┘  └────────┬──────────┘   │  │
│   └────────────────────────────────────────┼──────────────┘  │
│                                            │                │
├────────────────────────────────────────────┼────────────────┤
│                                            ▼                │
│   ┌──────────────────────────────────────────────────────┐  │
│   │                 核心引擎层 (Core Engine)               │  │
│   │                                                      │  │
│   │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌───────┐  │  │
│   │  │Pipeline │→│  Agents  │→│  State  │→│  LLM  │  │  │
│   │  │ Runner  │  │ (7阶段)  │  │ Manager │  │Provider│  │  │
│   │  └─────────┘  └─────────┘  └─────────┘  └───────┘  │  │
│   │                                                      │  │
│   │  ┌──────────────────────────────────────────────┐   │  │
│   │  │         调度器 (Scheduler)                     │   │  │
│   │  │  雷达扫描(cron) | 写作循环(cron) | 质量门控    │   │  │
│   │  └──────────────────────────────────────────────┘   │  │
│   └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心模块依赖关系

```
@actalk/inkos-core (核心引擎)
    │
    ├── @actalk/inkos-studio (Web 工作台 — 依赖 core)
    │
    └── @actalk/inkos (CLI — 依赖 core + studio)
```

### 2.3 数据流概览

```
用户输入 → NL Router → Intent 解析 → Interaction Runtime
    → Pipeline Runner → 7 阶段 Agent 管线
    → LLM 调用 → 确定性校验 → 状态持久化 → 结果返回
```

### 2.4 配置体系

项目根目录的 `inkos.json` 是全局配置入口：

```json
{
  "name": "NoFusion",
  "version": "0.1.0",
  "language": "zh",
  "llm": {
    "provider": "openai",
    "service": "deepseek",
    "baseUrl": "https://api.deepseek.com",
    "model": "deepseek-v4-flash",
    "temperature": 0.7
  },
  "inputGovernanceMode": "v2",
  "daemon": {
    "schedule": {
      "radarCron": "0 */6 * * *",
      "writeCron": "*/15 * * * *"
    },
    "maxConcurrentBooks": 3
  }
}
```

支持：
- 28+ LLM 提供商（OpenAI、Anthropic、DeepSeek、智谱、MiniMax、Moonshot 等）
- 每智能体独立模型覆盖（`modelOverrides`）
- 通知渠道（Telegram、企业微信、飞书、Webhook）
- 守护进程模式（定时雷达扫描 + 自动写作）

---

## 3. 思维链条：7 阶段智能体管线

这是 Inkos 最核心的创新——**7 阶段顺序执行的多智能体写作管线**。

### 3.1 管线全景图

```
Phase 1: Architect (架构师)
    ↓ 输出: story_frame.md + volume_map.md + roles/ + pending_hooks.md
Phase 2: FoundationReviewer (基础设定审核)
    ↓ 多轮审核循环，直到通过或达到最大重试次数
Phase 3: Planner (规划师)
    ↓ 输出: ChapterMemo (7 段式章节备忘录)
Phase 4: Composer (编排器)
    ↓ 输出: ContextPackage + RuleStack + ChapterTrace
Phase 5: Writer (作家) — 双阶段
    ├─ 5a. Creative Writing (temp=0.7) → 生成正文
    └─ 5b. Settlement (状态结算) → 提取状态变更
Phase 6: Continuity Auditor (连续性审计师)
    ↓ 37 维度审计 + 评分
Phase 7: Reviser (修订师) — 6 种模式
    └─ 审计通过 → ready-for-review
    └─ 审计失败 → 自动修订循环
```

### 3.2 各阶段详细分析

#### Phase 1: Architect（架构师智能体）

**文件**: `packages/core/src/agents/architect.ts`

**职责**: 为新书生成完整的基础设定（Foundation），包含 5 个核心产出物：

| 产出物 | 文件 | 内容 | 字数限制 |
|--------|------|------|----------|
| 故事框架 | `outline/story_frame.md` | 主题、核心冲突、世界规则、结局方向 + OKR | ≤3000 字 |
| 卷纲 | `outline/volume_map.md` | 5 段式段落 + 节奏原则 | ≤5000 字 |
| 角色卡 | `roles/主要角色/*.md`, `roles/次要角色/*.md` | 每角色完整弧线（起点→终点→代价） | ≤8000 字 |
| 本书规则 | `book_rules.md` (YAML frontmatter) | 数值系统、力量体系、时代约束 | — |
| 伏笔池 | `pending_hooks.md` | 13 列伏笔台账（id, type, status, payoff timing, dependencies） | — |

**关键逻辑**:
- Phase 5 去重合并：主角弧线只在 roles/ 中，世界规则只在 story_frame 中，消除冗余
- 预算控制：每文件有严格字数上限
- 语言覆写：当 `book.language="en"` 时输出英文
- 支持 **FoundationReviewerAgent** 多轮审核循环（默认最多 2 次重试）

#### Phase 2: FoundationReviewer（基础设定审核智能体）

**文件**: `packages/core/src/agents/foundation-reviewer.ts`

**职责**: 对 Architect 生成的设定进行多维度评分

**审核维度**:
- 世界观完整性
- 角色弧线合理性
- 冲突驱动力
- 平台适配性
- 题材合规性

**流程**:
1. Reviewer 对设定打分（0-100）
2. 总分 < 85 且未达最大重试次数 → 反馈注入 Architect → 重新生成
3. 审核通过或达到重试上限 → 进入下一阶段

#### Phase 3: Planner（规划师智能体）

**文件**: `packages/core/src/agents/planner.ts`

**职责**: 为当前章节生成 **7 段式章节备忘录 (ChapterMemo)**

**7 段式结构**:
```
1. Goal (目标) — ≤50 字符，LLM 验证，具体可执行
2. Tasks (当前任务) — 本章必须发生的事情
3. Payoff & Held-back Cards (该兑现/暂不掀牌)
   — 哪些伏笔在本章回收，哪些继续保留
4. Daily/Transition Function (日常/过渡功能)
   — 非动作场景的存在意义
5. Three-Question Check (关键抉择三连问)
   — 每个角色为什么这么做？
6. End-of-chapter Changes (章尾必须发生的改变)
   — 具体的状态差异
7. Prohibitions (不要做)
   — 本章禁止出现的元素
```

**输入收集**:
- 最近 3 章摘要
- 可回收伏笔（超过阈值的沉寂伏笔）
- 角色矩阵（主角、对手、协作者）
- 支线状态、情感弧线
- 卷纲当前节点
- author_intent + current_focus

**重试逻辑**: LLM 解析失败时最多重试 3 次，每次注入错误反馈

#### Phase 4: Composer（编排器智能体）

**文件**: `packages/core/src/agents/composer.ts`

**职责**: 为 Writer 组装治理式上下文

**产出物**:
1. **ContextPackage** — 选取的上下文条目（含来源和选取理由）
2. **RuleStack** — 多层规则栈（L1-L4）+ 活跃覆写
3. **ChapterTrace** — 可追溯的输入决策日志

**治理规则栈**:
```
L1: hard_facts (precedence=100, scope=global)
    → story_frame, current_state, book_rules, roles
L2: author_intent (precedence=80, scope=book)
    → author_intent, current_focus, volume_map
L3: planning (precedence=60, scope=arc)
L4: current_task (precedence=70, scope=local)
```

**覆写边缘**:
- L4 → L3: ✅ 允许（当前章节可收紧规划层）
- L4 → L2: ❌ 禁止
- L4 → L1: ❌ 禁止

#### Phase 5: Writer（作家智能体）— 创意双阶段

**文件**: `packages/core/src/agents/writer.ts`

**5a. 创意写作阶段 (Creative, temp=0.7)**

- LLM 调用系统提示词 + 治理式用户提示词
- 注入：风格指纹、对话模式、题材约束
- 读取：story_frame, volume_map, current_state, hooks, summaries, subplots, arcs, character_matrix
- **POV 感知过滤** — 限制上下文为 POV 角色所知信息

**5b. 结算阶段 (Settlement)**

三个并行子智能体：

| 子智能体 | 职责 |
|---------|------|
| **Settler Delta** | 将章节正文转换为状态增量（谁变了、变什么、为什么） |
| **Settlement** | 验证增量是否符合本书规则（数值系统、力量体系） |
| **Observer** | 提取角色/关系/支线变化 |

**产出物**: `WriteChapterOutput`
- 章节正文 + 字数统计
- 更新后的状态/伏笔/摘要
- 写后违规（error/warning）
- 伏笔健康度问题（沉寂/阻塞升级）

#### Phase 6: Continuity Auditor（连续性审计师智能体）

**文件**: `packages/core/src/agents/continuity.ts`

**37 维度审计**（详见第 6 章）
- 含：OOC 检查、时间线一致性、Lore 冲突、力量体系漂移、数值一致性、伏笔债务、节奏、风格一致性等
- 严重级别：critical / warning / info

#### Phase 7: Reviser（修订师智能体）

**文件**: `packages/core/src/agents/reviser.ts`

**6 种修订模式**:

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| `auto` | LLM 根据问题数量自动选 patch-only / rewrite-only / full rewrite | 默认 |
| `polish` | 仅润色表达和节奏，不改剧情 | 轻微表达问题 |
| `rewrite` | 围绕问题段落重组，保留大部分句子 | 中等质量问题 |
| `rework` | 重构场景+冲突，保留主要事件 | 严重结构问题 |
| `anti-detect` | 减少 AI 标记同时保留剧情 | 检测分数过高 |
| `spot-fix` | 仅修复指定语句（问题±1句） | 精确修复 |

**修订循环**:
```
审计失败 → Reviser 修订 → 重新审计 → 评分改善？
  ├─ 是且达到阈值 → 通过
  ├─ 是但未达阈值 → 继续修订（最多 maxReviewIterations 次）
  └─ 否（无净提升） → 取评分最高的快照
```

### 3.3 管线编排器 (PipelineRunner)

**文件**: `packages/core/src/pipeline/runner.ts`

核心编排类，负责：
- 串联所有 7 阶段 Agent
- 管理 LLM 客户端池（含模型覆盖缓存）
- 处理章节生命周期（创建→撰写→审计→修订→持久化）
- 导入已有章节（importChapters — 整书重导）
- 基础设定重写（reviseFoundation）
- 短篇小说生产（shortFictionRun）

### 3.4 调度器 (Scheduler)

**文件**: `packages/core/src/pipeline/scheduler.ts`

守护进程模式下的自动写作调度：

- **雷达扫描**：cron 表达式（默认每 6 小时）
- **写作循环**：cron 表达式（默认每 15 分钟）
- **并发控制**：`maxConcurrentBooks`（默认 3）
- **质量门控**：
  - `maxAuditRetries`: 最大审计重试（默认 2）
  - `pauseAfterConsecutiveFailures`: 连续失败暂停（默认 3 次）
  - `retryTemperatureStep`: 重试温度递增步长（默认 0.1）
- **日限额**：`maxChaptersPerDay`（默认 50 章/天）
- **失败聚类**：按维度追踪失败模式
- **自动暂停**：连续失败达阈值时自动暂停该书

---

## 4. 文风锁（Style Lock）体系

### 4.1 三层文风控制

```
Layer 1: 写作方法论 (Writing Methodology)
  ├── 去 AI 味正反例对照表
  ├── 六步走人物心理分析
  ├── 配角设计方法论
  ├── 代入感六大支柱
  ├── 强情绪升级法
  └── 写前自检清单

Layer 2: 风格指纹 (Style Profile)
  ├── 句长统计（均值、方差、分布）
  ├── 段落形状分析
  ├── 词汇多样性（TTR）
  ├── 修辞模式提取
  └── 高频句首词统计

Layer 3: 本书规则 (Book Rules / Story Frame)
  ├── YAML frontmatter 数值系统
  ├── 力量体系约束
  ├── 时代背景规范
  └── 题材特定规则
```

### 4.2 风格分析器 (Style Analyzer)

**文件**: `packages/core/src/agents/style-analyzer.ts`

- **纯文本分析**（零 LLM 成本）
- 从参考文本提取可量化风格指标
- 输出 `style_profile.json`（结构化数据）+ `style_guide.md`（人工可读版）

### 4.3 写作方法论注入

**文件**: `packages/core/src/utils/writing-methodology.ts`

完整方法论文档在 `initBook`/`generateStyleGuide` 时注入，Writer 每章作为 `style_guide` 上下文读取。

**核心反 AI 模式**：

| AI 味特征 | 反制策略 |
|-----------|----------|
| 情绪标签化（"感到愤怒"） | 动作外化（"捏碎茶杯"） |
| 因果连词（"然而""因此"） | 口语化替代或直接删掉 |
| "了"字密集 | 控制密度，用"嘴角一扬"替代"笑了笑" |
| 排比对称句式 | 打破句式规律，长短句交错 |
| 虚词堆砌（"仿佛""不禁""宛如"） | 删除或替换为具象描写 |
| 元叙述（"正如前文所说"） | PostWriteValidator 检测并标记 |

### 4.4 写后校验器 (PostWriteValidator)

**文件**: `packages/core/src/agents/post-write-validator.ts`

确定性规则（零 LLM 成本）：

| 规则 | 说明 |
|------|------|
| "不是…而是" 禁令 | 检测并标记该句式 |
| 破折号禁令 | 中文破折号过度使用检测 |
| Marker 词密度 | "仿佛""不禁""宛如"等标记词计数 |
| 疲劳词检测 | 单章内高频重复词 |
| 元叙述检测 | "正如前文""我们之前提到" |
| 报告词检测 | "报告""汇报""请示"等公文词 |
| 说教词检测 | 大段说理性文字 |
| 集体震惊模式 | "众人皆惊""全场哗然"等套路 |
| 连续 "了" 字 | 连续多个"了"的句子 |
| 段落长度 | 过长或过短段落标记 |

---

## 5. 章节创作控制（Governed Writing）

### 5.1 治理式写作核心机制

Inkos 最独特的设计之一：**写作不是让 AI 自由发挥，而是在多层约束下有控制的创作**。

```
                    ┌─────────────────────┐
                    │   author_intent.md   │  ← 长期愿景
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  current_focus.md    │  ← 近期关注
                    └──────────┬──────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
    ┌──────────┐        ┌──────────┐        ┌──────────┐
    │ 卷纲节点  │        │ 角色矩阵  │        │ 伏笔池   │
    └──────────┘        └──────────┘        └──────────┘
          │                    │                    │
          └────────────────────┼────────────────────┘
                               ▼
                    ┌─────────────────────┐
                    │   ChapterMemo (7段)   │  ← Planner 输出
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   ContextPackage +   │
                    │   RuleStack          │  ← Composer 输出
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Writer (治理式)    │  ← 在约束内创作
                    └─────────────────────┘
```

### 5.2 输入治理 (Input Governance)

**文件**: `packages/core/src/models/input-governance.ts`

**模式**: `legacy` / `v2`（通过 `inkos.json` 的 `inputGovernanceMode` 配置）

**关键类型**:

```typescript
interface RuleStack {
  layers: RuleLayer[];           // L1-L4
  sections: RuleStackSections;   // hard / soft / diagnostic
  overrideEdges: OverrideEdge[]; // 权限规则
  activeOverrides: ActiveOverride[]; // 当前活跃覆写
}

interface ContextPackage {
  chapter: number;
  selectedContext: ContextSource[]; // 每项含 source + reason + excerpt
}

interface ChapterTrace {
  chapter: number;
  plannerInputs: string[];
  composerInputs: string[];
  selectedSources: string[];
  notes: string[];
}
```

### 5.3 状态管理

**文件**: `packages/core/src/state/manager.ts`

**7 个长期记忆文件**（每书的 truth files）：

| 文件 | 内容 | 更新时机 |
|------|------|----------|
| `current_state.md` | 角色位置、关系、已知信息、当前冲突 | 每章结算 |
| `particle_ledger.md` | 物品/资源账本，每笔增减有据可查 | 每章结算 |
| `pending_hooks.md` | 已埋伏笔、推进状态、预期回收时机 | 每章结算 |
| `chapter_summaries.md` | 每章压缩摘要（人物、事件、伏笔、情绪） | 每章写入 |
| `subplot_board.md` | 支线进度板 | 每章结算 |
| `emotional_arcs.md` | 角色情感弧线 | 每章结算 |
| `character_matrix.md` | 角色交互矩阵与信息边界 | 每章结算 |

**状态快照**：
- 每章写入前自动创建快照
- 支持回滚重写（`write rewrite` 命令）
- 快照存储在 `story/snapshots/<version>/` 目录

### 5.4 伏笔生命周期管理

**文件**: `packages/core/src/utils/hook-lifecycle.ts`, `hook-governance.ts`, `hook-health.ts` 等

**伏笔状态机**:
```
planted → progressing → near_payoff → resolved
  ↓                                               ↑
  └── stale (沉寂超阈值) → recyclable (可回收) ───┘
```

**回收阈值**:
- `pressured` / `near_payoff` / `progressing` → 5 章沉寂
- `planted` / `open` → 10 章沉寂
- `coreHook === true` → 8 章沉寂（核心伏笔容忍度更高）

**健康度监控**:
- 沉寂标记包含距上次推进的章节数
- `Blocked on X` 标记显示上游依赖
- 提升标志（promoted flag）控制 criticality（非提升的沉寂伏笔保持 info 级别）

### 5.5 创作步骤控制

**智能体 Agent 集成层**:

**文件**: `packages/core/src/agent/agent-session.ts`

基于 `pi-agent-core` 框架，提供：
- 13 个工具（write_draft, plan_chapter, compose_chapter, audit_chapter, revise_chapter 等）
- 基于会话的缓存（TTL 5 分钟）
- 顺序队列避免竞态
- SSE 事件流支持

**Agent 工具清单**:

| 工具 | 描述 | 限制 |
|------|------|------|
| `write_draft` | 写下一章草稿 | 只能续写最新章之后 |
| `plan_chapter` | 生成 chapter intent | — |
| `compose_chapter` | 生成运行时上下文 | — |
| `audit_chapter` | 审计指定章节 | — |
| `revise_chapter` | 修订章节 | 5 种模式 |
| `scan_market` | 市场趋势扫描 | — |
| `create_book` | 创建新书 | — |
| `write_full_pipeline` | 完整管线：写→审→改 | — |
| `import_style` | 从参考文本生成文风 | — |
| `import_chapters` | 整书重导 | 只能整书导入 |
| `write_truth_file` | 覆盖真相文件 | 不能改章节进度 |

---

## 6. 审计逻辑（37 维度连续性审计）

### 6.1 审计全景

**文件**: `packages/core/src/agents/continuity.ts`

这是 Inkos 最强大的质量保障机制——**37 个独立维度的章节质量审计**。

### 6.2 审计维度清单

| 编号 | 维度 | 说明 | 严重级别 |
|------|------|------|----------|
| 1 | OOC 检查 | 角色行为是否偏离已建立的性格 | critical |
| 2 | 时间线一致性 | 事件顺序和时间跨度是否合理 | critical |
| 3 | Lore 冲突 | 是否违反已建立的世界观规则 | critical |
| 4 | 力量体系漂移 | 战斗力/等级是否一致 | critical |
| 5 | 数值一致性 | 资源/属性数值是否匹配账本 | critical |
| 6 | 伏笔债务升级 | 沉寂伏笔是否超出健康阈值 | warning/info |
| 7 | 节奏分析 | 是否遵循 build→escalate→climax→aftermath 循环 | warning |
| 8 | 风格一致性 | 与 style_profile 的匹配度 | warning |
| 9 | 情绪单调 | 连续章节情绪曲线是否缺乏起伏 | warning |
| 10 | 词汇疲劳 | "仿佛""不禁""宛如"等标记词密度 | warning |
| 11 | 段落形状异常 | 段落长度分布是否异常 | info |
| 12 | 对话比例 | 对话/叙述比例是否健康 | info |
| 13 | 信息边界 | 角色是否知道不应知道的信息 | critical |
| 14 | 章节目标达成 | Memo goal 是否在正文中实现 | warning |
| 15 | 回报稀释 | 伏笔回收是否满足读者预期 | warning |
| 16 | POV 一致性 | 叙述视角是否稳定 | warning |
| 17 | 情感弧线停滞 | 角色情感是否缺乏进展 | warning |
| 18 | 节奏单调 | 章节类型分布是否均匀 | warning |
| 19 | 标题重复 | 章节标题是否重复模式 | info |
| 20 | 开头同构 | 章节开头句式是否雷同 | info |
| 21 | 结尾同构 | 章节结尾模式是否重复 | info |
| 22 | 情节逻辑 | 因果关系是否自洽 | critical |
| 23 | 对话人设 | 角色说话方式是否一致 | warning |
| 24 | 场景连续性 | 场景转换是否合理 | warning |
| 25 | 角色弧线平线 | 角色成长是否停滞 | warning |
| 26 | 伏笔回收时效 | 伏笔是否在合理窗口内回收 | warning |
| 27 | 信息密度 | 章节是否信息过载或过少 | info |
| 28 | 情绪强度曲线 | 高潮/低谷分布是否合理 | warning |
| 29 | 动作场景质量 | 战斗/动作描写是否生动 | warning |
| 30 | 环境描写 | 场景感是否充足 | info |
| 31 | 节奏标记词 | "突然""就在这时"等滥用 | info |
| 32 | 章节 Memo 漂移 | 正文是否偏离规划 | warning |
| 33 | 字数合规 | 是否在目标字数范围内 | warning |
| 34-35 | 番外角色保真度 | 番外模式：角色是否符合正传 | critical |
| 36 | 番外世界规则合规 | 番外模式：世界规则是否一致 | critical |
| 37 | 番外信息边界 | 番外模式：角色知识边界 | critical |

### 6.3 审计评分体系

```
总分 0-100
通过线: ≥85 分
严重违规阻塞: 任一 critical 未解决 → 直接不通过

加权规则:
  critical: 每项 -15 分
  warning:  每项 -5 分
  info:     每项 -1 分
```

### 6.4 审计循环

```
章节正文 → 37 维度审计 → 评分
    ↓
passed (≥85) → ready-for-review
    ↓
failed (<85) → 进入修订循环
    ↓
Reviser 修订 → 重新审计 → 评分
    ↓
达到通过线 → ready-for-review
    ↓
无净提升 → 取最佳快照 → 标记审计失败
```

### 6.5 番外模式审计

当书设置为番外模式（`fanficMode`）时，审计器额外启用：
- **维度 34**: 角色保真度（与 `parent_canon.md` 对比）
- **维度 35**: 正传事件一致性
- **维度 36**: 世界规则合规
- **维度 37**: 信息边界（角色不应知道正传后面的事件）

### 6.6 AI 痕迹检测

**文件**: `packages/core/src/agents/ai-tells.ts`

- **确定性检测**（零 LLM）：Marker 词、句式模式、元叙述
- **外部 API 检测**：通过 `detector.ts` 调用 GPTZero/Originality 等

---

## 7. 前后端优势分析

### 7.1 三端统一架构

Inkos 提供三种用户界面，共享同一核心引擎：

```
                    ┌──────────────────────────┐
                    │   @actalk/inkos-core      │
                    │   (核心引擎 + 交互层)      │
                    └──────┬──────────┬─────────┘
                           │          │
              ┌────────────┘          └────────────┐
              ▼                                     ▼
    ┌──────────────────┐                 ┌──────────────────┐
    │ @actalk/inkos     │                 │ @actalk/inkos-   │
    │ (CLI + TUI)       │                 │ studio (Web UI)  │
    │ Commander + Ink   │                 │ React + Hono     │
    │ 25+ 子命令         │                 │ Zustand + SSE    │
    └──────────────────┘                 └──────────────────┘
```

### 7.2 后端优势（@actalk/inkos-core）

| 优势 | 说明 |
|------|------|
| **纯净业务逻辑** | 零框架依赖，纯 TypeScript 类型系统 |
| **Zod 全链路校验** | 所有输入输出通过 Zod Schema 运行时校验 |
| **LLM 提供商抽象** | 28+ 提供商统一接口，可热切换 |
| **确定性 + LLM 混合** | 纯规则校验零 LLM 成本，创意任务才调用 LLM |
| **状态快照与回滚** | 每章自动快照，支持安全重写 |
| **事件驱动通知** | Webhook/Telegram/企微/飞书多渠道通知 |
| **守护进程模式** | 定时调度 + 质量门控 + 自动暂停 |
| **伏笔生命周期管理** | 27 个 hook 相关工具文件，完整的钩子治理 |
| **多语言原生支持** | 所有 prompt 模板 zh/en 双语言 |
| **内存数据库** | SQLite 记忆索引，快速检索伏笔/摘要/事实 |

### 7.3 CLI 优势（@actalk/inkos）

| 优势 | 说明 |
|------|------|
| **25+ 子命令** | 覆盖所有操作场景 |
| **Ink React 终端 UI** | 现代化终端渲染（仪表盘、聊天、进度条） |
| **TUI 模式** | 全终端交互界面，支持斜杠命令、自动补全 |
| **自动化模式切换** | auto / semi / manual 三种模式 |
| **零配置启动** | `inkos init` 一键初始化 |
| **管道友好** | 支持 `--json` 输出，可嵌入自动化流程 |
| **守护进程** | `inkos daemon` 后台持续写作 |

**CLI 命令清单**:
```
init     项目初始化
config   配置管理
book     书籍管理（创建/列表/状态）
write    写作（next/rewrite/chapter）
review   审核章节
status   项目状态
radar    市场扫描
audit    审计章节（37 维度）
revise   修订章节
plan     生成章节规划
compose  生成上下文
detect   AI 痕迹检测
style    风格分析
analytics 统计分析
import   导入章节/风格
fanfic   番外管理
export   导出（txt/md/epub）
studio   启动 Web 工作台
tui      启动终端 UI
interact 自然语言交互
doctor   系统诊断
daemon   守护进程
```

### 7.4 Web 前端优势（@actalk/inkos-studio）

| 优势 | 说明 |
|------|------|
| **React 19 + Vite 6** | 最新前端技术栈，极速 HMR |
| **Hono 后端** | 轻量级 TypeScript Web 框架，与前端共享类型 |
| **shadcn/ui 组件库** | 高质量可访问组件，暗色/亮色主题 |
| **SSE 实时流** | 服务器发送事件，AI 写作过程实时可见 |
| **Zustand 状态管理** | 轻量、类型安全的全局状态 |
| **StreamDown 渲染** | 支持 Mermaid 图表、LaTeX 数学、代码高亮 |
| **响应式布局** | 侧边栏 + 主内容区 + 快捷工具栏 |
| **i18n 支持** | 中文/英文界面切换 |

**Studio 路由**:
```
/             仪表盘（项目概览）
/chat         对话写作界面
/book/:id     书籍详情
/chapter/:id  章节编辑
/analytics    统计分析
/services     服务配置
/truth-files  真相文件管理
/daemon       守护进程管理
/logs         运行日志
/genres       题材库
/style        风格分析
/import       导入
/radar        市场雷达
/doctor       系统诊断
```

### 7.5 跨端共享层

**交互运行时 (Interaction Runtime)**:

**文件**: `packages/core/src/interaction/runtime.ts`

所有三端共享同一交互逻辑：
1. 用户输入 → `processProjectInteractionInput()`（CLI/Studio/TUI 均调用此入口）
2. NL 路由 → `routeNaturalLanguageIntent()` 解析意图
3. 请求路由 → `runInteractionRequest()` 执行
4. 结果返回 → 各端按自身方式渲染

**会话管理**:
- 项目级会话（`project-session-store.ts`）
- 书籍级会话（`book-session-store.ts`）
- 会话抄本（`session-transcript.ts`）
- 跨端一致性：同一会话可从 Studio 切换到 CLI 继续

---

## 8. 前端与后端联系方式

### 8.1 Studio 前后端通信架构

```
┌──────────────────────┐         HTTP/SSE          ┌──────────────────┐
│   React Frontend      │ ◄─────────────────────►  │   Hono Backend   │
│   (Vite :4567)        │     REST + SSE Stream     │   (:4569)        │
│                       │                           │                  │
│   Zustand Store        │                           │   PipelineRunner │
│   Chat Store           │                           │   Agent Session  │
│   Service Store        │                           │   State Manager  │
└──────────────────────┘                           └──────────────────┘
```

### 8.2 API 契约

**文件**: `packages/studio/src/shared/contracts.ts`

前后端通过显式 TypeScript 接口契约通信，消除类型漂移：

```typescript
// 前后端共享的类型定义
interface BookSummary {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly platform: string;
  readonly genre: string;
  readonly chapters: number;
  readonly totalWords: number;
  readonly approvedChapters: number;
  readonly pendingReview: number;
  readonly failedReview: number;
}

interface RunActionPayload {
  readonly chapterNumber?: number;
}

interface RunStreamEvent {
  readonly type: "snapshot" | "status" | "stage" | "log";
  readonly runId: string;
  readonly run?: StudioRun;
  readonly status?: RunStatus;
  readonly stage?: string;
}
```

### 8.3 通信模式详解

#### 模式 1: REST API（请求-响应）

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/books` | GET | 书籍列表 |
| `/api/books/:id` | GET | 书籍详情 |
| `/api/books/:id/chapters` | GET | 章节列表 |
| `/api/books/:id/chapters/:num` | GET/PUT | 章节详情/保存 |
| `/api/books/:id/truth-files` | GET | 真相文件列表 |
| `/api/books/:id/truth-files/:name` | GET/PUT | 真相文件详情/保存 |
| `/api/sessions` | GET/POST | 会话列表/创建 |
| `/api/sessions/:id/messages` | GET | 会话消息 |
| `/api/services` | GET | 服务列表 |
| `/api/models/probe` | POST | 探测模型 |
| `/api/analytics` | GET | 统计分析 |

#### 模式 2: SSE (Server-Sent Events) — 实时流

**核心**: AI 写作过程的实时可视化

```
客户端 → POST /api/books/:id/run  → 服务端开始管线
服务端 → SSE 事件流 ← 实时推送管线状态

事件类型:
  snapshot:  当前运行快照
  status:    状态变更（queued/running/succeeded/failed）
  stage:     阶段变更（准备章节输入/撰写草稿/审计等）
  log:       日志条目（timestamp, level, message）
```

**前端 SSE 处理**:
```typescript
// 通过 EventSource 接收实时事件
const eventSource = new EventSource(url);
eventSource.addEventListener('stage', (event) => {
  updatePipelineStage(JSON.parse(event.data).stage);
});
```

#### 模式 3: Agent Session Streaming

**文件**: `packages/core/src/agent/agent-session.ts`

基于 `pi-agent-core` 的智能体会话流：

```
客户端 → POST /api/chat → 服务端
服务端 → SSE (text/event-stream) → 实时推送智能体响应

事件类型:
  agent:    智能体消息
  tool:     工具调用（名称、参数、结果）
  thinking: 思考过程
  error:    错误信息
```

**前端渲染**:
```typescript
// MessagePart 按时间序渲染
type MessagePart =
  | { type: "thinking"; content: string; streaming: boolean }
  | { type: "text"; content: string }
  | { type: "tool"; execution: ToolExecution };
```

#### 模式 4: CLI ↔ Core 直连

CLI 不经过 HTTP，直接调用 Core 的 Node.js API：

```typescript
// 伪代码
import { PipelineRunner, StateManager } from '@actalk/inkos-core';

const pipeline = new PipelineRunner(config);
const result = await pipeline.writeNextChapter(bookId);
```

#### 模式 5: TUI ↔ Core 直连

CLI 的 TUI 模式通过 Ink React 组件直接调用 Core API：

```typescript
// TUI 仪表盘 → 直接调用
const status = await pipeline.getBookStatus(bookId);
// 渲染到 Ink 组件
<Dashboard book={status} />
```

### 8.4 共享会话状态

**关键设计**: 所有端的会话可互换

```typescript
// 项目级会话文件
.interact/sessions/global.json

// 书籍级会话
.interact/sessions/<bookId>/<sessionId>.json

// 会话抄本（时间序事件流）
.interact/transcripts/<sessionId>/00001.json
```

用户可在 Studio 中开始对话 → 保存 → 在 CLI 中继续（`inkos interact --session <id>`）。

### 8.5 流式进度显示

每个长时间运行的操作（写作、审计、修订）都有**阶段标签**和**进度信息**：

```typescript
interface PipelineStage {
  label: string;       // 如 "撰写章节草稿"
  status: "pending" | "active" | "completed";
  progress?: {
    status?: "thinking" | "streaming";
    elapsedMs: number;
    totalChars: number;
    chineseChars: number;
  };
}
```

Studio 渲染进度条，CLI 打印阶段标签，TUI 显示仪表盘。

---

## 9. 可扩展边界

### 9.1 题材扩展

**文件**: `packages/core/genres/`

当前支持 15+ 题材，每题材一个 Markdown profile 文件：

```
cozy.md, cultivation.md, dungeon-core.md, horror.md,
isekai.md, litrpg.md, other.md, progression.md,
romantasy.md, sci-fi.md, system-apocalypse.md,
tower-climber.md, urban.md, xianxia.md, xuanhuan.md
```

**扩展方式**: 新增 `genres/<新题材>.md`，格式为：

```yaml
---
name: "题材名称"
language: "zh"
platforms: ["tomato", "qidian"]
styleGuide: "..."
tropes: ["套路1", "套路2"]
prohibitions: ["禁止元素1"]
---
```

系统自动加载并解析为 `GenreProfile`。

### 9.2 LLM 提供商扩展

**文件**: `packages/core/src/llm/providers/`

当前支持 28+ 提供商。**扩展方式**:

1. 在 `providers/` 下新建 `<name>.ts`
2. 定义 `InkosModel` 的 `maxOutput`、`thinking` 能力等
3. 在 `providers/index.ts` 的 `ALL_PROVIDERS` 注册

**架构**:

```typescript
// 提供商定义模板
export const NEW_PROVIDER_MODELS: InkosModel[] = [
  {
    id: "model-name",
    provider: "new-provider",
    maxOutput: 8192,
    // ...
  },
];
```

### 9.3 风格克隆扩展

**文件**: `packages/core/src/agents/style-analyzer.ts`

当前支持从参考文本提取统计风格指标。**扩展方向**:
- 多文本对比分析
- 作家风格模型（fine-tune 轻量分类器）
- 对话风格单独分析

### 9.4 审计维度扩展

37 维审计可轻松扩展：

```typescript
// 在 continuity.ts 中添加新维度
const auditDimensions = [
  // ... 现有维度
  { id: 38, name: "新维度", check: async (content) => ({...}) },
];
```

建议扩展维度：
- **38. 文化敏感性** — 检测特定文化元素使用是否恰当
- **39. 性别平等** — 检测角色性别描写是否平衡
- **40. 用户偏好学习** — 根据用户历史偏好动态调整

### 9.5 发布平台扩展

**文件**: `packages/core/src/models/book.ts`

当前支持 `PlatformSchema = z.enum(["tomato", "feilu", "qidian", "other"])`

**扩展方式**: 在 `normalizePlatformId` 中添加新平台映射，平台特定规则可在题材 profile 中定义。

### 9.6 构建步骤/命令扩展

CLI 使用 Commander.js，扩展命令：

```typescript
// 在 commands/ 下新建文件
// 在 program.ts 中注册
program
  .command('new-command')
  .description('新命令')
  .action(async () => { ... });
```

### 9.7 通知渠道扩展

**文件**: `packages/core/src/notify/`

当前支持 Telegram、企业微信、飞书、Webhook。

**扩展方式**: 实现 `NotifyChannel` 接口，在 `dispatcher.ts` 注册：

```typescript
export type NotifyChannel =
  | { type: "telegram"; ... }
  | { type: "wechat-work"; ... }
  | { type: "feishu"; ... }
  | { type: "webhook"; ... }
  | { type: "dingtalk"; ... };  // 新增
```

### 9.8 修订模式扩展

**文件**: `packages/core/src/agents/reviser.ts`

当前 6 种模式，可新增：

```typescript
export type ReviseMode =
  | "auto" | "polish" | "rewrite"
  | "rework" | "anti-detect" | "spot-fix"
  | "translate";  // 新增：翻译模式
```

### 9.9 书籍存储后端扩展

当前使用文件系统存储。**可扩展为**:
- Git 后端（版本控制天然支持）
- SQLite/PostgreSQL 后端
- S3 兼容对象存储
- IPFS 去中心化存储

**扩展点**: `StateManager` 类抽象了所有文件操作，可实现替代 `StorageBackend` 接口。

### 9.10 外部工具集成

- **Cover 生成**: 已支持 kkaiapi/OpenAI/Google 封面生成
- **Web 搜索**: 内置 Tavily/OpenAI 搜索集成
- **TTS/语音**: 预留模型分类钩子（`NON_TEXT_MODEL_ID_PARTS`）
- **翻译管道**: 可接入翻译服务

### 9.11 Studio 前端组件扩展

基于 shadcn/ui 组件体系：
```typescript
// 新增页面
<Route path="/new-feature" element={<NewFeature />} />

// 新增 store
const useNewStore = create<NewStore>()((...a) => ({
  ...initialState,
  ...createActions(...a),
}));
```

---

## 10. 总结与生态展望

### 10.1 项目独特价值

| 特性 | Inkos | 同类工具对比 |
|------|-------|-------------|
| 多智能体管线 | 7 阶段专用 Agent | 多数为单提示词 |
| 连续性审计 | 37 维度 | 通常 0-5 维度 |
| 治理式写作 | L1-L4 规则栈 + 覆写边缘 | 无此概念 |
| 伏笔管理 | 全生命周期（27 个工具文件） | 无 |
| 风格克隆 | 统计+LLM 混合 | 仅有 LLM 模仿 |
| 反 AI 检测 | 确定性规则 + 外部 API | 仅有外部 API |
| 状态快照与回滚 | 每章自动备份 | 无 |
| 修订模式 | 6 种模式 | 通常 1-2 种 |
| 提供商支持 | 28+ | 通常 1-3 个 |
| 多语言 | 原生 zh/en | 通常仅英文 |
| 三端界面 | CLI + TUI + Web | 通常仅 Web |

### 10.2 技术债务与改进方向

| 领域 | 当前状态 | 建议改进 |
|------|---------|---------|
| 测试覆盖 | 大量测试，但多为集成测试 | 增加单元测试，提升隔离性 |
| 文档 | 英文 README + 中文项目分析 | 完善 API 文档和架构决策记录 |
| 错误处理 | Zod 校验 + try/catch | 统一错误码体系 |
| 性能 | 串行管线 | 部分阶段可并行（如多章并发审计） |
| 类型安全 | 优秀（Zod + TypeScript strict） | 继续维持 |
| 缓存 | Agent 会话缓存，LLM 客户端池 | 增加响应缓存层 |

### 10.3 生态建设建议

```
短期（1-3 月）:
  ├── 完善 CLI 帮助文档和示例
  ├── 发布 npm 包（@actalk/inkos）
  ├── 模板市场（预设题材+风格组合）
  └── Studio 独立部署支持

中期（3-6 月）:
  ├── 插件系统（自定义 Agent/审计维度/修订模式）
  ├── 协作写作（多人同书）
  ├── Git 原生集成
  └── 导出格式丰富（PDF, mobi, azw3）

长期（6-12 月）:
  ├── 云端版本（SaaS 多租户）
  ├── 社区市场（用户分享题材/风格/模板）
  ├── RLHF 反馈学习
  └── 多语言扩展（日/韩/西/法）
```

### 10.4 核心竞争力总结

**Inkos 不仅仅是一个写作工具，而是一个完整的「AI 作家工作坊」**——它解决的不仅是"让 AI 写文字"，而是：

1. **怎么写长** — 通过状态管理和伏笔生命周期，支撑千章级长篇
2. **怎么写好** — 通过 37 维审计和 6 种修订模式，持续提升质量
3. **怎么写像人** — 通过反 AI 方法论、风格克隆、确定性校验，消除 AI 痕迹
4. **怎么写对** — 通过治理式写作和规则栈，确保设定一致性
5. **怎么持续写** — 通过调度器、质量门控、自动暂停/恢复，实现无人值守写作

---

> **报告生成时间**: 2026-06-02  
> **分析范围**: Inkos v1.4.1 (Monorepo: core + cli + studio)  
> **分析方法**: 全源码静态分析 + 结构推演  
> **报告作者**: GitHub Copilot (DeepSeek V4 Flash)
