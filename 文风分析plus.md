# 文风分析 Plus 执行方案

> 方案日期：2026-06-03  
> 基础项目：NoFusion / InkOS 1.4.1  
> 方案目标：基于当前前端风格与既有文风分析链路，低成本扩展“作家文风档案库 + 多格式文章读取 + 可应用到书籍”的文风分析 Plus 能力。

---

## 一、当前基础判断

当前 NoFusion 已经具备文风分析的基础能力，但还停留在“单次文本分析”和“导入到某本书”的阶段。

已有基础包括：

| 模块 | 当前能力 | 可复用价值 |
|---|---|---|
| Core | 已有 `analyzeStyle(text, sourceName)` | 可继续作为基础分析器 |
| Pipeline | 已有 `generateStyleGuide(bookId, referenceText, sourceName)` | 可继续生成 `style_profile.json` 与 `style_guide.md` |
| Writer | 已读取 `story/style_profile.json` 与 `story/style_guide.md` | 不需要重写写作器 |
| Studio | 已有 `StyleManager` 页面 | 可在原页面扩展，不需要新建复杂工作台 |
| API | 已有 `/style/analyze` 与 `/books/:id/style/import` | 可保留兼容并新增接口 |
| CLI | 已有 `inkos style analyze/import` 思路 | 可扩展为多格式和档案库命令 |

当前缺口：

1. 没有“作家级文风档案库”。
2. 不能把多篇样本文档聚合成稳定的作家文风。
3. 前端只支持粘贴文本，不支持上传 `.md`、`.docx`、`.pdf`。
4. 文风档案不能独立管理、复用、追加样本或应用到不同书籍。
5. `.style_profile.json` 目前更像“书籍局部设置”，还不是可复用资产。

---

## 二、最终定位

文风分析 Plus 不应做成大型数据库系统，也不应重写写作器。

推荐定位：

> 在现有 StyleManager 基础上，增加一个轻量的“作家文风档案库”，支持从 `.md`、`.txt`、`.docx`、`.pdf` 提取文本，生成可复用的作家文风档案，并一键应用到任意书籍。

核心设计原则：

| 原则 | 说明 |
|---|---|
| 先文件库，后数据库 | 当前项目以 JSON / Markdown 为主，先用文件式档案库成本最低 |
| 先复用写作器，后扩展提示词 | 写作器已能读取文风文件，先把档案库结果写入书籍目录 |
| 先支持文字型文档，后支持 OCR | 扫描版 PDF 成本高，暂不放入第一阶段 |
| 先扩展 StyleManager，后新建页面 | 当前前端风格已稳定，直接升级现有文风页最省成本 |
| 先聚合统计，后智能检索 | 多样本文风聚合比向量库、相似搜索更优先 |

---

## 三、信息架构

建议新增轻量文件式档案库：

```text
style-library/
  index.json
  authors/
    author-id/
      profile.json
      style_guide.md
      sources/
        source-id.json
      extracted/
        source-id.txt
```

### 1. `index.json`

用于快速列出所有作家档案。

```json
{
  "authors": [
    {
      "id": "lu-xun",
      "name": "鲁迅",
      "language": "zh",
      "tags": ["现代文学", "冷峻", "讽刺"],
      "sourceCount": 3,
      "updatedAt": "2026-06-03T00:00:00.000Z"
    }
  ]
}
```

### 2. `profile.json`

用于保存聚合后的作家文风。

建议字段：

| 字段 | 说明 |
|---|---|
| `id` | 作家档案 ID |
| `name` | 作家名称 |
| `language` | 语言 |
| `tags` | 标签 |
| `sourceIds` | 样本文档列表 |
| `aggregateProfile` | 聚合后的 `StyleProfile` |
| `sampleStats` | 样本数量、总字数、平均字数 |
| `version` | 档案版本 |
| `createdAt` / `updatedAt` | 时间戳 |

### 3. `sources/source-id.json`

用于保留单个样本的来源和分析结果。

建议字段：

| 字段 | 说明 |
|---|---|
| `id` | 样本 ID |
| `authorId` | 所属作家 |
| `fileName` | 原始文件名 |
| `fileType` | `md` / `txt` / `docx` / `pdf` |
| `textHash` | 文本 hash，用于去重 |
| `charCount` | 提取后的字数 |
| `profile` | 单篇文章的 `StyleProfile` |
| `status` | `ready` / `failed` |
| `error` | 失败原因 |

---

