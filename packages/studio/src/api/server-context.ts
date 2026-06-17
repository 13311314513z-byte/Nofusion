import type { Hono } from "hono";
import type { ProjectConfig, Scheduler } from "@actalk/inkos-core";
import { StateManager } from "@actalk/inkos-core";
import type { EventHandler } from "../sse-events.js";

/** Persisted foundation plan entry (defined locally, not exported from core). */
export interface FoundationPlanEntry {
  planId: string;
  bookTitle: string;
  createdAt: number;
  expiresAt: number;
  data: unknown;
}

/**
 * Shared context passed to all route modules.
 * Extracted from createStudioServer() to enable route splitting.
 */
export interface ServerContext {
  /** Hono app instance */
  app: Hono;
  /** Project root directory */
  root: string;
  /** State manager (books, chapters, config) */
  state: StateManager;
  /** SSE broadcast function */
  broadcast: (event: string, data: unknown) => void;
  /** SSE subscribers set */
  subscribers: Set<EventHandler>;
  /** Currently cached project config */
  getConfig: () => ProjectConfig;
  /** Reload project config from disk */
  loadCurrentProjectConfig: (options?: { readonly requireApiKey?: boolean }) => Promise<ProjectConfig>;
  /** Persisted foundation plans, lazily loaded */
  foundationPlans: Map<string, FoundationPlanEntry>;
  /** Whether foundation plans have finished loading */
  foundationPlansLoaded: boolean;
  /** Daemon scheduler singleton */
  schedulerInstance: { current: Scheduler | null };
  /** Build a pipeline config for the current project */
  buildPipelineConfig: (overrides?: {
    readonly externalContext?: unknown;
    readonly client?: unknown;
    readonly model?: string;
    readonly currentConfig?: ProjectConfig;
    readonly sessionIdForSSE?: string;
  }) => Promise<unknown>;
  /** Resolve service base URL from config */
  resolveConfiguredServiceBaseUrl: (root: string, service: string, baseUrl?: string) => Promise<string | undefined>;
  /** Load raw inkos.json config */
  loadRawConfig: (root: string) => Promise<Record<string, unknown>>;
  /** Save raw inkos.json config */
  saveRawConfig: (root: string, config: Record<string, unknown>) => Promise<void>;
}
