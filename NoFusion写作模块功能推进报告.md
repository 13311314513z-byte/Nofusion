# NoFusion 写作模块功能推进报告

> 报告日期：2026-06-03  
> 基础项目：NoFusion / InkOS 当前工作区  
> 报告目标：围绕章节拆分、角色卡、核心文件维度、AI 写作强化、前端工作流与低成本落地路线，提出写作模块下一阶段的完整功能推进方案。

---

## 一、当前能力判断

NoFusion 当前已经不是单纯的“生成章节”工具，而是一个具备多 Agent 管线、真相文件、章节索引、运行时上下文、审计与修订机制的长篇小说工程化写作系统。

当前已有基础包括：

| 模块 | 已有能力 | 主要问题 |
|---|---|---|
| 章节生成 | `writer` 可续写下一章，`reviser` 可修订指定章节 | 章节计划、拆分、导入后的治理能力还不够可视化 |
| 章节导入 | `splitChapters()` 支持按“第 N 章 / Chapter N”等标题拆分 | 缺少拆分预览、手动调整、批量元数据补全 |
| 角色资料 | 已有 `story/roles/主要角色/`、`story/roles/次要角色/`、`roles/major/`、`roles/minor/` | 角色卡字段缺少结构化模板，导入导出能力弱 |
| 核心文件 | 已支持 `outline/story_frame.md`、`outline/volume_map.md`、角色卡等权威文件手动编辑 | 核心文件维度还偏散，缺少“项目级信息架构” |
| 文风系统 | 已有文风分析、作家档案库、URL/本地导入、预处理 | 和章节写作联动还可以继续加强 |
| 审计与修订 | 有 ContinuityAuditor / Reviser / TruthFiles / Runtime artifacts | 审计历史、失败原因、修订策略可视化不足 |
| 前端 Studio | 已有书籍详情、章节、真相文件、文风、导入等页面 | 写作模块工作流仍分散，缺少统一“写作控制台” |

总体判断：

> 下一阶段不建议重写写作管线，而应把已有能力做成“可配置、可预览、可导入导出、可追踪”的工作台。

---

## 二、写作模块总体目标

建议将写作模块升级为：

> 面向长篇小说的章节生产与设定治理工作台。

核心目标包括：

1. 章节能被稳定拆分、导入、预览、修正、批量补元数据。
2. 角色卡能独立创建、导入、导出、合并、关联章节。
3. 核心文件从零散 Markdown 升级为“可维护的创作档案体系”。
4. AI 写作不只是续写，还能按章节目标、角色声线、伏笔状态、节奏曲线进行受控生成。
5. 前端能让作者看见“为什么这样写、用了哪些设定、哪里有风险”。

---

## 三、章节拆分与导入增强

### 3.1 当前基础

当前已有：

```text
packages/core/src/utils/chapter-splitter.ts
```

支持：

- `第一章 xxx`
- `第1章 xxx`
- `第一回 xxx`
- `Chapter I`
- `Chapter 1`
- 自定义正则拆分

Studio 后端已有：

```text
POST /api/v1/books/:id/import/chapters
```

问题是当前导入更偏“直接执行”，缺少预览和治理层。

### 3.2 建议新增功能

| 功能 | 说明 | 优先级 |
|---|---|---|
| 章节拆分预览 | 导入前展示拆出的章节标题、字数、首段、尾段 | P0 |
| 手动调整边界 | 允许用户合并、拆分、删除某个拆分结果 | P1 |
| 拆分规则模板 | 内置“中文网文章节”“英文 Chapter”“Markdown 标题”“自定义正则” | P0 |
| 异常提示 | 标记过短章节、超长章节、空章节、标题重复 | P0 |
| 批量导入确认 | 用户确认后再写入 `chapters/` 和 `chapters/index.json` | P0 |
| 导入后元数据补全 | 自动填 `chapterType`、`povCharacter`、`location`、`tags` 初始值 | P1 |
| 章节编号修复 | 对缺号、重复编号、文件存在但 index 缺失进行修复 | P1 |

### 3.3 前端调整方向

建议将现有导入工具拆成三步：

```text
粘贴/本地导入文本
  → 拆分预览
  → 确认导入
```

拆分预览表字段：

| 字段 | 说明 |
|---|---|
| 序号 | 目标章节号 |
| 标题 | 可编辑 |
| 字数 | 自动统计 |
| 状态 | 正常 / 过短 / 超长 / 空章节 / 重复 |
| 操作 | 合并到上一章、拆分、删除 |

### 3.4 Core 调整方向

建议新增：

