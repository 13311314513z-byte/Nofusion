/**
 * Pipeline Foundation Tests — split from pipeline-runner.test.ts (B1).
 *
 * Tests for initBook, reviseFoundation, and foundation review.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PipelineRunner } from "../pipeline/runner.js";
import { StateManager } from "../state/manager.js";
import { ArchitectAgent } from "../agents/architect.js";
import { PlannerAgent } from "../agents/planner.js";
import { WriterAgent } from "../agents/writer.js";
import { FoundationReviewerAgent } from "../agents/foundation-reviewer.js";
import type { BookConfig } from "../models/book.js";
import { saveChapterIntents } from "../models/chapter-intent.js";
import {
  createRunnerFixture,
  createWriterOutput,
  createReviseOutput,
  setupPipelineMocks,
  SLOW_PIPELINE_TEST_TIMEOUT_MS,
} from "./pipeline-test-helpers.js";

describe("PipelineRunner (foundation)", () => {
  beforeEach(() => {
    setupPipelineMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("blocks every write entrypoint before planning when strict interview data is incomplete", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({ strictInterview: true });
    const planSpy = vi.spyOn(PlannerAgent.prototype, "planChapter");
    try {
      await saveChapterIntents(state.bookDir(bookId), [{
        chapterNumber: 1,
        coreNarrative: "Advance the mentor conflict.",
        readerTakeaway: " ",
        keyMoment: "The oath token cracks.",
      }]);
      await expect(runner.writeNextChapter(bookId)).rejects.toThrow(
        /Strict interview blocked chapter 1: missing readerTakeaway/,
      );
      expect(planSpy).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not reuse override clients when credential sources differ", () => {
    const previousKeyA = process.env.TEST_KEY_A;
    const previousKeyB = process.env.TEST_KEY_B;
    process.env.TEST_KEY_A = "key-a";
    process.env.TEST_KEY_B = "key-b";
    try {
      const runner = new PipelineRunner({
        client: {
          provider: "openai", apiFormat: "chat", stream: false,
          defaults: { temperature: 0.7, maxTokens: 4096, thinkingBudget: 0 },
        } as ConstructorParameters<typeof PipelineRunner>[0]["client"],
        model: "base-model", projectRoot: process.cwd(),
        defaultLLMConfig: {
          provider: "custom", service: "custom", configSource: "env",
          baseUrl: "https://base.example/v1", apiKey: "base-key",
          model: "base-model", temperature: 0.7, thinkingBudget: 0,
          apiFormat: "chat", stream: false,
        },
        modelOverrides: {
          writer: { model: "writer-model", provider: "custom", baseUrl: "https://shared.example/v1", apiKeyEnv: "TEST_KEY_A" },
          auditor: { model: "auditor-model", provider: "custom", baseUrl: "https://shared.example/v1", apiKeyEnv: "TEST_KEY_B" },
        },
      });
      const resolveOverride = (runner as unknown as { resolveOverride: (agent: string) => { model: string; client: unknown } }).resolveOverride.bind(runner);
      expect(resolveOverride("writer").client).not.toBe(resolveOverride("auditor").client);
    } finally {
      if (previousKeyA === undefined) delete process.env.TEST_KEY_A; else process.env.TEST_KEY_A = previousKeyA;
      if (previousKeyB === undefined) delete process.env.TEST_KEY_B; else process.env.TEST_KEY_B = previousKeyB;
    }
  });

  it("initializes control documents during book creation", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-init-book-test-"));
    const bookId = "bootstrap-book";
    const book: BookConfig = {
      id: bookId, title: "Bootstrap Book", platform: "tomato", genre: "xuanhuan",
      status: "outlining", targetChapters: 10, chapterWordCount: 3000,
      createdAt: "2026-03-22T00:00:00.000Z", updatedAt: "2026-03-22T00:00:00.000Z",
    };
    const runner = new PipelineRunner({
      client: { provider: "openai", apiFormat: "chat", stream: false, defaults: { temperature: 0.7, thinkingBudget: 0 } } as ConstructorParameters<typeof PipelineRunner>[0]["client"],
      model: "test-model", projectRoot: root,
      externalContext: "# Author Intent\n\nKeep the narrative centered on mentor conflict.\n",
    });
    vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockResolvedValue({
      storyBible: "# Story Bible\n", volumeOutline: "# Volume Outline\n",
      bookRules: "---\nversion: \"1.0\"\n---\n\n# Book Rules\n",
      currentState: "# Current State\n", pendingHooks: "# Pending Hooks\n",
    });
    try {
      await runner.initBook(book);
      const storyDir = join(root, "books", bookId, "story");
      await expect(readFile(join(storyDir, "author_intent.md"), "utf-8")).resolves.toContain("mentor conflict");
      await expect(readFile(join(storyDir, "current_focus.md"), "utf-8")).resolves.toContain("当前聚焦");
      expect((await stat(join(storyDir, "runtime"))).isDirectory()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("applies creation-draft overrides while initializing a book", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-init-book-overrides-"));
    const book: BookConfig = {
      id: "override-book", title: "Override Book", platform: "tomato", genre: "xuanhuan",
      status: "outlining", targetChapters: 20, chapterWordCount: 2800,
      createdAt: "2026-04-13T00:00:00.000Z", updatedAt: "2026-04-13T00:00:00.000Z",
    };
    const runner = new PipelineRunner({
      client: { provider: "openai", apiFormat: "chat", stream: false, defaults: { temperature: 0.7, thinkingBudget: 0 } } as ConstructorParameters<typeof PipelineRunner>[0]["client"],
      model: "test-model", projectRoot: root,
    });
    const generateSpy = vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockResolvedValue({
      storyBible: "# Story Bible\n", volumeOutline: "# Volume Outline\n",
      bookRules: "---\nversion: \"1.0\"\n---\n\n# Book Rules\n",
      currentState: "# Current State\n", pendingHooks: "# Pending Hooks\n",
    });
    try {
      await runner.initBook(book, {
        externalContext: "世界观重点：近未来港口城，账本与旧案牵出多方势力。",
        authorIntent: "# 作者意图\n\n写成冷硬、克制、利益驱动的商战悬疑。\n",
        currentFocus: "# 当前聚焦\n\n先把旧账线和港口势力网立住。\n",
      });
      expect(generateSpy).toHaveBeenCalledWith(book, expect.stringContaining("近未来港口城"), undefined);
      const storyDir = join(root, "books", "override-book", "story");
      await expect(readFile(join(storyDir, "author_intent.md"), "utf-8")).resolves.toContain("冷硬、克制、利益驱动");
      await expect(readFile(join(storyDir, "current_focus.md"), "utf-8")).resolves.toContain("旧账线和港口势力网");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("cleans staged files when initBook fails before foundation is complete", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-init-rollback-"));
    const runner = new PipelineRunner({
      client: { provider: "openai", apiFormat: "chat", stream: false, defaults: { temperature: 0.7, thinkingBudget: 0 } } as ConstructorParameters<typeof PipelineRunner>[0]["client"],
      model: "test-model", projectRoot: root,
    });
    const book: BookConfig = {
      id: "atomic-book", title: "Atomic Book", platform: "tomato", genre: "xuanhuan",
      status: "outlining", targetChapters: 12, chapterWordCount: 2200,
      createdAt: "2026-03-29T00:00:00.000Z", updatedAt: "2026-03-29T00:00:00.000Z",
    };
    vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockRejectedValue(new Error("missing book_rules section"));
    try {
      await expect(runner.initBook(book)).rejects.toThrow("missing book_rules section");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("bootstraps missing control documents for legacy books before writing", async () => {
    const { root, runner, bookId } = await createRunnerFixture();
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({ chapterNumber: 1, content: "Legacy chapter body.", wordCount: "Legacy chapter body.".length }),
    );
    try {
      await runner.writeDraft(bookId);
      const storyDir = join(root, "books", bookId, "story");
      await expect(readFile(join(storyDir, "author_intent.md"), "utf-8")).resolves.toContain("Author Intent");
      await expect(readFile(join(storyDir, "current_focus.md"), "utf-8")).resolves.toContain("Current Focus");
      expect((await stat(join(storyDir, "runtime"))).isDirectory()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, SLOW_PIPELINE_TEST_TIMEOUT_MS);
});
