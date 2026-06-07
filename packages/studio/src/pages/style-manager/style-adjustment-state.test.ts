import { describe, expect, it } from "vitest";
import {
  createAdjustmentReducer,
  createInitialAdjustmentState,
  MAX_UNDO_STEPS,
  type AdjustmentState,
} from "./style-adjustment-state";

function makeHarness(initial: AdjustmentState = createInitialAdjustmentState()) {
  let state = initial;
  const setState = (updater: (prev: AdjustmentState) => AdjustmentState) => {
    state = updater(state);
  };
  const actions = () => createAdjustmentReducer(state, setState);
  return {
    get state() {
      return state;
    },
    actions,
  };
}

describe("style adjustment state", () => {
  it("returns and removes the latest undo entry", () => {
    const harness = makeHarness();

    harness.actions().pushUndo("before-1", "first");
    harness.actions().pushUndo("before-2", "second");

    expect(harness.state.undoStack).toHaveLength(2);
    expect(harness.actions().popUndo()).toBe("before-2");
    expect(harness.state.undoStack).toHaveLength(1);
    expect(harness.state.undoStack[0]?.text).toBe("before-1");
    expect(harness.state.stale).toBe(true);
  });

  it("caps the undo stack at MAX_UNDO_STEPS", () => {
    const harness = makeHarness();

    for (let i = 0; i < MAX_UNDO_STEPS + 3; i++) {
      harness.actions().pushUndo(`text-${i}`);
    }

    expect(harness.state.undoStack).toHaveLength(MAX_UNDO_STEPS);
    expect(harness.state.undoStack[0]?.text).toBe("text-3");
  });
});
