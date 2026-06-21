/**
 * Client-only API utilities — depends on browser APIs (window, AbortController).
 * DO NOT import from server code.
 * Extracted from shared/api-utils.ts (C10-ext: server/client boundary fix).
 */
import { buildApiUrl } from "./api-utils.js";
import { API_INVALIDATE_EVENT, type ApiInvalidateDetail } from "./api-utils.js";

export { API_INVALIDATE_EVENT, type ApiInvalidateDetail };

// ─── Invalidation paths ─────────────────────────────────────────────────────

export function deriveInvalidationPaths(path: string): ReadonlyArray<string> {
  const normalized = buildApiUrl(path);
  if (!normalized) return [];

  if (normalized === "/api/v1/books/create") return ["/api/v1/books"];
  if (normalized === "/api/v1/project") return ["/api/v1/project"];
  if (normalized.startsWith("/api/v1/project/")) return ["/api/v1/project", normalized];

  const bookAction = normalized.match(/^\/api\/v1\/books\/([^/]+)\/(write-next|draft)$/);
  if (bookAction) return ["/api/v1/books", `/api/v1/books/${bookAction[1]}`];

  const chapterAction = normalized.match(/^\/api\/v1\/books\/([^/]+)\/chapters\/\d+\/(approve|reject)$/);
  if (chapterAction) return ["/api/v1/books", `/api/v1/books/${chapterAction[1]}`];

  const chapterSave = normalized.match(/^\/api\/v1\/books\/([^/]+)\/chapters\/(\d+)$/);
  if (chapterSave) return [`/api/v1/books`, `/api/v1/books/${chapterSave[1]}`, normalized];

  const truthWrite = normalized.match(/^\/api\/v1\/books\/([^/]+)\/truth\/(.+)$/);
  if (truthWrite) return [`/api/v1/books/${truthWrite[1]}/truth`, normalized];

  const roleDelete = normalized.match(/^\/api\/v1\/books\/([^/]+)\/roles\/([^/]+)$/);
  if (roleDelete) return [`/api/v1/books`, `/api/v1/books/${roleDelete[1]}`, `/api/v1/books/${roleDelete[1]}/roles`];

  const sourceDelete = normalized.match(/^\/api\/v1\/books\/([^/]+)\/sources\/([^/]+)$/);
  if (sourceDelete) return [`/api/v1/books/${sourceDelete[1]}/sources`];

  if (/^\/api\/v1\/daemon\/(start|stop)$/.test(normalized)) return ["/api/v1/daemon"];
  return [];
}

export function invalidateApiPaths(paths: ReadonlyArray<string>): void {
  if (!paths.length || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ApiInvalidateDetail>(API_INVALIDATE_EVENT, {
    detail: { paths: [...new Set(paths)] },
  }));
}

// ─── Request dedup (client-side GET dedup via AbortController) ───────────────

const inFlightGetControllers = new Map<string, AbortController>();

export function dedupGetRequest(url: string): AbortSignal {
  const existing = inFlightGetControllers.get(url);
  if (existing) existing.abort();
  const controller = new AbortController();
  inFlightGetControllers.set(url, controller);
  return controller.signal;
}

export function releaseDedupGetRequest(url: string): void {
  inFlightGetControllers.delete(url);
}
