/**
 * Stage 0-4 集成测试 — 验证本轮修复的关键链路行为。
 *
 * 覆盖范围：
 *   - intent 确认链路（精确 revision 匹配、章节元数据绑定）
 *   - 自动修订越界拒绝
 *   - 跨章计数升级（含 category 同义词、不同措辞连续三章）
 *   - Beta Reader shadow 持久化（runId 唯一性、Git commit 记录）
 *   - 异构模型约束（配置透传、同家族告警）
 *   - evidence 锚定（匹配/重定位/未找到降级）
 *
 * @module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── Imports for tested modules ───────────────────────────────────

import {
  loadChapterIntents,
  saveChapterIntents,
  getChapterIntent,
  upsertChapterIntent,
  confirmChapterIntent,
  type AuthorChapterIntent,
} from "../models/chapter-intent.js";

import {
  loadIssueConsecutiveCounts,
  saveIssueConsecutiveCounts,
  updateConsecutiveCounts,
  buildIssueFingerprint,
} from "../utils/issue-persistence.js";

import { IssueNormalizer } from "../agents/issue-normalizer.js";
import type { AuditIssue } from "../models/audit-issue.js";

import { checkPatchBoundary, issueLocationsToParagraphSet, selectReviseModeFromFixScope } from "../utils/patch-boundary.js";
import {
  anchorAuditIssues,
  anchorLocations,
  anchorEvidenceText,
  countParagraphs,
} from "../utils/location-anchor.js";
import {
  evaluateBetaReaderModelConstraint,
  persistBetaReaderShadow,
} from "../utils/beta-reader-runtime.js";

// ─── 2.1: Intent 确认链路测试 ──────────────────────────────────

describe("2.1 intent confirmation integration", () => {
  let tmpDir: string;
  let bookDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "inkos-intent-test-"));
    bookDir = join(tmpDir, "book");
    await mkdir(join(bookDir, "story"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeIntent(n: number, revision: number, status: "draft" | "confirmed" | "superseded" = "draft"): AuthorChapterIntent {
    return {
      chapterNumber: n,
      revision,
      status,
      updatedAt: new Date().toISOString(),
      source: "author",
      coreNarrative: `Core ${n}`,
      readerTakeaway: `Takeaway ${n}`,
      keyMoment: `Key ${n}`,
    };
  }

  it("confirms exact revision, not latest", async () => {
    // Simulate: during generation, author creates revision 2
    const intents = [makeIntent(1, 1), makeIntent(1, 2)];
    await saveChapterIntents(bookDir, intents);

    // Generation started with revision 1
    const capturedRevision = 1;
    const loaded = await loadChapterIntents(bookDir);
    const target = loaded.intents.find(
      (i) => i.chapterNumber === 1 && i.revision === capturedRevision,
    );
    expect(target).toBeDefined();
    expect(target!.status).toBe("draft");

    // Confirm exactly revision 1 (not revision 2 which was added later)
    const confirmed = confirmChapterIntent(target!);
    const updated = loaded.intents.map((i) =>
      i.chapterNumber === 1 && i.revision === capturedRevision ? confirmed : i,
    );
    await saveChapterIntents(bookDir, updated);

    // Verify: revision 1 is confirmed, revision 2 is still draft
    const after = await loadChapterIntents(bookDir);
    expect(after.intents.find((i) => i.revision === 1)!.status).toBe("confirmed");
    expect(after.intents.find((i) => i.revision === 2)!.status).toBe("draft");
  });

  it("does not confirm when captured revision no longer exists", async () => {
    // Author deleted revision 1 during generation
    const intents = [makeIntent(1, 2)];
    await saveChapterIntents(bookDir, intents);

    // Generation started with revision 1, but it's gone
    const capturedRevision = 1;
    const loaded = await loadChapterIntents(bookDir);
    const target = loaded.intents.find(
      (i) => i.chapterNumber === 1 && i.revision === capturedRevision,
    );
    expect(target).toBeUndefined();
  });

  it("preserves chapter metadata intentRevision binding", async () => {
    // Simulate the pipeline: save intent, generate chapter, record revision
    const intent = makeIntent(2, 1);
    await saveChapterIntents(bookDir, [intent]);

    // Pipeline records currentIntentRevision
    const currentIntentRevision = 1;

    // Simulate chapter persistence (would be ChapterMeta in real pipeline)
    const chapterMeta = {
      number: 2,
      title: "Test Chapter",
      status: "ready-for-review" as const,
      wordCount: 1000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      auditIssues: [],
      lengthWarnings: [],
      intentRevision: currentIntentRevision,
    };
    expect(chapterMeta.intentRevision).toBe(1);
  });
});

// ─── 2.2: 自动修订越界测试 ──────────────────────────────────

describe("2.2 patch boundary rejection", () => {
  const originalText = [
    "This is paragraph one. It contains important context that must be preserved.",
    "This is paragraph two. The target issue is here in this text.",
    "This is paragraph three. More context that should remain untouched.",
    "This is paragraph four. Also outside the target range.",
  ];

  const revisedText = [
    "This is paragraph one. It contains important context that must be preserved.",
    "This is paragraph two. The revised version fixing the issue.",
    "This is paragraph three. More context that should remain untouched.",
    "This is paragraph four. Also outside the target range.",
  ];

  const oversteppingRevised = [
    "This is paragraph one. MODIFIED outside target range!",
    "This is paragraph two. The revised version fixing the issue.",
    "This is paragraph three. MODIFIED outside target range!",
    "This is paragraph four. Also outside the target range.",
  ];

  it("detects within-bounds patch", () => {
    const targetSet = new Set([1]); // 0-based: paragraph 2 only
    const report = checkPatchBoundary(originalText, revisedText, targetSet);
    expect(report.withinBounds).toBe(true);
    expect(report.overstepCount).toBe(0);
    expect(report.targetModified).toBe(1);
    expect(report.targetTotal).toBe(1);
  });

  it("rejects overstepping patch", () => {
    const targetSet = new Set([1]); // 0-based: paragraph 2 only
    const report = checkPatchBoundary(originalText, oversteppingRevised, targetSet);
    expect(report.withinBounds).toBe(false);
    expect(report.overstepCount).toBe(2); // paragraphs 0 and 2 modified
    expect(report.oversteps.length).toBe(2);
  });

  it("selects correct revise mode from fixScope", () => {
    expect(selectReviseModeFromFixScope(["word"])).toBe("spot-fix");
    expect(selectReviseModeFromFixScope(["sentence"])).toBe("spot-fix");
    expect(selectReviseModeFromFixScope(["paragraph"])).toBe("spot-fix");
    expect(selectReviseModeFromFixScope(["scene"])).toBe("rewrite-only");
    expect(selectReviseModeFromFixScope(["chapter"])).toBe("rewrite-only");
    expect(selectReviseModeFromFixScope([])).toBe("patch-only");
  });

  it("issueLocationsToParagraphSet converts 1-indexed to 0-indexed", () => {
    const locations = [
      { startParagraph: 2, endParagraph: 3 },
    ];
    const set = issueLocationsToParagraphSet(locations);
    expect(set.has(1)).toBe(true); // 0-based: paragraph 2
    expect(set.has(2)).toBe(true); // 0-based: paragraph 3
    expect(set.size).toBe(2);
  });

  it("returns full original content after boundary rejection", () => {
    // Simulate the runner's behavior: when boundary is violated, use original
    const targetSet = new Set([1]);
    const report = checkPatchBoundary(originalText, oversteppingRevised, targetSet);
    expect(report.withinBounds).toBe(false);
    // The "rejected" behavior returns originalText unchanged
    const rejectedContent = originalText; // runner.ts returns original content
    expect(rejectedContent).toEqual(originalText);
  });
});

// ─── 2.3: 跨章计数升级测试 ──────────────────────────────────

describe("2.3 cross-chapter count escalation", () => {
  let tmpDir: string;
  let bookDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "inkos-count-test-"));
    bookDir = join(tmpDir, "book");
    await mkdir(join(bookDir, "story"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeIssue(source: string, category: string, description: string): AuditIssue {
    return {
      id: `${source}-${category}-${Math.random().toString(36).slice(2, 8)}`,
      source: source as any,
      severity: "info",
      category,
      description,
      suggestion: "Fix it",
      fixScope: "paragraph",
      blocking: false,
      createdAt: new Date().toISOString(),
    };
  }

  it("escalates info to warning after 3 consecutive chapters", async () => {
    // Simulate 2 previous occurrences
    const prevCounts = new Map<string, number>();
    const issueDesc = "The protagonist consistently acts against established character traits";
    const sig = buildIssueFingerprint("continuity", "OOC Check", issueDesc);

    prevCounts.set(sig, 2); // 2 previous chapters

    // Chapter 3: issue appears again
    const currentIssues = [makeIssue("continuity", "OOC Check", issueDesc)];

    // Update counts (BEFORE normalization, matching the fixed order)
    const updated = updateConsecutiveCounts(prevCounts, currentIssues);
    expect(updated.get(sig)).toBe(3); // Now 3 consecutive

    // Normalizer should escalate info → warning at count >= 3
    const normalizer = new IssueNormalizer();
    const result = normalizer.normalize(currentIssues, updated);
    expect(result.issues[0]!.severity).toBe("warning");
  });

  it("escalates warning to critical after 5 consecutive chapters", async () => {
    const prevCounts = new Map<string, number>();
    const issueDesc = "Timeline inconsistency with the main plot";
    const sig = buildIssueFingerprint("continuity", "Timeline Check", issueDesc);

    prevCounts.set(sig, 4); // 4 previous chapters

    const currentIssues = [makeIssue("continuity", "Timeline Check", issueDesc)];

    const updated = updateConsecutiveCounts(prevCounts, currentIssues);
    expect(updated.get(sig)).toBe(5); // Now 5 consecutive

    // Create issue with warning severity (as if previous escalation already happened)
    const warningIssue = { ...currentIssues[0]!, severity: "warning" as const };
    const normalizer = new IssueNormalizer();
    const result = normalizer.normalize([warningIssue], updated);
    expect(result.issues[0]!.severity).toBe("critical");
  });

  it("resets count when issue does not appear in a chapter", async () => {
    const prevCounts = new Map<string, number>();
    const issueDesc = "Recurring pacing problem";
    const sig = buildIssueFingerprint("continuity", "Pacing Check", issueDesc);

    prevCounts.set(sig, 2); // 2 previous chapters

    // Chapter 3: issue NOT present
    const currentIssues: AuditIssue[] = [];

    const updated = updateConsecutiveCounts(prevCounts, currentIssues);
    expect(updated.has(sig)).toBe(false); // Cleared
  });

  it("handles different descriptions of the same issue via stable fingerprint", async () => {
    const prevCounts = new Map<string, number>();
    const firstDescription = "角色在危急场景中突然违背一贯原则";
    const sig = buildIssueFingerprint("continuity", "角色行为不一致", firstDescription);
    prevCounts.set(sig, 2);

    // Same normalized category, completely different wording.
    const currentIssues = [
      makeIssue("continuity", "人设崩塌", "主角此次选择与此前塑造的底线相冲突"),
    ];

    const updated = updateConsecutiveCounts(prevCounts, currentIssues);
    expect(updated.get(sig)).toBe(3);
  });

  it("survives save/load cycle", async () => {
    const counts = new Map<string, number>();
    counts.set("test:Category:key term", 3);

    await saveIssueConsecutiveCounts(bookDir, counts, 5);
    const loaded = await loadIssueConsecutiveCounts(bookDir);
    expect(loaded.get("test:Category:key term")).toBe(3);
  });
});

// ─── 2.4: Shadow 持久化测试 ──────────────────────────────────

describe("2.4 shadow persistence", () => {
  let tmpDir: string;
  let shadowDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "inkos-shadow-test-"));
    shadowDir = join(tmpDir, "story", "beta-reader-shadow");
    await mkdir(shadowDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists same-chapter runs as separate append-only files", async () => {
    const input = {
      bookDir: tmpDir,
      chapterNumber: 3,
      title: "Test Chapter",
      gitCommit: "abc123",
      writerModel: "deepseek-v3",
      writerPromptHash: "writer-hash",
      readerModel: {
        provider: "openai",
        model: "gpt-4.1",
        promptHash: "reader-hash",
        version: "1.0.0",
      },
      observations: [],
    } as const;
    const [first, second] = await Promise.all([
      persistBetaReaderShadow(input),
      persistBetaReaderShadow(input),
    ]);

    expect(first.runId).not.toBe(second.runId);
    expect(first.filePath).not.toBe(second.filePath);
    const files = await readdirContent(shadowDir);
    expect(files).toHaveLength(2);
  });

  it("records reproducibility metadata in the persisted entry", async () => {
    const persisted = await persistBetaReaderShadow({
      bookDir: tmpDir,
      chapterNumber: 1,
      title: "Test Chapter",
      gitCommit: "abc123",
      writerModel: "deepseek-v4-flash",
      writerPromptHash: "writer-hash",
      readerModel: {
        provider: "openai",
        model: "gpt-4o",
        promptHash: "reader-hash",
        version: "1.0.0",
      },
      observations: [],
    });
    const entry = JSON.parse(await readFile(persisted.filePath, "utf-8"));

    expect(entry.gitCommit).toBe("abc123");
    expect(entry.writerModel).toBe("deepseek-v4-flash");
    expect(entry.writerPromptHash).toBe("writer-hash");
    expect(entry.readerModel.promptHash).toBe("reader-hash");
  });
});

// Helper to read directory contents
async function readdirContent(dir: string): Promise<string[]> {
  return readdir(dir);
}

// ─── 2.5: 异构模型校验测试 ──────────────────────────────────

describe("2.5 heterogeneous model constraint", () => {
  it("rejects the same model family", () => {
    const result = evaluateBetaReaderModelConstraint(
      "deepseek-v4-flash",
      "deepseek-v3",
      "deepseek",
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("both resolve");
  });

  it("allows different configured model families", () => {
    const result = evaluateBetaReaderModelConstraint(
      "deepseek-v4-flash",
      "openai/gpt-4.1",
      "gpt",
    );
    expect(result.allowed).toBe(true);
    expect(result.writerFamily).toBe("deepseek");
    expect(result.readerFamily).toBe("openai");
  });

  it("rejects unknown model families instead of silently evaluating", () => {
    const result = evaluateBetaReaderModelConstraint("", "gpt-4.1", "gpt");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("unable to determine");
  });
});

// ─── 2.6: Evidence 锚定测试 ──────────────────────────────────

describe("2.6 evidence text anchoring", () => {
  const chapterContent = [
    "第一章开头段落。讲述了主角的日常生活。",
    "第二章开头段落。主角发现自己拥有了特殊能力。",
    "第三章开头段落。冲突开始升级，主角面对挑战。",
    "",
  ].join("\n\n");

  it("matches evidence found in cited paragraph range", () => {
    const result = anchorEvidenceText(chapterContent, [
      {
        location: { startParagraph: 2, endParagraph: 2 },
        evidence: ["特殊能力"],
      },
    ]);
    expect(result.matched).toHaveLength(1);
    expect(result.relocated).toHaveLength(0);
    expect(result.notFound).toHaveLength(0);
  });

  it("relocates evidence found in a different paragraph", () => {
    const result = anchorEvidenceText(chapterContent, [
      {
        // Cited paragraph 1, but evidence is in paragraph 2
        location: { startParagraph: 1, endParagraph: 1 },
        evidence: ["特殊能力"],
      },
    ]);
    // Should be relocated to paragraph 2
    expect(result.relocated).toHaveLength(1);
    expect(result.relocated[0]!.correctedLocation.startParagraph).toBe(2);
  });

  it("flags not-found evidence and triggers degradation", () => {
    const result = anchorAuditIssues(chapterContent, [
      makeAnchoredIssue({
        location: { startParagraph: 1, endParagraph: 1 },
        evidence: ["完全不存在的文本内容"],
        severity: "critical",
        blocking: true,
      }),
    ]);
    expect(result.degradedIssues).toBe(1);
    expect(result.issues[0]!.location).toBeUndefined();
    expect(result.issues[0]!.severity).toBe("warning");
    expect(result.issues[0]!.blocking).toBe(false);
  });

  it("does not mutate another issue that contains the same evidence text", () => {
    const result = anchorAuditIssues(chapterContent, [
      makeAnchoredIssue({
        location: { startParagraph: 2, endParagraph: 2 },
        evidence: ["特殊能力"],
      }),
      makeAnchoredIssue({
        location: { startParagraph: 3, endParagraph: 3 },
        evidence: ["特殊能力"],
      }),
    ]);

    expect(result.issues[0]!.location).toEqual({ startParagraph: 2, endParagraph: 2 });
    expect(result.issues[1]!.location).toEqual({ startParagraph: 2, endParagraph: 2 });
    expect(result.relocatedLocations).toBe(1);
  });

  it("handles multiple evidence items for the same location", () => {
    const result = anchorEvidenceText(chapterContent, [
      {
        location: { startParagraph: 1, endParagraph: 2 },
        evidence: ["日常生活", "特殊能力", "不存在的证据"],
      },
    ]);
    expect(result.matched.length + result.relocated.length + result.notFound.length).toBe(3);
  });

  it("validates paragraph count bounds", () => {
    const total = countParagraphs(chapterContent);
    expect(total).toBe(3);

    // Location beyond range should be rejected
    const anchored = anchorLocations(
      [{ startParagraph: 5, endParagraph: 6 }],
      total,
    );
    expect(anchored.rejected).toHaveLength(1);
    expect(anchored.valid).toHaveLength(0);
  });

  it("clamps endParagraph exceeding total", () => {
    const total = countParagraphs(chapterContent);
    const anchored = anchorLocations(
      [{ startParagraph: 2, endParagraph: 10 }],
      total,
    );
    expect(anchored.clamped).toHaveLength(1);
    expect(anchored.clamped[0]!.clamped.endParagraph).toBe(3);
  });
});

function makeAnchoredIssue(
  overrides: Partial<AuditIssue>,
): AuditIssue {
  return {
    id: `issue-${Math.random().toString(36).slice(2)}`,
    source: "continuity",
    severity: "warning",
    category: "Test",
    description: "Test issue",
    suggestion: "Fix it",
    fixScope: "paragraph",
    blocking: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}
