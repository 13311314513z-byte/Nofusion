import { describe, it, expect, beforeEach, vi } from "vitest";
import { rewriteWithAuthorProfile } from "../agents/style-rewriter.js";
import { generateAdjustmentPlan } from "../agents/style-adjuster.js";
import { runFullDiagnostics } from "../agents/style-diagnostics.js";
import type { AuthorStyleProfile } from "../style-library/models.js";
import type { LLMClient, LLMResponse } from "../llm/provider.js";

// ---------------------------------------------------------------------------
// Mock LLM client
// ---------------------------------------------------------------------------

function createMockClient(responseText: string): LLMClient {
  return {
    id: "mock",
    baseUrl: "https://mock.example.com",
    apiKey: "mock-key",
    defaultModel: "mock-model",
    organizationId: undefined,
    azureDeployment: undefined,
    headers: undefined,
  } as unknown as LLMClient;
}

// We mock chatCompletion at the module level
vi.mock("../llm/provider.js", () => ({
  chatCompletion: vi.fn(),
}));

// Helper to get the mocked function
import { chatCompletion } from "../llm/provider.js";
const mockChat = vi.mocked(chatCompletion);

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

function makeSampleAuthorProfile(): AuthorStyleProfile {
  return {
    id: "test-author",
    name: "测试作家",
    language: "zh",
    tags: ["简洁", "平实"],
    sourceIds: ["src-1"],
    aggregateProfile: {
      avgSentenceLength: 18.5,
      sentenceLengthStdDev: 5.0,
      avgParagraphLength: 120,
      paragraphLengthRange: { min: 20, max: 200 },
      vocabularyDiversity: 0.65,
      topPatterns: [],
      rhetoricalFeatures: [],
      fingerprint: {
        dialogueRatio: 0.15,
        actionDensity: 0.25,
        psychologicalRatio: 0.10,
        sensoryDensity: 0.05,
        colloquialismScore: 0.3,
        rhetoricDensity: 0.2,
        punctuationRhythm: { commaRatio: 0.3, periodRatio: 0.4, questionRatio: 0.1, exclamationRatio: 0.1, ellipsisRatio: 0.05, semicolonRatio: 0.05 },
        aiTellRisk: 0.1,
        sensoryBreakdown: { visual: 0.4, auditory: 0.2, tactile: 0.2, olfactory: 0.1, gustatory: 0.1 },
      },
    },
    sampleStats: {
      sourceCount: 1,
      totalChars: 200,
      avgCharsPerSource: 200,
    },
    version: 1,
    createdAt: "0",
    updatedAt: "0",
  };
}

