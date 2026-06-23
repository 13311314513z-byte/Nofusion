import {
compareWithAuthorProfile,
createLLMClient,
extractDocumentChunked,
extractDocumentFromText,
generateAdjustmentPlan,
getAuthorProfile,
loadProjectConfig,
MAX_CHARS,
rewriteWithAuthorProfile,
type AuthorStyleProfile
} from "@actalk/inkos-core";
import type { ServerContext } from "../server-context.js";
import { withPipeline } from "../shared/pipeline.js";
import {
assertSafeStyleImportTarget,
extractHtmlTitle,
isTextStyleFileType,
parseSafeStyleImportUrl,
readStyleImportBody
} from "../shared/style-import-guards.js";
import {
AdjustmentPlanRequestSchema,
CompareRequestSchema,
DiagnosticsRequestSchema,
InspectRequestSchema,MAX_PREPROCESS_TEXT_CHARS,
PreprocessRequestSchema,RelayoutRequestSchema,
RewritePreviewRequestSchema,
} from "../style-schemas.js";

// ── Constants ──

/**
 * Style analysis, comparison, rewrite, import, and style library routes.
 */
export function registerStyleRoutes(ctx: ServerContext): void {
  const { app, root, state: _stateManager, broadcast: _broadcast, buildPipelineConfig: _buildPipelineConfig, loadCurrentProjectConfig: _loadCurrentProjectConfig } = ctx;

  async function _assertBookExists(state: ServerContext["state"], bookId: string): Promise<void> {
    try {
      await state.loadBookConfig(bookId);
    } catch {
      throw new Error(`Book not found: ${bookId}`);
    }
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
      // 濡傛灉璇锋眰浜嗘寚瀹氬垎鐗囷紝浣跨敤鍒嗙墖鎻愬彇鍣?
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

  
}
