import {
  getAllEndpoints, loadSecrets, saveSecrets, setServiceApiKey,
  isApiKeyOptionalForEndpoint, resolveServiceProviderFamily,
  resolveServiceModelsBaseUrl, resolveServiceModel,
  listModelsForService, probeModelsFromUpstream,
  isTextChatModelId, type ResolvedModel,
} from "@actalk/inkos-core";
import type { ServerContext } from "../server-context.js";

// Reused from server.ts — model list cache & helpers
const modelListCache = new Map<string, { models: Array<{ id: string; name: string; maxOutput?: number; contextWindow?: number }>; at: number }>();

function isCustomServiceId(service: string): boolean { return service.startsWith("custom:"); }
function serviceConfigKey(entry: Record<string, unknown>): string {
  return entry.service === "custom" ? `custom:${entry.name ?? "Custom"}` : String(entry.service ?? "");
}
function isHeaderSafeApiKey(key: string): boolean { return /^[\x20-\x7E]+$/.test(key); }

function filterTextChatModels(models: Array<{ id: string; name?: string; maxOutput?: number; contextWindow?: number }>): Array<{ id: string; name: string; maxOutput?: number; contextWindow?: number }> {
  return models
    .filter((m) => isTextChatModelId(m.id))
    .map((m) => ({
      id: m.id, name: m.name ?? m.id,
      ...(m.maxOutput !== undefined ? { maxOutput: m.maxOutput } : {}),
      ...(m.contextWindow !== undefined && m.contextWindow > 0 ? { contextWindow: m.contextWindow } : {}),
    }));
}

type LLMConfigSource = "studio" | "env";
function normalizeConfigSource(v: unknown): LLMConfigSource { return v === "env" ? "env" : "studio"; }
function normalizeServiceConfig(v: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null);
}
function mergeServiceConfig(existing: Array<Record<string, unknown>>, incoming: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const s of existing) map.set(serviceConfigKey(s), s);
  for (const s of incoming) map.set(serviceConfigKey(s), s);
  return [...map.values()];
}
function syncTopLevelLlmMirror(llm: Record<string, unknown>): void {
  const services = normalizeServiceConfig(llm.services);
  const first = services[0];
  if (first) {
    if (first.service !== "custom" && !llm.service) llm.service = first.service;
  }
}
function compareServiceListItems(a: { service: string }, b: { service: string }): number {
  return a.service.localeCompare(b.service);
}

async function probeServiceCapabilities(opts: {
  root: string; service: string; apiKey: string; baseUrl: string;
  preferredApiFormat?: string; preferredStream?: boolean; proxyUrl?: string;
}): Promise<{ ok: boolean; models: Array<{ id: string }>; selectedModel?: string; apiFormat?: string; stream?: boolean; baseUrl?: string; modelsSource?: string; error?: string }> {
  // Simplified probe — delegates to listModelsForService
  try {
    const models = await listModelsForService(
      isCustomServiceId(opts.service) ? "custom" : opts.service,
      opts.apiKey,
      isCustomServiceId(opts.service) ? opts.baseUrl : undefined,
    );
    return { ok: true, models: models.map(m => ({ id: m.id })), modelsSource: "api", baseUrl: opts.baseUrl };
  } catch (e) {
    return { ok: false, models: [], error: e instanceof Error ? e.message : String(e) };
  }
}

async function readEnvConfigStatus(root: string): Promise<Record<string, unknown>> {
  const { access } = await import("node:fs/promises");
  const { join } = await import("node:path");
  try { await access(join(root, ".env")); return { detected: true }; } catch { return { detected: false }; }
}

async function resolveConfiguredServiceBaseUrl(root: string, serviceId: string, inlineBaseUrl?: string): Promise<string | undefined> {
  if (inlineBaseUrl) return inlineBaseUrl;
  if (isCustomServiceId(serviceId)) return undefined;
  return resolveServiceModelsBaseUrl(serviceId);
}

/**
 * Service configuration and model discovery routes.
 */
