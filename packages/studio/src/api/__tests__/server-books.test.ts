/**
 * Split from server.test.ts.  Shared mocks: ./mocks/core.mocks.js  Shared fixtures: ./mocks/fixtures.js
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  schedulerStartMock, initBookMock, runRadarMock, reviseDraftMock,
  resyncChapterArtifactsMock, writeNextChapterMock, rollbackToChapterMock,
  saveChapterIndexMock, loadChapterIndexMock, loadBookConfigMock, listBooksMock,
  getNextChapterNumberMock, auditChapterMock, createLLMClientMock, chatCompletionMock,
  loadProjectConfigMock, processProjectInteractionRequestMock,
  createInteractionToolsFromDepsMock, loadProjectSessionMock,
  resolveSessionActiveBookMock, runAgentSessionMock,
  createAndPersistBookSessionMock, loadBookSessionMock,
  persistBookSessionMock, appendBookSessionMessageMock,
  appendManualSessionMessagesMock, renameBookSessionMock, deleteBookSessionMock,
  migrateBookSessionMock, resolveServiceModelMock, loadSecretsMock, saveSecretsMock,
  setServiceApiKeyMock, getServiceApiKeyMock,
  resolveServicePresetMock, resolveServiceProviderFamilyMock,
  resolveServiceModelsBaseUrlMock, listModelsForServiceMock,
  getAllEndpointsMock, probeModelsFromUpstreamMock, dnsLookupMock,
  pipelineConfigs, SERVICE_PRESETS_MOCK, endpointMocks,
} from "./mocks/core.mocks.js";
import { projectConfig, cloneProjectConfig, setupTestRoot, cleanupTestRoot } from "./mocks/fixtures.js";
import { createStudioServer } from "../server.js";

describe("createStudioServer books / create", () => {
  let root: string;

  beforeEach(async () => {
    root = await setupTestRoot();
  });

  afterEach(async () => {
    await cleanupTestRoot(root);
  });

  it("rejects switching Studio runtime to env config source", async () => {
    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const save = await app.request("http://localhost/api/v1/services/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ configSource: "env" }),
    });

    expect(save.status).toBe(400);
    await expect(save.json()).resolves.toMatchObject({
      error: expect.stringContaining("Studio 运行时不支持"),
    });
  });

  it("returns a Google-specific diagnostic when Gemini probe returns 400", async () => {
    await writeFile(join(root, "inkos.json"), JSON.stringify({
      ...projectConfig,
      llm: {
        services: [
          { service: "google", apiFormat: "chat", stream: false },
        ],
      },
    }, null, 2), "utf-8");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "Not Found",
    });
    vi.stubGlobal("fetch", fetchMock as typeof fetch);
    createLLMClientMock.mockImplementation(((cfg: unknown) => cfg) as any);
    chatCompletionMock.mockRejectedValue(
      new Error("API 返回 400（请求参数错误）。常见原因：\n  1. temperature / max_tokens 超出模型约束（如 Moonshot kimi-k2.X 强制 temperature=1）\n  (baseUrl: https://generativelanguage.googleapis.com/v1beta/openai, model: gemini-2.5-flash)"),
    );

    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/services/google/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: "google-key",
        apiFormat: "chat",
        stream: false,
      }),
    });

    expect(response.status).toBe(400);
    const json = await response.json() as { error?: string };
    expect(json.error).toContain("Google Gemini 测试连接失败");
    expect(json.error).toContain("测试模型：gemini-2.5-flash");
    expect(json.error).toContain("API Key 是否来自 Google AI Studio");
    expect(json.error).toContain("Gemini API");
    expect(json.error).not.toContain("Moonshot");
    expect(json.error).not.toMatch(/kkaiapi/i);
  });

  it("rejects non-header-safe service secrets instead of persisting diagnostic text", async () => {
    loadSecretsMock.mockResolvedValue({ services: {} });

    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/services/kkaiapi/secret", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: "kkaiapi 测试连接失败。上游返回：Cannot convert argument to a ByteString",
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("API Key"),
    });
    expect(saveSecretsMock).not.toHaveBeenCalled();
    expect(setServiceApiKeyMock).not.toHaveBeenCalled();
  });

  it("serves generated project cover images without exposing arbitrary files", async () => {
    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);
    const imagePath = join(root, "shorts", "demo", "final", "cover.png");
    await mkdir(join(root, "shorts", "demo", "final"), { recursive: true });
    await writeFile(imagePath, Buffer.from("fake-png"));
    await writeFile(join(root, "shorts", "demo", "final", "cover.txt"), "nope", "utf-8");
    await mkdir(join(root, "books", "demo"), { recursive: true });
    await writeFile(join(root, "books", "demo", "cover.png"), Buffer.from("private-book-image"));

    const ok = await app.request("http://localhost/api/v1/project/files/shorts/demo/final/cover.png");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("image/png");
    expect(Buffer.from(await ok.arrayBuffer()).toString("utf-8")).toBe("fake-png");

    const unsupported = await app.request("http://localhost/api/v1/project/files/shorts/demo/final/cover.txt");
    expect(unsupported.status).toBe(415);

    const unsupportedRoot = await app.request("http://localhost/api/v1/project/files/books/demo/cover.png");
    expect(unsupportedRoot.status).toBe(400);

    const traversal = await app.request("http://localhost/api/v1/project/files/../inkos.json");
    expect([400, 404]).toContain(traversal.status);
  });

  it("passes configured long-form writing review retries into Studio write-next", async () => {
    await writeFile(
      join(root, "inkos.json"),
      JSON.stringify({
        ...cloneProjectConfig(),
        writing: {
          reviewRetries: 3,
          qualityBudget: "normal",
          betaReaderMode: "shadow",
          betaReaderModelFamily: "openai",
        },
      }, null, 2),
      "utf-8",
    );

    // Override loadProjectConfig to read the actual inkos.json written above
    const { readFile } = await import("node:fs/promises");
    loadProjectConfigMock.mockImplementation(async () => {
      const raw = await readFile(join(root, "inkos.json"), "utf-8");
      return JSON.parse(raw);
    });

    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/books/demo-book/write-next", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
    expect(pipelineConfigs.at(-1)).toEqual(expect.objectContaining({
      writingReviewRetries: 3,
      betaReaderMode: "shadow",
      betaReaderModelFamily: "openai",
    }));
  });
});
