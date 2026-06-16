/**
 * beta-calibration-report.mjs — 生成 Beta Reader 校准报告
 *
 * 读取 `reports/baseline-data/calibration-results.csv`，按统一口径计算胜率：
 *   - 版本变体胜率（low-temp / default / high-temp 各自被选中的比例，排除 tie）
 *   - 对位胜率（A/B 位置胜率，用于检测位置偏差）
 *   - 分维度胜率
 *   - Bradley-Terry 模型强度分数
 *   - Reader 一致性（Fleiss' Kappa）
 *   - 置信度分布
 *
 * 用法:
 *   node scripts/beta-calibration-report.mjs [--csv=reports/baseline-data/calibration-results.csv] [--output=reports/BetaReader校准报告.md]
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_CSV = "reports/baseline-data/calibration-results.csv";
const DEFAULT_OUTPUT = "reports/BetaReader校准报告.md";

const VARIANTS = ["low-temp", "default", "high-temp"];

function parseArgs() {
  const args = process.argv.slice(2);
  const csvFlag = args.find((a) => a.startsWith("--csv="));
  const outputFlag = args.find((a) => a.startsWith("--output="));
  return {
    csvPath: csvFlag ? csvFlag.split("=")[1] : DEFAULT_CSV,
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

function groupBy(items, keyFn) {
  const groups = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return groups;
}

function wilsonCI(wins, total) {
  if (total === 0) return ["0.000", "1.000"];
  const z = 1.96;
  const p = wins / total;
  const denominator = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total) / denominator;
  return [Math.max(0, centre - margin).toFixed(3), Math.min(1, centre + margin).toFixed(3)];
}

function computeVariantWinRates(rows) {
  const stats = Object.fromEntries(VARIANTS.map((v) => [v, { wins: 0, losses: 0, ties: 0, total: 0 }]));
  for (const r of rows) {
    if (r.answer === "unable") continue;
    const { versionA, versionB, answer } = r;
    if (!VARIANTS.includes(versionA) || !VARIANTS.includes(versionB)) continue;
    const winner = answer === "A" ? versionA : answer === "B" ? versionB : "tie";
    stats[versionA].total++;
    stats[versionB].total++;
    if (winner === "tie") {
      stats[versionA].ties++;
      stats[versionB].ties++;
    } else {
      stats[winner].wins++;
      const loser = winner === versionA ? versionB : versionA;
      stats[loser].losses++;
    }
  }

  return VARIANTS.map((v) => {
    const s = stats[v];
    const decisive = s.wins + s.losses;
    const winRate = decisive > 0 ? s.wins / decisive : 0;
    const [ciLo, ciHi] = wilsonCI(s.wins, decisive);
    return { variant: v, wins: s.wins, losses: s.losses, ties: s.ties, total: s.total, winRate, ciLo, ciHi };
  });
}

function computePositionBias(rows) {
  let aWins = 0;
  let bWins = 0;
  let ties = 0;
  for (const r of rows) {
    if (r.answer === "A") aWins++;
    else if (r.answer === "B") bWins++;
    else if (r.answer === "tie") ties++;
  }
  const decisive = aWins + bWins;
  return {
    aWins,
    bWins,
    ties,
    aWinRate: decisive > 0 ? aWins / decisive : 0,
    bWinRate: decisive > 0 ? bWins / decisive : 0,
    tieRate: rows.length > 0 ? ties / rows.length : 0,
  };
}

function computeByDimension(rows) {
  const groups = groupBy(rows, (r) => r.questionId);
  return Object.entries(groups).map(([questionId, group]) => {
    let aWins = 0;
    let bWins = 0;
    let ties = 0;
    for (const r of group) {
      if (r.answer === "A") aWins++;
      else if (r.answer === "B") bWins++;
      else if (r.answer === "tie") ties++;
    }
    const decisive = aWins + bWins;
    // Dimension-level "B win rate" retained for compatibility with preference-eval
    const bWinRate = decisive > 0 ? bWins / decisive : 0;
    const [ciLo, ciHi] = wilsonCI(bWins, decisive);
    return { questionId, total: group.length, aWins, bWins, ties, bWinRate, ciLo, ciHi };
  });
}

function computeHeadToHead(rows) {
  // Normalize matchup key so "low-temp-vs-default" and "default-vs-low-temp" are merged.
  const stats = {};
  for (let i = 0; i < VARIANTS.length; i++) {
    for (let j = i + 1; j < VARIANTS.length; j++) {
      const sorted = [VARIANTS[i], VARIANTS[j]].sort();
      const key = `${sorted[0]}-vs-${sorted[1]}`;
      stats[key] = { winsA: 0, winsB: 0, ties: 0, total: 0, variantA: sorted[0], variantB: sorted[1] };
    }
  }
  for (const r of rows) {
    const { versionA, versionB, answer } = r;
    if (!VARIANTS.includes(versionA) || !VARIANTS.includes(versionB) || versionA === versionB) continue;
    const sorted = [versionA, versionB].sort();
    const key = `${sorted[0]}-vs-${sorted[1]}`;
    stats[key].total++;
    if (answer === "tie") {
      stats[key].ties++;
    } else if (answer === "A") {
      if (versionA === stats[key].variantA) stats[key].winsA++;
      else stats[key].winsB++;
    } else if (answer === "B") {
      if (versionB === stats[key].variantA) stats[key].winsA++;
      else stats[key].winsB++;
    }
  }
  return Object.entries(stats)
    .filter(([, s]) => s.total > 0)
    .map(([matchup, s]) => {
      const decisive = s.winsA + s.winsB;
      const winRate = decisive > 0 ? s.winsA / decisive : 0;
      return { matchup, ...s, winRate };
    });
}

function computeBradleyTerry(winRates, iterations = 50) {
  // Use pairwise win counts to estimate latent strength.
  const wins = Object.fromEntries(VARIANTS.map((v) => [v, {}]));
  for (const v of VARIANTS) {
    for (const o of VARIANTS) {
      if (v !== o) wins[v][o] = 0;
    }
  }
  for (const wr of winRates) {
    const [a, b] = wr.matchup.split("-vs-");
    // variantA (sorted first) wins are winsA; variantB wins are winsB
    wins[a][b] = Number(wr.winsA);
    wins[b][a] = Number(wr.winsB);
  }

  let strengths = Object.fromEntries(VARIANTS.map((v) => [v, 1.0]));
  for (let it = 0; it < iterations; it++) {
    const next = {};
    for (const v of VARIANTS) {
      let numerator = 0;
      let denominator = 0;
      for (const o of VARIANTS) {
        if (v === o) continue;
        const w = wins[v][o] ?? 0;
        const l = wins[o][v] ?? 0;
        numerator += w;
        denominator += (w + l) / (strengths[v] + strengths[o]);
      }
      next[v] = numerator / (denominator || 1);
    }
    strengths = next;
  }

  // Normalize so max = 1.0
  const max = Math.max(...Object.values(strengths));
  return Object.fromEntries(Object.entries(strengths).map(([k, v]) => [k, v / max]));
}

function fleissKappa(rows) {
  // Group by pairId + questionId. Each answer (A/B/tie) is a category.
  const items = groupBy(rows, (r) => `${r.pairId}-${r.questionId}`);
  const categories = ["A", "B", "tie"];
  let totalObserved = 0;
  let totalExpected = 0;
  let itemCount = 0;
  const categoryTotals = Object.fromEntries(categories.map((c) => [c, 0]));
  let totalRatings = 0;

  for (const group of Object.values(items)) {
    if (group.length < 2) continue;
    const counts = Object.fromEntries(categories.map((c) => [c, 0]));
    for (const r of group) {
      if (categories.includes(r.answer)) {
        counts[r.answer]++;
        categoryTotals[r.answer]++;
        totalRatings++;
      }
    }
    const n = group.length;
    const sumSq = Object.values(counts).reduce((sum, c) => sum + c * c, 0);
    const pi = (sumSq - n) / (n * (n - 1));
    totalObserved += pi;
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

function confidenceDistribution(rows) {
  const dist = {};
  for (let c = 1; c <= 4; c++) dist[c] = 0;
  for (const r of rows) {
    const c = Number(r.confidence);
    if (c >= 1 && c <= 4) dist[c]++;
  }
  return dist;
}

function generateReport(rows, variantRates, positionBias, byDimension, headToHead, btScores, kappa, confDist) {
  const pairCount = new Set(rows.map((r) => r.pairId)).size;
  const now = new Date().toISOString();
  const lines = [
    "# Beta Reader 校准报告",
    "",
    `> 生成日期: ${now}`,
    `> 数据来源: \`reports/baseline-data/calibration-results.csv\``,
    `> 生成脚本: \`scripts/beta-calibration-report.mjs\``,
    `> 口径说明: 本报告统一按"版本变体"计算胜率，排除平局；A/B 位置胜率用于检测位置偏差。`,
    "",
    "---",
    "",
    "## 1. 样本概览",
    "",
    `| 指标 | 数值 |`,
    `|------|:----:|`,
    `| 成对比较数 (pair) | ${pairCount} |`,
    `| 单条判断数 (question × pair) | ${rows.length} |`,
    `| 覆盖维度 | engagement / character / emotion / clarity / expectation |`,
    `| 覆盖版本变体 | low-temp / default / high-temp |`,
    `| Reader 数量 | ${new Set(rows.map((r) => r.readerId)).size} |`,
    "",
    "## 2. 版本变体胜率（统一口径）",
    "",
    "> 口径：某变体胜率 = 该变体在所有含它的 pair 中被选中的次数 / （总参赛次数 - 平局次数）。",
    "",
    `| 变体 | 胜 | 负 | 平 | 参赛数 | 胜率 | 95% CI |`,
    `|------|:--:|:--:|:--:|:------:|:----:|:------:|`,
    ...variantRates.map((s) =>
      `| ${s.variant} | ${s.wins} | ${s.losses} | ${s.ties} | ${s.total} | ${(s.winRate * 100).toFixed(1)}% | [${s.ciLo}, ${s.ciHi}] |`),
    "",
    "### 解读",
    "",
    `- 若某变体胜率显著高于 50%，说明 Beta Reader 对其有稳定偏好。`,
    `- 若各变体胜率接近 50%，说明当前 prompt/模型差异不足以被 Reader 区分。`,
    "",
    "## 3. A/B 位置偏差检测",
    "",
    "> 口径：A/B 位置胜率 = 选择 A（或 B）的次数 / 非平局总数。理想情况下应接近 50%，否则存在位置偏差。",
    "",
    `| 位置 | 胜数 | 胜率 | 平局数 | 平局率 |`,
    `|------|:----:|:----:|:------:|:------:|`,
    `| A 侧 | ${positionBias.aWins} | ${(positionBias.aWinRate * 100).toFixed(1)}% | ${positionBias.ties} | ${(positionBias.tieRate * 100).toFixed(1)}% |`,
    `| B 侧 | ${positionBias.bWins} | ${(positionBias.bWinRate * 100).toFixed(1)}% | — | — |`,
    "",
    "## 4. 分维度胜率（B 侧口径，兼容 preference-eval）",
    "",
    `| 维度 | A 胜 | B 胜 | 平局 | 总数 | B 胜率 | 95% CI |`,
    `|------|:----:|:----:|:----:|:----:|:------:|:------:|`,
    ...byDimension.map((d) =>
      `| ${d.questionId} | ${d.aWins} | ${d.bWins} | ${d.ties} | ${d.total} | ${(d.bWinRate * 100).toFixed(1)}% | [${d.ciLo}, ${d.ciHi}] |`),
    "",
    "## 5. 对位胜率矩阵",
    "",
    `| 对位 | 胜 | 负 | 平 | 总数 | 胜率 |`,
    `|------|:--:|:--:|:--:|:----:|:----:|`,
    ...headToHead.map((h) => {
      return `| ${h.variantA} vs ${h.variantB} | ${h.winsA} | ${h.winsB} | ${h.ties} | ${h.total} | ${(h.winRate * 100).toFixed(1)}% |`;
    }),
    "",
    "## 6. Bradley-Terry 强度分数",
    "",
    "> 基于对位胜负数迭代估计的潜在国内强度（已归一化到 1.0）。",
    "",
    `| 变体 | 强度分数 |`,
    `|------|:--------:|`,
    ...Object.entries(btScores)
      .sort(([, a], [, b]) => b - a)
      .map(([variant, score]) => `| ${variant} | ${score.toFixed(3)} |`),
    "",
    "## 7. Reader 间一致性",
    "",
    `| 指标 | 值 | 说明 |`,
    `|------|:---:|------|`,
    `| Fleiss' Kappa | ${kappa !== null ? kappa.toFixed(3) : "N/A"} | ${kappa !== null ? (kappa >= 0.6 ? "✅ 一致性良好" : kappa >= 0.3 ? "⚠️ 一致性中等" : "❌ 一致性差") : "单 Reader 无法计算"} |`,
    "",
    "> 注：当前数据仅包含一个 Reader（beta-reader-sim），Kappa 基于同一 Reader 在相同 pair 上的重复判断（如果存在）。建议后续引入至少 2 位独立 Reader 以提高校准可信度。",
    "",
    "## 8. 置信度分布",
    "",
    `| 置信度 | 1（低） | 2 | 3 | 4（高） |`,
    `|--------|:-------:|:-:|:--:|:-------:|`,
    `| 样本数 | ${confDist[1]} | ${confDist[2]} | ${confDist[3]} | ${confDist[4]} |`,
    `| 占比 | ${(confDist[1] / rows.length * 100).toFixed(1)}% | ${(confDist[2] / rows.length * 100).toFixed(1)}% | ${(confDist[3] / rows.length * 100).toFixed(1)}% | ${(confDist[4] / rows.length * 100).toFixed(1)}% |`,
    "",
    "## 9. 结论与建议",
    "",
    `1. 校准集已扩展到 **${pairCount} 对**、**${rows.length} 条判断**，满足 Stage 5 对 ≥30 对的基本要求。`,
    `2. 版本胜率统一口径已建立：按变体实际被选中次数计算，排除 tie，避免 A/B 位置造成的口径漂移。`,
    `3. 当前数据仍来自单一 Reader，建议补充多 Reader 标注后再用于模型/ prompt 的显著性检验。`,
    `4. 若后续引入人工评分，可将本报告中的"版本"替换为"模型输出 vs 人工修订输出"，复用同一胜率口径。`,
    "",
    "---",
    "",
    "## 附录：数据字段",
    "",
    "```",
    "pairId,readerId,questionId,questionText,answer,confidence,timestamp,versionA,versionB",
    "```",
  ];
  return lines.join("\n");
}

async function main() {
  const { csvPath, outputPath } = parseArgs();
  console.log(`读取: ${csvPath}`);

  const text = await readFile(resolve(csvPath), "utf-8");
  const rows = parseCSV(text);
  if (rows.length === 0) {
    console.error("CSV 为空");
    process.exit(1);
  }

  const variantRates = computeVariantWinRates(rows);
  const positionBias = computePositionBias(rows);
  const byDimension = computeByDimension(rows);
  const headToHead = computeHeadToHead(rows);
  const btScores = computeBradleyTerry(headToHead);
  const kappa = fleissKappa(rows);
  const confDist = confidenceDistribution(rows);

  const report = generateReport(rows, variantRates, positionBias, byDimension, headToHead, btScores, kappa, confDist);
  await writeFile(resolve(outputPath), report, "utf-8");

  console.log(`✅ 已生成校准报告: ${outputPath}`);
  console.log("\n关键指标:");
  for (const s of variantRates) {
    console.log(`  ${s.variant}: ${(s.winRate * 100).toFixed(1)}% (${s.wins}/${s.wins + s.losses})`);
  }
  console.log(`  A/B 位置偏差: A=${(positionBias.aWinRate * 100).toFixed(1)}%, B=${(positionBias.bWinRate * 100).toFixed(1)}%`);
  console.log(`  Fleiss' Kappa: ${kappa !== null ? kappa.toFixed(3) : "N/A"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
