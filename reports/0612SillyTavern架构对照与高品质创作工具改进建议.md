# SillyTavern 架构对照与高品质创作工具改进建议

> 调研日期：2026-06-12  
> 对照项目：Nofusion / InkOS  
> 调研范围：SillyTavern 官方文档中的 Prompt Manager、World Info / Lorebook、Data Bank / Vector Storage、Summarize、STscript、Character Design、Personas 与消息分支机制

## 一、结论

SillyTavern 最值得借鉴的不是“角色聊天界面”，而是它把 LLM 输入拆成了可组合、可排序、可激活、可检查的上下文部件：

1. Prompt Manager 管理不同提示片段的顺序、角色和启停状态。
2. World Info / Lorebook 根据关键词、位置、优先级、概率和预算动态注入设定。
3. Vector Storage 与 Data Bank 负责从大量资料中检索局部相关内容。
4. Summarize 在会话持续增长时保留压缩后的长期语境。
5. Character Card、Persona、Author's Note 分离角色、用户视角和当前写作意图。
6. STscript 把重复操作变成带变量、条件和流程控制的脚本。
7. Swipe、Branch 等交互允许保留多个生成候选，而不是一次生成后立即覆盖。

当前项目已经具备 Planner、Writer、Continuity、Reviser、状态验证、规则分层、记忆检索等较强基础，能力上高于普通提示词壳。但它仍主要依靠“大段上下文拼接 + 固定代理管线 + 通用类型配置”，缺少一个位于所有 Agent 之前的上下文编译层，也缺少面向不同创作类型的声明式管线。

建议将项目定位升级为：

> 一个具有可解释上下文编译、分层叙事记忆、模型能力路由、类型化创作管线、候选分支和持续评测能力的 Narrative Production Studio。

这里所说的“突破 LLM 限制”，应具体落在上下文窗口、长文一致性、输出截断、指令遵循、模型能力差异、质量上限和成本延迟等工程问题上。项目不应把绕过供应商安全策略、审核机制或服务条款作为产品能力，也不应把 jailbreak 提示词作为基础架构。

---

## 二、SillyTavern 文档架构的核心逻辑

### 2.1 Prompt 不是字符串，而是有顺序和角色的组件树

Prompt Manager 的核心价值是让主提示、人物描述、场景、示例对话、World Info、聊天历史和历史后指令分别存在，并可调整顺序、角色和启用状态。

这解决了三个问题：

- 提示词来源可追踪。
- 不同模型可使用不同模板和消息角色。
- 用户能检查模型最终实际收到的内容。

对创作工具而言，这意味着“世界观、角色、文风、章节目标、近期状态、审校要求”不应由每个 Agent 自行拼接，而应由统一编译器生成。

### 2.2 Lorebook 是条件式上下文，不是静态百科全书

World Info / Lorebook 条目可以按关键词或条件激活，并配置：

- 插入位置与深度；
- 顺序和优先级；
- Token 预算；
- 激活概率；
- 递归扫描；
- 包含组与排他关系；
- 全局、角色或会话级作用域。

其本质是“按当前任务选择最相关的事实”。但关键词激活容易误召回、漏召回，递归激活也可能造成上下文膨胀。因此本项目不应只复制 Lorebook，而应把它升级成“语义检索 + 实体关系 + 时间有效性 + 规则优先级”的创作知识图谱。

### 2.3 长期记忆由检索与摘要共同承担

Vector Storage / Data Bank 适合从外部资料和历史文本中选取相关片段；Summarize 适合压缩越来越长的会话。

二者不能互相替代：

- 检索解决“在大量资料中找到什么”。
- 摘要解决“把已经发生的事情压缩成什么”。
- 结构化状态解决“哪些事实现在仍然有效”。

高品质长篇创作必须同时保留原文证据、层级摘要和当前状态，不能只保留一份会不断失真的滚动摘要。

### 2.4 Character、Persona 与当前意图应互相分离

Character Card 强调角色定义和示例消息；Persona 表示对话中“我是谁”；Author's Note 则在靠近最近历史的位置强化当前意图。

映射到小说生产：

