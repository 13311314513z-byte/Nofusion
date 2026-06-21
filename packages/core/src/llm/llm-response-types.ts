/**
 * Minimal type shapes for LLM API responses.
 * Only describes fields actually accessed by provider.ts extraction functions.
 * Used to narrow `any` types without adding Zod runtime overhead.
 * C5 (P2-14): any 收敛 — provider.ts
 */

/** Common usage shape — all fields optional since providers differ. */
export interface LLMUsage {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly total_tokens?: number;
  readonly input_tokens?: number;
  readonly output_tokens?: number;
}

/** OpenAI chat completion response (fields we use). */
export interface ChatCompletionResponse {
  readonly id?: string;
  readonly object?: string;
  readonly choices?: ReadonlyArray<{
    readonly index?: number;
    readonly message?: {
      readonly role?: string;
      readonly content?: string | ReadonlyArray<TextPart>;
      readonly reasoning_content?: string | ReadonlyArray<TextPart>;
    };
    readonly delta?: {
      readonly content?: string | ReadonlyArray<TextPart>;
      readonly reasoning_content?: string | ReadonlyArray<TextPart>;
    };
    readonly finish_reason?: string;
  }>;
  readonly usage?: LLMUsage;
}

/** OpenAI Responses API shape (fields we use). */
export interface ResponsesApiResponse {
  readonly id?: string;
  readonly object?: string;
  readonly status?: string;
  readonly output?: ReadonlyArray<{
    readonly type?: string;
    readonly content?: ReadonlyArray<OutputTextPart>;
  }>;
  readonly usage?: LLMUsage;
  readonly response?: {
    readonly status?: string;
  };
}

/** Anthropic Messages API shape (fields we use). */
export interface AnthropicMessageResponse {
  readonly id?: string;
  readonly type?: string;
  readonly content?: ReadonlyArray<TextPart>;
  readonly stop_reason?: string;
  readonly usage?: LLMUsage;
}

/** Text content part — used by OpenAI multimodal and Anthropic. */
export interface TextPart {
  readonly type?: string;
  readonly text?: string;
  readonly content?: string;
  readonly output_text?: string;
}

/** Output text part — used by OpenAI Responses API. */
export interface OutputTextPart {
  readonly type?: string;
  readonly text?: string;
  readonly content?: string;
  readonly output_text?: string;
}

/** Union type for any LLM JSON response. */
export type LLMResponseJson = ChatCompletionResponse | ResponsesApiResponse | AnthropicMessageResponse;
