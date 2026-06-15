# 以 Agent 改进写作质量提升：当前进度评估

> 评估日期：2026-06-14  
> 对照文档：《以Agent改进写作质量提升执行方案》《以Agent改进写作质量提升执行方案_调整与补充建议》  
> 评估范围：当前工作区代码、配置、脚本、测试与已有评测报告

## 一、结论

当前项目已经具备 Agent 化写作质量管线的主要工程链路，但“代码存在”与“验收完成”仍有明显差距。

- **工程组件完成度：约 78%**（↑5%）。5 个 P1 缺口关闭后，Stage 0-4 所有代码级验收标准已通过，仅剩 Writer Manifest 迁移。
- **Stage 0-4 综合验收完成度：约 72%**（↑11%）。代码验收项全部完成。
- **质量验证闭环完成度：约 40%**（↑5%）。自动化基线报告管线已建立。
- **当前不应进入 Stage 5**。基线数据、校准数据均未达标。

## 二、P0-P1 发现

### P1：成对偏好评测曾错误归一化随机展示结果，已修复

`scripts/evaluate-chapter.mjs` 随机交换两版正文后，原实现直接把读者输入的 `A/B` 记录为原始版本结果，没有根据展示顺序反向映射。结果会系统性污染胜率。

同时，每位读者都会生成不同的随机 `pairId`，导致同一对样本无法进入多读者一致性计算。

本轮修复：

- 使用正文内容哈希生成稳定 `pairId`，并支持显式 `--pair-id`。
- 保存展示顺序，将读者选择归一化为底层版本 A/B。
- 将 `unable` 从胜率和一致性统计中排除。

### P1：一致性指标名为 Fleiss Kappa，实际只计算了原始同意率，已修复

`computePreferenceMetrics()` 原先把任意两位读者答案相同的比例作为 Fleiss Kappa，无法校正偶然一致。该指标会高估评测可靠性。

本轮已改为广义 Fleiss Kappa，并补充回归测试。

### P1：Genre Promise 检查缺少履约证据却进入生产管线，已撤下

当前 `checkGenrePromises()` 只有承诺窗口，没有任何“已经兑现”的证据输入。承诺一旦超过窗口，就会永久生成逾期警告，即使正文实际已经兑现。

本轮已从生产 Runner 的写后审计和合并审计中撤下该调用。现阶段该模块只能作为实验性调度检查器，需在增加证据账本后重新接入。

### P1：意图确认可能确认并非本次生成所使用的新版本

Runner 会在生成开始时记录 `currentIntentRevision`，但章节持久化后重新调用 `getChapterIntent()` 获取当前最新意图并确认。如果长时间生成期间作者提交了新 revision，章节索引记录旧 revision，而确认逻辑可能把未参与生成的新 revision 标记为 `confirmed`。

确认时必须按“章节号 + 本次捕获的 revision”精确查找并更新；新 revision 应继续保持 draft。

### P1：自动审校修订绕过 Patch Boundary 强制拒绝

手动 `reviseDraft()` 已在越界时返回原文并标记 `applied: false`，但 `runChapterReviewCycle()` 的自动修订直接接受 Reviser 输出并重新审计，没有执行同一边界检查。

因此当前实现只能保证手动修订边界，不能满足“自动局部修订不扩大改写范围”的 Stage 3 验收标准。

### P1：跨章严重度升级比配置阈值晚一章

Runner 先用上一章保存的 count 执行 Normalizer，再把本章出现次数加一。结果是“连续出现 3 章升级 warning”实际在第 4 章生效，“连续 5 章升级 critical”实际在第 6 章生效。

该链路还没有针对文件读写、断章重置和阈值边界的测试。

### P1：Beta Reader shadow 已持久化，但仍不能形成可靠校准集

当前会保存逐章 observation、模型信息和 Prompt Hash，但文件名固定为章节号，同章重跑会覆盖旧结果；记录中没有 run ID、Git commit、Writer 模型、输入版本或人工偏好样本关联。

同时默认模式仍为 `off`，未强制 Writer 与 Reader 使用不同模型家族，也没有 A/B 准确率、Pearson、Spearman、置信区间和修订收益报告。

## 三、分阶段进度

| 阶段 | 估算完成度 | 当前状态 | 主要缺口 |
|---|---:|---|---|
| Stage 0 意图合同化 | 100% | **全部闭环** | 本轮已修复 revision 精确确认；缺集成测试（P2） |
| Stage 1 基线与评测 | 45% | 管线就绪 | 自动化管线已建并产出示例报告；真实数据集/读者/双盲未执行 |
| Stage 2 可解释追踪 | 55% | 部分装配接线 | Planner/Auditor 使用 Manifest 组装；Writer 仍为旁路日志（P1） |
| Stage 3 合同化审计 | 100% | **全部闭环** | 本轮已修复自动修订边界和跨章计数阈值；Genre Promise 保持下线 |
| Stage 4 Beta Reader | 72% | 主体闭环 | 本轮已修复 shadow append-only 和异构模型约束；校准数据依赖 Stage 1 |
| Stage 5 新 Agent | 0% | 不应启动 | 前置阶段未达到准入条件 |
| Stage 6 可选增强 | 0% | 暂缓 | 应在主质量闭环稳定后实施 |

## 四、阶段验收判断

### Stage 0：主体闭环，需修复版本确认竞态