const sampleText = [
  "他转身看向窗外。他转过身来。他回头看了一眼。夜色很深。他转身走回桌前。",
  "他拿起杯子喝了一口。他放下杯子。他想了一会儿。他又拿起了杯子。",
].join("\n");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("rewriteWithAuthorProfile", () => {
  beforeEach(() => {
    mockChat.mockReset();
  });

  it("throws on empty text", async () => {
    const client = createMockClient("some response");
    await expect(
      rewriteWithAuthorProfile(
        {
          text: "",
          authorProfile: makeSampleAuthorProfile(),
          plan: { sourceHash: "", ruleVersion: "", suggestions: [], warnings: [] },
          selectedSuggestionIds: [],
          preserveContent: true,
        },
        { client, model: "test-model" },
      ),
    ).rejects.toThrow("Text is required");
  });

  it("throws on text exceeding max length (20K)", async () => {
    const client = createMockClient("some response");
    const longText = "x".repeat(20_001);
    await expect(
      rewriteWithAuthorProfile(
        {
          text: longText,
          authorProfile: makeSampleAuthorProfile(),
          plan: { sourceHash: "", ruleVersion: "", suggestions: [], warnings: [] },
          selectedSuggestionIds: [],
          preserveContent: true,
        },
        { client, model: "test-model" },
      ),
    ).rejects.toThrow("exceeds");
  });

  it("throws on empty LLM response", async () => {
    const client = createMockClient("");
    mockChat.mockResolvedValueOnce({ content: "", usage: { promptTokens: 10, completionTokens: 0, totalTokens: 10 } } as LLMResponse);

    const diagnostics = runFullDiagnostics(sampleText);
    const plan = generateAdjustmentPlan(sampleText, diagnostics);

    await expect(
      rewriteWithAuthorProfile(
        {
          text: sampleText,
          authorProfile: makeSampleAuthorProfile(),
          plan,
          selectedSuggestionIds: plan.suggestions.slice(0, 2).map((s) => s.id),
          preserveContent: true,
        },
        { client, model: "test-model" },
      ),
    ).rejects.toThrow("empty rewrite");
  });

  it("returns a valid preview on successful rewrite", async () => {
    const rewritten = "他缓步走向窗边。他回过身来。他侧头望了一眼。夜色如墨。他缓步走回桌前。\n他执起杯盏饮了一口。他将杯盏搁下。他沉吟片刻。他再度执起杯盏。";
    mockChat.mockResolvedValueOnce({ content: rewritten, usage: { promptTokens: 200, completionTokens: 80, totalTokens: 280 } } as LLMResponse);

    const diagnostics = runFullDiagnostics(sampleText);
    const plan = generateAdjustmentPlan(sampleText, diagnostics);

    const result = await rewriteWithAuthorProfile(
      {
        text: sampleText,
        authorProfile: makeSampleAuthorProfile(),
        plan,
        selectedSuggestionIds: plan.suggestions.slice(0, 2).map((s) => s.id),
        preserveContent: true,
      },
      { client: createMockClient("ignored"), model: "test-model" },
    );

    expect(result.sourceHash).toBe(plan.sourceHash);
    expect(result.authorProfileVersion).toBe(1);
    expect(result.adjustedText).toBe(rewritten);
    expect(result.changedRanges.length).toBeGreaterThan(0);
    expect(result.beforeDiagnostics).toBeDefined();
    expect(result.afterDiagnostics).toBeDefined();
    expect(result.usage.totalTokens).toBe(280);
    expect(result.usage.promptTokens).toBe(200);
    expect(result.usage.completionTokens).toBe(80);
  });

  it("includes LLM error in thrown message", async () => {
    mockChat.mockRejectedValueOnce(new Error("API rate limit exceeded"));

    const diagnostics = runFullDiagnostics(sampleText);
    const plan = generateAdjustmentPlan(sampleText, diagnostics);

    await expect(
      rewriteWithAuthorProfile(
        {
          text: sampleText,
          authorProfile: makeSampleAuthorProfile(),
          plan,
          selectedSuggestionIds: [],
          preserveContent: true,
        },
        { client: createMockClient("ignored"), model: "test-model" },
      ),
    ).rejects.toThrow("LLM rewrite failed: API rate limit exceeded");
  });

  it("computes changed ranges reflecting common prefix/suffix trim", async () => {
    // Only the middle portion differs; prefix and suffix are identical
    // Prefix: "今天天气真好。我们"  Suffix: "。晚上回来吃饭。"
    const orig = "今天天气真好。我们一起出去走走。晚上回来吃饭。";
    const adj  = "今天天气真好。我们去公园散步。晚上回来吃饭。";

    mockChat.mockResolvedValueOnce({ content: adj, usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 } } as LLMResponse);

    const diag = runFullDiagnostics(orig);
    const plan = generateAdjustmentPlan(orig, diag);

    const result = await rewriteWithAuthorProfile(
      {
        text: orig,
        authorProfile: makeSampleAuthorProfile(),
        plan,
        selectedSuggestionIds: [],
        preserveContent: true,
      },
      { client: createMockClient("ignored"), model: "test-model" },
    );

    expect(result.changedRanges.length).toBe(1);
    // The changed range should only contain the differing portion (prefix "我们" is common)
    expect(result.changedRanges[0].original).toBe("一起出去走走");
    expect(result.changedRanges[0].replacement).toBe("去公园散步");
  });

  it("returns different before/after diagnostics when text changes meaningfully", async () => {
    const aiHeavy = "他点了点头。他叹了口气。他摇了摇头。他皱了皱眉。他笑了笑。";
    const rewritten = "他微微颔首。他轻叹一声。他缓缓摇头。他眉头微蹙。他淡然一笑。";

    mockChat.mockResolvedValueOnce({ content: rewritten, usage: { promptTokens: 60, completionTokens: 30, totalTokens: 90 } } as LLMResponse);

    const diag = runFullDiagnostics(aiHeavy);
    const plan = generateAdjustmentPlan(aiHeavy, diag);

    const result = await rewriteWithAuthorProfile(
      {
        text: aiHeavy,
        authorProfile: makeSampleAuthorProfile(),
        plan,
        selectedSuggestionIds: [],
        preserveContent: true,
      },
      { client: createMockClient("ignored"), model: "test-model" },
    );

    expect(result.beforeDiagnostics).not.toBe(result.afterDiagnostics);
    // The rewritten text should (likely) have a lower (or at least different) heuristic risk score
    // because we replaced repetitive "他...了" patterns with varied expressions
    const beforeRisk = result.beforeDiagnostics.aiStyleTags.heuristicRiskScore;
    const afterRisk = result.afterDiagnostics.aiStyleTags.heuristicRiskScore;
    expect(afterRisk).toBeLessThanOrEqual(beforeRisk);
  });
});
