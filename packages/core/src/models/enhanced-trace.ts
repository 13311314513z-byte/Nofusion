/**
 * Enhanced Trace Model — richer per-chapter pipeline trace data.
 *
 * Extends the basic trace.json with metric values, timing data,
 * agent decisions, and causal chain links for full pipeline
 * observability.
 *
 * @module
 */

import { z } from "zod";
import { MetricValueSchema } from "../utils/quantitative-metrics.js";

// ─── Stage timing ──────────────────────────────────────────────────

export const StageTimingSchema = z.object({
  stage: z.string(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  durationMs: z.number().int().positive(),
  tokenUsage: z
    .object({
      prompt: z.number().int().nonnegative().optional(),
      completion: z.number().int().nonnegative().optional(),
      total: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export type StageTiming = z.infer<typeof StageTimingSchema>;

// ─── Agent decision record ─────────────────────────────────────────

export const AgentDecisionSchema = z.object({
  agent: z.string(),
  decision: z.string(),
  alternatives: z.array(z.string()).default([]),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
});

export type AgentDecision = z.infer<typeof AgentDecisionSchema>;

// ─── Enhanced trace ────────────────────────────────────────────────

export const EnhancedTraceSchema = z.object({
  bookId: z.string().min(1),
  chapterNumber: z.number().int().positive(),
  generatedAt: z.string().datetime(),

  /** Per-agent timing records. */
  timings: z.array(StageTimingSchema).default([]),

  /** Quantitative metrics (10 trigger points). */
  metrics: z.array(MetricValueSchema).default([]),

  /** Key decisions made by agents during this chapter. */
  decisions: z.array(AgentDecisionSchema).default([]),

  /** Causal links between events (from event-chain). */
  eventChainRefs: z.array(z.string()).default([]),

  /** Rule stack applied during this write cycle. */
  ruleStackRefs: z.array(z.string()).default([]),

  /** Style profile used (if any). */
  styleProfileId: z.string().optional(),

  /** Number of revision attempts. */
  revisionCount: z.number().int().nonnegative().default(0),

  /** Audit results summary. */
  auditSummary: z
    .object({
      totalIssues: z.number().int().nonnegative(),
      criticalCount: z.number().int().nonnegative(),
      passRate: z.number().min(0).max(1),
    })
    .optional(),

  /** Full trace metadata (for future extensions). */
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type EnhancedTrace = z.infer<typeof EnhancedTraceSchema>;

// ─── Helpers ───────────────────────────────────────────────────────

/** Create a stage timing record from start and end timestamps. */
export function createStageTiming(
  stage: string,
  startedAt: Date,
  completedAt: Date,
  tokenUsage?: { prompt?: number; completion?: number },
): StageTiming {
  return {
    stage,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    tokenUsage: tokenUsage
      ? {
          ...tokenUsage,
          total: (tokenUsage.prompt ?? 0) + (tokenUsage.completion ?? 0),
        }
      : undefined,
  };
}
