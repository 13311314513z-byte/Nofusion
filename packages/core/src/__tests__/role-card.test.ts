import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  listRoleCards,
  loadRoleCard,
  saveRoleCard,
  deleteRoleCard,
  createRoleCardTemplate,
  parseRoleCardMarkdown,
  buildRoleCardMarkdown,
  type RoleCard,
} from "../models/role-card.js";

describe("role-card", () => {
  let bookDir: string;

  beforeEach(async () => {
    bookDir = await mkdtemp(join(tmpdir(), "inkos-role-"));
  });

  it("parses frontmatter and body", () => {
    const raw = `---
id: alice
name: 爱丽丝
roleTier: major
status: active
povEligible: true
tags:
  - 魔法
  - 少女
aliases:
  - 小艾
---

# 爱丽丝

## 核心身份
魔法师。
`;
    const card = parseRoleCardMarkdown("alice", raw);
    expect(card.id).toBe("alice");
    expect(card.frontmatter.name).toBe("爱丽丝");
    expect(card.frontmatter.roleTier).toBe("major");
    expect(card.frontmatter.status).toBe("active");
    expect(card.frontmatter.povEligible).toBe(true);
    expect(card.frontmatter.tags).toEqual(["魔法", "少女"]);
    expect(card.frontmatter.aliases).toEqual(["小艾"]);
    expect(card.body).toContain("核心身份");
  });

  it("uses the containing directory tier when frontmatter is absent", () => {
    const card = parseRoleCardMarkdown("npc", "## 核心身份\n路人。", "minor");
    expect(card.frontmatter.roleTier).toBe("minor");
  });

  it("builds markdown from card", () => {
    const card = createRoleCardTemplate("bob", "鲍勃", "minor");
    const md = buildRoleCardMarkdown(card);
    expect(md).toContain("id: bob");
    expect(md).toContain("name: 鲍勃");
    expect(md).toContain("roleTier: minor");
    expect(md).toContain("# 鲍勃");
  });

  it("round-trips through file system", async () => {
    const card: RoleCard = {
      id: "charlie",
      frontmatter: {
        id: "charlie",
        name: "查理",
        roleTier: "major",
        status: "active",
        tags: ["战士"],
      },
      body: "## 核心身份\n勇敢的战士。",
    };
    await saveRoleCard(bookDir, card);
    const loaded = await loadRoleCard(bookDir, "charlie");
    expect(loaded).not.toBeNull();
    expect(loaded!.frontmatter.name).toBe("查理");
    expect(loaded!.frontmatter.roleTier).toBe("major");
    expect(loaded!.body).toContain("勇敢的战士");
  });

  it("lists role cards across tiers", async () => {
    await mkdir(join(bookDir, "story", "roles", "主要角色"), { recursive: true });
    await mkdir(join(bookDir, "story", "roles", "次要角色"), { recursive: true });
    await writeFile(
      join(bookDir, "story", "roles", "主要角色", "hero.md"),
      buildRoleCardMarkdown(createRoleCardTemplate("hero", "主角", "major")),
      "utf-8",
    );
    await writeFile(
      join(bookDir, "story", "roles", "次要角色", "npc.md"),
      buildRoleCardMarkdown(createRoleCardTemplate("npc", "路人", "minor")),
      "utf-8",
    );

    const list = await listRoleCards(bookDir);
    expect(list).toHaveLength(2);
    expect(list.map((r) => r.name).sort()).toEqual(["主角", "路人"]);
  });

  it("loads and lists legacy English role directories", async () => {
    await mkdir(join(bookDir, "story", "roles", "major"), { recursive: true });
    await writeFile(
      join(bookDir, "story", "roles", "major", "town.md"),
      buildRoleCardMarkdown(createRoleCardTemplate("town", "通兰县", "major")),
      "utf-8",
    );

    const list = await listRoleCards(bookDir);
    expect(list).toEqual([
      expect.objectContaining({ id: "town", name: "通兰县", roleTier: "major" }),
    ]);
    await expect(loadRoleCard(bookDir, "town")).resolves.toMatchObject({
      id: "town",
      frontmatter: { name: "通兰县" },
    });
  });

  it("keeps punctuation filenames loadable from list ids", async () => {
    await mkdir(join(bookDir, "story", "roles", "次要角色"), { recursive: true });
    await writeFile(
      join(bookDir, "story", "roles", "次要角色", "老程掌柜 (时一堂药房).md"),
      "## 核心身份\n药房掌柜。",
      "utf-8",
    );

    const [item] = await listRoleCards(bookDir);
    expect(item).toMatchObject({
      id: "老程掌柜 (时一堂药房)",
      name: "老程掌柜 (时一堂药房)",
      roleTier: "minor",
    });
    await expect(loadRoleCard(bookDir, item!.id)).resolves.toMatchObject({
      id: "老程掌柜 (时一堂药房)",
      frontmatter: { roleTier: "minor" },
      body: expect.stringContaining("药房掌柜"),
    });
  });

  it("saves legacy English role cards into the canonical Chinese directory without duplicates", async () => {
    await mkdir(join(bookDir, "story", "roles", "major"), { recursive: true });
    await writeFile(
      join(bookDir, "story", "roles", "major", "town.md"),
      buildRoleCardMarkdown(createRoleCardTemplate("town", "通兰县", "major")),
      "utf-8",
    );

    const loaded = await loadRoleCard(bookDir, "town");
    expect(loaded).not.toBeNull();
    await saveRoleCard(bookDir, {
      ...loaded!,
      frontmatter: { ...loaded!.frontmatter, tags: ["地点"] },
    });

    await expect(access(join(bookDir, "story", "roles", "major", "town.md"))).rejects.toThrow();
    await expect(access(join(bookDir, "story", "roles", "主要角色", "town.md"))).resolves.toBeUndefined();
    expect(await listRoleCards(bookDir)).toHaveLength(1);
  });

  it("deletes role card", async () => {
    const card = createRoleCardTemplate("del", "删除", "major");
    await saveRoleCard(bookDir, card);
    expect(await loadRoleCard(bookDir, "del")).not.toBeNull();
    const ok = await deleteRoleCard(bookDir, "del");
    expect(ok).toBe(true);
    expect(await loadRoleCard(bookDir, "del")).toBeNull();
  });

  it("returns null for missing role", async () => {
    expect(await loadRoleCard(bookDir, "missing")).toBeNull();
  });
});