export function registerServicesRoutes(ctx: ServerContext): void {
  ctx.app.get("/api/v1/services", async (c) => {
    const secrets = await loadSecrets(ctx.root);
    const endpoints = getAllEndpoints().filter((ep) => ep.id !== "custom");

    const services = endpoints.map((ep) => ({
      service: ep.id, label: ep.label, group: ep.group,
      connected: Boolean(secrets.services[ep.id]?.apiKey),
    })).sort(compareServiceListItems);

    try {
      const config = await ctx.loadRawConfig(ctx.root);
      for (const svc of normalizeServiceConfig((config.llm as Record<string, unknown> | undefined)?.services)) {
        if (svc.service === "custom") {
          const secretKey = `custom:${svc.name}`;
          services.push({
            service: secretKey, label: svc.name ?? "Custom", group: undefined,
            connected: Boolean(secrets.services[secretKey]?.apiKey),
          });
        }
      }
    } catch { /* no config */ }

    return c.json({ services });
  });

  ctx.app.get("/api/v1/services/config", async (c) => {
    const config = await ctx.loadRawConfig(ctx.root);
    const llm = (config.llm as Record<string, unknown> | undefined) ?? {};
    const services = normalizeServiceConfig(llm.services);
    const envConfig = await readEnvConfigStatus(ctx.root);
    return c.json({
      services,
      service: typeof llm.service === "string" ? llm.service : null,
      defaultModel: llm.defaultModel ?? null,
      configSource: "studio" satisfies LLMConfigSource,
      storedConfigSource: normalizeConfigSource(llm.configSource),
      envConfig,
    });
  });

  ctx.app.put("/api/v1/services/config", async (c) => {
    const body = await c.req.json<{ services?: unknown; defaultModel?: string; configSource?: LLMConfigSource; service?: string }>();
    const config = await ctx.loadRawConfig(ctx.root);
    config.llm = config.llm ?? {};
    const llm = config.llm as Record<string, unknown>;
    if (body.services !== undefined) {
      const existing = normalizeServiceConfig(llm.services);
      const incoming = normalizeServiceConfig(body.services);
      llm.services = mergeServiceConfig(existing, incoming);
    }
    if (body.defaultModel !== undefined) llm.defaultModel = body.defaultModel;
    if (body.configSource === "env") {
      return c.json({ error: "Studio 运行时不支持切换到 env；env 只在 CLI/daemon/部署运行时作为覆盖层使用。" }, 400);
    }
    if (body.configSource !== undefined) llm.configSource = normalizeConfigSource(body.configSource);
    if (body.service !== undefined) llm.service = body.service;
    syncTopLevelLlmMirror(llm);
    await ctx.saveRawConfig(ctx.root, config);
    return c.json({ ok: true });
  });

  ctx.app.delete("/api/v1/services/:service", async (c) => {
    const service = c.req.param("service");
    const config = await ctx.loadRawConfig(ctx.root);
    const llm = (config.llm as Record<string, unknown> | undefined) ?? {};
    const existingServices = normalizeServiceConfig(llm.services);
    const nextServices = existingServices.filter((entry) => serviceConfigKey(entry) !== service);

    if (!config.llm) config.llm = {};
    const nextLlm = config.llm as Record<string, unknown>;
    nextLlm.services = nextServices;
    if (nextLlm.service === service) { delete nextLlm.service; delete nextLlm.defaultModel; }
    await ctx.saveRawConfig(ctx.root, config);

    const secrets = await loadSecrets(ctx.root);
    delete secrets.services[service];
    await saveSecrets(ctx.root, secrets);
    modelListCache.clear();
    return c.json({ ok: true, service });
  });

  ctx.app.post("/api/v1/services/:service/test", async (c) => {
    const service = c.req.param("service");
    const { apiKey, baseUrl, apiFormat, stream } = await c.req.json<{ apiKey: string; baseUrl?: string; apiFormat?: "chat" | "responses"; stream?: boolean }>();

    const resolvedBaseUrl = await resolveConfiguredServiceBaseUrl(ctx.root, service, baseUrl);
    if (!resolvedBaseUrl) return c.json({ ok: false, error: `未知服务商: ${service}` }, 400);

    const baseService = isCustomServiceId(service) ? "custom" : service;
    const apiKeyOptional = isApiKeyOptionalForEndpoint({
      provider: resolveServiceProviderFamily(baseService) ?? "openai",
      baseUrl: resolvedBaseUrl,
    });
    let resolvedApiKey = apiKey?.trim() ?? "";
    if (!resolvedApiKey && !apiKeyOptional) {
      const secrets = await loadSecrets(ctx.root);
      resolvedApiKey = secrets.services[service]?.apiKey?.trim() ?? "";
    }
    if (!resolvedApiKey && !apiKeyOptional) {
      return c.json({ ok: false, error: "API Key 不能为空" }, 400);
    }

    const rawConfig = await ctx.loadRawConfig(ctx.root).catch(() => ({} as Record<string, unknown>));
    const llmCfg = (rawConfig.llm as Record<string, unknown> | undefined) ?? {};
    const probe = await probeServiceCapabilities({
      root: ctx.root, service, apiKey: resolvedApiKey, baseUrl: resolvedBaseUrl,
      preferredApiFormat: apiFormat, preferredStream: stream,
      proxyUrl: typeof llmCfg.proxyUrl === "string" ? llmCfg.proxyUrl : undefined,
    });

    const probeStatus = { ok: probe.ok, models: probe.models?.length ?? 0, ...(probe.ok ? {} : { error: probe.error ?? "连接失败" }) };
    if (!probe.ok) return c.json({ ok: false, error: probe.error ?? "连接失败", probe: probeStatus, chat: null }, 400);

    return c.json({
      ok: true, modelCount: probe.models.length, models: probe.models, selectedModel: probe.selectedModel,
      detected: { apiFormat: probe.apiFormat, stream: probe.stream, baseUrl: probe.baseUrl, modelsSource: probe.modelsSource },
      probe: probeStatus, chat: null,
    });
  });

  ctx.app.put("/api/v1/services/:service/secret", async (c) => {
    const service = c.req.param("service");
    const { apiKey } = await c.req.json<{ apiKey: string }>();
    const trimmedKey = apiKey?.trim() ?? "";
    if (trimmedKey && !isHeaderSafeApiKey(trimmedKey)) {
      return c.json({ ok: false, error: "API Key 只能包含可放进 HTTP Authorization header 的非空白 ASCII 字符；请不要粘贴连接失败提示或诊断文本。" }, 400);
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
      ? fullKey.length > 8 ? fullKey.slice(0, 4) + "..." + fullKey.slice(-4) : fullKey.slice(0, 2) + "..."
      : "";
    return c.json({ hasApiKey, keyPreview });
  });

  ctx.app.get("/api/v1/services/models", async (c) => {
    const secrets = await loadSecrets(ctx.root);
    const endpoints = getAllEndpoints().filter((ep) => ep.id !== "custom" && Boolean(secrets.services[ep.id]?.apiKey));
    const groups = endpoints.map((ep) => ({
      service: ep.id, label: ep.label,
      models: ep.models.filter((m) => m.enabled !== false).filter((m) => isTextChatModelId(m.id)).map((m) => ({
        id: m.id, name: m.id,
        ...(typeof m.maxOutput === "number" ? { maxOutput: m.maxOutput } : {}),
        ...(m.contextWindowTokens > 0 ? { contextWindow: m.contextWindowTokens } : {}),
      })),
    }));
    return c.json({ groups });
  });

  ctx.app.get("/api/v1/services/models/custom", async (c) => {
    const secrets = await loadSecrets(ctx.root);
    let config: Record<string, unknown> = {};
    try { config = await ctx.loadRawConfig(ctx.root); } catch { /* no config */ }

    const customs = normalizeServiceConfig((config.llm as Record<string, unknown> | undefined)?.services)
      .filter((s) => s.service === "custom")
      .map((s) => ({ id: `custom:${s.name ?? "Custom"}`, baseUrl: s.baseUrl ?? "", label: s.name ?? "Custom" }))
      .filter((s) => s.baseUrl && Boolean(secrets.services[s.id]?.apiKey));

    const groups = await Promise.all(customs.map(async (s) => ({
      service: s.id, label: s.label,
      models: filterTextChatModels(await probeModelsFromUpstream(s.baseUrl, secrets.services[s.id].apiKey, 10_000)),
    })));
    return c.json({ groups });
  });

  ctx.app.get("/api/v1/services/:service/models", async (c) => {
    const service = c.req.param("service");
    const refresh = c.req.query("refresh") === "1";
    const secrets = await loadSecrets(ctx.root);
    const apiKey = c.req.query("apiKey") || secrets.services[service]?.apiKey || "";

    const resolvedBaseUrl = await resolveConfiguredServiceBaseUrl(ctx.root, service);
    const baseService = isCustomServiceId(service) ? "custom" : service;
    const apiKeyOptional = isApiKeyOptionalForEndpoint({
      provider: resolveServiceProviderFamily(baseService) ?? "openai",
      baseUrl: resolvedBaseUrl,
    });
    if (!apiKey && !apiKeyOptional) return c.json({ models: [] });

    const cacheKey = `${service}::${resolvedBaseUrl ?? ""}::${apiKey.slice(-8)}`;
    if (!refresh) {
      const cached = modelListCache.get(cacheKey);
      if (cached && Date.now() - cached.at < 10 * 60 * 1000) return c.json({ models: cached.models });
    }

    const enriched = await listModelsForService(
      isCustomServiceId(service) ? "custom" : service, apiKey,
      isCustomServiceId(service) ? resolvedBaseUrl ?? undefined : undefined,
    );
    const models = filterTextChatModels(enriched);
    modelListCache.set(cacheKey, { models, at: Date.now() });
    return c.json({ models });
  });
}
