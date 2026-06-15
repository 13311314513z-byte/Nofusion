# 声音画像集成实现路径 & 横向 Agent 扩展阶段回顾

> 撰写时间：2026-06-15
> 依据：P1 修复清单 + 0615 工作区审计报告 + 全量代码盘点

---

## 一、声音画像当前状态

### 1.1 已完成的层

| 层 | 文件 | 状态 |
|----|------|:----:|
| **模型定义** | `models/voice-profile.ts` | ✅ 完整，含 `VoiceProfile` / `VoiceProfileIndex` 及 Zod Schema |
| **Agent 核心** | `agents/voice-profile-analyzer.ts` | ✅ 完整，继承 `BaseAgent`，含 `analyze()` 方法、prompt 构造、LLM 调用流程 |
| **Core 导出** | `index.ts` line 585-587 | ✅ 已导出 `VoiceProfileAnalyzer` / `AnalyzeVoiceInput` / 类型 |
| **Studio 端点** | `server.ts:7077` `POST /api/v1/books/:id/voice-profiles/analyze` | ⚠️ **桩实现**：固定返回 `avgSentenceLength: 0`、`confidence: 0.3`、空口头禅 |
| **前端入口** | 无 | ❌ 无调用方 |

### 1.2 桩实现当前代码

```typescript
// server.ts:7077 — 当前状态
app.post("/api/v1/books/:id/voice-profiles/analyze", async (c) => {
  // 不调用 VoiceProfileAnalyzer
  // 不读取角色卡对话正文
  // 不持久化到 story/voice_profiles/
  const profile = {
    avgSentenceLength: 0,
    confidence: 0.3,
    signaturePhrases: [],
    // ...
  };
  return c.json({ profile });
});
```

---

## 二、集成实现路径（三步走）

### Step 1：端点接桩 → 真实调用（P1 核心）

```
POST /api/v1/books/:id/voice-profiles/analyze?character=<roleId>
```

#### 需要注入的依赖

VoiceProfileAnalyzer 继承 BaseAgent，需要：
1. **LLM client** — 项目级 model/config
2. **角色对话正文** — 从角色卡 `body` + 已写章节中提取该角色的对话/行动段落

#### 实现方案

```typescript
// server.ts 修改点
import { VoiceProfileAnalyzer } from "@actalk/inkos-core";
import { loadRoleCard } from "@actalk/inkos-core";
// 从项目配置获取 LLM client（复用现有的 resolveLLMClient 逻辑）

app.post("/api/v1/books/:id/voice-profiles/analyze", async (c) => {
  const bookId = c.req.param("id");
  const characterId = c.req.query("character");

  // 1. 加载角色卡
  const bookDir = state.bookDir(bookId);
  const roleCard = await loadRoleCard(bookDir, characterId);

  // 2. 收集角色对话样本（角色卡 body + 章节中该角色的台词）
  const dialogueSamples = await collectCharacterDialogue(bookDir, characterId);

  // 3. 获取项目 LLM 配置并按 agent 路由
  const projectConfig = await loadProjectConfig(root);
  const llmClient = resolveAgentLLMClient(projectConfig, "voice-profile");

  // 4. 实例化并调用真实 Analyzer
  const analyzer = new VoiceProfileAnalyzer({ client: llmClient });
  const profile = await analyzer.analyze({
    characterId,
    characterName: roleCard.frontmatter.name,
    dialogueSamples,
    roleDescription: roleCard.body,
  });

  // 5. 持久化到 story/voice_profiles/<characterId>.json
  await saveVoiceProfile(bookDir, profile);

  return c.json({ profile });
});
```

#### 关键函数：`collectCharacterDialogue`

```typescript
// 从已写章节中提取特定角色的对话和行动叙事
async function collectCharacterDialogue(
  bookDir: string,
  characterId: string,
): Promise<string[]> {
  const chapters = await listChapterFiles(bookDir);
  const samples: string[] = [];
  const MAX_SAMPLES = 20; // 上限避免 prompt 过长

  for (const chapter of chapters.slice(-5)) {
    // 只取最近 5 章，平衡新鲜度和样本量
    const content = await readChapterContent(bookDir, chapter);
    const roleLines = extractCharacterUtterances(content, characterId);
    samples.push(...roleLines);
    if (samples.length >= MAX_SAMPLES) break;
  }

  return samples;
}
```