```text
packages/core/src/import/chapter-import-planner.ts
```

核心输出：

```ts
interface ChapterImportPlan {
  chapters: ChapterImportItem[];
  warnings: ChapterImportWarning[];
  suggestedStartNumber: number;
}
```

让导入从“一步写入”变成“两阶段计划”：

1. `planChapterImport(text, options)`
2. `commitChapterImport(bookId, plan)`

这样前端可以安全预览，不会误写文件。

---

## 四、角色卡设置、导入与导出

### 4.1 当前基础

当前项目已有角色卡目录：

```text
story/roles/主要角色/*.md
story/roles/次要角色/*.md
story/roles/major/*.md
story/roles/minor/*.md
```

Studio 的 TruthFiles 已能手动编辑这些文件。

当前问题：

1. 角色卡没有统一模板。
2. 角色卡缺少结构化字段。
3. 无法批量导入角色资料。
4. 无法从旧 `character_matrix.md` 自动拆成一人一卡。
5. 无法导出角色卡供其他项目复用。

### 4.2 推荐角色卡模板

建议将角色卡统一为 Markdown + YAML frontmatter：

```md
---
id: cheng-shiyi
name: 程时一
roleTier: major
aliases:
  - 小程子
status: active
povEligible: true
firstAppearanceChapter: 1
lastSeenChapter: 3
voiceProfileId: cheng-shiyi
tags:
  - 药房
  - 少年
---

# 程时一

## 核心身份

## 外貌与行动特征

## 欲望与恐惧

## 人际关系

## 声线特征

## 已知秘密

## 禁止写法

## 章节轨迹
```

### 4.3 角色卡新增功能

| 功能 | 说明 | 优先级 |
|---|---|---|
| 新建角色卡 | 前端表单生成标准模板 | P0 |
| 角色卡列表页 | 按主要/次要、状态、标签、POV 可用筛选 | P0 |
| 角色卡导入 | 支持 Markdown、JSON、CSV、粘贴文本 | P1 |
| 旧矩阵拆卡 | 从 `character_matrix.md` 自动拆为 roles 目录 | P1 |
| 角色卡导出 | 单卡导出、全部角色打包导出 JSON/MD | P1 |
| 角色关系字段 | 支持 allies、rivals、family、mentor 等关系 | P1 |
| 角色声线档案 | 提取对话习惯、常用词、句长、语气 | P1 |
| 角色出场热力 | 按章节统计角色出现频率 | P2 |

### 4.4 API 建议

```text
GET  /api/v1/books/:id/roles
POST /api/v1/books/:id/roles
GET  /api/v1/books/:id/roles/:roleId
PUT  /api/v1/books/:id/roles/:roleId
DELETE /api/v1/books/:id/roles/:roleId
POST /api/v1/books/:id/roles/import
GET  /api/v1/books/:id/roles/export
POST /api/v1/books/:id/roles/split-matrix
```

初期不必新建复杂数据库，仍然落盘到 `story/roles/`。

---

## 五、核心文件维度增改

### 5.1 当前核心文件结构

当前项目已有：

```text
story/outline/story_frame.md
story/outline/volume_map.md
story/roles/**
story/current_focus.md
story/author_intent.md
story/pending_hooks.md
story/subplot_board.md
story/emotional_arcs.md
story/style_guide.md
story/style_profile.json
story/state/current_state.json
story/state/hooks.json
story/state/chapter_summaries.json
```

建议不推翻现有文件结构，而是补齐维度。

### 5.2 建议新增或规范化的核心文件

| 文件 | 作用 | 优先级 |
|---|---|---|
| `story/world/world_rules.md` | 世界规则、历史、制度、地理、技术边界 | P1 |
| `story/world/locations.md` | 地点、场景、空间关系 | P1 |
| `story/world/timeline.md` | 故事内时间线 | P0 |
| `story/reader_expectations.md` | 爽点、悬念、承诺、回收计划 | P1 |
| `story/theme_and_motifs.md` | 主题、意象、反复出现的象征物 | P2 |
| `story/voice_profiles.json` | 角色声线结构化档案 | P1 |
| `story/chapter_goals.json` | 每章写作目标、冲突、POV、节奏 | P1 |
| `story/revision_notes.jsonl` | 每次修订意图与结果 | P1 |
| `story/audit_history.jsonl` | 审计历史，用于趋势分析 | P0 |

### 5.3 核心文件维度建议

#### 作品层

