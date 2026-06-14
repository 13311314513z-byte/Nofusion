/**
 * Adjustment panel state management.
 * Manages plan/comparison loading, staleness detection, and undo stack.
 * Independent from StyleManager's main state to keep concerns separate.
 */

import type { AdjustmentPlan, StyleComparisonResult } from "@actalk/inkos-core";

export const MAX_UNDO_STEPS = 20;
export const STALE_AFTER_MS = 5 * 60 * 1000; // 5 minutes

export interface AdjustmentState {
  readonly plan: AdjustmentPlan | null;
  readonly comparison: StyleComparisonResult | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly stale: boolean;
  readonly undoStack: ReadonlyArray<{
    readonly text: string;
    readonly timestamp: number;
    readonly label: string;
  }>;
}

export function createInitialAdjustmentState(): AdjustmentState {
  return {
    plan: null,
    comparison: null,
    loading: false,
    error: null,
    stale: false,
    undoStack: [],
  };
}

export interface AdjustmentActions {
  readonly setLoading: (loading: boolean) => void;
  readonly setError: (error: string | null) => void;
  readonly setPlan: (plan: AdjustmentPlan | null) => void;
  readonly setComparison: (comparison: StyleComparisonResult) => void;
  readonly markStale: () => void;
  readonly pushUndo: (text: string, label?: string) => void;
  readonly popUndo: () => string | undefined;
}

export function createAdjustmentReducer(
  state: AdjustmentState,
  setState: (updater: (prev: AdjustmentState) => AdjustmentState) => void,
): AdjustmentActions {
  return {
    setLoading: (loading) => setState((prev) => ({ ...prev, loading, error: loading ? null : prev.error })),
    setError: (error) => setState((prev) => ({ ...prev, error, loading: false })),
    setPlan: (plan) => setState((prev) => ({
      ...prev,
      plan,
      loading: false,
      error: null,
      stale: false,
    })),
    setComparison: (comparison) => setState((prev) => ({ ...prev, comparison })),
    markStale: () => setState((prev) => ({ ...prev, stale: true })),
    pushUndo: (text, label) => setState((prev) => {
      const entry = { text, timestamp: Date.now(), label: label ?? `Undo ${prev.undoStack.length + 1}` };
      const stack = [...prev.undoStack, entry].slice(-MAX_UNDO_STEPS);
      return { ...prev, undoStack: stack };
    }),
    popUndo: () => {
      const entry = state.undoStack[state.undoStack.length - 1];
      if (!entry) return undefined;
      setState((prev) => ({
        ...prev,
        undoStack: prev.undoStack.slice(0, -1),
        stale: true,
      }));
      return entry.text;
    },
  };
}
