import {
  COVER_PROVIDER_PRESETS,
  coverSecretKey,
  resolveCoverProviderPreset,
  loadSecrets,
  setServiceApiKey,
} from "@actalk/inkos-core";
import type { ServerContext } from "../server-context.js";

function normalizeCoverConfig(cover: unknown): { service?: string; model?: string } | null {
  if (typeof cover !== "object" || cover === null) return null;
  const c = cover as Record<string, unknown>;
  const service = typeof c.service === "string" ? c.service : undefined;
  const model = typeof c.model === "string" ? c.model : undefined;
  return service || model ? { service, model } : null;
}

/** Simple header-safe API key check — basic printable ASCII without control chars. */
function isHeaderSafeApiKey(key: string): boolean {
  return /^[\x20-\x7E]+$/.test(key);
}

/**
 * Cover generation config routes.
 */
export function registerCoverRoutes(ctx: ServerContext): void {
  ctx.app.get("/api/v1/cover/config", async (c) => {
    const config = await ctx.loadRawConfig(ctx.root);
    const llm = (config.llm as Record<string, unknown> | undefined) ?? {};
    const cover = normalizeCoverConfig(llm.cover);
    const secrets = await loadSecrets(ctx.root);
    return c.json({
      service: cover?.service ?? null,
      model: cover?.model ?? null,
      providers: COVER_PROVIDER_PRESETS.map((provider) => ({
        service: provider.service,
        label: provider.label,
        baseUrl: provider.baseUrl,
        defaultModel: provider.defaultModel,
        models: provider.models,
        connected: Boolean(
          secrets.services[coverSecretKey(provider.service)]?.apiKey ||
          secrets.services[provider.service]?.apiKey,
        ),
      })),
    });
  });

  ctx.app.put("/api/v1/cover/config", async (c) => {
    const body = await c.req.json<{ service?: string; model?: string }>();
    const preset = resolveCoverProviderPreset(body.service);
    if (!preset) {
      return c.json({ error: "Unsupported cover service" }, 400);
    }
    const model =
      typeof body.model === "string" && preset.models.includes(body.model)
        ? body.model
        : preset.defaultModel;

    const config = await ctx.loadRawConfig(ctx.root);
    config.llm = config.llm ?? {};
    const llm = config.llm as Record<string, unknown>;
    llm.cover = { service: preset.service, model };
    await ctx.saveRawConfig(ctx.root, config);
    return c.json({ ok: true, service: preset.service, model });
  });

  ctx.app.get("/api/v1/cover/secret/:service", async (c) => {
    const service = c.req.param("service");
    if (!resolveCoverProviderPreset(service)) {
      return c.json({ error: "Unsupported cover service" }, 400);
    }
    const secrets = await loadSecrets(ctx.root);
    const fullKey = secrets.services[coverSecretKey(service)]?.apiKey ?? "";
    const hasApiKey = fullKey.length > 0;
    const keyPreview = hasApiKey
      ? fullKey.length > 8
        ? fullKey.slice(0, 4) + "..." + fullKey.slice(-4)
        : fullKey.slice(0, 2) + "..."
      : "";
    return c.json({ hasApiKey, keyPreview });
  });

  ctx.app.put("/api/v1/cover/secret/:service", async (c) => {
    const service = c.req.param("service");
    if (!resolveCoverProviderPreset(service)) {
      return c.json({ error: "Unsupported cover service" }, 400);
    }
    const body = await c.req.json<{ apiKey?: string; clear?: boolean }>();
    const trimmedKey = body.apiKey?.trim() ?? "";
    if (body.clear === true) {
      await setServiceApiKey(ctx.root, coverSecretKey(service), "");
      return c.json({ ok: true, service, cleared: true });
    }
    if (!trimmedKey) {
      return c.json({ ok: true, service, preserved: true });
    }
    if (!isHeaderSafeApiKey(trimmedKey)) {
      return c.json(
        { error: "API Key 包含不能放入 HTTP Authorization header 的字符，请只粘贴原始密钥。" },
        400,
      );
    }
    await setServiceApiKey(ctx.root, coverSecretKey(service), trimmedKey);
    return c.json({ ok: true, service });
  });
}
