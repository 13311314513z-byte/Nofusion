import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  chatCompletion,
  createLLMClient,
  fetchWithProxy,
  getAllEndpoints,
  GLOBAL_ENV_PATH,
  isApiKeyOptionalForEndpoint,
  listModelsForService,
  loadSecrets,
  probeModelsFromUpstream,
  resolveServiceModelsBaseUrl,
  resolveServicePreset,
  resolveServiceProviderFamily,
  saveSecrets,
  setServiceApiKey,
  type ProjectConfig,
} from "@actalk/inkos-core";
import type { ServerContext } from "../server-context.js";

type ServiceConfigEntry = Record<string, unknown>;
type ApiFormat = "chat" | "responses";

const modelListCache = new Map<string, {
  models: Array<{ id: string; name: string; maxOutput?: number; contextWindow?: number }>;
  at: number;
}>();

function isCustomServiceId(service: string): boolean {
  return service === "custom" || service.startsWith("custom:");
}

function serviceConfigKey(entry: ServiceConfigEntry): string {
  return entry.service === "custom" ? `custom:${entry.name ?? "Custom"}` : String(entry.service ?? "");
}

function normalizeServiceConfig(raw: unknown): ServiceConfigEntry[] {
  if (Array.isArray(raw)) {
    return raw.filter((entry): entry is ServiceConfigEntry => Boolean(entry) && typeof entry === "object");
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([, value]) => value && typeof value === "object")
      .map(([service, value]) => ({ service, ...(value as Record<string, unknown>) }));
  }
  return [];
}

function mergeServiceConfig(existing: ServiceConfigEntry[], incoming: ServiceConfigEntry[]): ServiceConfigEntry[] {
  const map = new Map<string, ServiceConfigEntry>();
  for (const entry of existing) map.set(serviceConfigKey(entry), entry);
  for (const entry of incoming) map.set(serviceConfigKey(entry), entry);
  return [...map.values()];
}

function normalizeConfigSource(value: unknown): "studio" | "env" {
  return value === "env" ? "env" : "studio";
}

function compareServiceListItems(a: { service: string }, b: { service: string }): number {
  const priority = ["kkaiapi", "openrouter", "newapi", "siliconcloud"];
  const ai = priority.indexOf(a.service);
  const bi = priority.indexOf(b.service);
  if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  return 0;
}

function isHeaderSafeApiKey(value: string): boolean {
  return !value || /^[\x21-\x7E]+$/.test(value);
}

function isTextChatModelId(id: string): boolean {
  const value = id.trim().toLowerCase();
  if (!value) return false;
  return !/embed|embedding|rerank|dall-e|whisper|tts|moderation|speech|image|audio|video|realtime|transcribe|sora|computer-use/u.test(value);
}

function filterTextChatModels(
  models: ReadonlyArray<{ id: string; name?: string; maxOutput?: number; contextWindow?: number }>,
): Array<{ id: string; name: string; maxOutput?: number; contextWindow?: number }> {
  return models.filter((model) => isTextChatModelId(model.id)).map((model) => ({
    id: model.id,
    name: model.name ?? model.id,
    ...(model.maxOutput !== undefined ? { maxOutput: model.maxOutput } : {}),
    ...(model.contextWindow !== undefined && model.contextWindow > 0 ? { contextWindow: model.contextWindow } : {}),
  }));
}

function mapEndpointModels(endpoint: ReturnType<typeof getAllEndpoints>[number]): Array<{
  id: string;
  name: string;
  maxOutput?: number;
  contextWindow?: number;
}> {
  return endpoint.models
    .filter((model) => model.enabled !== false)
    .filter((model) => isTextChatModelId(model.id))
    .map((model) => ({
      id: model.id,
      name: model.id,
      ...(typeof model.maxOutput === "number" ? { maxOutput: model.maxOutput } : {}),
      ...((model.contextWindowTokens ?? 0) > 0 ? { contextWindow: model.contextWindowTokens } : {}),
    }));
}