| 维度 | 字段 |
|---|---|
| 类型定位 | genre、subgenre、targetAudience |
| 连载状态 | serializationStatus、currentVolume、plannedVolumes |
| 风格目标 | styleProfileId、styleGuidePath、aiTellTolerance |
| 篇幅目标 | targetChapters、targetCharsPerChapter、volumePlan |
| 读者承诺 | hooks、payoffStyle、readerExpectations |

#### 章节层

当前 `ChapterMeta` 已有 tags、POV、location、chapterType、moodScore 等字段。

建议新增：

| 字段 | 说明 |
|---|---|
| `sceneCount` | 场景数 |
| `mainConflict` | 本章主冲突 |
| `hookAdvancement` | 推进了哪些伏笔 |
| `payoffIds` | 回收了哪些伏笔 |
| `characterIds` | 出场角色 |
| `timelinePosition` | 故事内时间点 |
| `styleDriftScore` | 文风偏移分 |
| `continuityRiskScore` | 连贯性风险分 |
| `rewriteReason` | 最近一次重写原因 |

#### 角色层

| 字段 | 说明 |
|---|---|
| `roleTier` | major / minor |
| `status` | active / hidden / dead / departed |
| `povEligible` | 是否可作为视角角色 |
| `voiceProfileId` | 声线档案 |
| `relationshipIds` | 关系图 |
| `arcStage` | 角色弧阶段 |
| `secrets` | 秘密与揭示计划 |
| `doNotWrite` | 禁止写法 |

---

## 六、AI 写作功能强化

### 6.1 写作前：章节目标卡

当前写作主要依赖已有上下文和下一章生成。

建议新增“章节目标卡”：

```json
{
  "chapterNumber": 12,
  "title": "雪夜旧账",
  "povCharacter": "程时一",
  "location": "时一堂大药房",
  "timeOfDay": "1931年冬夜",
  "mainConflict": "程时一发现账本异常",
  "requiredBeats": [
    "药房停电",
    "曹二泥出现",
    "账本缺页"
  ],
  "forbiddenMoves": [
    "不能提前揭示金井军曹真实目的"
  ],
  "targetMood": "压抑、寒冷、紧张",
  "hookIdsToAdvance": ["hook-账本", "hook-雪夜枪声"],
  "targetChars": 3000
}
```

用途：

1. Planner 可先生成目标卡。
2. Writer 按目标卡写。
3. Auditor 检查目标是否完成。
4. Reviser 根据未完成项定向修订。

优先级：P0/P1。

### 6.2 写作中：上下文选择强化

建议将 Writer 输入拆成几层：

| 层级 | 内容 |
|---|---|
| 必读层 | 当前章节目标、上章摘要、当前状态、必须推进的伏笔 |
| 角色层 | 本章出场角色卡、声线档案 |
| 世界层 | 本章地点、时间线、规则约束 |
| 风格层 | style_guide、style_profile、AI 腔禁用项 |
| 参考层 | 相关历史章节片段 |

这样可以减少 prompt 膨胀，也能让作者知道本章用了哪些素材。

### 6.3 写作后：审计与修订闭环

建议强化三类审计：

| 审计 | 说明 | 优先级 |
|---|---|---|
| 目标完成审计 | 检查章节目标卡是否完成 | P0 |
| 角色一致性审计 | 检查角色声线、行为、秘密是否越界 | P1 |
| 伏笔治理审计 | 检查伏笔推进/回收/过期 | P1 |
| 文风偏移审计 | 与作家档案或作品文风比较 | P1 |
| 读者承诺审计 | 检查爽点、悬念、节奏承诺是否兑现 | P2 |

修订策略建议：

1. 不再只有“重写整章”。
2. 支持局部修订：
   - 补一个场景
   - 加强对话
   - 降低 AI 腔
   - 修复角色声线
   - 回收指定伏笔
3. 修订结果写入 `revision_notes.jsonl`。

---

## 七、前端写作工作台建议

建议新增或整合一个“写作控制台”视图，而不是让用户在多个页面之间跳。

### 7.1 写作控制台布局

```text
左侧：章节列表 / 当前章节目标 / 章节状态
中间：章节正文 / 生成结果 / 修订 diff
右侧：角色卡 / 伏笔 / 文风 / 审计问题
底部：运行日志 / trace / token 成本
```

### 7.2 必做功能

| 功能 | 说明 | 优先级 |
|---|---|---|
| 下一章目标卡 | 生成前可编辑目标 | P0 |
| 写作按钮增强 | 写下一章、按目标重写、局部修订 | P0 |
| 本章引用素材 | 展示 Writer 实际读取的角色卡、状态、伏笔 | P1 |
| 审计结果面板 | 问题按严重度、维度、是否已修复展示 | P1 |
| 修订 diff | 展示修订前后差异 | P1 |
| 章节元数据编辑 | tags、POV、地点、情绪、类型等快速改 | P1 |
| 角色快捷面板 | 当前章节出现角色的卡片摘要 | P1 |

