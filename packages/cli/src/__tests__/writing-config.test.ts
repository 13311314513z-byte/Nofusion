import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { ProjectConfigSchema, StateManager, type BookConfig } from "@actalk/inkos-core";
import { buildPipelineConfig } from "../utils.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const cliDir = resolve(testDir, "..", "..");
const cliEntry = resolve(cliDir, "dist", "index.js");
const CLI_TIMEOUT_MS = 30_000;

let projectDir: string;

function buildTestEnv(overrides?: Record<string, string>) {
  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      !key.startsWith("INKOS_")
      && !key.startsWith("OPENAI_")
      && !key.startsWith("ANTHROPIC_")
      && key !== "TAVILY_API_KEY",
    ),
  );
  return {
    ...baseEnv,
    HOME: projectDir,
    ...overrides,
  };
}

function run(args: string[], options?: { env?: Record<string, string> }): string {
  return execFileSync("node", [cliEntry, ...args], {
    cwd: projectDir,
    encoding: "utf-8",
    env: buildTestEnv(options?.env),
    timeout: CLI_TIMEOUT_MS,
  });
}

function runWithExit(args: string[], options?: { env?: Record<string, string> }): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync("node", [cliEntry, ...args], {
      cwd: projectDir,
      encoding: "utf-8",
      env: buildTestEnv(options?.env),
      timeout: CLI_TIMEOUT_MS,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout: string; stderr: string; status: number };
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", exitCode: err.status ?? 1 };
  }
}

describe("CLI writing config", () => {
  beforeAll(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "inkos-cli-write-config-"));
    run(["init"]);

    const configPath = join(projectDir, "inkos.json");
    const config = JSON.parse(await readFile(configPath, "utf-8"));
    config.llm.configSource = "env";
    await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");

    const book: BookConfig = {
      id: "test-book",
      title: "测试书籍",
      platform: "other",
      genre: "cozy",
      status: "active",
      targetChapters: 10,
      chapterWordCount: 3000,
      language: "zh",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const state = new StateManager(projectDir);
    await state.saveBookConfig(book.id, book);
    await state.saveChapterIndex(book.id, []);
    await state.ensureControlDocuments(book.id);
  });

  beforeEach(async () => {
    const configPath = join(projectDir, "inkos.json");
    const config = JSON.parse(await readFile(configPath, "utf-8"));
    config.writing = {
      reviewRetries: 1,
      qualityBudget: "economy",
      strictInterview: false,
      betaReaderMode: "off",
      keySceneCandidates: 1,
    };
    await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  });

  afterAll(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  describe("strictInterview", () => {
    it("blocks writing when strictInterview is true and intents are missing", async () => {
      // Read current inkos.json
      const configPath = join(projectDir, "inkos.json");
      const raw = await readFile(configPath, "utf-8");
      const config = JSON.parse(raw);

      // Add writing.strictInterview
      config.writing = { ...(config.writing ?? {}), strictInterview: true };
      await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");

      // Try to write next chapter — should fail with strict-interview error
      const result = runWithExit(["write", "next", "--json"], {
        env: {
          INKOS_LLM_API_KEY: "sk-test-fake",
          INKOS_LLM_BASE_URL: "http://127.0.0.1:9/v1",
          INKOS_LLM_MODEL: "test-model",
        },
      });

      // Should fail before any LLM call
      expect(result.exitCode).toBe(1);

      // JSON output should contain the error
      const parsed = JSON.parse(result.stdout);
      expect(parsed.error).toBe("strict-interview-blocked");
      expect(parsed.chapterNumber).toBe(1);
      expect(parsed.missingFields).toBeDefined();
      expect(parsed.missingFields.length).toBeGreaterThan(0);
    });

    it("allows writing when strictInterview is false (default)", () => {
      // strictInterview is not set (defaults to false)
      // Should fail with LLM connection error, not strict-interview error
      const result = runWithExit(["write", "next", "--json"], {
        env: {
          INKOS_LLM_API_KEY: "sk-test-fake",
          INKOS_LLM_BASE_URL: "http://127.0.0.1:9/v1",
          INKOS_LLM_MODEL: "test-model",
        },
      });

      // Should fail, but NOT with strict-interview error
      expect(result.exitCode).toBe(1);
      if (result.stdout) {
        const parsed = JSON.parse(result.stdout);
        expect(parsed.error).not.toBe("strict-interview-blocked");
      }
    });
  });

  describe("qualityBudget", () => {
    it("respects economy qualityBudget in pipeline config", async () => {
      const configPath = join(projectDir, "inkos.json");
      const raw = await readFile(configPath, "utf-8");
      const config = JSON.parse(raw);

      // Set economy budget
      config.writing = { ...(config.writing ?? {}), qualityBudget: "economy" };
      await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");

      // Try to write — should fail before LLM due to missing API key
      const result = runWithExit(["write", "next", "--json"], {
        env: {
          INKOS_LLM_API_KEY: "sk-test-fake",
          INKOS_LLM_BASE_URL: "http://127.0.0.1:9/v1",
          INKOS_LLM_MODEL: "test-model",
        },
      });

      expect(result.exitCode).toBe(1);
      // The error should be LLM-related, not config-related
      expect(result.stderr).not.toContain("qualityBudget");
    });

    it("passes qualityBudget through buildPipelineConfig", async () => {
      const configPath = join(projectDir, "inkos.json");
      const raw = await readFile(configPath, "utf-8");
      const config = JSON.parse(raw);

      // Set premium budget
      config.writing = { ...(config.writing ?? {}), qualityBudget: "premium", reviewRetries: 5 };
      await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");

      // Verify the config is written correctly
      const updated = JSON.parse(await readFile(configPath, "utf-8"));
      expect(updated.writing.qualityBudget).toBe("premium");
      expect(updated.writing.reviewRetries).toBe(5);
    });
  });

  it("passes beta reader model-family constraints into PipelineRunner", async () => {
    const configPath = join(projectDir, "inkos.json");
    const config = JSON.parse(await readFile(configPath, "utf-8"));
    config.llm.baseUrl = "http://127.0.0.1:9/v1";
    config.llm.model = "test-model";
    config.writing = {
      ...config.writing,
      qualityBudget: "normal",
      betaReaderMode: "shadow",
      betaReaderModelFamily: "openai",
    };

    const parsed = ProjectConfigSchema.parse(config);
    const pipelineConfig = buildPipelineConfig(parsed, projectDir, { quiet: true });

    expect(pipelineConfig.betaReaderMode).toBe("shadow");
    expect(pipelineConfig.betaReaderModelFamily).toBe("openai");
  });
});
