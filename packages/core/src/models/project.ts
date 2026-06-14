import { z } from "zod";

// C1 (v2.0.0 breaking): `maxTokens` 字段已被 providers bank 接管；zod 用 strip mode 静默丢弃老配置里的 `maxTokens`。
const LLMServiceEntrySchema = z.object({
  service: z.string().min(1),
  name: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  temperature: z.number().min(0).max(2).optional(),
  apiFormat: z.enum(["chat", "responses"]).optional(),
  stream: z.boolean().optional(),
});

const LLMCoverConfigSchema = z.object({
  service: z.enum(["kkaiapi", "openai", "google"]),
  model: z.string().min(1),
}).optional();

// C1 (v2.0.0 breaking): 删除 maxTokens / maxTokensCap 字段。
// 每个模型的真实 maxOutput 来自 providers/<name>.ts 的 InkosModel.maxOutput；
// 老配置里写的 maxTokens / maxTokensCap 会被 zod strip 静默丢弃（不报错）。
export const LLMConfigSchema = z.object({
  provider: z.enum(["anthropic", "openai", "custom"]),
  service: z.string().default("custom"),
  configSource: z.enum(["env", "studio"]).default("env"),
  baseUrl: z.string().url(),
  apiKey: z.string().default(""),
  model: z.string().min(1),
  proxyUrl: z.string().url().optional(),
  temperature: z.number().min(0).max(2).default(0.7),
  thinkingBudget: z.number().int().min(0).default(0),
  extra: z.record(z.unknown()).optional(),
  headers: z.record(z.string()).optional(),
  apiFormat: z.enum(["chat", "responses"]).default("chat"),
  stream: z.boolean().default(true),
  services: z.array(LLMServiceEntrySchema).optional(),
  defaultModel: z.string().min(1).optional(),
  cover: LLMCoverConfigSchema,
});

export type LLMConfig = z.infer<typeof LLMConfigSchema>;

export const NotifyChannelSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("telegram"),
    botToken: z.string().min(1),
    chatId: z.string().min(1),
  }),
  z.object({
    type: z.literal("wechat-work"),
    webhookUrl: z.string().url(),
  }),
  z.object({
    type: z.literal("feishu"),
    webhookUrl: z.string().url(),
  }),
  z.object({
    type: z.literal("webhook"),
    url: z.string().url(),
    secret: z.string().optional(),
    events: z.array(z.string()).default([]),
  }),
]);

export type NotifyChannel = z.infer<typeof NotifyChannelSchema>;

export const DetectionConfigSchema = z.object({
  provider: z.enum(["gptzero", "originality", "custom"]).default("custom"),
  apiUrl: z.string().url(),
  apiKeyEnv: z.string().min(1),
  threshold: z.number().min(0).max(1).default(0.5),
  enabled: z.boolean().default(false),
  autoRewrite: z.boolean().default(false),
  maxRetries: z.number().int().min(1).max(10).default(3),
});

export type DetectionConfig = z.infer<typeof DetectionConfigSchema>;

export const QualityGatesSchema = z.object({
  maxAuditRetries: z.number().int().min(0).max(10).default(2),
  pauseAfterConsecutiveFailures: z.number().int().min(1).default(3),
  retryTemperatureStep: z.number().min(0).max(0.5).default(0.1),
});

export type QualityGates = z.infer<typeof QualityGatesSchema>;

export const FoundationConfigSchema = z.object({
  reviewRetries: z.number().int().min(0).max(10).default(2),
});

export type FoundationConfig = z.infer<typeof FoundationConfigSchema>;

export const WritingConfigSchema = z.object({
  reviewRetries: z.number().int().min(0).max(10).default(1),
  /** Quality budget tier — controls how many LLM evaluation calls are made per chapter. */
  qualityBudget: z.enum(["economy", "normal", "premium"]).default("economy"),
  /** Strict interview mode — when true, missing intent fields block auto-writing. */
  strictInterview: z.boolean().default(false),
  /** Beta Reader maturity mode. */
  betaReaderMode: z.enum(["off", "shadow", "advisory", "actionable"]).default("off"),
  /**
   * Expected model family for the Beta Reader.
   * When set, the reader MUST use a model from a different family than the writer.
   * This avoids self-preference bias where the reader prefers its own writing style.
   * Examples: "claude", "gpt", "deepseek", "gemini"
   * If the writer and reader models share the same family, a warning is logged.
   */
  betaReaderModelFamily: z.string().optional(),
  /** Number of candidates to generate for key scenes (importance="key"). */
  keySceneCandidates: z.number().int().min(1).max(3).default(1),
});

export type WritingConfig = z.infer<typeof WritingConfigSchema>;

export function resolveWritingReviewRetries(
  configured: number,
  qualityBudget: WritingConfig["qualityBudget"],
): number {
  if (qualityBudget === "economy") return Math.min(configured, 1);
  if (qualityBudget === "premium") return Math.max(configured, 3);
  return configured;
}

export const AgentLLMOverrideSchema = z.object({
  model: z.string().min(1),
  provider: z.enum(["anthropic", "openai", "custom"]).optional(),
  baseUrl: z.string().url().optional(),
  apiKeyEnv: z.string().optional(),
  stream: z.boolean().optional(),
});

export type AgentLLMOverride = z.infer<typeof AgentLLMOverrideSchema>;

export const InputGovernanceModeSchema = z.enum(["legacy", "v2"]);
export type InputGovernanceMode = z.infer<typeof InputGovernanceModeSchema>;

const ModelOverrideValueSchema = z.union([z.string(), AgentLLMOverrideSchema]);

export const ProjectConfigSchema = z.object({
  name: z.string().min(1),
  version: z.literal("0.1.0"),
  language: z.enum(["zh", "en"]).default("zh"),
  llm: LLMConfigSchema,
  notify: z.array(NotifyChannelSchema).default([]),
  detection: DetectionConfigSchema.optional(),
  foundation: FoundationConfigSchema.default({
    reviewRetries: 2,
  }),
  writing: WritingConfigSchema.default({
    reviewRetries: 1,
  }),
  modelOverrides: z.record(z.string(), ModelOverrideValueSchema).optional(),
  inputGovernanceMode: InputGovernanceModeSchema.default("v2"),
  daemon: z.object({
    schedule: z.object({
      radarCron: z.string().default("0 */6 * * *"),
      writeCron: z.string().default("*/15 * * * *"),
    }),
    maxConcurrentBooks: z.number().int().min(1).default(3),
    chaptersPerCycle: z.number().int().min(1).max(20).default(1),
    retryDelayMs: z.number().int().min(0).default(30_000),
    cooldownAfterChapterMs: z.number().int().min(0).default(10_000),
    maxChaptersPerDay: z.number().int().min(1).default(50),
    qualityGates: QualityGatesSchema.default({
      maxAuditRetries: 2,
      pauseAfterConsecutiveFailures: 3,
      retryTemperatureStep: 0.1,
    }),
  }).default({
    schedule: {
      radarCron: "0 */6 * * *",
      writeCron: "*/15 * * * *",
    },
    maxConcurrentBooks: 3,
    chaptersPerCycle: 1,
    retryDelayMs: 30_000,
    cooldownAfterChapterMs: 10_000,
    maxChaptersPerDay: 50,
    qualityGates: {
      maxAuditRetries: 2,
      pauseAfterConsecutiveFailures: 3,
      retryTemperatureStep: 0.1,
    },
  }),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
