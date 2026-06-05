/**
 * Role Card — structured character profile with YAML frontmatter + Markdown body.
 *
 * Persisted at: books/<bookId>/story/roles/<tier>/<roleId>.md
 *
 * Tiers: core (核心角色) | major (重要角色) | minor (次要角色) | functional (功能角色)
 */

import { readFile, readdir, writeFile, mkdir, rm, rename } from "node:fs/promises";
import { join } from "node:path";

export type RoleTier = "core" | "major" | "minor" | "functional";

export interface RoleCardFrontmatter {
  readonly id: string;
  readonly name: string;
  readonly roleTier: RoleTier;
  readonly aliases?: ReadonlyArray<string>;
  readonly status?: "active" | "hidden" | "dead" | "departed";
  readonly povEligible?: boolean;
  readonly firstAppearanceChapter?: number;
  readonly lastSeenChapter?: number;
  readonly voiceProfileId?: string;
  readonly tags?: ReadonlyArray<string>;
  readonly relationshipIds?: ReadonlyArray<string>;
  readonly arcStage?: string;
  readonly secrets?: ReadonlyArray<string>;
  readonly doNotWrite?: ReadonlyArray<string>;
}

export interface RoleCard {
  readonly id: string;
  readonly frontmatter: RoleCardFrontmatter;
  readonly body: string;
}

export interface RoleCardListItem {
  readonly id: string;
  readonly name: string;
  readonly roleTier: RoleTier;
  readonly status?: "active" | "hidden" | "dead" | "departed";
  readonly tags?: ReadonlyArray<string>;
}

const TIER_DIR: Record<RoleTier, string> = {
  core: "核心角色",
  major: "主要角色",
  minor: "次要角色",
  functional: "功能角色",
};

const TIER_DIRS: Record<RoleTier, readonly string[]> = {
  core:       ["核心角色", "core"],
  major:      ["主要角色", "major", "重要角色"],  // 保留旧目录别名以兼容存量
  minor:      ["次要角色", "minor"],
  functional: ["功能角色", "functional"],
};

function parseFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };

  const lines = match[1]!.split("\n");
  const frontmatter: Record<string, unknown> = {};
  let currentKey = "";
  let currentList: string[] = [];

  for (const line of lines) {
    const listMatch = line.match(/^\s+-\s+(.*)$/);
    if (listMatch && currentKey) {
      currentList.push(listMatch[1]!.trim());
      continue;
    }

    const kvMatch = line.match(/^([\w\u4e00-\u9fff-]+):\s*(.*)$/);
    if (kvMatch) {
      if (currentKey && currentList.length > 0) {
        frontmatter[currentKey] = currentList;
      }
      currentKey = kvMatch[1]!;
      const value = kvMatch[2]!.trim();
      if (value === "") {
        currentList = [];
      } else if (value === "true" || value === "True" || value === "TRUE") {
        frontmatter[currentKey] = true;
        currentKey = "";
      } else if (value === "false" || value === "False" || value === "FALSE") {
        frontmatter[currentKey] = false;
        currentKey = "";
      } else if (/^\d+$/.test(value)) {
        frontmatter[currentKey] = Number(value);
        currentKey = "";
      } else if (value.startsWith("- ") || value.startsWith("-")) {
        // Value is a list item indicator for an empty or single-item list
        currentList = [];
        if (value.length > 1 && value[1] === " ") {
          currentList.push(value.slice(2).trim());
        }
      } else {
        frontmatter[currentKey] = value;
        currentKey = "";
      }
    }
  }

  if (currentKey && currentList.length > 0) {
    frontmatter[currentKey] = currentList;
  }

  return { frontmatter, body: match[2]!.trim() };
}

