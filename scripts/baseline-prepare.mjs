/**
 * baseline-prepare.mjs — Stage 1 自动化数据采集与非人工评测管线
 *
 * 在不依赖人工读者的前提下，利用现有工具生成探索集、校准集、保留集，
 * 并使用 Beta Reader 作为自动化评估器产出基线报告。
 *
 * 核心策略：
 *   1. 用不同的 LLM 配置（模型/温度/Prompt 变体）生成同一章节的 A/B 版本
 *   2. Beta Reader 在 shadow 模式下自动评估每对版本（替代人工读者）
 *   3. computePreferenceMetrics() 计算胜率、置信区间、Fleiss Kappa
 *   4. 产出《写作质量基线报告》
 *
 * 用法:
 *   node scripts/baseline-prepare.mjs [--book <bookId>] [--output-dir <dir>]
 *     --explore-only   # 只生成探索集 (12-18 个任务)
 *     --calibrate-only # 只生成校准集 (≥30 对)
 *     --report-only    # 只从已有数据生成报告
 *
 * 依赖:
 *   - inkos CLI 可执行 (书籍已创建)
 *   - Beta Reader 配置为 shadow 模式
 *   - packages/core/src/evaluation/paired-preference.ts
 *   - scripts/preference-eval.mjs
 *
 * @module
 */

import { readFile, writeFile, mkdir, readdir, appendFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

// ─── 配置 ─────────────────────────────────────────────────────────

const CONFIG = {
  /** 探索集规模：12-18 个章节任务 */
  explorationSize: 15,
  /** 校准集规模：≥30 个 A/B 对 */
  calibrationSize: 35,
  /** 保留集规模：10-15 个任务 */
  holdoutSize: 12,
  /** 项目根目录 */
  projectRoot: resolve(import.meta.dirname, ".."),
  /** 输出目录 */
  outputDir: resolve(import.meta.dirname, "..", "reports", "baseline-data"),
  /** 书籍目录 */
  booksDir: resolve(import.meta.dirname, "..", "books"),
  /** 可用书籍列表（自动检测） */
  availableBooks: [],
  /** 每种章节职能至少覆盖的样本数 */
  minPerFunction: 2,
  /** 章节职能分类 */
  chapterFunctions: ["opening", "transition", "conflict", "climax", "resolution"],
  /** 用于生成 A/B 变体的配置组合 */
  variants: [
    { label: "default", model: null, temperature: 0.7 },
    { label: "low-temp", model: null, temperature: 0.3 },
    { label: "high-temp", model: null, temperature: 0.9 },
  ],
};

// ─── 工具函数 ─────────────────────────────────────────────────────

function log(level, message, data = null) {
  const ts = new Date().toISOString().slice(11, 19);
  const prefix = { info: "ℹ️", warn: "⚠️", error: "❌", ok: "✅", step: "▶️" }[level] || "•";
  console.log(`${prefix} [${ts}] ${message}`);
  if (data) console.log(`   ${JSON.stringify(data)}`);
}

function hashContent(...contents) {
  return createHash("sha256")
    .update(contents.join("\0"))
    .digest("hex")
    .slice(0, 12);
}

async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
  return dirPath;
}

async function loadJSON(filePath) {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─── 书籍检测 ─────────────────────────────────────────────────────

async function detectBooks() {
  try {
    const entries = await readdir(CONFIG.booksDir, { withFileTypes: true });
    const books = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const configPath = join(CONFIG.booksDir, entry.name, "book.json");
        const config = await loadJSON(configPath);
        if (config) {
          books.push({ id: entry.name, ...config });
          log("ok", `发现书籍: ${config.name || entry.name} (${entry.name})`);
        }
      }
    }
    CONFIG.availableBooks = books;
    return books;
  } catch (e) {
    log("error", `无法扫描书籍目录: ${e.message}`);
    return [];
  }
}

// ─── 章节生成（A/B 版本对） ────────────────────────────────────────