- Character Card：角色稳定设定与语言习惯。
- POV / Narrator Persona：本章叙述者、可知信息和观察偏差。
- Scene Note：当前场景的情绪、节奏和禁区。
- Author Intent：作者本章真正想让读者获得什么体验。

如果这些内容混成一份 story bible，模型会把稳定事实、暂时状态和创作建议视为同等权重。

### 2.5 脚本与分支使创作从对话升级为工作流

STscript 使用变量、条件、循环和命令组织重复操作。Swipe / Branch 允许保留候选输出。

对于当前项目，更合理的升级不是照搬命令语法，而是提供：

- 声明式 Pipeline Manifest；
- 可恢复的节点执行状态；
- 候选生成、比较、淘汰与晋级；
- 人工审批点；
- 每次运行的输入、模型、成本和质量记录。

---

## 三、当前项目的基础与主要差距

### 3.1 已有基础

项目已有以下可继续利用的能力：

- `packages/core/src/pipeline/runner.ts` 已组织规划、写作、连续性审校、修订和状态验证。
- `packages/core/src/utils/context-assembly.ts` 已有 hard、soft、diagnostic 规则分层和覆盖关系。
- `packages/core/src/agents/composer.ts` 已选择摘要、伏笔、事实与 canon 等上下文。
- `packages/core/src/state/memory-db.ts` 已形成持久化记忆基础。
- `packages/core/src/models/style-profile.ts` 已能表达较细的统计型文风指纹。
- `packages/core/src/llm/provider.ts` 与模型卡已记录上下文和输出上限。
- ChapterGoal、ChapterIntent、RuleStack、ContextPackage 已具备结构化输入雏形。

因此不需要推翻现有 Agent，而应在它们之前增加统一编译层，在它们之上增加声明式编排与质量评测层。

### 3.2 差距一：聊天上下文仍是整库注入

`packages/core/src/agent/context-transform.ts` 会读取 `story/` 下全部 Markdown 文件，按少量优先文件和文件名字母序拼接，再作为一条 user 消息插入历史前端。

问题包括：

- 文件越多，固定上下文成本越高。
- 与当前任务无关的内容稀释关键指令。
- 所有内容只有一个消息角色，优先级无法可靠表达。
- 缺少 Token 预算、失效时间、激活原因和冲突处理。
- 导入资料中的提示注入文本可能被误当作指令。

这应是首个架构改造点。

### 3.3 差距二：ContextPackage 记录“选了什么”，没有描述“怎样使用”

当前 `ContextSource` 主要是：

```ts
{
  source: string;
  reason: string;
  excerpt?: string;
}
```

它缺少：

- 消息角色与插入位置；
- 作用域和优先级；
- Token 预算与实际 Token；
- 激活规则；
- 有效章节范围；
- 事实置信度与来源版本；
- 冲突组、依赖和排他关系；
- 是否允许压缩或丢弃。

因此选择结果最终仍要由各 Agent 重新解释和拼装，容易产生不同 Agent 看到不同“真相”的问题。

### 3.4 差距三：记忆检索仍偏词面与固定数量

固定选取若干摘要、伏笔和事实，在早期足够，但长篇作品会出现：

- 同名实体或别名无法正确关联；
- 很久以前但即将回收的伏笔被低估；
- 已失效状态被旧摘要重新带回；
- 角色“知道什么”和作者“知道什么”没有隔离；
- 不同 Agent 使用同一份检索结果，信息过多或不足。

### 3.5 差距四：GenreProfile 不是完整的类型生产协议

当前类型配置包含章型、疲劳词、节奏规则、爽点和审计维度，但不足以定义一条真正不同的生产管线。

悬疑、言情、短篇、互动叙事和剧本的差异不仅是词汇与节奏，还包括：

- 规划粒度；
- 场景结构；
- 信息披露规则；
- 类型专用状态；
- 类型专用审校器；
- 候选生成与选择策略；
- 发布平台的篇幅和首屏要求。

### 3.6 差距五：模型卡只表达接口能力，没有表达创作行为

当前模型卡知道上下文窗口、输出上限、图像、工具和推理能力，但创作路由还需要：

- 中文和英文长文质量；
- 指令遵循稳定性；
- JSON / Schema 输出可靠性；
- 长文续写与结尾倾向；
- 角色声音保持能力；
- 不同类型文本的质量评分；
- 延迟、价格和并发限制；
- 模型常见拒答或格式偏差；
- 经项目基准测试得到的版本化成绩。

