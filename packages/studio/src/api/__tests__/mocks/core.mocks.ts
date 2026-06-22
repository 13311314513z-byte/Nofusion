/**
 * Shared test mocks for Studio server tests.
 *
 * Extracted from server.test.ts to avoid duplication across split test files.
 * All mock variables are module-scoped and imported by individual test files.
 *
 * NOTE: `vi.hoisted()` calls (dnsLookupMock) must remain in each test file
 * at the top level, not in this shared module. Each test file re-exports
 * its own hoisted mock.
 */
import { vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── pipeline / runner mocks ─────────────────────────────────────────────────
export const schedulerStartMock = vi.fn<() => Promise<void>>();

// dnsLookupMock is used by vi.mock("node:dns/promises", ...) below
// and must not be hoisted in individual test files
export const dnsLookupMock = vi.fn();
export const initBookMock = vi.fn();
export const runRadarMock = vi.fn();
export const reviseDraftMock = vi.fn();
export const resyncChapterArtifactsMock = vi.fn();
export const writeNextChapterMock = vi.fn();
export const rollbackToChapterMock = vi.fn();
export const saveChapterIndexMock = vi.fn();
export const loadChapterIndexMock = vi.fn();
export const loadBookConfigMock = vi.fn();
export const listBooksMock = vi.fn();
export const getNextChapterNumberMock = vi.fn();
export const auditChapterMock = vi.fn();
export const createLLMClientMock = vi.fn(() => ({}));
export const chatCompletionMock = vi.fn();
export const loadProjectConfigMock = vi.fn();
export const pipelineConfigs: unknown[] = [];

// ─── agent / session mocks ───────────────────────────────────────────────────
export const processProjectInteractionInputMock = vi.fn();
export const processProjectInteractionRequestMock = vi.fn();
export const createInteractionToolsFromDepsMock = vi.fn(() => ({}));
export const loadProjectSessionMock = vi.fn();
export const resolveSessionActiveBookMock = vi.fn();
export const runAgentSessionMock = vi.fn();
export const createAndPersistBookSessionMock = vi.fn();
export const loadBookSessionMock = vi.fn();
export const persistBookSessionMock = vi.fn();
export const appendBookSessionMessageMock = vi.fn();
export const appendManualSessionMessagesMock = vi.fn();
export const renameBookSessionMock = vi.fn();
export const deleteBookSessionMock = vi.fn();
export const migrateBookSessionMock = vi.fn();

// ─── service / secrets mocks ─────────────────────────────────────────────────
export const resolveServiceModelMock = vi.fn();
export const loadSecretsMock = vi.fn();
export const saveSecretsMock = vi.fn();
export const setServiceApiKeyMock = vi.fn();
export const getServiceApiKeyMock = vi.fn();

// ─── chapter intents mocks ───────────────────────────────────────────────────
export const loadChapterIntentsMock = vi.fn(async () => ({ intents: [], updatedAt: new Date().toISOString() }));
export const saveChapterIntentsMock = vi.fn();
export const getChapterIntentMock = vi.fn(() => undefined);
export const upsertChapterIntentMock = vi.fn((intents: readonly unknown[], intent: unknown) => [...intents, intent]);

// ─── service presets ─────────────────────────────────────────────────────────
export type ServicePresetMock = {
  providerFamily: "openai" | "anthropic";
  baseUrl: string;
  modelsBaseUrl?: string;
  knownModels: string[];
};

export const SERVICE_PRESETS_MOCK: Record<string, ServicePresetMock> = {
  openai: { providerFamily: "openai", baseUrl: "https://api.openai.com/v1", modelsBaseUrl: "https://api.openai.com/v1", knownModels: [] as string[] },
  anthropic: { providerFamily: "anthropic", baseUrl: "https://api.anthropic.com", modelsBaseUrl: "https://api.anthropic.com", knownModels: [] as string[] },
  moonshot: { providerFamily: "openai", baseUrl: "https://api.moonshot.cn/v1", modelsBaseUrl: "https://api.moonshot.cn/v1", knownModels: [] as string[] },
  minimax: { providerFamily: "openai", baseUrl: "https://api.minimaxi.com/v1", modelsBaseUrl: "https://api.minimaxi.com/v1", knownModels: [] as string[] },
  bailian: { providerFamily: "anthropic", baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic", modelsBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", knownModels: [] as string[] },
  google: { providerFamily: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", modelsBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", knownModels: [] as string[] },
  kkaiapi: { providerFamily: "openai", baseUrl: "https://api.kkaiapi.com/v1", modelsBaseUrl: "https://api.kkaiapi.com/v1", knownModels: [] as string[] },
  ollama: { providerFamily: "openai", baseUrl: "http://localhost:11434/v1", modelsBaseUrl: "http://localhost:11434/v1", knownModels: [] as string[] },
  custom: { providerFamily: "openai", baseUrl: "", knownModels: [] as string[] },
};

export const resolveServicePresetMock = vi.fn((service: string) => SERVICE_PRESETS_MOCK[service]);
export const resolveServiceProviderFamilyMock = vi.fn((service: string) => resolveServicePresetMock(service)?.providerFamily);
export const resolveServiceModelsBaseUrlMock = vi.fn((service: string) => {
  const preset = SERVICE_PRESETS_MOCK[service];
  return preset?.modelsBaseUrl ?? preset?.baseUrl;
});
export const listModelsForServiceMock = vi.fn(async (service: string, apiKey?: string, liveBaseUrl?: string) => {
  const preset = resolveServicePresetMock(service);
  if (!preset) return [];
  if (preset.knownModels.length > 0) {
    return preset.knownModels.map((id) => ({ id, name: id, reasoning: false, contextWindow: 0 }));
  }
  const modelsBaseUrl = liveBaseUrl ?? resolveServiceModelsBaseUrlMock(service);
  const allowsNoKey = Boolean(modelsBaseUrl?.startsWith("http://localhost") || modelsBaseUrl?.startsWith("http://127.0.0.1"));
  if ((!apiKey && !allowsNoKey) || !modelsBaseUrl) return [];
  const res = await fetch(`${modelsBaseUrl.replace(/\/$/, "")}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const json = await res.json() as { data?: Array<{ id: string }> };
  return (json.data ?? []).map((model) => ({
    id: model.id,
    name: model.id,
    reasoning: false,
    contextWindow: 0,
  }));
});

// ─── endpoint / probe mocks ──────────────────────────────────────────────────
export const endpointIdsByGroup = {
  overseas: ["anthropic", "google", "mistral", "openai", "xai"],
  china: [
    "ai360", "baichuan", "bailian", "deepseek", "hunyuan", "internlm", "longcat",
    "minimax", "moonshot", "sensenova", "spark", "stepfun", "tencentcloud",
    "volcengine", "wenxin", "xiaomimimo", "zeroone", "zhipu",
  ],
  aggregator: ["kkaiapi", "openrouter", "newapi", "siliconcloud"],
  local: ["githubCopilot", "ollama"],
  codingPlan: [
    "astronCodingPlan", "bailianCodingPlan", "glmCodingPlan", "kimiCodingPlan", "kimicode",
    "minimaxCodingPlan", "opencodeCodingPlan", "volcengineCodingPlan",
  ],
} as const;

export const endpointMocks = [
  ...Object.entries(endpointIdsByGroup).flatMap(([group, ids]) => ids.map((id) => ({
    id,
    label: id,
    group,
    api: id === "anthropic" || id === "bailian"
      ? "anthropic-messages"
      : id === "google"
        ? "google-generative-ai"
        : id === "openai" || id === "openrouter" || id === "githubCopilot"
          ? "openai-responses"
          : "openai-completions",
    baseUrl: id === "ollama" ? "http://localhost:11434/v1" : `https://api.${id}.test/v1`,
    ...(id === "google" ? { checkModel: "gemini-2.5-flash" } : {}),
    ...(id === "minimax" ? { checkModel: "MiniMax-M2.7" } : {}),
    ...(id === "ollama" ? { checkModel: "llama3.2:3b" } : {}),
    ...(id === "volcengine" ? { checkModel: "doubao-lite-32k" } : {}),
    models: [
      { id: `${id}-model`, maxOutput: 4096, contextWindowTokens: 32768, enabled: true },
      { id: `${id}-disabled`, maxOutput: 4096, contextWindowTokens: 32768, enabled: false },
    ],
  }))),
  { id: "custom", label: "自定义端点", api: "openai-completions", baseUrl: "", models: [] },
];

