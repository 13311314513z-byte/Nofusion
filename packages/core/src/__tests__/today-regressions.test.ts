import { describe, expect, it } from "vitest";
import { IssueNormalizer } from "../agents/issue-normalizer.js";
import { checkGenrePromises, getCriticalGenrePromises } from "../evaluation/genre-promises.js";
import { computePreferenceMetrics, type PairedPreference } from "../evaluation/paired-preference.js";
import { buildPromptManifest } from "../models/prompt-manifest.js";
import { buildManifestFromMessages } from "../utils/prompt-tracing.js";
import type { AuditIssue } from "../models/audit-issue.js";
import type { GenreProfile } from "../models/genre-profile.js";

function issue(description: string): AuditIssue {
  return {
    id: description,
    source: "continuity",
    severity: "warning",
    category: "OOC Check",
    description,
    suggestion: "revise",
    fixScope: "paragraph",
    blocking: false,
    createdAt: "2026-06-14T00:00:00.000Z",
  };
}

describe("today's regression fixes", () => {
  it("does not merge distinct no-location audit issues", () => {
    const result = new IssueNormalizer().normalize([
      issue("The protagonist forgets the key."),
      issue("The mentor changes allegiance without cause."),
    ]);

    expect(result.issues).toHaveLength(2);
    expect(result.mergedCount).toBe(0);
  });

  it("does not merge similar issues reported at different locations", () => {
    const first = {
      ...issue("The protagonist forgets the key in this scene."),
      location: { startParagraph: 2, endParagraph: 2 },
    };
    const second = {
      ...issue("The protagonist forgets the key in that scene."),
      location: { startParagraph: 8, endParagraph: 8 },
    };

    const result = new IssueNormalizer().normalize([first, second]);
    expect(result.issues).toHaveLength(2);
  });

  it("does not discard an explicit location by merging it with an unlocated issue", () => {
    const unlocated = issue("The protagonist forgets the key in this scene.");
    const located = {
      ...issue("The protagonist forgets the key in that scene."),
      location: { startParagraph: 8, endParagraph: 8 },
    };

    const result = new IssueNormalizer().normalize([unlocated, located]);
    expect(result.issues).toHaveLength(2);
    expect(result.issues.some((item) => item.location?.startParagraph === 8)).toBe(true);
  });

  it("does not mark genre promises fulfilled without evidence", () => {
    const profile = {
      promises: [{
        id: "romance-resolution",
        description: "Resolve the central relationship",
        importance: "core",
        scope: "book",
        overduePolicy: "critical",
      }],
    } as GenreProfile;

    expect(checkGenrePromises(profile, 10, 10)[0]?.status).toBe("pending");
    expect(getCriticalGenrePromises(profile, 10, 10)).toEqual([]);
  });

  it("calculates preference win rate from decisive answers", () => {
    const pairs: PairedPreference[] = [{
      pairId: "pair-1",
      versionA: "a",
      versionB: "b",
      readerId: "reader-1",
      timestamp: "2026-06-14T00:00:00.000Z",
      blindingInfo: { versionAMasked: true, versionBMasked: true },
      questions: [
        { id: "engagement", text: "Better?", answer: "B", confidence: 5 },
        { id: "voice", text: "Better voice?", answer: "tie", confidence: 4 },
      ],
    }];

    const result = computePreferenceMetrics(pairs);
    expect(result.winRate).toBe(1);
    expect(result.tieRate).toBe(0.5);
  });

  it("calculates Fleiss kappa from repeated ratings of the same pair", () => {
    const pairs: PairedPreference[] = ["reader-1", "reader-2", "reader-3"].map((readerId) => ({
      pairId: "pair-shared",
      versionA: "a",
      versionB: "b",
      readerId,
      timestamp: "2026-06-14T00:00:00.000Z",
      blindingInfo: { versionAMasked: true, versionBMasked: true },
      questions: [
        { id: "engagement", text: "Better?", answer: "B", confidence: 5 },
        { id: "voice", text: "Better voice?", answer: "A", confidence: 5 },
      ],
    }));

    const result = computePreferenceMetrics(pairs);
    expect(result.interReaderAgreement).toBe(1);
  });

  it("never drops mandatory prompt fragments", () => {
    const result = buildPromptManifest({
      stage: "writer",
      maxAllowedInputTokens: 10,
      fragments: [
        {
          id: "system",
          source: "writer.system",
          role: "system",
          slot: "system",
          priority: 100,
          content: "mandatory",
          optional: false,
          estimatedTokens: 20,
        },
        {
          id: "user",
          source: "writer.user",
          role: "user",
          slot: "user",
          priority: 80,
          content: "also mandatory",
          optional: false,
          estimatedTokens: 20,
        },
      ],
    });

    expect(result.fragments).toHaveLength(2);
    expect(result.droppedFragments).toEqual([]);
  });

  it("does not claim sent chat messages were dropped", () => {
    const manifest = buildManifestFromMessages(
      "writer",
      [
        { role: "system", content: "system" },
        { role: "user", content: "x".repeat(50_000) },
      ],
      "unknown-small-model",
      4096,
    );

    expect(manifest.fragments).toHaveLength(2);
    expect(manifest.droppedFragments).toEqual([]);
  });
});