没有这些数据，就只能按模型名称或固定配置分配任务。

---

## 四、目标架构：从 Agent Pipeline 升级为 Narrative OS

建议形成六层架构：

```text
创作资产层
  角色卡 / 世界规则 / 风格卡 / 类型协议 / 参考资料 / 章节状态
          ↓
知识与记忆层
  事实图谱 / 事件账本 / 分层摘要 / 向量与全文检索 / 来源证据
          ↓
Prompt Compiler
  激活 / 冲突裁决 / 排序 / Token 预算 / 消息角色 / 模型适配
          ↓
Pipeline Orchestrator
  DAG / 候选分支 / 人工审批 / 重试 / 断点恢复 / 模型路由
          ↓
创作与审校 Agent
  Director / Planner / Writer / 类型审校器 / Reviser / Validator
          ↓
评测与可观测层
  Prompt Inspector / Trace / 成本 / 质量基准 / 回归 / 人类偏好
```

核心原则是：Agent 不再直接读取磁盘并自行决定上下文，而是申请一个针对“阶段、章节、场景、模型”的编译结果。

---

## 五、优先方案一：Prompt Compiler

### 5.1 建议数据结构

```ts
interface PromptFragment {
  id: string;
  content: string;
  source: string;
  sourceRevision: string;

  scope: "global" | "book" | "arc" | "chapter" | "scene";
  role: "system" | "developer" | "user" | "assistant";
  slot:
    | "foundation"
    | "beforeTask"
    | "knowledge"
    | "recentState"
    | "examples"
    | "task"
    | "postHistory";

  priority: number;
  hard: boolean;
  maxTokens?: number;
  compressible: boolean;

  activation: ActivationRule[];
  validFromChapter?: number;
  validToChapter?: number;
  conflictGroup?: string;
  dependsOn?: string[];
  provenance: Provenance;
}
```

`ActivationRule` 至少支持：

- `always`：基础规则。
- `keyword`：明确名称和专有词。
- `entity`：人物、地点、物品和事件关联。
- `semantic`：语义相似检索。
- `chapterRange` / `scene` / `pov`：叙事位置。
- `hookDue`：伏笔到期压力。
- `statePredicate`：状态条件。
- `manualPin`：作者临时固定。

### 5.2 编译流程

```text
读取阶段清单
  → 收集候选 Fragment
  → 激活规则计算
  → 权限与来源隔离
  → 冲突组裁决
  → 按 hard、slot、priority 排序
  → 分配各层 Token 预算
  → 压缩或淘汰软内容
  → 转换为目标模型消息格式
  → 输出 PromptManifest 与可解释 Trace
```

### 5.3 每个 Agent 使用不同的上下文清单

不应让所有 Agent 都读取完整资料：

| 阶段 | 必需上下文 | 应避免 |
|---|---|---|
| Director | 全书承诺、卷弧、长期节奏、关键伏笔 | 逐字章节原文 |
| Planner | 章节目标、当前状态、相关人物、近期事件、到期伏笔 | 无关世界百科 |
| Writer | 场景计划、POV 可知信息、角色声音、局部环境、风格示例 | 审校器完整规则 |
| Continuity | 新稿、事实图谱、状态迁移、相关历史证据 | 写作修辞提示 |
| Reviser | 原稿、明确问题、不可破坏约束、局部证据 | 全量规划讨论 |

### 5.4 Prompt Inspector

Studio 中应提供类似 Prompt Manager 但更适合生产环境的检查器：

- 最终消息顺序和角色；
- 每个 Fragment 的 Token 数；
- 激活原因；
- 被淘汰或压缩的内容；
- 规则冲突及胜出原因；
- 预计输入、输出费用；
- 模型上下文剩余空间；
- 原始来源和版本；
- 一键以同一输入重放。

这是调试“模型为什么没有遵守”的必要基础。

---

## 六、优先方案二：Lorebook 2.0 与分层叙事记忆

### 6.1 从 Markdown 文件升级为可引用的知识条目

Markdown 仍可作为作者编辑格式，但运行时应编译为结构化条目：

