import { describe, it, expect } from "vitest";
import { compareWithAuthorProfile } from "../agents/style-comparator.js";
import type { AuthorStyleProfile } from "../style-library/models.js";

function makeMockProfile(overrides?: Partial<AuthorStyleProfile>): AuthorStyleProfile {
  return {
    id: "test-author",
    name: "Test Author",
    language: "zh",
    tags: [],
    sourceIds: ["src1"],
    version: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    sampleStats: { sourceCount: 3, totalChars: 15000, avgCharsPerSource: 5000 },
    aggregateProfile: {
      avgSentenceLength: 25,
      sentenceLengthStdDev: 10,
      avgParagraphLength: 120,
      paragraphLengthRange: { min: 20, max: 500 },
      vocabularyDiversity: 0.35,
      topPatterns: ["他...", "她..."],
      rhetoricalFeatures: ["比喻(3处)"],
      fingerprint: {
        dialogueRatio: 0.3,
        actionDensity: 0.15,
        psychologicalRatio: 0.2,
        sensoryDensity: 0.1,
        colloquialismScore: 0.4,
        rhetoricDensity: 0.05,
        punctuationRhythm: {
          commaRatio: 0.5, periodRatio: 0.3, questionRatio: 0.05,
          exclamationRatio: 0.05, ellipsisRatio: 0.05, semicolonRatio: 0.05,
        },
        aiTellRisk: 0.2,
        sensoryBreakdown: { visual: 0.5, auditory: 0.2, tactile: 0.15, olfactory: 0.1, gustatory: 0.05 },
      },
      sourceName: "test",
      analyzedAt: "2024-01-01T00:00:00Z",
    },
    ...overrides,
  };
}

describe("compareWithAuthorProfile", () => {
  it("returns insufficient for very short text", () => {
    const result = compareWithAuthorProfile("短", makeMockProfile());
    expect(result.sampleAdequacy).toBe("insufficient");
    expect(result.deviations).toHaveLength(0);
    expect(result.overallMatchScore).toBe(0);
  });

  it("compares matching text and returns expected result structure", () => {
    const profile = makeMockProfile();
    // Use text > 2000 chars for sufficient sample
    const sentence = "他转过身看向窗外。夜色已经很深了。远处传来零星的狗叫声。他深吸一口气，继续写下去。";
    const text = Array(60).fill(sentence).join("");
    expect(text.length).toBeGreaterThan(2000);
    const result = compareWithAuthorProfile(text, profile);
    expect(result.targetAuthorId).toBe("test-author");
    expect(result.targetProfileVersion).toBe(1);
    expect(result.sampleAdequacy).toBe("sufficient");
    expect(Array.isArray(result.deviations)).toBe(true);
  });

  it("downgrades sample adequacy when target author profile has too little source material", () => {
    const sentence = "他转过身看向窗外。夜色已经很深了。远处传来零星的狗叫声。他深吸一口气，继续写下去。";
    const text = Array(60).fill(sentence).join("");
    const result = compareWithAuthorProfile(text, makeMockProfile({
      sampleStats: { sourceCount: 1, totalChars: 1200, avgCharsPerSource: 1200 },
    }));

    expect(result.sampleAdequacy).toBe("limited");
  });

  it("detects deviations when text differs from profile", () => {
    const profile = makeMockProfile({
      aggregateProfile: {
        ...makeMockProfile().aggregateProfile,
        avgSentenceLength: 80, // Much longer than typical short text
        vocabularyDiversity: 0.6,
        fingerprint: {
          ...makeMockProfile().aggregateProfile.fingerprint,
          dialogueRatio: 0.9, // Very high dialogue ratio
        },
      },
    });
    // Long text of only very short sentences with no dialogue — should deviate
    const sentence = "天黑了。起风了。树叶动了。鸟飞了。云散了。月出了。星亮了。夜深了。雾起了。露生了。";
    const text = Array(10).fill(sentence).join("");
    const result = compareWithAuthorProfile(text, profile);
    expect(result.deviations.length).toBeGreaterThanOrEqual(1);
  });

  it("returns match for identical values within tolerance", () => {
    const profile = makeMockProfile();
    const sentence = "这是一句中等长度的句子。这是另一句差不多长的句子。最后一句测试长度的句子。";
    const text = Array(20).fill(sentence).join("");
    const result = compareWithAuthorProfile(text, profile);
    // Should not throw, all deviations should have valid shape
    for (const dev of result.deviations) {
      expect(dev.metric).toBeTruthy();
      expect(typeof dev.currentValue).toBe("number");
      expect(typeof dev.targetValue).toBe("number");
      expect(["above", "below", "match"]).toContain(dev.direction);
    }
  });

  it("handles target value of zero gracefully", () => {
    const profile = makeMockProfile({
      aggregateProfile: {
        ...makeMockProfile().aggregateProfile,
        avgSentenceLength: 0,
        fingerprint: {
          ...makeMockProfile().aggregateProfile.fingerprint,
          dialogueRatio: 0,
        },
      },
    });
    const text = Array(20).fill("测试文本。用于对比。不应除零崩溃。").join("");
    expect(() => compareWithAuthorProfile(text, profile)).not.toThrow();
  });

  it("returns expected shape", () => {
    const text = "这是一段用于测试的文本。它有多句话。用来验证对比结果的结构。";
    const result = compareWithAuthorProfile(text, makeMockProfile());
    expect(result).toHaveProperty("targetAuthorId");
    expect(result).toHaveProperty("targetAuthor");
    expect(result).toHaveProperty("targetProfileVersion");
    expect(result).toHaveProperty("sampleAdequacy");
    expect(result).toHaveProperty("deviations");
    expect(result).toHaveProperty("overallMatchScore");
  });
});
