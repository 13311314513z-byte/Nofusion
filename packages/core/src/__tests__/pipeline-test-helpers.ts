/**
 * Shared test helpers for pipeline tests — extracted from pipeline-runner.test.ts (C11).
 *
 * Provides common test fixtures (mock audit results, writer outputs, book configs)
 * and utility functions used across pipeline test files.
 */
import type { AuditResult, AuditIssue } from "../agents/continuity.js";
import type { WriteChapterOutput } from "../agents/writer.js";
import type { ReviseOutput } from "../agents/reviser.js";
import type { BookConfig } from "../models/book.js";
import type { ChapterMeta } from "../models/chapter.js";
import { PipelineRunner } from "../pipeline/runner.js";
import { StateManager } from "../state/manager.js";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { PlannerAgent } from "../agents/planner.js";
import { FoundationReviewerAgent } from "../agents/foundation-reviewer.js";
import { LengthNormalizerAgent } from "../agents/length-normalizer.js";
import { StateValidatorAgent } from "../agents/state-validator.js";
import { ReviserAgent } from "../agents/reviser.js";
import { countChapterLength } from "../utils/length-metrics.js";

/** Zero token usage — used as default for mock audit/writer results. */
export const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

/** Standard critical audit issue for tests. */
export const CRITICAL_ISSUE: AuditIssue = {
  severity: "critical",
  category: "continuity",
  description: "Fix the chapter state",
  suggestion: "Repair the contradiction",
};

/** Create a mock AuditResult with overrides. */
export function createAuditResult(overrides: Partial<AuditResult> = {}): AuditResult {
  return {
    passed: true,
    issues: [],
    summary: "ok",
    overallScore: 90,
    tokenUsage: ZERO_USAGE,
    ...overrides,
  };
}

/** Create a mock WriteChapterOutput with overrides. */
export function createWriterOutput(overrides: Partial<WriteChapterOutput> = {}): WriteChapterOutput {
  return {
    chapterNumber: 1,
    title: "Test Chapter",
    content: "Original chapter body.",
    wordCount: "Original chapter body.".length,
    preWriteCheck: "check",
    postSettlement: "settled",
    updatedState: "writer state",
    updatedLedger: "writer ledger",
    updatedHooks: "writer hooks",
    chapterSummary: "| 1 | Original summary |",
    updatedSubplots: "writer subplots",
    updatedEmotionalArcs: "writer emotions",
    updatedCharacterMatrix: "writer matrix",
    postWriteErrors: [],
    postWriteWarnings: [],
    tokenUsage: ZERO_USAGE,
    ...overrides,
  };
}

