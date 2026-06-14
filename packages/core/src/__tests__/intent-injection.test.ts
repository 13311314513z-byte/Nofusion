import { describe, it, expect } from "vitest";
import {
  buildAuthorIntentBlock,
  buildAuthorCommitmentChecklist,
  buildWriterIntentBrief,
} from "../utils/intent-injection.js";
import { validateAuthorIntentInContent } from "../agents/post-write-validator.js";
import type { AuthorChapterIntent } from "../models/chapter-intent.js";

const sampleIntent: AuthorChapterIntent = {
  chapterNumber: 5,
  coreNarrative: "陈墨发现朋友在骗他，必须在信任和证据之间做选择",
  readerTakeaway: "从震惊过渡到愤怒，结尾留下悬念",
  keyMoment: "陈墨看到朋友手机里的消息记录时的表情变化",
  scenes: [
    { goal: "陈墨在家消化背叛", location: "客厅", povCharacter: "陈墨", targetEmotion: "压抑" },
    { goal: "与朋友对峙", location: "咖啡厅", povCharacter: "陈墨", targetEmotion: "愤怒" },
  ],
  characterStates: [
    { characterId: "陈墨", emotion: "愤怒但压抑", relationshipChanges: "从信任到怀疑" },
    { characterId: "李鹤", emotion: "得意" },
  ],
  requiredBeats: ["陈墨发现证据", "与朋友当面对质"],
  forbiddenMoves: ["陈墨在证据确凿前摊牌", "本章解决所有疑问"],
  pendingHookIds: ["hook_001", "hook_002"],
  narrativePosition: "rising",
  plotLine: "主线",
};

// ---------------------------------------------------------------------------
// buildAuthorIntentBlock
// ---------------------------------------------------------------------------

describe("buildAuthorIntentBlock", () => {
  it("includes core narrative when present", () => {
    const block = buildAuthorIntentBlock(sampleIntent);
    expect(block).toContain("陈墨发现朋友在骗他");
    expect(block).toContain("【核心】");
  });

  it("includes reader takeaway when present", () => {
    const block = buildAuthorIntentBlock(sampleIntent);
    expect(block).toContain("从震惊过渡到愤怒");
    expect(block).toContain("【读者感受】");
  });

  it("includes key moment when present", () => {
    const block = buildAuthorIntentBlock(sampleIntent);
    expect(block).toContain("陈墨看到朋友手机");
    expect(block).toContain("【关键画面】");
  });

  it("includes scene breakdown when scenes are defined", () => {
    const block = buildAuthorIntentBlock(sampleIntent);
    expect(block).toContain("场景规划");
    expect(block).toContain("陈墨在家消化背叛");
    expect(block).toContain("与朋友对峙");
  });

  it("includes character states", () => {
    const block = buildAuthorIntentBlock(sampleIntent);
    expect(block).toContain("角色状态");
    expect(block).toContain("陈墨: 愤怒但压抑");
    expect(block).toContain("李鹤: 得意");
  });

  it("includes constraints (required beats / forbidden moves)", () => {
    const block = buildAuthorIntentBlock(sampleIntent);
    expect(block).toContain("陈墨发现证据");
    expect(block).toContain("陈墨在证据确凿前摊牌");
  });

  it("includes narrative position and plot line", () => {
    const block = buildAuthorIntentBlock(sampleIntent);
    expect(block).toContain("rising");
    expect(block).toContain("主线");
  });

  it("returns empty sections gracefully for minimal intent", () => {
    const minimal: AuthorChapterIntent = {
      chapterNumber: 1,
      coreNarrative: "",
      readerTakeaway: "",
      keyMoment: "",
      scenes: [],
      characterStates: [],
      requiredBeats: [],
      forbiddenMoves: [],
      pendingHookIds: [],
      narrativePosition: "opening",
    };
    const block = buildAuthorIntentBlock(minimal);
    // Should not crash; should still have the header
    expect(block).toContain("作者说这一章");
    // No scene section
    expect(block).not.toContain("场景规划");
  });
});

