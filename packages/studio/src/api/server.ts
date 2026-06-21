import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import {
  StateManager,
  PipelineRunner,
  createLLMClient,
  createLogger,
  createInteractionToolsFromDeps,
  computeAnalytics,
  loadProjectConfig,
  listFoundationSources,
  archiveFoundationSource,
  summarizePendingHookHealth,
  loadProjectSession,
  processProjectInteractionRequest,
  resolveSessionActiveBook,
  listBookSessions,
  loadBookSession,
  appendManualSessionMessages,
  createAndPersistBookSession,
  renameBookSession,
  deleteBookSession,
  migrateBookSession,
  SessionAlreadyMigratedError,
  runAgentSession,
  buildAgentSystemPrompt,
  resolveServicePreset,
  resolveServiceProviderFamily,
  resolveServiceModelsBaseUrl,
  resolveServiceModel,
  resolveWritingReviewRetries,
  loadSecrets,
  saveSecrets,
  setServiceApiKey,
  listModelsForService,
  isApiKeyOptionalForEndpoint,
  getAllEndpoints,
  probeModelsFromUpstream,
  fetchWithProxy,
  chatCompletion,
  buildExportArtifact,
  ChapterMetaSchema,
  GLOBAL_ENV_PATH,
  COVER_PROVIDER_PRESETS,
  Scheduler,
  coverSecretKey,
  resolveCoverProviderPreset,
  type ResolvedModel,
  type PipelineConfig,
  type ProjectConfig,
  type LogSink,
  type LogEntry,
  type ChapterMeta,
  listAuthorProfiles,
  getAuthorProfile,
  createAuthorProfile,
  addStyleSource,
  reanalyzeAuthorProfile,
  deleteAuthorProfile,
  deleteStyleSource,
  saveAuthorDiagnostics,
  listAuthorDiagnostics,
  getAuthorDiagnostics,
  compareWithAuthorProfile,
  generateAdjustmentPlan,
  rewriteWithAuthorProfile,
  extractDocumentFromText,
  extractDocumentChunked,
  MAX_CHARS,
  buildFoundationSourceBundle,
  isDocumentFileType,
  isFoundationSourcePurpose,
  persistFoundationSourceBundle,
  buildAuthorProfile,
  planChapterImport,
  loadChapterGoals,
  saveChapterGoals,
  getChapterGoal,
  upsertChapterGoal,
  removeChapterGoal,
  loadChapterIntents,
  saveChapterIntents,
  getChapterIntent,
  upsertChapterIntent,
  removeChapterIntent,
  AuthorChapterIntentSchema,
  buildAuthorIntentBlock,
  generateSuggestions,
  type AuthorChapterIntent,
  listRoleCards,
  loadRoleCard,
  saveRoleCard,
  deleteRoleCard,
  createRoleCardTemplate,
  appendAuditHistory,
  loadAuditHistory,
  type AuthorStyleProfile,
  type StyleSourceDocument,
  type StyleLibraryIndex,
  type ChapterImportPlan,
  type ChapterGoalCard,
  type RoleCard,
  type RoleTier,
  type AuditIssue,
  sendTelegram,
  sendFeishu,
  sendWechatWork,
  sendWebhook,
  analyzeStyleFingerprint,
  type StyleFingerprint,
  type ArchitectOutput,
  type FoundationSourceBundle,
  type FoundationSourceInput,
} from "@actalk/inkos-core";
import { loadStudioBookListSummary, type StudioBookListSummary } from "./shared/book-helpers.js";
import { randomUUID } from "node:crypto";
import { access, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { isIP } from "node:net";
import { isSafeBookId } from "./safety.js";
import { ApiError } from "./errors.js";
import { buildStudioBookConfig, type StudioCreateBookBody } from "./book-create.js";

// Route modules (extracted from this file to reduce file size)
import { registerEventsRoutes } from "./routes/events.js";
import { registerDaemonRoutes } from "./routes/daemon.js";
import { registerCoverRoutes } from "./routes/cover.js";
import { registerProjectRoutes } from "./routes/project.js";
import { registerLogsRoutes } from "./routes/logs.js";
import { registerGenresRoutes } from "./routes/genres.js";
import { registerAnalyticsRoutes } from "./routes/analytics.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerTruthBrowserRoutes } from "./routes/truth-browser.js";
import { registerLanguageRoutes } from "./routes/language.js";
import { registerModelOverridesRoutes, registerNotifyRoutes } from "./routes/project-config.js";
import { registerSourcesRoutes } from "./routes/sources.js";
import { registerHooksRoutes } from "./routes/hooks.js";
import { registerBooksRoutes } from "./routes/books.js";
import { registerChaptersRoutes } from "./routes/chapters.js";
import { registerServicesRoutes } from "./routes/services.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { registerStyleRoutes } from "./routes/style.js";
import { registerChapterIntentRoutes } from "./routes/chapter-intent.js";
import { registerImportRoutes } from "./routes/import-foundation.js";
import { registerAuthorsRoutes } from "./routes/authors.js";
import { registerEventChainRoutes } from "./routes/event-chain.js";
import { registerRhetoricRoutes } from "./routes/rhetoric.js";
import { registerStyleQualityRoutes } from "./routes/style-quality.js";
import { registerRuntimeTruthRoutes } from "./routes/runtime-truth.js";
import { registerVoicesSceneRoutes } from "./routes/voices-scene.js";
import { registerSessionsRoutes } from "./routes/sessions.js";
import { registerRolesRoutes } from "./routes/roles.js";
import { registerDetectRoutes } from "./routes/detect.js";
import { registerWritingRoutes } from "./routes/writing.js";
import { registerRevisionExportRoutes } from "./routes/revision-export.js";
import { registerFanficRadarDoctorRoutes } from "./routes/fanfic-radar-doctor.js";
import { registerAgentRoutes } from "./routes/agent.js";

// Shared helpers (extracted so route modules can import directly)
import { withPipeline, setPipelinePoolConfig, drainPipelinePool } from "./shared/pipeline.js";
import { registerStaticMiddleware } from "./static-middleware.js";
import {
  writeJobs,
  WRITE_JOB_TIMEOUT_MS,
  acquireWriteJob,
  completeWriteJob,
  failWriteJob,
  timeoutWriteJob,
  type WriteJobEntry,
} from "./shared/write-jobs.js";
import type { CollectedToolExec } from "./shared/agent-validation.js";
import {
  type ServiceConfigEntry,
  type LLMConfigSource,
  type EnvConfigSummary,
  type EnvConfigStatus,
  type ServiceProbeResult,
  isCustomServiceId,
  serviceConfigKey,
} from "./shared/service-helpers.js";

import {
  PreprocessRequestSchema,
  RelayoutRequestSchema,
  InspectRequestSchema,
  MAX_PREPROCESS_TEXT_CHARS,
  DiagnosticsRequestSchema,
  CompareRequestSchema,
  AdjustmentPlanRequestSchema,
  RewritePreviewRequestSchema,
} from "./style-schemas.js";

const NON_TEXT_MODEL_ID_PARTS = [
  "image",
  "embedding",
  "embed",
  "rerank",
  "tts",
  "speech",
  "audio",
  "moderation",
  "whisper",
  "transcribe",
  "sora",
  "realtime",
  "computer-use",
] as const;

const SERVICE_MODELS_PROBE_TIMEOUT_MS = 4_000;
const SERVICE_CHAT_PROBE_TIMEOUT_MS = 8_000;
const MAX_DISCOVERED_MODELS_TO_PING = 2;
const MAX_GENERIC_FALLBACK_MODELS_TO_PING = 2;

function isTextChatModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized) return false;
  return !NON_TEXT_MODEL_ID_PARTS.some((part) => normalized.includes(part));
}

