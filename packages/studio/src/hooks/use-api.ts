import { useState, useEffect, useCallback } from "react";
import { localizeKnownRuntimeMessage } from "../lib/error-copy";

const BASE = "/api/v1";
const API_INVALIDATE_EVENT = "inkos:api-invalidate";

interface ApiInvalidateDetail {
  readonly paths: ReadonlyArray<string>;
}

export function buildApiUrl(path: string | null): string | null {
  const normalized = String(path ?? "").trim();
  if (!normalized) return null;
  if (normalized.startsWith(`${BASE}/`) || normalized === BASE) {
    return normalized;
  }
  return normalized.startsWith("/") ? `${BASE}${normalized}` : `${BASE}/${normalized}`;
}

export function deriveInvalidationPaths(path: string): ReadonlyArray<string> {
  const normalized = buildApiUrl(path);
  if (!normalized) return [];

  if (normalized === "/api/v1/books/create") {
    return ["/api/v1/books"];
  }

  if (normalized === "/api/v1/project") {
    return ["/api/v1/project"];
  }

  if (normalized.startsWith("/api/v1/project/")) {
    return ["/api/v1/project", normalized];
  }

  const bookAction = normalized.match(/^\/api\/v1\/books\/([^/]+)\/(write-next|draft)$/);
  if (bookAction) {
    return ["/api/v1/books", `/api/v1/books/${bookAction[1]}`];
  }

  const chapterAction = normalized.match(/^\/api\/v1\/books\/([^/]+)\/chapters\/\d+\/(approve|reject)$/);
  if (chapterAction) {
    return ["/api/v1/books", `/api/v1/books/${chapterAction[1]}`];
  }

  // PUT /books/:id/chapters/:num — invalidate chapter detail + book detail
  const chapterSave = normalized.match(/^\/api\/v1\/books\/([^/]+)\/chapters\/(\d+)$/);
  if (chapterSave) {
    return [`/api/v1/books`, `/api/v1/books/${chapterSave[1]}`, normalized];
  }

  // PUT /books/:id/truth/:file — invalidate truth detail + truth list
  const truthWrite = normalized.match(/^\/api\/v1\/books\/([^/]+)\/truth\/(.+)$/);
  if (truthWrite) {
    return [`/api/v1/books/${truthWrite[1]}/truth`, normalized];
  }

  // DELETE /books/:id/roles/:roleId — invalidate roles list
  const roleDelete = normalized.match(/^\/api\/v1\/books\/([^/]+)\/roles\/([^/]+)$/);
  if (roleDelete) {
    return [`/api/v1/books`, `/api/v1/books/${roleDelete[1]}`, `/api/v1/books/${roleDelete[1]}/roles`];
  }

  // DELETE /books/:id/sources/:sourceId — invalidate sources list
  const sourceDelete = normalized.match(/^\/api\/v1\/books\/([^/]+)\/sources\/([^/]+)$/);
  if (sourceDelete) {
    return [`/api/v1/books/${sourceDelete[1]}/sources`];
  }

  if (/^\/api\/v1\/daemon\/(start|stop)$/.test(normalized)) {
    return ["/api/v1/daemon"];
  }

  return [];
}

export function invalidateApiPaths(paths: ReadonlyArray<string>): void {
  if (!paths.length || typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent<ApiInvalidateDetail>(API_INVALIDATE_EVENT, {
    detail: { paths: [...new Set(paths)] },
  }));
}

// P1-8: Request dedup — cancel in-flight GET requests when same URL is re-requested
const inFlightGetControllers = new Map<string, AbortController>();

function dedupGetRequest(url: string): AbortSignal {
  const existing = inFlightGetControllers.get(url);
  if (existing) {
    existing.abort(); // Cancel previous in-flight request
  }
  const controller = new AbortController();
  inFlightGetControllers.set(url, controller);
  return controller.signal;
}

function releaseDedupGetRequest(url: string): void {
  inFlightGetControllers.delete(url);
}

async function readErrorMessage(res: Response): Promise<string> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const json = await res.json() as { error?: unknown };
      if (typeof json.error === "string" && json.error.trim()) {
        return localizeKnownRuntimeMessage(json.error);
      }
      if (
        json.error &&
        typeof json.error === "object" &&
        "message" in json.error &&
        typeof (json.error as { message?: unknown }).message === "string" &&
        (json.error as { message: string }).message.trim()
      ) {
        return localizeKnownRuntimeMessage((json.error as { message: string }).message);
      }
    } catch {
      // fall through
    }
  }
  return localizeKnownRuntimeMessage(`${res.status} ${res.statusText}`.trim());
}

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

/** Timeout for long-running AI write endpoints (write-next/draft/rewrite are fire-and-forget, so 30s is fine for those). */
export const FETCH_TIMEOUT_WRITE_MS = 300_000;
/** Timeout for import/scan endpoints that may process large inputs. */
export const FETCH_TIMEOUT_IMPORT_MS = 600_000;

