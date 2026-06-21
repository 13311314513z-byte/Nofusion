/**
 * API utilities — server-safe, zero browser/React dependencies.
 * Safe for import by both client (vite) and server (tsconfig.server.json).
 * Client-only functions (window, AbortController dedup) → shared/api-client-utils.ts
 * Extracted from hooks/use-api.ts (C10: P2-4).  Boundary fix: 2026-06-20.
 */
export const BASE = "/api/v1";
export const API_INVALIDATE_EVENT = "inkos:api-invalidate";
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

/** Timeout for long-running AI write endpoints. */
export const FETCH_TIMEOUT_WRITE_MS = 300_000;
/** Timeout for import/scan endpoints. */
export const FETCH_TIMEOUT_IMPORT_MS = 600_000;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ApiInvalidateDetail {
  readonly paths: ReadonlyArray<string>;
}

// ─── URL builders ────────────────────────────────────────────────────────────

export function buildApiUrl(path: string | null): string | null {
  const normalized = String(path ?? "").trim();
  if (!normalized) return null;
  if (normalized.startsWith(`${BASE}/`) || normalized === BASE) return normalized;
  return normalized.startsWith("/") ? `${BASE}${normalized}` : `${BASE}/${normalized}`;
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

async function readErrorMessage(res: Response): Promise<string> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const json = await res.json() as { error?: { message?: string } | string };
      if (typeof json === "object" && json !== null) {
        if ("error" in json) {
          const e = (json as { error: { message?: string } | string }).error;
          if (typeof e === "string" && e.trim()) return e;
          if (typeof e === "object" && e !== null && typeof (e as { message?: string }).message === "string") {
            return (e as { message: string }).message;
          }
        }
      }
    } catch { /* fall through */ }
  }
  return `${res.status} ${res.statusText}`.trim();
}

export async function fetchJson<T>(
  path: string,
  init: RequestInit = {},
  deps?: { readonly fetchImpl?: typeof fetch; readonly signal?: AbortSignal; readonly timeoutMs?: number },
): Promise<T> {
  const url = buildApiUrl(path);
  if (!url) throw new Error("API path is required");

  const timeoutMs = deps?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const timeoutSignal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
  const signals = [deps?.signal, timeoutSignal].filter((s): s is AbortSignal => !!s);
  const combinedSignal = signals.length > 1
    ? (AbortSignal as { any?(signals: AbortSignal[]): AbortSignal }).any?.(signals) ?? signals[0]
    : signals[0];

  const fetchImpl = deps?.fetchImpl ?? fetch;
  const res = await fetchImpl(url, { ...init, signal: combinedSignal });
  if (!res.ok) throw new Error(await readErrorMessage(res));
  if (res.status === 204) return undefined as T;

  const bodyText = await res.text();
  if (!bodyText.trim()) return undefined as T;

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(`Expected JSON response but got ${contentType || "unknown"}. Status: ${res.status}. Body preview: ${bodyText.slice(0, 200)}`);
  }
  try { return JSON.parse(bodyText) as T; }
  catch (jsonErr) { throw new Error(`Failed to parse JSON response: ${jsonErr instanceof Error ? jsonErr.message : String(jsonErr)}. Status: ${res.status}. Body preview: ${bodyText.slice(0, 200)}`); }
}

/** Shorthand for POST requests (server-safe — no path invalidation). */
export async function postApi<T = unknown>(path: string, body?: unknown): Promise<T> {
  return fetchJson<T>(path, {
    method: "POST",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
