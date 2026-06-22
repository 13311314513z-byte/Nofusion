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

describe("createStudioServer doctor / radar / project config", () => {
  let root: string;

  beforeEach(async () => {
    root = await setupTestRoot();
  });

  afterEach(async () => {
    await cleanupTestRoot(root);
  });

  it("normalizes legacy book configs with directory ids for list and detail routes", async () => {
    listBooksMock.mockResolvedValueOnce(["legacy-book"]);
    getNextChapterNumberMock.mockResolvedValue(6);
    loadBookConfigMock.mockResolvedValue({
      id: "stale-or-wrong-id",
      name: "Legacy Book",
      title: "Legacy Book",
      genreProfileId: "cozy",
      status: "active",
    });
    loadChapterIndexMock.mockResolvedValue([
      { number: 1 },
      { number: 2 },
      { number: 3 },
      { number: 4 },
      { number: 5 },
    ]);

    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const listResponse = await app.request("http://localhost/api/v1/books");
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      books: [{
        id: "legacy-book",
        title: "Legacy Book",
        genre: "cozy",
        status: "active",
        chaptersWritten: 5,
      }],
    });

    const detailResponse = await app.request("http://localhost/api/v1/books/legacy-book");
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toMatchObject({
      book: {
        id: "legacy-book",
        title: "Legacy Book",
        genre: "cozy",
      },
      nextChapter: 6,
    });
  });

  it("reflects project edits immediately without restarting the studio server", async () => {
    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    // Override loadProjectConfig to read the actual inkos.json written by project edits
    const { readFile } = await import("node:fs/promises");
    loadProjectConfigMock.mockImplementation(async () => {
      const raw = await readFile(join(root, "inkos.json"), "utf-8");
      return JSON.parse(raw);
    });

    const save = await app.request("http://localhost/api/v1/project", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language: "en",
        temperature: 0.2,
        stream: true,
      }),
    });

    expect(save.status).toBe(200);

    const project = await app.request("http://localhost/api/v1/project");
    await expect(project.json()).resolves.toMatchObject({
      language: "en",
      temperature: 0.2,
      stream: true,
    });
  });

  it("reloads latest llm config for doctor checks without restarting the studio server", async () => {
    const startupConfig = {
      ...cloneProjectConfig(),
      llm: {
        ...cloneProjectConfig().llm,
        model: "stale-model",
        baseUrl: "https://stale.example.com/v1",
      },
    };

    const freshConfig = {
      ...cloneProjectConfig(),
      llm: {
        ...cloneProjectConfig().llm,
        model: "fresh-model",
        baseUrl: "https://fresh.example.com/v1",
      },
    };
    loadProjectConfigMock.mockResolvedValue(freshConfig);

    // Stub /models so probe doesn't hit the real OpenAI endpoint and short-circuit on 401.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "Not Found",
    });
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(startupConfig as never, root);

    const response = await app.request("http://localhost/api/v1/doctor");

    expect(response.status).toBe(200);
    expect(createLLMClientMock).toHaveBeenCalledWith(expect.objectContaining({
      model: "fresh-model",
      baseUrl: "https://fresh.example.com/v1",
    }));
    expect(chatCompletionMock).toHaveBeenCalledWith(
      expect.anything(),
      "fresh-model",
      expect.any(Array),
      expect.objectContaining({ maxTokens: expect.any(Number) }),
    );
  });

  it("auto-falls back to a non-stream probe in doctor checks when the first transport returns empty", async () => {
    const freshConfig = {
      ...cloneProjectConfig(),
      llm: {
        ...cloneProjectConfig().llm,
        model: "claude-sonnet-4-6",
        baseUrl: "https://timesniper.club",
        stream: true,
        apiFormat: "chat",
      },
    };
    loadProjectConfigMock.mockResolvedValue(freshConfig);
    // Stub /models so probe doesn't hit the real OpenAI endpoint and short-circuit on 401.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "Not Found",
    });
    vi.stubGlobal("fetch", fetchMock as typeof fetch);
    createLLMClientMock.mockImplementation(((cfg: unknown) => cfg) as any);
    chatCompletionMock.mockImplementation(async (client: any) => {
      if (client.stream === false) {
        return {
          content: "pong",
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      }
      throw new Error("LLM returned empty response from stream");
    });

    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(freshConfig as never, root);

    const response = await app.request("http://localhost/api/v1/doctor");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      llmConnected: true,
    });
    expect(createLLMClientMock).toHaveBeenCalledWith(expect.objectContaining({
      stream: true,
      apiFormat: "chat",
    }));
    expect(createLLMClientMock).toHaveBeenCalledWith(expect.objectContaining({
      stream: false,
      apiFormat: "chat",
    }));
  });

  it("reloads latest llm config for radar scans without restarting the studio server", async () => {
    const startupConfig = {
      ...cloneProjectConfig(),
      llm: {
        ...cloneProjectConfig().llm,
        model: "stale-model",
        baseUrl: "https://stale.example.com/v1",
      },
    };

    const freshConfig = {
      ...cloneProjectConfig(),
      llm: {
        ...cloneProjectConfig().llm,
        model: "fresh-model",
        baseUrl: "https://fresh.example.com/v1",
      },
    };
    loadProjectConfigMock.mockResolvedValue(freshConfig);

    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(startupConfig as never, root);

    const response = await app.request("http://localhost/api/v1/radar/scan", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(runRadarMock).toHaveBeenCalledTimes(1);
    expect(pipelineConfigs.at(-1)).toMatchObject({
      model: "fresh-model",
      defaultLLMConfig: expect.objectContaining({
        model: "fresh-model",
        baseUrl: "https://fresh.example.com/v1",
      }),
    });
  });

  it("persists Studio radar scans and exposes scan history", async () => {
    runRadarMock.mockResolvedValueOnce({
      timestamp: "2026-05-14T12:00:00.000Z",
      marketSummary: "女频短篇复仇继续强势",
      recommendations: [],
    });

    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const scan = await app.request("http://localhost/api/v1/radar/scan", { method: "POST" });
    expect(scan.status).toBe(200);

    const history = await app.request("http://localhost/api/v1/radar/history");
    expect(history.status).toBe(200);
    await expect(history.json()).resolves.toMatchObject({
      items: [
        {
          file: "scan-2026-05-14T12-00-00-000Z.json",
          timestamp: "2026-05-14T12:00:00.000Z",
          summaryPreview: "女频短篇复仇继续强势",
          result: {
            marketSummary: "女频短篇复仇继续强势",
          },
        },
      ],
    });
  });

  it("updates the first-run language immediately after the language selector saves", async () => {
    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    // Override loadProjectConfig to read the actual inkos.json written by language save
    const { readFile } = await import("node:fs/promises");
    loadProjectConfigMock.mockImplementation(async () => {
      const raw = await readFile(join(root, "inkos.json"), "utf-8");
      return JSON.parse(raw);
    });

    const save = await app.request("http://localhost/api/v1/project/language", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "en" }),
    });

    expect(save.status).toBe(200);

    const project = await app.request("http://localhost/api/v1/project");
    await expect(project.json()).resolves.toMatchObject({
      language: "en",
      languageExplicit: true,
    });
  });

  it("writes parseable custom genre frontmatter when user text contains YAML punctuation", async () => {
    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const create = await app.request("http://localhost/api/v1/genres/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "revenge-short",
        name: "短篇：复仇",
        language: "zh",
        chapterTypes: ["开局", "反杀"],
        fatigueWords: ["震惊"],
        pacingRule: "3:1 压迫/回报",
        body: "规则正文",
      }),
    });
    expect(create.status).toBe(200);

    const list = await app.request("http://localhost/api/v1/genres");
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      genres: expect.arrayContaining([
        expect.objectContaining({
          id: "revenge-short",
          name: "短篇：复仇",
          source: "project",
          language: "zh",
        }),
      ]),
    });
  });

  it("rejects create requests when a complete book with the same id already exists", async () => {
    await mkdir(join(root, "books", "existing-book", "story"), { recursive: true });
    await writeFile(join(root, "books", "existing-book", "book.json"), JSON.stringify({ id: "existing-book" }), "utf-8");
    await writeFile(join(root, "books", "existing-book", "story", "story_bible.md"), "# existing", "utf-8");

    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/books/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Existing Book",
        genre: "xuanhuan",
        platform: "qidian",
        language: "zh",
      }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('Book "existing-book" already exists'),
    });
    expect(processProjectInteractionRequestMock).not.toHaveBeenCalled();
    await expect(access(join(root, "books", "existing-book", "story", "story_bible.md"))).resolves.toBeUndefined();
  });

  it("reports async create failures through the create-status endpoint", async () => {
    processProjectInteractionRequestMock.mockRejectedValueOnce(new Error("INKOS_LLM_API_KEY not set"));

    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/books/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Broken Book",
        genre: "xuanhuan",
        platform: "qidian",
        language: "zh",
      }),
    });

    expect(response.status).toBe(202);

    // Poll create-status until the async pipeline completes (or timeout)
    let lastStatus: { status: string; error?: string } | null = null;
    for (let i = 0; i < 100; i++) {
      const status = await app.request("http://localhost/api/v1/books/broken-book/create-status");
      if (status.status === 200) {
        lastStatus = await status.json() as { status: string; error?: string };
        if (lastStatus.status === "failed" || lastStatus.status === "completed") break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    expect(lastStatus).not.toBeNull();
    expect(lastStatus!.status).toBe("failed");
    expect(lastStatus!.error).toBe("INKOS_LLM_API_KEY not set");
  });

  it("surfaces LLM config errors during create instead of masking them as internal errors", async () => {
    loadProjectConfigMock.mockRejectedValueOnce(
      new Error("Studio LLM API key not set. Open Studio services and save an API key for the selected service."),
    );

    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/books/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Needs Key",
        genre: "urban",
        platform: "qidian",
        language: "zh",
      }),
    });

    expect(response.status).toBe(202);

    // Poll create-status until async pipeline completes
    let lastStatus: { status: string; error?: string } | null = null;
    for (let i = 0; i < 100; i++) {
      const status = await app.request("http://localhost/api/v1/books/needs-key/create-status");
      if (status.status === 200) {
        lastStatus = await status.json() as { status: string; error?: string };
        if (lastStatus.status === "failed" || lastStatus.status === "completed") break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    expect(lastStatus).not.toBeNull();
    expect(lastStatus!.status).toBe("failed");
    expect(lastStatus!.error).toContain("Studio LLM API key not set");
  });

  it("routes create requests through the shared structured interaction runtime", async () => {
    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/books/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "New Book",
        genre: "urban",
        platform: "qidian",
        language: "zh",
        chapterWordCount: 2600,
        targetChapters: 88,
        blurb: "主角在旧城查账洗白，卷一先追账本。",
      }),
    });

    expect(response.status).toBe(202);

    // Wait for the async pipeline to call createInteractionToolsFromDeps
    for (let i = 0; i < 100; i++) {
      if (createInteractionToolsFromDepsMock.mock.calls.length > 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    expect(createInteractionToolsFromDepsMock).toHaveBeenCalledTimes(1);
    expect(processProjectInteractionRequestMock).toHaveBeenCalledWith(expect.objectContaining({
      projectRoot: root,
      request: {
        intent: "create_book",
        title: "New Book",
        genre: "urban",
        language: "zh",
        platform: "qidian",
        chapterWordCount: 2600,
        targetChapters: 88,
        blurb: "主角在旧城查账洗白，卷一先追账本。",
      },
    }));
  });

  it("omits empty blurb from create requests", async () => {
    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/books/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Book Without Blurb",
        genre: "urban",
        platform: "qidian",
        language: "zh",
      }),
    });

    expect(response.status).toBe(202);

    // Wait for the async pipeline to call processProjectInteractionRequest
    for (let i = 0; i < 100; i++) {
      if (processProjectInteractionRequestMock.mock.calls.length > 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    const call = processProjectInteractionRequestMock.mock.calls.at(-1)?.[0] as
      | { request?: Record<string, unknown> }
      | undefined;
    expect(call?.request).toMatchObject({
      intent: "create_book",
      title: "Book Without Blurb",
      genre: "urban",
      language: "zh",
      platform: "qidian",
    });
    expect(call?.request).not.toHaveProperty("blurb");
  });

  it("creates books with Studio Ollama config without requiring an API key", async () => {
    await writeFile(join(root, "inkos.json"), JSON.stringify({
      ...projectConfig,
      llm: {
        configSource: "studio",
        service: "ollama",
        provider: "openai",
        baseUrl: "http://localhost:11434/v1",
        model: "Qwen3.6-35B-A3B-APEX-I-Mini.gguf",
        apiKey: "",
        services: [{ service: "ollama", apiFormat: "chat", stream: false }],
        defaultModel: "Qwen3.6-35B-A3B-APEX-I-Mini.gguf",
        apiFormat: "chat",
        stream: false,
      },
    }, null, 2), "utf-8");

    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    // Override loadProjectConfig to read the actual inkos.json with Ollama config
    const { readFile } = await import("node:fs/promises");
    loadProjectConfigMock.mockImplementation(async () => {
      const raw = await readFile(join(root, "inkos.json"), "utf-8");
      return JSON.parse(raw);
    });

    const response = await app.request("http://localhost/api/v1/books/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Local Book",
        genre: "urban",
        platform: "qidian",
        language: "zh",
      }),
    });

    expect(response.status).toBe(202);

    // Wait for the async pipeline to build the config
    for (let i = 0; i < 100; i++) {
      if (createLLMClientMock.mock.calls.length > 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    expect(loadProjectConfigMock).toHaveBeenCalledWith(root, { consumer: "studio" });
    expect(createLLMClientMock).toHaveBeenCalledWith(expect.objectContaining({
      service: "ollama",
      model: "Qwen3.6-35B-A3B-APEX-I-Mini.gguf",
      apiKey: "",
    }));
    expect(pipelineConfigs.at(-1)).toMatchObject({
      model: "Qwen3.6-35B-A3B-APEX-I-Mini.gguf",
    });
  });

  it("migrates and exposes a book created by architect even when the final agent text is empty", async () => {
    const orphanSession = {
      sessionId: "agent-session-1",
      bookId: null,
      title: null,
      messages: [],
      events: [],
      draftRounds: [],
      createdAt: 1,
      updatedAt: 1,
    };
    loadBookSessionMock.mockResolvedValue(orphanSession);
    appendBookSessionMessageMock.mockImplementation((session: unknown) => session);
    migrateBookSessionMock.mockResolvedValue({
      ...orphanSession,
      bookId: "new-book",
    });
    loadBookConfigMock.mockImplementation(async (bookId?: string) => ({
      id: bookId ?? "new-book",
      title: "New Book",
      platform: "qidian",
      genre: "urban",
      status: "outlining",
      targetChapters: 100,
      chapterWordCount: 3000,
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:00:00.000Z",
    }));
    runAgentSessionMock.mockImplementationOnce(async (config: { onEvent?: (event: unknown) => void }) => {
      config.onEvent?.({
        type: "tool_execution_start",
        toolCallId: "tool-1",
        toolName: "sub_agent",
        args: { agent: "architect", title: "New Book" },
      });
      config.onEvent?.({
        type: "tool_execution_end",
        toolCallId: "tool-1",
        toolName: "sub_agent",
        isError: false,
        result: {
          content: [{ type: "text", text: "Book created." }],
          details: { kind: "book_created", bookId: "new-book", title: "New Book" },
        },
      });
      return {
        responseText: "",
        messages: [{ role: "user", content: "/new New Book" }],
      };
    });
    chatCompletionMock.mockResolvedValueOnce({
      content: "建书完成。",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: "写一本都市商战", sessionId: "agent-session-1" }),
    });

    expect(response.status).toBe(200);
    expect(migrateBookSessionMock).toHaveBeenCalledWith(root, "agent-session-1", "new-book");
    await expect(response.json()).resolves.toMatchObject({
      response: "建书完成。",
      session: {
        sessionId: "agent-session-1",
        activeBookId: "new-book",
      },
    });
  });
});