function filterTextChatModels<T extends { readonly id: string }>(models: ReadonlyArray<T>): T[] {
  return models.filter((model) => isTextChatModelId(model.id));
}

// --- Event bus for SSE ---

type EventHandler = (event: string, data: unknown) => void;
const subscribers = new Set<EventHandler>();

function broadcast(event: string, data: unknown): void {
  for (const handler of subscribers) {
    handler(event, data);
  }
}


function normalizeServiceEntry(serviceId: string, value: Record<string, unknown>): ServiceConfigEntry {
  // 通用 extra 提取：透传写作参数（top_p / presence_penalty / frequency_penalty / seed / repetition_penalty）
  const extra = value.extra && typeof value.extra === "object" && !Array.isArray(value.extra)
    ? (value.extra as Record<string, unknown>)
    : undefined;
  const extraSpread = extra && Object.keys(extra).length > 0 ? { extra } : {};

  if (serviceId.startsWith("custom:")) {
    return {
      service: "custom",
      name: decodeURIComponent(serviceId.slice("custom:".length)),
      ...(typeof value.baseUrl === "string" && value.baseUrl.length > 0 ? { baseUrl: value.baseUrl } : {}),
      ...(typeof value.temperature === "number" ? { temperature: value.temperature } : {}),
      ...(value.apiFormat === "chat" || value.apiFormat === "responses" ? { apiFormat: value.apiFormat } : {}),
      ...(typeof value.stream === "boolean" ? { stream: value.stream } : {}),
      ...extraSpread,
    };
  }

  if (serviceId === "custom") {
    return {
      service: "custom",
      ...(typeof value.name === "string" && value.name.length > 0 ? { name: value.name } : {}),
      ...(typeof value.baseUrl === "string" && value.baseUrl.length > 0 ? { baseUrl: value.baseUrl } : {}),
      ...(typeof value.temperature === "number" ? { temperature: value.temperature } : {}),
      ...(value.apiFormat === "chat" || value.apiFormat === "responses" ? { apiFormat: value.apiFormat } : {}),
      ...(typeof value.stream === "boolean" ? { stream: value.stream } : {}),
      ...extraSpread,
    };
  }

  return {
    service: serviceId,
    ...(typeof value.temperature === "number" ? { temperature: value.temperature } : {}),
    ...(value.apiFormat === "chat" || value.apiFormat === "responses" ? { apiFormat: value.apiFormat } : {}),
    ...(typeof value.stream === "boolean" ? { stream: value.stream } : {}),
    ...extraSpread,
  };
}

function normalizeConfigSource(value: unknown): LLMConfigSource {
  return value === "studio" ? "studio" : "env";
}

function normalizeServiceConfig(raw: unknown): ServiceConfigEntry[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry) => ({
        service: typeof entry.service === "string" && entry.service.length > 0 ? entry.service : "custom",
        ...(typeof entry.name === "string" && entry.name.length > 0 ? { name: entry.name } : {}),
        ...(typeof entry.baseUrl === "string" && entry.baseUrl.length > 0 ? { baseUrl: entry.baseUrl } : {}),
        ...(typeof entry.temperature === "number" ? { temperature: entry.temperature } : {}),
        ...(entry.apiFormat === "chat" || entry.apiFormat === "responses" ? { apiFormat: entry.apiFormat } : {}),
        ...(typeof entry.stream === "boolean" ? { stream: entry.stream } : {}),
        // ✅ 写作参数透传（top_p / presence_penalty / frequency_penalty / seed / repetition_penalty）
        ...(entry.extra && typeof entry.extra === "object" && !Array.isArray(entry.extra)
          ? { extra: entry.extra as Record<string, unknown> }
          : {}),
      }));
  }

  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([, value]) => value && typeof value === "object")
      .map(([serviceId, value]) => normalizeServiceEntry(serviceId, value as Record<string, unknown>));
  }

  return [];
}

