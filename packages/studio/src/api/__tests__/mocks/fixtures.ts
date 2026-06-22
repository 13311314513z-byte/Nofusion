/**
 * Shared test fixtures and helpers for Studio server tests.
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  schedulerStartMock, initBookMock, runRadarMock, reviseDraftMock,
  resyncChapterArtifactsMock, writeNextChapterMock, rollbackToChapterMock,
  saveChapterIndexMock, loadChapterIndexMock, loadBookConfigMock,
  listBooksMock, getNextChapterNumberMock, auditChapterMock,
  createLLMClientMock, chatCompletionMock, loadProjectConfigMock,
  processProjectInteractionInputMock, processProjectInteractionRequestMock,
  createInteractionToolsFromDepsMock, loadProjectSessionMock,
  resolveSessionActiveBookMock, runAgentSessionMock,
  createAndPersistBookSessionMock, loadBookSessionMock,
  persistBookSessionMock, appendBookSessionMessageMock,
  appendManualSessionMessagesMock, renameBookSessionMock,
  deleteBookSessionMock, migrateBookSessionMock,
  resolveServiceModelMock, loadSecretsMock, saveSecretsMock,
  setServiceApiKeyMock, getServiceApiKeyMock,
  resolveServicePresetMock, resolveServiceProviderFamilyMock,
  resolveServiceModelsBaseUrlMock, listModelsForServiceMock,
  getAllEndpointsMock, probeModelsFromUpstreamMock,
  dnsLookupMock, pipelineConfigs,
} from "./core.mocks.js";

// ─── Project config ──────────────────────────────────────────────────────────
export const projectConfig = {
  name: "studio-test",
  version: "0.1.0",
  language: "zh",
  llm: {
    provider: "openai",
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    model: "gpt-5.4",
    temperature: 0.7,
    maxTokens: 4096,
    stream: false,
  },
  daemon: {
    schedule: {
      radarCron: "0 */6 * * *",
      writeCron: "*/15 * * * *",
    },
    maxConcurrentBooks: 1,
    chaptersPerCycle: 1,
    retryDelayMs: 30000,
    cooldownAfterChapterMs: 0,
    maxChaptersPerDay: 50,
  },
  modelOverrides: {},
  notify: [],
} as const;

export function cloneProjectConfig() {
  return structuredClone(projectConfig);
}

