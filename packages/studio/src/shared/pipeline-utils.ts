/**
 * Shared pipeline utility — creates a PipelineRunner, executes the callback,
 * and disposes the pipeline when done.
 */
import { PipelineRunner, type PipelineConfig } from "@actalk/inkos-core";

export async function withPipeline<T>(
  label: string,
  config: PipelineConfig,
  fn: (pipeline: PipelineRunner) => Promise<T>,
): Promise<T> {
  void label; // reserved for future telemetry
  const pipeline = new PipelineRunner(config);
  try {
    return await fn(pipeline);
  } finally {
    pipeline.dispose();
  }
}