```ts
interface LoreEntry {
  id: string;
  type: "character" | "location" | "object" | "rule" | "event" | "research";
  title: string;
  aliases: string[];
  summary: string;
  body: string;
  entityRefs: string[];
  relationRefs: string[];
  activation: ActivationRule[];
  validTime?: NarrativeTimeRange;
  confidence: "canon" | "authorIntent" | "inferred" | "unverified";
  sourceRefs: SourceRef[];
}
```

建议支持：

- 别名和消歧；
- 人物关系边；
- 事件先后关系；
- 章节有效区间；
- canon、作者意图、模型推断的明确隔离；
- 变更后使相关摘要和向量失效；
- 证据回链到具体文件和段落。

### 6.2 五层记忆

| 层级 | 内容 | 典型生命周期 |
|---|---|---|
| T0 不可变规则 | 世界硬规则、作品边界、已确认 canon | 全书 |
| T1 当前状态 | 场景地点、在场人物、伤势、物品、即时目标 | 场景/章节 |
| T2 活跃叙事 | 当前弧线、关系变化、到期伏笔、未完成承诺 | 数章到一卷 |
| T3 情节摘要 | 场景、章节、弧、卷的层级摘要 | 长期 |
| T4 原始档案 | 章节原文、导入资料、研究材料 | 永久检索 |

任何一次生成都应优先分配 T0、T1，再按任务选择 T2 至 T4。

### 6.3 混合检索

检索评分建议为：

```text
score =
  lexicalMatch
  + semanticSimilarity
  + entityGraphDistance
  + recency
  + narrativeDuePressure
  + manualPriority
  - contradictionPenalty
  - stalenessPenalty
```

全文检索适合专有名词、原句和线索；向量适合语义相近内容；实体图谱适合关系和别名；伏笔到期压力适合长期回收。单一向量库不能覆盖这些需要。

### 6.4 摘要不能覆盖事实账本

推荐同时保存：

- 场景摘要；
- 章节摘要；
- 弧线摘要；
- 卷摘要；
- 事件账本；
- 状态变更集；
- 未解决问题；
- 摘要对应的原文范围。

摘要由低层向高层聚合，但高层摘要不能成为唯一事实来源。发生争议时回到状态变更与原文证据。

---

## 七、优先方案三：角色卡、风格卡与类型协议

### 7.1 Character Card v2

稳定设定与动态状态必须分开：

```text
稳定卡
  身份 / 欲望 / 恐惧 / 价值观 / 行为边界 / 说话方式
  关系基线 / 知识边界 / 正例对话 / 反例对话

动态卡
  当前目标 / 当前情绪 / 当前秘密 / 关系变化
  伤势与资源 / 本章可知信息 / 最近承诺
```

正例和反例比抽象形容词更能稳定角色声音。建议每个主要角色保留 5 至 15 个短示例，并按情绪或场景类型标记。

### 7.2 Narrator / POV Persona

新增独立的叙述人格：

- 人称和距离；
- 观察偏好；
- 可知信息；
- 对不同角色的偏见；
- 词汇层级；
- 允许和禁止的内心访问；
- 不可靠叙述规则。

这能防止“角色卡”和“叙述声音”混淆。

### 7.3 Style Card

现有统计型 `StyleProfile` 应保留，但需增加生成时可直接使用的内容：

- 语言节奏范围，而不是单一均值；
- 代表性正例片段；
- 禁止模仿的负例；
- 对话、动作、心理、说明四种局部模式；
- 场景强度对应的风格变体；
- AI 腔、套话和重复结构的反例；
- 版权与来源标记。

不建议要求模型模仿在世作者。更稳妥的做法是提取可描述的高级特征，组合成原创风格卡，并对参考文本保留来源和授权状态。

### 7.4 GenrePipelineProfile

把现有 GenreProfile 扩展为类型生产协议：

```ts
interface GenrePipelineProfile {
  storyPromise: string;
  beatGrammar: BeatRule[];
  pacingCurve: PacingRule[];
  payoffCadence: PayoffRule[];
  sceneTypes: SceneTypeRule[];
  requiredState: StateSchema[];
  specialistAudits: AuditSpec[];
  platformConstraints: PlatformRule[];
  openingPolicy: OpeningPolicy;
  endingPolicy: EndingPolicy;
  pipelineId: string;
}
```

