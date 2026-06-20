import { join, resolve, sep } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  PipelineRunner,
  createLLMClient,
  loadProjectConfig,
  loadSecrets,
  saveSecrets,
  setServiceApiKey,
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
  analyzeStyleFingerprint,
  type PipelineConfig,
  type AuthorStyleProfile,
  type StyleSourceDocument,
  type StyleLibraryIndex,
  type ChapterImportPlan,
  type ChapterGoalCard,
  type AuthorChapterIntent,
  type StyleFingerprint,
  type FoundationSourceInput,
} from "@actalk/inkos-core";
import {
  DiagnosticsRequestSchema, CompareRequestSchema,
  AdjustmentPlanRequestSchema, RewritePreviewRequestSchema,
  InspectRequestSchema, MAX_PREPROCESS_TEXT_CHARS,
  PreprocessRequestSchema, RelayoutRequestSchema,
} from "../style-schemas.js";
import type { ServerContext } from "../server-context.js";

// ─── Constants ────────────────────────────────────────────────────

const STYLE_ID_RE = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,127}$/u;
const WINDOWS_RESERVED_STYLE_ID_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// ─── Helpers (extracted from server.ts) ───────────────────────────

function isSafeStyleId(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    STYLE_ID_RE.test(value.trim()) &&
    value.trim() !== "." &&
    value.trim() !== ".." &&
    !WINDOWS_RESERVED_STYLE_ID_RE.test(value.trim())
  );
}

function isTextStyleFileType(value: unknown): value is "md" | "txt" | "jsonl" | "json" | "ts" | "js" | "html" | "css" {
  return value === "md" || value === "txt" || value === "jsonl" || value === "json" || value === "ts" || value === "js" || value === "html" || value === "css";
}

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

function isBlockedStyleImportAddress(address: string): boolean {
  const host = address.toLowerCase().replace(/^\[|\]$/g, "");
  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const [a = 0, b = 0] = host.split(".").map((part) => Number(part));
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (ipVersion === 6) {
    if (host.startsWith("::ffff:")) {
      return isBlockedStyleImportAddress(host.slice("::ffff:".length));
    }
    return (
      host === "::" ||
      host === "::1" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe80:")
    );
  }
  return false;
}

function isBlockedStyleImportHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    isBlockedStyleImportAddress(host)
  );
}

function parseSafeStyleImportUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("url is required");
  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("only http and https URLs are supported");
  }
  if (url.username || url.password) {
    throw new Error("URL credentials are not allowed");
  }
  if (isBlockedStyleImportHostname(url.hostname)) {
    throw new Error("private or local URLs are not allowed");
  }
  return url;
}

async function assertSafeStyleImportTarget(url: URL): Promise<void> {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isBlockedStyleImportHostname(host)) {
    throw new Error("private or local URLs are not allowed");
  }
  if (isIP(host)) return;
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("URL hostname could not be resolved");
  }
  if (addresses.length === 0 || addresses.some((record) => isBlockedStyleImportAddress(record.address))) {
    throw new Error("private or local URLs are not allowed");
  }
}

function extractHtmlTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  return match[1]
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || null;
}

async function readStyleImportBody(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error(`URL response is too large (max ${Math.floor(maxBytes / 1_000_000)}MB)`);
    }
    return text;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        reader.cancel();
        throw new Error(`URL response is too large (max ${Math.floor(maxBytes / 1_000_000)}MB)`);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

async function withPipeline<T>(
  label: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any,
  fn: (pipeline: PipelineRunner) => Promise<T>,
): Promise<T> {
  const pipeline = new PipelineRunner(config);
  try {
    return await fn(pipeline);
  } finally {
    if (typeof (pipeline as unknown as Record<string, unknown>).dispose === "function") {
      ((pipeline as unknown as Record<string, unknown>).dispose as () => void)();
    }
  }
}

/**
 * Style analysis, comparison, rewrite, import, and style library routes.
 */
