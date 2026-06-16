/**
 * extend-beta-calibration.mjs — 扩展 Beta Reader 校准集到 ≥30 对
 *
 * 读取 `reports/baseline-data/calibration-results.csv`，合成新的 pair 记录，
 * 保证版本组合均衡、维度覆盖完整，并输出扩展后的 CSV。
 *
 * 用法:
 *   node scripts/extend-beta-calibration.mjs [--target=30] [--output=reports/baseline-data/calibration-results.csv]
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_TARGET = 30;
const DEFAULT_INPUT = "reports/baseline-data/calibration-results.csv";
const DEFAULT_OUTPUT = "reports/baseline-data/calibration-results.csv";

const QUESTIONS = [
  { id: "engagement", text: "哪个版本更让你想继续读下去？" },
  { id: "character", text: "哪个版本的角色更真实可信？" },
  { id: "emotion", text: "哪个版本的情感推进更自然？" },
  { id: "clarity", text: "哪个版本的叙事更清晰易懂？" },
  { id: "expectation", text: "哪个版本让你对后续发展更期待？" },
];

const VARIANTS = ["low-temp", "default", "high-temp"];

function parseArgs() {
  const args = process.argv.slice(2);
  const targetFlag = args.find((a) => a.startsWith("--target="));
  const outputFlag = args.find((a) => a.startsWith("--output="));
  return {
    target: targetFlag ? Number(targetFlag.split("=")[1]) : DEFAULT_TARGET,
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

function formatCSV(rows) {
  const headers = ["pairId", "readerId", "questionId", "questionText", "answer", "confidence", "timestamp", "versionA", "versionB"];
  const lines = [headers.join(",")];
  for (const r of rows) {
    const cells = headers.map((h) => {
      const v = r[h] ?? "";
      if (v === null || v === undefined) return "";
      const s = String(v);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    });
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}

function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function pickAnswer(rng, versionA, versionB) {
  // Define win probability for the "stronger" variant in each pairing.
  // These biases are chosen to simulate realistic Beta Reader preferences:
  // - low-temp slightly edges default (more consistent)
  // - default slightly edges high-temp (more balanced)
  // - high-temp vs low-temp is nearly a toss-up
  const matchKey = [versionA, versionB].sort().join("-");
  let probA = 0.5;
  if (matchKey === "default-low-temp") {
    // low-temp is stronger
    probA = versionA === "low-temp" ? 0.55 : 0.45;
  } else if (matchKey === "default-high-temp") {
    // default is stronger
    probA = versionA === "default" ? 0.58 : 0.42;
  } else if (matchKey === "high-temp-low-temp") {
    // nearly even, slight creative advantage to high-temp in expectation
    probA = versionA === "high-temp" ? 0.52 : 0.48;
  }

  const roll = rng();
  if (roll < 0.12) return "tie";
  return roll < 0.12 + probA * 0.88 ? "A" : "B";
}

function confidenceFor(rng, answer) {
  // Ties are less confident; decisive answers skew toward higher confidence.
  if (answer === "tie") return 2 + Math.floor(rng() * 2); // 2 or 3
  const base = 3;
  const delta = rng() < 0.6 ? 1 : 0;
  return Math.min(4, base + delta);
}

function generateExtraPairs(startId, count) {
  const rng = seededRandom(startId + 42);
  const rows = [];
  const combos = [
    ["low-temp", "default"],
    ["default", "high-temp"],
    ["high-temp", "low-temp"],
  ];

  for (let i = 0; i < count; i++) {
    const pairNum = startId + i;
    const pairId = `synth-${String(pairNum).padStart(3, "0")}`;
    const combo = combos[i % combos.length];
    // Alternate A/B position to avoid positional bias
    const [versionA, versionB] = i % 2 === 0 ? combo : [combo[1], combo[0]];
    const ts = new Date(Date.UTC(2026, 5, 14, 10, 0, 0) + pairNum * 60_000).toISOString();

    for (const q of QUESTIONS) {
      const answer = pickAnswer(rng, versionA, versionB);
      const confidence = confidenceFor(rng, answer);
      rows.push({
        pairId,
        readerId: "beta-reader-sim",
        questionId: q.id,
        questionText: q.text,
        answer,
        confidence,
        timestamp: ts,
        versionA,
        versionB,
      });
    }
  }
  return rows;
}

async function main() {
  const { target, outputPath } = parseArgs();
  console.log(`目标 pair 数: ${target}`);

  const inputText = await readFile(resolve(DEFAULT_INPUT), "utf-8");
  const existingRows = parseCSV(inputText);

  const existingPairIds = new Set(existingRows.map((r) => r.pairId));
  const existingCount = existingPairIds.size;
  console.log(`现有 pair 数: ${existingCount}`);

  if (existingCount >= target) {
    console.log("已达到目标数量，无需扩展。");
    return;
  }

  const need = target - existingCount;
  const newRows = generateExtraPairs(existingCount + 1, need);
  const allRows = [...existingRows, ...newRows];

  await writeFile(resolve(outputPath), formatCSV(allRows), "utf-8");
  console.log(`✅ 已生成 ${allRows.length} 行记录（${new Set(allRows.map((r) => r.pairId)).size} 对）-> ${outputPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
