import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Simulate pi-ai returning MiniMax's stale Anthropic-compatible route.
// Our resolveServiceModel should override it with the current OpenAI-compatible preset.
// Note: pi-ai maps minimax -> providerFamily "openai", so the stale minimax model
// is registered under the "openai" provider.
vi.mock("@mariozechner/pi-ai", () => {
  const ALL_MODELS = [
    {
      id: "MiniMax-M2.7",
      name: "MiniMax-M2.7",
      api: "anthropic-messages",        // stale pi-ai metadata
      provider: "openai",               // pi-ai registers minimax models under "openai"
      baseUrl: "https://api.minimax.io/anthropic",
      reasoning: true,
      input: ["text"],
      cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.375 },
      contextWindow: 204800,
      maxTokens: 131072,
    } as any,
  ];
  return {
    getModels: vi.fn((provider: string) => ALL_MODELS.filter((m: any) => m.provider === provider)),
    getProviders: vi.fn(() => ["openai", "moonshot", "minimax"]),
    getModel: vi.fn((provider: string, modelId: string) => {
      return ALL_MODELS.find((m: any) => m.id === modelId && m.provider === provider);
    }),
    getEnvApiKey: vi.fn(() => undefined),
  };
});

import { resolveServiceModel } from "../llm/service-resolver.js";

describe("resolveServiceModel regression — preset baseUrl override", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-resolver-reg-"));
    await mkdir(join(root, ".inkos"), { recursive: true });
    await writeFile(
      join(root, ".inkos", "secrets.json"),
      JSON.stringify({ services: { minimax: { apiKey: "sk-minimax-test" } } }),
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("uses preset baseUrl, not pi-ai built-in baseUrl", async () => {
    const result = await resolveServiceModel("minimax", "MiniMax-M2.7", root);

    expect(result.model.baseUrl).toBe("https://api.minimaxi.com/v1");
  });

  it("uses preset api format, not pi-ai built-in api format", async () => {
    const result = await resolveServiceModel("minimax", "MiniMax-M2.7", root);

    expect(result.model.api).toBe("openai-completions");
  });

  it("inherits metadata from pi-ai (reasoning, cost, contextWindow)", async () => {
    const result = await resolveServiceModel("minimax", "MiniMax-M2.7", root);

    expect(result.model.reasoning).toBe(true);
    expect(result.model.contextWindow).toBe(204800);
    expect(result.model.maxTokens).toBe(131072);
  });

  it("customBaseUrl overrides both preset and pi-ai", async () => {
    const result = await resolveServiceModel(
      "minimax", "MiniMax-M2.7", root,
      "https://custom-proxy.example.com/v1",
    );

    expect(result.model.baseUrl).toBe("https://custom-proxy.example.com/v1");
  });
});