示例：

- 悬疑：线索公平性、嫌疑人可行性、信息披露账本、误导强度审计。
- 言情：关系阶段、吸引力证据、边界与同意、冲突来源、情感回报审计。
- 爽文：压抑与释放周期、能力展示、收益可见性、连续低回报预警。
- 历史：年代事实、制度和物质文化证据、现代词汇污染审计。
- 短篇：单一核心变化、意象回环、信息密度和结尾余韵。
- 剧本：场次、地点、可拍摄动作、对白功能、时长和格式审计。

---

## 八、多类型、多管线的声明式编排

### 8.1 不再把唯一流程硬编码在 Runner 中

保留 `PipelineRunner` 作为执行引擎，但把阶段定义外置：

```yaml
id: mystery-novel-v1
inputSchema: novel-project-v2

stages:
  - id: direct
    agent: narrative-director
    modelPolicy: reasoning-strong

  - id: plan
    agent: mystery-planner
    dependsOn: [direct]
    outputSchema: scene-plan-v2

  - id: draft-a
    agent: writer
    dependsOn: [plan]
    modelPolicy: prose-strong

  - id: draft-b
    agent: writer
    dependsOn: [plan]
    modelPolicy: prose-diverse

  - id: evaluate
    agent: candidate-arbiter
    dependsOn: [draft-a, draft-b]

  - id: audits
    parallel:
      - continuity-auditor
      - clue-fairness-auditor
      - character-voice-auditor

  - id: revise
    agent: reviser
    qualityGate: criticalIssues == 0
```

### 8.2 候选分支

高品质模式不应只生成一个草稿。建议提供三档：

- 快速：单计划、单草稿、基础审校。
- 标准：单计划、双草稿、自动选优、专业审校。
- 精编：多计划、多场景候选、人工选择、全套审校与最终润色。

候选不必总是整章生成。更有效的方式是在高价值节点生成多个候选：

- 开篇；
- 关键反转；
- 高情绪场景；
- 章节结尾；
- 关键对白。

### 8.3 专家审校器并行，裁决器统一收敛

连续性、角色声音、节奏和类型规则可并行审校，但不能把所有意见原样交给 Reviser。需要一个 Issue Arbiter：

- 合并重复问题；
- 识别互相冲突的修改建议；
- 按 hard constraint、读者影响、修改成本排序；
- 生成最小修改集；
- 标记哪些问题必须人工裁决。

否则 Agent 越多，文本越容易被反复磨平。

---

## 九、工程化突破 LLM 能力限制

### 9.1 上下文窗口限制

可行措施：

- Prompt Compiler 动态预算；
- 按 Agent 任务检索，不共享全量上下文；
- 五层记忆和层级摘要；
- 先实体过滤，再全文/向量召回，再重排；
- 对软信息压缩，对硬规则禁止压缩；
- 保留 Token 安全余量，并记录实际占用。

不要把“更大上下文窗口”当成唯一解法。窗口增大不等于模型能同等注意全部内容。

### 9.2 长输出截断

章节改为场景级生成，并保存续写锚点：

```ts
interface ContinuationAnchor {
  lastCompleteParagraph: string;
  unfinishedAction?: string;
  activeSpeakers: string[];
  currentLocation: string;
  unresolvedBeatIds: string[];
  forbiddenRepeats: string[];
}
```

运行时处理模型 `stopReason`，只从最后完整段落继续；拼接时进行重叠检测、重复结尾检测和标点完整性检查。

### 9.3 指令遵循不稳定

可行措施：

- 规划与状态输出使用 JSON Schema；
- Provider 支持时采用结构化输出或 constrained decoding；
- 生成后先做机器校验，再进行最小修复；
- 硬规则数量保持有限，并在靠近任务的位置重申；
- 为不同模型维护 Prompt Adapter；
- 用正例和反例替代大量抽象禁令。

### 9.4 单次生成质量上限

可行措施：

- 先生成两个差异明确的方案，而不是两个近似随机样本；
- 让评估器只做比较和定位，不直接重写；
- 对关键段落局部重写，避免全章反复改写；
- 强模型用于架构、候选裁决和关键修订；
- 较低成本模型用于检索重排、格式校验和基础审校；
- 最后增加一次去模板化、去重复的局部编辑。

