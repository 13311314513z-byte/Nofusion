import { z } from "zod";
import yaml from "js-yaml";

export const GenreProfileSchema = z.object({
  name: z.string(),
  id: z.string(),
  language: z.enum(["zh", "en"]).default("zh"),
  chapterTypes: z.array(z.string()),
  fatigueWords: z.array(z.string()),
  numericalSystem: z.boolean().default(false),
  powerScaling: z.boolean().default(false),
  eraResearch: z.boolean().default(false),
  pacingRule: z.string().default(""),
  satisfactionTypes: z.array(z.string()).default([]),
  auditDimensions: z.array(z.number()).default([]),

  // ── Genre promises (Stage 3) ─────────────────────────────
  promises: z
    .array(
      z.object({
        id: z.string(),
        description: z.string(),
        importance: z.enum(["core", "expected", "optional"]),
        scope: z.enum(["book", "arc", "chapter-type"]).default("book"),
        expectedWindow: z
          .object({ from: z.number(), to: z.number() })
          .optional(),
        appliesToChapterTypes: z.array(z.string()).optional(),
        overduePolicy: z
          .enum(["info", "warning", "critical"])
          .default("warning"),
      }),
    )
    .default([]),
});

export type GenreProfile = z.infer<typeof GenreProfileSchema>;

export interface ParsedGenreProfile {
  readonly profile: GenreProfile;
  readonly body: string;
}

export function parseGenreProfile(raw: string): ParsedGenreProfile {
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!fmMatch) {
    throw new Error("Genre profile missing YAML frontmatter (--- ... ---)");
  }

  const frontmatter = yaml.load(fmMatch[1]) as Record<string, unknown>;
  const profile = GenreProfileSchema.parse(frontmatter);
  const body = fmMatch[2].trim();

  return { profile, body };
}