function fallbackTextModelsForEndpoint(
  endpoint: ReturnType<typeof getAllEndpoints>[number] | undefined,
  preset: ReturnType<typeof resolveServicePreset> | undefined,
): Array<{ id: string; name: string }> {
  const endpointModels = endpoint?.models
    .filter((model) => model.enabled !== false)
    .filter((model) => isTextChatModelId(model.id))
    .map((model) => ({ id: model.id, name: model.id })) ?? [];
  return endpointModels.length > 0 ? endpointModels : preset?.knownModels?.map((id) => ({ id, name: id })) ?? [];
}

function syncTopLevelLlmMirror(llm: Record<string, unknown>): void {
  const selectedService = typeof llm.service === "string" ? llm.service : undefined;
  if (!selectedService) return;
  const services = normalizeServiceConfig(llm.services);
  const entry = services.find((item) => serviceConfigKey(item) === selectedService)
    ?? (!isCustomServiceId(selectedService) ? { service: selectedService } : undefined);
  if (!entry) return;

  const service = String(entry.service ?? selectedService);
  const preset = resolveServicePreset(service);
  llm.provider = resolveServiceProviderFamily(service) ?? "openai";
  llm.baseUrl = typeof entry.baseUrl === "string" ? entry.baseUrl : preset?.baseUrl ?? "";
  const defaultModel = typeof llm.defaultModel === "string" ? llm.defaultModel.trim() : "";
  if (defaultModel) llm.model = defaultModel;
  if (typeof entry.temperature === "number") llm.temperature = entry.temperature;
  if (entry.apiFormat === "chat" || entry.apiFormat === "responses") llm.apiFormat = entry.apiFormat;
  if (typeof entry.stream === "boolean") llm.stream = entry.stream;
  if (entry.extra && typeof entry.extra === "object" && !Array.isArray(entry.extra)) {
    llm.extra = { ...((llm.extra && typeof llm.extra === "object" && !Array.isArray(llm.extra)) ? llm.extra : {}), ...entry.extra };
  }
}

async function readEnvConfigSummary(path: string): Promise<Record<string, unknown>> {
  try {
    const values = new Map<string, string>();
    for (const line of (await readFile(path, "utf-8")).split(/\r?\n/u)) {
      const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
      if (match) values.set(match[1], match[2].trim());
    }
    const provider = values.get("INKOS_LLM_PROVIDER") ?? null;
    const baseUrl = values.get("INKOS_LLM_BASE_URL") ?? null;
    const model = values.get("INKOS_LLM_MODEL") ?? null;
    const apiKey = values.get("INKOS_LLM_API_KEY") ?? "";
    return { detected: Boolean(provider || baseUrl || model || apiKey), provider, baseUrl, model, hasApiKey: apiKey.length > 0 };
  } catch {
    return { detected: false, provider: null, baseUrl: null, model: null, hasApiKey: false };
  }
}

async function readEnvConfigStatus(root: string): Promise<Record<string, unknown>> {
  const project = await readEnvConfigSummary(join(root, ".env"));
  const global = await readEnvConfigSummary(GLOBAL_ENV_PATH);
  return {
    project,
    global,
    effectiveSource: project.detected ? "project" : global.detected ? "global" : null,
    runtimeUsesEnv: false,
  };
}

function buildBearerAuthHeaders(apiKey: string): Record<string, string> {
  const trimmed = apiKey.trim();
  if (!trimmed) return {};
  if (!/^[\x20-\x7E]+$/u.test(trimmed)) {
    throw new Error("API Key 只能包含可放进 HTTP Authorization header 的 ASCII 字符。");
  }
  return { Authorization: `Bearer ${trimmed}` };
}

