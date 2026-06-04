import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadChapterGoals,
  saveChapterGoals,
  getChapterGoal,
  upsertChapterGoal,
  removeChapterGoal,
} from "../models/chapter-goal.js";

describe("chapter-goal", () => {
  let bookDir: string;

  beforeEach(async () => {
    bookDir = await mkdtemp(join(tmpdir(), "inkos-goal-"));
  });

  it("loads empty goals when file missing", async () => {
    const index = await loadChapterGoals(bookDir);
    expect(index.goals).toEqual([]);
  });

  it("saves and loads goals", async () => {
    const goals = [
      { chapterNumber: 1, title: "Opening", targetChars: 3000 },
      { chapterNumber: 2, title: "Conflict", povCharacter: "Alice", targetChars: 3500 },
    ];
    await saveChapterGoals(bookDir, goals);
    const index = await loadChapterGoals(bookDir);
    expect(index.goals).toHaveLength(2);
    expect(index.goals[0]!.chapterNumber).toBe(1);
    expect(index.goals[1]!.povCharacter).toBe("Alice");
  });

  it("gets a specific goal", async () => {
    const goals = [
      { chapterNumber: 1, title: "A" },
      { chapterNumber: 2, title: "B" },
    ];
    expect(getChapterGoal(goals, 2)?.title).toBe("B");
    expect(getChapterGoal(goals, 99)).toBeUndefined();
  });

  it("upserts existing goal", async () => {
    const goals = [{ chapterNumber: 1, title: "Old" }];
    const next = upsertChapterGoal(goals, { chapterNumber: 1, title: "New", targetChars: 2000 });
    expect(next).toHaveLength(1);
    expect(next[0]!.title).toBe("New");
    expect(next[0]!.targetChars).toBe(2000);
  });

  it("upserts new goal", async () => {
    const goals = [{ chapterNumber: 1, title: "A" }];
    const next = upsertChapterGoal(goals, { chapterNumber: 2, title: "B" });
    expect(next).toHaveLength(2);
    expect(next[1]!.title).toBe("B");
  });

  it("removes a goal", async () => {
    const goals = [{ chapterNumber: 1, title: "A" }, { chapterNumber: 2, title: "B" }];
    const next = removeChapterGoal(goals, 1);
    expect(next).toHaveLength(1);
    expect(next[0]!.chapterNumber).toBe(2);
  });
});