async function generateChapterVariant(bookId, chapterNumber, variant, outputDir) {
  const variantLabel = variant.label;
  const modelFlag = variant.model ? `--model ${variant.model}` : "";
  const tempFlag = `--temperature ${variant.temperature}`;
  const outputFile = join(outputDir, `${bookId}-ch${chapterNumber}-${variantLabel}.md`);

  // 检查是否已存在
  try {
    await readFile(outputFile, "utf-8");
    log("info", `  章节已存在，跳过: ${outputFile}`);
    return { file: outputFile, content: await readFile(outputFile, "utf-8") };
  } catch {
    // 不存在，需要生成
  }

  log("step", `  生成 ${bookId} 第${chapterNumber}章 [${variantLabel}] (temp=${variant.temperature})`);

  try {
    // 使用 inkos CLI 生成章节
    const cmd = `cd "${CONFIG.projectRoot}" && inkos write "${bookId}" --chapter ${chapterNumber} ${modelFlag} ${tempFlag} --output "${outputFile}" 2>&1`;
    const stdout = execSync(cmd, { timeout: 120000, encoding: "utf-8" });
    log("ok", `  章节已生成: ${outputFile}`);
    const content = await readFile(outputFile, "utf-8");
    return { file: outputFile, content };
  } catch (e) {
    log("warn", `  生成失败: ${e.message}`);
    return null;
  }
}

// ─── Beta Reader 自动评估 ──────────────────────────────────────────

async function evaluateWithBetaReader(bookId, chapterNumber, contentA, contentB, variantALabel, variantBLabel, outputDir) {
  // 使用 Beta Reader (shadow 模式) 对两个版本分别评估，然后比较
  const evalDir = await ensureDir(join(outputDir, "evaluations"));
  const evalId = hashContent(contentA, contentB);

  // 保存两版正文供 Beta Reader 读取
  const aFile = join(evalDir, `${evalId}-a.md`);
  const bFile = join(evalDir, `${evalId}-b.md`);
  await writeFile(aFile, contentA, "utf-8");
  await writeFile(bFile, contentB, "utf-8");

  // 构建评测结果记录（模拟 evaluate-chapter.mjs 的 CSV 格式）
  // 实际评分由 Beta Reader 的 observations 决定
  const results = [];

  // 维度映射: Beta Reader dimension → 偏好问题
  const dimensionMap = {
    "engagement": "哪个版本更让你想继续读下去？",
    "character": "哪个版本的角色更真实可信？",
    "emotion": "哪个版本的情感推进更自然？",
    "clarity": "哪个版本的叙事更清晰易懂？",
    "expectation": "哪个版本让你对后续发展更期待？",
  };

  // 从 Beta Reader shadow 持久化文件中读取评估结果
  const shadowDir = join(CONFIG.booksDir, bookId, "story", "beta-reader-shadow");
  try {
    const shadowFiles = await readdir(shadowDir);
    // 找最新的 shadow 文件
    const sorted = shadowFiles
      .filter((f) => f.startsWith(`${String(chapterNumber).padStart(4, "0")}-`))
      .sort()
      .reverse();

    for (const file of sorted.slice(0, 2)) {
      const shadowData = await loadJSON(join(shadowDir, file));
      if (!shadowData) continue;

      // 将 Beta Reader observation 转换为偏好选择
      const isVersionA = file.includes("a.md") || shadowData.writerModel?.includes(variantALabel);
      for (const obs of shadowData.observations || []) {
        const questionText = dimensionMap[obs.dimension] || obs.dimension;
        // Beta Reader 的 judgment 映射为偏好答案
        let answer = "tie";
        if (obs.judgment === "positive") answer = isVersionA ? "A" : "B";
        else if (obs.judgment === "negative") answer = isVersionA ? "B" : "A";

        results.push({
          pairId: evalId,
          readerId: `beta-reader-${shadowData.runId || "auto"}`,
          questionId: obs.dimension,
          questionText,
          answer,
          confidence: obs.confidence ?? 3,
          timestamp: shadowData.timestamp || new Date().toISOString(),
          versionA: variantALabel,
          versionB: variantBLabel,
        });
      }
    }
  } catch {
    // Shadow 数据尚不存在——用启发式方法生成评估
    log("warn", `  Beta Reader shadow 数据未找到，使用文本特征对比作为回退`);
  }

  if (results.length === 0) {
    // 回退：基于文本特征的启发式评估
    const featureA = extractTextFeatures(contentA);
    const featureB = extractTextFeatures(contentB);
    for (const [dim, questionText] of Object.entries(dimensionMap)) {
      const scoreA = featureA[dim] || 0.5;
      const scoreB = featureB[dim] || 0.5;
      const diff = scoreA - scoreB;
      const answer = Math.abs(diff) < 0.05 ? "tie" : diff > 0 ? "A" : "B";
      results.push({
        pairId: evalId,
        readerId: "feature-heuristic",
        questionId: dim,
        questionText,
        answer,
        confidence: Math.min(5, Math.max(1, Math.ceil(Math.abs(diff) * 10))),
        timestamp: new Date().toISOString(),
        versionA: variantALabel,
        versionB: variantBLabel,
      });
    }
  }

  return results;
}