/** Create a minimal BookConfig for tests. */
export function createTestBookConfig(overrides: Partial<BookConfig> = {}): BookConfig {
  return {
    id: "test-book",
    title: "Test Book",
    platform: "qidian",
    genre: "xuanhuan",
    language: "zh",
    targetChapters: 100,
    chapterWordCount: 3000,
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Create a minimal ChapterMeta for tests. */
export function createTestChapterMeta(
  chapterNumber: number,
  overrides: Partial<ChapterMeta> = {},
): ChapterMeta {
  return {
    number: chapterNumber,
    title: `Chapter ${chapterNumber}`,
    wordCount: 3000,
    status: "ready-for-review",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Create a mock ReviseOutput with overrides. */
export function createReviseOutput(overrides: Partial<ReviseOutput> = {}): ReviseOutput {
  return {
    revisedContent: "Revised chapter body.",
    wordCount: "Revised chapter body.".length,
    fixedIssues: ["fixed"],
    updatedState: "revised state",
    updatedLedger: "revised ledger",
    updatedHooks: "revised hooks",
    tokenUsage: ZERO_USAGE,
    ...overrides,
  };
}

/** Create a capture logger for verifying log output in tests. */
export function createCaptureLogger() {
  const infos: string[] = [];
  const warnings: string[] = [];
  const logger = {
    debug() {},
    info(message: string) { infos.push(message); },
    warn(message: string) { warnings.push(message); },
    error() {},
    child() { return logger; },
  };
  return { logger, infos, warnings };
}

/** Default test timeout for slow pipeline tests. */
export const SLOW_PIPELINE_TEST_TIMEOUT_MS = 15_000;

/** Create a full test fixture with temp dir, StateManager, and PipelineRunner. */
export async function createRunnerFixture(
  configOverrides: Partial<ConstructorParameters<typeof PipelineRunner>[0]> = {},
): Promise<{ root: string; runner: PipelineRunner; state: StateManager; bookId: string }> {
  const root = await mkdtemp(join(tmpdir(), "inkos-runner-test-"));
  const state = new StateManager(root);
  const bookId = "test-book";
  const now = "2026-03-19T00:00:00.000Z";
  const book: BookConfig = {
    id: bookId, title: "Test Book", platform: "tomato", genre: "xuanhuan",
    status: "active", targetChapters: 10, chapterWordCount: 3000,
    createdAt: now, updatedAt: now,
  };
  await state.saveBookConfig(bookId, book);
  await mkdir(join(state.bookDir(bookId), "story"), { recursive: true });
  await mkdir(join(state.bookDir(bookId), "chapters"), { recursive: true });
  const runner = new PipelineRunner({
    client: {
      provider: "openai", apiFormat: "chat", stream: false,
      defaults: { temperature: 0.7, maxTokens: 4096, thinkingBudget: 0 },
    } as ConstructorParameters<typeof PipelineRunner>[0]["client"],
    model: "test-model",
    projectRoot: root,
    ...configOverrides,
  });
  return { root, runner, state, bookId };
}

/**
 * Standard beforeEach mock setup for pipeline tests.
 * Sets up mocks for PlannerAgent, FoundationReviewerAgent, LengthNormalizerAgent,
 * StateValidatorAgent, and ReviserAgent. Call this in beforeEach() of split test files.
 */
export function setupPipelineMocks() {
  vi.spyOn(PlannerAgent.prototype, "planChapter").mockImplementation(async (input) => {
    const chapterNumber = input.chapterNumber;
    const goal = input.externalContext ?? "test goal";
    const memo = { chapter: chapterNumber, goal, isGoldenOpening: false, body: "", threadRefs: [] as string[] };
    const intentMarkdown = [
      "# Chapter Intent", "", "## Goal", goal, "", "## Outline Node", "(not found)", "",
      "## Must Keep", "- none", "", "## Must Avoid", "- none", "", "## Style Emphasis", "- none", "",
    ].join("\n");
    const runtimeDir = join(input.bookDir, "story", "runtime");
    const intentPath = join(runtimeDir, `chapter-${String(chapterNumber).padStart(4, "0")}.intent.md`);
    await mkdir(runtimeDir, { recursive: true }).catch(() => {});
    await writeFile(intentPath, intentMarkdown, "utf-8").catch(() => {});
    return {
      intent: { chapter: chapterNumber, goal, mustKeep: [], mustAvoid: [], styleEmphasis: [] },
      memo, intentMarkdown, plannerInputs: [intentPath], runtimePath: intentPath,
    };
  });

  vi.spyOn(FoundationReviewerAgent.prototype, "review").mockResolvedValue({
    passed: true, totalScore: 85, dimensions: [], overallFeedback: "auto-pass for test",
  });

  vi.spyOn(LengthNormalizerAgent.prototype, "normalizeChapter").mockImplementation(
    async ({ chapterContent, lengthSpec }) => ({
      normalizedContent: chapterContent,
      finalCount: countChapterLength(chapterContent, lengthSpec.countingMode),
      applied: false, mode: "none", tokenUsage: ZERO_USAGE,
    }),
  );

  vi.spyOn(StateValidatorAgent.prototype, "validate").mockResolvedValue({
    warnings: [], passed: true,
  });

  vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockImplementation(
    async (_bookDir, chapterContent, _chapterNumber, _issues, _mode, _genre, _options) =>
      createReviseOutput({ revisedContent: chapterContent, wordCount: chapterContent.length }),
  );
}
