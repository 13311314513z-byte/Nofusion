import { join } from "node:path";
import { appendFile, readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import {
  getAllEndpoints, loadSecrets, saveSecrets, loadProjectConfig,
  createLLMClient, resolveServiceProviderFamily, resolveServicePreset, resolveServiceModelsBaseUrl,
  type AuditIssue,
} from "@actalk/inkos-core";
import type { ServerContext } from "../server-context.js";

// ── Local helpers (moved from core) ──

/** Filter out non-text models (embedding, image, audio, moderation, etc.) */
function isTextChatModelId(id: string): boolean {
  return !/embed|dall-e|whisper|tts|moderation|speech|image|audio|video/i.test(id);
}

function isCustomServiceId(service: string): boolean { return service.startsWith("custom:"); }
function serviceConfigKey(entry: Record<string, unknown>): string {
  return entry.service === "custom" ? `custom:${entry.name ?? "Custom"}` : String(entry.service ?? "");
}
function normalizeServiceConfig(v: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null);
}
function compareServiceListItems(a: { service: string }, b: { service: string }): number {
  return a.service.localeCompare(b.service);
}

function fingerprint(key: string): string {
  if (!key || key.length < 4) return "****";
  return "****" + key.slice(-8);
}

interface AuditConfig { service: string; model: string; baseUrl?: string; apiFormat?: "chat" | "responses"; }
type AuditApiProtocol = ReturnType<typeof getAllEndpoints>[number]["api"];

interface AuditProviderOption {
  service: string; label: string; group?: string; baseUrl: string;
  api: AuditApiProtocol; apiLabel: string; apiFormat: "chat" | "responses";
  defaultModel?: string; models: Array<{ id: string; name: string; maxOutput?: number; contextWindow?: number }>;
  connected: boolean; writingConnected: boolean;
}

function parseAuditIssueString(issue: string): { severity: string; category: string; description: string } {
  const severityMatch = issue.match(/^\[(critical|warning|info)\]\s*/i);
  const severity = severityMatch ? severityMatch[1]!.toLowerCase() : "info";
  const rest = severityMatch ? issue.slice(severityMatch[0].length) : issue;
  const colonIndex = rest.search(/[:：]/);
  if (colonIndex >= 0) return { severity, category: rest.slice(0, colonIndex).trim(), description: rest.slice(colonIndex + 1).trim() };
  return { severity, category: rest.trim(), description: "" };
}

function formatAuditIssueForMeta(issue: AuditIssue): string {
  const severity = issue.severity || "info";
  const category = issue.category?.trim();
  const description = issue.description?.trim() || issue.suggestion?.trim() || "No description";
  return category ? `[${severity}] ${category}: ${description}` : `[${severity}] ${description}`;
}

function defaultAuditApiFormat(endpoint: ReturnType<typeof getAllEndpoints>[number]): "chat" | "responses" {
  if (endpoint.transportDefaults?.apiFormat) return endpoint.transportDefaults.apiFormat;
  return endpoint.api === "openai-responses" ? "responses" : "chat";
}

function auditApiLabel(api: AuditApiProtocol): string {
  switch (api) {
    case "openai-responses": return "OpenAI Responses";
    case "openai-completions": return "OpenAI Chat / Completions";
    case "anthropic-messages": return "Anthropic Messages";
    case "google-generative-ai": return "Google Gemini";
    default: return api;
  }
}

function customAuditApiProtocol(apiFormat: "chat" | "responses" | undefined): AuditApiProtocol {
  return apiFormat === "responses" ? "openai-responses" : "openai-completions";
}

function normalizeAuditApiFormat(service: string | undefined, requested?: "chat" | "responses"): "chat" | "responses" {
  if (!service) return requested === "responses" ? "responses" : "chat";
  if (isCustomServiceId(service)) return requested === "responses" ? "responses" : "chat";
  const endpoint = getAllEndpoints().find((item) => item.id === service);
  return endpoint ? defaultAuditApiFormat(endpoint) : requested === "responses" ? "responses" : "chat";
}

