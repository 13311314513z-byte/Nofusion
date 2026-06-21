/**
 * Shared pipeline utility — creates a PipelineRunner, executes the callback,
 * and disposes the pipeline when done.
 */
import { PipelineRunner } from "@actalk/inkos-core";

export async function withPipeline<T>(
  label: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any,
  fn: (pipeline: PipelineRunner) => Promise<T>,
): Promise<T> {
  void label; // reserved for future telemetry
  const pipeline = new PipelineRunner(config);
  try {
    return await fn(pipeline);
  } finally {
    if (typeof (pipeline as unknown as Record<string, unknown>).dispose === "function") {
      ((pipeline as unknown as Record<string, unknown>).dispose as () => void)();
    }
  }
}