## 四、Core 调整方向

### 1. 新增文档读取模块

建议新增：

```text
packages/core/src/utils/document-reader.ts
```

职责：

| 文件类型 | 实现方式 | 优先级 |
|---|---|---|
| `.md` | `fs.readFile` 后清理 frontmatter | P0 |
| `.txt` | `fs.readFile` | P0 |
| `.docx` | 引入 `mammoth` 提取正文 | P1 |
| `.pdf` | 引入 `pdf-parse` 或 `pdfjs-dist` | P1 |
| 扫描版 PDF | 后续 OCR | P3 |

输出统一结构：

```ts
interface ExtractedDocument {
  sourceName: string;
  fileType: "md" | "txt" | "docx" | "pdf";
  text: string;
  charCount: number;
  warnings: string[];
}
```

注意事项：

1. 对超大文件做最大字数截断或分块。
2. PDF 提取失败时保留错误提示，不中断整个档案库。
3. 对空文本、乱码文本、过短文本给出警告。
4. 不把原始文件强制复制进档案库，优先保存提取文本和 hash。

### 2. 新增文风档案库模块

建议新增：

```text
packages/core/src/style-library/
  store.ts
  aggregate.ts
  models.ts
```

职责：

| 文件 | 职责 |
|---|---|
| `models.ts` | 定义 `AuthorStyleProfile`、`StyleSourceDocument` |
| `store.ts` | 读写 `style-library/` 目录 |
| `aggregate.ts` | 合并多个样本的文风分析结果 |

核心方法：

```ts
createAuthorProfile(input)
listAuthorProfiles()
getAuthorProfile(authorId)
addStyleSource(authorId, extractedDocument)
reanalyzeAuthorProfile(authorId)
applyAuthorProfileToBook(authorId, bookId)
```

### 3. 新增聚合逻辑

建议新增：

```ts
mergeStyleProfiles(profiles, weights)
```

聚合规则：

| 指标 | 合并方式 |
|---|---|
| 平均句长 | 按字数加权平均 |
| 段落长度 | 按字数加权平均 |
| 词汇多样性 | 按样本字数加权，并保留区间 |
| 高频模式 | 合并后按出现次数排序 |
| 修辞特征 | 去重、计数、排序 |
| 来源名称 | 聚合为作家档案名称 |

第一阶段不需要复杂机器学习，只需要稳定、可解释、可回溯。

### 4. 应用到书籍

应用某个作家文风时，只写入现有文件：

```text
books/<bookId>/story/style_profile.json
books/<bookId>/story/style_guide.md
```

可选增加：

```json
{
  "styleProfileId": "lu-xun",
  "styleProfileName": "鲁迅",
  "styleAppliedAt": "2026-06-03T00:00:00.000Z"
}
```

这可以写入 `book.json` 或独立 `story/style_source.json`，用于前端展示“当前书籍使用了哪个作家文风”。

---

## 五、Studio 前端调整方向

当前 `StyleManager` 的前端风格特点：

| 特征 | 当前表现 | Plus 版本延续方式 |
|---|---|---|
| 页面结构 | 面包屑 + 标题 + 双栏内容 | 继续保留 |
| 视觉语言 | `rounded-lg`、细边框、`bg-secondary/30` | 不引入厚重卡片 |
| 图标 | 使用 `lucide-react` | 增加 `FileText`、`Library`、`Plus`、`RefreshCw` |
| 信息密度 | 偏工具型、紧凑 | 保持工作台风格 |
| 操作方式 | 输入、分析、导入 | 扩展为上传、保存档案、应用书籍 |

### 1. 页面结构建议

在原 `StyleManager` 内增加四个轻量 Tab：

| Tab | 功能 |
|---|---|
| 文本分析 | 保留现有粘贴文本分析 |
| 文件分析 | 上传 `.md` / `.txt` / `.docx` / `.pdf` |
| 作家档案 | 管理作家文风库 |
| 应用到书籍 | 将档案应用到目标书籍 |

页面不建议改成大首页或营销式布局，应保持工具面板形态。

### 2. 左右栏布局

推荐布局：

```text
左栏：输入 / 上传 / 档案列表
右栏：分析结果 / 档案详情 / 应用操作
```

继续沿用当前双栏逻辑，降低改造成本。

### 3. 文件分析区

新增上传区域：