function mergeServiceConfig(existing: ServiceConfigEntry[], updates: ServiceConfigEntry[]): ServiceConfigEntry[] {
  const merged = new Map(existing.map((entry) => [serviceConfigKey(entry), entry]));
  for (const update of updates) {
    merged.set(serviceConfigKey(update), update);
  }
  return [...merged.values()];
}

function normalizeCoverConfig(raw: unknown): { service: string; model: string } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const service = typeof record.service === "string" ? record.service : "";
  const preset = resolveCoverProviderPreset(service);
  if (!preset) return undefined;
  const requestedModel = typeof record.model === "string" ? record.model.trim() : "";
  const model = requestedModel && preset.models.includes(requestedModel)
    ? requestedModel
    : preset.defaultModel;
  return { service: preset.service, model };
}

function syncTopLevelLlmMirror(llm: Record<string, unknown>): void {
  const selectedService = typeof llm.service === "string" ? llm.service : undefined;
  if (!selectedService) return;

  const services = normalizeServiceConfig(llm.services);
  const selectedEntry = services.find((entry) => serviceConfigKey(entry) === selectedService)
    ?? (!isCustomServiceId(selectedService) ? { service: selectedService } : undefined);
  if (!selectedEntry) return;

  const preset = resolveServicePreset(selectedEntry.service);
  llm.provider = resolveServiceProviderFamily(selectedEntry.service) ?? "openai";
  llm.baseUrl = selectedEntry.baseUrl ?? preset?.baseUrl ?? "";

  const defaultModel = typeof llm.defaultModel === "string" ? llm.defaultModel.trim() : "";
  if (defaultModel) llm.model = defaultModel;
  if (selectedEntry.temperature !== undefined) llm.temperature = selectedEntry.temperature;
  if (selectedEntry.apiFormat !== undefined) llm.apiFormat = selectedEntry.apiFormat;
  if (selectedEntry.stream !== undefined) llm.stream = selectedEntry.stream;
  // ✅ 同步写作参数到顶层（top_p / presence_penalty / frequency_penalty / seed / repetition_penalty）
  if (selectedEntry.extra !== undefined && typeof selectedEntry.extra === "object") {
    const existingExtra = llm.extra && typeof llm.extra === "object" && !Array.isArray(llm.extra)
      ? (llm.extra as Record<string, unknown>)
      : {};
    llm.extra = { ...existingExtra, ...selectedEntry.extra };
  }
}

// P1-2: mtime-based config cache — avoids re-reading inkos.json on every service probe
const rawConfigCache = new Map<string, { mtimeMs: number; config: Record<string, unknown> }>();
const RAW_CONFIG_CACHE_MAX = 10;

async function loadRawConfig(root: string): Promise<Record<string, unknown>> {
  const configPath = join(root, "inkos.json");
  try {
    const fileStat = await stat(configPath);
    const cached = rawConfigCache.get(root);
    if (cached && cached.mtimeMs === fileStat.mtimeMs) {
      return cached.config;
    }

    const raw = await readFile(configPath, "utf-8");
    if (!raw.trim()) {
      throw new SyntaxError("inkos.json is empty");
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (rawConfigCache.size >= RAW_CONFIG_CACHE_MAX && !rawConfigCache.has(root)) {
      rawConfigCache.delete(rawConfigCache.keys().next().value!);
    }
    rawConfigCache.set(root, { mtimeMs: fileStat.mtimeMs, config: parsed });
    return parsed;
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new ApiError(400, "INVALID_CONFIG", `inkos.json parse error: ${e.message}. Check the file at ${configPath} for syntax issues.`);
    }
    throw e;
  }
}

async function assertBookExists(state: StateManager, id: string): Promise<void> {
  try {
    await state.loadBookConfig(id);
  } catch {
    throw new ApiError(404, "BOOK_NOT_FOUND", `Book not found: ${id}`);
  }
}

async function assertBookDirectoryExists(state: StateManager, id: string): Promise<void> {
  try {
    const info = await lstat(state.bookDir(id));
    if (!info.isDirectory()) {
      throw new Error("not a directory");
    }
  } catch {
    throw new ApiError(404, "BOOK_NOT_FOUND", `Book not found: ${id}`);
  }
}

async function saveRawConfig(root: string, config: Record<string, unknown>): Promise<void> {
  const configPath = join(root, "inkos.json");
  const tmpPath = configPath + ".tmp." + Date.now().toString(36);
  const { rename: renameFile } = await import("node:fs/promises");
  await writeFile(tmpPath, JSON.stringify(config, null, 2), "utf-8");
  await renameFile(tmpPath, configPath);
}

async function readEnvConfigSummary(path: string): Promise<EnvConfigSummary> {
  try {
    const raw = await readFile(path, "utf-8");
    const values = new Map<string, string>();

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, value] = match;
      values.set(key, value.trim());
    }

    const provider = values.get("INKOS_LLM_PROVIDER") ?? null;
    const baseUrl = values.get("INKOS_LLM_BASE_URL") ?? null;
    const model = values.get("INKOS_LLM_MODEL") ?? null;
    const apiKey = values.get("INKOS_LLM_API_KEY") ?? "";
    const detected = Boolean(provider || baseUrl || model || apiKey);

    return {
      detected,
      provider,
      baseUrl,
      model,
      hasApiKey: apiKey.length > 0,
    };
  } catch {
    return {
      detected: false,
      provider: null,
      baseUrl: null,
      model: null,
      hasApiKey: false,
    };
  }
}

