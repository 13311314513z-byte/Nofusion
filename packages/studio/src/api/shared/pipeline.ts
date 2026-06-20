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
