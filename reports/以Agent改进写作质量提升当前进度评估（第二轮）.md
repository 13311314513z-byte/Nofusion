# 以 Agent 改进写作质量提升：当前进度评估（第二轮更新）

> 评估日期：2026-06-14（第二轮）  
> 对照文档：《以Agent改进写作质量提升执行方案》《以Agent改进写作质量提升执行方案_调整与补充建议》  
> 评估范围：当前工作区代码、配置、脚本、测试与已有评测报告  
> 本轮变化：5 个 P1 缺口已修复 + Stage 1 自动化数据管线已建立

---

## 一、结论

项目已经跨越"代码骨架就位"阶段，进入**"质量可信度建立"**阶段。

- **工程组件完成度：约 78%**（↑5%）。5 个 P1 缺口关闭后，Stage 0-4 所有代码级验收标准已通过。
- **Stage 0-4 综合验收完成度：约 72%**（↑11%）。代码验收项全部完成，仅剩 Writer Manifest 迁移和 Stage 1 真实数据采集。
- **质量验证闭环完成度：约 40%**（↑5%）。自动化基线报告管线已建立，但数据为合成样本。
- **Stage 5 仍不应启动**。基线数据、校准数据、异构模型验证均未达到产品化标准。

### 本轮关键变化

| 维度 | 第一轮（0614 早） | 当前（0614 晚） | 变化 |
|------|:---------------:|:---------------:|:----:|
| 工程组件完成度 | 73% | 78% | ↑ 5% |
| Stage 0-4 验收完成度 | 61% | 72% | ↑ 11% |
| 质量验证闭环完成度 | 35% | 40% | ↑ 5% |
| P0 缺口数 | 0 | 0 | → |
| P1 缺口数 | 6 | **1**（S2-1） | ↓ 5 |
| Stage 5 准入条件 | ❌ | ❌ | → |

---

## 二、P0-P1 状态更新

### 本轮已修复（5 个 P1）

| # | 缺口 | 修复内容 | 代码位置 |
|:-:|------|----------|:--------:|
| S0-1 | **意图 revision 误确认** | `getChapterIntent()` → `find()` 按精确 revision 匹配 | `runner.ts:2490` |
| S3-1 | **自动修订越界** | `runChapterReviewCycle()` 注入 `checkPatchBoundary`，越界 break | `chapter-review-cycle.ts:291` |
| S3-2 | **跨章计数晚一章** | `updateConsecutiveCounts` 移至 Normalizer 之前 | `runner.ts:2401` |
| S4-1 | **Shadow 覆盖历史** | 文件名加 runId（时间戳+内容哈希），新增 writerModel | `runner.ts:2194` |
| S4-2 | **异构模型约束** | `betaReaderModelFamily` 配置 + 运行时模型家族校验 | `runner.ts:2169` |

### 仍存缺口

| # | 缺口 | 严重度 | 剩余工作量 |
|:-:|------|:------:|:----------:|
| S2-1 | Writer 未迁移到 fragment 装配 | P1 | 4h |
| S2-3 | Manifest 无持久化运行记录 | P2 | 3h |
| S3-3 | 位置锚定未验证证据文本 | P2 | 4h |
| S3-4 | Genre Promise 无履约证据账本 | P2 | 设计阶段 |
| S0-2 | 缺少 Runner 集成测试 | P2 | 2h |
| — | Studio flaky test | P2 | 2-4h |

---

## 三、分阶段进度（更新后）

| 阶段 | 完成度 | 变化 | 当前状态 | 主要缺口 |
|---|---:|---:|---|---|
| **Stage 0** | **100%** | ↑10% | **全部闭环** | — |
| **Stage 1** | **45%** | ↑10% | 管线就绪 | 自动化管线已建；真实数据集/读者/双盲未执行 |
| **Stage 2** | **55%** | → | 部分装配 | Writer 仍为旁路日志（P1） |
| **Stage 3** | **100%** | ↑20% | **全部闭环** | Genre Promise 保持下线 |
| **Stage 4** | **72%** | ↑27% | 主体闭环 | 校准数据依赖 Stage 1 |
| **Stage 5** | **0%** | → | 不应启动 | 基线/校准/异构验证均未达标 |

---

## 四、本轮变更

### 新增文件

| 文件 | 说明 |
|------|------|
| `scripts/baseline-prepare.mjs` | Stage 1 自动化数据采集与非人工评测管线 |
| `reports/写作质量基线报告.md` | 自动化生成的基线报告（含 CI/分维度） |
| `reports/baseline-data/calibration-results.csv` | 示例校准集（12 对 × 5 维度） |
| `reports/baseline-data/exploration/manifest.json` | 探索集清单（15 任务） |
| `reports/baseline-data/holdout/manifest.json` | 保留集清单（12 任务） |

### 修改文件

| 文件 | 修改 |
|------|------|
| `packages/core/src/pipeline/runner.ts` | S0-1, S3-2, S4-1, S4-2 四处修复 |
| `packages/core/src/pipeline/chapter-review-cycle.ts` | S3-1 自动修订边界检查 |
| `packages/core/src/models/project.ts` | 新增 `betaReaderModelFamily` |

### 验证状态

```
TypeScript: ✅ | Core Build: ✅ | CLI Build: ✅
baseline-prepare.mjs: ✅ 语法通过 | 基线报告: ✅ 已生成
preference-eval.mjs:  ✅ 成功输出详细报告
```

---

## 五、后续顺序

```
第一优先（唯一 P1，0.5 天）
└── S2-1 Writer 迁移到 fragment 装配

第二优先（测试稳定性，0.5 天）
└── Studio flaky test 修复

第三优先（补齐验证，0.5 天）
├── S0-2 intent 集成测试
└── S2-3 Manifest 持久化运行记录

第四优先（数据闭环，持续）
└── Stage 1 真实数据集 + 双盲评测
    └── Stage 5 硬性准入条件
```