### 9.5 模型差异与供应商限制

建议建立 `ModelBehaviorProfile` 和阶段路由器，以项目实测结果选择模型。

对合法但部分托管模型不支持的创作类型，可允许用户选择符合其需求和法律边界的服务，或部署本地/自托管模型。系统仍应保留内容分类、年龄分级、项目级策略和审计能力。这是部署选择，不是规避平台安全控制。

### 9.6 导入资料中的提示注入

世界设定、网页资料、用户上传文件均应视为“不可信数据”：

- 明确包裹为引用数据；
- 不允许资料改变系统角色或工具权限；
- 过滤伪造的 system / developer 指令；
- Lore 递归激活必须设置深度和 Token 上限；
- 外部内容只能提供事实证据，不能覆盖 hard rule；
- Trace 中显示资料导致的激活链。

---

## 十、质量评测体系

没有稳定基准，多 Agent 只会增加成本，无法证明质量提升。

### 10.1 建议指标

| 类别 | 指标 |
|---|---|
| 约束 | 必须事件完成率、禁止事件触发率、格式合规率 |
| 连续性 | canon 冲突、状态倒退、人物知识越界、时间线错误 |
| 角色 | 声音混淆率、行为动机缺失、关系变化无证据 |
| 叙事 | 重复情节、无效场景、伏笔回收率、信息释放节奏 |
| 文风 | 句式重复、抽象总结密度、套话、视角漂移、风格偏差 |
| 读者体验 | 首屏吸引、困惑段落、无聊段落、继续阅读意愿 |
| 工程 | Token、费用、延迟、重试率、截断率、解析失败率 |

### 10.2 基准集

每种类型建立：

- 10 至 30 个小型结构化任务；
- 3 至 5 个长程连续性项目；
- 已确认的规则和预期状态；
- 人工标注的候选对比；
- 模型、提示词、检索和管线版本。

CI 中运行确定性的 Schema、状态和规则测试；离线任务运行非确定性的质量回归。质量判断应以盲测成对偏好为主，单个 LLM 自评分只能作为信号。

### 10.3 版本化

一次成稿必须能够追溯：

```text
作品版本
Prompt Compiler 版本
Pipeline Manifest 版本
模型与参数
检索索引版本
知识库版本
每个阶段输入摘要
候选选择结果
人工修改记录
```

---

## 十一、Studio 产品形态

建议优先建设以下界面：

1. Prompt Inspector：最终上下文、Token、激活与冲突。
2. Lorebook Editor：条目、别名、关系、有效时间和激活模拟。
3. Pipeline Canvas：节点、依赖、模型策略、质量门和人工审批点。
4. Candidate Board：候选并排、差异高亮、局部合并、晋级和回退。
5. Narrative State：人物、地点、物品、关系、事件和伏笔的当前状态。
6. Quality Dashboard：按章节显示连续性、节奏、角色、风格和成本趋势。
7. Run Trace：每个 Agent 的输入来源、输出、重试和错误。

用户不应被迫编辑复杂系统提示词。高级配置应以卡片、规则、示例和管线模板表达，底层 Prompt 只作为检查和调试视图。

---

## 十二、落地路线

### 阶段 0：稳定当前基线，1 至 2 周

- 先完成当前 P0/P1 缺陷修复和回归。
- 为 Runner、ContextPackage、MemoryDB 建立行为基线。
- 固定 3 个代表性测试项目和成本记录。
- 暂不增加更多 Agent。

验收：同一提交可重复执行核心流程，失败可定位到具体阶段。

### 阶段 1：Prompt Compiler MVP，2 至 4 周

- 新增 PromptFragment、PromptManifest、TokenBudget。
- 将 `context-transform.ts` 的整库注入替换为按需编译。
- Writer、Planner、Continuity 首批接入统一清单。
- 增加 Prompt Inspector API 和基础 Studio 页面。
- 增加外部资料与指令的隔离。

验收：任何一次模型调用都能解释“用了什么、为什么使用、丢弃了什么”。

### 阶段 2：Lorebook 2.0 与分层记忆，4 至 8 周

