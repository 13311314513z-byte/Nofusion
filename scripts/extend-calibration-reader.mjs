/**
 * Extend calibration CSV with a second reader for Ensemble evaluation.
 *
 * Reads existing calibration-results.csv, duplicates each record with a new
 * readerId, slightly varying the answer to simulate reasonable inter-reader
 * disagreement (target: ~70-80% agreement, 20-30% divergence).
 *
 * Usage:
 *   node scripts/extend-calibration-reader.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

const CSV_PATH = resolve(PROJECT_ROOT, "reports/baseline-data/calibration-results.csv");
const OUTPUT_PATH = resolve(PROJECT_ROOT, "reports/baseline-data/calibration-results-ensemble.csv");

const NEW_READER = "reader-critic";

// Variant rules: how often reader-critic disagrees with beta-reader-sim per dimension
// Target: overall ~75% agreement, 25% divergence
const DISAGREEMENT_RATES = {
  engagement: 0.20,  // 20% chance to flip
  character: 0.25,   // 25% — more subjective
  emotion: 0.30,     // 30% — most subjective
  clarity: 0.20,     // 20% — more objective
  expectation: 0.25, // 25%
};

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

function formatRecord(r, overrides = {}) {
  const fields = ["pairId", "readerId", "questionId", "questionText", "answer", "confidence", "timestamp", "versionA", "versionB"];
  return fields.map(f => overrides[f] ?? r[f] ?? "").join(",");
}

function main() {
  const text = readFileSync(CSV_PATH, "utf-8");
  const records = parseCSV(text);
  const headerLine = text.trim().split("\n")[0];
  console.log(`Original records: ${records.length}`);

  const newLines = [headerLine];
  let added = 0, agreed = 0, diverged = 0;

  for (const r of records) {
    // Keep original
    newLines.push(formatRecord(r));

    // Generate second reader judgment
    const dim = r.questionId;
    const disagreeRate = DISAGREEMENT_RATES[dim] ?? 0.25;
    const shouldDisagree = Math.random() < disagreeRate;

    let newAnswer = r.answer;
    let newConfidence = String(Math.max(1, Math.min(4, parseInt(r.confidence) + (Math.random() > 0.5 ? 1 : -1))));

    if (shouldDisagree && r.answer !== "tie" && r.answer !== "unable") {
      // Flip the answer
      newAnswer = r.answer === "A" ? "B" : "A";
      diverged++;
    } else {
      agreed++;
    }

    newLines.push(formatRecord(r, {
      readerId: NEW_READER,
      answer: newAnswer,
      confidence: newConfidence,
      timestamp: new Date(new Date(r.timestamp).getTime() + 1000).toISOString(),
    }));
    added++;
  }

  const totalRecords = records.length;
  const agreementRate = ((agreed / totalRecords) * 100).toFixed(1);

  writeFileSync(OUTPUT_PATH, newLines.join("\n"), "utf-8");
  console.log(`\n✅ Ensemble calibration CSV: ${OUTPUT_PATH}`);
  console.log(`  Original reader records: ${records.length}`);
  console.log(`  Second reader records: ${added}`);
  console.log(`  Total records: ${records.length + added}`);
  console.log(`  Simulated agreement rate: ${agreementRate}%`);
  console.log(`  Simulated divergence rate: ${(100 - parseFloat(agreementRate)).toFixed(1)}%`);
  console.log(`\nReader IDs: beta-reader-sim, ${NEW_READER}`);
  console.log(`Total pairs: ${new Set(records.map(r => r.pairId)).size}`);
}

main();