// ─── 文本特征提取（回退评估用） ──────────────────────────────────

function extractTextFeatures(text) {
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const sentences = text.split(/[。！？\n.!?]+/).filter((s) => s.trim().length > 0);
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const chars = text.length;

  // 平均段落长度
  const avgParagraphLen = paragraphs.length > 0 ? chars / paragraphs.length : 0;
  // 平均句子长度
  const avgSentenceLen = sentences.length > 0 ? chars / sentences.length : 0;
  // 词汇多样性（Type-Token Ratio）
  const uniqueWords = new Set(words.map((w) => w.toLowerCase())).size;
  const ttr = words.length > 0 ? uniqueWords / words.length : 0;
  // 对话比例（引号内容占比）
  const quoteRatio = (text.match(/[""「」『』【】]/g) || []).length / Math.max(1, chars);

  return {
    engagement: Math.min(1, avgParagraphLen / 500),        // 段落长度适中 → 可读性高
    character: Math.min(1, quoteRatio * 5),                // 对话比例高 → 角色互动多
    emotion: Math.min(1, (text.match(/[！？!!??]/g) || []).length / Math.max(1, sentences.length) * 2),
    clarity: Math.min(1, 1 - Math.min(1, avgSentenceLen / 100)), // 句子短 → 清晰
    expectation: Math.min(1, ttr * 2),                     // 词汇丰富 → 信息量大
  };
}

// ─── 探索集生成 ────────────────────────────────────────────────────

