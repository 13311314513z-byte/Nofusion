/**
 * Prompt tracing — wraps LLM calls with PromptManifest construction.
 *
 * Instead of modifying every Agent's prompt assembly logic, this module
 * provides a `traceableChat` wrapper that:
 *   1. Constructs a PromptManifest from the message array
 *   2. Calls the underlying chat
 *   3. Emits the manifest to the trace log
 *
 * Agents opt-in by calling `traceableChat()` instead of `this.chat()`.
 *
 * @module
 */

import {
  buildPromptManifest,
  estimateTokens,
  getAvailableInputTokens,
  type PromptFragment,
  type PromptManifest,
} from "../models/prompt-manifest.js";
import type { LLMMessage } from "../llm/provider.js";
import type { Logger } from "../utils/logger.js";

export interface TraceableChatOptions {
  readonly stage: string;
  readonly logger?: Logger;
  readonly model: string;
  readonly requestedMaxOutput?: number;
}

export interface TraceableChatResult<T> {
  readonly result: T;
  readonly manifest: PromptManifest;
}

/**
 * Build a PromptManifest from an array of LLM messages.
 * Each message is treated as one fragment with fixed priority.
 */
export function buildManifestFromMessages(
  stage: string,
  messages: ReadonlyArray<LLMMessage>,
  model: string,
  requestedMaxOutput?: number,
): PromptManifest {
  const maxAllowedInputTokens = getAvailableInputTokens(model, requestedMaxOutput);

  const fragments: PromptFragment[] = messages.map((msg, i) => ({
    id: `${stage}-${msg.role}-${i}`,
    source: `${stage}.${msg.role}`,
    role: msg.role,
    slot: i === 0 ? "system" : msg.role === "user" ? "user" : "assistant",
    priority: i === 0 ? 100 : 80, // system prompt highest priority
    content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
    // These messages are already sent by the caller, so tracing must not
    // report any of them as omitted.
    optional: false,
    estimatedTokens: estimateTokens(
      typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
    ),
  }));

  return buildPromptManifest({
    stage,
    fragments,
    maxAllowedInputTokens,
  });
}

/**
 * Wraps an LLM chat call with manifest construction + trace logging.
 *
 * Usage:
 * ```typescript
 * const { result, manifest } = await traceableChat(
 *   () => this.chat(messages, options),
 *   {
 *     stage: this.name,
 *     logger: this.log,
 *     model: this.ctx.model,
 *   },
 *   messages,
 * );
 * ```
 */
export async function traceableChat<T>(
  chatFn: () => Promise<T>,
  options: TraceableChatOptions,
  messages: ReadonlyArray<LLMMessage>,
): Promise<TraceableChatResult<T>> {
  const manifest = buildManifestFromMessages(
    options.stage,
    messages,
    options.model,
    options.requestedMaxOutput,
  );

  // Log dropped fragments as warnings
  if (manifest.droppedFragments.length > 0 && options.logger) {
    for (const dropped of manifest.droppedFragments) {
      options.logger.warn(
        `[manifest] ${options.stage}: fragment "${dropped.fragmentId}" dropped — ${dropped.reason}`,
      );
    }
  }

  // Log manifest summary
  options.logger?.debug(
    `[manifest] ${options.stage}: ${manifest.fragments.length} fragments, ` +
    `${manifest.totalEstimatedTokens} tokens (budget: ${manifest.maxAllowedInputTokens}), ` +
    `hash: ${manifest.promptHash}`,
  );

  const result = await chatFn();

  return { result, manifest };
}

/**
 * Extract message arrays from common Agent call patterns and build manifests
 * without wrapping the chat call (for logging-only use cases).
 */
export function logPromptManifest(
  stage: string,
  messages: ReadonlyArray<LLMMessage>,
  model: string,
  logger?: Logger,
): void {
  const manifest = buildManifestFromMessages(stage, messages, model);
  logger?.info(
    `[manifest] ${stage}: ${manifest.totalEstimatedTokens} tokens ` +
    `(budget: ${manifest.maxAllowedInputTokens}), hash: ${manifest.promptHash}` +
    (manifest.droppedFragments.length > 0
      ? `, ${manifest.droppedFragments.length} fragment(s) dropped`
      : ""),
  );
}
