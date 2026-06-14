/**
 * beta-reader-calibrate.mjs — Beta Reader 校准报告生成器
 *
 * 读取 `story/beta-reader-shadow/` 目录中的运行记录，生成校准报告：
 *   - 不同 Reader 运行之间的一致性（Fleiss Kappa）
 *   - 各维度的 judgment 分布
 *   - 置信度校准（confidence vs accuracy）
 *   - Writer/Reader 模型家族分布
 *   - 章节覆盖统计
 *
 * 用法:
 *   node scripts/beta-reader-calibrate.mjs <bookDir> [--output report.md]
 *
 * 依赖:
 *   - Beta Reader shadow 数据已持久化到 story/beta-reader-shadow/
 *   - 每份 shadow 文件包含 runId, chapterNumber, writerModel, readerModel, observations
 *
 * @module
 */

import { readFile, writeFile, readdir } from "node:fs/promises"
import { join, resolve } from "node:path"
// ─── 类型（JSDoc，非 TS interface ─── mjs 文件不支持 TS 语法） ───

/** @typedef {{ readonly runId, readonly chapterNumber, readonly title, readonly timestamp, readonly writerModel|{readonly provider, readonly model}, readonly readerModel: {readonly provider, readonly model, readonly promptHash, readonly version}, readonly observations: ReadonlyArray<{readonly dimension: "engagement"|"clarity"|"emotion"|"character"|"expectation", readonly judgment: "positive"|"mixed"|"negative", readonly evidence: ReadonlyArray<{readonly startParagraph, readonly endParagraph, readonly reason}>, readonly confidence}> }} ShadowEntry */

// ─── 工具函数 ─────────────────────────────────────────────────────

function log(level, message, data = null) {
  const ts = new Date().toISOString().slice(11, 19)
  const prefix = { info: "ℹ️", warn: "⚠️", error: "❌", ok: "✅" }[level] || "•"
  console.log(`${prefix} [${ts}] ${message}`)
  if (data) console.log(`   ${JSON.stringify(data)}`)
}

/**
 * 计算两 Reader 之间的原始同意率
 * @param {ShadowEntry} a
 * @param {ShadowEntry} b
 * @returns {number|null}
 */
function agreementRate(a, b) {
  let agreements = 0
  let comparisons = 0
  for (const obsA of a.observations) {
    for (const obsB of b.observations) {
      if (obsA.dimension !== obsB.dimension) continue
      comparisons++
      if (obsA.judgment === obsB.judgment) agreements++
    }
  }

  return comparisons > 0 ? agreements / comparisons : null
}

/**
 * 计算广义 Fleiss Kappa（多 Reader 一致性）
 * @param {ShadowEntry[]} entries
 * @returns {number|null}
 */
function fleissKappa(entries) {
  if (entries.length < 2) return null
  const categories = ["positive", "mixed", "negative"]
  const dimensions = ["engagement", "clarity", "emotion", "character", "expectation"]
  const n = entries.length; // number of "raters"

  let totalAgreement = 0
  let totalExpected = 0
  let totalSubjects = 0
  for (const dim of dimensions) {
    // For each dimension, find chapters where multiple readers have observations
    /** @type {Record<number, ShadowEntry[]>} */
    const chapterGroups = {}
    for (const entry of entries) {
      const hasDim = entry.observations.some((o) => o.dimension === dim)
      if (hasDim) {
        if (!chapterGroups[entry.chapterNumber]) chapterGroups[entry.chapterNumber] = []
        chapterGroups[entry.chapterNumber].push(entry)
      }
    }

    for (const group of Object.values(chapterGroups)) {
      if (group.length < 2) continue
      // Count how many raters assigned each category
      const counts = { positive: 0, mixed: 0, negative: 0 }
      for (const rater of group) {
        const obs = rater.observations.find((o) => o.dimension === dim)
        if (obs) counts[obs.judgment]++
      }

      const ni = group.length; // raters for this subject
      const sumSquares = Object.values(counts).reduce((sum, c) => sum + c * c, 0)
      // Observed agreement (Pi)
      const Pi = (sumSquares - ni) / (ni * (ni - 1))
      // Expected agreement (Pe) — proportion of each category across all raters
      const totalAssignments = Object.values(counts).reduce((a, b) => a + b, 0)
      const Pe = categories.reduce((sum, cat) => {
        const pj = (counts[cat] ?? 0) / totalAssignments
        return sum + pj * pj
      }, 0)
      totalAgreement += Pi
      totalExpected += Pe
      totalSubjects++
    }
  }

  if (totalSubjects === 0) return null
  const Pbar = totalAgreement / totalSubjects
  const Pc = totalExpected / totalSubjects
  if (Pc >= 1) return null
  return (Pbar - Pc) / (1 - Pc)
}