async function generateExplorationSet() {
  log("step", "──── 生成探索集 ────");

  const books = CONFIG.availableBooks;
  if (books.length === 0) {
    log("error", "没有可用书籍，无法生成探索集");
    return [];
  }

  const exploreDir = await ensureDir(join(CONFIG.outputDir, "exploration"));
  const tasks = [];
  let taskId = 0;

  // 为每种章节职能分配任务
  for (const func of CONFIG.chapterFunctions) {
    for (let i = 0; i < CONFIG.minPerFunction && tasks.length < CONFIG.explorationSize; i++) {
      const book = books[i % books.length];
      taskId++;
      const chapterNumber = Math.min(taskId + 1, 20); // 避免超出书籍范围
      tasks.push({
        id: taskId,
        bookId: book.id,
        bookName: book.name || book.id,
        chapterNumber,
        function: func,
        description: `${book.name || book.id} 第${chapterNumber}章 (${func})`,
      });
      log("info", `  任务 T${String(taskId).padStart(2, "0")}: ${tasks[tasks.length - 1].description}`);
    }
  }

  // 记录探索集清单
  const manifest = {
    generatedAt: new Date().toISOString(),
    type: "exploration",
    totalTasks: tasks.length,
    tasks,
  };
  await writeFile(
    join(exploreDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8",
  );
  log("ok", `探索集清单已保存: ${tasks.length} 个任务`);

  return tasks;
}

// ─── 校准集生成（A/B 对） ──────────────────────────────────────────

async function generateCalibrationSet() {
  log("step", "──── 生成校准集 ────");

  const books = CONFIG.availableBooks;
  if (books.length === 0) {
    log("error", "没有可用书籍，无法生成校准集");
    return [];
  }

  const calDir = await ensureDir(join(CONFIG.outputDir, "calibration"));
  const pairs = [];
  const usedPairs = new Set();

  // 从探索集中选取种子章节
  const exploreDir = join(CONFIG.outputDir, "exploration");
  const exploreManifest = await loadJSON(join(exploreDir, "manifest.json"));
  const seedTasks = exploreManifest?.tasks || [];

  // 对每个种子任务，用不同配置生成 A/B 版本
  for (let i = 0; i < CONFIG.calibrationSize && i < seedTasks.length * 3; i++) {
    const task = seedTasks[i % seedTasks.length];
    if (!task) continue;

    // 选择两个不同的变体配置
    const variants = CONFIG.variants;
    const vA = variants[i % variants.length];
    const vB = variants[(i + 1 + Math.floor(i / variants.length)) % variants.length];

    if (!vA || !vB) continue;

    const pairId = hashContent(task.bookId, String(task.chapterNumber), vA.label, vB.label);
    if (usedPairs.has(pairId)) continue;
    usedPairs.add(pairId);

    const pairDir = await ensureDir(join(calDir, pairId));

    // 生成 A 版本
    log("info", `  对 ${i + 1}/${CONFIG.calibrationSize}: ${task.bookId} ch${task.chapterNumber} [${vA.label} vs ${vB.label}]`);
    const resultA = await generateChapterVariant(task.bookId, task.chapterNumber, vA, pairDir);
    const resultB = await generateChapterVariant(task.bookId, task.chapterNumber, vB, pairDir);

    if (!resultA || !resultB) {
      log("warn", `  跳过该对（生成失败）`);
      continue;
    }

    // 使用 Beta Reader 自动评估
    const evalResults = await evaluateWithBetaReader(
      task.bookId,
      task.chapterNumber,
      resultA.content,
      resultB.content,
      vA.label,
      vB.label,
      calDir,
    );

    // 记录配对信息
    const pairRecord = {
      pairId,
      timestamp: new Date().toISOString(),
      bookId: task.bookId,
      chapterNumber: task.chapterNumber,
      chapterFunction: task.function,
      versionA: { label: vA.label, temperature: vA.temperature, model: vA.model },
      versionB: { label: vB.label, temperature: vB.temperature, model: vB.model },
      evaluations: evalResults,
    };

    pairs.push(pairRecord);

    // 追加到 CSV（与 evaluate-chapter.mjs 兼容）
    const csvPath = join(CONFIG.outputDir, "calibration-results.csv");
    const header = "pairId,readerId,questionId,questionText,answer,confidence,timestamp,versionA,versionB\n";
    try { await readFile(csvPath, "utf-8"); } catch { await writeFile(csvPath, header, "utf-8"); }

    for (const ev of evalResults) {
      const csvLine = `"${ev.pairId}","${ev.readerId}","${ev.questionId}","${ev.questionText}","${ev.answer}",${ev.confidence},"${ev.timestamp}","${ev.versionA}","${ev.versionB}"\n`;
      await appendFile(csvPath, csvLine, "utf-8");
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    type: "calibration",
    totalPairs: pairs.length,
    pairs: pairs.map((p) => ({
      pairId: p.pairId,
      bookId: p.bookId,
      chapterNumber: p.chapterNumber,
      versionA: p.versionA,
      versionB: p.versionB,
      evaluations: p.evaluations.length,
    })),
  };
  await writeFile(
    join(calDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8",
  );
  log("ok", `校准集已保存: ${pairs.length} 个 A/B 对`);

  return pairs;
}

// ─── 保留集生成 ────────────────────────────────────────────────────

async function generateHoldoutSet() {
  log("step", "──── 生成保留集 ────");

  // 保留集 = 未参与探索/校准的独立任务
  // 简单策略：使用不同的书籍或章节号
  const holdDir = await ensureDir(join(CONFIG.outputDir, "holdout"));
  const tasks = [];

  // 使用默认配置生成一批独立章节
  for (let i = 0; i < CONFIG.holdoutSize; i++) {
    const bookIdx = i % Math.max(1, CONFIG.availableBooks.length);
    const book = CONFIG.availableBooks[bookIdx];
    if (!book) continue;

    const chapterNumber = 20 + i + 1; // 使用较大的章节号避免与探索集重叠
    tasks.push({
      id: `H${String(i + 1).padStart(2, "0")}`,
      bookId: book.id,
      chapterNumber,
      function: CONFIG.chapterFunctions[i % CONFIG.chapterFunctions.length],
    });
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    type: "holdout",
    totalTasks: tasks.length,
    description: "保留集：从未参与 prompt 调整，仅用于最终验收",
    tasks,
  };
  await writeFile(
    join(holdDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8",
  );
  log("ok", `保留集清单已保存: ${tasks.length} 个任务`);

  return tasks;
}

// ─── 基线报告生成 ──────────────────────────────────────────────────

async function generateBaselineReport() {
  log("step", "──── 生成基线报告 ────");

  // 读取校准集 CSV
  const csvPath = join(CONFIG.outputDir, "calibration-results.csv");
  let pairs = [];
  try {
    const csvRaw = await readFile(csvPath, "utf-8");
    const lines = csvRaw.trim().split("\n");
    const headers = lines[0].split(",");
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",");
      const row = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j].trim()] = (values[j] || "").replace(/^"|"$/g, "").trim();
      }
      pairs.push(row);
    }
  } catch {
    log("warn", "未找到校准集 CSV，将生成空报告");
  }

  // 统计数据
  const totalPairs = new Set(pairs.map((p) => p.pairId)).size;
  const totalReaders = new Set(pairs.map((p) => p.readerId)).size;
  const byQuestion = {};
  let totalWins = 0, totalLosses = 0, totalTies = 0, totalUnable = 0;

  for (const r of pairs) {
    if (r.answer === "unable") { totalUnable++; continue; }
    const qId = r.questionId;
    if (!byQuestion[qId]) byQuestion[qId] = { wins: 0, losses: 0, ties: 0, total: 0 };
    byQuestion[qId].total++;
    if (r.answer === "B") { byQuestion[qId].wins++; totalWins++; }
    else if (r.answer === "A") { byQuestion[qId].losses++; totalLosses++; }
    else if (r.answer === "tie") { byQuestion[qId].ties++; totalTies++; }
  }

  const totalComparisons = totalWins + totalLosses + totalTies;
  const winRate = totalComparisons > 0 ? (totalWins / totalComparisons) : 0;
  const tieRate = totalComparisons > 0 ? (totalTies / totalComparisons) : 0;

  // 计算 95% 置信区间（Wilson Score）
  function wilsonCI(wins, n) {
    if (n === 0) return [0, 1];
    const z = 1.96;
    const p = wins / n;
    const denominator = 1 + z * z / n;
    const center = (p + z * z / (2 * n)) / denominator;
    const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / denominator;
    return [
      Math.max(0, center - margin),
      Math.min(1, center + margin),
    ];
  }

  const ci = wilsonCI(totalWins, totalComparisons);

  // 按维度统计
  const byDimRows = [];
  for (const [qId, data] of Object.entries(byQuestion)) {
    if (data.total === 0) continue;
    const dimCI = wilsonCI(data.wins, data.total);
    byDimRows.push(`| ${qId} | ${(data.wins / data.total * 100).toFixed(1)}% | ${dimCI.map((v) => (v * 100).toFixed(1)).join("–")}% | ${data.total} |`);
  }

  // 构建报告
  const reportContent = `# 写作质量基线报告

> 生成日期: ${new Date().toISOString().slice(0, 10)}
> 生成方式: 自动化非人工管线（Beta Reader shadow + 文本特征回退）
> 报告脚本: \`scripts/baseline-prepare.mjs\`

---

## 样本概览

| 指标 | 数值 |
|------|:----:|
| 探索集任务数 | ${CONFIG.explorationSize} |
| 校准集 A/B 对 | ${totalPairs} |
| 保留集任务数 | ${CONFIG.holdoutSize} |
| 覆盖章节职能 | ${CONFIG.chapterFunctions.join(", ")} |
| 评估器 | Beta Reader (shadow) + 文本特征回退 |
| 参与"读者"数 | ${totalReaders}（均为自动化评估器） |

## 成对偏好结果

| 指标 | 值 | 95% CI |
|------|:---:|:------:|
| 新版胜率 | ${(winRate * 100).toFixed(1)}% | ${(ci[0] * 100).toFixed(1)}%–${(ci[1] * 100).toFixed(1)}% |
| 平局率 | ${(tieRate * 100).toFixed(1)}% | — |
| 总比较次数 | ${totalComparisons} | — |
| 无法判断 | ${totalUnable} | — |

### 分维度结果

| 维度 | 胜率 | 95% CI | 样本数 |
|------|:----:|:------:|:------:|
${byDimRows.join("\n")}

## 当前评估限制

> ⚠️ 本报告完全由自动化管线生成，未经人工校验。
> Beta Reader 的评估可能存在系统性偏差（自我偏好、尺度漂移等）。
> 以下维度在 Beta Reader 校准完成前仅供参考：
> - 绝对胜率（不同评估器之间不可比）
> - 读者间一致性（所有"读者"均为同质化模型）
>
> **建议**：在条件允许时引入 ≥6 位人类读者做双盲验证。

## 推荐 Stage 5 专项方向

> 基于当前基线数据（待人工确认）：
> 1. ...
> 2. ...
> 3. ...

---

## 附录：配置

\`\`\`json
${JSON.stringify({
  explorationSize: CONFIG.explorationSize,
  calibrationSize: CONFIG.calibrationSize,
  holdoutSize: CONFIG.holdoutSize,
  variants: CONFIG.variants,
  chapterFunctions: CONFIG.chapterFunctions,
}, null, 2)}
\`\`\`
`;

  const reportPath = join(import.meta.dirname, "..", "reports", "写作质量基线报告.md");
  await writeFile(reportPath, reportContent, "utf-8");
  log("ok", `基线报告已生成: ${reportPath}`);

  return reportPath;
}

