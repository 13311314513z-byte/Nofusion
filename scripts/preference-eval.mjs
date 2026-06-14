/**
 * preference-eval.mjs — Aggregate paired preference CSV data into a report.
 *
 * Usage:
 *   node scripts/preference-eval.mjs <results.csv> [--output report.md]
 *
 * Reads the CSV output from evaluate-chapter.mjs and produces:
 *   - Win rate with confidence interval
 *   - Per-dimension breakdown
 *   - Inter-reader agreement
 *   - Summary report (markdown)
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function parseCSV(text) {
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      record.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      if (record.some((value) => value.length > 0)) records.push(record);
      record = [];
      field = "";
    } else {
      field += char;
    }
  }
  record.push(field);
  if (record.some((value) => value.length > 0)) records.push(record);

  const headers = records[0] ?? [];
  const rows = [];
  for (let i = 1; i < records.length; i++) {
    const values = records[i];
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j].trim()] = (values[j] || "").trim();
    }
    rows.push(row);
  }
  return rows;
}

function computeMetrics(rows) {
  const byQuestion = {};

  for (const r of rows) {
    if (r.answer === "unable") continue;
    const qId = r.questionId;
    if (!byQuestion[qId]) byQuestion[qId] = { wins: 0, losses: 0, ties: 0, total: 0 };
    byQuestion[qId].total++;
    if (r.answer === "B") byQuestion[qId].wins++;
    else if (r.answer === "A") byQuestion[qId].losses++;
    else if (r.answer === "tie") byQuestion[qId].ties++;
  }

  let totalWins = 0;
  let totalLosses = 0;
  let totalTies = 0;

  for (const [, data] of Object.entries(byQuestion)) {
    totalWins += data.wins;
    totalLosses += data.losses;
    totalTies += data.ties;
  }

  const decisive = totalWins + totalLosses;
  const total = decisive + totalTies;

  const metrics = {
    totalComparisons: total,
    winRate: decisive > 0 ? totalWins / decisive : 0,
    tieRate: total > 0 ? totalTies / total : 0,
    byQuestion,
  };

  // Wilson CI
  if (decisive > 0) {
    const z = 1.96;
    const p = metrics.winRate;
    const denominator = 1 + z * z / decisive;
    const centre = (p + z * z / (2 * decisive)) / denominator;
    const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * decisive)) / decisive) / denominator;
    metrics.ci95 = [
      Math.max(0, centre - margin).toFixed(3),
      Math.min(1, centre + margin).toFixed(3),
    ];
  } else {
    metrics.ci95 = ["0", "1"];
  }

  return metrics;
}

function computeReaderAgreement(rows) {
  const byItem = {};
  for (const r of rows) {
    if (r.answer === "unable") continue;
    const key = `${r.pairId}-${r.questionId}`;
    if (!byItem[key]) byItem[key] = [];
    byItem[key].push(r.answer);
  }

  const eligibleItems = Object.values(byItem).filter((answers) => answers.length >= 2);
  if (eligibleItems.length === 0) return "N/A";

  const categoryTotals = { A: 0, B: 0, tie: 0 };
  let totalRatings = 0;
  let observedAgreement = 0;

  for (const answers of eligibleItems) {
    const counts = { A: 0, B: 0, tie: 0 };
    for (const answer of answers) {
      if (!(answer in counts)) continue;
      counts[answer]++;
      categoryTotals[answer]++;
      totalRatings++;
    }
    const n = counts.A + counts.B + counts.tie;
    if (n < 2) continue;
    observedAgreement +=
      (counts.A ** 2 + counts.B ** 2 + counts.tie ** 2 - n) / (n * (n - 1));
  }

  const meanObservedAgreement = observedAgreement / eligibleItems.length;
  const expectedAgreement =
    (categoryTotals.A / totalRatings) ** 2
    + (categoryTotals.B / totalRatings) ** 2
    + (categoryTotals.tie / totalRatings) ** 2;
  const kappa = expectedAgreement >= 1
    ? 1
    : (meanObservedAgreement - expectedAgreement) / (1 - expectedAgreement);
  return kappa.toFixed(3);
}

function generateReport(metrics, agreement, headers) {
  const lines = [];
  lines.push("# 成对偏好评测报告");
  lines.push(`生成日期: ${new Date().toISOString()}`);
  lines.push(`样本总数: ${metrics.totalComparisons}`);
  lines.push("");
  lines.push("## 总体结果");
  lines.push("");
  lines.push(`| 指标 | 值 | 95% CI |`);
  lines.push(`|------|:---:|:------:|`);
  lines.push(`| 新版胜率 | ${(metrics.winRate * 100).toFixed(1)}% | [${metrics.ci95[0]}, ${metrics.ci95[1]}] |`);
  lines.push(`| 平局率 | ${(metrics.tieRate * 100).toFixed(1)}% | |`);
  lines.push(`| 读者一致性 | ${agreement} | |`);
  lines.push("");
  lines.push("## 分维度结果");
  lines.push("");
  lines.push(`| 维度 | 胜率 | 样本数 |`);
  lines.push(`|------|:----:|:------:|`);
  for (const [qId, data] of Object.entries(metrics.byQuestion)) {
    const decisive = data.wins + data.losses;
    const winRate = decisive > 0 ? (data.wins / decisive * 100).toFixed(1) : "N/A";
    lines.push(`| ${qId} | ${winRate}% | ${data.total} |`);
  }
  lines.push("");
  lines.push("## 原始数据字段");
  lines.push("");
  lines.push("```");
  lines.push(headers.join(", "));
  lines.push("```");

  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const csvFile = args.find((a) => !a.startsWith("--"));
  const outputFlag = args.find((a) => a.startsWith("--output="));

  if (!csvFile) {
    console.error("Usage: node scripts/preference-eval.mjs <results.csv> [--output report.md]");
    process.exit(1);
  }

  const csvText = await readFile(resolve(csvFile), "utf-8");
  const rows = parseCSV(csvText);
  const headers = Object.keys(rows[0] || {});

  if (rows.length === 0) {
    console.error("No data found in CSV.");
    process.exit(1);
  }

  console.log(`\nLoaded ${rows.length} responses.\n`);

  const metrics = computeMetrics(rows);
  const agreement = computeReaderAgreement(rows);

  console.log(`Total comparisons: ${metrics.totalComparisons}`);
  console.log(`Win rate (B over A): ${(metrics.winRate * 100).toFixed(1)}%`);
  console.log(`95% CI: [${metrics.ci95[0]}, ${metrics.ci95[1]}]`);
  console.log(`Tie rate: ${(metrics.tieRate * 100).toFixed(1)}%`);
  console.log(`Inter-reader agreement: ${agreement}`);

  console.log("\nPer-dimension:");
  for (const [qId, data] of Object.entries(metrics.byQuestion)) {
    const decisive = data.wins + data.losses;
    const winRate = decisive > 0 ? (data.wins / decisive * 100).toFixed(1) : "N/A";
    console.log(`  ${qId}: ${winRate}% (${data.total} samples)`);
  }

  if (outputFlag) {
    const report = generateReport(metrics, agreement, headers);
    const outputPath = outputFlag.split("=")[1];
    await writeFile(resolve(outputPath), report, "utf-8");
    console.log(`\nReport saved to: ${outputPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
