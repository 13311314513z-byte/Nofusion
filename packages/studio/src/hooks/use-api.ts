/**
 * Client-only React hook for API data fetching and mutation.
 * Server-safe utilities → ../shared/api-utils.ts
 * Client-only utilities → ../shared/api-client-utils.ts
 * C10 (P2-4) + boundary fix (2026-06-20).
 */
import { useState, useEffect, useCallback } from "react";
import {
  buildApiUrl as _buildApiUrl,
  fetchJson as _fetchJson,
  API_INVALIDATE_EVENT as _API_INVALIDATE_EVENT,
  type ApiInvalidateDetail,
} from "../shared/api-utils.js";
import {
  dedupGetRequest as _dedupGetRequest,
  releaseDedupGetRequest as _releaseDedupGetRequest,
  deriveInvalidationPaths as _deriveInvalidationPaths,
  invalidateApiPaths as _invalidateApiPaths,
} from "../shared/api-client-utils.js";

// Re-export: server-safe from api-utils
export {
  buildApiUrl,
  fetchJson,
  FETCH_TIMEOUT_WRITE_MS,
  FETCH_TIMEOUT_IMPORT_MS,
  BASE,
  API_INVALIDATE_EVENT,
} from "../shared/api-utils.js";
// Re-export: client-only from api-client-utils
export {
  deriveInvalidationPaths,
  invalidateApiPaths,
  dedupGetRequest,
  releaseDedupGetRequest,
} from "../shared/api-client-utils.js";

export type { ApiInvalidateDetail } from "../shared/api-utils.js";

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!path) { setData(null); setError(null); setLoading(false); return; }
    const url = _buildApiUrl(path);
    if (!url) { setData(null); setError(null); setLoading(false); return; }

    const dedupSignal = _dedupGetRequest(url);
    setLoading(true);
    setError(null);
    try {
      const json = await _fetchJson<T>(url, {}, { signal: dedupSignal });
      if (!dedupSignal.aborted) setData(json);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      _releaseDedupGetRequest(url);
      setLoading(false);
    }
  }, [path]);

  useEffect(() => { refetch(); }, [refetch]);

  useEffect(() => {
    const url = _buildApiUrl(path);
    if (!url || typeof window === "undefined") return;
    const handleInvalidate = (event: Event) => {
      const detail = (event as CustomEvent<ApiInvalidateDetail>).detail;
      if (!detail?.paths.includes(url)) return;
      void refetch();
    };
    window.addEventListener(_API_INVALIDATE_EVENT, handleInvalidate);
    return () => { window.removeEventListener(_API_INVALIDATE_EVENT, handleInvalidate); };
  }, [path, refetch]);

  return { data, loading, error, refetch, mutate: setData };
}

export interface ActionableError {
  readonly message: string;
  readonly canRetry: boolean;
  readonly retry: () => void;
  readonly fallbackAction?: { label: string; action: () => void };
}

export function useActionableError(
  error: string | null, refetch: () => void,
  fallbackAction?: { label: string; action: () => void },
): ActionableError | null {
  if (!error) return null;
  return { message: error, canRetry: true, retry: refetch, fallbackAction };
}


export async function postApi<T>(path: string, body?: unknown): Promise<T> {
  const result = await _fetchJson<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  _invalidateApiPaths(_deriveInvalidationPaths(path));
  return result;
}

export async function putApi<T>(path: string, body?: unknown): Promise<T> {
  const result = await _fetchJson<T>(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  _invalidateApiPaths(_deriveInvalidationPaths(path));
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
