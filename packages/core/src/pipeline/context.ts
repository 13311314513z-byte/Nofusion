import type { LLMClient, OnStreamProgress } from "../llm/provider.js";
import { createLLMClient } from "../llm/provider.js";
import type { Logger } from "../utils/logger.js";
import type { LLMConfig, AgentLLMOverride, NotifyChannel, InputGovernanceMode } from "../models/project.js";
import type { BetaReaderMode } from "../agents/beta-reader.js";
import type { RadarSource } from "../agents/radar-source.js";
import { StateManager } from "../state/manager.js";
import type { AgentContext } from "../agents/base.js";
import { stat } from "node:fs/promises";

// ─── Configuration ────────────────────────────────────────────────────────────

export interface PipelineConfig {
  readonly client: LLMClient;
  readonly model: string;
  readonly projectRoot: string;
  readonly defaultLLMConfig?: LLMConfig;
  readonly foundationReviewRetries?: number;
  readonly writingReviewRetries?: number;
  readonly qualityBudget?: "economy" | "normal" | "premium";
  readonly strictInterview?: boolean;
  readonly betaReaderMode?: BetaReaderMode;
  readonly betaReaderModelFamily?: string;
  readonly notifyChannels?: ReadonlyArray<NotifyChannel>;
  readonly radarSources?: ReadonlyArray<RadarSource>;
  readonly externalContext?: string;
  readonly modelOverrides?: Record<string, string | AgentLLMOverride>;
  readonly inputGovernanceMode?: unknown;
  readonly logger?: Logger;
  readonly onStreamProgress?: OnStreamProgress;
}

// ─── PipelineContext: shared foundation utilities ─────────────────────────────

export class PipelineContext {
  readonly state: StateManager;
  readonly config: PipelineConfig;
  readonly agentClients = new Map<string, { client: LLMClient; cachedAt: number }>();
  memoryIndexFallbackWarned = false;
  readonly chapterContentCache = new Map<string, string>();

  constructor(config: PipelineConfig) {
    this.config = config;
    this.state = new StateManager(config.projectRoot);
  }

  dispose(): void {
    for (const entry of this.agentClients.values()) {
      entry.client.dispose?.();
    }
    this.agentClients.clear();
    this.chapterContentCache.clear();
  }

  // ─── Agent client management ─────────────────────────────────────────────

  setAgentClient(cacheKey: string, client: LLMClient): void {
    const MAX_CACHED_CLIENTS = 20;
    const AGENT_CLIENT_TTL_MS = 30 * 60 * 1000;
    const now = Date.now();

    for (const [key, entry] of this.agentClients) {
      if (now - entry.cachedAt > AGENT_CLIENT_TTL_MS) {
        entry.client.dispose?.();
        this.agentClients.delete(key);
      }
    }

    if (this.agentClients.size >= MAX_CACHED_CLIENTS && !this.agentClients.has(cacheKey)) {
      const firstKey = this.agentClients.keys().next().value;
      if (firstKey !== undefined) {
        const evicted = this.agentClients.get(firstKey);
        if (evicted) {
          evicted.client.dispose?.();
        }
        this.agentClients.delete(firstKey);
      }
    }
    this.agentClients.set(cacheKey, { client, cachedAt: now });
  }

  // ─── Agent context resolution ────────────────────────────────────────────

  agentCtx(bookId?: string): AgentContext {
    return {
      client: this.config.client,
      model: this.config.model,
      projectRoot: this.config.projectRoot,
      bookId,
      logger: this.config.logger,
      onStreamProgress: this.config.onStreamProgress,
    };
  }

  resolveOverride(agentName: string): { model: string; client: LLMClient } {
    const override = this.config.modelOverrides?.[agentName];
    if (!override) {
      return { model: this.config.model, client: this.config.client };
    }
    if (typeof override === "string") {
      return { model: override, client: this.config.client };
    }
    if (!override.baseUrl) {
      return { model: override.model, client: this.config.client };
    }
    const base = this.config.defaultLLMConfig;
    const provider = override.provider ?? base?.provider ?? "custom";
    const apiKeySource = override.apiKeyEnv
      ? `env:${override.apiKeyEnv}`
      : `base:${base?.apiKey ?? ""}`;
    const stream = override.stream ?? base?.stream ?? true;
    const apiFormat = base?.apiFormat ?? "chat";
    const cacheKey = [
      provider,
      override.baseUrl,
      apiKeySource,
      `stream:${stream}`,
      `format:${apiFormat}`,
    ].join("|");
    let client = this.agentClients.get(cacheKey)?.client;
    if (!client) {
      const apiKey = override.apiKeyEnv
        ? process.env[override.apiKeyEnv] ?? ""
        : base?.apiKey ?? "";
      client = createLLMClient({
        provider,
        service: base?.service ?? "custom",
        configSource: base?.configSource ?? "env",
        baseUrl: override.baseUrl,
        apiKey,
        model: override.model,
        temperature: base?.temperature ?? 0.7,
        thinkingBudget: base?.thinkingBudget ?? 0,
        apiFormat,
        stream,
      });
      this.setAgentClient(cacheKey, client);
    }
    return { model: override.model, client };
  }

  agentCtxFor(agent: string, bookId?: string): AgentContext {
    const { model, client } = this.resolveOverride(agent);
    return {
      client,
      model,
      projectRoot: this.config.projectRoot,
      bookId,
      logger: this.config.logger?.child(agent),
      onStreamProgress: this.config.onStreamProgress,
    };
  }

  // ─── Utilities ───────────────────────────────────────────────────────────

  async pathExists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }
}