/**
 * 计算置信度校准曲线
 * @param {ShadowEntry[]} entries
 * @returns {Array<{bucket, count, positiveRatio, avgConfidence}>}
 */
function confidenceCalibration(entries) {
  const buckets = {}
  for (const entry of entries) {
    for (const obs of entry.observations) {
      const bucket = `${Math.floor(obs.confidence * 10) * 10}-${Math.min(100, Math.ceil(obs.confidence * 10) * 10)}`
      if (!buckets[bucket]) buckets[bucket] = { total: 0, positive: 0, confSum: 0 }
      buckets[bucket].total++
      if (obs.judgment === "positive") buckets[bucket].positive++
      buckets[bucket].confSum += obs.confidence
    }
  }

  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, data]) => ({
      bucket,
      count: data.total,
      positiveRatio: data.positive / data.total,
      avgConfidence: data.confSum / data.total,
    }))
}

/**
 * 提取模型家族（从模型 ID 字符串中提取第一个 segment）
 */
function extractFamily(modelString) {
  return modelString.split(/[-/]/)[0]?.toLowerCase() ?? "unknown"
}

// ─── 主流程 ───────────────────────────────────────────────────────

async function main() {
  console.log("")
  console.log("═══════════════════════════════════════════════")
  console.log("  Beta Reader 校准报告生成器")
  console.log("═══════════════════════════════════════════════\n")
  const args = process.argv.slice(2)
  const bookDir = args.find((a) => !a.startsWith("--"))
  const outputFlag = args.find((a) => a.startsWith("--output="))
  const outputPath = outputFlag ? outputFlag.split("=")[1] : null
  if (!bookDir) {
    console.error("用法: node scripts/beta-reader-calibrate.mjs <bookDir> [--output=report.md]")
    process.exit(1)
  }

  const resolvedBookDir = resolve(bookDir)
  const shadowDir = join(resolvedBookDir, "story", "beta-reader-shadow")
  // 读取所有 shadow 文件
  let files
  try {
    files = await readdir(shadowDir)
  } catch {
    log("error", `无法读取 shadow 目录: ${shadowDir}`)
    log("info", "请确认 Beta Reader shadow 模式已运行并持久化了结果。")
    process.exit(1)
  }

  const shadowFiles = files.filter((f) => f.endsWith(".json")).sort()
  if (shadowFiles.length === 0) {
    log("warn", "shadow 目录为空，无校准数据")
    log("info", `目录: ${shadowDir}`)
    process.exit(0)
  }

  log("info", `发现 ${shadowFiles.length} 个 shadow 文件`)
  // 解析所有 shadow 数据
  /** @type {ShadowEntry[]} */
  const entries = []
  for (const file of shadowFiles) {
    try {
      const raw = await readFile(join(shadowDir, file), "utf-8")
      const data = JSON.parse(raw)
      entries.push(data)
    } catch (e) {
      log("warn", `解析失败: ${file} — ${e.message}`)
    }
  }

  log("ok", `成功解析 ${entries.length} 条运行记录`)
  // 统计
  const totalObservations = entries.reduce((sum, e) => sum + e.observations.length, 0)
  const uniqueChapters = new Set(entries.map((e) => e.chapterNumber))
  const uniqueRuns = new Set(entries.map((e) => e.runId))
  // Writer 模型家族分布
  const writerFamilies = {}
  for (const e of entries) {
    const modelStr = typeof e.writerModel === "string" ? e.writerModel : (e.writerModel && e.writerModel.model) || "unknown"
    const family = extractFamily(modelStr)
    writerFamilies[family] = (writerFamilies[family] ?? 0) + 1
  }

  // Reader 模型家族分布
  const readerFamilies = {}
  for (const e of entries) {
    const family = extractFamily(e.readerModel.model)
    readerFamilies[family] = (readerFamilies[family] ?? 0) + 1
  }

  // 分维度统计
  const byDimension = {}
  for (const e of entries) {
    for (const obs of e.observations) {
      if (!byDimension[obs.dimension]) {
        byDimension[obs.dimension] = { positive: 0, mixed: 0, negative: 0, total: 0 }
      }
      byDimension[obs.dimension].total++
      byDimension[obs.dimension][obs.judgment]++
    }
  }

  // Reader 间一致性
  const kappa = fleissKappa(entries)
  const pairwiseAgreements = []
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const rate = agreementRate(entries[i], entries[j])
      if (rate !== null) pairwiseAgreements.push(rate)
    }
  }
  const avgPairwiseAgreement = pairwiseAgreements.length > 0
    ? pairwiseAgreements.reduce((a, b) => a + b, 0) / pairwiseAgreements.length
    : null;

  // 置信度校准
  const calibration = confidenceCalibration(entries);

  // 构建报告
  const now = new Date().toISOString().slice(0, 10);
  const reportLines = [
    `# Beta Reader 校准报告`,
    ``,
    `> 生成日期: ${now}`,
    `> 数据来源: \`${shadowDir}\``,
    `> 生成脚本: \`scripts/beta-reader-calibrate.mjs\``,
    ``,
    `---`,
    ``,
    `## 样本概览`,
    ``,
    `| 指标 | 数值 |`,
    `|------|:----:|`,
    `| 运行记录数 | ${entries.length} |`,
    `| 覆盖章节数 | ${uniqueChapters.size} |`,
    `| 总观察数 | ${totalObservations} |`,
    `| 唯一 run ID 数 | ${uniqueRuns.size} |`,
    ``,
    `## Writer 模型分布`,
    ``,
    `| 模型家族 | 运行次数 |`,
    `|---------|:-------:|`,
    ...Object.entries(writerFamilies)
      .sort(([, a], [, b]) => b - a)
      .map(([family, count]) => `| ${family} | ${count} |`),
    ``,
    `## Reader 模型分布`,
    ``,
    `| 模型家族 | 运行次数 |`,
    `|---------|:-------:|`,
    ...Object.entries(readerFamilies)
      .sort(([, a], [, b]) => b - a)
      .map(([family, count]) => `| ${family} | ${count} |`),
    ``,
    `## 分维度判断分布`,
    ``,
    `| 维度 | 正面 | 混合 | 负面 | 总数 | 正面率 |`,
    `|------|:----:|:----:|:----:|:----:|:------:|`,
    ...Object.entries(byDimension)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dim, data]) =>
        `| ${dim} | ${data.positive} | ${data.mixed} | ${data.negative} | ${data.total} | ${(data.positive / data.total * 100).toFixed(1)}% |`),
    ``,
    `## Reader 间一致性`,
    ``,
    `| 指标 | 值 | 说明 |`,
    `|------|:---:|------|`,
    `| Fleiss Kappa | ${kappa !== null ? kappa.toFixed(4) : "N/A"} | ${kappa !== null ? (kappa >= 0.6 ? "✅ 一致性良好" : kappa >= 0.3 ? "⚠️ 一致性中等" : "❌ 一致性差") : "不足 2 位 Reader"}`,
    `| 平均成对同意率 | ${avgPairwiseAgreement !== null ? (avgPairwiseAgreement * 100).toFixed(1) + "%" : "N/A"} | — |`,
    `| 有效比较对数 | ${pairwiseAgreements.length} | — |`,
    ``,
    `## 置信度校准`,
    ``,
    `| 置信度区间 | 样本数 | 正面率 | 平均置信度 |`,
    `|-----------|:------:|:------:|:----------:|`,
    ...calibration.map((b) =>
      `| ${b.bucket} | ${b.count} | ${(b.positiveRatio * 100).toFixed(1)}% | ${(b.avgConfidence * 100).toFixed(1)}% |`),
    ``,
    `## 校准结论`,
    ``,
    `### 一致性判断`,
    kappa !== null
      ? `- Fleiss Kappa = ${kappa.toFixed(4)} ${kappa >= 0.6 ? "— Reader 间一致性可接受" : kappa >= 0.3 ? "— Reader 间一致性中等，需更多数据" : "— Reader 间一致性差，可能需要调整 Reader prompt"}`
      : "- 数据不足，无法计算 Reader 间一致性",
    `- 共 ${pairwiseAgreements.length} 对 Reader 比较，平均同意率 ${avgPairwiseAgreement !== null ? (avgPairwiseAgreement * 100).toFixed(1) + "%" : "N/A"}`,
    ``,
    `### 维度覆盖`,
    ...Object.entries(byDimension).map(([dim, data]) =>
      `- **${dim}**: ${data.total} 次观察（正面 ${(data.positive / data.total * 100).toFixed(1)}%）`),
    ``,
    `### ${Object.keys(writerFamilies).length > 0 && Object.keys(readerFamilies).length > 0 ? "模型多样性" : "模型多样性（数据不足）"}`,
    Object.keys(writerFamilies).length > 0
      ? `- Writer 模型: ${Object.entries(writerFamilies).map(([k, v]) => `${k}(${v})`).join(", ")}`
      : "- Writer 模型: 未知",
    Object.keys(readerFamilies).length > 0
      ? `- Reader 模型: ${Object.entries(readerFamilies).map(([k, v]) => `${k}(${v})`).join(", ")}`
      : "- Reader 模型: 未知",
    (Object.keys(writerFamilies).some(function(wf) { return Object.keys(readerFamilies).indexOf(wf) === -1; })
      ? "- 异构约束: ✅ Writer 与 Reader 模型家族存在差异"
      : "- 异构约束: ⚠️ Writer 与 Reader 模型家族相同（自我偏好风险）"),
    ``,
    `### 建议`,
    `- ${entries.length < 10 ? "当前数据量较少（<10 条运行记录），建议积累更多数据后再做校准决策" : "数据量充足，可考虑进入 advisory 模式"}`,
    `- ${totalObservations < 30 ? "观察数不足 30，建议积累更多章节后再评估" : `观察数 ${totalObservations}，已达最低统计门槛`}`,
    `- ${kappa !== null && kappa < 0.3 ? "Reader 间一致性偏低，建议检查 Reader prompt 并增加训练样本" : ""}`,
    ``,
    `---`,
    ``,
    `## 附录：原始文件`,
    ``,
    ...shadowFiles.map((f) => `- \`${f}\``),
    ``,
  ]
  const report = reportLines.join("\n")
  if (outputPath) {
    await writeFile(resolve(outputPath), report, "utf-8")
    log("ok", `校准报告已保存: ${outputPath}`)
  } else {
    console.log("\n" + report)
  }

  log("ok", "校准报告生成完毕")
}

main().catch((e) => {
  log("error", `异常: ${e.message}`)
  console.error(e)
  process.exit(1)
})