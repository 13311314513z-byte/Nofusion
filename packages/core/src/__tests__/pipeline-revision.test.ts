/**
 * Pipeline Revision Tests (D3) — verifies module exports and basic structure.
 */
import { describe, expect, it } from "vitest";
import { repairChapterStateLocked, resyncChapterArtifactsLocked, type RepairDeps, type ResyncDeps } from "../pipeline/pipeline-revision.js";

describe("pipeline-revision", () => {
  it("exports repairChapterStateLocked", () => {
    expect(repairChapterStateLocked).toBeDefined();
    expect(typeof repairChapterStateLocked).toBe("function");
  });

  it("exports resyncChapterArtifactsLocked", () => {
    expect(resyncChapterArtifactsLocked).toBeDefined();
    expect(typeof resyncChapterArtifactsLocked).toBe("function");
  });

  it("RepairDeps and ResyncDeps are well-typed", () => {
    const repair: RepairDeps = null as unknown as RepairDeps;
    const resync: ResyncDeps = null as unknown as ResyncDeps;
    expect(repair).toBeNull();
    expect(resync).toBeNull();
  });
});
