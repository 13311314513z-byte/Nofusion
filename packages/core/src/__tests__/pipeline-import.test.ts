/**
 * Pipeline Import Tests — covers planFoundationImport and commitFoundationImport (D1).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { planFoundationImport, commitFoundationImport, type ImportDeps } from "../pipeline/pipeline-import.js";
import * as PipelineFoundation from "../pipeline/pipeline-foundation.js";
import { ArchitectAgent } from "../agents/architect.js";
import type { PipelineContext } from "../pipeline/context.js";
import type { FoundationSourceInput } from "../import/foundation-source.js";
import type { ArchitectOutput } from "../agents/architect.js";

function createMockCtx(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    state: { loadBookConfig: vi.fn(), bookDir: vi.fn(), loadChapterIndex: vi.fn(), saveChapterIndex: vi.fn(), snapshotState: vi.fn() } as unknown as PipelineContext["state"],
    config: { logger: undefined, inputGovernanceMode: "v2", writingReviewRetries: 2 } as PipelineContext["config"],
    agentCtxFor: vi.fn().mockReturnValue({ client: {}, model: "test", projectRoot: "/tmp", bookId: "test" }),
    resolveOverride: vi.fn().mockReturnValue({ model: "test", client: {} }),
    agentClients: new Map(),
    chapterContentCache: new Map(),
    memoryIndexFallbackWarned: false,
    ...overrides,
  } as unknown as PipelineContext;
}

function createMockDeps(overrides: Partial<ImportDeps> = {}): ImportDeps {
  return {
    loadBookConfig: vi.fn().mockResolvedValue({ id: "test", title: "Test", platform: "tomato", genre: "xuanhuan", status: "active", targetChapters: 10, chapterWordCount: 3000, createdAt: "", updatedAt: "" }),
    bookDir: vi.fn().mockReturnValue("/tmp/books/test"),
    loadGenreProfile: vi.fn().mockResolvedValue({ profile: { language: "zh", numericalSystem: "chinese" } }),
    scanExistingRoles: vi.fn().mockResolvedValue([]),
    computeRoleChanges: vi.fn().mockReturnValue({ added: [], updated: [], removed: [] }),
    ...overrides,
  };
}

const SAMPLE_INPUT: FoundationSourceInput = { sourceName: "test.md", fileType: "md", text: "# Hello\n\nWorld", purpose: "world" };

describe("planFoundationImport", () => {
  let ctx: PipelineContext;
  let deps: ImportDeps;

  beforeEach(() => {
    ctx = createMockCtx();
    deps = createMockDeps();
    vi.spyOn(PipelineFoundation, "getFoundationRevision").mockResolvedValue("v1");
    vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockResolvedValue({
      storyFrame: "# SF", volumeOutline: "# VO", bookRules: "---\n---\n",
      currentState: "# CS", pendingHooks: "# PH", roles: [{ name: "Test", tier: "main", content: "test" }],
    } as ArchitectOutput);
  });

  it("returns early when no valid sources are provided", async () => {
    const result = await planFoundationImport(ctx, "test", [], undefined, deps);
    expect(result.proposed).toBeUndefined();
    expect(result.warnings).toContain("没有有效的资料可导入");
  });

  it("returns early when all sources are chapter/style purpose", async () => {
    const result = await planFoundationImport(ctx, "test", [
      { sourceName: "ch1.md", fileType: "md", text: "text", purpose: "chapter" },
      { sourceName: "style.md", fileType: "md", text: "text", purpose: "style" },
    ], undefined, deps);
    expect(result.proposed).toBeUndefined();
    expect(result.warnings.some(w => w.includes("不走架构导入"))).toBe(true);
  });

  it("warns when some sources are diverted but proceeds with foundation sources", async () => {
    const result = await planFoundationImport(ctx, "test", [
      SAMPLE_INPUT,
      { sourceName: "ch1.md", fileType: "md", text: "text", purpose: "chapter" },
    ], undefined, deps);
    expect(result.warnings.some(w => w.includes("1 份资料被识别为 chapter/style"))).toBe(true);
  });

  it("includes instruction in context when provided", async () => {
    const result = await planFoundationImport(ctx, "test", [SAMPLE_INPUT], { instruction: "Keep it short" }, deps);
    expect(result.bundle).toBeDefined();
  });

  it("computes role changes from proposed roles", async () => {
    const spy = vi.fn().mockReturnValue({ added: ["role-a"], updated: [], removed: [] });
    deps.computeRoleChanges = spy;
    deps.scanExistingRoles = vi.fn().mockResolvedValue(["role-x"]);
    const result = await planFoundationImport(ctx, "test", [SAMPLE_INPUT], undefined, deps);
    expect(result.roleChanges?.added).toContain("role-a");
  });
});

describe("commitFoundationImport", () => {
  let ctx: PipelineContext;
  let deps: ImportDeps;

  beforeEach(() => {
    ctx = createMockCtx();
    deps = createMockDeps();
    // Mock getFoundationRevision to return a fixed value
    vi.spyOn(PipelineFoundation, "getFoundationRevision").mockResolvedValue("v1");
    // Mock ArchitectAgent to prevent real LLM calls
    vi.spyOn(ArchitectAgent.prototype, "writeFoundationFiles").mockResolvedValue(undefined);
    // Mock assertValidArchitectOutput to pass
    vi.spyOn(PipelineFoundation, "assertValidArchitectOutput").mockImplementation(() => {});
    // Mock copyDir functions
    vi.spyOn(PipelineFoundation, "copyDirShallow").mockResolvedValue(undefined);
    vi.spyOn(PipelineFoundation, "copyDirRecursive").mockResolvedValue(undefined);
  });

  const mockProposed: ArchitectOutput = {
    storyFrame: "# Story Frame", volumeOutline: "# Vol", bookRules: "---\n---\n",
    currentState: "# State", pendingHooks: "# Hooks", roles: [],
  } as unknown as ArchitectOutput;

  it("throws when expectedRevision does not match current", async () => {
    vi.mocked(PipelineFoundation.getFoundationRevision).mockResolvedValue("v1");
    await expect(
      commitFoundationImport(ctx, "test", mockProposed, { expectedRevision: "v2" }, deps),
    ).rejects.toThrow(/书籍架构在预览后已发生变化/);
  });

  it("calls loadBookConfig and writeFoundationFiles on success", async () => {
    vi.mocked(PipelineFoundation.getFoundationRevision).mockResolvedValue("v1");
    await commitFoundationImport(ctx, "test", mockProposed, { expectedRevision: "v1" }, deps);
    expect(deps.loadBookConfig).toHaveBeenCalledWith("test");
    expect(ArchitectAgent.prototype.writeFoundationFiles).toHaveBeenCalled();
  });
});
