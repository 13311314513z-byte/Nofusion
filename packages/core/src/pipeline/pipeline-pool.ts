/**
 * PipelinePool — reuses PipelineRunner instances to avoid redundant
 * StateManager construction and LLM client re-initialization.
 * C7 (P2-7): Pipeline 实例池
 */
import { PipelineRunner, type PipelineConfig } from "./runner.js";

export interface PipelinePoolOptions {
  /** Maximum concurrent PipelineRunner instances. Default 4. */
  readonly maxSize?: number;
  /** Idle timeout in ms before draining unused instances. Default 5 min. */
  readonly idleTimeoutMs?: number;
}

export class PipelinePool {
  private readonly pool: PipelineRunner[] = [];
  private readonly inUse = new Set<PipelineRunner>();
  private readonly maxSize: number;
  private readonly idleTimeoutMs: number;
  private readonly configFactory: () => PipelineConfig;

  constructor(
    configFactory: () => PipelineConfig,
    options: PipelinePoolOptions = {},
  ) {
    this.configFactory = configFactory;
    this.maxSize = options.maxSize ?? 4;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 5 * 60_000;
  }

  /** Number of runners currently in the pool (idle + in-use). */
  get size(): number { return this.pool.length; }

  /** Number of runners currently in use. */
  get active(): number { return this.inUse.size; }

  /**
   * Acquire an idle PipelineRunner or create a new one up to maxSize.
   * If the pool is full, waits for a release.
   */
  async acquire(): Promise<PipelineRunner> {
    // 1. Try idle instance
    const idle = this.pool.find(r => !this.inUse.has(r));
    if (idle) {
      this.inUse.add(idle);
      return idle;
    }

    // 2. Create new if under max
    if (this.pool.length < this.maxSize) {
      const runner = new PipelineRunner(this.configFactory());
      this.pool.push(runner);
      this.inUse.add(runner);
      return runner;
    }

    // 3. Pool full — wait for release (poll with 100ms interval)
    return new Promise<PipelineRunner>((resolve) => {
      const check = setInterval(() => {
        const freed = this.pool.find(r => !this.inUse.has(r));
        if (freed) {
          clearInterval(check);
          this.inUse.add(freed);
          resolve(freed);
        }
      }, 100);
    });
  }

  /**
   * Release a runner back to the pool, resetting temporary state.
   */
  release(runner: PipelineRunner): void {
    // Reset transient chapter cache and other per-write state
    runner.resetForReuse();
    this.inUse.delete(runner);
  }

  /**
   * Drain all runners — calls dispose() on each and clears the pool.
   * Called on server shutdown.
   */
  drain(): void {
    for (const runner of this.pool) {
      runner.dispose();
    }
    this.pool.length = 0;
    this.inUse.clear();
  }
}