### Step 2：持久化 + 索引（P1 扩展）

分析完成后需落盘：

```
books/<bookId>/story/voice_profiles/
├── index.json            ← VoiceProfileIndex，记录所有已分析角色
├── <characterId>.json    ← 单个 VoiceProfile
```

支持增量更新：章节新增后 re-analyze 只看新增对话。

### Step 3：管线消费（R1-R2 路线图）

声音画像进入 Writer 和 Auditor：

| 消费点 | 方式 | 预期效果 |
|--------|------|----------|
| **Writer prompt** | 注入精简规则：句长偏好、口头禅、称呼习惯 | 角色对话风格一致 |
| **Auditor dim** | 新增"角色声音偏移"检查维度 | 自动检测 OOC 对话 |
| **续写/同人** | 加载既有声音画像，约束生成 | 确保续写角色不"变声" |

---

## 三、横向 Agent 扩展迄今成绩

### 3.1 Agent 演进时间线

```
v0.5 (英文首发)  v1.0 (Studio)     v1.4 (0615 合并)
    │               │                  │
    ▼               ▼                  ▼
  10 Agent  → 基座成熟期  →  47 Agent（含 E1-E13）
```

### 3.2 各阶段 Agent 增量

| 阶段 | 新增 Agent | 核心价值 |
|------|-----------|----------|
| **基座期** (v0.3-v0.5) | Writer, Auditor, Reviser, Architect, Settler, Composer | 建立"写→审→修→记"核心闭环 |
| **扩展期** (v0.6-v1.3) | Planner, Normalizer, Observer, Reflector, Hook 治理, StateValidator, BetaReader, StyleAnalyzer, Interviewer | 长篇治理（Hook/长度/状态）、质量诊断、作者介入 |
| **横向期** (E1-E13, 0615) | EventChainExtractor, EventChainInference, VoiceProfileAnalyzer, SceneTemplate, PlanVariants, Distillation | 叙事分析、角色深度、创意发散 |

### 3.3 横向扩展的成绩评估

#### ✅ 成功的扩展

| Agent | 评判 | 原因 |
|-------|:----:|------|
| **Interviewer** | 成功 | 有真实前端面板，产生章节意图，进入 Planner 上下文 → 完整闭环 |
| **ChapterIntents** | 成功 | 从意图→计划→正文→核验形成可追踪链路 |
| **BetaReader** | 接近成功 | Shadow 模式积累校准数据，模型约束已有架构 |
| **StyleAnalyzer / Fingerprint** | 成功 | 统计指纹 → Writer prompt 注入，有可测量的风格偏移检测 |
| **Hook 治理体系** (4 Agent) | 成功 | Hook 从"只加不收"到有推进/回收/预算/仲裁的完整生命周期 |

#### ⚠️ 半成功的扩展

| Agent | 评判 | 原因 |
|-------|:----:|------|
| **EventChainExtractor / Inference** | 半成功 | Agent 已实现但端点用假数据，不进章节正文消费 |
| **VoiceProfileAnalyzer** | 半成功 | Core 已实现但端点桩，无持久化，不进管线 |
| **PlanVariants** | 半成功 | 代码中存在 `generateAlternatives` 参数，但 Runner 不传、前端无选 |
| **SceneTemplate** | 半成功 | 仅 GET/PUT JSON 存储，无 Schema 校验、无 Planner/Writer 消费 |

#### ❌ 未闭环的扩展

| Agent | 评判 | 原因 |
|-------|:----:|------|
| **Distillation** | 未闭环 | 页面类型契约错误、无路由、无生成/修改/发布/版本管理 |

### 3.4 横向扩展的边际收益分析

```
Agent 数量增长 vs 产品闭环比例

  47 Agents ──┐
              │
  35 Agents ──┤  ← 基座期+扩展期（85% 闭环）
              │
  12 Agents ──┘  ← E1-E13 横向期（~33% 闭环）
```

