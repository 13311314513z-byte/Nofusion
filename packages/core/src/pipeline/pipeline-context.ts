import type { LLMClient, OnStreamProgress } from "../llm/provider.js";
import type { Logger } from "../utils/logger.js";
import type { NotifyChannel, LLMConfig, AgentLLMOverride } from "../models/project.js";
import type { StateManager } from "../state/manager.js";
import type { MemoryDB } from "../state/memory-db.js";

/**
 * Shared context for pipeline stages.
 * Extracted from PipelineRunner to enable stage-by-stage splitting.
 *
 * Phase 1: Type definition only. Stage extraction starts in Phase 2.
 */
export interface PipelineContext {
  /** LLM client for API calls */
  client: LLMClient;
  /** Active model identifier */
  model: string;
  /** Project root directory */
  projectRoot: string;
  /** Default LLM configuration */
  defaultLLMConfig: LLMConfig;
  /** Logger instance */
  logger: Logger;
  /** State manager for book/chapter persistence */
  state: StateManager;
  /** Optional memory DB for long-term facts */
  memoryDB: MemoryDB | null;
  /** Notification channels */
  notifyChannels: NotifyChannel[] | undefined;
  /** Stream progress callback */
  onStreamProgress?: OnStreamProgress;
  /** Foundation review retries */
  foundationReviewRetries: number;
  /** Writing review retries */
  writingReviewRetries: number;
  /** Quality budget level */
  qualityBudget: "economy" | "standard" | "premium";
  /** Model overrides per agent type */
  modelOverrides?: Record<string, AgentLLMOverride>;
  /** External context bundle */
  externalContext?: unknown;
}
