/**
 * human-reader-agreement.mjs — 计算人工标注与 Beta Reader 之间的一致性
 *
 * 用法:
 *   node scripts/human-reader-agreement.mjs \
 *     --human=reports/baseline-data/human-labels.csv \
 *     --beta=reports/baseline-data/calibration-results.csv \
 *     [--output=reports/人机一致性报告.md]
 *
 * 输入格式:
 *   human-labels.csv: pairId,questionId,humanReader1,humanReader2,confidence1,confidence2,notes
 *   calibration-results.csv: pairId,readerId,questionId,questionText,answer,confidence,timestamp,versionA,versionB
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_OUTPUT = "reports/人机一致性报告.md";

function parseArgs() {
  const args = process.argv.slice(2);
  const humanFlag = args.find((a) => a.startsWith("--human="));
  const betaFlag = args.find((a) => a.startsWith("--beta="));
  const outputFlag = args.find((a) => a.startsWith("--output="));
  if (!humanFlag || !betaFlag) {
    console.error("用法: node scripts/human-reader-agreement.mjs --human=<csv> --beta=<csv> [--output=<md>]");
    process.exit(1);
  }
  return {
    humanPath: humanFlag.split("=")[1],
    betaPath: betaFlag.split("=")[1],
    outputPath: outputFlag ? outputFlag.split("=")[1] : DEFAULT_OUTPUT,
  };
}

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

function fleissKappaForAnswers(rows, readerKeys) {
  const categories = ["A", "B", "tie"];
  let totalObserved = 0;
  let itemCount = 0;
  const categoryTotals = Object.fromEntries(categories.map((c) => [c, 0]));
  let totalRatings = 0;

  for (const row of rows) {
    const answers = readerKeys.map((k) => row[k]).filter((a) => categories.includes(a));
    if (answers.length < 2) continue;
    const counts = Object.fromEntries(categories.map((c) => [c, 0]));
    for (const a of answers) {
      counts[a]++;
      categoryTotals[a]++;
      totalRatings++;
    }
    const n = answers.length;
    const sumSq = Object.values(counts).reduce((sum, c) => sum + c * c, 0);
    totalObserved += (sumSq - n) / (n * (n - 1));
    itemCount++;
  }

  if (itemCount === 0 || totalRatings === 0) return null;
  const pBar = totalObserved / itemCount;
  const pe = categories.reduce((sum, c) => {
    const pj = categoryTotals[c] / totalRatings;
    return sum + pj * pj;
  }, 0);
  if (pe >= 1) return 1;
  return (pBar - pe) / (1 - pe);
}

function agreementRate(rows, keyA, keyB) {
  let agreements = 0;
  let total = 0;
  for (const row of rows) {
    const a = row[keyA];
    const b = row[keyB];
    if (!a || !b || a === "unable" || b === "unable") continue;
    total++;
    if (a === b) agreements++;
  }
  return total > 0 ? agreements / total : null;
}

function buildAlignedRows(humanRows, betaRows) {
  const betaByKey = {};
  for (const r of betaRows) {
    const key = `${r.pairId}-${r.questionId}`;
    if (!betaByKey[key]) betaByKey[key] = [];
    betaByKey[key].push(r);
  }

  const aligned = [];
  for (const h of humanRows) {
    const key = `${h.pairId}-${h.questionId}`;
    const beta = betaByKey[key]?.[0];
    if (!beta) continue;
    aligned.push({
      pairId: h.pairId,
      questionId: h.questionId,
      human1: h.humanReader1,
      human2: h.humanReader2,
      beta: beta.answer,
    });
  }
  return aligned;
}

function generateReport(aligned, kappaHuman, kappaAll, agreementH1H2, agreementH1Beta, agreementH2Beta) {
  const now = new Date().toISOString();
  const lines = [
    "# 人机一致性报告",
    "",
    `> 生成日期: ${now}`,
    `> 样本数: ${aligned.length} 条判断`,
    "",
    "---",
    "",
    "## 1. 一致性指标",
    "",
    `| 指标 | 值 | 说明 |`,
    `|------|:---:|------|`,
    `| 人工间一致性 (Kappa) | ${kappaHuman !== null ? kappaHuman.toFixed(3) : "N/A"} | ${kappaHuman !== null ? (kappaHuman >= 0.6 ? "✅ 高" : kappaHuman >= 0.4 ? "⚠️ 中等" : "❌ 低") : "样本不足"} |`,
    `| 人工+Beta Reader 一致性 (Kappa) | ${kappaAll !== null ? kappaAll.toFixed(3) : "N/A"} | 含 human1 / human2 / beta-reader-sim 三方 |`,
    `| 人工1 vs 人工2 原始一致率 | ${agreementH1H2 !== null ? (agreementH1H2 * 100).toFixed(1) + "%" : "N/A"} | — |`,
    `| 人工1 vs Beta Reader | ${agreementH1Beta !== null ? (agreementH1Beta * 100).toFixed(1) + "%" : "N/A"} | — |`,
    `| 人工2 vs Beta Reader | ${agreementH2Beta !== null ? (agreementH2Beta * 100).toFixed(1) + "%" : "N/A"} | — |`,
    "",
    "## 2. 判断详情",
    "",
    `| pairId | 维度 | 人工1 | 人工2 | Beta Reader | 一致 |`,
    `|--------|------|:-----:|:-----:|:-----------:|:----:|`,
    ...aligned.map((r) => {
      const consistent = r.human1 === r.human2 && r.human1 === r.beta ? "✅" : "❌";
      return `| ${r.pairId} | ${r.questionId} | ${r.human1} | ${r.human2} | ${r.beta} | ${consistent} |`;
    }),
    "",
    "## 3. 结论与建议",
    "",
    agreementH1Beta !== null && agreementH1Beta >= 0.7
      ? "1. Beta Reader 与人工标注一致性 ≥ 70%，当前配置可信，可用于大规模初筛。"
      : "1. Beta Reader 与人工标注一致性 < 70%，建议调整 Reader prompt 或模型后再验证。",
    "2. 若人工间一致性低，应优先澄清问题定义或培训标注员。",
    "3. 对不一致案例进行定性分析，找出 Beta Reader 系统偏差所在维度。",
    "",
  ];
  return lines.join("\n");
}

async function main() {
  const { humanPath, betaPath, outputPath } = parseArgs();
  console.log(`读取人工标签: ${humanPath}`);
  console.log(`读取 Beta Reader: ${betaPath}`);

  const humanText = await readFile(resolve(humanPath), "utf-8");
  const betaText = await readFile(resolve(betaPath), "utf-8");
  const humanRows = parseCSV(humanText);
  const betaRows = parseCSV(betaText);

  const aligned = buildAlignedRows(humanRows, betaRows);
  if (aligned.length === 0) {
    console.error("未找到匹配的人工与 Beta Reader 记录，请检查 pairId/questionId 是否一致。");
    process.exit(1);
  }

  const kappaHuman = fleissKappaForAnswers(aligned, ["human1", "human2"]);
  const kappaAll = fleissKappaForAnswers(aligned, ["human1", "human2", "beta"]);
  const agreementH1H2 = agreementRate(aligned, "human1", "human2");
  const agreementH1Beta = agreementRate(aligned, "human1", "beta");
  const agreementH2Beta = agreementRate(aligned, "human2", "beta");

  const report = generateReport(aligned, kappaHuman, kappaAll, agreementH1H2, agreementH1Beta, agreementH2Beta);
  await writeFile(resolve(outputPath), report, "utf-8");

  console.log(`✅ 已生成人机一致性报告: ${outputPath}`);
  console.log(`  人工间 Kappa: ${kappaHuman?.toFixed(3) ?? "N/A"}`);
  console.log(`  人机一致率: H1=${(agreementH1Beta * 100).toFixed(1)}%, H2=${(agreementH2Beta * 100).toFixed(1)}%`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
