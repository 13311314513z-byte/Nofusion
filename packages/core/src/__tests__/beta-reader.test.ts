import { describe, it, expect, vi, beforeEach } from "vitest";
import { BetaReader } from "../agents/beta-reader.js";
import type { AgentContext } from "../agents/base.js";

// Helper: spy on the chat method of BetaReader via prototype
function mockChatResponse(response: { content: string }) {
  vi.spyOn(BetaReader.prototype as any, "chat").mockResolvedValue(response);
}

function createMockContext(overrides?: Partial<AgentContext>): AgentContext {
  return {
    client: {
      provider: "openai",
      apiFormat: "chat",
      stream: false,
      defaults: {
        temperature: 0.3,
        maxTokens: 1500,
        thinkingBudget: 0,
        extra: {},
      },
    },
    model: "test-model",
    projectRoot: "/tmp/test",
    ...overrides,
  };
}

describe("BetaReader", () => {
  let reader: BetaReader;

  beforeEach(() => {
    reader = new BetaReader(createMockContext());
    vi.restoreAllMocks();
  });

  describe("parseObservations (via chat spy)", () => {
    it("parses a valid JSON response into observations", async () => {
      const validResponse = {
        observations: [
          {
            dimension: "engagement",
            judgment: "positive",
            evidence: [
              { startParagraph: 1, endParagraph: 3, reason: "Strong opening hook" },
            ],
            confidence: 0.9,
          },
          {
            dimension: "character",
            judgment: "mixed",
            evidence: [
              { startParagraph: 5, endParagraph: 6, reason: "Dialogue feels slightly forced" },
            ],
            confidence: 0.7,
          },
        ],
      };

      mockChatResponse({ content: "```json\n" + JSON.stringify(validResponse) + "\n```" });

      const result = await reader.read({
        chapterContent: "第 1 段\n\n第 2 段\n\n第 3 段",
        chapterNumber: 1,
        genre: "mystery",
      });

      expect(result.observations).toHaveLength(2);
      expect(result.observations[0].dimension).toBe("engagement");
      expect(result.observations[0].judgment).toBe("positive");
      expect(result.observations[0].evidence[0].reason).toBe("Strong opening hook");
      expect(result.observations[1].dimension).toBe("character");
      expect(result.modelInfo.provider).toBe("openai");
      expect(result.modelInfo.model).toBe("test-model");
    });

    it("filters out observations without evidence", async () => {
      const responseWithMissingEvidence = {
        observations: [
          {
            dimension: "emotion",
            judgment: "positive",
            evidence: [
              { startParagraph: 2, endParagraph: 4, reason: "Good emotional payoff" },
            ],
            confidence: 0.8,
          },
          {
            dimension: "clarity",
            judgment: "negative",
            evidence: [], // Missing evidence — should be filtered
            confidence: 0.6,
          },
        ],
      };

      mockChatResponse({ content: JSON.stringify(responseWithMissingEvidence) });

      const result = await reader.read({
        chapterContent: "段落内容",
        chapterNumber: 1,
      });

      expect(result.observations).toHaveLength(1);
      expect(result.observations[0].dimension).toBe("emotion");
    });

    it("returns empty observations when JSON is malformed", async () => {
      mockChatResponse({ content: "This is not JSON at all" });

      const result = await reader.read({
        chapterContent: "内容",
        chapterNumber: 1,
      });

      expect(result.observations).toHaveLength(0);
    });

    it("returns empty observations when JSON has no observations array", async () => {
      mockChatResponse({ content: JSON.stringify({ notObservations: true }) });

      const result = await reader.read({
        chapterContent: "内容",
        chapterNumber: 1,
      });

      expect(result.observations).toHaveLength(0);
    });

    it("handles empty chapter content gracefully", async () => {
      mockChatResponse({ content: "```json\n{\"observations\": []}\n```" });

      const result = await reader.read({
        chapterContent: "",
        chapterNumber: 1,
      });

      expect(result.observations).toHaveLength(0);
      expect(result.modelInfo.version).toBe("1.0.0");
    });

    it("clamps confidence to [0, 1] range", async () => {
      const response = {
        observations: [
          {
            dimension: "expectation",
            judgment: "positive",
            evidence: [
              { startParagraph: 1, endParagraph: 2, reason: "Makes me want to read next chapter" },
            ],
            confidence: 2.5, // Out of range
          },
        ],
      };

      mockChatResponse({ content: JSON.stringify(response) });

      const result = await reader.read({
        chapterContent: "内容",
        chapterNumber: 1,
      });

      expect(result.observations).toHaveLength(1);
      expect(result.observations[0].confidence).toBe(1); // clamped to 1
    });

    it("rejects observations with invalid dimensions", async () => {
      const response = {
        observations: [
          {
            dimension: "invalid-dimension",
            judgment: "positive",
            evidence: [
              { startParagraph: 1, endParagraph: 2, reason: "Some reason" },
            ],
            confidence: 0.5,
          },
        ],
      };

      mockChatResponse({ content: JSON.stringify(response) });

      const result = await reader.read({
        chapterContent: "内容",
        chapterNumber: 1,
      });

      expect(result.observations).toHaveLength(0);
    });
  });

});