// ─── beforeEach setup (shared across all test files) ─────────────────────────
export async function setupTestRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "inkos-studio-server-"));
  await writeFile(join(root, "inkos.json"), JSON.stringify(projectConfig, null, 2), "utf-8");

  // Reset all mocks
  schedulerStartMock.mockReset();
  initBookMock.mockReset();
  runRadarMock.mockReset();
  reviseDraftMock.mockReset();
  resyncChapterArtifactsMock.mockReset();
  writeNextChapterMock.mockReset();
  rollbackToChapterMock.mockReset();
  saveChapterIndexMock.mockReset();
  loadChapterIndexMock.mockReset();
  loadBookConfigMock.mockReset();
  listBooksMock.mockReset();
  getNextChapterNumberMock.mockReset();
  auditChapterMock.mockReset();
  await mkdir(join(root, "books", "demo-book", "chapters"), { recursive: true });
  await writeFile(join(root, "books", "demo-book", "chapters", "0003_Demo.md"), "# Demo\n\nBody", "utf-8");
  runRadarMock.mockResolvedValue({
    marketSummary: "Fresh market summary",
    recommendations: [],
  });
  reviseDraftMock.mockResolvedValue({
    chapterNumber: 3,
    wordCount: 1800,
    fixedIssues: ["focus restored"],
    applied: true,
    status: "ready-for-review",
  });
  resyncChapterArtifactsMock.mockResolvedValue({
    chapterNumber: 3,
    title: "Synced Chapter",
    wordCount: 1800,
    revised: false,
    status: "ready-for-review",
    auditResult: { passed: true, issues: [], summary: "synced" },
  });
  writeNextChapterMock.mockResolvedValue({
    chapterNumber: 3,
    title: "Rewritten Chapter",
    wordCount: 1800,
    revised: false,
    status: "ready-for-review",
    auditResult: { passed: true, issues: [], summary: "rewritten" },
  });
  createLLMClientMock.mockReset();
  createLLMClientMock.mockReturnValue({});
  chatCompletionMock.mockReset();
  chatCompletionMock.mockResolvedValue({
    content: "pong",
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  });
  loadProjectConfigMock.mockReset();
  processProjectInteractionInputMock.mockReset();
  processProjectInteractionRequestMock.mockReset();
  createInteractionToolsFromDepsMock.mockReset();
  loadProjectSessionMock.mockReset();
  resolveSessionActiveBookMock.mockReset();
  createInteractionToolsFromDepsMock.mockReturnValue({});
  processProjectInteractionRequestMock.mockResolvedValue({
    request: { intent: "create_book" },
    session: {
      sessionId: "session-structured",
      projectRoot: root,
      activeBookId: "new-book",
      automationMode: "semi",
      messages: [],
      events: [],
    },
    details: {
      bookId: "new-book",
      outputPath: join(root, "books", "demo-book", "demo-book.txt"),
      chaptersExported: 2,
    },
  });
  loadProjectSessionMock.mockResolvedValue({
    sessionId: "agent-session-1",
    projectRoot: root,
    bookId: "demo-book",
    activeBookId: "demo-book",
    automationMode: "semi",
    messages: [],
    events: [],
  });
  resolveSessionActiveBookMock.mockReturnValue("demo-book");
  runAgentSessionMock.mockResolvedValue({
    response: "Done",
    session: { sessionId: "agent-session-1", projectRoot: root, activeBookId: "demo-book", automationMode: "semi", messages: [], events: [] },
  });
  createAndPersistBookSessionMock.mockResolvedValue({
    sessionId: "agent-session-2",
    projectRoot: root,
    activeBookId: "demo-book",
    automationMode: "semi",
    messages: [],
    events: [],
  });
  loadBookSessionMock.mockResolvedValue({
    sessionId: "agent-session-1",
    projectRoot: root,
    bookId: "demo-book",
    activeBookId: "demo-book",
    automationMode: "semi",
    messages: [],
    events: [],
  });
  persistBookSessionMock.mockResolvedValue(undefined);
  appendBookSessionMessageMock.mockResolvedValue(undefined);
  appendManualSessionMessagesMock.mockResolvedValue(undefined);
  renameBookSessionMock.mockResolvedValue(undefined);
  deleteBookSessionMock.mockResolvedValue(undefined);
  migrateBookSessionMock.mockResolvedValue(undefined);
  resolveServiceModelMock.mockReset();
  loadSecretsMock.mockReset();
  loadSecretsMock.mockResolvedValue({ services: {} });
  saveSecretsMock.mockReset();
  setServiceApiKeyMock.mockReset();
  getServiceApiKeyMock.mockReset();
  resolveServicePresetMock.mockClear();
  resolveServiceProviderFamilyMock.mockClear();
  resolveServiceModelsBaseUrlMock.mockClear();
  listModelsForServiceMock.mockClear();
  getAllEndpointsMock.mockClear();
  probeModelsFromUpstreamMock.mockClear();
  loadProjectConfigMock.mockResolvedValue(cloneProjectConfig());
  loadBookConfigMock.mockResolvedValue({
    id: "demo-book",
    title: "Demo Book",
    genre: "litrpg",
    platform: "web-novel",
    status: "active",
    targetChapters: 50,
    chapterWordCount: 2000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: "demo-book",
  });
  loadChapterIndexMock.mockResolvedValue([]);
  listBooksMock.mockResolvedValue([]);
  getNextChapterNumberMock.mockResolvedValue(4);
  auditChapterMock.mockResolvedValue({ passed: true, issues: [], summary: "ok" });
  dnsLookupMock.mockReset();
  dnsLookupMock.mockResolvedValue({ address: "93.184.216.34", family: 4 });
  pipelineConfigs.length = 0;

  return root;
}

// ─── afterEach cleanup (shared across all test files) ────────────────────────
export async function cleanupTestRoot(root: string): Promise<void> {
  const { rm } = await import("node:fs/promises");
  await rm(root, { recursive: true, force: true });
  await rm(join(tmpdir(), "inkos-global.env"), { force: true });
}