export const getAllEndpointsMock = vi.fn(() => endpointMocks);
export const probeModelsFromUpstreamMock = vi.fn(async () => [
  { id: "custom-model", name: "custom-model", contextWindow: 0 },
]);

// ─── logger ──────────────────────────────────────────────────────────────────
export const logger = {
  child: () => logger,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// ─── DNS mock ────────────────────────────────────────────────────────────────
vi.mock("node:dns/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns/promises")>();
  return {
    ...actual,
    lookup: dnsLookupMock,
  };
});

// ─── Core package mock ───────────────────────────────────────────────────────
vi.mock("@actalk/inkos-core", async (importOriginal) => {
  let actual: Record<string, unknown>;
  try {
    actual = await importOriginal<typeof import("@actalk/inkos-core")>() as unknown as Record<string, unknown>;
  } catch {
    actual = {
      isSafeBookId: vi.fn((s: string) => /^[a-zA-Z0-9_-]+$/.test(s)),
      normalizePlatformOrOther: vi.fn((p: string) => p),
      listAvailableGenres: vi.fn(() => []),
      readGenreProfile: vi.fn(() => null),
      getBuiltinGenresDir: vi.fn(() => "/tmp/genres"),
      resolveWritingReviewRetries: vi.fn(() => ({ maxRetries: 3, retryDelayMs: 1000 })),
      COVER_PROVIDER_PRESETS: {},
      coverSecretKey: vi.fn((k: string) => k),
      resolveCoverProviderPreset: vi.fn(() => null),
      isApiKeyOptionalForEndpoint: vi.fn(() => false),
      listAuthorProfiles: vi.fn(() => []),
      getAuthorProfile: vi.fn(() => null),
      createAuthorProfile: vi.fn(),
      addStyleSource: vi.fn(),
      reanalyzeAuthorProfile: vi.fn(),
      deleteAuthorProfile: vi.fn(),
      deleteStyleSource: vi.fn(),
      extractDocumentFromText: vi.fn(() => ({ text: "", metadata: {} })),
      buildAuthorProfile: vi.fn(() => ({})),
      planChapterImport: vi.fn(() => ({ chapters: [] })),
      loadChapterGoals: vi.fn(() => ({ goals: [], updatedAt: "" })),
      saveChapterGoals: vi.fn(),
      getChapterGoal: vi.fn(() => undefined),
      upsertChapterGoal: vi.fn((goals: readonly unknown[], goal: unknown) => [...goals, goal]),
      removeChapterGoal: vi.fn((goals: readonly unknown[], cn: number) => goals.filter((g: unknown) => (g as { chapterNumber: number }).chapterNumber !== cn)),
      AuthorChapterIntentSchema: { parse: vi.fn((v: unknown) => v) },
      listRoleCards: vi.fn(() => []),
      loadRoleCard: vi.fn(() => null),
      saveRoleCard: vi.fn(),
      deleteRoleCard: vi.fn(),
      createRoleCardTemplate: vi.fn(() => ({})),
      appendAuditHistory: vi.fn(),
      loadAuditHistory: vi.fn(() => []),
      loadChapterIntents: vi.fn(() => ({ intents: [], updatedAt: "" })),
      saveChapterIntents: vi.fn(),
      getChapterIntent: vi.fn(() => undefined),
      upsertChapterIntent: vi.fn((intents: readonly unknown[], i: unknown) => [...intents, i]),
      buildAuthorIntentBlock: vi.fn(() => ""),
      generateSuggestions: vi.fn(() => []),
      GLOBAL_ENV_PATH: "/tmp/inkos-global.env",
    };
  }

  class MockSessionAlreadyMigratedError extends Error {
    constructor(message = "Session already migrated") {
      super(message);
      this.name = "SessionAlreadyMigratedError";
    }
  }

  class MockStateManager {
    constructor(private readonly root: string) {}

    async listBooks(): Promise<string[]> {
      return (await listBooksMock()) as string[];
    }

    async loadBookConfig(bookId?: string): Promise<never> {
      return await loadBookConfigMock(bookId) as never;
    }

    async loadChapterIndex(bookId: string): Promise<[]> {
      return (await loadChapterIndexMock(bookId)) as [];
    }

    async saveChapterIndex(bookId: string, index: unknown): Promise<void> {
      await saveChapterIndexMock(bookId, index);
    }

    async rollbackToChapter(bookId: string, chapterNumber: number): Promise<number[]> {
      return (await rollbackToChapterMock(bookId, chapterNumber)) as number[];
    }

    async getNextChapterNumber(bookId?: string): Promise<number> {
      return (await getNextChapterNumberMock(bookId)) as number;
    }

    async ensureControlDocuments(): Promise<void> {
      // no-op in tests
    }

    bookDir(id: string): string {
      return join(this.root, "books", id);
    }
  }

  class MockPipelineRunner {
    constructor(config: unknown) {
      pipelineConfigs.push(config);
    }

    initBook = initBookMock;
    runRadar = runRadarMock;
    reviseDraft = reviseDraftMock;
    resyncChapterArtifacts = resyncChapterArtifactsMock;
    writeNextChapter = writeNextChapterMock;
    dispose = vi.fn();
    resetForReuse = vi.fn();
  }

  class MockScheduler {
    private running = false;

    constructor(_config: unknown) {}

    async start(): Promise<void> {
      this.running = true;
      await schedulerStartMock();
    }

    stop(): void {
      this.running = false;
    }

    get isRunning(): boolean {
      return this.running;
    }
  }

  class MockContinuityAuditor {
    constructor(readonly config: unknown) {}

    auditChapter = auditChapterMock;
  }

  return {
    StateManager: MockStateManager,
    PipelineRunner: MockPipelineRunner,
    Scheduler: MockScheduler,
    ContinuityAuditor: MockContinuityAuditor,
    createLLMClient: createLLMClientMock,
    createLogger: vi.fn(() => logger),
    computeAnalytics: vi.fn(() => ({})),
    isSafeBookId: actual.isSafeBookId,
    normalizePlatformOrOther: actual.normalizePlatformOrOther,
    chatCompletion: chatCompletionMock,
    loadProjectConfig: loadProjectConfigMock,
    processProjectInteractionInput: processProjectInteractionInputMock,
    processProjectInteractionRequest: processProjectInteractionRequestMock,
    createInteractionToolsFromDeps: createInteractionToolsFromDepsMock,
    loadProjectSession: loadProjectSessionMock,
    resolveSessionActiveBook: resolveSessionActiveBookMock,
    runAgentSession: runAgentSessionMock,
    buildAgentSystemPrompt: vi.fn(() => "You are helpful."),
    listAvailableGenres: actual.listAvailableGenres,
    readGenreProfile: actual.readGenreProfile,
    getBuiltinGenresDir: actual.getBuiltinGenresDir,
    createAndPersistBookSession: createAndPersistBookSessionMock,
    loadBookSession: loadBookSessionMock,
    persistBookSession: persistBookSessionMock,
    appendBookSessionMessage: appendBookSessionMessageMock,
    appendManualSessionMessages: appendManualSessionMessagesMock,
    isNewLayoutBook: vi.fn(async () => false),
    isWriteNextInstruction: vi.fn((instruction: string) => ["继续", "写下一章", "write next", "下一章", "继续写"].some(k => instruction.includes(k))),
    resolveArchitectBookIdFromArgs: vi.fn(() => undefined),
    renameBookSession: renameBookSessionMock,
    deleteBookSession: deleteBookSessionMock,
    migrateBookSession: migrateBookSessionMock,
    SessionAlreadyMigratedError: MockSessionAlreadyMigratedError,
    resolveServicePreset: resolveServicePresetMock,
    resolveServiceProviderFamily: resolveServiceProviderFamilyMock,
    resolveServiceModelsBaseUrl: resolveServiceModelsBaseUrlMock,
    resolveServiceModel: resolveServiceModelMock,
    resolveWritingReviewRetries: actual.resolveWritingReviewRetries,
    COVER_PROVIDER_PRESETS: actual.COVER_PROVIDER_PRESETS,
    coverSecretKey: actual.coverSecretKey,
    resolveCoverProviderPreset: actual.resolveCoverProviderPreset,
    isApiKeyOptionalForEndpoint: actual.isApiKeyOptionalForEndpoint,
    loadSecrets: loadSecretsMock,
    saveSecrets: saveSecretsMock,
    setServiceApiKey: setServiceApiKeyMock,
    getServiceApiKey: getServiceApiKeyMock,
    listModelsForService: listModelsForServiceMock,
    getAllEndpoints: getAllEndpointsMock,
    probeModelsFromUpstream: probeModelsFromUpstreamMock,
    fetchWithProxy: vi.fn((input: Parameters<typeof fetch>[0], init?: RequestInit) => fetch(input, init)),
    listAuthorProfiles: actual.listAuthorProfiles,
    getAuthorProfile: actual.getAuthorProfile,
    createAuthorProfile: actual.createAuthorProfile,
    addStyleSource: actual.addStyleSource,
    reanalyzeAuthorProfile: actual.reanalyzeAuthorProfile,
    deleteAuthorProfile: actual.deleteAuthorProfile,
    deleteStyleSource: actual.deleteStyleSource,
    extractDocumentFromText: actual.extractDocumentFromText,
    buildAuthorProfile: actual.buildAuthorProfile,
    planChapterImport: actual.planChapterImport,
    loadChapterGoals: actual.loadChapterGoals,
    saveChapterGoals: actual.saveChapterGoals,
    loadChapterIntents: loadChapterIntentsMock,
    saveChapterIntents: saveChapterIntentsMock,
    getChapterIntent: getChapterIntentMock,
    upsertChapterIntent: upsertChapterIntentMock,
    AuthorChapterIntentSchema: actual.AuthorChapterIntentSchema,
    getChapterGoal: actual.getChapterGoal,
    upsertChapterGoal: actual.upsertChapterGoal,
    removeChapterGoal: actual.removeChapterGoal,
    listRoleCards: actual.listRoleCards,
    loadRoleCard: actual.loadRoleCard,
    saveRoleCard: actual.saveRoleCard,
    deleteRoleCard: actual.deleteRoleCard,
    createRoleCardTemplate: actual.createRoleCardTemplate,
    appendAuditHistory: actual.appendAuditHistory,
    loadAuditHistory: actual.loadAuditHistory,
    listFoundationSources: vi.fn(() => []),
    archiveFoundationSource: vi.fn(),
    summarizePendingHookHealth: vi.fn(() => ({ total: 0, open: 0, stale: 0 })),
    listBookSessions: vi.fn(() => []),
    buildExportArtifact: vi.fn(() => ({ content: "", filename: "export.txt" })),
    ChapterMetaSchema: { parse: vi.fn((v: unknown) => v) },
    saveAuthorDiagnostics: vi.fn(),
    listAuthorDiagnostics: vi.fn(() => []),
    getAuthorDiagnostics: vi.fn(() => null),
    compareWithAuthorProfile: vi.fn(() => ({ similarities: [], differences: [] })),
    generateAdjustmentPlan: vi.fn(() => ({ adjustments: [] })),
    rewriteWithAuthorProfile: vi.fn(() => ({ content: "", applied: false })),
    extractDocumentChunked: vi.fn(() => []),
    MAX_CHARS: 100000,
    buildFoundationSourceBundle: vi.fn(() => ({})),
    isDocumentFileType: vi.fn(() => false),
    isFoundationSourcePurpose: vi.fn(() => false),
    persistFoundationSourceBundle: vi.fn(),
    removeChapterIntent: vi.fn((intents: readonly unknown[], cn: number) => intents.filter((i: unknown) => (i as { chapterNumber: number }).chapterNumber !== cn)),
    buildAuthorIntentBlock: vi.fn(() => ""),
    generateSuggestions: vi.fn(() => []),
    sendTelegram: vi.fn(),
    sendFeishu: vi.fn(),
    sendWechatWork: vi.fn(),
    sendWebhook: vi.fn(),
    analyzeStyleFingerprint: vi.fn(() => ({})),
    GLOBAL_ENV_PATH: join(tmpdir(), "inkos-global.env"),
  };
});
