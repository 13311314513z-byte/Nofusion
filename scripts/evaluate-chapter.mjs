/**
 * evaluate-chapter.mjs — CLI tool for collecting paired preference feedback.
 *
 * Presents two versions of a chapter side-by-side (blinded) and asks
 * the reader a series of comparison questions.
 *
 * Usage:
 *   node scripts/evaluate-chapter.mjs <version-a.md> <version-b.md> [--reader reader-name] [--pair-id id] [--output results.csv]
 *
 * Output is appended to a CSV file for later aggregation with preference-eval.mjs.
 */

import { readFile, appendFile, access } from "node:fs/promises";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const QUESTIONS = [
  { id: "engagement", text: "哪个版本更让你想继续读下去？" },
  { id: "character", text: "哪个版本的角色更真实可信？" },
  { id: "emotion", text: "哪个版本的情感推进更自然？" },
  { id: "clarity", text: "哪个版本的叙事更清晰易懂？" },
  { id: "expectation", text: "哪个版本让你对后续发展更期待？" },
];

const answers = ["A", "B", "tie", "unable"];

async function readLines(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((arg, index) => {
    if (arg.startsWith("--")) return false;
    return index === 0 || !args[index - 1]?.startsWith("--");
  });
  const versionAFile = positional[0];
  const versionBFile = positional[1];
  const optionValue = (name) => {
    const inline = args.find((arg) => arg.startsWith(`--${name}=`));
    if (inline) return inline.slice(name.length + 3);
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };

  if (!versionAFile || !versionBFile) {
    console.error("Usage: node scripts/evaluate-chapter.mjs <version-a.md> <version-b.md> [--reader=name] [--pair-id=id] [--output=results.csv]");
    process.exit(1);
  }

  const readerName = optionValue("reader") || "anonymous";
  const outputPath = optionValue("output") || "preference-results.csv";
  const timestamp = new Date().toISOString();

  // Read both versions
  const contentA = await readFile(resolve(versionAFile), "utf-8");
  const contentB = await readFile(resolve(versionBFile), "utf-8");
  const pairId = optionValue("pair-id") || `pair-${createHash("sha256")
    .update(contentA)
    .update("\0")
    .update(contentB)
    .digest("hex")
    .slice(0, 12)}`;

  // Randomize display order to reduce position bias
  const sourceAFirst = Math.random() > 0.5;

  console.log("\n═══════════════════════════════════════════");
  console.log("  章节成对偏好评测");
  console.log("═══════════════════════════════════════════");
  console.log(`评测人: ${readerName}`);
  console.log(`配对ID: ${pairId}`);
  console.log("\n两个版本将以随机顺序展示。请阅读后回答以下问题。\n");

  console.log("────────── 版本 A ──────────");
  console.log(sourceAFirst ? contentA : contentB);
  console.log("\n────────── 版本 B ──────────");
  console.log(sourceAFirst ? contentB : contentA);

  console.log("\n──────────────── 比较 ────────────────");

  const results = [];
  for (const q of QUESTIONS) {
    console.log(`\n${q.id}: ${q.text}`);
    console.log("  选项: A / B / tie（差不多）/ unable（无法判断）");

    let displayAnswer;
    while (!answers.includes(displayAnswer)) {
      displayAnswer = (await readLines("  你的选择: ")).toLowerCase();
      if (displayAnswer === "a") displayAnswer = "A";
      else if (displayAnswer === "b") displayAnswer = "B";
    }
    const answer = displayAnswer === "tie" || displayAnswer === "unable"
      ? displayAnswer
      : sourceAFirst
        ? displayAnswer
        : displayAnswer === "A" ? "B" : "A";

    const confidenceStr = await readLines("  信心程度 (1-5, 5=最确定): ");
    const parsedConfidence = Number.parseInt(confidenceStr, 10);
    const confidence = Number.isInteger(parsedConfidence)
      ? Math.max(1, Math.min(5, parsedConfidence))
      : 3;
    const freeform = await readLines("  备注（可选）: ");

    results.push({
      pairId,
      versionA: versionAFile,
      versionB: versionBFile,
      questionId: q.id,
      questionText: q.text,
      answer,
      confidence,
      freeform,
      readerId: readerName,
      timestamp,
      blindingInfo: JSON.stringify({
        versionAMasked: true,
        versionBMasked: true,
        displayOrder: sourceAFirst ? ["versionA", "versionB"] : ["versionB", "versionA"],
      }),
    });
  }

  // Append to CSV
  const header = "pairId,readerId,questionId,answer,confidence,freeform,timestamp,versionA,versionB,blindingInfo\n";
  const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows = results.map((r) =>
    [
      r.pairId,
      r.readerId,
      r.questionId,
      r.answer,
      r.confidence,
      r.freeform,
      r.timestamp,
      r.versionA,
      r.versionB,
      r.blindingInfo,
    ].map(csvCell).join(","),
  ).join("\n");

  // Check if file exists to decide whether to write header
  try {
    await access(outputPath);
  } catch {
    await appendFile(outputPath, header, "utf-8");
  }
  await appendFile(outputPath, rows + "\n", "utf-8");

  console.log("\n✅ 结果已保存到: " + outputPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
