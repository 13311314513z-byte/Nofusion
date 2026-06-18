import type { Hono } from "hono";
import type { ProjectConfig, Scheduler, PipelineConfig } from "@actalk/inkos-core";
import { StateManager } from "@actalk/inkos-core";

/** SSE event handler function type */
export type EventHandler = (event: string, data: unknown) => void;

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
  foundationPlans: Map<string, unknown>;
  /** Promise that resolves when foundation plans are loaded */
  foundationPlansPromise: Promise<void>;
  /** Persist a foundation plan to disk */
  persistFoundationPlan: (root: string, planId: string, entry: Record<string, unknown>) => Promise<void>;
  /** Remove a persisted foundation plan from disk */
  removePersistedFoundationPlan: (root: string, planId: string) => Promise<void>;
  /** Whether foundation plans have finished loading */
  foundationPlansLoaded: boolean;
  /** Daemon scheduler singleton */
  schedulerInstance: { current: Scheduler | null };
  /** Build a pipeline config for the current project */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildPipelineConfig: (overrides?: Record<string, unknown>) => Promise<any>;
  /** Resolve service base URL from config */
  resolveConfiguredServiceBaseUrl: (root: string, service: string, baseUrl?: string) => Promise<string | undefined>;
  /** Load raw inkos.json config */
  loadRawConfig: (root: string) => Promise<Record<string, unknown>>;
  /** Save raw inkos.json config */
  saveRawConfig: (root: string, config: Record<string, unknown>) => Promise<void>;
}