---

## 八、导入导出体系

### 8.1 章节导入导出

| 功能 | 格式 |
|---|---|
| 导入整本书 | `.txt`、`.md`、`.jsonl.md` |
| 导入单章 | `.md`、纯文本 |
| 导出章节 | 单章 MD、全书 MD、带目录 HTML |
| 导出审校包 | 章节 + 角色卡 + 审计报告 |

### 8.2 角色卡导入导出

| 功能 | 格式 |
|---|---|
| 单角色导出 | `.md` |
| 全角色导出 | `.zip` 或 JSON |
| 批量导入 | Markdown 多文件、CSV、JSON |
| 从旧矩阵导入 | `character_matrix.md` |

### 8.3 核心文件导入导出

建议新增“创作档案包”：

```text
nofusion-story-pack.zip
  book.json
  story/outline/
  story/roles/
  story/world/
  story/style_guide.md
  story/style_profile.json
  chapters/index.json
```

用途：

1. 项目备份。
2. 跨项目迁移设定。
3. 与其他作者协作。
4. 训练/分析专用样本。

---

## 九、分阶段推进路线

### P0：立即推进

目标：让写作主流程更稳、更可见、更少误操作。

| 任务 | 模块 | 成本 |
|---|---|---|
| 章节拆分预览 | Import + Studio | 1-2 天 |
| 章节导入前异常检测 | Core + Studio | 0.5 天 |
| 章节目标卡初版 | Core + Studio | 1-2 天 |
| `audit_history.jsonl` | Core | 0.5-1 天 |
| 写作控制台基础版 | Studio | 2-3 天 |
| 角色卡模板统一 | Core + TruthFiles | 1 天 |

交付标准：

1. 导入章节前能预览。
2. 写下一章前能看到并编辑章节目标。
3. 写完后能看到本章审计问题和是否通过。
4. 角色卡至少有统一模板。

### P1：本月推进

目标：让角色、核心文件和 AI 写作形成闭环。

| 任务 | 模块 | 成本 |
|---|---|---|
| 角色卡管理页 | Studio | 2-3 天 |
| 角色卡导入/导出 | Core + Studio | 2 天 |
| 旧角色矩阵拆卡 | Core | 1-2 天 |
| `timeline.md` 与地点文件 | TruthFiles + Writer | 1 天 |
| 角色声线初版 | Core + Writer | 2 天 |
| 文风偏移审计 | Core + Analytics | 1-2 天 |
| 局部修订指令 | Reviser + Studio | 2 天 |

交付标准：

1. 角色卡能增删改查、导入导出。
2. Writer 能读取本章相关角色卡和声线。
3. 审计能提示角色越界、声线偏移、伏笔过期。
4. 修订可以针对具体问题执行。

### P2：1-2 个月推进

目标：形成长篇治理优势。

| 任务 | 模块 |
|---|---|
| 伏笔关系图 | Studio + Core |
| 章节节奏曲线 | Analytics |
| 角色出场热力图 | Analytics |
| 读者承诺文件 | Core + Writer |
| 多卷结构治理 | Outline + ChapterMeta |
| 创作档案包导入导出 | Core + Studio |

### P3：暂缓

| 功能 | 暂缓原因 |
|---|---|
| 完整数据库替代文件系统 | 当前 JSON/MD 足够，迁移成本高 |
| 多用户协作权限 | 权限、锁、同步复杂 |
| 实时多人编辑 | 前端与存储复杂度高 |
| 大规模知识图谱 | 先用角色卡、伏笔、时间线即可 |
| 自动生成整本商业成书 | 质量风险高，应先强化章节级闭环 |

---

## 十、推荐优先级结论

最推荐的推进顺序：

1. **章节拆分预览与导入治理**
2. **章节目标卡**
3. **角色卡模板与管理页**
4. **角色卡导入导出**
5. **核心文件维度补齐：timeline、locations、reader_expectations**
6. **写作控制台基础版**
7. **审计历史与修订闭环**
8. **角色声线与文风偏移审计**

最终方向：

> NoFusion 的写作模块不应只追求“更会生成”，而应升级为“生成前可计划、生成中可控、生成后可审计、修订时可定位”的长篇小说生产系统。

这样才能真正区别于普通 AI 写作工具，也能支撑长篇项目持续迭代。
