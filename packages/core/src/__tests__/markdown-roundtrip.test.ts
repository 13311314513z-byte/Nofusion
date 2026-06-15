import { describe, expect, it } from "vitest";
import { renderChapterIntentToMarkdown, renderChapterGoalToMarkdown } from "../utils/markdown-renderer.js";
import { parseChapterIntentFromMarkdown, parseChapterGoalFromMarkdown } from "../utils/markdown-parser.js";
import type { AuthorChapterIntent } from "../models/chapter-intent.schema.js";
import type { ChapterGoalCard } from "../models/chapter-goal.js";

// ─── Chapter Intent roundtrip ──────────────────────────────────────

describe("ChapterIntent Markdown roundtrip", () => {
  const fullIntent: AuthorChapterIntent = {
    chapterNumber: 5,
    coreNarrative: "程时一必须在山本发现暗语之前将情报传递出去，同时不让老韩起疑心",
    readerTakeaway: "紧张——为程时一的处境捏一把汗，同时好奇老韩的立场",
    keyMoment: "山本的手指停在药方签背面的瞬间，程时一的心跳漏了一拍",
    scenes: [
      {
        goal: "取药暗语传递",
        location: "药房前堂",
        povCharacter: "程时一",
        targetEmotion: "紧张",
        conflict: "山本今天格外多疑，反复检查药包",
        outcome: "情报成功传出但被老韩在门口目睹",
        importance: "key",
        requiredBeats: ["暗语书写", "山本验药"],
        forbiddenMoves: ["程时一主动暴露身份"],
      },
      {
        goal: "后门接头",
        location: "药房后巷",
        povCharacter: "程时一",
        targetEmotion: "如释重负又提心吊胆",
        conflict: "联络人迟到了——是出事了还是被跟踪了？",
        outcome: "情报成功交接，但联络人留下一句意味深长的话",
        importance: "normal",
      },
    ],
    characterStates: [
      {
        characterId: "程时一",
        emotion: "外松内紧",
        relationshipChanges: "对老韩：信任动摇，开始怀疑他是否已经察觉",
      },
      {
        characterId: "山本武正",
        emotion: "多疑但不露声色",
        relationshipChanges: "对程时一：从欣赏转为审视",
      },
    ],
    requiredBeats: ["暗语书写", "山本验药", "后门交接"],
    forbiddenMoves: ["程时一主动暴露身份", "山本直接抓人"],
    narrativePosition: "rising",
    revision: 3,
    status: "draft",
    updatedAt: "2026-06-15T00:00:00.000Z",
    source: "author",
  };

  it("roundtrips a full ChapterIntent without semantic loss", () => {
    const md = renderChapterIntentToMarkdown(fullIntent, "zh");
    const { intent: parsed, warnings } = parseChapterIntentFromMarkdown(md, 5);

    expect(warnings).toEqual([]);
    expect(parsed.coreNarrative).toBe(fullIntent.coreNarrative);
    expect(parsed.readerTakeaway).toBe(fullIntent.readerTakeaway);
    expect(parsed.keyMoment).toBe(fullIntent.keyMoment);
    expect(parsed.narrativePosition).toBe("rising");
    expect(parsed.requiredBeats).toEqual(fullIntent.requiredBeats);
    expect(parsed.forbiddenMoves).toEqual(fullIntent.forbiddenMoves);
    expect(parsed.scenes?.length).toBe(2);
    expect(parsed.scenes?.[0]?.goal).toBe("取药暗语传递");
    expect(parsed.scenes?.[0]?.povCharacter).toBe("程时一");
    expect(parsed.scenes?.[0]?.requiredBeats).toEqual(["暗语书写", "山本验药"]);
    expect(parsed.characterStates?.length).toBe(2);
    expect(parsed.characterStates?.[0]?.characterId).toBe("程时一");
    expect(parsed.characterStates?.[0]?.emotion).toBe("外松内紧");
  });

  it("handles minimal intent (only coreNarrative)", () => {
    const minimal: AuthorChapterIntent = {
      chapterNumber: 1,
      coreNarrative: "介绍主角和世界观",
    };
    const md = renderChapterIntentToMarkdown(minimal, "zh");
    const { intent: parsed } = parseChapterIntentFromMarkdown(md, 1);

    expect(parsed.coreNarrative).toBe("介绍主角和世界观");
    expect(parsed.readerTakeaway).toBeUndefined();
    expect(parsed.scenes).toBeUndefined();
  });

  it("handles empty intent gracefully", () => {
    const empty: AuthorChapterIntent = {
      chapterNumber: 3,
    };
    const md = renderChapterIntentToMarkdown(empty, "zh");
    const { intent: parsed } = parseChapterIntentFromMarkdown(md, 3);

    expect(parsed.chapterNumber).toBe(3);
    expect(parsed.coreNarrative).toBeUndefined();
  });
});

// ─── Chapter Goal Card roundtrip ───────────────────────────────────

describe("ChapterGoalCard Markdown roundtrip", () => {
  const fullGoal: ChapterGoalCard = {
    chapterNumber: 5,
    title: "暗语",
    mainConflict: "程时一必须在山本发现暗语前传递情报",
    targetMood: "紧张",
    povCharacter: "程时一",
    location: "同仁堂药房",
    timeOfDay: "午后",
    targetChars: 5000,
    requiredBeats: ["抓药", "写暗语", "山本检查"],
    forbiddenMoves: ["山本当场识破"],
    hookIdsToAdvance: ["H001", "H003"],
  };

  it("roundtrips a full ChapterGoalCard without semantic loss", () => {
    const md = renderChapterGoalToMarkdown(fullGoal, "zh");
    const { goal: parsed } = parseChapterGoalFromMarkdown(md, 5);

    expect(parsed.mainConflict).toBe(fullGoal.mainConflict);
    expect(parsed.targetMood).toBe("紧张");
    expect(parsed.povCharacter).toBe("程时一");
    expect(parsed.location).toBe("同仁堂药房");
    expect(parsed.timeOfDay).toBe("午后");
    expect(parsed.targetChars).toBe(5000);
    expect(parsed.requiredBeats).toEqual(["抓药", "写暗语", "山本检查"]);
    expect(parsed.forbiddenMoves).toEqual(["山本当场识破"]);
    expect(parsed.hookIdsToAdvance).toEqual(["H001", "H003"]);
  });

  it("handles minimal goal (only chapterNumber and conflict)", () => {
    const minimal: ChapterGoalCard = {
      chapterNumber: 1,
      mainConflict: "主角第一次进入药房",
    };
    const md = renderChapterGoalToMarkdown(minimal, "zh");
    const { goal: parsed } = parseChapterGoalFromMarkdown(md, 1);

    expect(parsed.mainConflict).toBe("主角第一次进入药房");
    expect(parsed.povCharacter).toBeUndefined();
  });

  it("handles empty goal gracefully", () => {
    const empty: ChapterGoalCard = {
      chapterNumber: 2,
    };
    const md = renderChapterGoalToMarkdown(empty, "zh");
    const { goal: parsed } = parseChapterGoalFromMarkdown(md, 2);

    expect(parsed.chapterNumber).toBe(2);
    expect(parsed.mainConflict).toBeUndefined();
  });
});
