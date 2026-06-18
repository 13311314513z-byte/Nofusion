/**
 * Performance benchmarks for critical paths.
 * Run with: pnpm --filter @actalk/inkos-core bench
 *
 * Benchmarks focus on pure computation paths (no LLM API calls).
 * Realistic end-to-end latency depends on API response times.
 */
import { bench, describe } from "vitest";

// ── Style analysis (pure computation) ──

describe("style:analyze", () => {
  const sampleText = Array.from({ length: 100 }, () =>
    "夜风拂过窗棂，她轻轻推开门，月光洒在青石板上。远处传来几声犬吠，打破了夜的寂静。"
  ).join("\n");

  bench("analyzeStyle (10K chars)", async () => {
    const { analyzeStyle } = await import("../agents/style-analyzer.js");
    analyzeStyle(sampleText, "benchmark-sample");
  });

  bench("analyzeAITells (10K chars)", async () => {
    const { analyzeAITells } = await import("../agents/ai-tells.js");
    analyzeAITells(sampleText, "zh");
  });
});

// ── Length metrics (hot path in write pipeline) ──

describe("length-metrics", () => {
  const chapterText = "　　" + Array.from({ length: 300 }, () =>
    "这是一段测试文字，用于验证字数统计算法的性能和准确性。"
  ).join("");

  bench("countChapterLength (zh)", async () => {
    const { countChapterLength, resolveLengthCountingMode } = await import("../utils/length-metrics.js");
    const mode = resolveLengthCountingMode("zh");
    countChapterLength(chapterText, mode);
  });
});

// ── Context filtering (hot path in prompt assembly) ──

describe("context-filter", () => {
  const hooks = Array.from({ length: 50 }, (_, i) =>
    `## Hook ${i + 1}\n状态：pending\n描述：角色需要完成一个重要任务。\n关联章节：${i}`
  ).join("\n\n");

  bench("capContextBlock (50 hooks / 8K budget)", async () => {
    const { capContextBlock } = await import("../utils/context-filter.js");
    capContextBlock(hooks, { label: "hooks", maxChars: 8000 });
  });
});
