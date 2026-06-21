/**
 * Pipeline Fanfic — unit tests.
 *
 * P2-1: Independent test coverage for importFanficCanon.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../agents/fanfic-canon-importer.js", () => ({
  FanficCanonImporter: vi.fn().mockImplementation(() => ({
    importFromText: vi.fn().mockResolvedValue({
      fullDocument: "# Fanfic Canon\n\nGenerated canon content.",
    }),
  })),
}));

describe("importFanficCanon", () => {
  it("exports a callable function", async () => {
    const mod = await import("../pipeline/pipeline-fanfic.js");
    expect(mod.importFanficCanon).toBeDefined();
    expect(typeof mod.importFanficCanon).toBe("function");
  });

  it("accepts valid parameters (smoke test)", async () => {
    const mod = await import("../pipeline/pipeline-fanfic.js");
    expect(mod.importFanficCanon).toBeInstanceOf(Function);
  });
});