export async function fetchJson<T>(
  path: string,
  init: RequestInit = {},
  deps?: { readonly fetchImpl?: typeof fetch; readonly signal?: AbortSignal; readonly timeoutMs?: number },
): Promise<T> {
  const url = buildApiUrl(path);
  if (!url) {
    throw new Error("API path is required");
  }

  // Tiered timeout: per-call override > default 30s.  Pass 0 to disable timeout.
  const timeoutMs = deps?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const timeoutSignal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
  const signals = [deps?.signal, timeoutSignal].filter((s): s is AbortSignal => !!s);
  const combinedSignal = signals.length > 1
    ? (AbortSignal as any).any?.(signals) ?? signals[0]
    : signals[0];

  const fetchImpl = deps?.fetchImpl ?? fetch;
  const res = await fetchImpl(url, { ...init, signal: combinedSignal });

  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }

  if (res.status === 204) {
    return undefined as T;
  }

  // Read body as text FIRST — Response body can only be consumed once.
  const bodyText = await res.text();
  if (!bodyText.trim()) {
    return undefined as T;
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    // Non-JSON response (e.g. HTML from proxy/CDN error page)
    throw new Error(`Expected JSON response but got ${contentType || "unknown"}. Status: ${res.status}. Body preview: ${bodyText.slice(0, 200)}`);
  }

  try {
    return JSON.parse(bodyText) as T;
  } catch (jsonErr) {
    throw new Error(`Failed to parse JSON response: ${jsonErr instanceof Error ? jsonErr.message : String(jsonErr)}. Status: ${res.status}. Body preview: ${bodyText.slice(0, 200)}`);
  }
}

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!path) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    const url = buildApiUrl(path);
    if (!url) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    // P1-8: Cancel in-flight GET request for the same URL
    const dedupSignal = dedupGetRequest(url);

    setLoading(true);
    setError(null);
    try {
      const json = await fetchJson<T>(url, {}, { signal: dedupSignal });
      // Only update state if the request wasn't aborted
      if (!dedupSignal.aborted) {
        setData(json);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      releaseDedupGetRequest(url);
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    const url = buildApiUrl(path);
    if (!url || typeof window === "undefined") {
      return;
    }

    const handleInvalidate = (event: Event) => {
      const detail = (event as CustomEvent<ApiInvalidateDetail>).detail;
      if (!detail?.paths.includes(url)) return;
      void refetch();
    };

    window.addEventListener(API_INVALIDATE_EVENT, handleInvalidate);
    return () => {
      window.removeEventListener(API_INVALIDATE_EVENT, handleInvalidate);
    };
  }, [path, refetch]);

  return { data, loading, error, refetch, mutate: setData };
}

/** Actionable error — extends a string error with retry/fallback options. */
export interface ActionableError {
  readonly message: string;
  readonly canRetry: boolean;
  readonly retry: () => void;
  readonly fallbackAction?: { label: string; action: () => void };
}

/** Wrap a useApi result's error + refetch into an action-oriented error object. */
export function useActionableError(
  error: string | null,
  refetch: () => void,
  fallbackAction?: { label: string; action: () => void },
): ActionableError | null {
  if (!error) return null;
  return {
    message: error,
    canRetry: true,
    retry: refetch,
    fallbackAction,
  };
}

export async function postApi<T>(path: string, body?: unknown): Promise<T> {
  const result = await fetchJson<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  invalidateApiPaths(deriveInvalidationPaths(path));
  return result;
}

export async function putApi<T>(path: string, body?: unknown): Promise<T> {
  const result = await fetchJson<T>(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  invalidateApiPaths(deriveInvalidationPaths(path));
  return result;
}

// ── Style API helpers ──────────────────────────────────────────────────────

/** 修辞改写 — 返回生成的改写 prompt */
export function rewriteRhetoric(text: string, categories: ReadonlyArray<string>): Promise<{ prompt: string }> {
  return postApi("/style/rhetoric/rewrite", { text, categories });
}

/** 修辞感知提示注入 */
export function fetchRhetoricAwarePrompt(basePrompt: string, contextText: string): Promise<{ prompt: string }> {
  return postApi("/style/rhetoric/aware-prompt", { basePrompt, contextText });
}

/** 段落去重 */
export function dedupParagraphs(text: string, threshold?: number, minLength?: number): Promise<{ duplicateGroups: unknown[]; similarGroups: unknown[] }> {
  return postApi("/style/paragraph/dedup", { text, threshold, minLength });
}

/** 可读性评分 */
export function fetchReadabilityScore(text: string, lang?: string): Promise<import("@actalk/inkos-core").ReadabilityScore> {
  return postApi("/style/readability/score", { text, language: lang ?? "zh" });
}

/** 搜索作者作品（网络搜索） */
export function searchAuthorWork(authorName: string, language?: string): Promise<{ results: ReadonlyArray<{ title: string; url: string; snippet: string }> }> {
  return postApi("/style/authors/search", { authorName, language });
}

/** 拉取作者作品 */
export function fetchAuthorWork(url: string, maxChars?: number): Promise<{ content: string }> {
  return postApi("/style/authors/fetch", { url, maxChars });
}

/** 写入作者样本 */
export function writeAuthorSample(params: {
  authorId: string;
  authorName: string;
  sourceUrl: string;
  fetchedAt: string;
  content: string;
  charCount: number;
}): Promise<{ filePath: string }> {
  return postApi("/style/authors/samples/write", params);
}