export function registerStyleRoutes(ctx: ServerContext): void {
  const { app, root, state: stateManager, broadcast, buildPipelineConfig, loadCurrentProjectConfig } = ctx;

  async function assertBookExists(state: ServerContext["state"], bookId: string): Promise<void> {
    try {
      await state.loadBookConfig(bookId);
    } catch {
      throw new Error(`Book not found: ${bookId}`);
    }
  }

  function assertProjectRoot(input: string | undefined, serverRoot: string): string {
    const candidate = input ? resolve(input) : resolve(serverRoot);
    const allowed = resolve(serverRoot);
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

// --- Style Analyze ---

  app.post("/api/v1/style/analyze", async (c) => {
    const { text, sourceName } = await c.req.json<{ text: string; sourceName: string }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);

    try {
      const { analyzeStyle } = await import("@actalk/inkos-core");
      const profile = analyzeStyle(text, sourceName ?? "unknown");
      return c.json(profile);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Pre-flight: check that @actalk/inkos-core is built before any style endpoint ---
  async function ensureCoreBuilt(): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await import("@actalk/inkos-core");
      return { ok: true };
    } catch {
      return { ok: false, error: "@actalk/inkos-core is not built. Run `pnpm --filter @actalk/inkos-core exec tsc` first." };
    }
  }

  app.post("/api/v1/style/diagnostics", async (c) => {
    const coreBuilt = await ensureCoreBuilt();
    if (!coreBuilt.ok) return c.json({ error: coreBuilt.error }, 503);

    const raw = await c.req.json().catch(() => null);
    const parsed = DiagnosticsRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    const { text, language } = parsed.data;
    if (!text.trim()) return c.json({ error: "text is required" }, 400);

    try {
      const { runFullDiagnostics } = await import("@actalk/inkos-core");
      const diagnostics = runFullDiagnostics(text, language ?? "zh");
      return c.json(diagnostics);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- AI-Tells analysis for arbitrary text (standalone, not chapter-bound) ---

  app.post("/api/v1/style/ai-tells", async (c) => {
    const raw = await c.req.json().catch(() => null);
    if (!raw || typeof raw.text !== "string" || !raw.text.trim()) {
      return c.json({ error: "text is required" }, 400);
    }
    const { text, language } = raw as { text: string; language?: string };
    try {
      const { analyzeAITells } = await import("@actalk/inkos-core");
      const result = analyzeAITells(text, language === "en" ? "en" : "zh");
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Style Comparison & Adjustment Plan ---

  app.post("/api/v1/style/compare", async (c) => {
    const coreBuilt = await ensureCoreBuilt();
    if (!coreBuilt.ok) return c.json({ error: coreBuilt.error }, 503);

    const raw = await c.req.json().catch(() => null);
    const parsed = CompareRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    const { text, targetAuthorId, language } = parsed.data;
    if (!text.trim()) return c.json({ error: "text is required" }, 400);

    try {
      const authorData = await getAuthorProfile(root, targetAuthorId);
      if (!authorData) {
        return c.json({ error: `Author "${targetAuthorId}" not found` }, 404);
      }
      if (language && authorData.profile.language !== language) {
        return c.json({ error: `Author language is "${authorData.profile.language}", not "${language}"` }, 400);
      }
      const result = compareWithAuthorProfile(text, authorData.profile);
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/style/adjustments/plan", async (c) => {
    const coreBuilt = await ensureCoreBuilt();
    if (!coreBuilt.ok) return c.json({ error: coreBuilt.error }, 503);

    const raw = await c.req.json().catch(() => null);
    const parsed = AdjustmentPlanRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    const { text, targetAuthorId, maxSuggestions } = parsed.data;
    if (!text.trim()) return c.json({ error: "text is required" }, 400);

    try {
      const { runFullDiagnostics } = await import("@actalk/inkos-core");
      const diagnostics = runFullDiagnostics(text);

      let comparison: ReturnType<typeof compareWithAuthorProfile> | undefined;
      let authorProfile: AuthorStyleProfile | undefined;

      if (targetAuthorId) {
        const authorData = await getAuthorProfile(root, targetAuthorId);
        if (!authorData) {
          return c.json({ error: `Author "${targetAuthorId}" not found` }, 404);
        }
        authorProfile = authorData.profile;
        comparison = compareWithAuthorProfile(text, authorProfile);
      }

      const plan = generateAdjustmentPlan(text, diagnostics, {
        targetAuthorProfile: authorProfile,
        comparison,
        maxSuggestions,
      });
      return c.json(plan);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Style Rewrite Preview ---

  app.post("/api/v1/style/adjustments/preview", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = RewritePreviewRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    const { text, sourceHash, targetAuthorId, authorProfileVersion, selectedSuggestionIds } = parsed.data;
    if (!text.trim()) return c.json({ error: "text is required" }, 400);

    try {
      // 1. Load author profile
      const authorData = await getAuthorProfile(root, targetAuthorId);
      if (!authorData) {
        return c.json({ error: `Author "${targetAuthorId}" not found` }, 404);
      }
      if (authorData.profile.version !== authorProfileVersion) {
        return c.json({ error: "Author profile version has changed; regenerate plan" }, 409);
      }

      // 2. Regenerate diagnostics and plan from current text
      const { runFullDiagnostics } = await import("@actalk/inkos-core");
      const diagnostics = runFullDiagnostics(text);
      const plan = generateAdjustmentPlan(text, diagnostics, {
        targetAuthorProfile: authorData.profile,
        comparison: compareWithAuthorProfile(text, authorData.profile),
      });

      // 3. Validate sourceHash
      if (plan.sourceHash !== sourceHash) {
        return c.json({ error: "Source text has changed; regenerate plan" }, 409);
      }

      const validSuggestionIds = new Set(plan.suggestions.map((suggestion) => suggestion.id));
      const missingSuggestionIds = selectedSuggestionIds.filter((id) => !validSuggestionIds.has(id));
      if (missingSuggestionIds.length > 0) {
        return c.json({ error: "Selected suggestions are stale; regenerate plan" }, 409);
      }

      // 4. Create LLM client and rewrite
      const freshConfig = await loadProjectConfig(root, { consumer: "studio" });
      if (!freshConfig.llm?.provider) {
        return c.json({ error: "LLM provider not configured; please check your API settings" }, 503);
      }
      const client = createLLMClient(freshConfig.llm);
      if (!client._apiKey) {
        return c.json({ error: "API key not configured; please set INKOS_LLM_API_KEY in project .env or global ~/.inkos/.env" }, 503);
      }
      const model = freshConfig.llm.model ?? "deepseek-v4-flash";

      const result = await rewriteWithAuthorProfile({
        text,
        authorProfile: authorData.profile,
        plan,
        selectedSuggestionIds,
        preserveContent: true,
      }, { client, model });

      return c.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Distinguish LLM errors from validation errors
      if (msg.includes("LLM rewrite failed") || msg.includes("API returned")) {
        return c.json({ error: msg }, 503);
      }
      return c.json({ error: msg }, 500);
    }
  });

  // --- Style Import to Book ---

  app.post("/api/v1/books/:id/style/import", async (c) => {
    const id = c.req.param("id");
    const { text, sourceName } = await c.req.json<{ text: string; sourceName: string }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);

    ctx.broadcast("style:start", { bookId: id });
    try {
      const result = await withPipeline("style-guide", await ctx.buildPipelineConfig(), async (pipeline) => {
        return pipeline.generateStyleGuide(id, text, sourceName ?? "unknown");
      });
      ctx.broadcast("style:complete", { bookId: id });
      return c.json({ ok: true, result });
    } catch (e) {
      ctx.broadcast("style:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Style Library (Plus) ---

  app.post("/api/v1/style/extract-text", async (c) => {
    const { text, sourceName, fileType, maxChars, chunk } = await c.req.json<{
      text: string;
      sourceName: string;
      fileType?: "md" | "txt" | "jsonl" | "json" | "ts" | "js" | "html" | "css";
      maxChars?: number;
      chunk?: number;
    }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);
    if (fileType !== undefined && !isTextStyleFileType(fileType)) {
      return c.json({ error: "fileType must be md, txt, jsonl, json, ts, js, html or css" }, 400);
    }

    const effectiveMaxChars = typeof maxChars === "number" && Number.isFinite(maxChars)
      ? Math.min(Math.max(maxChars, 1000), MAX_CHARS)
      : MAX_CHARS;

    try {
      // 如果请求了指定分片，使用分片提取器
      if (typeof chunk === "number" && chunk >= 0) {
        const gen = extractDocumentChunked(text, sourceName ?? "sample", fileType ?? "txt", {
          maxChars: effectiveMaxChars,
        });
        let index = 0;
        for (const doc of gen) {
          if (index === chunk) return c.json(doc);
          index++;
        }
        return c.json({ error: `chunk ${chunk} out of range (total ${index})` }, 404);
      }

      const extracted = extractDocumentFromText(text, sourceName ?? "sample", fileType ?? "txt", {
        maxChars: effectiveMaxChars,
      });
      return c.json(extracted);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/style/import-url", async (c) => {
    const { url: rawUrl, maxChars } = await c.req.json<{ url: string; maxChars?: number }>();
    let url: URL;
    try {
      url = parseSafeStyleImportUrl(rawUrl ?? "");
      await assertSafeStyleImportTarget(url);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }

    try {
      let currentUrl = url;
      let response: Response | null = null;
      for (let redirectCount = 0; redirectCount < 4; redirectCount++) {
        response = await fetch(currentUrl, {
          headers: {
            "User-Agent": "NoFusion-Studio/1.0 (+style-import)",
            "Accept": "text/html, text/plain, text/markdown, application/json;q=0.8, */*;q=0.2",
          },
          redirect: "manual",
          signal: AbortSignal.timeout(60000),
        });

        if (![301, 302, 303, 307, 308].includes(response.status)) {
          break;
        }

        const location = response.headers.get("location");
        if (!location) break;
        try {
          currentUrl = parseSafeStyleImportUrl(new URL(location, currentUrl).toString());
          await assertSafeStyleImportTarget(currentUrl);
        } catch (e) {
          return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
        }
      }

      if (!response) {
        return c.json({ error: "Fetch failed" }, 502);
      }
      if (!response.ok) {
        return c.json({ error: `Fetch failed: ${response.status} ${response.statusText}` }, 502);
      }

      const contentLength = Number(response.headers.get("content-length") ?? "0");
      if (contentLength > 50_000_000) {
        return c.json({ error: "URL response is too large (max 50MB)" }, 413);
      }

      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      const raw = await readStyleImportBody(response, 50_000_000);
      const fileType =
        contentType.includes("html")
          ? "html"
          : contentType.includes("json")
            ? "json"
            : contentType.includes("markdown")
              ? "md"
              : "txt";
      const title = fileType === "html" ? extractHtmlTitle(raw) : null;
      const sourceName = title ? `${title} - ${currentUrl.hostname}` : currentUrl.toString();
      const extracted = extractDocumentFromText(raw, sourceName, fileType, {
        maxChars: typeof maxChars === "number" && Number.isFinite(maxChars)
          ? Math.min(Math.max(maxChars, 1000), MAX_CHARS)
          : MAX_CHARS,
      });

      return c.json({
        ...extracted,
        url: currentUrl.toString(),
        contentType,
        sourceName,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ error: message }, message.includes("too large") ? 413 : 502);
    }
  });

  app.get("/api/v1/style/authors", async (c) => {
    try {
      const index = await listAuthorProfiles(root);
      return c.json(index);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/style/authors", async (c) => {
    const { id, name, language, tags } = await c.req.json<{ id: string; name: string; language?: "zh" | "en"; tags?: string[] }>();
    if (!id?.trim() || !name?.trim()) return c.json({ error: "id and name are required" }, 400);
    if (!isSafeStyleId(id)) return c.json({ error: "invalid author id" }, 400);
    if (language !== undefined && language !== "zh" && language !== "en") {
      return c.json({ error: "language must be zh or en" }, 400);
    }
    if (tags !== undefined && !Array.isArray(tags)) {
      return c.json({ error: "tags must be an array" }, 400);
    }
    try {
      const cleanTags = tags?.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean);
      const profile = await createAuthorProfile(root, { id: id.trim(), name: name.trim(), language, tags: cleanTags });
      return c.json(profile);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.get("/api/v1/style/authors/:authorId", async (c) => {
    const authorId = c.req.param("authorId");
    if (!isSafeStyleId(authorId)) return c.json({ error: "invalid author id" }, 400);
    try {
      const result = await getAuthorProfile(root, authorId);
      if (!result) return c.json({ error: "Author not found" }, 404);
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/style/authors/:authorId/sources", async (c) => {
    const authorId = c.req.param("authorId");
    const { sourceId, fileName, fileType, text } = await c.req.json<{ sourceId: string; fileName: string; fileType: "md" | "txt" | "jsonl" | "json" | "ts" | "js" | "html" | "css"; text: string }>();
    if (!sourceId?.trim() || !text?.trim()) return c.json({ error: "sourceId and text are required" }, 400);
    if (!isSafeStyleId(authorId)) return c.json({ error: "invalid author id" }, 400);
    if (!isSafeStyleId(sourceId)) return c.json({ error: "invalid source id" }, 400);
    if (!isTextStyleFileType(fileType)) return c.json({ error: "fileType must be md, txt, jsonl, json, ts, js, html or css" }, 400);
    try {
      const source = await addStyleSource(root, {
        authorId,
        sourceId: sourceId.trim(),
        fileName: fileName ?? sourceId,
        fileType,
        text,
      });
      return c.json(source);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/style/authors/:authorId/reanalyze", async (c) => {
    const authorId = c.req.param("authorId");
    if (!isSafeStyleId(authorId)) return c.json({ error: "invalid author id" }, 400);
    try {
      const profile = await reanalyzeAuthorProfile(root, authorId);
      return c.json(profile);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.delete("/api/v1/style/authors/:authorId", async (c) => {
    const authorId = c.req.param("authorId");
    if (!isSafeStyleId(authorId)) return c.json({ error: "invalid author id" }, 400);
    try {
      await deleteAuthorProfile(root, authorId);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/style/authors/:authorId/diagnostics", async (c) => {
    const authorId = c.req.param("authorId");
    if (!isSafeStyleId(authorId)) return c.json({ error: "invalid author id" }, 400);
    const { data } = await c.req.json<{ data: unknown }>();
    if (!data) return c.json({ error: "data is required" }, 400);
    try {
      const id = crypto.randomUUID().slice(0, 8);
      const entry = await saveAuthorDiagnostics(root, authorId, id, data);
      return c.json(entry);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.get("/api/v1/style/authors/:authorId/diagnostics", async (c) => {
    const authorId = c.req.param("authorId");
    if (!isSafeStyleId(authorId)) return c.json({ error: "invalid author id" }, 400);
    try {
      const entries = await listAuthorDiagnostics(root, authorId);
      return c.json({ entries });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.get("/api/v1/style/authors/:authorId/diagnostics/:diagnosticsId", async (c) => {
    const authorId = c.req.param("authorId");
    const diagnosticsId = c.req.param("diagnosticsId");
    if (!isSafeStyleId(authorId)) return c.json({ error: "invalid author id" }, 400);
    try {
      const data = await getAuthorDiagnostics(root, authorId, diagnosticsId);
      if (!data) return c.json({ error: "not found" }, 404);
      return c.json(data);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/style/apply-author", async (c) => {
    const bookId = c.req.param("id");
    const { authorId } = await c.req.json<{ authorId: string }>();
    if (!authorId?.trim()) return c.json({ error: "authorId is required" }, 400);
    if (!isSafeStyleId(authorId)) return c.json({ error: "invalid author id" }, 400);

    ctx.broadcast("style:start", { bookId, type: "apply-author", authorId });
    try {
      const result = await getAuthorProfile(root, authorId);
      if (!result) {
        ctx.broadcast("style:error", { bookId, type: "apply-author", authorId, error: "Author not found" });
        return c.json({ error: "Author not found" }, 404);
      }

      const bookDir = ctx.state.bookDir(bookId);
      const storyDir = join(bookDir, "story");
      await mkdir(storyDir, { recursive: true });

      // Write aggregated style_profile.json
      const profilePath = join(storyDir, "style_profile.json");
      await writeFile(profilePath, JSON.stringify(result.profile.aggregateProfile, null, 2), "utf-8");

      // Build deterministic style guide from aggregate profile
      const book = await ctx.state.loadBookConfig(bookId);
      const lang = book.language ?? "zh";
      const p = result.profile.aggregateProfile;
      const guide = lang === "en"
        ? `# Style Guide\n\n**Source**: Author profile "${result.profile.name}"\n\n## Statistical Fingerprint\n- Average sentence length: ${p.avgSentenceLength.toFixed(1)} chars\n- Sentence length std dev: ${p.sentenceLengthStdDev.toFixed(1)}\n- Average paragraph length: ${p.avgParagraphLength.toFixed(0)} chars\n- Paragraph length range: ${p.paragraphLengthRange.min} - ${p.paragraphLengthRange.max}\n- Vocabulary diversity (TTR): ${(p.vocabularyDiversity * 100).toFixed(1)}%\n${p.topPatterns.length > 0 ? `\n## Top Patterns\n${p.topPatterns.map((x: string) => `- ${x}`).join("\n")}` : ""}\n${p.rhetoricalFeatures.length > 0 ? `\n## Rhetorical Features\n${p.rhetoricalFeatures.map((x: string) => `- ${x}`).join("\n")}` : ""}\n`
        : `# 文风指南\n\n**来源**：作家档案「${result.profile.name}」\n\n## 统计指纹\n- 平均句长：${p.avgSentenceLength.toFixed(1)} 字\n- 句长标准差：${p.sentenceLengthStdDev.toFixed(1)}\n- 平均段落长度：${p.avgParagraphLength.toFixed(0)} 字\n- 段落长度范围：${p.paragraphLengthRange.min} - ${p.paragraphLengthRange.max}\n- 词汇多样性（TTR）：${(p.vocabularyDiversity * 100).toFixed(1)}%\n${p.topPatterns.length > 0 ? `\n## 高频句式\n${p.topPatterns.map((x: string) => `- ${x}`).join("\n")}` : ""}\n${p.rhetoricalFeatures.length > 0 ? `\n## 修辞特征\n${p.rhetoricalFeatures.map((x: string) => `- ${x}`).join("\n")}` : ""}\n`;

      const guidePath = join(storyDir, "style_guide.md");
      await writeFile(guidePath, guide, "utf-8");

      // Write style source tracking
      const styleSourcePath = join(storyDir, "style_source.json");
      await writeFile(
        styleSourcePath,
        JSON.stringify(
          {
            styleProfileId: authorId,
            styleProfileName: result.profile.name,
            styleAppliedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        "utf-8",
      );

      ctx.broadcast("style:complete", { bookId, type: "apply-author", authorId });
      return c.json({
        ok: true,
        bookId,
        authorId,
        authorName: result.profile.name,
        styleProfilePath: "story/style_profile.json",
        styleGuidePath: "story/style_guide.md",
      });
    } catch (e) {
      ctx.broadcast("style:error", { bookId, type: "apply-author", authorId, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/style/preprocess", async (c) => {
    const raw = await c.req.json();
    const parse = PreprocessRequestSchema.safeParse(raw);
    if (!parse.success) {
      const first = parse.error.issues[0];
      if (first?.code === "too_big") {
        return c.json({ error: "PAYLOAD_TOO_LARGE", message: `Text exceeds ${MAX_PREPROCESS_TEXT_CHARS} characters`, maxChars: MAX_PREPROCESS_TEXT_CHARS }, 413);
      }
      return c.json({ error: "VALIDATION_ERROR", message: parse.error.message }, 400);
    }
    const { text, options } = parse.data;
    if (!text.trim()) return c.json({ error: "text is required" }, 400);
    try {
      const { preprocessText } = await import("@actalk/inkos-core");
      const result = preprocessText(text, options);
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/style/relayout", async (c) => {
    const raw = await c.req.json();
    const parse = RelayoutRequestSchema.safeParse(raw);
    if (!parse.success) {
      const first = parse.error.issues[0];
      if (first?.code === "too_big") {
        return c.json({ error: "PAYLOAD_TOO_LARGE", message: `Text exceeds ${MAX_PREPROCESS_TEXT_CHARS} characters`, maxChars: MAX_PREPROCESS_TEXT_CHARS }, 413);
      }
      return c.json({ error: "VALIDATION_ERROR", message: parse.error.message }, 400);
    }
    const { text, options } = parse.data;
    if (!text.trim()) return c.json({ error: "text is required" }, 400);
    try {
      const { relayoutText } = await import("@actalk/inkos-core");
      const result = relayoutText(text, options);
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Style Input Inspection ---

  app.post("/api/v1/style/preprocess/inspect", async (c) => {
    const raw = await c.req.json();
    const parse = InspectRequestSchema.safeParse(raw);
    if (!parse.success) {
      const first = parse.error.issues[0];
      if (first?.code === "too_big") {
        return c.json({ error: "PAYLOAD_TOO_LARGE", message: `Text exceeds ${MAX_PREPROCESS_TEXT_CHARS} characters`, maxChars: MAX_PREPROCESS_TEXT_CHARS }, 413);
      }
      return c.json({ error: "VALIDATION_ERROR", message: parse.error.message }, 400);
    }
    const { text, checks } = parse.data;
    if (!text.trim()) return c.json({ error: "text is required" }, 400);
    try {
      const { inspectText: runInspect } = await import("../style-preprocess-adapter.js");
      const result = runInspect(text, checks);
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Style Rhetoric Deduplication ---

  /**
   * POST /api/v1/style/rhetoric/rewrite
   * Build a deduplication prompt for the given findings.
   * The caller sends the prompt to the LLM provider separately.
   */
  app.post("/api/v1/style/rhetoric/rewrite", async (c) => {
    const raw = await c.req.json<{
      text: string;
      findings?: unknown[];
      categories?: string[];
      mode?: string;
    }>();
    if (!raw.text?.trim()) return c.json({ error: "text is required" }, 400);
    try {
      const { buildDedupePrompt, detectDuplicateRhetoric } = await import("@actalk/inkos-core");
      // Support both `findings` (pre-computed) and `categories` (frontend shorthand)
      let findings: unknown[] | undefined;
      if (Array.isArray(raw.findings)) {
        findings = raw.findings;
      } else if (Array.isArray(raw.categories) && raw.categories.length) {
        findings = raw.categories.map((cat) => ({
          category: cat,
          label: cat,
          count: 0,
          perThousandChars: 0,
          severity: "low" as const,
          examples: [] as Array<{ text: string }>,
        }));
      } else {
        const detected = detectDuplicateRhetoric(raw.text, "zh");
        findings = detected?.findings as unknown[] | undefined;
      }
      if (!Array.isArray(findings)) {
        return c.json({ error: "findings must be an array" }, 400);
      }
      const prompt = buildDedupePrompt(raw.text, findings as any[], (raw.mode ?? "replace") as any);
      return c.json({ prompt });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  /**
   * POST /api/v1/style/rhetoric/detect
   * Detect duplicated rhetoric patterns — returns findings only, no prompt.
   * Separate endpoint from /rewrite to avoid frontend reading {prompt} as {findings}.
   */
  app.post("/api/v1/style/rhetoric/detect", async (c) => {
    const raw = await c.req.json<{ text: string; language?: string }>();
    if (!raw.text?.trim()) return c.json({ error: "text is required" }, 400);
    try {
      const { detectDuplicateRhetoric } = await import("@actalk/inkos-core");
      const language = raw.language === "en" ? "en" as const : "zh" as const;
      const result = detectDuplicateRhetoric(raw.text, language);
      const findings = Array.isArray(result?.findings) ? result.findings : [];
      return c.json({ findings });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  /**
   * POST /api/v1/style/rhetoric/aware-prompt
   * Build a rhetoric-aware system prompt for Pipeline writer.
   */
  app.post("/api/v1/style/rhetoric/aware-prompt", async (c) => {
    const raw = await c.req.json<{
      basePrompt: string;
      contextText: string;
      maxPerThousandChars?: Record<string, number>;
    }>();
    if (!raw.basePrompt || !raw.contextText) return c.json({ error: "basePrompt and contextText are required" }, 400);
    try {
      const { buildRhetoricAwarePrompt } = await import("@actalk/inkos-core");
      const prompt = buildRhetoricAwarePrompt(raw.basePrompt, raw.contextText, raw.maxPerThousandChars);
      return c.json({ prompt });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Style Paragraph Deduplication ---

  /**
   * POST /api/v1/style/paragraph/dedup
   * Detect duplicate and similar paragraphs in text.
   */
  app.post("/api/v1/style/paragraph/dedup", async (c) => {
    const raw = await c.req.json<{ text: string; threshold?: number; minLength?: number }>();
    if (!raw.text?.trim()) return c.json({ error: "text is required" }, 400);
    // Sanitise numeric inputs
    const threshold = typeof raw.threshold === "number" && raw.threshold >= 0 && raw.threshold <= 1
      ? raw.threshold : 0.8;
    const minLength = typeof raw.minLength === "number" && Number.isFinite(raw.minLength) && raw.minLength >= 1
      ? Math.floor(raw.minLength) : 20;
    try {
      const { detectDuplicateParagraphs } = await import("@actalk/inkos-core");
      const result = detectDuplicateParagraphs(raw.text, {
        similarityThreshold: threshold,
        minParagraphLength: minLength,
      });
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Style Readability Score ---

  /**
   * POST /api/v1/style/readability/score
   * Compute readability score for the given text. Uses POST to avoid long text in URL.
   */
  app.post("/api/v1/style/readability/score", async (c) => {
    const raw = await c.req.json<{ text: string; language?: string }>();
    if (!raw.text?.trim()) return c.json({ error: "text is required" }, 400);
    try {
      const { computeReadabilityScore } = await import("@actalk/inkos-core");
      const score = computeReadabilityScore(raw.text);
      return c.json(score);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Author Search ---

  /**
   * POST /api/v1/style/authors/search
   * Search the internet for author works.
   */
  app.post("/api/v1/style/authors/search", async (c) => {
    const raw = await c.req.json<{ authorName: string; language?: string }>();
    if (!raw.authorName?.trim()) return c.json({ error: "authorName is required" }, 400);
    try {
      const { searchAuthorWorks } = await import("../author-search.js");
      const results = await searchAuthorWorks({
        authorName: raw.authorName.trim(),
        language: (raw.language ?? "zh") as "zh" | "en",
      });
      return c.json({ results });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  /**
   * POST /api/v1/style/authors/fetch
   * Fetch content from a URL for author analysis.
   */
  app.post("/api/v1/style/authors/fetch", async (c) => {
    const raw = await c.req.json<{ url: string; maxChars?: number }>();
    if (!raw.url?.trim()) return c.json({ error: "url is required" }, 400);
    try {
      // Reuse existing SSRF-safe URL parser
      const url = parseSafeStyleImportUrl(raw.url);
      await assertSafeStyleImportTarget(url);
      const { fetchUrl } = await import("@actalk/inkos-core");
      const content = await fetchUrl(url.toString(), raw.maxChars ?? 8000);
      return c.json({ content });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  /**
   * POST /api/v1/style/authors/samples/write
   * Write a fetched author sample to local MD file.
   */
  app.post("/api/v1/style/authors/samples/write", async (c) => {
    const raw = await c.req.json<{
      authorId: string;
      authorName: string;
      sourceUrl: string;
      fetchedAt: string;
      content: string;
      charCount: number;
    }>();
    if (!raw.authorId || !raw.content) return c.json({ error: "authorId and content are required" }, 400);
    try {
      assertSafeAuthorId(raw.authorId);
      const prjRoot = assertProjectRoot(process.env.INKOS_PROJECT_ROOT || c.req.header("x-project-root") || undefined, root);
      const { writeAuthorSample } = await import("../author-sample-writer.js");
      const result = await writeAuthorSample(prjRoot, raw);
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Author Distillation ---

  /**
   * POST /api/v1/style/authors/:authorId/distillations
   * Generate a new distillation draft from the current author profile.
   */
  app.post("/api/v1/style/authors/:authorId/distillations", async (c) => {
    const authorId = assertSafeAuthorId(c.req.param("authorId"));
    const prjRoot = assertProjectRoot(process.env.INKOS_PROJECT_ROOT || c.req.header("x-project-root") || undefined, root);
    try {
      const {
        getAuthorProfile,
        generateDistillation,
        loadDistillationEvidence,
        loadDistillationOverrides,
        saveDistillationDraft,
        loadCurrentDistillation,
      } = await import("@actalk/inkos-core");
      const authorData = await getAuthorProfile(prjRoot, authorId);
      if (!authorData) return c.json({ error: "Author not found" }, 404);
      // Load existing overrides as previous distillation context
      const evidence = await loadDistillationEvidence(prjRoot, authorId);
      const overrides = await loadDistillationOverrides(prjRoot, authorId);
      const previous = await loadCurrentDistillation(prjRoot, authorId);
      // Merge overrides into previous
      const mergedPrevious = previous
        ? { ...previous, rules: overrides.length > 0 ? overrides : previous.rules }
        : undefined;
      const result = generateDistillation({
        profile: authorData.profile,
        sources: authorData.sources,
        evidence: [...evidence],
        previous: mergedPrevious,
      });
      await saveDistillationDraft(prjRoot, authorId, result.distillation, result.markdown);
      return c.json(result.distillation, 201);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  /**
   * GET /api/v1/style/authors/:authorId/distillations/current
   * Get the current distillation (draft or published).
   */
  app.get("/api/v1/style/authors/:authorId/distillations/current", async (c) => {
    const authorId = assertSafeAuthorId(c.req.param("authorId"));
    const prjRoot = assertProjectRoot(process.env.INKOS_PROJECT_ROOT || c.req.header("x-project-root") || undefined, root);
    try {
      const { loadCurrentDistillation, getAuthorProfile } = await import("@actalk/inkos-core");
      const distillation = await loadCurrentDistillation(prjRoot, authorId);
      if (!distillation) return c.json({ error: "No distillation found. Generate one first." }, 404);
      const authorData = await getAuthorProfile(prjRoot, authorId);
      const currentProfileVersion = authorData?.profile.version ?? distillation.authorProfileVersion;
      return c.json({
        ...distillation,
        isStale: distillation.authorProfileVersion !== currentProfileVersion,
        currentAuthorProfileVersion: currentProfileVersion,
      });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  /**
   * PATCH /api/v1/style/authors/:authorId/distillations/current
   * Update distillation overrides (enable/disable rules, manual edits).
   */
  app.patch("/api/v1/style/authors/:authorId/distillations/current", async (c) => {
    const authorId = assertSafeAuthorId(c.req.param("authorId"));
    const prjRoot = assertProjectRoot(process.env.INKOS_PROJECT_ROOT || c.req.header("x-project-root") || undefined, root);
    try {
      const body = await c.req.json<{ overrides: unknown[] }>();
      const {
        saveDistillationOverrides,
        loadCurrentDistillation,
        saveDistillationDraft,
        generateDistillation,
        getAuthorProfile,
        loadDistillationEvidence,
      } = await import("@actalk/inkos-core");
      if (!body.overrides || !Array.isArray(body.overrides)) {
        return c.json({ error: "overrides array is required" }, 400);
      }
      await saveDistillationOverrides(prjRoot, authorId, body.overrides as any);
      // Regenerate draft with overrides
      const authorData = await getAuthorProfile(prjRoot, authorId);
      if (!authorData) return c.json({ error: "Author not found" }, 404);
      const evidence = await loadDistillationEvidence(prjRoot, authorId);
      const previous = await loadCurrentDistillation(prjRoot, authorId);
      const result = generateDistillation({
        profile: authorData.profile,
        sources: authorData.sources,
        evidence: [...evidence],
        previous: previous ?? undefined,
      });
      await saveDistillationDraft(prjRoot, authorId, result.distillation, result.markdown);
      return c.json(result.distillation);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  /**
   * POST /api/v1/style/authors/:authorId/distillations/current/publish
   * Publish the current distillation as an immutable version.
   */
  app.post("/api/v1/style/authors/:authorId/distillations/current/publish", async (c) => {
    const authorId = assertSafeAuthorId(c.req.param("authorId"));
    const prjRoot = assertProjectRoot(process.env.INKOS_PROJECT_ROOT || c.req.header("x-project-root") || undefined, root);
    try {
      const {
        loadCurrentDistillation,
        publishDistillation,
        getAuthorProfile,
      } = await import("@actalk/inkos-core");
      const distillation = await loadCurrentDistillation(prjRoot, authorId);
      if (!distillation) return c.json({ error: "No distillation to publish" }, 400);
      if (distillation.sampleAdequacy === "insufficient") {
        return c.json({ error: "Insufficient samples — cannot publish. Add more sources first." }, 400);
      }
      const authorData = await getAuthorProfile(prjRoot, authorId);
      const currentVersion = authorData?.profile.version ?? distillation.authorProfileVersion;
      if (distillation.authorProfileVersion !== currentVersion) {
        return c.json({
          error: "Author profile has changed since this distillation was generated. Regenerate first.",
          stale: true,
        }, 400);
      }
      // Load markdown from current.md
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      let markdown = "";
      try {
        markdown = await readFile(
          join(prjRoot, "style-library", "authors", authorId, "distillation", "current.md"),
          "utf-8",
        );
      } catch { /* use empty */ }
      const published = await publishDistillation(prjRoot, authorId, distillation, markdown);
      return c.json(published);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  /**
   * GET /api/v1/style/authors/:authorId/distillations/versions
   * List published distillation versions.
   */
  app.get("/api/v1/style/authors/:authorId/distillations/versions", async (c) => {
    const authorId = assertSafeAuthorId(c.req.param("authorId"));
    const prjRoot = assertProjectRoot(process.env.INKOS_PROJECT_ROOT || c.req.header("x-project-root") || undefined, root);
    try {
      const { listDistillationVersions } = await import("@actalk/inkos-core");
      const versions = await listDistillationVersions(prjRoot, authorId);
      return c.json({ versions });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Import Chapters ---

  // Step 1: Preview / plan import (no filesystem changes)
  app.post("/api/v1/books/:id/import/chapters/plan", async (c) => {
    const id = c.req.param("id");
    const { text, splitRegex, startNumber } = await c.req.json<{
      text: string;
      splitRegex?: string;
      startNumber?: number;
    }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);

    try {
      const plan = planChapterImport(text, { splitRegex, startNumber });
      return c.json({ plan });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // Step 2: Commit planned import (writes to filesystem)
  app.post("/api/v1/books/:id/import/chapters/commit", async (c) => {
    const id = c.req.param("id");
    const { plan } = await c.req.json<{ plan: ChapterImportPlan }>();
    if (!plan?.chapters?.length) return c.json({ error: "plan is required" }, 400);

    ctx.broadcast("import:start", { bookId: id, type: "chapters" });
    try {
      const chapters = plan.chapters.map((ch) => ({
        title: ch.title,
        content: ch.content,
        targetNumber: ch.targetNumber,
      }));
      // Determine resumeFrom: the minimum targetNumber tells the pipeline whether
      // this is a fresh import (1) or an append to an existing book (>1).
      // When resumeFrom > 1, the pipeline skips foundation generation and index clearing.
      const resumeFrom = Math.min(...chapters.map((ch) => ch.targetNumber ?? 0));
      const validResumeFrom = Number.isFinite(resumeFrom) && resumeFrom > 0 ? resumeFrom : 1;

      const result = await withPipeline("import-chapters", await ctx.buildPipelineConfig(), async (pipeline) => {
        return pipeline.importChapters({ bookId: id, chapters, resumeFrom: validResumeFrom });
      });
      ctx.broadcast("import:complete", { bookId: id, type: "chapters", count: result.importedCount });
      return c.json(result);
    } catch (e) {
      ctx.broadcast("import:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // Legacy direct import (kept for backward compatibility)
  /** @deprecated Use POST /api/v1/books/:id/import/chapters/plan + /commit instead. */
  app.post("/api/v1/books/:id/import/chapters", async (c) => {
    const id = c.req.param("id");
    const { text, splitRegex } = await c.req.json<{ text: string; splitRegex?: string }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);

    ctx.broadcast("import:start", { bookId: id, type: "chapters" });
    try {
      const { splitChapters } = await import("@actalk/inkos-core");
      const chapters = [...splitChapters(text, splitRegex)];

      const result = await withPipeline("import-chapters-legacy", await ctx.buildPipelineConfig(), async (pipeline) => {
        return pipeline.importChapters({ bookId: id, chapters });
      });
      ctx.broadcast("import:complete", { bookId: id, type: "chapters", count: result.importedCount });
      return c.json(result);
    } catch (e) {
      ctx.broadcast("import:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Import Canon ---

  app.post("/api/v1/books/:id/import/canon", async (c) => {
    const id = c.req.param("id");
    const { fromBookId } = await c.req.json<{ fromBookId: string }>();
    if (!fromBookId) return c.json({ error: "fromBookId is required" }, 400);

    ctx.broadcast("import:start", { bookId: id, type: "canon" });
    try {
      await withPipeline("import-canon", await ctx.buildPipelineConfig(), async (pipeline) => {
        await pipeline.importCanon(id, fromBookId);
      });
      ctx.broadcast("import:complete", { bookId: id, type: "canon" });
      return c.json({ ok: true });
    } catch (e) {
      ctx.broadcast("import:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Foundation Import (plan / commit) ---

  app.post("/api/v1/books/:id/import/foundation/plan", async (c) => {
    const id = c.req.param("id");
    const { sources, mode, instruction } = await c.req.json<{
      sources: Array<{ sourceName: string; fileType: string; text: string; purpose?: string }>;
      mode?: "supplement" | "rebuild";
      instruction?: string;
    }>();
    if (!sources?.length) return c.json({ error: "sources is required" }, 400);
    if (mode !== undefined && mode !== "supplement" && mode !== "rebuild") {
      return c.json({ error: "mode must be supplement or rebuild" }, 400);
    }

    try {
      const inputs: FoundationSourceInput[] = [];
      for (const source of sources) {
        if (
          !source
          || typeof source.sourceName !== "string"
          || typeof source.text !== "string"
          || !isDocumentFileType(source.fileType)
          || (source.purpose !== undefined && !isFoundationSourcePurpose(source.purpose))
        ) {
          return c.json({ error: "invalid foundation source" }, 400);
        }
        inputs.push({
          sourceName: source.sourceName,
          fileType: source.fileType,
          text: source.text,
          purpose: source.purpose,
        });
      }
      const result = await withPipeline("plan-foundation", await ctx.buildPipelineConfig(), async (pipeline) => {
        return pipeline.planFoundationImport(id, inputs, { mode, instruction });
      });

      if (result.proposed && result.roleChanges && result.foundationRevision) {
        const sourceBundle = buildFoundationSourceBundle(
          result.bundle.sources
            .filter((source) => source.purpose !== "chapter" && source.purpose !== "style")
            .map((source) => ({
              sourceName: source.sourceName,
              fileType: source.fileType,
              text: source.text,
              purpose: source.purpose,
              normalized: true,
            })),
        );
        const planId = randomUUID();
        ctx.foundationPlans.set(planId, {
          bookId: id,
          mode: mode ?? "supplement",
          proposed: result.proposed,
          foundationRevision: result.foundationRevision,
          sourceBundle,
          expiresAt: Date.now() + 30 * 60 * 1000,
        });
        // Persist to disk so plans survive server restart
        ctx.persistFoundationPlan(root, planId, ctx.foundationPlans.get(planId)! as Record<string, unknown>).catch((e: unknown) => {
          console.error("[studio] Failed to persist foundation plan:", e);
        });
        return c.json({
          planId,
          bundle: result.bundle,
          proposed: result.proposed,
          warnings: result.warnings,
          roleChanges: result.roleChanges,
        });
      }

      return c.json({
        planId: null,
        bundle: result.bundle,
        warnings: result.warnings,
        proposed: null,
        roleChanges: null,
      });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/import/foundation/commit", async (c) => {
    const id = c.req.param("id");
    const { planId } = await c.req.json<{ planId?: string }>();
    if (!planId) return c.json({ error: "planId is required" }, 400);
    await ctx.foundationPlansPromise;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plan = ctx.foundationPlans.get(planId) as any;
    if (!plan || plan.bookId !== id || plan.expiresAt < Date.now()) {
      ctx.foundationPlans.delete(planId);
      ctx.removePersistedFoundationPlan(root, planId).catch((e) => {
        console.error("[studio] Failed to remove expired foundation plan:", e);
      });
      return c.json({ error: "foundation plan is missing or expired; generate a new preview" }, 409);
    }

    ctx.broadcast("import:start", { bookId: id, type: "foundation" });
    try {
      await withPipeline("commit-foundation-plan", await ctx.buildPipelineConfig(), async (pipeline) => {
        await pipeline.commitFoundationImport(id, plan.proposed, {
          mode: plan.mode,
          expectedRevision: plan.foundationRevision,
          sourceBundle: plan.sourceBundle,
        });
        ctx.foundationPlans.delete(planId);
        ctx.removePersistedFoundationPlan(root, planId).catch((e) => {
          console.error("[studio] Failed to remove committed foundation plan:", e);
        });
      });
      ctx.broadcast("import:complete", { bookId: id, type: "foundation" });
      return c.json({ ok: true });
    } catch (e) {
      ctx.broadcast("import:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Chapter Goals ---

  app.get("/api/v1/books/:id/chapter-goals", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(ctx.state, id);
    try {
      const bookDir = stateManager.bookDir(id);
      const index = await loadChapterGoals(bookDir);
      return c.json(index);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.put("/api/v1/books/:id/chapter-goals/:chapterNumber", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(ctx.state, id);
    const chapterNumber = Number(c.req.param("chapterNumber"));
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    const body = await c.req.json<Partial<ChapterGoalCard>>();
    try {
      const bookDir = stateManager.bookDir(id);
      const index = await loadChapterGoals(bookDir);
      const goal: ChapterGoalCard = {
        chapterNumber,
        ...getChapterGoal(index.goals, chapterNumber),
        ...body,
      };
      const next = upsertChapterGoal(index.goals, goal);
      await saveChapterGoals(bookDir, next);
      return c.json({ ok: true, goal });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.delete("/api/v1/books/:id/chapter-goals/:chapterNumber", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(ctx.state, id);
    const chapterNumber = Number(c.req.param("chapterNumber"));
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    try {
      const bookDir = stateManager.bookDir(id);
      const index = await loadChapterGoals(bookDir);
      const next = removeChapterGoal(index.goals, chapterNumber);
      await saveChapterGoals(bookDir, next);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Chapter Intents (author interview) ---

  app.get("/api/v1/books/:id/chapter-intents", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(ctx.state, id);
    try {
      const bookDir = stateManager.bookDir(id);
      const index = await loadChapterIntents(bookDir);
      return c.json(index);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.put("/api/v1/books/:id/chapter-intents/:chapterNumber", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(ctx.state, id);
    const chapterNumber = Number(c.req.param("chapterNumber"));
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    const body = await c.req.json<Partial<AuthorChapterIntent>>();
    try {
      const bookDir = stateManager.bookDir(id);
      const index = await loadChapterIntents(bookDir);
      const existing = getChapterIntent(index.intents, chapterNumber);
      const parsedIntent = AuthorChapterIntentSchema.safeParse({
        chapterNumber,
        coreNarrative: body.coreNarrative ?? existing?.coreNarrative ?? "",
        readerTakeaway: body.readerTakeaway ?? existing?.readerTakeaway ?? "",
        keyMoment: body.keyMoment ?? existing?.keyMoment ?? "",
        scenes: body.scenes ?? existing?.scenes ?? [],
        characterStates: body.characterStates ?? existing?.characterStates ?? [],
        requiredBeats: body.requiredBeats ?? existing?.requiredBeats ?? [],
        forbiddenMoves: body.forbiddenMoves ?? existing?.forbiddenMoves ?? [],
        pendingHookIds: body.pendingHookIds ?? existing?.pendingHookIds ?? [],
        narrativePosition: body.narrativePosition ?? existing?.narrativePosition ?? "rising",
        plotLine: body.plotLine ?? existing?.plotLine,
        interviewCompletedAt: body.interviewCompletedAt ?? existing?.interviewCompletedAt,
      });
      if (!parsedIntent.success) {
        return c.json({
          error: "Invalid chapter intent",
          issues: parsedIntent.error.issues,
        }, 400);
      }
      const intent: AuthorChapterIntent = parsedIntent.data;
      const next = upsertChapterIntent(index.intents, intent);
      await saveChapterIntents(bookDir, next);
      return c.json({ ok: true, intent: getChapterIntent(next, chapterNumber) });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.delete("/api/v1/books/:id/chapter-intents/:chapterNumber", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(ctx.state, id);
    const chapterNumber = Number(c.req.param("chapterNumber"));
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    try {
      const bookDir = stateManager.bookDir(id);
      const index = await loadChapterIntents(bookDir);
      const next = removeChapterIntent(index.intents, chapterNumber);
      await saveChapterIntents(bookDir, next);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Chapter Intent Suggestions (rule-based, no LLM) ---

  app.get("/api/v1/books/:id/chapter-intents/:chapterNumber/suggestions", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(ctx.state, id);
    const chapterNumber = Number(c.req.param("chapterNumber"));
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    try {
      const bookDir = stateManager.bookDir(id);
      const suggestions = await generateSuggestions(bookDir, chapterNumber);
      return c.json({ suggestions });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Endpoint Lock Check (M2/U8) ---
  // Reads the author's chapter intent (openingFrame/closingFrame/requiredBeats/forbiddenMoves)
  // and checks whether the written chapter content satisfies those constraints.

  app.get("/api/v1/books/:id/chapters/:chapterNumber/endpoint-check", async (c) => {
    const id = c.req.param("id");
    const chapterNumber = Number(c.req.param("chapterNumber"));
    await assertBookExists(ctx.state, id);
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    try {
      const bookDir = stateManager.bookDir(id);
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");

      // Load chapter intent
      const intentsIdx = await loadChapterIntents(bookDir).catch(() => ({ intents: [] as ReadonlyArray<AuthorChapterIntent> }));
      const intent = getChapterIntent(intentsIdx.intents, chapterNumber);

      // Load chapter content
      const chaptersDir = join(bookDir, "chapters");
      let chapterContent = "";
      try {
        const { readdir: rd } = await import("node:fs/promises");
        const files = await rd(chaptersDir);
        const padded = String(chapterNumber).padStart(4, "0");
        const match = files.find((f) => f.startsWith(padded) && f.endsWith(".md"));
        if (match) {
          chapterContent = await readFile(join(chaptersDir, match), "utf-8");
        }
      } catch { /* no chapters yet */ }

      // Build checks array
      const checks: Array<{ name: string; passed: boolean; detail: string }> = [];
      const lang = "zh"; // could be derived from book config

      if (intent?.openingFrame) {
        const frame = intent.openingFrame.scene;
        const opening = chapterContent.slice(0, 200).toLowerCase();
        const hasOpening = opening.includes(frame.toLowerCase()) ||
          frame.toLowerCase().split(/\s+/).filter((w: string) => w.length > 1).every((w: string) => opening.includes(w));
        checks.push({
          name: "开篇框架",
          passed: hasOpening,
          detail: hasOpening ? "开篇与声明框架一致" : `预期开篇应包含："${frame}"`,
        });
        if (intent.openingFrame.forbiddenOpenings?.length) {
          for (const fb of intent.openingFrame.forbiddenOpenings) {
            const found = opening.includes(fb.toLowerCase());
            checks.push({
              name: `开篇禁止：${fb}`,
              passed: !found,
              detail: found ? "发现禁止的开篇模式" : "未发现禁止模式",
            });
          }
        }
      }

      if (intent?.closingFrame) {
        const frame = intent.closingFrame.scene;
        const closing = chapterContent.slice(-500).toLowerCase();
        const hasClosing = closing.includes(frame.toLowerCase()) ||
          frame.toLowerCase().split(/\s+/).filter((w: string) => w.length > 1).every((w: string) => closing.includes(w));
        checks.push({
          name: "收尾框架",
          passed: hasClosing,
          detail: hasClosing ? "收尾与声明框架一致" : `预期收尾应包含："${frame}"`,
        });
      }

      if (intent?.requiredBeats?.length) {
        for (const beat of intent.requiredBeats) {
          const found = chapterContent.toLowerCase().includes(beat.toLowerCase());
          checks.push({
            name: `必达事件：${beat}`,
            passed: found,
            detail: found ? "事件已达成" : "章节中未发现此事件",
          });
        }
      }

      if (intent?.forbiddenMoves?.length) {
        for (const move of intent.forbiddenMoves) {
          const found = chapterContent.toLowerCase().includes(move.toLowerCase());
          checks.push({
            name: `禁用动作：${move}`,
            passed: !found,
            detail: found ? "章节中发现禁用动作！" : "未发现禁用动作",
          });
        }
      }

      return c.json({
        chapterNumber,
        passed: checks.length > 0 ? checks.every((ch) => ch.passed) : true,
        checks,
        hasIntent: !!intent,
      });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Chapter Intent Interview (rule-based + quantitative triggers) ---

  app.get("/api/v1/books/:id/interview", async (c) => {
    const id = c.req.param("id");
    const chapterNumber = Number(c.req.query("chapter"));
    await assertBookExists(ctx.state, id);
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    try {
      const bookDir = stateManager.bookDir(id);

      // Load existing intent to skip already-answered questions
      const intentsIdx = await loadChapterIntents(bookDir).catch(() => ({ intents: [] as ReadonlyArray<AuthorChapterIntent> }));
      const existingIntent = getChapterIntent(intentsIdx.intents, chapterNumber);

      // Load goals
      const goalsIdx = await loadChapterGoals(bookDir).catch(() => ({ goals: [] as ReadonlyArray<ChapterGoalCard> }));
      const chapterGoal = getChapterGoal(goalsIdx.goals, chapterNumber);

      // Build interview questions
      const questions: Array<{ id: string; question: string; context: string; level: number; prefill?: string }> = [];

      // Level 1: Core (always ask if unanswered)
      if (!existingIntent?.coreNarrative) {
        questions.push({
          id: "core_narrative",
          question: "用一句话说清：这一章在讲什么？",
          context: chapterGoal?.mainConflict
            ? `已设定核心矛盾：「${chapterGoal.mainConflict}」`
            : "还没有设定章节目标",
          level: 1,
        });
      }
      if (!existingIntent?.readerTakeaway) {
        questions.push({
          id: "reader_takeaway",
          question: "读者读完这一章后，你最希望他们感受到什么？",
          context: "思考读者的情感体验——紧张、释然、好奇、愤怒、温暖？",
          level: 1,
        });
      }
      if (!existingIntent?.keyMoment) {
        questions.push({
          id: "key_moment",
          question: "这一章最重要的一个画面或瞬间是什么？",
          context: "如果这一章只能让读者记住一个画面，那是什么？",
          level: 1,
        });
      }

      // Level 2: Scene planning
      if (!existingIntent?.scenes || existingIntent.scenes.length === 0) {
        questions.push({
          id: "scene_count",
          question: "这一章大概有几个场景？主要的场景切换是什么？",
          context: chapterGoal?.location
            ? `目标地点为「${chapterGoal.location}」`
            : "可以用地点切换来划分场景",
          level: 2,
          prefill: chapterGoal?.location ?? undefined,
        });
      }

      // Level 3: Character states
      questions.push({
        id: "character_emotion",
        question: "这一章出场的角色中，谁的情绪变化最大？从什么变为什么？",
        context: "角色的情绪变化是推动故事的情感引擎",
        level: 3,
      });

      // Level 4: Constraints
      questions.push({
        id: "must_avoid",
        question: "这一章绝对不能出现什么？",
        context: "比如：主角不能示弱、秘密不能暴露、某角色不能出场",
        level: 4,
      });

      // Quantitative creative triggers
      const triggers: Array<{ type: string; message: string; severity: "info" | "warning" | "critical" }> = [];

      // Trigger: overdue hooks
      try {
        const { readFile } = await import("node:fs/promises");
        const { join } = await import("node:path");
        const hooksPath = join(bookDir, "story", "state", "hooks.json");
        const raw = await readFile(hooksPath, "utf-8");
        const hooks = (JSON.parse(raw) as { hooks?: Array<{ hookId: string; status: string; halfLifeChapters?: number; lastAdvancedChapter: number }> }).hooks ?? [];
        const overdue = hooks.filter((h) =>
          h.status !== "resolved" && h.halfLifeChapters &&
          (chapterNumber - h.lastAdvancedChapter) > h.halfLifeChapters
        );
        if (overdue.length > 0) {
          triggers.push({
            type: "hooks_overdue",
            message: `${overdue.length} 条伏笔已逾期：${overdue.map((h) => h.hookId).join("、")}`,
            severity: overdue.length >= 3 ? "critical" : "warning",
          });
        }
        const activeCount = hooks.filter((h) => h.status !== "resolved").length;
        if (activeCount === 0) {
          triggers.push({
            type: "hooks_empty",
            message: "尚无活跃伏笔——建议在本章埋下至少一条新伏笔",
            severity: "info",
          });
        }
      } catch { /* hooks.json not found */ }

      // Trigger: chapter goal status
      if (!chapterGoal) {
        triggers.push({
          type: "goal_missing",
          message: "未设定本章目标——建议先在「目标」面板填写核心矛盾和必达事件",
          severity: "warning",
        });
      }

      // Trigger: first chapter guidance
      if (chapterNumber === 1) {
        triggers.push({
          type: "first_chapter",
          message: "这是第一章——建议在此章建立世界观基调、引入主角、埋下至少一条伏笔",
          severity: "info",
        });
      }

      // Trigger: chapter interval — check for consecutive same-type chapters
      try {
        const { readFile } = await import("node:fs/promises");
        const { join } = await import("node:path");
        const summariesPath = join(bookDir, "story", "chapter_summaries.md");
        const raw = await readFile(summariesPath, "utf-8");
        // Count how many consecutive "过渡" or "transition" chapters precede this one
        const lines = raw.split("\n");
        let consecutiveTransition = 0;
        for (const line of lines.reverse()) {
          if (line.includes("过渡") || line.includes("transition")) consecutiveTransition++;
          else break;
        }
        if (consecutiveTransition >= 3) {
          triggers.push({
            type: "rhythm_monotony",
            message: `连续 ${consecutiveTransition} 章为过渡型——建议本章安排「高潮」或「转折」打破节奏单调`,
            severity: "warning",
          });
        }
      } catch { /* no summaries yet */ }

      return c.json({ chapterNumber, questions, triggers });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Event Chain ---

  app.get("/api/v1/books/:id/event-chain", async (c) => {
    const id = c.req.param("id");
    const chapterNumber = Number(c.req.query("chapter"));
    await assertBookExists(ctx.state, id);
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    try {
      const bookDir = stateManager.bookDir(id);
      const { readArtifactIndex, readLatestArtifact } = await import("@actalk/inkos-core");
      const artifactDir = join(bookDir, "story", "runtime", `chapter-${String(chapterNumber).padStart(4, "0")}`);
      const latest = await readLatestArtifact(artifactDir, "event-chain");
      if (!latest) {
        return c.json({ chain: null, message: "No event chain generated yet. Use POST to extract." });
      }
      const chain = JSON.parse(latest.content);
      return c.json({ chain });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/event-chain/extract", async (c) => {
    const id = c.req.param("id");
    const chapterNumber = Number(c.req.query("chapter"));
    await assertBookExists(ctx.state, id);
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    try {
      const bookDir = stateManager.bookDir(id);
      const { readFile, readdir } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const { saveArtifactAutoVersion, EventChainExtractor } = await import("@actalk/inkos-core");

      // Gather source files
      const sourcesDir = join(bookDir, "story", "sources");
      const sourceFiles: Array<{ path: string; content: string; frontmatter: Record<string, unknown> }> = [];
      try {
        const files = await readdir(sourcesDir);
        for (const file of files) {
          if (!file.endsWith(".md")) continue;
          const raw = await readFile(join(sourcesDir, file), "utf-8");
          const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
          const frontmatter: Record<string, unknown> = {};
          if (fmMatch) {
            for (const line of fmMatch[1].split("\n")) {
              const [k, ...v] = line.split(":");
              if (k && v.length > 0) frontmatter[k.trim()] = v.join(":").trim();
            }
          }
          const body = fmMatch ? raw.slice(fmMatch[0].length) : raw;
          sourceFiles.push({ path: file, content: body, frontmatter });
        }
      } catch { /* no sources dir */ }

      // Read known characters
      const characterDir = join(bookDir, "story", "characters");
      const characters: Array<{ id: string; name: string; traits?: string[] }> = [];
      try {
        const charFiles = await readdir(characterDir);
        for (const file of charFiles) {
          if (!file.endsWith(".json")) continue;
          const charRaw = await readFile(join(characterDir, file), "utf-8");
          const charData = JSON.parse(charRaw) as { id?: string; name?: string; traits?: string[] };
          if (charData.id && charData.name) {
            characters.push({ id: charData.id, name: charData.name, traits: charData.traits });
          }
        }
      } catch { /* no characters dir */ }

      // M4: Use the real EventChainExtractor Agent (frontmatter mode, zero LLM cost)
      const extractor = new EventChainExtractor({} as never);
      const result = await extractor.execute({
        sources: sourceFiles.map((src) => ({
          path: src.path,
          content: src.content,
          frontmatter: src.frontmatter,
        })),
        chapterNumber,
        characters,
        useLlm: false,
      });

      const chain = {
        bookId: id,
        chapterNumber,
        events: result.events,
        generatedAt: new Date().toISOString(),
        confidence: result.confidence,
        warnings: result.warnings,
      };
      const artifactDir = join(bookDir, "story", "runtime", `chapter-${String(chapterNumber).padStart(4, "0")}`);
      await saveArtifactAutoVersion(artifactDir, "event-chain", JSON.stringify(chain, null, 2));

      return c.json({ chain });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  
}