async function readEnvConfigStatus(root: string): Promise<EnvConfigStatus> {
  const project = await readEnvConfigSummary(join(root, ".env"));
  const global = await readEnvConfigSummary(GLOBAL_ENV_PATH);
  return {
    project,
    global,
    effectiveSource: project.detected ? "project" : global.detected ? "global" : null,
    runtimeUsesEnv: false,
  };
}

async function resolveConfiguredServiceBaseUrl(root: string, serviceId: string, inlineBaseUrl?: string): Promise<string | undefined> {
  if (inlineBaseUrl?.trim()) return inlineBaseUrl.trim();

  if (!isCustomServiceId(serviceId)) {
    return resolveServicePreset(serviceId)?.baseUrl;
  }

  try {
    const config = await loadRawConfig(root);
    const services = normalizeServiceConfig((config.llm as Record<string, unknown> | undefined)?.services);
    const matched = services.find((entry) => serviceConfigKey(entry) === serviceId);
    return matched?.baseUrl;
  } catch {
    return undefined;
  }
}

async function resolveConfiguredServiceEntry(root: string, serviceId: string): Promise<ServiceConfigEntry | undefined> {
  try {
    const config = await loadRawConfig(root);
    const services = normalizeServiceConfig((config.llm as Record<string, unknown> | undefined)?.services);
    return services.find((entry) => serviceConfigKey(entry) === serviceId);
  } catch {
    return undefined;
  }
}

