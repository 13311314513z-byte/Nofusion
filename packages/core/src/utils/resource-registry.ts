/**
 * ResourceRegistry — 全局资源注册表
 *
 * 统一管理所有需要释放的资源（PipelineRunner、定时器、SSE 连接、后台任务等），
 * 提供 disposeAll / abortAll 接口，确保进程退出或资源过期时统一清理。
 *
 * @example
 * ```ts
 * import { globalRegistry } from "./resource-registry.js";
 *
 * // 注册一个 pipeline 资源
 * const id = `pipeline-${label}-${Date.now()}`;
 * globalRegistry.register({ id, type: "pipeline", dispose: () => pipeline.dispose(), createdAt: Date.now() });
 *
 * // 使用完毕
 * globalRegistry.unregister(id);
 *
 * // 进程退出时
 * globalRegistry.disposeAll();
 * ```
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Resource {
  /** 全局唯一标识，建议 `${type}-${purpose}-${timestamp}` */
  readonly id: string;
  /** 资源类型，用于监控和分类清理 */
  readonly type: "pipeline" | "timer" | "sse" | "task";
  /** 释放函数，同步或异步 */
  readonly dispose: () => void | Promise<void>;
  /** 创建时间戳（ms） */
  readonly createdAt: number;
  /** 可选 TTL，超过后自动释放 */
  readonly ttlMs?: number;
  /** 可选的附加元数据（日志/监控用） */
  readonly meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class ResourceRegistry {
  private resources = new Map<string, Resource>();
  private cleanupTimer: NodeJS.Timeout;

  constructor() {
    this.cleanupTimer = setInterval(() => this.scavenge(), 60_000);
    this.cleanupTimer.unref();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** 注册一个资源 */
  register(resource: Resource): void {
    this.resources.set(resource.id, resource);
  }

  /** 注销并释放一个资源 */
  unregister(id: string): void {
    const res = this.resources.get(id);
    if (res) {
      this.tryDispose(res);
      this.resources.delete(id);
    }
  }

  /** 释放并清空所有资源（进程退出时调用） */
  disposeAll(): void {
    for (const res of this.resources.values()) {
      this.tryDispose(res);
    }
    this.resources.clear();
    clearInterval(this.cleanupTimer);
  }

  /** 当前注册的资源数 */
  get size(): number {
    return this.resources.size;
  }

  /** 按类型统计资源数 */
  countByType(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const res of this.resources.values()) {
      counts[res.type] = (counts[res.type] ?? 0) + 1;
    }
    return counts;
  }

  /** 获取所有资源的元数据快照（用于 /health 端点） */
  snapshot(): ReadonlyArray<{
    id: string;
    type: string;
    ageMs: number;
    meta?: Record<string, unknown>;
  }> {
    const now = Date.now();
    return [...this.resources.values()].map((r) => ({
      id: r.id,
      type: r.type,
      ageMs: now - r.createdAt,
      meta: r.meta,
    }));
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private tryDispose(res: Resource): void {
    try {
      const result = res.dispose();
      if (result instanceof Promise) {
        result.catch((err) =>
          console.error(`[ResourceRegistry] dispose error for ${res.id}:`, err),
        );
      }
    } catch (err) {
      console.error(`[ResourceRegistry] dispose error for ${res.id}:`, err);
    }
  }

  /** 扫描并释放过期资源 */
  private scavenge(): void {
    const now = Date.now();
    for (const [id, res] of this.resources) {
      if (res.ttlMs != null && now - res.createdAt > res.ttlMs) {
        this.tryDispose(res);
        this.resources.delete(id);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const globalRegistry = new ResourceRegistry();
