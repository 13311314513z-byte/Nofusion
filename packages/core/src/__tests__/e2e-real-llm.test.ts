/**
 * Real LLM E2E regression test (P2-2).
 *
 * Required env vars (all must be set):
 *   INKOS_LLM_API_KEY  – API key for the LLM provider
 *   INKOS_RUN_REAL_LLM_E2E=1 – opt-in flag
 *
 * Optional env vars (default to DeepSeek):
 *   INKOS_LLM_BASE_URL – default https://api.deepseek.com/v1
 *   INKOS_LLM_MODEL    – default deepseek-chat
 *   INKOS_LLM_SERVICE  – default deepseek
 *   INKOS_LLM_PROVIDER – default openai
 *
 * Examples:
 *   # DeepSeek (default)
 *   $env:INKOS_LLM_API_KEY="sk-xxx"; $env:INKOS_RUN_REAL_LLM_E2E="1"
 *
 *   # Kimi / Moonshot
 *   $env:INKOS_LLM_API_KEY="sk-xxx"; $env:INKOS_LLM_BASE_URL="https://api.moonshot.cn/v1"
 *   $env:INKOS_LLM_MODEL="moonshot-v1-8k"; $env:INKOS_LLM_SERVICE="moonshot"
 *   $env:INKOS_RUN_REAL_LLM_E2E="1"
 *
 *   # Via pnpm
 *   INKOS_LLM_API_KEY=xxx INKOS_RUN_REAL_LLM_E2E=1 pnpm --filter @actalk/inkos-core test -- src/__tests__/e2e-real-llm.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_TIMEOUT = 180_000;

function env(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

describe("Real LLM E2E", () => {
  let root: string;
  let API_KEY: string | undefined;
  let LLM_BASE_URL: string;
  let LLM_MODEL: string;
  let LLM_SERVICE: string;
  let LLM_PROVIDER: string;

  beforeAll(async () => {
    if (process.env.INKOS_RUN_REAL_LLM_E2E !== "1") {
      console.warn("Skipping real LLM E2E: set INKOS_RUN_REAL_LLM_E2E=1 to enable");
      return;
    }
    API_KEY = process.env.INKOS_LLM_API_KEY || undefined;
    if (!API_KEY) {
      console.warn("Skipping real LLM E2E: no INKOS_LLM_API_KEY in environment");
      return;
    }

    // Read LLM config from env vars with DeepSeek defaults
    LLM_BASE_URL = env("INKOS_LLM_BASE_URL", "https://api.deepseek.com/v1");
    LLM_MODEL = env("INKOS_LLM_MODEL", "deepseek-chat");
    LLM_SERVICE = env("INKOS_LLM_SERVICE", "deepseek");
    LLM_PROVIDER = env("INKOS_LLM_PROVIDER", "openai");

    console.log(`[E2E] Provider: ${LLM_PROVIDER} | Service: ${LLM_SERVICE} | Model: ${LLM_MODEL}`);
    console.log(`[E2E] Base URL: ${LLM_BASE_URL}`);

    root = await mkdtemp(join(tmpdir(), "inkos-e2e-"));
    
    const config = {
      name: "e2e-test",
      version: "0.1.0",
      language: "zh",
      llm: {
        provider: LLM_PROVIDER,
        service: LLM_SERVICE,
        apiKey: API_KEY,
        baseUrl: LLM_BASE_URL,
        model: LLM_MODEL,
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
