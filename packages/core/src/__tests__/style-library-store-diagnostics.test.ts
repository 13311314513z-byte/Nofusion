import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAuthorProfile,
  saveAuthorDiagnostics,
  listAuthorDiagnostics,
  getAuthorDiagnostics,
} from "../style-library/store.js";

describe("author diagnostics storage", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "inkos-diagnostics-test-"));
  const cleanup = () => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  };

  it("saves and lists diagnostics for an author", async () => {
    await createAuthorProfile(tmpDir, { id: "test-author", name: "Test Author", language: "zh", tags: ["test"] });
    const data = {
      sourceHash: "abc123",
      sampleAdequacy: "limited",
      ruleVersion: "1.0.0",
      aiStyleTags: { heuristicRiskScore: 42 },
      intentRepetitions: [],
      repeatedDescriptions: [],
      transitionClustering: [],
      clauseComplexity: [],
    };
    const entry = await saveAuthorDiagnostics(tmpDir, "test-author", "diag-1", data);
    expect(entry.authorId).toBe("test-author");
    expect(entry.heuristicRiskScore).toBe(42);
    expect(entry.sampleAdequacy).toBe("limited");

    const list = await listAuthorDiagnostics(tmpDir, "test-author");
    expect(list.length).toBe(1);
    expect(list[0].heuristicRiskScore).toBe(42);
  });

  it("returns empty list for author with no diagnostics", async () => {
    await createAuthorProfile(tmpDir, { id: "no-diag", name: "No Diag", language: "zh" });
    const list = await listAuthorDiagnostics(tmpDir, "no-diag");
    expect(list).toEqual([]);
  });

  it("retrieves saved diagnostics data", async () => {
    await createAuthorProfile(tmpDir, { id: "retrieve-author", name: "Retrieve", language: "zh" });
    const data = { sourceHash: "def456", sampleAdequacy: "sufficient", ruleVersion: "1.0.0" };
    await saveAuthorDiagnostics(tmpDir, "retrieve-author", "diag-a", data);
    const retrieved = await getAuthorDiagnostics(tmpDir, "retrieve-author", "diag-a");
    expect(retrieved).toBeDefined();
    expect((retrieved as Record<string, unknown>).sourceHash).toBe("def456");
  });

  it("throws for non-existent author", async () => {
    await expect(saveAuthorDiagnostics(tmpDir, "missing", "d1", {})).rejects.toThrow("Author not found");
  });

  cleanup();
});
