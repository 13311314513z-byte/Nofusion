/**
 * PipelinePool Unit Tests (D12).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { PipelinePool } from "../pipeline/pipeline-pool.js";
import type { PipelineConfig } from "../pipeline/runner.js";

function createMockConfig(): PipelineConfig {
  return {
    client: {} as PipelineConfig["client"],
    model: "test-model",
    projectRoot: "/tmp/test",
  };
}

describe("PipelinePool", () => {
  let pool: PipelinePool;

  beforeEach(() => {
    pool = new PipelinePool(createMockConfig, { maxSize: 2 });
  });

  it("starts with zero size and zero active", () => {
    expect(pool.size).toBe(0);
    expect(pool.active).toBe(0);
  });

  it("acquire creates a runner when pool is empty", async () => {
    const runner = await pool.acquire();
    expect(runner).toBeDefined();
    expect(pool.size).toBe(1);
    expect(pool.active).toBe(1);
  });

  it("acquire reuses idle runner after release", async () => {
    const r1 = await pool.acquire();
    pool.release(r1);
    expect(pool.active).toBe(0);
    const r2 = await pool.acquire();
    expect(r2).toBe(r1);
    expect(pool.size).toBe(1);
  });

  it("release removes runner from in-use set", async () => {
    const r = await pool.acquire();
    expect(pool.active).toBe(1);
    pool.release(r);
    expect(pool.active).toBe(0);
  });

  it("creates up to maxSize runners", async () => {
    const r1 = await pool.acquire();
    const r2 = await pool.acquire();
    expect(pool.size).toBe(2);
    expect(pool.active).toBe(2);
    expect(r1).not.toBe(r2);
  });

  it("drain disposes and clears all runners", async () => {
    const r1 = await pool.acquire();
    const r2 = await pool.acquire();
    expect(pool.size).toBe(2);
    pool.release(r1);
    pool.release(r2);
    pool.drain();
    expect(pool.size).toBe(0);
    expect(pool.active).toBe(0);
  });

  it("handles release of already-released runner gracefully", async () => {
    const r = await pool.acquire();
    pool.release(r);
    pool.release(r); // double release should not throw
    expect(pool.active).toBe(0);
  });
});
