import type { LLMConfig } from "../models/project.js";
import type {
  Api as PiApi,
  Model as PiModel,
} from "@mariozechner/pi-ai";

// === Constants ===

export const INKOS_USER_AGENT = "InkOS/1.3.5";
export const UNKNOWN_MODEL_FALLBACK_MAX_TOKENS = 8192 * 3;
export const TRANSIENT_LLM_RETRIES = 2;

// === Streaming Monitor Types ===

export interface StreamProgress {
  readonly elapsedMs: number;
  readonly totalChars: number;
  readonly chineseChars: number;
  readonly status: "streaming" | "done";
}

export type OnStreamProgress = (progress: StreamProgress) => void;

// === Shared Types ===

export interface LLMResponse {
  readonly content: string;
  readonly usage: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
  /**
   * API 返回的 stop_reason / finish_reason。
   * - "stop": 正常结束
   * - "length": 达到 max_tokens 限制被截断
   * - "tool_use": 触发了工具调用
   * - undefined: 无法获取（如流中断等）
   */
  readonly stopReason?: "stop" | "length" | "tool_use" | string;
}

export interface LLMMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface LLMClient {
  readonly provider: "openai" | "anthropic";
  readonly service?: string;
  readonly configSource?: LLMConfig["configSource"];
  readonly apiFormat: "chat" | "responses";
  readonly stream: boolean;
  readonly proxyUrl?: string;
  readonly _piModel?: PiModel<PiApi>;
  readonly _apiKey?: string;
  readonly defaults: {
    readonly temperature: number;
    /**
     * Per-call fallback: 当 agent 调 chat() 不传 options.maxTokens 时用这个值。
     * 命中模型卡时来自 providers bank 的 modelCard.maxOutput；未知模型走写作兜底预算。
     */
    readonly maxTokens: number;
    /**
     * Legacy mock compatibility only. v2 provider resolution no longer caps
     * per-call maxTokens from project config; model max output comes from the
     * provider bank.
     */
    readonly maxTokensCap?: number | null;
    readonly thinkingBudget: number;
    readonly extra: Record<string, unknown>;
  };
  /** Optional cleanup hook for resources held by the client (e.g. connections). */
  dispose?(): void;
}

// === Tool-calling Types ===

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

export type AgentMessage =
  | { readonly role: "system"; readonly content: string }
  | { readonly role: "user"; readonly content: string }
  | { readonly role: "assistant"; readonly content: string | null; readonly toolCalls?: ReadonlyArray<ToolCall> }
  | { readonly role: "tool"; readonly toolCallId: string; readonly content: string };

export interface ChatWithToolsResult {
  readonly content: string;
  readonly toolCalls: ReadonlyArray<ToolCall>;
}

// === Stream Monitor Factory ===

export function createStreamMonitor(
  onProgress?: OnStreamProgress,
  intervalMs: number = 30000,
): { readonly onChunk: (text: string) => void; readonly stop: () => void } {
  let totalChars = 0;
  let chineseChars = 0;
  const startTime = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;

  if (onProgress) {
    timer = setInterval(() => {
      onProgress({
        elapsedMs: Date.now() - startTime,
        totalChars,
        chineseChars,
        status: "streaming",
      });
    }, intervalMs);
  }

  return {
    onChunk(text: string): void {
      totalChars += text.length;
      chineseChars += (text.match(/[\u4e00-\u9fff]/g) || []).length;
    },
    stop(): void {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      onProgress?.({
        elapsedMs: Date.now() - startTime,
        totalChars,
        chineseChars,
        status: "done",
      });
    },
  };
}