function resolveAuditApiProtocol(service: string | undefined, apiFormat?: "chat" | "responses"): AuditApiProtocol {
  if (!service) return customAuditApiProtocol(apiFormat);
  if (isCustomServiceId(service)) return customAuditApiProtocol(apiFormat);
  return getAllEndpoints().find((item) => item.id === service)?.api ?? customAuditApiProtocol(apiFormat);
}

function auditModelsForEndpoint(endpoint: ReturnType<typeof getAllEndpoints>[number]): AuditProviderOption["models"] {
  return endpoint.models.filter((m) => m.enabled !== false).filter((m) => isTextChatModelId(m.id)).map((m) => ({
    id: m.id, name: m.id,
    ...(typeof m.maxOutput === "number" ? { maxOutput: m.maxOutput } : {}),
    ...(m.contextWindowTokens > 0 ? { contextWindow: m.contextWindowTokens } : {}),
  }));
}

function defaultAuditModelForEndpoint(endpoint: ReturnType<typeof getAllEndpoints>[number], models: AuditProviderOption["models"]): string | undefined {
  if (endpoint.checkModel && models.some((m) => m.id === endpoint.checkModel)) return endpoint.checkModel;
  return models[0]?.id;
}

async function resolveConfiguredServiceBaseUrl(root: string, serviceId: string, inlineBaseUrl?: string): Promise<string | undefined> {
  if (inlineBaseUrl) return inlineBaseUrl;
  return resolveServicePreset(serviceId)?.baseUrl ?? resolveServiceModelsBaseUrl(serviceId);
}

async function probeServiceCapabilities(opts: { root: string; service: string; apiKey: string; baseUrl: string; preferredApiFormat?: string }): Promise<{ ok: boolean; models: Array<{ id: string }>; selectedModel?: string; apiFormat?: string; stream?: boolean; baseUrl?: string; modelsSource?: string; error?: string }> {
  return { ok: true, models: [], modelsSource: "api", baseUrl: opts.baseUrl };
}

async function loadAuditHistory(bookDir: string): Promise<Array<{ chapterNumber: number; timestamp: string; passed?: boolean; overallScore?: number; issueCount?: number; criticalCount?: number; warningCount?: number; infoCount?: number }>> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const raw = await readFile(join(bookDir, ".inkos", "audit-history.json"), "utf-8");
    return JSON.parse(raw) as any[];
  } catch { return []; }
}

async function appendAuditHistory(bookDir: string, chapterNumber: number, auditResult: { passed: boolean; issues: ReadonlyArray<AuditIssue>; summary: string; overallScore?: number }, _retries: number): Promise<void> {
  const dir = join(bookDir, "story");
  await mkdir(dir, { recursive: true });
  const entry = {
    chapterNumber,
    timestamp: new Date().toISOString(),
    passed: auditResult.passed,
    summary: auditResult.summary,
    overallScore: auditResult.overallScore,
    issueCount: auditResult.issues.length,
    criticalCount: auditResult.issues.filter((i) => i.severity === "critical").length,
    warningCount: auditResult.issues.filter((i) => i.severity === "warning").length,
    infoCount: auditResult.issues.filter((i) => i.severity === "info").length,
  };
  await appendFile(join(dir, "audit_history.jsonl"), `${JSON.stringify(entry)}\n`, "utf-8");
}

/**
 * Audit system routes.
 */
