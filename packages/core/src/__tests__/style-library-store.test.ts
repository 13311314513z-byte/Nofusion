import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  addStyleSource,
  createAuthorProfile,
  getAuthorProfile,
  listAuthorProfiles,
} from "../style-library/store.js";

describe("style library store", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "inkos-style-library-"));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("creates a Chinese author id and lists it in the index", async () => {
    await createAuthorProfile(projectRoot, {
      id: "鲁迅",
      name: "鲁迅",
      tags: ["现代文学"],
    });

    const index = await listAuthorProfiles(projectRoot);

    expect(index.authors).toHaveLength(1);
    expect(index.authors[0].id).toBe("鲁迅");
    expect(index.authors[0].name).toBe("鲁迅");
  });

  it("rejects traversal-shaped author and source ids", async () => {
    await expect(createAuthorProfile(projectRoot, {
      id: "../escape",
      name: "bad",
    })).rejects.toThrow(/authorId/);

    await createAuthorProfile(projectRoot, { id: "safe-author", name: "safe" });

    await expect(addStyleSource(projectRoot, {
      authorId: "safe-author",
      sourceId: "../source",
      fileName: "sample.txt",
      fileType: "txt",
      text: "这是一段用于测试的文字。它应该足够安全，不会写到档案库之外。",
    })).rejects.toThrow(/sourceId/);
  });

  it("adds a source, rebuilds the aggregate profile, and rejects duplicate text", async () => {
    await createAuthorProfile(projectRoot, { id: "writer-a", name: "Writer A" });

    const text = [
      "雪落在城门外。灯火一盏一盏暗下去。",
      "有人低声说话，有人停在风里，有人把旧事藏回袖中。",
      "这一夜很长。长到每一次呼吸都像是在翻动一页旧账。",
    ].join("\n\n");

    await addStyleSource(projectRoot, {
      authorId: "writer-a",
      sourceId: "sample-1",
      fileName: "../sample.txt",
      fileType: "txt",
      text,
    });

    const detail = await getAuthorProfile(projectRoot, "writer-a");
    expect(detail?.sources).toHaveLength(1);
    expect(detail?.sources[0].fileName).toBe("sample.txt");
    expect(detail?.profile.sampleStats.sourceCount).toBe(1);
    expect(detail?.profile.sampleStats.totalChars).toBeGreaterThan(0);

    await expect(addStyleSource(projectRoot, {
      authorId: "writer-a",
      sourceId: "sample-2",
      fileName: "duplicate.txt",
      fileType: "txt",
      text,
    })).rejects.toThrow(/Duplicate source text/);

    const sourceFiles = await readFile(
      join(projectRoot, "style-library", "authors", "writer-a", "sources", "sample-1.json"),
      "utf-8",
    );
    expect(sourceFiles).toContain("\"status\": \"ready\"");
  });
});
