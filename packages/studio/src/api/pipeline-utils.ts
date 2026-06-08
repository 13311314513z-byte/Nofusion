/**
 * Pipeline 工具函数
 *
 * 提供 `withPipeline` 包装器，自动管理 PipelineRunner 的生命周期，
 * 确保每次使用后调用 `dispose()` 释放 LLM 客户端，避免内存泄漏。
 */

import { PipelineRunner, globalRegistry, type PipelineConfig } from "@actalk/inkos-core";

/**
 * 创建 PipelineRunner，自动注册到全局资源表，
 * 在 promise 完成/失败后自动 dispose。
 *
 * @param label   - 用途标签（用于日志和资源跟踪）
 * @param config  - Pipeline 配置
 * @param fn      - 使用 pipeline 的异步函数
 * @param ttlMs   - 可选的 TTL（默认 5 分钟，超时自动清理）
 * @returns fn 的返回值
 */
export async function withPipeline<T>(
  label: string,
  config: PipelineConfig,
  fn: (pipeline: PipelineRunner) => Promise<T>,
  ttlMs = 5 * 60_000,
): Promise<T> {
  const pipeline = new PipelineRunner(config);

  // 兼容测试场景：globalRegistry 可能被 mock 为 undefined
  if (typeof globalRegistry?.register === "function") {
    const id = `pipeline-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    globalRegistry.register({
      id,
      type: "pipeline",
      dispose: () => { /* disposed in finally */ },
      createdAt: Date.now(),
      ttlMs,
      meta: { label },
    });

    try {
      const result = await fn(pipeline);
      return result;
    } finally {
      if (typeof (pipeline as any).dispose === "function") {
        (pipeline as any).dispose();
      }
      globalRegistry.unregister(id);
    }
  }

  // 无 globalRegistry 时的退化路径（测试环境）
  try {
    const result = await fn(pipeline);
    return result;
  } finally {
    if (typeof (pipeline as any).dispose === "function") {
      (pipeline as any).dispose();
    }
  }
}
