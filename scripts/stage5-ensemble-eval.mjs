/**
 * Stage 5 Ensemble Evaluation
 *
 * Reads calibration-results.csv (which contains judgments from multiple readers),
 * computes cross-reader agreement, controversy pool ratio, dimension-wise weaknesses,
 * and produces a Stage 5 readiness report.
 *
 * Usage:
 *   node scripts/stage5-ensemble-eval.mjs
 *     [--csv=reports/baseline-data/calibration-results.csv]
 *     [--output=reports/stage5-ensemble-report.md]
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Detect project root independently of process.cwd()
const __dirname = new URL(".", import.meta.url).pathname;
const PROJECT_ROOT = resolve(__dirname, "..");

const DEFAULT_CSV = "reports/baseline-data/calibration-results.csv";
const DEFAULT_OUTPUT = "reports/stage5-ensemble-report.md";

const DIMENSIONS = ["engagement", "character", "emotion", "clarity", "expectation"];

function parseArgs() {
  const args = process.argv.slice(2);
  let csv = DEFAULT_CSV;
  let output = DEFAULT_OUTPUT;
  for (const arg of args) {
    if (arg.startsWith("--csv=")) csv = arg.slice(6);
    if (arg.startsWith("--output=")) output = arg.slice(9);
  }
  return { csv, output };
}

function parseCSV(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const vals = line.split(",");
    const record = {};
    headers.forEach((h, i) => { record[h.trim()] = (vals[i] ?? "").trim(); });
    return record;
  });
}

/**
 * Group records by pairId + questionId to find multiple readers' opinions.
 */
