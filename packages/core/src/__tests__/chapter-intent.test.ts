import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadChapterIntents,
  saveChapterIntents,
  getChapterIntent,
  upsertChapterIntent,
  removeChapterIntent,
  type AuthorChapterIntent,
} from "../models/chapter-intent.js";

let tmpDir: string;
let bookDir: string;

function makeIntent(n: number, core?: string): AuthorChapterIntent {
  return {
    chapterNumber: n,
    coreNarrative: core ?? `Core narrative for chapter ${n}`,
    readerTakeaway: `Takeaway for chapter ${n}`,
    keyMoment: `Key moment for chapter ${n}`,
    scenes: [],
    characterStates: [],
    requiredBeats: [],
    forbiddenMoves: [],
    pendingHookIds: [],
    narrativePosition: "rising",
  };
}

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "chapter-intent-test-"));
  bookDir = join(tmpDir, "books", "test-book");
  await mkdir(join(bookDir, "story"), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("chapter-intent persistence", () => {
  it("returns empty index when file does not exist", async () => {
    const index = await loadChapterIntents(bookDir);
    expect(index.intents).toEqual([]);
    expect(typeof index.updatedAt).toBe("string");
  });

  it("saves and loads a single intent", async () => {
    const intent = makeIntent(1, "Chapter one core");
    await saveChapterIntents(bookDir, [intent]);

    const loaded = await loadChapterIntents(bookDir);
    expect(loaded.intents).toHaveLength(1);
    expect(loaded.intents[0]?.coreNarrative).toBe("Chapter one core");
    expect(loaded.intents[0]?.chapterNumber).toBe(1);
  });

  it("saves and loads multiple intents", async () => {
    const intents = [makeIntent(1), makeIntent(2), makeIntent(5)];
    await saveChapterIntents(bookDir, intents);

    const loaded = await loadChapterIntents(bookDir);
    expect(loaded.intents).toHaveLength(3);
  });

  it("upsertChapterIntent adds a new intent", () => {
    const intents: AuthorChapterIntent[] = [];
    const added = upsertChapterIntent(intents, makeIntent(3));
    expect(added).toHaveLength(1);
    expect(added[0]?.chapterNumber).toBe(3);
  });

  it("upsertChapterIntent supersedes the old version and returns the new active version", () => {
    const intent = makeIntent(2, "Original");
    const intents = [intent];
    const updated = upsertChapterIntent(intents, makeIntent(2, "Updated"));
    expect(updated).toHaveLength(2);
    expect(updated[0]?.status).toBe("superseded");
    expect(getChapterIntent(updated, 2)?.coreNarrative).toBe("Updated");
    expect(getChapterIntent(updated, 2)?.revision).toBe(2);
  });

  it("increments from the highest revision across repeated edits", () => {
    const first = upsertChapterIntent([], makeIntent(2, "First"));
    const second = upsertChapterIntent(first, makeIntent(2, "Second"));
    const third = upsertChapterIntent(second, makeIntent(2, "Third"));

    expect(third).toHaveLength(3);
    expect(third.filter((intent) => intent.status !== "superseded")).toHaveLength(1);
    expect(third.map((intent) => intent.revision)).toEqual([1, 2, 3]);
    expect(getChapterIntent(third, 2)?.coreNarrative).toBe("Third");
    expect(getChapterIntent(third, 2)?.revision).toBe(3);
  });

  it("getChapterIntent finds intent by chapter number", () => {
    const intents = [makeIntent(1), makeIntent(2), makeIntent(3)];
    const found = getChapterIntent(intents, 2);
    expect(found).toBeDefined();
    expect(found?.chapterNumber).toBe(2);

    const missing = getChapterIntent(intents, 99);
    expect(missing).toBeUndefined();
  });

  it("removeChapterIntent removes the correct intent", () => {
    const intents = [makeIntent(1), makeIntent(2), makeIntent(3)];
    const remaining = removeChapterIntent(intents, 2);
    expect(remaining).toHaveLength(2);
    expect(remaining.find((i) => i.chapterNumber === 2)).toBeUndefined();
  });

  it("round-trips all fields correctly", async () => {
    const intent: AuthorChapterIntent = {
      chapterNumber: 7,
      coreNarrative: "测试核心叙述",
      readerTakeaway: "测试读者感受",
      keyMoment: "测试关键画面",
      scenes: [
        { goal: "场景目标", location: "场景地点", povCharacter: "POV角色", targetEmotion: "紧张" },
      ],
      characterStates: [
        { characterId: "角色A", emotion: "愤怒", relationshipChanges: "关系恶化" },
      ],
      requiredBeats: ["必达事件1"],
      forbiddenMoves: ["禁止事项1"],
      pendingHookIds: ["hook_001"],
      narrativePosition: "climax",
      plotLine: "支线B",
      interviewCompletedAt: "2026-06-13T00:00:00Z",
    };

    await saveChapterIntents(bookDir, [intent]);
    const loaded = await loadChapterIntents(bookDir);
    expect(loaded.intents).toHaveLength(1);

    const loadedIntent = loaded.intents[0]!;
    expect(loadedIntent.coreNarrative).toBe("测试核心叙述");
    expect(loadedIntent.readerTakeaway).toBe("测试读者感受");
    expect(loadedIntent.keyMoment).toBe("测试关键画面");
    expect(loadedIntent.scenes).toBeDefined();
    expect(loadedIntent.scenes!).toHaveLength(1);
    expect(loadedIntent.scenes![0]?.goal).toBe("场景目标");
    expect(loadedIntent.characterStates).toBeDefined();
    expect(loadedIntent.characterStates!).toHaveLength(1);
    expect(loadedIntent.characterStates![0]?.characterId).toBe("角色A");
    expect(loadedIntent.requiredBeats).toContain("必达事件1");
    expect(loadedIntent.forbiddenMoves).toContain("禁止事项1");
    expect(loadedIntent.pendingHookIds).toContain("hook_001");
    expect(loadedIntent.narrativePosition).toBe("climax");
    expect(loadedIntent.plotLine).toBe("支线B");
    expect(loadedIntent.interviewCompletedAt).toBe("2026-06-13T00:00:00Z");
  });

  it("filters out invalid intents on load", async () => {
    const invalidData = JSON.stringify({
      intents: [
        { chapterNumber: 1, coreNarrative: "valid" },
        { chapterNumber: "not-a-number", coreNarrative: "invalid" },
        { coreNarrative: "missing chapter number" },
        null,
      ],
      updatedAt: new Date().toISOString(),
    });
    await writeFile(join(bookDir, "story", "chapter_intents.json"), invalidData, "utf-8");

    const index = await loadChapterIntents(bookDir);
    expect(index.intents).toHaveLength(1);
    expect(index.intents[0]?.coreNarrative).toBe("valid");
  });
});