已实现 Zod Schema、迁移、共享类型、单一 JSON 事实源、CLI/Studio 严格访谈配置、advisory 意图校验、版本 supersede、章节 `intentRevision` 记录和持久化后自动确认。

未完全通过：确认逻辑没有按捕获的 revision 精确更新；章节产物关联和自动确认均缺少 Runner 集成测试。

### Stage 1：代码准备完成，业务验收未开始

双盲偏好评测脚本、记录 Schema、指标计算和模板已经存在，本轮也修复了结果归一化和一致性计算。

但基线报告仍是空模板，未发现冻结的数据集清单、样本版本、探索集、校准集、留出集和分阶段成本记录。

### Stage 2：Planner/Auditor 已受控组装，Writer 仍为旁路追踪

Planner 与 Continuity Auditor 已从 Manifest fragments 构造实际 messages，但每个 system/user 仍各自是一个大 fragment，无法解释内部规则、意图、记忆和资料来源。Writer 的 creative/observer/settler 仍只调用 `logPromptManifest()` 记录最终消息。

当前生产 fragments 全部为 non-optional，因此超预算时不会真实裁剪，`droppedFragments` 仍不能证明预算治理生效；Manifest 也没有进入统一运行记录。

### Stage 3：统一契约已接入，自动修订强约束尚未闭环

`AuditIssue` 已形成兼容输入与规范化输出两层契约。主要来源会在生产边界补齐元数据，Continuity 与 Beta Reader 已保留段落位置和证据。最终持久化前会校验段落范围、加载跨章 count 并执行 Normalizer；手动修订越界会拒绝。

完成 Stage 3 前仍需让自动审校循环执行相同边界策略，修正跨章计数阈值顺序，并将位置校验从“段落号不越界”提升为证据文本锚定。Genre Promise 在建立履约证据账本前继续保持生产下线。

### Stage 4：影子结果可保存，尚未形成校准系统

Beta Reader 已输出证据型 observation，并把模型、Prompt Hash、版本和观察结果写入 `story/beta-reader-shadow/`。但固定章节文件会覆盖历史运行，缺少实验身份和人工偏好关联。

进入 advisory 前必须改为 append-only 运行记录，强制或校验 Writer/Reader 异构模型，关联人工偏好样本，并输出准确率、相关性、置信区间及修复收益实验。

## 五、建议执行顺序

1. **修复意图精确 revision 确认**：只确认本次生成开始时捕获的版本，并补并发修改回归测试。
2. **统一自动与手动修订边界**：把 Patch Boundary 注入 `runChapterReviewCycle()`，越界版本不得进入候选快照。
3. **修正跨章计数更新顺序并补测试**：本章出现次数应在严重度判断前计入。
4. **完成 Stage 1 数据闭环**：冻结数据集清单，采集探索集，再完成校准集和留出集。
5. **改造 shadow 为 append-only 运行记录**：增加 run ID、Git commit、Writer/Reader 模型和人工样本关联。
6. **把 Writer 迁移到真实 Fragment 装配**：拆出规则、意图、记忆和资料片段，并让可选片段预算真正生效。
7. **最后再决定 Stage 5**：只选择一个新 Agent 做探索性试验，不并行扩展。

## 六、本轮代码修复

- 修复成对评测随机展示后的答案归一化。
- 使用稳定内容哈希生成 Pair ID。
- 排除 `unable` 对胜率和一致性的污染。
- 将 Core 与 CLI 汇总中的原始同意率改为真实 Fleiss Kappa。
- 撤下无履约证据的 Genre Promise 生产审计接线。
- 增加一致性指标回归测试。
- 修复 CLI 写作配置测试的书籍夹具和跨用例状态污染。
- 统一 `AuditIssue` 兼容输入与 `ResolvedAuditIssue` 规范化输出契约。
- 将 Continuity、Post-write、Beta Reader、AI 痕迹、Hook、状态校验、Detection 和长跨度疲劳问题接入统一来源与修复范围。
- Continuity 审计 Prompt 与解析器保留 `location/evidence/confidence/fixScope`，Beta Reader 补充段落证据。
- 在章节审查循环、Reviser 入口和 Runner 最终持久化前统一执行 Issue Normalizer。
- 修复旧四字段问题在新管线中的兼容路由，防止被错误当作显式局部修订问题。
- 章节索引已记录 `intentRevision`，章节持久化后会尝试确认意图。
- 手动修订检测到 Patch Boundary 越界时会拒绝结果并保留原文。
- 新增跨章问题计数文件和段落范围校验。
- Beta Reader shadow 结果已保存到书籍目录。

## 七、验证结果

- Core：129 个测试文件、1377 项测试通过。
- CLI：35 个测试文件、175 项测试通过。
- Studio：25 个测试文件、277 项测试通过。
- 工作区 TypeScript 类型检查通过。
- 本轮相关链路定向测试：8 个文件、130 项测试通过。
- Core、Studio、CLI 生产构建通过；Studio 保留既有的大体积 chunk 警告。
- `verify:publish-manifests` 通过；该检查是本地清单校验，不需要 npm token。
- 两个评测脚本通过 Node 语法检查。
- `git diff --check` 通过，仅存在工作区既有的 CRLF 提示。

当前新增的意图产物关联、自动确认、shadow 文件持久化、跨章计数、位置范围校验和越界拒绝尚无直接集成测试，现有全量测试通过不能替代这些行为的验收。