function buildProbePlans(
  preferredApiFormat: "chat" | "responses" | undefined,
  preferredStream: boolean | undefined,
): Array<{ apiFormat: "chat" | "responses"; stream: boolean }> {
  const candidates: Array<{ apiFormat: "chat" | "responses"; stream: boolean }> = [];
  const seen = new Set<string>();
  const push = (apiFormat: "chat" | "responses", stream: boolean) => {
    const key = `${apiFormat}:${stream ? "1" : "0"}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ apiFormat, stream });
  };

  if (preferredApiFormat) {
    push(preferredApiFormat, preferredStream ?? false);
    if (preferredStream) push(preferredApiFormat, false);
    return candidates;
  }

  push("chat", false);
  push("responses", false);
  return candidates;
}

function buildModelCandidates(args: {
  preferredModel?: string;
  configModel?: string;
  envModel?: string | null;
  discoveredModels: Array<{ id: string; name: string }>;
  includeGenericFallbacks?: boolean;
}): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  const push = (value: string | null | undefined) => {
    if (!value || value.trim().length === 0) return;
    const id = value.trim();
    if (seen.has(id)) return;
    seen.add(id);
    candidates.push(id);
  };

  push(args.preferredModel);
  push(args.configModel);
  push(args.envModel ?? undefined);
  for (const model of args.discoveredModels.slice(0, MAX_DISCOVERED_MODELS_TO_PING)) push(model.id);
  if (args.includeGenericFallbacks === false) return candidates;
  for (const fallback of [
    "gpt-5.4",
    "gpt-4o",
    "claude-sonnet-4-6",
    "MiniMax-M2.7",
    "kimi-k2.5",
  ].slice(0, MAX_GENERIC_FALLBACK_MODELS_TO_PING)) {
    push(fallback);
  }
  return candidates;
}

function fallbackTextModelsForEndpoint(
  endpoint: ReturnType<typeof getAllEndpoints>[number] | undefined,
  preset: ReturnType<typeof resolveServicePreset> | undefined,
): Array<{ id: string; name: string }> {
  const endpointModels = endpoint?.models
    .filter((model) => model.enabled !== false)
    .filter((model) => isTextChatModelId(model.id))
    .map((model) => ({ id: model.id, name: model.id }))
    ?? [];
  if (endpointModels.length > 0) return endpointModels;
  return preset?.knownModels?.map((id) => ({ id, name: id })) ?? [];
}

function shouldTrustStaticModelsWhenLiveListUnavailable(endpoint: ReturnType<typeof getAllEndpoints>[number] | undefined): boolean {
  return endpoint?.group === "aggregator";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} 超时（${timeoutMs}ms）`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function formatServiceProbeError(args: {
  readonly service: string;
  readonly label?: string;
  readonly baseUrl: string;
  readonly model?: string;
  readonly apiFormat?: "chat" | "responses";
  readonly stream?: boolean;
  readonly error: string;
}): string {
  const rawDetail = args.error
    .replace(/\n\s*\(baseUrl:[\s\S]*?\)$/m, "")
    .trim();
  const upstreamDetail = rawDetail.includes("上游详情：")
    ? rawDetail
    : "";
  const context = [
    `服务商：${args.label ?? args.service}`,
    `测试模型：${args.model ?? "未确定"}`,
    `协议：${args.apiFormat === "responses" ? "Responses" : "Chat / Completions"}${typeof args.stream === "boolean" ? `，${args.stream ? "流式" : "非流式"}` : ""}`,
    `Base URL：${args.baseUrl}`,
  ].join("\n");

  if (args.service === "google") {
    return [
      "Google Gemini 测试连接失败。",
      context,
      "",
      "请优先检查：",
      "1. API Key 是否来自 Google AI Studio 的 Gemini API key，而不是 OAuth、Vertex AI 或其它 Google 服务凭据。",
      "2. 该 key 所属项目是否已启用 Gemini API，并且没有被限制到其它 API、来源或服务。",
      "3. 当前地区/账号是否允许访问 Gemini API。",
      "4. 如果 key 曾经泄露，请在 AI Studio 重新生成后再保存。",
      upstreamDetail ? `\n上游返回：${upstreamDetail}` : "",
    ].filter(Boolean).join("\n");
  }

  if (args.service === "moonshot" || args.service === "kimiCodingPlan" || args.service === "kimicode") {
    return [
      `${args.label ?? args.service} 测试连接失败。`,
      context,
      "",
      "请优先检查模型是否可用，以及 kimi-k2.x 这类模型是否需要 temperature=1。",
      rawDetail ? `\n上游返回：${rawDetail}` : "",
    ].filter(Boolean).join("\n");
  }

  return [
    `${args.label ?? args.service} 测试连接失败。`,
    context,
    "",
    "请检查 API Key、模型可用性、账号额度，以及协议类型是否匹配该服务商。",
    rawDetail ? `\n上游返回：${rawDetail}` : "",
  ].filter(Boolean).join("\n");
}

async function fetchModelsFromServiceBaseUrl(
  serviceId: string,
  baseUrl: string,
  apiKey: string,
  proxyUrl?: string,
): Promise<{ models: Array<{ id: string; name: string }>; error?: string; authFailed?: boolean }> {
  const endpoint = isCustomServiceId(serviceId)
    ? undefined
    : getAllEndpoints().find((ep) => ep.id === serviceId);
  const modelsBaseUrl = isCustomServiceId(serviceId)
    ? baseUrl
    : endpoint?.modelsBaseUrl ?? (endpoint ? baseUrl : resolveServiceModelsBaseUrl(serviceId) ?? baseUrl);
  const modelsUrl = modelsBaseUrl.replace(/\/$/, "") + "/models";
  try {
    const res = await fetchWithProxy(modelsUrl, {
      headers: buildBearerAuthHeaders(apiKey),
      signal: AbortSignal.timeout(SERVICE_MODELS_PROBE_TIMEOUT_MS),
    }, proxyUrl);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (serviceId === "moonshot") {
        return {
          models: [],
          error: formatMoonshotAuthenticationError(res.status, body),
          authFailed: res.status === 401 || res.status === 403,
        };
      }
      return {
        models: [],
        error: `服务商返回 ${res.status}: ${body.slice(0, 200)}`,
        authFailed: res.status === 401 || res.status === 403,
      };
    }
    const json = await res.json() as { data?: Array<{ id: string }> };
    return {
      models: (json.data ?? []).map((m) => ({ id: m.id, name: m.id })),
    };
  } catch (error) {
    return {
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function formatMoonshotAuthenticationError(status: number, body: string): string {
  const detail = body.trim().slice(0, 500);
  return [
    `Moonshot/Kimi 认证失败（HTTP ${status}）。`,
    "请使用 Moonshot 开放平台生成的 API Key，不要使用 kimi.com 网页登录 token、Cookie 或会员兑换码。",
    "请打开 https://platform.moonshot.cn/console/api-keys，登录后创建或复制有效的 API Key，并且只粘贴原始密钥。",
    "项目预设 Base URL：https://api.moonshot.cn/v1",
    detail ? `服务商原始返回：${detail}` : "",
  ].filter(Boolean).join("\n");
}

function buildBearerAuthHeaders(apiKey: string | undefined): Record<string, string> {
  const trimmed = apiKey?.trim() ?? "";
  if (!trimmed) return {};
  if (!/^[\x20-\x7e]+$/.test(trimmed)) {
    throw new Error("API Key 只能包含英文、数字和常见 ASCII 符号，请检查是否误粘贴了中文说明。");
  }
  return { Authorization: `Bearer ${trimmed}` };
}

async function probeServiceCapabilities(args: {
  root: string;
  service: string;
  apiKey: string;
  baseUrl: string;
  preferredApiFormat?: "chat" | "responses";
  preferredStream?: boolean;
  preferredModel?: string;
  proxyUrl?: string;
}): Promise<ServiceProbeResult> {
  const rawConfig = await loadRawConfig(args.root).catch(() => ({} as Record<string, unknown>));
  const llm = (rawConfig.llm as Record<string, unknown> | undefined) ?? {};
  const envConfig = await readEnvConfigStatus(args.root);
  const envModel = envConfig.effectiveSource === "project"
    ? envConfig.project.model
    : envConfig.effectiveSource === "global"
      ? envConfig.global.model
      : null;

  const baseService = isCustomServiceId(args.service) ? "custom" : args.service;
  const modelsResponse = await fetchModelsFromServiceBaseUrl(baseService, args.baseUrl, args.apiKey, args.proxyUrl);
  if (modelsResponse.authFailed) {
    return {
      ok: false,
      models: [],
      error: modelsResponse.error ?? "API Key 无效或无权访问模型列表。",
    };
  }
  const discoveredModels = filterTextChatModels(modelsResponse.models);
  const endpoint = getAllEndpoints().find((ep) => ep.id === baseService);
  const preset = resolveServicePreset(baseService);
  const discoveredFirstModel =
    discoveredModels.find((model) => isTextChatModelId(model.id))?.id
    ?? discoveredModels[0]?.id;
  if (modelsResponse.models.length > 0) {
    if (!discoveredFirstModel || !isTextChatModelId(discoveredFirstModel)) {
      return {
        ok: false,
        models: [],
        error: "模型列表可访问，但没有发现可用于文本对话的模型。",
      };
    }
    return {
      ok: true,
      models: discoveredModels,
      selectedModel: discoveredFirstModel,
      apiFormat: args.preferredApiFormat ?? "chat",
      stream: args.preferredStream ?? false,
      baseUrl: args.baseUrl,
      modelsSource: "api",
    };
  }
  if (shouldTrustStaticModelsWhenLiveListUnavailable(endpoint)) {
    const models = fallbackTextModelsForEndpoint(endpoint, preset);
    const selectedModel =
      endpoint?.checkModel && models.some((model) => model.id === endpoint.checkModel)
        ? endpoint.checkModel
        : models[0]?.id;
    if (selectedModel) {
      return {
        ok: true,
        models,
        selectedModel,
        apiFormat: args.preferredApiFormat ?? "chat",
        stream: args.preferredStream ?? false,
        baseUrl: args.baseUrl,
        modelsSource: "fallback",
      };
    }
  }
  // Prefer live /models results; if unavailable, probe with the service's own check model before global defaults.
  const serviceFirstModel =
    endpoint?.checkModel
    ?? preset?.knownModels?.[0]
    ?? endpoint?.models.find((model) => model.enabled !== false)?.id;
  const useDynamicLocalModels = baseService === "ollama";
  const useEndpointCheckModel = !useDynamicLocalModels
    && !isCustomServiceId(args.service)
    && discoveredModels.length === 0
    && Boolean(endpoint?.checkModel);
  const configService = typeof llm.service === "string" ? llm.service : undefined;
  const configModel = !useEndpointCheckModel && configService === args.service
    ? typeof llm.defaultModel === "string"
      ? llm.defaultModel
      : typeof llm.model === "string"
        ? llm.model
        : undefined
    : undefined;
  const useCustomFallbacks = false;
  const modelCandidates = buildModelCandidates({
    preferredModel: args.preferredModel ?? serviceFirstModel,
    configModel,
    envModel: useCustomFallbacks ? envModel : undefined,
    discoveredModels: useEndpointCheckModel ? [] : discoveredModels,
    includeGenericFallbacks: useCustomFallbacks,
  });

  if (modelCandidates.length === 0) {
    return {
      ok: false,
      models: [],
      error: "无法自动确定模型，请先填写可用模型或提供支持 /models 的服务端点。",
    };
  }

  let lastError = modelsResponse.error ?? "自动探测失败";

  for (const model of modelCandidates) {
    for (const plan of buildProbePlans(args.preferredApiFormat, args.preferredStream)) {
      const client = createLLMClient({
        provider: resolveServiceProviderFamily(baseService) ?? "openai",
        service: baseService,
        configSource: "studio",
        baseUrl: args.baseUrl,
        apiKey: args.apiKey.trim(),
        model,
        temperature: 0.7,
        maxTokens: 16,
        thinkingBudget: 0,
        proxyUrl: args.proxyUrl,
        apiFormat: plan.apiFormat,
        stream: plan.stream,
      } as ProjectConfig["llm"]);

      try {
        await withTimeout(
          chatCompletion(client, model, [{ role: "user", content: "Reply with OK only." }], { maxTokens: 16 }),
          SERVICE_CHAT_PROBE_TIMEOUT_MS,
          "service connection test",
        );
        const models = discoveredModels.length > 0
          ? discoveredModels
          : fallbackTextModelsForEndpoint(endpoint, preset);
        return {
          ok: true,
          models: models.length > 0 ? models : [{ id: model, name: model }],
          selectedModel: model,
          apiFormat: plan.apiFormat,
          stream: plan.stream,
          baseUrl: args.baseUrl,
          modelsSource: discoveredModels.length > 0 ? "api" : "fallback",
        };
      } catch (error) {
        lastError = formatServiceProbeError({
          service: baseService,
          label: endpoint?.label ?? preset?.label,
          baseUrl: args.baseUrl,
          model,
          apiFormat: plan.apiFormat,
          stream: plan.stream,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    ok: false,
    models: discoveredModels,
    error: lastError,
  };
}

// --- Server factory ---

// Foundation plan persistence directory
const PLANS_DIR = ".inkos/plans";

async function loadPersistedFoundationPlans(root: string): Promise<Map<string, FoundationPlanEntry>> {
  const plans = new Map<string, FoundationPlanEntry>();
  const plansDir = join(root, PLANS_DIR);
  try {
    const files = await readdir(plansDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(plansDir, file), "utf-8");
        const entry = JSON.parse(raw) as FoundationPlanEntry;
        if (entry.expiresAt > Date.now()) {
          plans.set(file.replace(/\.json$/, ""), entry);
        }
      } catch {
        // Skip corrupted files
      }
    }
  } catch {
    // Directory doesn't exist yet
  }
  return plans;
}

async function persistFoundationPlan(root: string, planId: string, entry: FoundationPlanEntry): Promise<void> {
  const plansDir = join(root, PLANS_DIR);
  await mkdir(plansDir, { recursive: true }).catch(() => {});
  await writeFile(join(plansDir, `${planId}.json`), JSON.stringify(entry), "utf-8");
}

async function removePersistedFoundationPlan(root: string, planId: string): Promise<void> {
  await rm(join(root, PLANS_DIR, `${planId}.json`), { force: true }).catch(() => {});
}

interface FoundationPlanEntry {
  readonly bookId: string;
  readonly mode: "supplement" | "rebuild";
  readonly proposed: ArchitectOutput;
  readonly foundationRevision: string;
  readonly sourceBundle: FoundationSourceBundle;
  readonly expiresAt: number;
}

export function createStudioServer(initialConfig: ProjectConfig, root: string) {
  const app = new Hono();
  // Load persisted plans on startup; expired ones are filtered out automatically
  const foundationPlans = new Map<string, FoundationPlanEntry>();
  let foundationPlansLoaded = false;
  const foundationPlansPromise = loadPersistedFoundationPlans(root)
    .then((loaded) => {
      for (const [id, entry] of loaded) foundationPlans.set(id, entry);
      foundationPlansLoaded = true;
    })
    .catch((e) => {
      foundationPlansLoaded = true;
      console.error("[studio] Failed to load persisted foundation plans:", e);
    });
  const state = new StateManager(root);
  let cachedConfig = initialConfig;

  // CORS: only allow the Studio's own origin. When behind a proxy, set STUDIO_ORIGIN.
  const allowedOrigin = process.env.STUDIO_ORIGIN || "http://localhost:4577";
  app.use("/*", cors({ origin: allowedOrigin, credentials: true }));

  // P2-6: Request body size limit — prevent malicious large JSON payloads from OOM
  const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB
  app.use("/*", async (c, next) => {
    const contentLength = c.req.header("content-length");
    if (contentLength) {
      const len = Number(contentLength);
      if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
        return c.json({ error: { code: "PAYLOAD_TOO_LARGE", message: `Request body exceeds ${MAX_BODY_BYTES / 1024 / 1024}MB limit` } }, 413);
      }
    }
    await next();
  });

  // P2-10: API response time monitoring — logs requests exceeding threshold
  const SLOW_REQUEST_THRESHOLD_MS = 2000;
  app.use("/*", async (c, next) => {
    const start = Date.now();
    await next();
    const elapsed = Date.now() - start;
    if (elapsed > SLOW_REQUEST_THRESHOLD_MS) {
      console.warn(`[perf] ${c.req.method} ${c.req.path} took ${elapsed}ms`);
    }
  });

  // Structured error handler — ApiError returns typed JSON, others return 500
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status as 400);
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("LLM API key not set") || message.includes("INKOS_LLM_API_KEY not set")) {
      return c.json({ error: { code: "LLM_CONFIG_ERROR", message } }, 400);
    }
    console.error("[studio] Unexpected server error", error);
    return c.json(
      { error: { code: "INTERNAL_ERROR", message: "Unexpected server error." } },
      500,
    );
  });

  // BookId validation middleware — blocks path traversal on all book routes
  app.use("/api/v1/books/:id/*", async (c, next) => {
    const bookId = c.req.param("id");
    if (!isSafeBookId(bookId)) {
      throw new ApiError(400, "INVALID_BOOK_ID", `Invalid book ID: "${bookId}"`);
    }
    await next();
  });
  app.use("/api/v1/books/:id", async (c, next) => {
    const bookId = c.req.param("id");
    if (!isSafeBookId(bookId)) {
      throw new ApiError(400, "INVALID_BOOK_ID", `Invalid book ID: "${bookId}"`);
    }
    await next();
  });

  // Logger sink that broadcasts to SSE
  const sseSink: LogSink = {
    write(entry: LogEntry): void {
      broadcast("log", { level: entry.level, tag: entry.tag, message: entry.message });
    },
  };

  // Logger sink that prints to server terminal
  const consoleSink: LogSink = {
    write(entry: LogEntry): void {
      const prefix = `[${entry.tag}]`;
      if (entry.level === "warn") console.warn(prefix, entry.message);
      else if (entry.level === "error") console.error(prefix, entry.message);
      else console.log(prefix, entry.message);
    },
  };

  async function loadCurrentProjectConfig(
    options?: { readonly requireApiKey?: boolean },
  ): Promise<ProjectConfig> {
    const freshConfig = await loadProjectConfig(root, { ...options, consumer: "studio" });
    cachedConfig = freshConfig;
    return freshConfig;
  }

  async function buildPipelineConfig(
    overrides?: Partial<Pick<PipelineConfig, "externalContext" | "client" | "model">> & {
      readonly currentConfig?: ProjectConfig;
      readonly sessionIdForSSE?: string;
    },
  ): Promise<PipelineConfig> {
    const currentConfig = overrides?.currentConfig ?? await loadCurrentProjectConfig();
    const scopedSseSink: LogSink = overrides?.sessionIdForSSE
      ? {
          write(entry) {
            broadcast("log", {
              sessionId: overrides.sessionIdForSSE,
              level: entry.level,
              tag: entry.tag,
              message: entry.message,
            });
          },
        }
      : sseSink;
    const logger = createLogger({ tag: "studio", sinks: [scopedSseSink, consoleSink] });
    return {
      client: overrides?.client ?? createLLMClient(currentConfig.llm),
      model: overrides?.model ?? currentConfig.llm.model,
      projectRoot: root,
      defaultLLMConfig: currentConfig.llm,
      foundationReviewRetries: currentConfig.foundation?.reviewRetries ?? 2,
      writingReviewRetries: resolveWritingReviewRetries(
        currentConfig.writing?.reviewRetries ?? 1,
        currentConfig.writing?.qualityBudget ?? "economy",
      ),
      qualityBudget: currentConfig.writing?.qualityBudget ?? "economy",
      strictInterview: currentConfig.writing?.strictInterview ?? false,
      betaReaderMode: currentConfig.writing?.betaReaderMode ?? "off",
      betaReaderModelFamily: currentConfig.writing?.betaReaderModelFamily,
      modelOverrides: currentConfig.modelOverrides,
      notifyChannels: currentConfig.notify,
      logger,
      onStreamProgress: (progress) => {
        broadcast("llm:progress", {
          ...(overrides?.sessionIdForSSE ? { sessionId: overrides.sessionIdForSSE } : {}),
          status: progress.status,
          elapsedMs: progress.elapsedMs,
          totalChars: progress.totalChars,
          chineseChars: progress.chineseChars,
        });
      },
      externalContext: overrides?.externalContext,
    };
  }

  // ---------------------------------------------------------------------------
  // Security helpers
  // ---------------------------------------------------------------------------

  function assertProjectRoot(input: string | undefined, serverRoot: string): string {
    const candidate = input ? resolve(input) : resolve(serverRoot);
    const allowed = resolve(serverRoot);
    // Must be either the exact root, or directly within it (with separator)
    const withSep = allowed.endsWith(sep) ? allowed : allowed + sep;
    if (candidate !== allowed && !candidate.startsWith(withSep)) {
      throw new Error("Project root out of bounds");
    }
    return candidate;
  }

  function assertSafeAuthorId(id: string): string {
    const clean = id.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!clean || clean !== id) throw new Error(`Invalid authorId: ${id}`);
    return clean;
  }

  // ---- Route module context ----
  // Shared state injected into extracted route modules.
  // More routes will be extracted in subsequent phases.
  const routeContext = {
    app,
    root,
    state,
    broadcast,
    subscribers,
    getConfig: () => cachedConfig,
    loadCurrentProjectConfig,
    foundationPlans,
    foundationPlansPromise,
    persistFoundationPlan: (root: string, planId: string, entry: Record<string, unknown>) => persistFoundationPlan(root, planId, entry as unknown as FoundationPlanEntry),
    removePersistedFoundationPlan,
    get foundationPlansLoaded() { return foundationPlansLoaded; },
    schedulerInstance: { current: null as Scheduler | null },
    buildPipelineConfig,
    loadRawConfig,
    saveRawConfig,
    resolveConfiguredServiceBaseUrl,
    probeServiceCapabilities: (args: Record<string, unknown>) => probeServiceCapabilities(args as Parameters<typeof probeServiceCapabilities>[0]),
  };

  // Register extracted route modules (Phase 2: logs, genres, analytics, health, truth-browser, language, project-config)
  registerEventsRoutes(routeContext);
  registerDaemonRoutes(routeContext);
  registerCoverRoutes(routeContext);
  registerProjectRoutes(routeContext);
  registerLogsRoutes(routeContext);
  registerGenresRoutes(routeContext);
  registerAnalyticsRoutes(routeContext);
  registerHealthRoutes(routeContext);
  registerTruthBrowserRoutes(routeContext);
  registerLanguageRoutes(routeContext);
  registerModelOverridesRoutes(routeContext);
  registerNotifyRoutes(routeContext);
  registerSourcesRoutes(routeContext);
  registerHooksRoutes(routeContext);
  registerBooksRoutes(routeContext);
  registerServicesRoutes(routeContext);
  registerChaptersRoutes(routeContext);
  registerAuditRoutes(routeContext);
  registerStyleRoutes(routeContext);
  registerChapterIntentRoutes(routeContext);
  registerImportRoutes(routeContext);
  registerAuthorsRoutes(routeContext);
  registerEventChainRoutes(routeContext);
  registerRhetoricRoutes(routeContext);
  registerStyleQualityRoutes(routeContext);
  registerRuntimeTruthRoutes(routeContext);
  registerVoicesSceneRoutes(routeContext);
  registerSessionsRoutes(routeContext);
  registerRolesRoutes(routeContext);
  registerDetectRoutes(routeContext);
  registerWritingRoutes(routeContext);
  registerRevisionExportRoutes(routeContext);
  registerFanficRadarDoctorRoutes(routeContext);
  registerAgentRoutes(routeContext);

  // All extracted routes registered.

  // --- Books ---
  // (extracted to routes/books.ts, registered above)

  // --- Book Create ---
  // (extracted to routes/books.ts)

  // --- Chapters ---
  // (extracted to routes/chapters.ts, registered above)

  // --- Truth files & Runtime artifacts ---
  // (extracted to routes/runtime-truth.ts, registered above)

  // --- Style score & AIGC Detection ---
  // (extracted to routes/detect.ts, registered above)

  // --- Write preview & planning ---
  // (extracted to routes/writing.ts, registered above)

  // --- Write actions (write-next, draft, write-status) ---
  // (extracted to routes/writing.ts, registered above)

  // --- Agent chat ---
  // (extracted to routes/agent.ts, registered above)


  // --- Language setup ---
  // (extracted to routes/language.ts, registered above)

  // --- Audit ---
  // (extracted to routes/audit.ts, registered above)

  // --- Revise / Export / Rewrite / Resync ---
  // (extracted to routes/revision-export.ts, registered above)

  // --- Detect routes ---
  // (extracted to routes/detect.ts, registered above)

  // --- Genre Create / Edit / Delete ---
  // (extracted to routes/genres.ts, registered above)

  // --- Style routes ---
  // (extracted to routes/style.ts, registered above)

  // --- Scene Templates & Voice Profiles ---
  // (extracted to routes/voices-scene.ts, registered above)

  // --- State Changelog (M10/P2-1) ---
  // (extracted to routes/runtime-truth.ts, registered above)

  // --- Role Cards ---
  // (extracted to routes/roles.ts, registered above)

  // --- Fanfic / Radar / Doctor ---
  // (extracted to routes/fanfic-radar-doctor.ts, registered above)

  return app;
}

// --- Standalone runner ---

export async function startStudioServer(
  root: string,
  port = 4577,
  options?: { readonly staticDir?: string },
): Promise<void> {
  const config = await loadProjectConfig(root, { consumer: "studio", requireApiKey: false });

  const app = createStudioServer(config, root);

  // C7 (P2-7): Initialize pipeline pool for production use.
  setPipelinePoolConfig(() => ({
    client: createLLMClient(config.llm),
    model: config.llm.model,
    projectRoot: root,
    defaultLLMConfig: config.llm,
  }));
  process.once("beforeExit", () => { drainPipelinePool(); });

  // Serve frontend static files — single process for API + frontend
  if (options?.staticDir) {
    await registerStaticMiddleware(app, { staticDir: options.staticDir });
  }

  const host = process.env.STUDIO_HOST || "127.0.0.1";
  console.log(`InkOS Studio running on http://${host}:${port}`);
  serve({ fetch: app.fetch, hostname: host, port });
}
