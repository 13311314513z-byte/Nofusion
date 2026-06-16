/**
 * Stage 5 Ensemble Evaluation — Synchronous version for reliability
 *
 * Usage:
 *   node scripts/stage5-ensemble-eval-sync.mjs
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

const DIMENSIONS = ["engagement", "character", "emotion", "clarity", "expectation"];

// Parse command-line args
const args = process.argv.slice(2);
const csvArg = args.find(a => a.startsWith("--csv="))?.slice(6);
const outputArg = args.find(a => a.startsWith("--output="))?.slice(9);

const CSV_PATH = csvArg ? resolve(PROJECT_ROOT, csvArg) : resolve(PROJECT_ROOT, "reports/baseline-data/calibration-results.csv");
const OUTPUT_PATH = outputArg ? resolve(PROJECT_ROOT, outputArg) : resolve(PROJECT_ROOT, "reports/stage5-ensemble-report.md");

console.log("=".repeat(50));
console.log("Stage 5 Ensemble Evaluation");
console.log("=".repeat(50));
console.log(`Project root: ${PROJECT_ROOT}`);
console.log(`CSV: ${CSV_PATH}`);
console.log(`Output: ${OUTPUT_PATH}`);
console.log(`CSV: ${CSV_PATH}`);
console.log(`Output: ${OUTPUT_PATH}`);

if (!existsSync(CSV_PATH)) {
  console.error(`ERROR: CSV not found at ${CSV_PATH}`);
  process.exit(1);
}

const text = readFileSync(CSV_PATH, "utf-8");
const lines = text.trim().split("\n");
if (lines.length < 2) {
  console.error("ERROR: CSV has no data lines");
  process.exit(1);
}

const headers = lines[0].split(",");
const records = lines.slice(1).map((line) => {
  const vals = line.split(",");
  const record = {};
  headers.forEach((h, i) => { record[h.trim()] = (vals[i] ?? "").trim(); });
  return record;
});

console.log(`\nRecords: ${records.length}`);
console.log(`Pairs: ${new Set(records.map(r => r.pairId)).size}`);

const readers = [...new Set(records.map(r => r.readerId).filter(Boolean))];
console.log(`Readers: ${readers.join(", ")}`);

// Group by pairId + questionId
const groups = {};
for (const r of records) {
  const key = `${r.pairId}::${r.questionId}`;
  if (!groups[key]) groups[key] = [];
  groups[key].push(r);
}

console.log(`\n--- Cross-Reader Agreement ---`);
let unanimous = 0, majority = 0, split = 0;
const totalGroups = Object.keys(groups).length;

for (const [key, judgments] of Object.entries(groups)) {
  const answers = judgments.map(j => j.answer).filter(a => a !== "unable");
  if (answers.length < 2) { split++; continue; }
  const counts = {};
  for (const a of answers) counts[a] = (counts[a] || 0) + 1;
  const maxCount = Math.max(...Object.values(counts));
  if (maxCount === answers.length) unanimous++;
  else if (maxCount >= Math.ceil(answers.length / 2)) majority++;
  else split++;
}

const agreementRate = ((unanimous + majority) / totalGroups * 100).toFixed(1);
const controversyRate = (split / totalGroups * 100).toFixed(1);

console.log(`  Total groups: ${totalGroups}`);
console.log(`  Unanimous: ${unanimous}`);
console.log(`  Majority: ${majority}`);
console.log(`  Split: ${split}`);
console.log(`  Agreement rate: ${agreementRate}%`);
console.log(`  Controversy rate: ${controversyRate}%`);

// Per-dimension analysis
console.log(`\n--- Per-Dimension Analysis ---`);
const dimResults = {};
for (const dim of DIMENSIONS) {
  const dimRecords = records.filter(r => r.questionId === dim && r.answer !== "unable");
  const aWins = dimRecords.filter(r => r.answer === "A").length;
  const bWins = dimRecords.filter(r => r.answer === "B").length;
  const ties = dimRecords.filter(r => r.answer === "tie").length;
  const total = aWins + bWins + ties;
  const bRate = total > 0 ? ((bWins / (aWins + bWins || 1)) * 100).toFixed(1) : "N/A";
  dimResults[dim] = { aWins, bWins, ties, total, bRate };
  console.log(`  ${dim}: B=${bRate}% (${aWins}A/${bWins}B/${ties}T)`);
}

// Generate report
const agreementOk = parseFloat(agreementRate) >= 65;
const controversyOk = parseFloat(controversyRate) < 20;
const singleReader = readers.length === 1;
const sortedDims = [...DIMENSIONS].sort((a, b) => parseFloat(dimResults[a].bRate) - parseFloat(dimResults[b].bRate));
const weakestDim = sortedDims[0];

const report = `# Stage 5 Ensemble 评估报告

> 生成日期: ${new Date().toISOString()}
> 数据来源: \`${CSV_PATH}\`

## 1. 样本概览

| 指标 | 数值 |
|------|:----:|
| 总记录数 | ${records.length} |
| Pair 数 | ${new Set(records.map(r => r.pairId)).size} |
| Reader 数 | ${readers.length} |
| Reader 列表 | ${readers.join(", ")} |

## 2. 跨 Reader 一致性

| 指标 | 数值 | 阈值 | 通过 |
|------|:----:|:----:|:----:|
| 完全一致 | ${unanimous}/${totalGroups} | — | — |
| 多数一致 | ${majority}/${totalGroups} | — | — |
| 分歧 | ${split}/${totalGroups} | — | — |
| **总一致率** | **${agreementRate}%** | ≥ 65% | ${agreementOk ? "✅" : "❌"} |
| **争议池比例** | **${controversyRate}%** | < 20% | ${controversyOk ? "✅" : "❌"} |

## 3. 分维度胜率

| 维度 | A 胜 | B 胜 | 平局 | B 胜率 |
|------|:----:|:----:|:----:|:------:|
${DIMENSIONS.map(d => `| ${d} | ${dimResults[d].aWins} | ${dimResults[d].bWins} | ${dimResults[d].ties} | ${dimResults[d].bRate}% |`).join("\n")}

## 4. 维度弱项排序

${sortedDims.map((d, i) => `${i + 1}. **${d}** — B 胜率 ${dimResults[d].bRate}%`).join("\n")}

**建议专项方向**: **${weakestDim}**

## 5. Stage 5 准入判定

| 条件 | 当前值 | 标准 | 状态 |
|------|:------:|:----:|:----:|
| Ensemble 一致率 ≥ 65% | ${agreementRate}% | ≥ 65% | ${agreementOk ? "✅" : "❌"} |
| 争议池比例 < 20% | ${controversyRate}% | < 20% | ${controversyOk ? "✅" : "❌"} |
| 多 Reader 评测 | ${singleReader ? "仅 1 个 Reader" : readers.length + " 个 Reader"} | ≥ 2 | ${singleReader ? "⚠️" : "✅"} |

**最终判定**: ${agreementOk && controversyOk && !singleReader ? "✅ Ensemble 评估通过" : agreementOk && controversyOk && singleReader ? "⚠️ 有条件通过 — 建议增加第 2 个 Reader" : "❌ 未通过"}

## 6. 建议

${agreementOk ? "- 运行轻量人工校准（10 对关键样本）" : "- 调整 Reader prompt 后重试"}
`;

writeFileSync(OUTPUT_PATH, report, "utf-8");
console.log(`\n✅ Report written to: ${OUTPUT_PATH}`);
console.log(`\nKey metrics:`);
console.log(`  Agreement rate: ${agreementRate}%`);
console.log(`  Controversy rate: ${controversyRate}%`);
console.log(`  Recommended direction: ${weakestDim}`);
