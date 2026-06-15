/**
 * Quantitative Metrics — 10 measurable trigger points across the pipeline.
 *
 * Each metric is checked at a specific pipeline stage and recorded into
 * the chapter trace. Metrics feed into dashboard analytics, audit trend
 * charts, and style scoring.
 *
 * @module
 */

import { z } from "zod";

// ─── Metric definitions ────────────────────────────────────────────

export const METRIC_DEFINITIONS = {
  /** 1. Chapter word count vs target (Writer completion) */
  wordCountDelta: {
    id: "wordCountDelta",
    label: "字数偏差",
    stage: "writer",
    unit: "字",
    threshold: { warn: 500, error: 1500 },
    description: "实际字数与目标字数的差值",
  },
  /** 2. Dialogue ratio (Observer) */
  dialogueRatio: {
    id: "dialogueRatio",
    label: "对话占比",
    stage: "observer",
    unit: "%",
    threshold: { warn: 15, error: 30 },
    description: "对话内容占总字数的比例",
  },
  /** 3. Action density (Observer) */
  actionDensity: {
    id: "actionDensity",
    label: "动作密度",
    stage: "observer",
    unit: "次/千字",
    threshold: { warn: 2, error: 5 },
    description: "每千字中动作描写的次数",
  },
  /** 4. AI-tell risk score (Auditor) */
  aiTellRisk: {
    id: "aiTellRisk",
    label: "AI腔风险",
    stage: "auditor",
    unit: "分 (0-100)",
    threshold: { warn: 40, error: 70 },
    description: "AI写作痕迹检测风险分数",
  },
  /** 5. Paragraph uniformity (Auditor) */
  paragraphUniformity: {
    id: "paragraphUniformity",
    label: "段落均匀度",
    stage: "auditor",
    unit: "σ",
    threshold: { warn: 50, error: 100 },
    description: "段落长度的标准差（越低越均匀=越可疑）",
  },
  /** 6. Transition word clustering (Auditor) */
  transitionClustering: {
    id: "transitionClustering",
    label: "转折词聚集度",
    stage: "auditor",
    unit: "次/千字",
    threshold: { warn: 3, error: 8 },
    description: "转折词（但是/然而/不过等）的聚集程度",
  },
  /** 7. Clause complexity (Auditor) */
  clauseComplexity: {
    id: "clauseComplexity",
    label: "句式复杂度",
    stage: "auditor",
    unit: "从句/句",
    threshold: { warn: 2.5, error: 4 },
    description: "每句所含从句的平均数量",
  },
  /** 8. Style drift from baseline (Settler) */
  styleDrift: {
    id: "styleDrift",
    label: "风格漂移",
    stage: "settler",
    unit: "距离",
    threshold: { warn: 0.3, error: 0.6 },
    description: "与文风基线的向量距离",
  },
  /** 9. Hook advancement count (Settler) */
  hookAdvancementCount: {
    id: "hookAdvancementCount",
    label: "伏笔推进数",
    stage: "settler",
    unit: "个",
    threshold: { warn: 0, error: 0 }, // No error threshold — informational
    description: "本章推进的伏笔数量",
  },
  /** 10. Endpoint lock compliance (Reviser) */
  endpointLockCompliance: {
    id: "endpointLockCompliance",
    label: "终点锁定合规度",
    stage: "reviser",
    unit: "%",
    threshold: { warn: 80, error: 50 },
    description: "章节结尾与 OpeningFrame/ClosingFrame 的匹配度",
  },
} as const;

export type MetricId = keyof typeof METRIC_DEFINITIONS;

// ─── Metric value schema ───────────────────────────────────────────

export const MetricValueSchema = z.object({
  metricId: z.string(),
  value: z.number(),
  threshold: z.enum(["ok", "warn", "error"]),
  stage: z.string(),
  recordedAt: z.string().datetime(),
  chapterNumber: z.number().int().positive(),
});

export type MetricValue = z.infer<typeof MetricValueSchema>;

// ─── Metric snapshot (all 10 per chapter) ──────────────────────────

export const MetricSnapshotSchema = z.object({
  bookId: z.string().min(1),
  chapterNumber: z.number().int().positive(),
  metrics: z.array(MetricValueSchema),
  generatedAt: z.string().datetime(),
});

export type MetricSnapshot = z.infer<typeof MetricSnapshotSchema>;

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Evaluate a metric value against its thresholds.
 */
export function evaluateThreshold(
  metricId: MetricId,
  value: number,
): "ok" | "warn" | "error" {
  const def = METRIC_DEFINITIONS[metricId];
  if (value >= def.threshold.error) return "error";
  if (value >= def.threshold.warn) return "warn";
  return "ok";
}

/**
 * Create a MetricValue record.
 */
export function createMetricValue(
  metricId: MetricId,
  value: number,
  chapterNumber: number,
): MetricValue {
  return {
    metricId,
    value,
    threshold: evaluateThreshold(metricId, value),
    stage: METRIC_DEFINITIONS[metricId].stage,
    recordedAt: new Date().toISOString(),
    chapterNumber,
  };
}
