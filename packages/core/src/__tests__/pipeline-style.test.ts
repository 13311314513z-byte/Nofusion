/**
 * Pipeline Style — unit tests.
 *
 * P2-1: Independent test coverage for buildDeterministicStyleGuide.
 */

import { describe, it, expect } from "vitest";
import { buildDeterministicStyleGuide } from "../pipeline/pipeline-style.js";

const baseProfile = {
  avgSentenceLength: 22.5,
  sentenceLengthStdDev: 8.3,
  avgParagraphLength: 120,
  vocabularyDiversity: 0.72,
  topPatterns: ["He said, \"", "She looked at"],
  rhetoricalFeatures: ["metaphor", "anaphora"],
  sourceName: "test-corpus",
};

describe("buildDeterministicStyleGuide", () => {
  it("produces a markdown guide in English", () => {
    const guide = buildDeterministicStyleGuide(baseProfile, {
      language: "en",
      reason: "Test — short sample fallback.",
    });
    expect(guide).toContain("# Style Guide");
    expect(guide).toContain("22.5");
    expect(guide.length).toBeGreaterThan(100);
  });

  it("produces a guide in Chinese", () => {
    const guide = buildDeterministicStyleGuide(
      { ...baseProfile, avgSentenceLength: 18 },
      { language: "zh", reason: "短样本兜底。" },
    );
    expect(guide).toContain("文风指南");
    expect(guide).toContain("18");
    expect(guide.length).toBeGreaterThan(50);
  });

  it("handles empty arrays gracefully", () => {
    const guide = buildDeterministicStyleGuide(
      { ...baseProfile, topPatterns: [], rhetoricalFeatures: [], sourceName: undefined },
      { language: "en", reason: "Empty fallback." },
    );
    expect(typeof guide).toBe("string");
  });
});