- Markdown 编译为 LoreEntry。
- 引入实体、别名、关系和时间有效性。
- 加入全文检索、向量检索和重排。
- 建立场景、章节、弧、卷摘要及事件账本。
- 为各 Agent 定义不同检索策略。

验收：100 章规模测试中，相关事实召回、失效事实排除和伏笔回收达到基准要求。

### 阶段 3：声明式多管线，4 至 8 周

- Pipeline Manifest 与 DAG 执行。
- 模型行为档案和阶段路由。
- 候选分支、自动比较和人工审批。
- 先提供长篇小说、短篇、悬疑三种模板。
- 专家审校结果由统一裁决器收敛。

验收：新增一种创作类型主要通过配置、状态 Schema 和插件式审校器完成，不修改 Runner 主流程。

### 阶段 4：持续评测与生态，持续建设

- 类型基准集和人类偏好评测。
- Prompt、模型和 Pipeline 回归看板。
- 可分享的角色卡、风格卡、Lorebook 和 Pipeline 模板。
- 插件权限、版本兼容和签名机制。

### 人员与风险

在 2 至 4 名熟悉 TypeScript、LLM 工程和前端的开发者配置下，阶段 1 可独立交付，阶段 2 至 3 建议按垂直切片逐类上线。

主要风险：

- 过早增加 Agent 数量，成本升高但质量不可证明。
- 向量检索替代结构化状态，导致事实漂移。
- 规则过多，Writer 输出僵硬。
- 所有类型共用一套评测标准。
- 用户不可见最终 Prompt，问题只能靠猜。
- 为“突破限制”堆叠危险提示词，形成不可维护且违反供应商政策的能力。

---

## 十三、建议的近期任务优先级

### P0：架构入口

1. 建立 `PromptFragment`、`PromptManifest` 和 Token 计量。
2. 禁止 chat session 自动注入全部 `story/*.md`。
3. 为外部资料建立 data/instruction 信任边界。
4. 所有 Agent 调用保存可重放 Trace。

### P1：高收益能力

1. ContextPackage 增加 scope、priority、slot、validity、provenance。
2. 记忆检索加入实体、时间、伏笔到期和混合重排。
3. Character Card v2、POV Persona、Style Card。
4. 模型行为档案和按阶段路由。
5. 候选分支与关键节点多方案生成。

### P2：规模化

1. Pipeline Manifest 与 DAG。
2. GenrePipelineProfile 和类型专用审校器。
3. Lorebook 编辑器与激活模拟。
4. 长篇基准、盲测和版本回归。
5. 模板与插件生态。

---

## 十四、最终判断

当前项目不缺 Agent 名称，也不缺长提示词。真正限制品质的是：

- 上下文缺少统一编译和解释；
- 事实、摘要、意图和风格没有充分分层；
- 类型差异没有落实为不同数据结构和执行管线；
- 模型选择没有建立在创作行为实测上；
- 质量提升缺少可回归的基准；
- 候选、人工判断和版本追踪还没有成为一等能力。

最优路径不是继续扩写 Writer Prompt，而是先建设 Prompt Compiler 和分层叙事记忆，再将现有 Agent 改造成可声明、可替换、可评测的管线节点。完成这两层后，项目才有条件同时支持高品质长篇、短篇、类型小说、剧本和互动叙事，而不会随着作品长度和功能数量增长而失控。

---

## 参考资料

- SillyTavern 官方文档首页：https://docs.sillytavern.app/
- World Info / Lorebooks：https://docs.sillytavern.app/usage/core-concepts/worldinfo/
- Prompt Manager：https://docs.sillytavern.app/usage/prompts/prompt-manager/
- Data Bank：https://docs.sillytavern.app/usage/core-concepts/data-bank/
- Chat Vectorization：https://docs.sillytavern.app/extensions/chat-vectorization/
- Summarize：https://docs.sillytavern.app/extensions/summarize/
- STscript：https://docs.sillytavern.app/usage/st-script/
- Character Design：https://docs.sillytavern.app/usage/core-concepts/characterdesign/
- Personas：https://docs.sillytavern.app/usage/core-concepts/personas/
- Chat File Management / Checkpoints：https://docs.sillytavern.app/usage/core-concepts/chatfilemanagement/
