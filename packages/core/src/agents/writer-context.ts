/**
 * writer-context.ts — context loading & filtering helpers extracted from writer.ts (Phase 3).
 * Pure functions with no dependency on WriterAgent.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

// ─── loadRecentChapters ──────────────────────────────────────────────────────

export async function loadRecentChapters(
  bookDir: string,
  currentChapter: number,
  count = 1,
): Promise<string> {
  const chaptersDir = join(bookDir, "chapters");
  try {
    const files = await readdir(chaptersDir);
    const mdFiles = files
      .filter((f) => f.endsWith(".md") && !f.startsWith("index"))
      .sort()
      .slice(-count);

    if (mdFiles.length === 0) return "";

    const contents = await Promise.all(
      mdFiles.map(async (f) => {
        const content = await readFile(join(chaptersDir, f), "utf-8");
        return content;
      }),
    );

    return contents.join("\n\n---\n\n");
  } catch {
    return "";
  }
}

// ─── readFileOrDefault ───────────────────────────────────────────────────────

export async function readFileOrDefault(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "(文件尚未创建)";
  }
}

// ─── buildStyleFingerprint ───────────────────────────────────────────────────

export function buildStyleFingerprint(styleProfileRaw: string): string | undefined {
  if (!styleProfileRaw || styleProfileRaw === "(文件尚未创建)") return undefined;
  try {
    const profile = JSON.parse(styleProfileRaw);
    const lines: string[] = [];
    if (profile.avgSentenceLength) lines.push(`- 平均句长：${profile.avgSentenceLength}字`);
    if (profile.sentenceLengthStdDev) lines.push(`- 句长标准差：${profile.sentenceLengthStdDev}`);
    if (profile.avgParagraphLength) lines.push(`- 平均段落长度：${profile.avgParagraphLength}字`);
    if (profile.paragraphLengthRange) lines.push(`- 段落长度范围：${profile.paragraphLengthRange.min}-${profile.paragraphLengthRange.max}字`);
    if (profile.vocabularyDiversity) lines.push(`- 词汇多样性(TTR)：${profile.vocabularyDiversity}`);
    if (profile.topPatterns?.length > 0) lines.push(`- 高频句式：${profile.topPatterns.join("、")}`);
    if (profile.rhetoricalFeatures?.length > 0) lines.push(`- 修辞特征：${profile.rhetoricalFeatures.join("、")}`);
    return lines.length > 0 ? lines.join("\n") : undefined;
  } catch (e) {
    console.warn(`[writer] Failed to parse style profile JSON (${styleProfileRaw.length} chars): ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

// ─── extractDialogueFingerprints ─────────────────────────────────────────────

const DIALOGUE_REGEX =
  /(?:(.{1,6})(?:说道|道|喝道|冷声道|笑道|怒道|低声道|大声道|喝骂道|冷笑道|沉声道|喊道|叫道|问道|答道)\s*[：:]\s*["""「]([^"""」]+)["""」])|["""「]([^"""」]{2,})["""」]|"([^"]{2,})"/g;

export function extractDialogueFingerprints(recentChapters: string): string {
  if (!recentChapters) return "";

  const characterDialogues = new Map<string, string[]>();
  let match: RegExpExecArray | null;
  let loopCount = 0;
  const MAX_LOOPS = 10_000;

  DIALOGUE_REGEX.lastIndex = 0;
  while ((match = DIALOGUE_REGEX.exec(recentChapters)) !== null && loopCount++ < MAX_LOOPS) {
    const speaker = match[1]?.trim();
    const line = match[2] ?? match[3] ?? "";
    if (speaker && line.length > 1) {
      const existing = characterDialogues.get(speaker) ?? [];
      characterDialogues.set(speaker, [...existing, line]);
    }
  }

  const fingerprints: string[] = [];
  for (const [character, lines] of characterDialogues) {
    if (lines.length < 2) continue;

    const avgLen = Math.round(lines.reduce((sum, l) => sum + l.length, 0) / lines.length);
    const isShort = avgLen < 15;

    const wordCounts = new Map<string, number>();
    for (const line of lines) {
      for (let i = 0; i < line.length - 1; i++) {
        const bigram = line.slice(i, i + 2);
        wordCounts.set(bigram, (wordCounts.get(bigram) ?? 0) + 1);
      }
    }
    const frequentWords = [...wordCounts.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([w]) => `「${w}」`);

    const markers: string[] = [];
    if (isShort) markers.push("短句为主");
    else markers.push("长句为主");

    const questionCount = lines.filter((l) => l.includes("？") || l.includes("?")).length;
    if (questionCount > lines.length * 0.3) markers.push("反问多");

    if (frequentWords.length > 0) markers.push(`常用${frequentWords.join("")}`);

    fingerprints.push(`${character}：${markers.join("，")}`);
  }

  return fingerprints.length > 0 ? fingerprints.join("；") : "";
}

// ─── loadVoiceProfiles ──────────────────────────────────────────────────────

export async function loadVoiceProfiles(bookDir: string): Promise<string | undefined> {
  const profilesDir = join(bookDir, "story", "voice_profiles");
  let files: string[];
  try {
    files = await readdir(profilesDir);
  } catch {
    return undefined;
  }
  const profiles = files.filter(f => f.endsWith(".json"));
  if (profiles.length === 0) return undefined;

  const chunks: string[] = [];
  for (const file of profiles.slice(0, 10)) {
    try {
      const raw = await readFile(join(profilesDir, file), "utf-8");
      const profile = JSON.parse(raw) as {
        characterName?: string;
        avgSentenceLength?: number;
        sentenceComplexity?: string;
        signaturePhrases?: string[];
        dialogueStyle?: string;
        vocabularyLevel?: string;
      };
      if (!profile.characterName) continue;

      const parts: string[] = [];
      if (profile.avgSentenceLength) {
        parts.push(`句长约${profile.avgSentenceLength}字`);
      }
      if (profile.sentenceComplexity) {
        parts.push(
          profile.sentenceComplexity === "simple" ? "简洁" :
          profile.sentenceComplexity === "complex" ? "复杂" : ""
        );
      }
      if (profile.dialogueStyle) {
        parts.push(
          profile.dialogueStyle === "casual" ? "口语化" :
          profile.dialogueStyle === "formal" ? "正式" : ""
        );
      }
      if (profile.signaturePhrases?.length) {
        parts.push(`口头禅：${profile.signaturePhrases.slice(0, 3).join("、")}`);
      }
      const summary = parts.filter(Boolean).join("，");
      if (summary) {
        chunks.push(`- **${profile.characterName}**：${summary}。`);
      }
    } catch {
      // Corrupt profile — skip
    }
  }

  if (chunks.length === 0) return undefined;
  return `以下是角色声音画像，请在角色对话中遵循每个角色的语言特征：\n\n${chunks.join("\n")}`;
}

// ─── findRelevantSummaries ──────────────────────────────────────────────────

export function findRelevantSummaries(
  chapterSummaries: string,
  volumeOutline: string,
  chapterNumber: number,
): string {
  if (!chapterSummaries || chapterSummaries === "(文件尚未创建)") return "";
  if (!volumeOutline || volumeOutline === "(文件尚未创建)") return "";

  const nameRegex = /[\u4e00-\u9fff]{2,4}(?=[，、。：]|$)/g;
  const outlineNames = new Set<string>();
  let nameMatch: RegExpExecArray | null;
  while ((nameMatch = nameRegex.exec(volumeOutline)) !== null) {
    outlineNames.add(nameMatch[0]);
  }

  const hookRegex = /H\d{2,}/g;
  const hookIds = new Set<string>();
  let hookMatch: RegExpExecArray | null;
  while ((hookMatch = hookRegex.exec(volumeOutline)) !== null) {
    hookIds.add(hookMatch[0]);
  }

  if (outlineNames.size === 0 && hookIds.size === 0) return "";

  const rows = chapterSummaries.split("\n").filter((line) =>
    line.startsWith("|") && !line.startsWith("| 章节") && !line.startsWith("|--") && !line.startsWith("| -"),
  );

  const matchedRows = rows.filter((row) => {
    for (const name of outlineNames) {
      if (row.includes(name)) return true;
    }
    for (const hookId of hookIds) {
      if (row.includes(hookId)) return true;
    }
    return false;
  });

  const filteredRows = matchedRows.filter((row) => {
    const chNumMatch = row.match(/\|\s*(\d+)\s*\|/);
    if (!chNumMatch) return true;
    const num = parseInt(chNumMatch[1]!, 10);
    return num < chapterNumber - 1;
  });

  return filteredRows.length > 0 ? filteredRows.join("\n") : "";
}
