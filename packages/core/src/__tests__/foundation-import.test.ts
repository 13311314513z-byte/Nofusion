import { describe, expect, it, vi } from "vitest";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArchitectAgent, type ArchitectOutput } from "../agents/architect.js";
import { buildFoundationSourceBundle } from "../import/foundation-source.js";
import { PipelineRunner } from "../pipeline/runner.js";
import { StateManager } from "../state/manager.js";
import type { LLMClient } from "../llm/provider.js";

const TEST_CLIENT = {
  provider: "openai",
  apiFormat: "chat",
  stream: false,
} as unknown as LLMClient;

const proposedFoundation = (): ArchitectOutput => ({
  storyBible: "shim",
  volumeOutline: "shim",
  bookRules: "---\nversion: \"1.0\"\n---\n",
  currentState: "",
  pendingHooks: "new hooks",
  storyFrame: "## 新故事框架\n\n内容",
  volumeMap: "## 新卷纲\n\n内容",
  roles: [{ tier: "major", name: "新角色", content: "# 新角色" }],
});

async function createBookFixture(root: string): Promise<string> {
  const bookDir = join(root, "books", "book");
  await mkdir(join(bookDir, "story", "outline"), { recursive: true });
  await mkdir(join(bookDir, "story", "roles", "主要角色"), { recursive: true });
  await writeFile(join(bookDir, "book.json"), JSON.stringify({
    id: "book",
    title: "测试书",
    platform: "qidian",
    genre: "xuanhuan",
    status: "active",
    targetChapters: 20,
    chapterWordCount: 3000,
    language: "zh",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  }), "utf-8");
  await writeFile(join(bookDir, "story", "outline", "story_frame.md"), "old frame", "utf-8");
  await writeFile(join(bookDir, "story", "outline", "volume_map.md"), "old map", "utf-8");
  await writeFile(join(bookDir, "story", "roles", "主要角色", "旧角色.md"), "# 旧角色", "utf-8");
  await writeFile(join(bookDir, "story", "story_bible.md"), "shim", "utf-8");
  await writeFile(join(bookDir, "story", "character_matrix.md"), "shim", "utf-8");
  await writeFile(join(bookDir, "story", "book_rules.md"), "shim", "utf-8");
  await writeFile(join(bookDir, "story", "current_state.md"), "chapter 12 state", "utf-8");
  await writeFile(join(bookDir, "story", "pending_hooks.md"), "chapter 12 hooks", "utf-8");
  await writeFile(join(bookDir, "story", "emotional_arcs.md"), "chapter 12 emotions", "utf-8");
  return bookDir;
}

function createRunner(root: string): PipelineRunner {
  const runner = new PipelineRunner({
    state: new StateManager(root),
    projectRoot: root,
    client: TEST_CLIENT,
    model: "test-model",
  } as unknown as ConstructorParameters<typeof PipelineRunner>[0]);
  vi.spyOn(
    runner as unknown as { loadGenreProfile: (genre: string) => Promise<unknown> },
    "loadGenreProfile",
  ).mockResolvedValue({ profile: { numericalSystem: false, language: "zh" } });
  return runner;
}

describe("foundation import", () => {
  it("keeps runtime files and unmatched roles in supplement mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-foundation-import-"));
    try {
      const bookDir = await createBookFixture(root);
      const runner = createRunner(root);
      const revision = await runner.getFoundationRevision("book");
      const bundle = buildFoundationSourceBundle([{
        sourceName: "world.txt",
        fileType: "txt",
        text: "补充世界观资料。".repeat(40),
        purpose: "world",
      }]);

      await runner.commitFoundationImport("book", proposedFoundation(), {
        mode: "supplement",
        expectedRevision: revision,
        sourceBundle: bundle,
      });

      expect(await readFile(join(bookDir, "story", "current_state.md"), "utf-8")).toBe("chapter 12 state");
      expect(await readFile(join(bookDir, "story", "pending_hooks.md"), "utf-8")).toBe("chapter 12 hooks");
      expect(await readFile(join(bookDir, "story", "emotional_arcs.md"), "utf-8")).toBe("chapter 12 emotions");
      await expect(access(join(bookDir, "story", "roles", "主要角色", "旧角色.md"))).resolves.toBeUndefined();
      await expect(access(join(bookDir, "story", "roles", "主要角色", "新角色.md"))).resolves.toBeUndefined();
      await expect(access(join(bookDir, "story", "sources", "index.json"))).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });

  it("rejects a stale plan before writing", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-foundation-stale-"));
    try {
      const bookDir = await createBookFixture(root);
      const runner = createRunner(root);
      const revision = await runner.getFoundationRevision("book");
      await writeFile(join(bookDir, "story", "outline", "story_frame.md"), "changed after preview", "utf-8");

      await expect(runner.commitFoundationImport("book", proposedFoundation(), {
        expectedRevision: revision,
      })).rejects.toThrow("预览后已发生变化");
      expect(await readFile(join(bookDir, "story", "outline", "story_frame.md"), "utf-8"))
        .toBe("changed after preview");
    } finally {
      await rm(root, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });

  it("captures the revision before Architect planning starts", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-foundation-plan-race-"));
    try {
      const bookDir = await createBookFixture(root);
      const runner = createRunner(root);
      vi.spyOn(ArchitectAgent.prototype, "generateFoundation")
        .mockImplementation(async () => {
          await writeFile(
            join(bookDir, "story", "outline", "story_frame.md"),
            "changed while planning",
            "utf-8",
          );
          return proposedFoundation();
        });

      const plan = await runner.planFoundationImport("book", [{
        sourceName: "world.txt",
        fileType: "txt",
        text: "WORLD_FACT ".repeat(30),
        purpose: "world",
      }]);

      expect(plan.foundationRevision).toBeDefined();
      await expect(runner.commitFoundationImport("book", plan.proposed!, {
        expectedRevision: plan.foundationRevision,
      })).rejects.toThrow("预览后已发生变化");
    } finally {
      await rm(root, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });

  it("does not send chapter or style sources to Architect", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-foundation-filter-"));
    try {
      await createBookFixture(root);
      const runner = createRunner(root);
      const spy = vi.spyOn(ArchitectAgent.prototype, "generateFoundation")
        .mockResolvedValue(proposedFoundation());

      await runner.planFoundationImport("book", [
        { sourceName: "world.txt", fileType: "txt", purpose: "world", text: "WORLD_FACT ".repeat(30) },
        { sourceName: "style.txt", fileType: "txt", purpose: "style", text: "STYLE_SECRET ".repeat(30) },
        { sourceName: "chapter.txt", fileType: "txt", purpose: "chapter", text: "CHAPTER_SECRET ".repeat(30) },
      ]);

      const externalContext = spy.mock.calls[0]?.[1] ?? "";
      expect(externalContext).toContain("WORLD_FACT");
      expect(externalContext).not.toContain("STYLE_SECRET");
      expect(externalContext).not.toContain("CHAPTER_SECRET");
    } finally {
      await rm(root, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });
});