// ---------------------------------------------------------------------------
// buildAuthorCommitmentChecklist
// ---------------------------------------------------------------------------

describe("buildAuthorCommitmentChecklist", () => {
  it("includes reader takeaway as checklist item", () => {
    const checklist = buildAuthorCommitmentChecklist(sampleIntent);
    expect(checklist).toContain("读者感受兑现");
    expect(checklist).toContain("从震惊过渡到愤怒");
  });

  it("includes key moment as checklist item", () => {
    const checklist = buildAuthorCommitmentChecklist(sampleIntent);
    expect(checklist).toContain("关键画面出现");
    expect(checklist).toContain("陈墨看到朋友手机");
  });

  it("includes required beats as checklist items", () => {
    const checklist = buildAuthorCommitmentChecklist(sampleIntent);
    expect(checklist).toContain("必达事件");
    expect(checklist).toContain("陈墨发现证据");
  });

  it("includes forbidden moves as checklist items", () => {
    const checklist = buildAuthorCommitmentChecklist(sampleIntent);
    expect(checklist).toContain("禁止事项未出现");
    expect(checklist).toContain("陈墨在证据确凿前摊牌");
  });

  it("returns empty string for empty intent", () => {
    const empty: AuthorChapterIntent = {
      chapterNumber: 1,
      coreNarrative: "",
      readerTakeaway: "",
      keyMoment: "",
      scenes: [],
      characterStates: [],
      requiredBeats: [],
      forbiddenMoves: [],
      pendingHookIds: [],
      narrativePosition: "opening",
    };
    expect(buildAuthorCommitmentChecklist(empty)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// buildWriterIntentBrief
// ---------------------------------------------------------------------------

describe("buildWriterIntentBrief", () => {
  it("includes core narrative and reader takeaway", () => {
    const brief = buildWriterIntentBrief(sampleIntent);
    expect(brief).toContain("陈墨发现朋友在骗他");
    expect(brief).toContain("从震惊过渡到愤怒");
  });

  it("includes narrative position", () => {
    const brief = buildWriterIntentBrief(sampleIntent);
    expect(brief).toContain("rising");
  });

  it("handles empty intent gracefully", () => {
    const empty: AuthorChapterIntent = {
      chapterNumber: 1,
      coreNarrative: "",
      readerTakeaway: "",
      keyMoment: "",
      scenes: [],
      characterStates: [],
      requiredBeats: [],
      forbiddenMoves: [],
      pendingHookIds: [],
      narrativePosition: "opening",
    };
    const brief = buildWriterIntentBrief(empty);
    expect(brief).toBe("");
  });
});

// ---------------------------------------------------------------------------
// validateAuthorIntentInContent
// ---------------------------------------------------------------------------

describe("validateAuthorIntentInContent", () => {
  it("flags missing key moment", () => {
    const content = "陈墨走在街上，阳光很好。他买了杯咖啡。";
    const violations = validateAuthorIntentInContent(
      content,
      "陈墨看到朋友手机里的消息记录时的表情变化",
      "",
      "",
    );
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.rule).toBe("关键画面缺失");
  });

  it("passes when key moment terms are present", () => {
    const content = "陈墨盯着手机屏幕，那条消息像一把刀刺进他的眼睛，他的表情从难以置信变成了愤怒。";
    const violations = validateAuthorIntentInContent(
      content,
      "陈墨看到朋友手机里的消息记录时的表情变化",
      "",
      "",
    );
    // "陈墨", "手机", "消息", "表情" should all be found
    const matching = violations.filter((v) => v.rule === "关键画面缺失");
    expect(matching.length).toBe(0);
  });

  it("handles empty key moment gracefully", () => {
    const violations = validateAuthorIntentInContent("任何内容", "", "", "");
    expect(violations.length).toBe(0);
  });

  it("flags missing core narrative", () => {
    const content = "无关的内容";
    const violations = validateAuthorIntentInContent(
      content,
      "",
      "陈墨发现朋友在骗他，必须在信任和证据之间做选择",
      "",
    );
    expect(violations.some((v) => v.rule === "核心叙述偏离")).toBe(true);
  });
});