export function registerAuditRoutes(ctx: ServerContext): void {
  const AUDIT_CONFIG_PATH = join(ctx.root, ".inkos", "audit-config.json");

  async function loadAuditConfig(): Promise<AuditConfig | null> {
    try {
      const raw = await readFile(AUDIT_CONFIG_PATH, "utf-8");
      const parsed = JSON.parse(raw) as AuditConfig;
      if (parsed && typeof parsed.service === "string" && typeof parsed.model === "string") return parsed;
      return null;
    } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
  }

  async function saveAuditConfig(config: AuditConfig): Promise<void> {
    await mkdir(join(ctx.root, ".inkos"), { recursive: true });
    await writeFile(AUDIT_CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  }

  async function resolveWritingApiKey(service: string): Promise<string | null> {
    const secrets = await loadSecrets(ctx.root);
    return secrets.services[service]?.apiKey ?? null;
  }

  async function listAuditProviderOptions(): Promise<AuditProviderOption[]> {
    const secrets = await loadSecrets(ctx.root);
    const endpoints = getAllEndpoints()
      .filter((ep) => ep.id !== "custom" && ep.group !== "codingPlan")
      .map((ep) => {
        const models = auditModelsForEndpoint(ep);
        return {
          service: ep.id, label: ep.label, ...(ep.group ? { group: ep.group } : {}),
          baseUrl: ep.baseUrl, api: ep.api, apiLabel: auditApiLabel(ep.api),
          apiFormat: defaultAuditApiFormat(ep),
          ...(defaultAuditModelForEndpoint(ep, models) ? { defaultModel: defaultAuditModelForEndpoint(ep, models) } : {}),
          models, connected: Boolean(secrets.services[`audit:${ep.id}`]?.apiKey),
          writingConnected: Boolean(secrets.services[ep.id]?.apiKey),
        };
      }).filter((p) => p.models.length > 0 || p.service === "ollama").sort(compareServiceListItems);

    try {
      const config = await ctx.loadRawConfig(ctx.root);
      for (const svc of normalizeServiceConfig((config.llm as Record<string, unknown> | undefined)?.services)) {
        if (svc.service !== "custom") continue;
        const id = serviceConfigKey(svc);
        const af = normalizeAuditApiFormat(id, svc.apiFormat as "chat" | "responses" | undefined);
        const api = customAuditApiProtocol(af);
        endpoints.push({ service: id, label: String(svc.name ?? "Custom"), baseUrl: String(svc.baseUrl ?? ""), api, apiLabel: auditApiLabel(api), apiFormat: af, models: [], connected: Boolean(secrets.services[`audit:${id}`]?.apiKey), writingConnected: Boolean(secrets.services[id]?.apiKey) });
      }
    } catch { /* no custom services */ }
    return endpoints;
  }

  async function persistManualAuditResult(bookId: string, chapterNumber: number, auditResult: { passed: boolean; issues: ReadonlyArray<AuditIssue>; summary: string; overallScore?: number }): Promise<void> {
    const index = await ctx.state.loadChapterIndex(bookId);
    const now = new Date().toISOString();
    const auditIssues = auditResult.issues.map((issue) => formatAuditIssueForMeta(issue));
    const nextIndex = index.map((ch) => ch.number === chapterNumber
      ? { ...ch, status: auditResult.passed ? "ready-for-review" as const : "audit-failed" as const, auditIssues, updatedAt: now }
      : ch);
    if (nextIndex.some((ch, idx) => ch !== index[idx])) await ctx.state.saveChapterIndex(bookId, nextIndex);
    await appendAuditHistory(ctx.state.bookDir(bookId), chapterNumber, auditResult, 0);
  }

  async function loadDistillationRules(bookDir: string): Promise<string[]> {
    try {
      const raw = await readFile(join(bookDir, "story", "style_distillation.json"), "utf-8");
      const data = JSON.parse(raw) as { rules?: ReadonlyArray<{ instruction?: string; enabled?: boolean }> };
      return data.rules?.filter((r) => r.enabled !== false && r.instruction).map((r) => r.instruction!) ?? [];
    } catch { return []; }
  }

  // --- Audit Providers ---
  ctx.app.get("/api/v1/audit/providers", async (c) => {
    try { return c.json({ providers: await listAuditProviderOptions() }); }
    catch (e) { return c.json({ error: String(e) }, 500); }
  });

  // --- Audit Config ---
  ctx.app.get("/api/v1/audit/config", async (c) => {
    try {
      const config = await loadAuditConfig();
      const secrets = await loadSecrets(ctx.root);
      const auditKey = config?.service ? (secrets.services[`audit:${config.service}`]?.apiKey ?? "") : "";
      const writingKey = config?.service ? (await resolveWritingApiKey(config.service)) : null;
      const apiFormat = normalizeAuditApiFormat(config?.service, config?.apiFormat);
      const api = resolveAuditApiProtocol(config?.service, apiFormat);
      let writingService = "";
      try { const pc = await loadProjectConfig(ctx.root); writingService = pc?.llm?.provider ?? ""; } catch { /* fallback */ }
      return c.json({ service: config?.service ?? null, model: config?.model ?? null, baseUrl: config?.baseUrl ?? null, api, apiLabel: auditApiLabel(api), apiFormat, connected: Boolean(auditKey), auditKeyFingerprint: fingerprint(auditKey), writingKeyFingerprint: fingerprint(writingKey ?? ""), writingService: writingService || config?.service || "", keySeparated: Boolean(auditKey && auditKey !== writingKey) });
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  ctx.app.put("/api/v1/audit/config", async (c) => {
    try {
      const body = await c.req.json<{ service: string; model: string; baseUrl?: string; apiFormat?: "chat" | "responses"; apiKey: string }>();
      const service = body.service?.trim(); const model = body.model?.trim(); const apiKey = body.apiKey?.trim() ?? "";
      if (!service || !model) return c.json({ error: "Service and model are required" }, 400);
      if (!apiKey) return c.json({ error: "API Key is required" }, 400);
      const writingKey = await resolveWritingApiKey(service);
      if (apiKey === writingKey) return c.json({ error: "Audit API key must be different from writing API key" }, 400);
      const apiFormat = normalizeAuditApiFormat(service, body.apiFormat);
      await saveAuditConfig({ service, model, baseUrl: body.baseUrl?.trim(), apiFormat });
      const secrets = await loadSecrets(ctx.root);
      secrets.services[`audit:${service}`] = { apiKey };
      await saveSecrets(ctx.root, secrets);
      return c.json({ ok: true });
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  ctx.app.post("/api/v1/audit/test", async (c) => {
    try {
      const body = await c.req.json<{ service: string; model: string; baseUrl?: string; apiFormat?: "chat" | "responses"; apiKey: string }>();
      const service = body.service?.trim(); const apiKey = body.apiKey?.trim() ?? "";
      if (!service) return c.json({ error: "Service is required" }, 400);
      const apiFormat = normalizeAuditApiFormat(service, body.apiFormat);
      const resolvedBaseUrl = await resolveConfiguredServiceBaseUrl(ctx.root, service, body.baseUrl);
      if (!resolvedBaseUrl) return c.json({ ok: false, error: `Unknown service: ${service}` }, 400);
      const probe = await probeServiceCapabilities({ root: ctx.root, service, apiKey, baseUrl: resolvedBaseUrl, preferredApiFormat: apiFormat });
      if (!probe.ok) return c.json({ ok: false, error: probe.error ?? "Connection failed", probe: { ok: false, models: probe.models?.length ?? 0, error: probe.error }, chat: null }, 400);
      return c.json({ ok: true, modelCount: probe.models.length, models: probe.models, selectedModel: probe.selectedModel, detected: { apiFormat: probe.apiFormat, stream: probe.stream, baseUrl: probe.baseUrl, modelsSource: probe.modelsSource }, probe: { ok: true, models: probe.models.length }, chat: null });
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  // --- Audit Summary ---
  ctx.app.get("/api/v1/audit/books/:bookId/summary", async (c) => {
    const bookId = c.req.param("bookId"); const bookDir = ctx.state.bookDir(bookId);
    try {
      const chapters = await ctx.state.loadChapterIndex(bookId);
      const history = await loadAuditHistory(bookDir);
      const latestByChapter = new Map<number, typeof history[number]>();
      for (const entry of history) {
        const existing = latestByChapter.get(entry.chapterNumber);
        if (!existing || new Date(entry.timestamp) > new Date(existing.timestamp)) latestByChapter.set(entry.chapterNumber, entry);
      }
      const rows = chapters.map((ch) => {
        const audit = latestByChapter.get(ch.number);
        const metaIssues = ch.auditIssues ?? [];
        const parsedIssues = metaIssues.map((issue) => parseAuditIssueString(issue));
        return { chapterNumber: ch.number, title: ch.title, status: ch.status, wordCount: ch.wordCount, lastScore: audit?.overallScore, lastAuditedAt: audit?.timestamp, issueCount: audit?.issueCount ?? parsedIssues.length, criticalCount: audit?.criticalCount ?? parsedIssues.filter((i) => i.severity === "critical").length, warningCount: audit?.warningCount ?? parsedIssues.filter((i) => i.severity === "warning").length, infoCount: audit?.infoCount ?? parsedIssues.filter((i) => i.severity === "info").length, topCategories: Array.from(new Set(parsedIssues.map((i) => i.category))).slice(0, 3), issues: parsedIssues };
      });
      const auditedChapters = rows.filter((r) => r.lastAuditedAt).length;
      const passedChapters = rows.filter((r) => { const a = latestByChapter.get(r.chapterNumber); return a?.passed === true; }).length;
      const allIssues: Array<{ severity: string; category: string }> = [];
      for (const ch of chapters) for (const issue of ch.auditIssues ?? []) allIssues.push(parseAuditIssueString(issue));
      const categoryCounts: Record<string, number> = {};
      for (const issue of allIssues) categoryCounts[issue.category] = (categoryCounts[issue.category] ?? 0) + 1;
      const scoredRows = rows.filter((r) => r.lastScore !== undefined);
      const totalScore = scoredRows.reduce((sum, r) => sum + (r.lastScore ?? 0), 0);
      return c.json({ bookId, totalChapters: chapters.length, auditedChapters, passedChapters, failedChapters: auditedChapters - passedChapters, averageScore: scoredRows.length > 0 ? Math.round(totalScore / scoredRows.length) : undefined, criticalCount: allIssues.filter((i) => i.severity === "critical").length, warningCount: allIssues.filter((i) => i.severity === "warning").length, infoCount: allIssues.filter((i) => i.severity === "info").length, lastAuditedAt: history.length > 0 ? history[history.length - 1].timestamp : undefined, categoryCounts, rows });
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  // --- Run Audit on Chapter ---
  ctx.app.post("/api/v1/books/:id/audit/:chapter", async (c) => {
    const id = c.req.param("id"); const chapterNum = parseInt(c.req.param("chapter"), 10);
    if (!Number.isInteger(chapterNum) || chapterNum < 1) return c.json({ error: "Invalid chapter number" }, 400);
    const bookDir = ctx.state.bookDir(id);
    ctx.broadcast("audit:start", { bookId: id, chapter: chapterNum });
    try {
      const book = await ctx.state.loadBookConfig(id);
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const paddedNum = String(chapterNum).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);
      const content = await readFile(join(chaptersDir, match), "utf-8");
      const auditConfig = await loadAuditConfig();
      if (!auditConfig) return c.json({ error: "Audit config not set. Please configure audit model first." }, 400);
      const secrets = await loadSecrets(ctx.root);
      const auditKey = secrets.services[`audit:${auditConfig.service}`]?.apiKey ?? "";
      if (!auditKey) return c.json({ error: "Audit API key not set." }, 400);
      const resolvedBaseUrl = await resolveConfiguredServiceBaseUrl(ctx.root, auditConfig.service, auditConfig.baseUrl);
      if (!resolvedBaseUrl) return c.json({ error: `Unknown audit service: ${auditConfig.service}` }, 400);
      const auditApiFormat = normalizeAuditApiFormat(auditConfig.service, auditConfig.apiFormat);
      const { ContinuityAuditor } = await import("@actalk/inkos-core");
      const auditor = new ContinuityAuditor({
        client: createLLMClient({ provider: resolveServiceProviderFamily(auditConfig.service) ?? "openai", service: auditConfig.service, configSource: "studio", baseUrl: resolvedBaseUrl, apiKey: auditKey, model: auditConfig.model, apiFormat: auditApiFormat, stream: false, temperature: 0.7, thinkingBudget: 0 }),
        model: auditConfig.model, projectRoot: ctx.root, bookId: id,
      });
      const result = await auditor.auditChapter(bookDir, content, chapterNum, book.genre, { distillationRules: await loadDistillationRules(bookDir) });
      await persistManualAuditResult(id, chapterNum, result);
      ctx.broadcast("audit:complete", { bookId: id, chapter: chapterNum, passed: result.passed });
      return c.json(result);
    } catch (e) { ctx.broadcast("audit:error", { bookId: id, error: String(e) }); return c.json({ error: String(e) }, 500); }
  });
}
