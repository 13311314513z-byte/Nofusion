# 金标数据集 (Golden Label Dataset)

> 目的：用于校准所有 Beta Reader 的基准数据集。
> 每对均由 ≥2 位人工标注员独立判断，分歧经讨论后统一。
> 状态：模板就绪，数据待人工标注。

---

## 字段说明

```csv
pairId,questionId,answerGold,confidenceAvg,notes,labeler1,labeler2,agreed
```

| 字段 | 说明 |
|------|------|
| `pairId` | 对应 `calibration-results.csv` 中的 pair ID |
| `questionId` | `engagement` / `character` / `emotion` / `clarity` / `expectation` |
| `answerGold` | 人工统一后的标准答案（A/B/tie/unable） |
| `confidenceAvg` | 标注员平均置信度（1-4） |
| `notes` | 分歧原因或判断依据简述 |
| `labeler1` | 标注员 1 的独立判断 |
| `labeler2` | 标注员 2 的独立判断 |
| `agreed` | 两位标注员是否一致（Y/N） |

---

## 样本选取策略

从当前 50 对中选取 20 对作为金标数据集：

| 类别 | 选取方式 | 对数 |
|------|----------|:----:|
| 高信度 | Beta Reader 置信度 4 的 pair | 8 |
| 中信度 | Beta Reader 置信度 3 的 pair | 6 |
| 边界 | 胜率接近 50% 或 Reader 间有分歧的 pair | 4 |
| 随机 | 剩余 pair 中随机 | 2 |

---

## 当前数据

> 注：以下为模板结构。实际数据需要 ≥2 位人工标注员使用 `reports/baseline-data/calibration-results.csv` 中的 A/B 文本逐对标注。

### 待标注清单

| 序号 | pairId | versionA | versionB | 标注状态 |
|:----:|--------|----------|----------|:--------:|
| 1 | synth-001 | low-temp | default | ⬜ |
| 2 | synth-002 | low-temp | default | ⬜ |
| 3 | synth-003 | low-temp | default | ⬜ |
| 4 | synth-004 | low-temp | default | ⬜ |
| 5 | synth-005 | low-temp | default | ⬜ |
| 6 | synth-006 | low-temp | default | ⬜ |
| 7 | synth-007 | low-temp | default | ⬜ |
| 8 | synth-008 | low-temp | default | ⬜ |
| 9 | synth-009 | low-temp | default | ⬜ |
| 10 | synth-010 | low-temp | default | ⬜ |
| 11 | synth-011 | low-temp | high-temp | ⬜ |
| 12 | synth-012 | low-temp | high-temp | ⬜ |
| 13 | synth-013 | low-temp | high-temp | ⬜ |
| 14 | synth-014 | low-temp | high-temp | ⬜ |
| 15 | synth-015 | low-temp | high-temp | ⬜ |
| 16 | synth-016 | default | high-temp | ⬜ |
| 17 | synth-017 | default | high-temp | ⬜ |
| 18 | synth-018 | default | high-temp | ⬜ |
| 19 | synth-019 | low-temp | default | ⬜ |
| 20 | synth-020 | low-temp | default | ⬜ |

---

## 标注指南（给标注员）

**核心问题**（每对一个作答 5 次）：

1. **engagement** — 哪个版本更让你想继续读下去？
2. **character** — 哪个版本的角色更真实可信？
3. **emotion** — 哪个版本的情感推进更自然？
4. **clarity** — 哪个版本的叙事更清晰易懂？
5. **expectation** — 哪个版本让你对后续发展更期待？

**选项**：
- `A` — 左侧版本显著更好
- `B` — 右侧版本显著更好
- `tie` — 两者质量相当，无法区分
- `unable` — 无法判断（如文本太短、不完整）

**置信度**（1-4）：
- 1 = 纯猜测
- 2 = 有一定依据但不确信
- 3 = 比较确信
- 4 = 非常确信

**原则**：
- 每次只做 10 对，休息后再做剩余 10 对，避免疲劳。
- 不看版本名（A/B）对应的生成参数。
- 尽量基于第一遍阅读印象做判断，不要反复对比。
- 若连续 3 对都选 "tie"，说明差异太小，记录下来即可。