**结论**：Agent 数量从 35 到 47 的增量中，只有约 1/3 形成了有效的产品闭环。这是合理的——原型探索必然有损耗率，但后续需要收敛。

### 3.5 横向扩展的核心方法论得失

#### 做得好的

1. **Shadow 模式先行**（BetaReader）— 不阻塞主流程，先积累证据再升级
2. **文件即数据库**（RoleCard, VoiceProfile JSON）— 没有引入新的持久化层
3. **模型与端点分离**（所有新 Agent 都先定义 Schema）— 契约清晰

#### 需要改进的

1. **"完成"标准不统一** — 模型/Agent/端点三件套齐全 ≠ 功能可用
2. **前端滞后** — 8 个新端点中有 5 个前端无入口
3. **管线消费缺失** — 数据产出后不被 Planner/Writer/Auditor 消费
4. **桩实现蔓延** — 声音画像、事件链端点都是假数据，但标记为"已完成"

---

## 四、声音画像集成与整体优先级的关系

### 当前阶段判断

声音画像属于 R2（叙事状态与质量闭环）而非 R0（恢复可发布）或 R1（意图闭环）。建议优先级：

```
R0（已完成）→ R1（进行中）→ 声音画像（R2，1-2 周后启动）
```

### R1 完成后的声音画像启动条件

| 条件 | 状态 |
|------|:----:|
| 章节驾驶舱存在 | 可获角色对话样本 |
| LLM 上下文管道统一 | 端点可获取正确 client |
| 角色卡系统稳定 | 有明确角色 ID 和正文 |
| Writer 提示注入框架成熟 | 声音画像规则可注入 prompt |

### 可并行的准备工作

即使 R1 未完成，以下工作可提前：

1. ✅ 修复端点桩实现 → 调用真实 Analyzer
2. ✅ 实现 `collectCharacterDialogue` 工具函数
3. ⬜ 建立 `story/voice_profiles/` 持久化
4. ⬜ 前端入口（可复用 CharacterSection 的展开面板）

---

## 五、横向 Agent 扩展的后续策略

### 5.1 冻结期建议

```
当前阶段 → 不新增 Agent（至少 2 周）
         → 专注闭环现有 12 个未闭环 Agent
         → 完成后评估：是否真的需要更多 Agent？
```

### 5.2 闭环优先级排序

| 排序 | Agent | 闭环后价值 | 工作量 | 建议 |
|:----:|-------|:--------:|:------:|------|
| 1 | EventChain | 叙事可追溯 | 较大 | 端点对接真实解析器 |
| 2 | VoiceProfile | 角色一致 | 中 | Step 1-2 |
| 3 | PlanVariants | 创意发散 | 中 | Runner 传参 + 前端选 |
| 4 | SceneTemplate | 结构化约束 | 小 | Schema + 前端编辑器 |
| 5 | Distillation | 风格复用 | 小 | 并入 StyleManager |

### 5.3 未来新增 Agent 的三道门禁

```
新增提案 → [1] 是否解决从用户反馈中确认的痛点？
                ↓ 是
         [2] 能否使用 Shadow 模式先积累 30+ 次运行证据？
                ↓ 是
         [3] 是否与现有 Agent 有明确的输入/输出分离？
                ↓ 是
            准予开发
```

---

## 六、总结

| 维度 | 判断 |
|------|------|
| **声音画像集成** | 分三步：端点接桩(1-2h) → 持久化+索引(2h) → 管线消费(R2) |
| **当前最适启动时机** | R1（意图闭环）完成后，预计 1-2 周 |
| **横向 Agent 总成绩** | 47 Agent 中 ~85% 闭环。E1-E13 新增的 12 个中仅 ~33% 闭环，需收敛 |
| **后续策略** | 冻结横向扩展 2 周，优先闭环 EventChain/VoiceProfile/PlanVariants |
| **核心教训** | "模型+端点+Agent"三件套 ≠ 功能完成。需要"前端可达→管线消费→结果可验证"才算闭环 |