function groupByPairAndQuestion(records) {
  const groups = {};
  for (const r of records) {
    const key = `${r.pairId}::${r.questionId}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }
  return groups;
}

function main() {
  const { csv, output } = parseArgs();
  const csvPath = resolve(PROJECT_ROOT, csv);
  const outputPath = resolve(PROJECT_ROOT, output);

  const raw = readFile(csvPath, "utf-8");
  raw.then((text) => {
    const records = parseCSV(text);
    console.log(`读取: ${csvPath}`);
    console.log(`总记录数: ${records.length}`);

    // Determine unique readers and variants
    const readers = [...new Set(records.map((r) => r.readerId).filter(Boolean))];
    const pairs = [...new Set(records.map((r) => r.pairId))];
    const versions = [...new Set(records.flatMap((r) => [r.versionA, r.versionB]).filter(Boolean))];

    console.log(`Reader 数: ${readers.length}`);
    console.log(`Pair 数: ${pairs.length}`);
    console.log(`版本变体: ${versions.join(", ")}`);

    // --- Cross-reader agreement ---
    const groups = groupByPairAndQuestion(records);
    const totalGroups = Object.keys(groups).length;
    let unanimous = 0; // all readers agree
    let majority = 0;  // ≥2/3 agree
    let split = 0;     // no majority

    for (const [key, judgments] of Object.entries(groups)) {
      const answers = judgments.map((j) => j.answer).filter((a) => a !== "unable");
      if (answers.length < 2) { split++; continue; }

      const counts = {};
      for (const a of answers) counts[a] = (counts[a] ?? 0) + 1;
      const maxCount = Math.max(...Object.values(counts));

      if (maxCount === answers.length) {
        unanimous++;
      } else if (maxCount >= Math.ceil(answers.length / 2)) {
        majority++;
      } else {
        split++;
      }
    }

    const agreementRate = ((unanimous + majority) / totalGroups * 100).toFixed(1);
    const controversyRate = (split / totalGroups * 100).toFixed(1);

    console.log(`\n--- Ensemble 一致性 ---`);
    console.log(`一致 (全同): ${unanimous}/${totalGroups}`);
    console.log(`多数一致: ${majority}/${totalGroups}`);
    console.log(`分歧 (无多数): ${split}/${totalGroups}`);
    console.log(`总一致率: ${agreementRate}%`);
    console.log(`争议池比例: ${controversyRate}%`);

    // --- Per-dimension weakness analysis ---
    console.log(`\n--- 维度弱项分析 ---`);
    const dimResults = {};
    for (const dim of DIMENSIONS) {
      const dimRecords = records.filter((r) => r.questionId === dim && r.answer !== "unable");
      const aWins = dimRecords.filter((r) => r.answer === "A").length;
      const bWins = dimRecords.filter((r) => r.answer === "B").length;
      const ties = dimRecords.filter((r) => r.answer === "tie").length;
      const total = aWins + bWins + ties;
      const bRate = total > 0 ? ((bWins / (aWins + bWins)) * 100).toFixed(1) : "N/A";

      dimResults[dim] = { aWins, bWins, ties, total, bRate };
      console.log(`  ${dim}: B胜率=${bRate}% (${aWins}A/${bWins}B/${ties}T)`);
    }

    // --- Generate Stage 5 readiness assessment ---
    const agreementOk = parseFloat(agreementRate) >= 65;
    const controversyOk = parseFloat(controversyRate) < 20;
    const singleReader = readers.length === 1;
    const recommendedDirection = Object.entries(dimResults)
      .sort((a, b) => parseFloat(a[1].bRate) - parseFloat(b[1].bRate))
      .map(([dim]) => dim);
    const weakestDim = recommendedDirection[0];

    const report = `# Stage 5 Ensemble 评估报告

> 生成日期: ${new Date().toISOString()}
> 数据来源: \`${csvPath}\`
> 生成脚本: \`scripts/stage5-ensemble-eval.mjs\`

---

## 1. 样本概览

| 指标 | 数值 |
|------|:----:|
| 总记录数 | ${records.length} |
| Pair 数 | ${pairs.length} |
| Reader 数 | ${readers.length} |
| 版本变体 | ${versions.join(", ")} |

## 2. 跨模型/跨 Reader 一致性

| 指标 | 数值 | 阈值 | 通过 |
|------|:----:|:----:|:----:|
| 完全一致 | ${unanimous}/${totalGroups} | — | — |
| 多数一致 | ${majority}/${totalGroups} | — | — |
| 分歧（无多数） | ${split}/${totalGroups} | — | — |
| **总一致率** | **${agreementRate}%** | ≥ 65% | ${agreementOk ? "✅" : "❌"} |
| **争议池比例** | **${controversyRate}%** | < 20% | ${controversyOk ? "✅" : "❌"} |

### 解读

- 跨模型/Reader 一致率 ≥ 65% 表示 Ensemble 判断可信。
- 争议池比例 < 20% 表示大多数 pair 有明确偏好，无需人工介入。

## 3. 分维度 B 侧胜率（维度弱项分析）

| 维度 | A 胜 | B 胜 | 平局 | B 胜率 |
|------|:----:|:----:|:----:|:------:|
${DIMENSIONS.map((dim) => {
  const r = dimResults[dim];
  return `| ${dim} | ${r.aWins} | ${r.bWins} | ${r.ties} | ${r.bRate}% |`;
}).join("\n")}

### 维度弱项排序（从低到高）

${recommendedDirection.map((dim, i) => `${i + 1}. **${dim}** — B 胜率 ${dimResults[dim].bRate}%`).join("\n")}

**建议专项方向**: **${weakestDim}**（最低胜率维度）

## 4. Stage 5 准入判定

| 条件 | 当前值 | 标准 | 状态 |
|------|:------:|:----:|:----:|
| Ensemble 一致率 ≥ 65% | ${agreementRate}% | ≥ 65% | ${agreementOk ? "✅" : "❌"} |
| 争议池比例 < 20% | ${controversyRate}% | < 20% | ${controversyOk ? "✅" : "❌"} |
| 多 Reader 评测 | ${singleReader ? "❌ 仅 1 个 Reader" : "✅ " + readers.length + " 个 Reader"} | ≥ 2 | ${singleReader ? "⚠️ 建议增加 Reader" : "✅"} |

### 最终判定

${agreementOk && controversyOk && !singleReader
  ? "**✅ Ensemble 评估通过** — 可进入轻量人工校准阶段。"
  : agreementOk && controversyOk && singleReader
    ? "**⚠️ 有条件通过** — 一致率达标，但建议增加第 2 个 Reader 以降低单模型偏差风险。"
    : "**❌ 未通过** — Ensemble 一致性不足，请调整 Reader 配置后重试。"}

## 5. 建议

${agreementOk
  ? "- 运行轻量人工校准（10 对关键样本）→ \`node scripts/stage5-human-calibrate.mjs\`\n- 选定专项方向后启动 R1 闭环"
  : "- 检查 Reader prompt 是否差异过大\n- 降低 temperature 以提高一致性\n- 考虑移除不稳定 Reader"}
`;

    return writeFile(outputPath, report, "utf-8").then(() => {
      console.log(`\n✅ 已生成 Stage 5 评估报告: ${output}`);
      console.log(`\n关键指标:`);
      console.log(`  Ensemble 一致率: ${agreementRate}%`);
      console.log(`  争议池比例: ${controversyRate}%`);
      console.log(`  建议专项方向: ${weakestDim}`);
    });
  }).catch((e) => {
    console.error("错误:", e.message);
    process.exit(1);
  });
}

main();
