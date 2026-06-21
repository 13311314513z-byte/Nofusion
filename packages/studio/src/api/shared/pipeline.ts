import { PipelineRunner, type PipelineConfig } from "@actalk/inkos-core";

/**
 * Create a PipelineRunner, execute a function, and dispose the pipeline.
 * Shared between server.ts and route modules.
 *
 * @param ttlMs timeout in ms, 0 = no timeout
 */
export async function withPipeline<T>(
  label: string,
  config: PipelineConfig,
  fn: (pipeline: PipelineRunner) => Promise<T>,
  ttlMs = 5 * 60_000,
): Promise<T> {
  const pipeline = new PipelineRunner(config);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = ttlMs > 0
    ? new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Pipeline "${label}" timed out after ${ttlMs}ms`));
        }, ttlMs);
      })
    : undefined;

  try {
    const result = timeoutPromise
      ? await Promise.race([fn(pipeline), timeoutPromise])
      : await fn(pipeline);
    return result as T;
  } finally {
    if (timer) clearTimeout(timer);
    if (typeof (pipeline as any).dispose === "function") {
      (pipeline as any).dispose();
    }
  }
}

// ─── C7 PipelinePool (lazy, production-only) ─────────────────────────────────

let _pool: import("@actalk/inkos-core").PipelinePool | undefined;
let _poolDrained = false;
let _poolConfigFactory: (() => PipelineConfig) | undefined;
let _poolOptions: import("@actalk/inkos-core").PipelinePoolOptions | undefined;

/** Store config for lazy pool creation. Called from startStudioServer. */
export function setPipelinePoolConfig(
  configFactory: () => PipelineConfig,
  options?: import("@actalk/inkos-core").PipelinePoolOptions,
): void {
  _poolConfigFactory = configFactory;
  _poolOptions = options;
  _poolDrained = false;
}

/** Drain the pool on shutdown. */
export function drainPipelinePool(): void {
  if (_pool) _pool.drain();
  _pool = undefined;
  _poolDrained = true;
}

/** Get or lazily create pool. Returns undefined when not configured (tests). */
async function _ensurePool(): Promise<import("@actalk/inkos-core").PipelinePool | undefined> {
  if (_poolDrained || !_poolConfigFactory) return undefined;
  if (_pool) return _pool;
  try {
    const { PipelinePool } = await import("@actalk/inkos-core");
    if (PipelinePool) _pool = new PipelinePool(_poolConfigFactory, _poolOptions);
  } catch { /* pool not available — fall back to per-call PipelineRunner */ }
  return _pool;
}

/**
 * Like withPipeline but uses the pool when available.
 * Separate export so existing withPipeline callers are unaffected.
 */
export async function withPooledPipeline<T>(
  label: string,
  config: PipelineConfig,
  fn: (pipeline: PipelineRunner) => Promise<T>,
  ttlMs = 5 * 60_000,
): Promise<T> {
  const p = await _ensurePool();
  const pipeline = p ? await p.acquire() : new PipelineRunner(config);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = ttlMs > 0
    ? new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Pipeline "${label}" timed out after ${ttlMs}ms`)), ttlMs);
      })
    : undefined;
  try {
    const result = timeoutPromise ? await Promise.race([fn(pipeline), timeoutPromise]) : await fn(pipeline);
    return result as T;
  } finally {
    if (timer) clearTimeout(timer);
    if (p) { p.release(pipeline); }
    else { if (typeof (pipeline as any).dispose === "function") (pipeline as any).dispose(); }
  }
}