| 控件 | 说明 |
|---|---|
| 文件选择 | 支持多选 |
| 来源名称 | 默认使用文件名 |
| 作家名称 | 可选；填写后可直接保存到档案 |
| 分析按钮 | 提取文本并调用文风分析 |
| 保存为作家档案 | 将结果保存到 `style-library/` |
| 追加到已有档案 | 将样本加入某个作家 |

视觉建议：

1. 上传区使用虚线边框，与当前空状态保持一致。
2. 文件列表使用紧凑行，不做大卡片。
3. 每个文件显示文件名、类型、字数、状态。
4. 错误状态使用现有 `destructive` 色系。

### 4. 作家档案区

作家档案列表字段：

| 字段 | 展示方式 |
|---|---|
| 作家名称 | 主文本 |
| 标签 | 小号 pill |
| 样本数 | 数字徽标 |
| 总字数 | 次级信息 |
| 更新时间 | 次级信息 |
| 当前状态 | `ready` / `needs-reanalysis` |

操作：

| 操作 | 图标建议 |
|---|---|
| 查看详情 | `Library` |
| 追加样本 | `Plus` |
| 重新分析 | `RefreshCw` |
| 应用到书籍 | `Upload` |
| 删除档案 | `Trash2`，放在次级菜单或确认弹窗 |

### 5. 分析结果区

继续使用当前四宫格指标：

| 指标 | 说明 |
|---|---|
| 平均句长 | 当前已有 |
| 词汇多样性 | 当前已有 |
| 平均段落长度 | 当前已有 |
| 句长波动 | 当前已有 |

新增 Plus 指标：

| 指标 | 说明 |
|---|---|
| 样本数量 | 作家档案维度 |
| 总字数 | 样本质量判断 |
| 文风稳定度 | 多样本差异越小越稳定 |
| 提取警告 | PDF 乱码、文本过短、重复样本 |

---

## 六、API 调整方向

保留当前接口：

```text
POST /api/v1/style/analyze
POST /api/v1/books/:id/style/import
```

新增接口：

| 接口 | 职责 | 优先级 |
|---|---|---|
| `POST /api/v1/style/extract-file` | 上传或读取文件并提取文本 | P0 |
| `GET /api/v1/style/authors` | 列出作家档案 | P0 |
| `POST /api/v1/style/authors` | 创建作家档案 | P0 |
| `GET /api/v1/style/authors/:id` | 查看作家档案详情 | P0 |
| `POST /api/v1/style/authors/:id/sources` | 给作家追加样本 | P1 |
| `POST /api/v1/style/authors/:id/reanalyze` | 重新聚合文风 | P1 |
| `POST /api/v1/books/:id/style/apply-author` | 应用作家文风到书籍 | P1 |

第一阶段可以先不做复杂 multipart 上传，使用前端读取文本后提交也可以。但为了支持 `.docx` 和 `.pdf`，最终建议由后端处理文件解析。

---

## 七、CLI 调整方向

现有命令可以扩展为：

```bash
inkos style analyze <file>
inkos style library list
inkos style library create <authorName>
inkos style library add <authorId> <file...>
inkos style library reanalyze <authorId>
inkos style apply <authorId> --book <bookId>
```

CLI 与 Studio 应共用 Core 的文档读取和档案库逻辑，避免两套实现。

---

## 八、分阶段执行计划

### P0：最小可用版本

目标：让用户能上传或选择文本文件，生成作家档案，并应用到书籍。

任务：

| 任务 | 模块 | 预计成本 |
|---|---|---|
| 新增 `.md` / `.txt` 文档读取 | Core | 0.5 天 |
| 新增 `style-library/` 文件式存储 | Core | 1 天 |
| 新增作家档案模型 | Core | 0.5 天 |
| 支持单样本保存为作家档案 | API + Core | 1 天 |
| StyleManager 增加“作家档案”基础列表 | Studio | 1 天 |
| 支持应用档案到书籍 | API + Studio | 0.5-1 天 |

交付标准：

1. 可以创建作家档案。
2. 可以从 `.md` / `.txt` 生成档案。
3. 可以在前端看到作家档案列表。
4. 可以把档案应用到某本书。
5. 应用后写作器继续读取现有 `style_profile.json` 与 `style_guide.md`。

### P1：文件能力增强

目标：支持常见文档格式和多样本聚合。

任务：

