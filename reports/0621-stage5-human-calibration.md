# Stage 5 人工校准报告

> 生成日期: 2026-06-21T11:34:07.805Z
> 人工标注: `C:\Users\white\Downloads\Nofusion-main\reports\baseline-data\human-labels-template.csv`
> Ensemble 数据: `C:\Users\white\Downloads\Nofusion-main\reports\baseline-data\calibration-results-ensemble.csv`

## 校准结果

| 指标 | 数值 |
|------|:----:|
| 配对判断数 | 45 |
| 一致数 | 16 |
| 分歧数 | 29 |
| **人-Ensemble 一致性** | **35.6%** |
| 通过阈值（≥ 75%） | ❌ 未通过 |

## 分维度一致性

| 维度 | 一致 | 总数 | 一致性 |
|------|:----:|:----:|:------:|
| engagement | 5 | 9 | 55.6% |
| character | 4 | 9 | 44.4% |
| emotion | 1 | 9 | 11.1% |
| clarity | 3 | 9 | 33.3% |
| expectation | 3 | 9 | 33.3% |

## 结论

❌ **校准未通过** — 请调整 Reader prompt 或更换模型后重新评测。

## 分歧分析

共 29 条分歧，建议检查：
- 是否为边界 pair（胜率接近 50%）
- 是否为特定维度系统性分歧
- 人工标注员是否需要进一步培训