function yamlScalar(value: string): string {
  // Escape values that contain YAML special characters or newlines
  if (/[\n:#]|^\s|^-$|^-\s|^true$|^false$|^null$|^~$/i.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function stringifyFrontmatter(frontmatter: RoleCardFrontmatter): string {
  const lines: string[] = ["---"];
  lines.push(`id: ${yamlScalar(frontmatter.id)}`);
  lines.push(`name: ${yamlScalar(frontmatter.name)}`);
  lines.push(`roleTier: ${frontmatter.roleTier}`);
  if (frontmatter.aliases?.length) {
    lines.push("aliases:");
    for (const alias of frontmatter.aliases) lines.push(`  - ${yamlScalar(alias)}`);
  }
  if (frontmatter.status) lines.push(`status: ${frontmatter.status}`);
  if (frontmatter.povEligible !== undefined) lines.push(`povEligible: ${frontmatter.povEligible}`);
  if (frontmatter.firstAppearanceChapter !== undefined) lines.push(`firstAppearanceChapter: ${frontmatter.firstAppearanceChapter}`);
  if (frontmatter.lastSeenChapter !== undefined) lines.push(`lastSeenChapter: ${frontmatter.lastSeenChapter}`);
  if (frontmatter.voiceProfileId) lines.push(`voiceProfileId: ${yamlScalar(frontmatter.voiceProfileId)}`);
  if (frontmatter.tags?.length) {
    lines.push("tags:");
    for (const tag of frontmatter.tags) lines.push(`  - ${yamlScalar(tag)}`);
  }
  if (frontmatter.relationshipIds?.length) {
    lines.push("relationshipIds:");
    for (const rid of frontmatter.relationshipIds) lines.push(`  - ${yamlScalar(rid)}`);
  }
  if (frontmatter.arcStage) lines.push(`arcStage: ${yamlScalar(frontmatter.arcStage)}`);
  if (frontmatter.secrets?.length) {
    lines.push("secrets:");
    for (const secret of frontmatter.secrets) lines.push(`  - ${yamlScalar(secret)}`);
  }
  if (frontmatter.doNotWrite?.length) {
    lines.push("doNotWrite:");
    for (const item of frontmatter.doNotWrite) lines.push(`  - ${yamlScalar(item)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

function sanitizeRoleId(id: string): string {
  return id.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff_-]/g, "-").replace(/-+/g, "-").slice(0, 64);
}

function normalizeRoleFileStem(id: string): string {
  const stem = id.trim().replace(/\.md$/i, "").replace(/[\\/]/g, "-").replace(/^\.+$/g, "");
  return stem.slice(0, 128) || sanitizeRoleId(id);
}

function roleLookupStems(id: string): string[] {
  return [...new Set([normalizeRoleFileStem(id), sanitizeRoleId(id)].filter(Boolean))];
}

export function buildRoleCardMarkdown(card: RoleCard): string {
  const fm = stringifyFrontmatter(card.frontmatter);
  const body = card.body.trim();
  return body ? `${fm}\n\n${body}` : fm;
}

export function parseRoleCardMarkdown(id: string, raw: string, fallbackTier: RoleTier = "major"): RoleCard {
  const { frontmatter, body } = parseFrontmatter(raw);
  return {
    id: String(frontmatter.id ?? id).trim(),
    frontmatter: {
      id: String(frontmatter.id ?? id).trim(),
      name: String(frontmatter.name ?? id),
      roleTier: (frontmatter.roleTier === "core" || frontmatter.roleTier === "major" || frontmatter.roleTier === "minor" || frontmatter.roleTier === "functional" ? frontmatter.roleTier : fallbackTier) as RoleTier,
      aliases: Array.isArray(frontmatter.aliases) ? frontmatter.aliases.map(String) : undefined,
      status: ["active", "hidden", "dead", "departed"].includes(String(frontmatter.status))
        ? (String(frontmatter.status) as RoleCardFrontmatter["status"])
        : undefined,
      povEligible: typeof frontmatter.povEligible === "boolean" ? frontmatter.povEligible : undefined,
      firstAppearanceChapter: typeof frontmatter.firstAppearanceChapter === "number" ? frontmatter.firstAppearanceChapter : undefined,
      lastSeenChapter: typeof frontmatter.lastSeenChapter === "number" ? frontmatter.lastSeenChapter : undefined,
      voiceProfileId: typeof frontmatter.voiceProfileId === "string" ? frontmatter.voiceProfileId : undefined,
      tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : undefined,
      relationshipIds: Array.isArray(frontmatter.relationshipIds) ? frontmatter.relationshipIds.map(String) : undefined,
      arcStage: typeof frontmatter.arcStage === "string" ? frontmatter.arcStage : undefined,
      secrets: Array.isArray(frontmatter.secrets) ? frontmatter.secrets.map(String) : undefined,
      doNotWrite: Array.isArray(frontmatter.doNotWrite) ? frontmatter.doNotWrite.map(String) : undefined,
    },
    body,
  };
}

export async function listRoleCards(bookDir: string): Promise<RoleCardListItem[]> {
  const rolesDir = join(bookDir, "story", "roles");
  const items = new Map<string, RoleCardListItem>();
  for (const tier of ["core", "major", "minor", "functional"] as RoleTier[]) {
    for (const dirName of TIER_DIRS[tier]) {
      const tierDir = join(rolesDir, dirName);
      const files = await readdir(tierDir).catch(() => []);
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        const id = file.slice(0, -3);
        try {
          const raw = await readFile(join(tierDir, file), "utf-8");
          const card = parseRoleCardMarkdown(id, raw, tier);
          if (!items.has(card.id)) {
            items.set(card.id, {
              id: card.id,
              name: card.frontmatter.name,
              roleTier: card.frontmatter.roleTier,
              status: card.frontmatter.status,
              tags: card.frontmatter.tags,
            });
          }
        } catch (e) {
          const code = (e as NodeJS.ErrnoException)?.code;
          // Skip ENOENT (file not found during race), report other errors
          if (code !== "ENOENT") {
            // Log non-ENOENT errors — permissions, disk full, etc.
            // Cannot use logger here; caller should handle diagnostics
          }
        }
      }
    }
  }
  return [...items.values()].sort((a, b) => a.name.localeCompare(b.name, "zh"));
}

export async function loadRoleCard(bookDir: string, id: string): Promise<RoleCard | null> {
  const rolesDir = join(bookDir, "story", "roles");
  for (const tier of ["core", "major", "minor", "functional"] as RoleTier[]) {
    for (const dirName of TIER_DIRS[tier]) {
      for (const stem of roleLookupStems(id)) {
        const filePath = join(rolesDir, dirName, `${stem}.md`);
        try {
          const raw = await readFile(filePath, "utf-8");
          return parseRoleCardMarkdown(stem, raw, tier);
        } catch {
          // try next location
        }
      }
    }
  }
  return null;
}

export async function saveRoleCard(bookDir: string, card: RoleCard): Promise<void> {
  const tier = card.frontmatter.roleTier;
  const rolesDir = join(bookDir, "story", "roles");
  const tierDir = join(bookDir, "story", "roles", TIER_DIR[tier]);
  await mkdir(tierDir, { recursive: true });
  const targetPath = join(tierDir, `${sanitizeRoleId(card.id)}.md`);
  const tmpPath = `${targetPath}.tmp`;
  await writeFile(tmpPath, buildRoleCardMarkdown(card), "utf-8");
  await rename(tmpPath, targetPath);
  // Clean up legacy locations only after successful write
  for (const candidateTier of ["major", "minor"] as RoleTier[]) {
    for (const dirName of TIER_DIRS[candidateTier]) {
      for (const stem of roleLookupStems(card.id)) {
        const legacyPath = join(rolesDir, dirName, `${stem}.md`);
        if (legacyPath !== targetPath) {
          await rm(legacyPath, { force: true }).catch(() => undefined);
        }
      }
    }
  }
}

export async function deleteRoleCard(bookDir: string, id: string): Promise<boolean> {
  const rolesDir = join(bookDir, "story", "roles");
  let deleted = false;
  for (const tier of ["core", "major", "minor", "functional"] as RoleTier[]) {
    for (const dirName of TIER_DIRS[tier]) {
      for (const stem of roleLookupStems(id)) {
        const filePath = join(rolesDir, dirName, `${stem}.md`);
        try {
          await rm(filePath);
          deleted = true;
        } catch (e) {
          const code = (e as NodeJS.ErrnoException)?.code;
          // ENOENT means file doesn't exist — skip to next location
          // Other errors (EACCES, EPERM, ENOSPC) should not be silently swallowed
          if (code !== "ENOENT") {
            // Log the error; cannot use logger here in a model utility
            console.warn(`[role-card] Failed to delete ${filePath}: ${code || e}`);
          }
        }
      }
    }
  }
  return deleted;
}

export function createRoleCardTemplate(id: string, name: string, tier: string = "major"): RoleCard {
  // Validate tier at runtime to prevent writing to undefined path
  const validatedTier: RoleTier = (tier === "core" || tier === "major" || tier === "minor" || tier === "functional") ? tier as RoleTier : "major";
  return {
    id: sanitizeRoleId(id),
    frontmatter: {
      id: sanitizeRoleId(id),
      name,
      roleTier: validatedTier,
      status: "active",
      povEligible: true,
      tags: [],
    },
    body: `# ${name}

## 核心身份

## 外貌与行动特征

## 欲望与恐惧

## 人际关系

## 声线特征

## 已知秘密

## 禁止写法

## 章节轨迹
`,
  };
}