| 任务 | 模块 | 预计成本 |
|---|---|---|
| 引入 `mammoth` 支持 `.docx` | Core | 0.5-1 天 |
| 引入 `pdf-parse` 或 `pdfjs-dist` 支持文字型 PDF | Core | 1 天 |
| 新增多样本聚合 `mergeStyleProfiles` | Core | 1 天 |
| 前端文件列表增加状态、字数、错误提示 | Studio | 0.5-1 天 |
| 支持追加样本到已有作家 | API + Studio | 1 天 |

交付标准：

1. `.docx` 可以稳定提取正文。
2. 文字型 `.pdf` 可以提取正文。
3. 一个作家档案可以包含多篇样本。
4. 重新分析后能生成聚合文风。

### P2：风格质量与可解释性

目标：让用户知道档案是否可靠，以及文风是否偏移。

任务：

| 任务 | 模块 | 预计成本 |
|---|---|---|
| 增加文风稳定度指标 | Core | 1 天 |
| 增加样本质量提示 | Core + Studio | 0.5 天 |
| 增加当前书籍使用的文风来源显示 | Studio | 0.5 天 |
| 章节文风漂移对比 | Core + Analytics | 1-2 天 |
| 文风规则外置 JSON | Core | 1 天 |

交付标准：

1. 用户能看到档案样本是否足够。
2. 用户能看到当前书籍应用了哪个作家档案。
3. 用户能看到章节是否偏离目标文风。

### P3：暂缓能力

这些能力价值存在，但不适合作为第一批：

| 能力 | 暂缓原因 |
|---|---|
| 扫描版 PDF OCR | 依赖重、错误率高、调试成本高 |
| 向量库相似文风检索 | 当前还没有足够档案数据 |
| 云端共享作家库 | 权限、版权、同步复杂 |
| 完整数据库迁移 | 文件式存储已足够支撑本地工作流 |
| 自动模仿名家文本细节 | 存在版权和风格过拟合风险 |

---

## 九、前端文案建议

新增 i18n key 建议：

| Key | 中文 |
|---|---|
| `style.tabs.text` | 文本分析 |
| `style.tabs.files` | 文件分析 |
| `style.tabs.library` | 作家档案 |
| `style.tabs.apply` | 应用到书籍 |
| `style.uploadHint` | 拖入或选择文档进行分析 |
| `style.authorName` | 作家名称 |
| `style.saveAsAuthor` | 保存为作家档案 |
| `style.appendToAuthor` | 追加到已有档案 |
| `style.reanalyzeAuthor` | 重新分析 |
| `style.applyAuthor` | 应用文风 |
| `style.sampleCount` | 样本数 |
| `style.totalChars` | 总字数 |
| `style.stability` | 文风稳定度 |
| `style.extractWarnings` | 提取提示 |

文案风格建议：

1. 避免解释性长句，保持工具型短文案。
2. 错误提示要具体，例如“PDF 未提取到有效文字”。
3. 对覆盖书籍文风的操作增加确认。
4. 不在页面中写大段使用说明，必要说明放 tooltip 或状态提示。

---

## 十、风险与边界

| 风险 | 处理方式 |
|---|---|
| PDF 提取乱码 | 显示警告，不保存为有效样本 |
| 样本文本过短 | 标记为低可信样本 |
| 重复上传同一文件 | 通过 `textHash` 去重 |
| 作家档案覆盖书籍当前文风 | 前端二次确认 |
| 文件库手动编辑导致 JSON 损坏 | 读取时做 schema 校验并显示错误 |
| 版权文本存储风险 | 默认只本地存储，避免云同步；可只存提取摘要和 hash |

---

## 十一、推荐第一轮开发清单

第一轮建议只做六件事：

1. 新增 `document-reader.ts`，支持 `.md` / `.txt`。
2. 新增 `style-library/` 文件式档案库。
3. 新增作家档案模型和基础 store。
4. Studio 的 StyleManager 增加“作家档案”Tab。
5. 支持“保存当前分析结果为作家档案”。
6. 支持“应用作家档案到书籍”。

这一轮完成后，NoFusion 就能从“临时文风分析工具”升级为“可复用文风资产管理工具”。

---

## 十二、最终结论

文风分析 Plus 的最佳路线不是一次性做复杂数据库或文档 AI 平台，而是沿着当前 NoFusion 的低成本路线推进：

> 文档读取 → 作家档案库 → 多样本聚合 → 应用到书籍 → 文风漂移监测。

这条路线与当前前端风格兼容，和现有写作器接入成本低，也能逐步扩展到 `.docx`、`.pdf`、角色声线、章节文风漂移等更高价值能力。
