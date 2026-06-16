/**
 * API Response Envelope — standardized JSON response wrapper.
 *
 * All API endpoints SHOULD wrap responses in this envelope so frontend
 * consumers can uniformly handle success/error states. The envelope
 * follows the pattern: { ok: boolean, data?: T, error?: string, meta?: Meta }
 *
 * @module
 */

/** Standard API response envelope. */
export interface ApiEnvelope<T = unknown> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly meta?: ApiMeta;
}

/** Optional metadata attached to every response. */
export interface ApiMeta {
  /** ISO timestamp of response generation. */
  readonly timestamp: string;
  /** Request duration in milliseconds. */
  readonly durationMs?: number;
  /** Pagination cursor (if applicable). */
  readonly cursor?: string;
  /** Total count (if applicable). */
  readonly total?: number;
}

/** Build a success envelope. */
export function ok<T>(data: T, meta?: Partial<ApiMeta>): ApiEnvelope<T> {
  return {
    ok: true,
    data,
    meta: { timestamp: new Date().toISOString(), ...meta },
  };
}

/** Build an error envelope. */
export function err(error: string, meta?: Partial<ApiMeta>): ApiEnvelope<never> {
  return {
    ok: false,
    error,
    meta: { timestamp: new Date().toISOString(), ...meta },
  };
}

/** Type guard to check if a response is an ApiEnvelope. */
export function isApiEnvelope(value: unknown): value is ApiEnvelope {
  if (typeof value !== "object" || value === null) return false;
  return "ok" in value && typeof (value as Record<string, unknown>).ok === "boolean";
}

/**
 * Transforms an existing raw server response into the standard envelope.
 * Use this as a drop-in wrapper in Hono route handlers.
 *
 * @example
 * // Instead of: return c.json({ books })
 * // Use:        return c.json(apiOk({ books }))
 */
export function wrapResponse<T>(data: T): ApiEnvelope<T> {
  return ok(data);
}

export function wrapError(error: string): ApiEnvelope<never> {
  return err(error);
}
