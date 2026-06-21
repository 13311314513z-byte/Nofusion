/**
 * Stage 5 Human-Calibrate — computes human vs Ensemble agreement
 *
 * Usage:
 *   node scripts/stage5-human-calibrate.mjs
 *     [--human=reports/baseline-data/human-labels-template.csv]
 *     [--ensemble=reports/baseline-data/calibration-results.csv]
 *     [--output=reports/stage5-calibration-report.md]
 *
 * The human CSV must have columns: pairId, questionId, answerHuman, confidence[, notes]
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

const DIMENSIONS = ["engagement", "character", "emotion", "clarity", "expectation"];

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    human: args.find(a => a.startsWith("--human="))?.slice(8) ?? "reports/baseline-data/human-labels-template.csv",
    ensemble: args.find(a => a.startsWith("--ensemble="))?.slice(11) ?? "reports/baseline-data/calibration-results.csv",
    output: args.find(a => a.startsWith("--output="))?.slice(9) ?? "reports/stage5-calibration-report.md",
  };
}

function parseCSV(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(",").map(v => v.trim());
    const record = {};
    headers.forEach((h, i) => { record[h] = vals[i] ?? ""; });
    return record;
  }).filter(r => r.pairId && r.questionId);
}

function main() {
  const args = parseArgs();
  const humanPath = resolve(PROJECT_ROOT, args.human);
  const ensemblePath = resolve(PROJECT_ROOT, args.ensemble);
  const outputPath = resolve(PROJECT_ROOT, args.output);

  console.log(`Human labels: ${humanPath}`);
  console.log(`Ensemble data: ${ensemblePath}`);

  if (!existsSync(humanPath)) {
    console.error("ERROR: Human labels not found. Run the calibration first.");
    process.exit(1);
  }
  if (!existsSync(ensemblePath)) {
    console.error("ERROR: Ensemble data not found.");
    process.exit(1);
  }

  const humanRecords = parseCSV(readFileSync(humanPath, "utf-8"));
  const ensembleRecords = parseCSV(readFileSync(ensemblePath, "utf-8"));

  console.log(`Human judgments: ${humanRecords.length}`);
  console.log(`Ensemble judgments: ${ensembleRecords.length}`);

  // Match human vs ensemble by pairId + questionId
  // Ensemble picks the best representative answer (first non-tie in the group)
  const ensembleChoice = {};
  for (const r of ensembleRecords) {
    const key = `${r.pairId}::${r.questionId}`;
    if (!ensembleChoice[key] && r.answer !== "tie" && r.answer !== "unable") {
      ensembleChoice[key] = r.answer;
    }
  }

  let agree = 0, disagree = 0, total = 0;
  const dimCounts = {};

  for (const h of humanRecords) {
    const key = `${h.pairId}::${h.questionId}`;
    const eAnswer = ensembleChoice[key];
    if (!eAnswer) continue;

    total++;
    if (!dimCounts[h.questionId]) dimCounts[h.questionId] = { agree: 0, total: 0 };

    if (h.answerHuman === eAnswer) {
      agree++;
      dimCounts[h.questionId].agree++;
    } else {
      disagree++;
    }
    dimCounts[h.questionId].total++;
  }

  const agreementRate = total > 0 ? ((agree / total) * 100).toFixed(1) : "N/A";
  const agreed = parseFloat(agreementRate) >= 75;

  const report = `# Stage 5 人工校准报告

> 生成日期: ${new Date().toISOString()}
> 人工标注: \`${humanPath}\`
> Ensemble 数据: \`${ensemblePath}\`

## 校准结果

| 指标 | 数值 |
|------|:----:|
| 配对判断数 | ${total} |
| 一致数 | ${agree} |
| 分歧数 | ${disagree} |
| **人-Ensemble 一致性** | **${agreementRate}%** |
| 通过阈值（≥ 75%） | ${agreed ? "✅ 通过" : "❌ 未通过"} |

## 分维度一致性

| 维度 | 一致 | 总数 | 一致性 |
|------|:----:|:----:|:------:|
${DIMENSIONS.map(d => {
  const c = dimCounts[d] ?? { agree: 0, total: 0 };
  const rate = c.total > 0 ? ((c.agree / c.total) * 100).toFixed(1) : "N/A";
  return `| ${d} | ${c.agree} | ${c.total} | ${rate}% |`;
}).join("\n")}

## 结论

${agreed
  ? "✅ **校准通过** — Ensemble Reader 判断与人工标签一致性 ≥ 75%，可继续使用 Ensemble 替代人工评测。"
  : "❌ **校准未通过** — 请调整 Reader prompt 或更换模型后重新评测。"}

## 分歧分析

${disagree > 0
  ? `共 ${disagree} 条分歧，建议检查：\n- 是否为边界 pair（胜率接近 50%）\n- 是否为特定维度系统性分歧\n- 人工标注员是否需要进一步培训`
  : "无分歧 — Ensemble 与人工高度一致。"}
`;

  writeFileSync(outputPath, report, "utf-8");
  console.log(`\n✅ Calibration report: ${outputPath}`);
  console.log(`Human-Ensemble agreement: ${agreementRate}%`);
}

main();
