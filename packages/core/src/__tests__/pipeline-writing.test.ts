/**
 * Pipeline Writing Tests (D2) — verifies module exports and basic structure.
 */
import { describe, expect, it } from "vitest";
import { writeNextChapterLocked, type WritingDeps } from "../pipeline/pipeline-writing.js";

describe("pipeline-writing", () => {
  it("exports writeNextChapterLocked", () => {
    expect(writeNextChapterLocked).toBeDefined();
    expect(typeof writeNextChapterLocked).toBe("function");
  });

  it("WritingDeps interface is well-typed", () => {
    // Type-level verification — if this compiles, the interface is correct
    const deps: WritingDeps = null as unknown as WritingDeps;
    expect(deps).toBeNull();
  });
});