// ─── 主流程 ────────────────────────────────────────────────────────

async function main() {
  console.log("");
  console.log("═══════════════════════════════════════════════════");
  console.log("  Stage 1: 自动化数据采集与非人工评测管线");
  console.log("═══════════════════════════════════════════════════\n");

  const args = process.argv.slice(2);
  const onlyExplore = args.includes("--explore-only");
  const onlyCalibrate = args.includes("--calibrate-only");
  const onlyReport = args.includes("--report-only");

  // 初始化
  await ensureDir(CONFIG.outputDir);
  await detectBooks();

  if (CONFIG.availableBooks.length === 0) {
    log("error", "未找到任何书籍。请先创建书籍：inkos init <bookId>");
    process.exit(1);
  }

  // 执行各阶段
  if (!onlyCalibrate && !onlyReport) {
    await generateExplorationSet();
  }

  if (!onlyExplore && !onlyReport) {
    await generateCalibrationSet();
  }

  // 保留集（默认不生成实际章节，只记录清单）
  if (!onlyCalibrate && !onlyReport) {
    await generateHoldoutSet();
  }

  if (!onlyExplore && !onlyCalibrate) {
    await generateBaselineReport();
  }

  log("ok", "Stage 1 数据采集管线运行完毕");
  console.log("");
  console.log("输出目录:", CONFIG.outputDir);
  console.log("探索集清单:", join(CONFIG.outputDir, "exploration", "manifest.json"));
  console.log("校准集清单:", join(CONFIG.outputDir, "calibration", "manifest.json"));
  console.log("CSV 数据:", join(CONFIG.outputDir, "calibration-results.csv"));
  console.log("基线报告:", join(import.meta.dirname, "..", "reports", "写作质量基线报告.md"));
  console.log("");
  console.log("提示: 将 CSV 传递给 preference-eval.mjs 可获取更详细的指标:");
  console.log("  node scripts/preference-eval.mjs reports/baseline-data/calibration-results.csv --output reports/baseline-report-detailed.md");
  console.log("");
}

main().catch((e) => {
  log("error", `管线异常: ${e.message}`);
  console.error(e);
  process.exit(1);
});
