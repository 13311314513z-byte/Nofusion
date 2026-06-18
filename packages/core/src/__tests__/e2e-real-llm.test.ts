/**
 * Real LLM E2E regression test (P2-2).
 * Requires INKOS_LLM_API_KEY and INKOS_LLM_MODEL in environment.
 * 
 * Run: pnpm --filter @actalk/inkos-core test -- src/__tests__/e2e-real-llm.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_TIMEOUT = 180_000;

function getApiKey(): string | undefined {
  return process.env.INKOS_LLM_API_KEY || undefined;
}

describe("Real LLM E2E", () => {
  let root: string;
  let API_KEY: string | undefined;

  beforeAll(async () => {
    if (process.env.INKOS_RUN_REAL_LLM_E2E !== "1") {
      console.warn("Skipping real LLM E2E: set INKOS_RUN_REAL_LLM_E2E=1 to enable");
      return;
    }
    API_KEY = getApiKey();
    if (!API_KEY) {
      console.warn("Skipping real LLM E2E: no INKOS_LLM_API_KEY in environment");
      return;
    }
    root = await mkdtemp(join(tmpdir(), "inkos-e2e-"));
    
    const config = {
      name: "e2e-test",
      version: "0.1.0",
      language: "zh",
      llm: {
        provider: "openai",
        service: "deepseek",
        apiKey: API_KEY,
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        temperature: 0.7,
        maxTokens: 4096,
        stream: false,
      },
      daemon: {
        schedule: { radarCron: "0 */6 * * *", writeCron: "*/15 * * * *" },
        maxConcurrentBooks: 1,
        chaptersPerCycle: 1,
        retryDelayMs: 30000,
        cooldownAfterChapterMs: 0,
        maxChaptersPerDay: 50,
      },
    };
    await writeFile(join(root, "inkos.json"), JSON.stringify(config, null, 2), "utf-8");
  }, 30_000);

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it("E2E: create book, write chapter, audit", { timeout: TEST_TIMEOUT }, async () => {
    if (!API_KEY || !root) {
      console.warn("E2E test skipped: no API key");
      return;
    }

    const { loadProjectConfig, createLLMClient } = await import("../index.js");
    const { PipelineRunner } = await import("../pipeline/runner.js");

    const projectConfig = await loadProjectConfig(root, { consumer: "cli", requireApiKey: false });
    const client = createLLMClient(projectConfig.llm);
    const pipeline = new PipelineRunner({ client, model: projectConfig.llm.model, projectRoot: root, ...projectConfig } as any);

    try {
      console.log("Step 1: Creating book...");
      await pipeline.initBook({
        id: "e2e-book",
        title: "星落",
        genre: "xianxia",
        platform: "qidian",
        language: "zh",
        status: "active",
        targetChapters: 1,
        serializationStatus: "draft",
      });
      console.log("Book created: e2e-book");

      console.log("Step 2: Writing chapter 1...");
      const result = await pipeline.writeNextChapter("e2e-book", 500);
      console.log(`Chapter ${result.chapterNumber}: "${result.title}" (${result.wordCount} words)`);
      console.log(`Content preview: ${result.content.slice(0, 200)}...`);

      console.log("Step 3: Auditing chapter...");
      const auditResult = await pipeline.auditDraft("e2e-book", 1);
      console.log(`Audit done. Issues: ${auditResult.issues.length}, Passed: ${auditResult.passed}`);

      expect(result.chapterNumber).toBe(1);
      expect(result.content.length).toBeGreaterThan(100);
      expect(result.wordCount).toBeGreaterThan(50);
      expect(result.title.length).toBeGreaterThan(0);
      expect(auditResult.chapterNumber).toBe(1);

      console.log("E2E pipeline: create, write, audit ALL PASSED");
    } finally {
      pipeline.dispose();
    }
  }, TEST_TIMEOUT);
});
