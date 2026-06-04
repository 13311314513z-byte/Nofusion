# NoFusion 继续开发报告 KM

> 基于 InkOS 项目深度分析，结合架构报告、扩展性报告与源码调研，提炼当前功能下**成本最低、收益最高**的继续开发方向。  
> 报告日期：2026-06-02  
> 适用对象：NoFusion 团队 / InkOS 二次开发者

---

## 目录

1. [开发原则与低成本标准](#一开发原则与低成本标准)
2. [配置与规则层扩展](#二配置与规则层扩展)
3. [数据与状态层扩展](#三数据与状态层扩展)
4. [Agent 与工具层扩展](#四agent-与工具层扩展)
5. [通信与通知层扩展](#五通信与通知层扩展)
6. [内容生产层扩展](#六内容生产层扩展)
7. [交互层扩展](#七交互层扩展)
8. [前端展示层扩展](#八前端展示层扩展)
9. [开发路线图与优先级](#九开发路线图与优先级)

---

## 一、开发原则与低成本标准

### 1.1 低成本判定标准

| 标准 | 说明 |
|------|------|
| **不改 Pipeline 核心** | 不触及 `PipelineRunner` 的 7 阶段调度逻辑 |
| **利用已有接口** | 复用 `RadarSource`、`BaseAgent`、`Zod Schema` 等成熟抽象 |
| **配置/文件驱动** | 通过 `inkos.json`、`.md` 文件、环境变量实现，非代码驱动 |
| **向后兼容** | 利用 Zod 的 `.default()` / `.optional()` 保证旧数据不报错 |
| **利用架构后门** | 善用系统预留的 `LooseOp` 字段和 `z.unknown()` 消息负载 |

### 1.2 核心洞察

InkOS 的架构设计已预埋多处**"零代码侵入"**扩展点：

- **`LooseOp` 松散操作字段**：`subplotOps` / `emotionalArcOps` / `characterMatrixOps` 已穿过 reducer 却未被消费，可作为自定义结构化数据的传输通道。
- **`message: z.unknown()`**：会话消息负载极度宽松，可注入任意自定义字段而不改 schema。
- **`ensureColumn()`**：SQLite 迁移已内置列存在性检查，加表加列零风险。
- **三级 Genre Profile 查找**：项目级 `genres/` 目录自动覆盖内置规则，新增题材只需新建 `.md` 文件。

---

## 二、配置与规则层扩展

### 2.1 Genre Profile（题材规则）— 成本：极低 ⭐

**当前状态**：
- 内置 15 个题材（`cozy`, `cultivation`, `horror`, `isekai`, `xianxia`, `xuanhuan` 等）
- 三级查找：项目级 `genres/{id}.md` → 内置 `packages/core/genres/{id}.md` → `other.md` 兜底
- CLI 支持 `inkos genre list/show/create/copy` 管理

**低成本扩展方向**：

| 方向 | 操作 | 预期收益 |
|------|------|---------|
| **新增题材** | 复制 `other.md` → 改名 → 修改 YAML frontmatter + Markdown 规则 | 立刻支持新题材创作 |
| **题材微调** | `inkos genre copy <id>` → 编辑项目级副本 | 针对具体书籍定制规则 |
| **团队题材库** | 在 `readGenreProfile()` 中增加 `genresDir` 配置（读取 `inkos.json`） | 团队/公司级共享题材库 |
| **多语言题材** | 新增 `language` 字段到 frontmatter，按书籍语言过滤 | 支持英文/日文等跨语言创作 |

**实施示例**（新增 `wuxia` 题材）：
```markdown
---
name: "武侠"
id: wuxia
language: zh
chapterTypes: ["决斗", "修炼", "江湖恩怨", "探秘"]
fatigueWords: ["突然", "猛然", "竟然"]
numericalSystem: false
powerScaling: true
---
# 武侠题材特定规则
- 招式名称必须首次出现时附简短描述
- 内力体系严禁数值化，用"三成内力""十成功力"等模糊表述
- 暗器出场必须有回收或后果交代
```

---

### 2.2 Project Config 子模块 — 成本：极低 ⭐

**当前状态**：
- `ProjectConfig` 已模块化：`llm`、`notify`、`detection`、`foundation`、`writing`、`daemon`
- 每个子模块独立 Zod Schema，自带 `.default()` / `.optional()`

**低成本扩展方向**：

#### A. 扩展 `qualityGates`（质量门控）

当前仅 3 个字段，大量阈值硬编码在 Agent prompt 中：
```typescript
QualityGatesSchema = z.object({
  maxAuditRetries: z.number().int().default(2),
  pauseAfterConsecutiveFailures: z.number().int().default(3),
  retryTemperatureStep: z.number().min(0).max(0.5).default(0.1),
  // 可新增：
  maxHookCount: z.number().int().default(12),        // 伏笔上限
  minParagraphLength: z.number().int().default(35),  // 最短段落
  enableAutoRewrite: z.boolean().default(false),     // 自动重写开关
  maxTurnMarkerPerChapter: z.number().int().default(1), // 转折标记词上限
})
```

**收益**：将散落在代码中的硬编码阈值集中到配置，实现**用户自定义治理策略**。

#### B. 新增 `export` 配置模块

```typescript
ExportConfigSchema = z.object({
  formats: z.array(z.enum(["md", "txt", "epub", "html"])).default(["md"]),
  includeDrafts: z.boolean().default(false),
  includeAuditReport: z.boolean().default(false),
  customCss: z.string().optional(),  // HTML/PDF 导出时的自定义样式
}).optional()
```

**收益**：统一控制书籍导出行为，避免每次导出都传参数。

#### C. 新增 `analytics` 配置模块

```typescript
AnalyticsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  trackTokenUsage: z.boolean().default(true),
  exportFormat: z.enum(["csv", "json"]).default("json"),
}).optional()
```

**收益**：为后续 token 消耗统计、写作效率分析提供配置开关。

---

### 2.3 Book Config 扩展 — 成本：极低 ⭐

**当前状态**：`BookConfigSchema` 已支持 `targetChapters`、`chapterWordCount`、`fanficMode` 等字段。

**低成本扩展方向**：

| 新增字段 | 类型 | 用途 |
|---------|------|------|
| `volumeCount` | `number?` | 预计总卷数，供 Planner 做卷纲规划 |
| `currentVolume` | `number?` | 当前卷号，影响章节编号和上下文 |
| `keywords` | `string[]` | 书籍关键词，注入 SEO / 雷达分析 |
| `serializationStatus` | `enum` | `draft`/`serializing`/`completed`，影响 Scheduler 行为 |
| `rating` | `number?` | 用户自评，用于书籍排序 |
| `isSeries` | `boolean` | 是否系列作，影响 `parentBookId` 的展示逻辑 |
| `targetAudience` | `string?` | 目标读者群，影响文风强度和用词选择 |

**收益**：这些元数据可被 `architect.ts`（初始化）、`planner.ts`（规划）、`writer.ts`（写作）直接读取，影响生成内容，而代码改动极小（仅需修改 `book.ts` + 在 agent prompt 中引用）。

---

## 三、数据与状态层扩展

### 3.1 ChapterMeta 自定义字段 — 成本：极低 ⭐⭐⭐

**当前状态**：`ChapterMetaSchema` 已有 13 个字段，使用 Zod + `.default()` / `.optional()` 保证兼容性。

**低成本扩展方向**：

| 新增字段 | 类型 | 用途 |
|---------|------|------|
| `tags` | `string[]` | 章节标签（`战斗`/`对话`/`转折`/`日常`），供过滤和统计 |
| `povCharacter` | `string?` | 视角角色，防止 POV 混乱 |
| `location` | `string?` | 主要场景，用于地理连续性检查 |
| `moodScore` | `number?` | 情绪评分（-10 ~ +10），用于情感弧线可视化 |
| `revisionCount` | `number` | 修订次数，识别"问题章节" |
| `timeOfDay` | `string?` | 时间标记（`清晨`/`正午`/`深夜`），辅助时间线审计 |
| `chapterType` | `string?` | 章节类型（由 Genre Profile 定义） |
| `wordCountTarget` | `number?` | 本章特定字数目标（覆盖书籍默认值） |

**实施步骤**：
1. 在 `packages/core/src/models/chapter.ts` 的 `ChapterMetaSchema` 中添加字段定义
2. 在 `planner.ts` / `writer.ts` 的 prompt 中注入相关字段
3. 在 Studio 的章节列表/详情页展示新字段

**收益**：章节管理从"纯文本列表"升级为"结构化数据库"，支持按标签/视角/场景过滤，大幅提升长文本导航效率。

---

### 3.2 MemoryDB 新表与索引 — 成本：低 ⭐⭐

**当前状态**：3 张表（`facts`, `chapter_summaries`, `hooks`），`migrate()` 使用 `IF NOT EXISTS` 实现幂等扩展，`ensureColumn()` 支持零风险列迁移。

**低成本扩展方向**：

| 扩展 | SQL 操作 | 用途 |
|------|---------|------|
| **characters 表** | `CREATE TABLE characters (...)` | 角色出场追踪、关系演变查询 |
| **locations 表** | `CREATE TABLE locations (...)` | 场景地理追踪、防止瞬移 bug |
| **facts.confidence 列** | `ALTER TABLE facts ADD COLUMN confidence` | 事实可信度评分，低可信度事实可被审计标记 |
| **facts.emotion 列** | `ALTER TABLE facts ADD COLUMN emotion` | 情感事实分类，支持情感弧线分析 |
| **idx_hooks_payoff** | `CREATE INDEX idx_hooks_payoff ON hooks(expected_payoff)` | 加速"即将到期伏笔"查询 |

**关键原则**：SQLite 是加速索引层，非主存储。新表数据若需跨回滚持久化，必须同时存入 `story/` 下的 markdown/JSON。

---

### 3.3 新增 Markdown 真相文件 — 成本：极低 ⭐

**当前状态**：`story/` 下已有 14+ 个 markdown 文件，纯内容扩展零代码侵入。

**低成本扩展方向**：

| 新文件 | 用途 | 消费 Agent |
|--------|------|-----------|
| `timeline.md` | 时间线大事记，防止时间悖论 | `continuity.ts` (时间线审计) |
| `world_building.md` | 世界观设定补完（地理/历史/种族） | `architect.ts`, `writer.ts` |
| `magic_system.md` | 魔法/力量体系细则 | `continuity.ts` (战力审计) |
| `relationship_web.md` | 角色关系网（非矩阵形式） | `writer.ts` (对话生成) |
| `reader_feedback.md` | 读者反馈记录 | `planner.ts` (期待管理) |
| `marketing_notes.md` | 平台运营笔记（标题/简介/标签优化） | `radar.ts` (市场分析) |

**实施方式**：新建文件 → 在需要的 agent 中增加 `readFileSafe()` 调用 → 在 prompt 中引用。

---

### 3.4 LooseOp 通道利用 — 成本：低 ⭐⭐

**当前状态**：`RuntimeStateDelta` 中预留了 3 个未被 reducer 消费的字段：
```typescript
subplotOps: z.array(z.record(z.string(), z.unknown())).default([])
emotionalArcOps: z.array(z.record(z.string(), z.unknown())).default([])
characterMatrixOps: z.array(z.record(z.string(), z.unknown())).default([])
```

**低成本扩展方向**：

将这些字段作为**自定义结构化数据的传输通道**：

```typescript
// 在 Observer Agent 中提取自定义数据
const customOps = [{
  type: "character_growth",
  character: "主角",
  trait: "胆识",
  delta: "+1",
  evidence: "正文第 3 段"
}];

// 写入 delta，穿过 reducer 不丢失
delta.characterMatrixOps = customOps;

// 在 Consumer Agent 中自行解析使用
for (const op of delta.characterMatrixOps) {
  if (op.type === "character_growth") { /* 应用 */ }
}
```

**收益**：绕过严格的 reducer 校验，实现 Agent 间的自定义数据流转，无需修改状态机核心。

---

## 四、Agent 与工具层扩展

### 4.1 Agent 工具新增 — 成本：低 ⭐⭐⭐

**当前状态**：11 个硬编码工具（`sub_agent`, `read`, `write`, `edit`, `grep`, `ls`, `generate_cover`, `short_fiction_run`, `write_truth_file`, `rename_entity`, `patch_chapter_text`）。

**低成本扩展方向**：

| 新工具 | 功能 | 实现成本 |
|--------|------|---------|
| **`web_search`** | 网络搜索（接入 SerpAPI / Bing API） | 低：封装 HTTP 请求，返回摘要 |
| **`memory_query`** | 语义检索 MemoryDB / 向量数据库 | 低：SQL 查询 + 重排序 |
| **`calculate`** | 数值计算（防止 LLM 算术幻觉） | 极低：调用 `eval` 或 mathjs |
| **`date_time`** | 获取当前时间 | 极低：返回 `new Date().toISOString()` |
| **`random_draw`** | 随机抽取（决策辅助） | 极低：封装 `Math.random()` |
| **`sentiment_analyze`** | 文本情感分析 | 低：调用开源模型或正则规则 |
| **`count_tokens`** | 统计 token 数 | 低：调用 tiktoken 近似计算 |

**实施步骤**（以 `web_search` 为例）：
1. `agent-tools.ts` 中定义 `WebSearchParams = Type.Object({ query: Type.String() })`
2. 实现 `createWebSearchTool(config)` 工厂函数
3. `agent-session.ts` 的 `createAgentToolsForMode()` 中加入新工具

---

### 4.2 子 Agent 委派扩展 — 成本：中 ⭐⭐

**当前状态**：`sub_agent` 支持 5 个子 Agent（`architect`, `writer`, `auditor`, `reviser`, `exporter`）。

**低成本扩展方向**：

| 新子 Agent | 职责 | 触发场景 |
|-----------|------|---------|
| **`researcher`** | 资料搜集与事实核查 | 写作前验证历史/科技/医学细节 |
| **`plotter`** | 情节设计与冲突编排 | 卷纲细化、支线设计 |
| **`translator`** | 翻译与本地化 | 中英互译、风格保持翻译 |
| **`dialogue_polisher`** | 对话专项润色 | 审计发现对话生硬时定向修复 |
| **`scene_describer`** | 场景描写增强 | 环境/氛围描写薄弱时专项增强 |
| **`pov_consistency_checker`** | 视角一致性检查 | 多视角叙事时的专项检查 |

**实施成本**：每个子 Agent 需修改 `agent-tools.ts`（Union 类型 + switch case）+ `PipelineRunner`（添加原子方法）+ 系统提示更新，约 2-4 小时/个。

---

### 4.3 Model Overrides 精细化 — 成本：极低 ⭐⭐⭐

**当前状态**：`inkos.json` 支持 `modelOverrides`，但 CLI 白名单 `KNOWN_AGENTS` 仅暴露 6 个 Agent。

**低成本扩展方向**：

**立即可做**（无需改代码）：
直接编辑 `inkos.json`，为以下 Agent 配置模型：
```json
{
  "modelOverrides": {
    "planner": { "model": "deepseek-v4", "temperature": 0.5 },
    "composer": { "model": "deepseek-v4", "temperature": 0.3 },
    "observer": { "model": "deepseek-v4", "temperature": 0.5 },
    "settler": { "model": "deepseek-v4", "temperature": 0.3 },
    "foundation-reviewer": { "model": "claude-sonnet-4", "temperature": 0.2 },
    "state-validator": { "model": "deepseek-v4", "temperature": 0.2 },
    "length-normalizer": { "model": "deepseek-v4", "temperature": 0.7 }
  }
}
```

**可优化**（改 CLI 白名单）：
将 `KNOWN_AGENTS` 扩展为动态读取 `runner.ts` 中实际使用的 Agent 列表，让用户可通过 CLI 为所有 Agent 配置模型。

**收益**：
- 让 cheap 模型写初稿（`writer` → 轻量模型）
- 让 strong 模型做审核（`auditor` → 旗舰模型）
- 显著降低 token 成本（可达 40-60%）

---

## 五、通信与通知层扩展

### 5.1 Webhook 通用接口 — 成本：极低 ⭐⭐⭐

**当前状态**：`webhook` 通知渠道已高度完善：
- 支持 7 种事件类型：`chapter-complete`, `audit-passed`, `audit-failed`, `revision-complete`, `pipeline-complete`, `pipeline-error`, `diagnostic-alert`
- 支持事件过滤（`events` 数组）
- 支持 HMAC-SHA256 签名（`X-InkOS-Signature`）

**零代码扩展方向**：

| 对接平台 | 方式 | 用途 |
|---------|------|------|
| **n8n** | Webhook URL + 签名验证 | 自动化工作流（收到完成通知 → 推送到钉钉/飞书/邮件） |
| **Zapier** | Webhook URL | 连接 5000+ 应用 |
| **Make (Integromat)** | Webhook URL | 可视化自动化 |
| **自建服务** | 接收签名验证后的 POST 请求 | 自定义分析、监控大盘 |

**配置示例**：
```json
{
  "notify": [{
    "type": "webhook",
    "url": "https://n8n.example.com/webhook/inkos",
    "secret": "your-secret",
    "events": ["chapter-complete", "audit-failed"]
  }]
}
```

---

### 5.2 新通知渠道 — 成本：低 ⭐⭐

**当前状态**：4 个硬编码渠道（`telegram`, `wechat-work`, `feishu`, `webhook`）。

**低成本扩展方向**：

| 新渠道 | 实现方式 | 工作量 |
|--------|---------|--------|
| **Discord** | `notify/discord.ts`：封装 Discord Webhook API | ~20 行 |
| **Slack** | `notify/slack.ts`：封装 Slack Incoming Webhook | ~20 行 |
| **钉钉** | `notify/dingtalk.ts`：封装钉钉机器人 API | ~20 行 |
| **企业微信 Bot** | 复用 `wechat-work` 或独立实现 | ~20 行 |
| ** Bark (iOS)** | HTTP 推送通知 | ~15 行 |

**实施步骤**：
1. `project.ts` 的 `NotifyChannelSchema` 增加新 `z.object({ type: z.literal("discord"), ... })`
2. `notify/dispatcher.ts` switch 增加新 case
3. 新建 `notify/discord.ts` 实现发送逻辑

---

### 5.3 SSE 事件扩展 — 成本：低 ⭐⭐

**当前状态**：20+ 种 SSE 事件，前端通过 `STUDIO_SSE_EVENTS` 数组订阅。

**低成本扩展方向**：

| 新事件 | 触发时机 | 前端展示 |
|--------|---------|---------|
| `chapter:tagged` | 章节自动打标签完成 | 标签云更新 |
| `memory:updated` | MemoryDB 批量更新 | 记忆图谱刷新 |
| `style:regression` | 检测到文风退化 | 告警提示 |
| `hook:due` | 伏笔即将到期（剩余 3 章） | 待办提醒 |
| `token:threshold` | token 消耗达到阈值 | 成本告警 |

**实施方式**：在 `server.ts` 的 `broadcast()` 调用处新增事件发射，前端 `use-sse.ts` 增加事件监听。

---

## 六、内容生产层扩展

### 6.1 导出格式扩展 — 成本：低 ⭐⭐

**当前状态**：支持 `txt`、`md`、`epub`。

**低成本扩展方向**：

| 新格式 | 实现库 | 工作量 | 刚需程度 |
|--------|--------|--------|---------|
| **HTML** | 模板字符串 + CSS | 低 | 高（网页发布） |
| **PDF** | `puppeteer` / `playwright` | 中 | 高（投稿/打印） |
| **DOCX** | `docx` (npm) | 低 | 中（Word 编辑） |
| **LaTeX** | 模板字符串 | 低 | 低（学术排版） |
| **JSON (结构化)** | 直接序列化 | 极低 | 中（数据分析） |

**实施步骤**（以 HTML 为例）：
1. `ExportArtifact.format` 类型扩展 `"html"`
2. `buildExportArtifact()` 增加 `if (format === "html")` 分支
3. 生成带目录导航、章节链接、自定义 CSS 的 HTML 字符串
4. CLI `export.ts` 的 `--format` 描述同步更新

---

### 6.2 RadarSource 数据源 — 成本：极低 ⭐⭐⭐

**当前状态**：`RadarSource` 接口极其干净（`name` + `fetch()`），已有 `FanqieRadarSource`、`QidianRadarSource`、`TextRadarSource`。

**低成本扩展方向**：

| 新数据源 | 数据来源 | 实现方式 |
|---------|---------|---------|
| **纵横中文网** | 网页抓取 | `ZonghengRadarSource implements RadarSource` |
| **晋江文学城** | 网页抓取 | `JJWXCRadarSource` |
| **Webnovel** | API / 网页 | `WebnovelRadarSource` |
| **豆瓣阅读** | 网页抓取 | `DoubanRadarSource` |
| **RSS 聚合** | RSS 订阅 | `RssRadarSource`（通用） |
| **自定义 API** | 用户提供的 HTTP 接口 | `ApiRadarSource`（通用） |

**实施示例**：
```typescript
class RssRadarSource implements RadarSource {
  readonly name = "RSS聚合";
  constructor(private url: string) {}
  async fetch(): Promise<PlatformRankings> {
    const feed = await parseRss(this.url);
    return { platform: "rss", rankings: feed.items.map(...) };
  }
}
```

**高价值建议**：在 `inkos.json` 中增加 `radarSources` 配置数组，支持通过配置而非代码注入数据源：
```json
{
  "radarSources": [
    { "type": "rss", "url": "https://example.com/feed.xml" },
    { "type": "api", "url": "https://api.example.com/rankings", "headers": {...} }
  ]
}
```

---

### 6.3 文风锁规则外置 — 成本：低 ⭐⭐

**当前状态**：`RHETORICAL_PATTERNS` 和段落硬尺规则硬编码在 `style-analyzer.ts` / `writer-prompts.ts` 中。

**低成本扩展方向**：

1. **修辞规则配置文件化**：
```json
// {projectRoot}/config/style_patterns.json
{
  "language": "zh",
  "rhetoricalPatterns": [
    { "name": "比喻", "regex": "像|如同|仿佛|宛如|好似" },
    { "name": "排比", "regex": "(?:[^，。]{3,}[,。]){3,}" },
    { "name": "反问", "regex": "(?:难道|岂|怎|何必|何尝)[^?？]*[?？]" }
  ],
  "turnMarkers": ["仿佛", "忽然", "竟然", "猛地", "不禁", "宛如"],
  "turnMarkerLimitPer3000": 1,
  "minParagraphLength": 40,
  "maxConsecutiveShortParagraphs": 2,
  "maxShortParagraphsPerChapter": 5,
  "bannedPatterns": ["不是……而是……", "——"],
  "bannedTerms": ["核心动机", "信息边界", "底层逻辑"]
}
```

2. **按题材加载不同规则**：`genres/{id}.md` 的 frontmatter 中增加 `styleProfile: {...}` 覆盖全局默认值。

**收益**：用户可按题材（西幻需检测"翻译腔"、科幻需检测"科技术语堆砌"）自定义检测规则，无需改代码。

---

## 七、交互层扩展

### 7.1 CLI 新命令 — 成本：极低 ⭐⭐⭐

**当前状态**：29 个命令，使用 Commander.js 显式注册。

**低成本扩展方向**：

| 新命令 | 功能 | 工作量 |
|--------|------|--------|
| **`inkos batch`** | 批量操作（批量导出/批量审计/批量删除草稿） | ~30 分钟 |
| **`inkos backup`** | 备份管理（创建/列出/恢复备份） | ~30 分钟 |
| **`inkos compare`** | 章节对比（diff 两章或两版本） | ~30 分钟 |
| **`inkos stats`** | 统计输出（字数/token/审计分数趋势） | ~30 分钟 |
| **`inkos tag`** | 章节标签管理（批量打标签） | ~20 分钟 |
| **`inkos search`** | 全文搜索（跨章节 grep + 语义搜索） | ~45 分钟 |
| **`inkos timeline`** | 时间线可视化输出 | ~30 分钟 |

**实施模板**：
```typescript
// packages/cli/src/commands/stats.ts
import { Command } from "commander";
export const statsCommand = new Command("stats")
  .description("输出书籍统计信息")
  .option("-b, --book <id>", "指定书籍")
  .action(async (options) => {
    // 读取 chapters/index.json → 计算统计 → 输出表格
  });
```

然后在 `program.ts` 中 `program.addCommand(statsCommand)`。

---

### 7.2 TUI 交互增强 — 成本：中 ⭐⭐

**当前状态**：Ink (React TUI) 驱动，支持对话式创作、slash 命令补全。

**低成本扩展方向**：

| 增强 | 实现方式 |
|------|---------|
| **快捷键** | Ink 的 `useInput` 捕获 `Ctrl+R`（运行）、`Ctrl+S`（保存）等 |
| **主题切换** | 颜色配置外置到 `~/.config/inkos/theme.json` |
| **历史搜索** | `Ctrl+F` 激活搜索框，过滤历史消息 |
| **进度仪表盘** | 顶部固定区域显示当前书籍进度（章节数/字数/审计平均分） |

---

## 八、前端展示层扩展

### 8.1 Studio 新页面 — 成本：中 ⭐⭐

**当前状态**：18 个页面，hash 路由 + 条件渲染。

**低成本扩展方向**（复用现有组件库）：

| 新页面 | 复用组件 | 数据源 | 工作量 |
|--------|---------|--------|--------|
| **章节对比页** | `Dialog`, `Button` | `chapters/*.md` | ~4 小时 |
| **批量操作页** | `Select`, `Checkbox`, `Button` | `chapters/index.json` | ~4 小时 |
| **统计仪表盘** | 图表库（如 `recharts`） | `chapters/index.json` + MemoryDB | ~6 小时 |
| **时间线视图** | 垂直时间线组件 | `chapter_summaries.md` | ~4 小时 |
| **角色管理页** | `Dialog`, `Input`, `Textarea` | `story/roles/` | ~4 小时 |
| **伏笔追踪页** | 表格 + 状态标签 | `pending_hooks.md` + `hooks.json` | ~4 小时 |

**实施步骤**：
1. `pages/NewPage.tsx` → `hooks/use-hash-route.ts` 加路由 → `App.tsx` 加导航 → `Sidebar.tsx` 加入口
2. 后端 `api/server.ts` 加数据接口（如需）

---

### 8.2 前端组件增强 — 成本：低 ⭐⭐

| 增强 | 实现 |
|------|------|
| **章节标签云** | 读取 `ChapterMeta.tags`，用颜色区分类型 |
| **审计分数趋势图** | 折线图展示各章审计分数变化 |
| **字数偏差指示器** | 进度条展示实际字数 vs 目标字数 |
| **伏笔到期提醒** | 侧边栏显示"剩余 3 章内到期的伏笔" |
| **Token 消耗看板** | 统计并展示各章/各 Agent 的 token 消耗 |

---

## 九、开发路线图与优先级

### 9.1 第一梯队：本周可落地（零代码或 1 小时内）

| 序号 | 扩展点 | 动作 | 预期收益 |
|------|--------|------|---------|
| 1 | **Genre Profile** | 新建 `genres/wuxia.md` / `genres/cyberpunk.md` | 支持新题材 |
| 2 | **Model Overrides** | 编辑 `inkos.json`，为 `planner`/`settler` 配轻量模型 | 降低 40% token 成本 |
| 3 | **Webhook 通知** | 配置 n8n/Zapier 接收 `chapter-complete` 事件 | 自动化通知到任意平台 |
| 4 | **新 Markdown 真相文件** | 新建 `timeline.md` / `world_building.md` | 增强叙事一致性 |
| 5 | **CLI 新命令** | 添加 `stats` / `compare` / `backup` 命令 | 提升开发者效率 |

### 9.2 第二梯队：本月可落地（半天到 2 天）

| 序号 | 扩展点 | 动作 | 预期收益 |
|------|--------|------|---------|
| 1 | **ChapterMeta 自定义字段** | 添加 `tags` / `povCharacter` / `location` | 结构化章节管理 |
| 2 | **Book Config 扩展** | 添加 `volumeCount` / `keywords` / `serializationStatus` | 增强书籍元数据 |
| 3 | **Quality Gates 配置化** | 将硬编码阈值提取到 `ProjectConfig` | 用户自定义治理策略 |
| 4 | **文风锁规则外置** | `style_patterns.json` + 按题材加载 | 多题材文风适配 |
| 5 | **Agent 新工具** | 添加 `web_search` / `calculate` / `memory_query` | Agent 能力跃升 |
| 6 | **RadarSource 新数据源** | 实现 `ZonghengRadarSource` / `JJWXCRadarSource` | 扩大市场覆盖 |
| 7 | **导出格式扩展** | 添加 `html` / `docx` 导出 | 满足发布需求 |
| 8 | **MemoryDB 新表** | 添加 `characters` / `locations` 表 | 角色/场景追踪 |

### 9.3 第三梯队：季度规划（1-2 周）

| 序号 | 扩展点 | 动作 | 预期收益 |
|------|--------|------|---------|
| 1 | **子 Agent 扩展** | 添加 `researcher` / `plotter` / `translator` | 专业化分工 |
| 2 | **Studio 新页面** | 统计仪表盘 / 伏笔追踪 / 批量操作 | 可视化能力提升 |
| 3 | **通知渠道扩展** | Discord / Slack / 钉钉原生支持 | 国际化用户覆盖 |
| 4 | **前端组件增强** | 标签云 / 审计趋势图 / Token 看板 | 数据驱动创作 |
| 5 | **LooseOp 通道深度利用** | 自定义角色成长/情感弧线数据传输 | Agent 间深度协作 |

### 9.4 不推荐在本阶段投入的方向

| 方向 | 原因 | 建议时机 |
|------|------|---------|
| **新结构化状态切片** | 需修改 schema → reducer → bootstrap → projection → validator → store → DB → snapshot，全栈改动 | 核心功能稳定后 |
| **工具注册表/插件系统** | 涉及 Agent 初始化路径的缓存失效和类型安全，设计成本高 | 有明确第三方开发者需求时 |
| **前端路由框架化** | 当前 hash 路由够用，迁移到 React Router 收益有限 | 页面数量超过 30 个时 |
| **多实例 SSE 广播** | 需引入 Redis Pub/Sub 或消息队列，部署复杂度上升 | 有明确的多用户 SaaS 需求时 |
| **PostgreSQL 替代 SQLite** | 当前 SQLite WAL 已满足单机需求，迁移成本高 | 需要多机共享数据库时 |

---

## 附录：快速参考表

### A. 零代码扩展清单

| 扩展 | 操作 |
|------|------|
| 新增题材 | `cp packages/core/genres/other.md genres/mynovel.md` → 编辑 |
| 为 Agent 配模型 | 编辑 `inkos.json` 的 `modelOverrides` |
| 接收 Webhook | 配置 `notify` 数组中的 `webhook` 对象 |
| 添加真相文件 | 新建 `story/*.md`，在 agent prompt 中引用 |
| 自定义文风规则 | 编辑 Genre Profile 的 Markdown 正文 |

### B. 单文件修改扩展清单

| 扩展 | 修改文件 |
|------|---------|
| 新 CLI 命令 | `packages/cli/src/commands/{name}.ts` + `program.ts` |
| 新通知渠道 | `packages/core/src/notify/{name}.ts` + `dispatcher.ts` + `project.ts` |
| 新导出格式 | `packages/core/src/interaction/export-artifact.ts` + `cli/src/commands/export.ts` |
| 新 LLM Provider | `packages/core/src/llm/providers/endpoints/{name}.ts` + `index.ts` |
| ChapterMeta 新字段 | `packages/core/src/models/chapter.ts` |
| BookConfig 新字段 | `packages/core/src/models/book.ts` |

### C. 多文件修改扩展清单

| 扩展 | 修改文件 |
|------|---------|
| 新 Agent 工具 | `agent-tools.ts` + `agent-session.ts` |
| 新子 Agent | `agent-tools.ts` + `runner.ts` + 系统提示 |
| 新 Studio 页面 | `pages/*.tsx` + `use-hash-route.ts` + `App.tsx` + `Sidebar.tsx` + `server.ts` |
| MemoryDB 新表 | `memory-db.ts` + 数据消费 agent |

---

*报告完*
