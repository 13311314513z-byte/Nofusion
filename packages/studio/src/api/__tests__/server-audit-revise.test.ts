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

describe("createStudioServer audit / revise / export", () => {
  let root: string;

  beforeEach(async () => {
    root = await setupTestRoot();
  });

  afterEach(async () => {
    await cleanupTestRoot(root);
  });

  it("returns audit provider choices from the provider bank without requiring writing-service keys", async () => {
    await writeFile(join(root, "inkos.json"), JSON.stringify({
      ...projectConfig,
      llm: {
        services: [
          { service: "custom", name: "CorpGPT", baseUrl: "https://llm.internal.corp/v1" },
        ],
      },
    }, null, 2), "utf-8");
    loadSecretsMock.mockResolvedValue({
      services: {
        deepseek: { apiKey: "sk-writing" },
        "audit:moonshot": { apiKey: "sk-audit" },
        "audit:custom:CorpGPT": { apiKey: "sk-custom-audit" },
      },
    });

    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const res = await app.request("http://localhost/api/v1/audit/providers");
    expect(res.status).toBe(200);
    const body = await res.json() as {
      providers: Array<{
        service: string;
        api: string;
        apiLabel: string;
        apiFormat: string;
        defaultModel?: string;
        connected: boolean;
        writingConnected: boolean;
        models: Array<{ id: string }>;
      }>;
    };
    const services = body.providers.map((provider) => provider.service);
    expect(services).toContain("openai");
    expect(services).toContain("moonshot");
    expect(services).toContain("deepseek");
    expect(services).toContain("custom:CorpGPT");
    expect(services).not.toContain("kimiCodingPlan");
    expect(services).not.toContain("kimicode");

    expect(body.providers.find((provider) => provider.service === "openai")).toMatchObject({
      api: "openai-responses",
      apiLabel: "OpenAI Responses",
      apiFormat: "responses",
      connected: false,
      writingConnected: false,
      defaultModel: "openai-model",
    });
    expect(body.providers.find((provider) => provider.service === "deepseek")).toMatchObject({
      api: "openai-completions",
      apiLabel: "OpenAI Chat / Completions",
      apiFormat: "chat",
      connected: false,
      writingConnected: true,
    });
    expect(body.providers.find((provider) => provider.service === "moonshot")).toMatchObject({
      api: "openai-completions",
      apiFormat: "chat",
      connected: true,
      writingConnected: false,
      defaultModel: "moonshot-model",
      models: [{ id: "moonshot-model" }],
    });
    expect(body.providers.find((provider) => provider.service === "custom:CorpGPT")).toMatchObject({
      api: "openai-completions",
      apiLabel: "OpenAI Chat / Completions",
      apiFormat: "chat",
      connected: true,
      writingConnected: false,
      models: [],
    });
  });

  it("normalizes stale audit model type config from the provider bank", async () => {
    await mkdir(join(root, ".inkos"), { recursive: true });
    await writeFile(
      join(root, ".inkos", "audit-config.json"),
      JSON.stringify({ service: "openai", model: "openai-model", apiFormat: "chat" }, null, 2),
      "utf-8",
    );

    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/audit/config");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      service: "openai",
      model: "openai-model",
      api: "openai-responses",
      apiLabel: "OpenAI Responses",
      apiFormat: "responses",
    });
  });

  it("uses rollback semantics for chapter rejection instead of only flipping status", async () => {
    loadChapterIndexMock.mockResolvedValue([
      {
        number: 3,
        title: "Broken Chapter",
        status: "ready-for-review",
        wordCount: 1800,
        createdAt: "2026-04-07T00:00:00.000Z",
        updatedAt: "2026-04-07T00:00:00.000Z",
        auditIssues: ["continuity"],
        lengthWarnings: [],
      },
      {
        number: 4,
        title: "Downstream Chapter",
        status: "ready-for-review",
        wordCount: 1900,
        createdAt: "2026-04-07T00:00:00.000Z",
        updatedAt: "2026-04-07T00:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
      },
    ]);
    rollbackToChapterMock.mockResolvedValue([3, 4]);

    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/books/demo-book/chapters/3/reject", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      chapterNumber: 3,
      status: "rejected",
      rolledBackTo: 2,
      discarded: [3, 4],
    });
    expect(rollbackToChapterMock).toHaveBeenCalledWith("demo-book", 2);
    expect(saveChapterIndexMock).not.toHaveBeenCalled();
  });

  it("passes one-off brief into revise requests through pipeline config", async () => {
    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/books/demo-book/revise/3", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "rewrite", brief: "把注意力拉回师债主线。" }),
    });

    expect(response.status).toBe(200);
    expect(pipelineConfigs.at(-1)).toMatchObject({ externalContext: "把注意力拉回师债主线。" });
    expect(reviseDraftMock).toHaveBeenCalledWith("demo-book", 3, "rewrite");
  });

  it("persists manual audit results and resolves default service base URL", async () => {
    await mkdir(join(root, ".inkos"), { recursive: true });
    await writeFile(
      join(root, ".inkos", "audit-config.json"),
      JSON.stringify({ service: "openai", model: "gpt-5-mini", apiFormat: "chat" }, null, 2),
      "utf-8",
    );
    loadSecretsMock.mockResolvedValue({
      services: {
        "audit:openai": { apiKey: "sk-audit" },
      },
    });
    loadChapterIndexMock.mockResolvedValue([
      {
        number: 3,
        title: "Demo",
        status: "ready-for-review",
        wordCount: 1200,
        createdAt: "2026-04-12T00:00:00.000Z",
        updatedAt: "2026-04-12T00:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
      },
    ]);
    auditChapterMock.mockResolvedValue({
      passed: false,
      issues: [
        {
          severity: "critical",
          category: "角色动机",
          description: "主角突然相信敌人，缺少铺垫。",
          suggestion: "补一段证据链。",
        },
      ],
      summary: "needs repair",
      overallScore: 58,
    });

    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/books/demo-book/audit/3", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ passed: false, overallScore: 58 });
    expect(createLLMClientMock).toHaveBeenCalledWith(expect.objectContaining({
      service: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-audit",
      model: "gpt-5-mini",
    }));
    expect(saveChapterIndexMock).toHaveBeenCalledWith("demo-book", [
      expect.objectContaining({
        number: 3,
        status: "audit-failed",
        auditIssues: ["[critical] 角色动机: 主角突然相信敌人，缺少铺垫。"],
      }),
    ]);
    const historyRaw = await readFile(join(root, "books", "demo-book", "story", "audit_history.jsonl"), "utf-8");
    const history = historyRaw.trim().split("\n").map((line) => JSON.parse(line));
    expect(history).toEqual([
      expect.objectContaining({
        chapterNumber: 3,
        passed: false,
        overallScore: 58,
        issueCount: 1,
        criticalCount: 1,
        summary: "needs repair",
      }),
    ]);
  });

  it("handles explicit chat chapter edits outside the InkOS writing agent", async () => {
    loadChapterIndexMock.mockResolvedValueOnce([{
      number: 3,
      title: "Demo",
      status: "ready-for-review",
      wordCount: 4,
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:00:00.000Z",
      auditIssues: [],
      lengthWarnings: [],
    }]);

    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instruction: "第3章把「Body」改成「Body updated」",
        activeBookId: "demo-book",
        sessionId: "agent-session-1",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      response: expect.stringContaining("已直接编辑 demo-book 第 3 章"),
      session: {
        sessionId: "agent-session-1",
        activeBookId: "demo-book",
      },
    });
    await expect(readFile(join(root, "books", "demo-book", "chapters", "0003_Demo.md"), "utf-8"))
      .resolves.toContain("Body updated");
    expect(saveChapterIndexMock).toHaveBeenCalledWith("demo-book", [
      expect.objectContaining({
        number: 3,
        status: "audit-failed",
        wordCount: expect.any(Number),
        auditIssues: expect.arrayContaining(["[warning] Chat external edit requires review before continuation."]),
      }),
    ]);
    expect(runAgentSessionMock).not.toHaveBeenCalled();
    expect(writeNextChapterMock).not.toHaveBeenCalled();
  });

  it("rejects chat artifact edits against source files instead of routing to the agent", async () => {
    await mkdir(join(root, "packages", "core", "src"), { recursive: true });
    await writeFile(join(root, "packages", "core", "src", "index.ts"), "export const value = 1;\n", "utf-8");

    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instruction: "把 packages/core/src/index.ts 里的「value」改成「other」",
        sessionId: "agent-session-1",
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json() as { error: { code: string } };
    expect(body.error.code).toBe("UNSUPPORTED_CHAT_EDIT_TARGET");
    await expect(readFile(join(root, "packages", "core", "src", "index.ts"), "utf-8"))
      .resolves.toContain("value");
    expect(runAgentSessionMock).not.toHaveBeenCalled();
  });
});