async function fetchModelsFromServiceBaseUrl(
  service: string,
  baseUrl: string,
  apiKey: string,
  proxyUrl?: string,
): Promise<{ models: Array<{ id: string; name: string }>; error?: string; authFailed?: boolean }> {
  const endpoint = isCustomServiceId(service) ? undefined : getAllEndpoints().find((item) => item.id === service);
  const endpointWithModelsBase = endpoint as (typeof endpoint & { modelsBaseUrl?: string });
  const modelsBaseUrl = isCustomServiceId(service)
    ? baseUrl
    : endpointWithModelsBase?.modelsBaseUrl ?? (endpoint ? baseUrl : resolveServiceModelsBaseUrl(service) ?? baseUrl);
  try {
    const response = await fetchWithProxy(`${modelsBaseUrl.replace(/\/$/u, "")}/models`, {
      headers: buildBearerAuthHeaders(apiKey),
      signal: AbortSignal.timeout(4_000),
    }, proxyUrl);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      if (service === "moonshot") {
        return {
          models: [],
          error: [
            `Moonshot/Kimi 认证失败（HTTP ${response.status}）。`,
            "请使用 Moonshot 开放平台生成的 API Key，不要使用 kimi.com 网页登录 token、Cookie 或会员兑换码。",
            "https://platform.moonshot.cn/console/api-keys",
            body.trim().slice(0, 500),
          ].filter(Boolean).join("\n"),
          authFailed: response.status === 401 || response.status === 403,
        };
      }
      return {
        models: [],
        error: `Service returned ${response.status}: ${body.slice(0, 200)}`,
        authFailed: response.status === 401 || response.status === 403,
      };
    }
    const json = await response.json() as { data?: Array<{ id: string }> };
    return { models: (json.data ?? []).map((model) => ({ id: model.id, name: model.id })) };
  } catch (error) {
    return { models: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function buildProbePlans(preferredApiFormat?: ApiFormat, preferredStream?: boolean): Array<{ apiFormat: ApiFormat; stream: boolean }> {
  if (preferredApiFormat) {
    return preferredStream
      ? [{ apiFormat: preferredApiFormat, stream: true }, { apiFormat: preferredApiFormat, stream: false }]
      : [{ apiFormat: preferredApiFormat, stream: false }];
  }
  return [{ apiFormat: "chat", stream: false }, { apiFormat: "responses", stream: false }];
}

function buildModelCandidates(...values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const id = value?.trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out (${timeoutMs}ms)`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function formatProbeError(args: {
  service: string;
  label?: string;
  baseUrl: string;
  model?: string;
  apiFormat: ApiFormat;
  stream: boolean;
  error: string;
}): string {
  if (args.service === "google") {
    args.error = args.error
      .split(/\r?\n/u)
      .filter((line) => !/Moonshot|kimi-k2/iu.test(line))
      .join("\n")
      .trim();
  }
  const context = [
    `服务商：${args.label ?? args.service}`,
    `测试模型：${args.model ?? "未确定"}`,
    `协议：${args.apiFormat === "responses" ? "Responses" : "Chat / Completions"}，${args.stream ? "流式" : "非流式"}`,
    `Base URL：${args.baseUrl}`,
  ].join("\n");
  if (args.service === "google") {
    return [
      "Google Gemini 测试连接失败。",
      context,
      "",
      "请优先检查：",
      "1. API Key 是否来自 Google AI Studio 的 Gemini API key。",
      "2. 当前项目是否已启用 Gemini API。",
      `上游返回：${args.error}`,
    ].join("\n");
  }
  return [`${args.label ?? args.service} 测试连接失败。`, context, `上游返回：${args.error}`].join("\n");
}

async function probeServiceCapabilities(args: {
  root: string;
  service: string;
  apiKey: string;
  baseUrl: string;
  preferredApiFormat?: ApiFormat;
  preferredStream?: boolean;
  preferredModel?: string;
  proxyUrl?: string;
}): Promise<{
  ok: boolean;
  models: Array<{ id: string; name: string }>;
  selectedModel?: string;
  apiFormat?: ApiFormat;
  stream?: boolean;
  baseUrl?: string;
  modelsSource?: "api" | "fallback";
  error?: string;
}> {
  const raw = await readFile(join(args.root, "inkos.json"), "utf-8")
    .then((text) => JSON.parse(text) as Record<string, unknown>)
    .catch(() => ({} as Record<string, unknown>));
  const llm = (raw.llm as Record<string, unknown> | undefined) ?? {};
  const baseService = isCustomServiceId(args.service) ? "custom" : args.service;
  const endpoint = getAllEndpoints().find((item) => item.id === baseService);
  const preset = resolveServicePreset(baseService);
  const modelsResponse = await fetchModelsFromServiceBaseUrl(baseService, args.baseUrl, args.apiKey, args.proxyUrl);

  if (modelsResponse.authFailed) {
    return { ok: false, models: [], error: modelsResponse.error ?? "Service authentication failed" };
  }

  const discoveredModels = modelsResponse.models.filter((model) => isTextChatModelId(model.id));
  if (modelsResponse.models.length > 0) {
    const selectedModel = discoveredModels[0]?.id;
    if (!selectedModel) return { ok: false, models: [], error: "No text chat models were found." };
    return {
      ok: true,
      models: discoveredModels,
      selectedModel,
      apiFormat: args.preferredApiFormat ?? "chat",
      stream: args.preferredStream ?? false,
      baseUrl: args.baseUrl,
      modelsSource: "api",
    };
  }

  if (endpoint?.group === "aggregator") {
    const models = fallbackTextModelsForEndpoint(endpoint, preset);
    const selectedModel = endpoint.checkModel && models.some((model) => model.id === endpoint.checkModel)
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

  const useEndpointCheckModel = baseService !== "ollama" && !isCustomServiceId(args.service) && Boolean(endpoint?.checkModel);
  const configService = typeof llm.service === "string" ? llm.service : undefined;
  const configModel = !useEndpointCheckModel && (configService === args.service || isCustomServiceId(args.service))
    ? typeof llm.defaultModel === "string"
      ? llm.defaultModel
      : typeof llm.model === "string"
        ? llm.model
        : undefined
    : undefined;
  const serviceFirstModel = endpoint?.checkModel ?? preset?.knownModels?.[0] ?? endpoint?.models.find((model) => model.enabled !== false)?.id;
  const preferredModel = useEndpointCheckModel ? serviceFirstModel : args.preferredModel ?? serviceFirstModel;
  const modelCandidates = buildModelCandidates(preferredModel, configModel);
  if (modelCandidates.length === 0) {
    return { ok: false, models: [], error: "无法自动确定模型，请先填写可用模型或提供支持 /models 的服务端点。" };
  }

  let lastError = modelsResponse.error ?? "Connection test failed";
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
        await withTimeout(chatCompletion(client, model, [{ role: "user", content: "Reply with OK only." }], { maxTokens: 16 }), 8_000, "service connection test");
        const models = fallbackTextModelsForEndpoint(endpoint, preset);
        return {
          ok: true,
          models: models.length > 0 ? models : [{ id: model, name: model }],
          selectedModel: model,
          apiFormat: plan.apiFormat,
          stream: plan.stream,
          baseUrl: args.baseUrl,
          modelsSource: "fallback",
        };
      } catch (error) {
        lastError = formatProbeError({
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

  return { ok: false, models: [], error: lastError };
}

async function resolveConfiguredServiceBaseUrl(ctx: ServerContext, service: string, inlineBaseUrl?: string): Promise<string | undefined> {
  if (inlineBaseUrl?.trim()) return inlineBaseUrl.trim();
  return ctx.resolveConfiguredServiceBaseUrl(ctx.root, service) ?? resolveServicePreset(service)?.baseUrl ?? resolveServiceModelsBaseUrl(service);
}

export function registerServicesRoutes(ctx: ServerContext): void {
  ctx.app.get("/api/v1/services", async (c) => {
    const secrets = await loadSecrets(ctx.root);
    const endpoints = getAllEndpoints().filter((endpoint) => endpoint.id !== "custom");
    const services = endpoints.map((endpoint) => ({
      service: endpoint.id,
      label: endpoint.label,
      group: endpoint.group,
      connected: Boolean(secrets.services[endpoint.id]?.apiKey),
    })).sort(compareServiceListItems);

    const config = await ctx.loadRawConfig(ctx.root).catch(() => ({} as Record<string, unknown>));
    for (const service of normalizeServiceConfig((config.llm as Record<string, unknown> | undefined)?.services)) {
      if (service.service !== "custom") continue;
      const id = serviceConfigKey(service);
      services.push({
        service: id,
        label: String(service.name ?? "Custom"),
        group: undefined,
        connected: Boolean(secrets.services[id]?.apiKey),
      });
    }
    return c.json({ services });
  });

  ctx.app.get("/api/v1/services/config", async (c) => {
    const config = await ctx.loadRawConfig(ctx.root);
    const llm = (config.llm as Record<string, unknown> | undefined) ?? {};
    return c.json({
      services: normalizeServiceConfig(llm.services),
      service: typeof llm.service === "string" ? llm.service : null,
      defaultModel: llm.defaultModel ?? null,
      configSource: "studio",
      storedConfigSource: normalizeConfigSource(llm.configSource),
      envConfig: await readEnvConfigStatus(ctx.root),
    });
  });

  ctx.app.put("/api/v1/services/config", async (c) => {
    const body = await c.req.json<{ services?: unknown; defaultModel?: string; configSource?: string; service?: string }>();
    if (body.configSource === "env") {
      return c.json({ error: "Studio 运行时不支持切换到 env 配置源" }, 400);
    }

    const config = await ctx.loadRawConfig(ctx.root);
    config.llm = config.llm ?? {};
    const llm = config.llm as Record<string, unknown>;
    if (body.services !== undefined) {
      llm.services = mergeServiceConfig(normalizeServiceConfig(llm.services), normalizeServiceConfig(body.services));
    }
    if (body.defaultModel !== undefined) llm.defaultModel = body.defaultModel;
    if (body.configSource !== undefined) llm.configSource = normalizeConfigSource(body.configSource);
    if (body.service !== undefined) llm.service = body.service;
    syncTopLevelLlmMirror(llm);
    await ctx.saveRawConfig(ctx.root, config);
    return c.json({ ok: true });
  });

  ctx.app.delete("/api/v1/services/:service", async (c) => {
    const service = c.req.param("service");
    const config = await ctx.loadRawConfig(ctx.root);
    config.llm = config.llm ?? {};
    const llm = config.llm as Record<string, unknown>;
    llm.services = normalizeServiceConfig(llm.services).filter((entry) => serviceConfigKey(entry) !== service);
    if (llm.service === service) {
      delete llm.service;
      delete llm.defaultModel;
    }
    await ctx.saveRawConfig(ctx.root, config);

    const secrets = await loadSecrets(ctx.root);
    delete secrets.services[service];
    await saveSecrets(ctx.root, secrets);
    modelListCache.clear();
    return c.json({ ok: true, service });
  });

  ctx.app.post("/api/v1/services/:service/test", async (c) => {
    const service = c.req.param("service");
    const body = await c.req.json<{ apiKey?: string; baseUrl?: string; apiFormat?: ApiFormat; stream?: boolean }>();
    const baseUrl = await resolveConfiguredServiceBaseUrl(ctx, service, body.baseUrl);
    if (!baseUrl) return c.json({ ok: false, error: `Unknown service: ${service}` }, 400);

    const baseService = isCustomServiceId(service) ? "custom" : service;
    const apiKeyOptional = isApiKeyOptionalForEndpoint({
      provider: resolveServiceProviderFamily(baseService) ?? "openai",
      baseUrl,
    });
    let apiKey = body.apiKey?.trim() ?? "";
    if (!apiKey && !apiKeyOptional) {
      const secrets = await loadSecrets(ctx.root);
      apiKey = secrets.services[service]?.apiKey?.trim() ?? "";
    }
    if (!apiKey && !apiKeyOptional) return c.json({ ok: false, error: "API Key 不能为空" }, 400);

    const rawConfig = await ctx.loadRawConfig(ctx.root).catch(() => ({} as Record<string, unknown>));
    const llm = (rawConfig.llm as Record<string, unknown> | undefined) ?? {};
    const probe = await probeServiceCapabilities({
      root: ctx.root,
      service,
      apiKey,
      baseUrl,
      preferredApiFormat: body.apiFormat,
      preferredStream: body.stream,
      preferredModel: typeof llm.defaultModel === "string" ? llm.defaultModel : typeof llm.model === "string" ? llm.model : undefined,
      proxyUrl: typeof llm.proxyUrl === "string" ? llm.proxyUrl : undefined,
    });
    const probeStatus = { ok: probe.ok, models: probe.models.length, ...(probe.ok ? {} : { error: probe.error ?? "Connection failed" }) };
    if (!probe.ok) return c.json({ ok: false, error: probe.error ?? "Connection failed", probe: probeStatus, chat: null }, 400);
    return c.json({
      ok: true,
      modelCount: probe.models.length,
      models: probe.models,
      selectedModel: probe.selectedModel,
      detected: { apiFormat: probe.apiFormat, stream: probe.stream, baseUrl: probe.baseUrl, modelsSource: probe.modelsSource },
      probe: probeStatus,
      chat: null,
    });
  });

  ctx.app.put("/api/v1/services/:service/secret", async (c) => {
    const service = c.req.param("service");
    const { apiKey } = await c.req.json<{ apiKey?: string }>();
    const trimmedKey = apiKey?.trim() ?? "";
    if (trimmedKey && !isHeaderSafeApiKey(trimmedKey)) {
      return c.json({ ok: false, error: "API Key 只能包含可放进 HTTP Authorization header 的非空白 ASCII 字符" }, 400);
    }
    await setServiceApiKey(ctx.root, service, trimmedKey);
    return c.json({ ok: true });
  });

  ctx.app.get("/api/v1/services/:service/secret", async (c) => {
    const service = c.req.param("service");
    const secrets = await loadSecrets(ctx.root);
    const fullKey = secrets.services[service]?.apiKey ?? "";
    const hasApiKey = fullKey.length > 0;
    const keyPreview = hasApiKey
      ? fullKey.length > 8 ? `${fullKey.slice(0, 4)}...${fullKey.slice(-4)}` : `${fullKey.slice(0, 2)}...`
      : "";
    return c.json({ hasApiKey, keyPreview });
  });

  ctx.app.get("/api/v1/services/models", async (c) => {
    const secrets = await loadSecrets(ctx.root);
    const groups = getAllEndpoints()
      .filter((endpoint) => endpoint.id !== "custom" && Boolean(secrets.services[endpoint.id]?.apiKey))
      .map((endpoint) => ({ service: endpoint.id, label: endpoint.label, models: mapEndpointModels(endpoint) }));
    return c.json({ groups });
  });

  ctx.app.get("/api/v1/services/models/custom", async (c) => {
    const secrets = await loadSecrets(ctx.root);
    const config = await ctx.loadRawConfig(ctx.root).catch(() => ({} as Record<string, unknown>));
    const customServices = normalizeServiceConfig((config.llm as Record<string, unknown> | undefined)?.services)
      .filter((service) => service.service === "custom")
      .map((service) => ({
        id: serviceConfigKey(service),
        label: String(service.name ?? "Custom"),
        baseUrl: typeof service.baseUrl === "string" ? service.baseUrl : "",
      }))
      .filter((service) => service.baseUrl && secrets.services[service.id]?.apiKey);

    const groups = await Promise.all(customServices.map(async (service) => ({
      service: service.id,
      label: service.label,
      models: (await probeModelsFromUpstream(service.baseUrl, secrets.services[service.id]?.apiKey ?? "", 10_000))
        .filter((model) => isTextChatModelId(model.id))
        .map((model) => ({
          id: model.id,
          name: model.name ?? model.id,
          ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
        })),
    })));
    return c.json({ groups });
  });

  ctx.app.get("/api/v1/services/:service/models", async (c) => {
    const service = c.req.param("service");
    const refresh = c.req.query("refresh") === "1";
    const secrets = await loadSecrets(ctx.root);
    const apiKey = c.req.query("apiKey") ?? secrets.services[service]?.apiKey ?? "";
    const baseUrl = await resolveConfiguredServiceBaseUrl(ctx, service);
    const baseService = isCustomServiceId(service) ? "custom" : service;
    const apiKeyOptional = isApiKeyOptionalForEndpoint({
      provider: resolveServiceProviderFamily(baseService) ?? "openai",
      baseUrl,
    });
    if (!apiKey && !apiKeyOptional) return c.json({ models: [] });

    const cacheKey = `${service}::${baseUrl ?? ""}::${apiKey.slice(-8)}`;
    if (!refresh) {
      const cached = modelListCache.get(cacheKey);
      if (cached && Date.now() - cached.at < 10 * 60 * 1000) return c.json({ models: cached.models });
    }

    const rawModels = await listModelsForService(baseService, apiKey, isCustomServiceId(service) ? baseUrl : undefined);
    const models = filterTextChatModels(rawModels);
    modelListCache.set(cacheKey, { models, at: Date.now() });
    return c.json({ models });
  });
}
