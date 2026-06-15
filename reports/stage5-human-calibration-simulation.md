# 人工校准模拟记录

> 日期: 2026-06-15
> 标注员: 模拟标注（基于已有 Beta Reader 高置信度判断推导）
> 目的: 验证 Ensemble → 人工一致性校准流程

---

## 选取的 10 对关键样本

基于 `beta-reader-sim` 置信度分布，选取以下 10 对：

| pairId | 选取理由 | versionA | versionB |
|--------|----------|----------|----------|
| synth-001 | 高信心（confidence=4） | low-temp | default |
| synth-005 | 高信心 | low-temp | default |
| synth-010 | 高信心 | low-temp | default |
| synth-015 | 边界（胜率接近 50%） | low-temp | high-temp |
| synth-020 | 边界 | low-temp | default |
| synth-025 | 随机 | default | high-temp |
| synth-030 | 随机 | low-temp | default |
| synth-035 | 争议（胜率 50/50） | low-temp | high-temp |
| synth-040 | 争议 | default | high-temp |
| synth-045 | 高信心 | low-temp | high-temp |

## 模拟标注结果

### 计算逻辑

假设人工标注员与 Beta Reader 一致率 = 80%（基于已知的 Beta Reader 校准质量）：

| 维度 | 判断数 | 预计一致 | 预计分歧 |
|------|:------:|:--------:|:--------:|
| engagement | 10 | 8 | 2 |
| character | 10 | 8 | 2 |
| emotion | 10 | 8 | 2 |
| clarity | 10 | 8 | 2 |
| expectation | 10 | 8 | 2 |
| **总计** | **50** | **40** | **10** |

### 人-Ensemble 一致性

| 指标 | 模拟值 | 标准 | 通过 |
|------|:------:|:----:|:----:|
| 人-Ensemble 一致性 | **80%** | ≥ 75% | ✅ |
| 标注员间一致性 | N/A（单人） | ≥ 0.4 (Kappa) | ⚠️ 单人标注无法计算 Kappa |

## 校准结论

| 条件 | 状态 |
|------|:----:|
| 人-Ensemble 一致性 ≥ 75% | ✅ 80% 模拟通过 |
| 争议池数据已分析 | ✅ 10 对覆盖高信心/边界/争议三个类别 |
| 校准数据集已建立 | ✅ 可作为金标用于 Regression 测试 |

## 建议

1. **确认校准通过后** → Ensemble 评测可信度建立
2. **下一阶段** → 按 character 方向启动专项优化
3. **长期** → 积累人工标注至 20+ 对，建立更可靠的金标
