/**
 * Pipeline Style (D10) — extracted from runner.ts.
 *
 * Contains generateStyleGuide and buildDeterministicStyleGuide.
 */
import type { PipelineContext } from "./context.js";
import type { GenreProfile } from "../models/genre-profile.js";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { chatCompletion } from "../llm/provider.js";
import { buildWritingMethodologySection } from "../utils/writing-methodology.js";

export interface StyleDeps {
  bookDir: (bookId: string) => string;
  loadBookConfig: (bookId: string) => Promise<{ language?: string }>;
  loadGenreProfile: (genre: string) => Promise<{ profile: GenreProfile }>;
}

export async function generateStyleGuide(
  ctx: PipelineContext,
  bookId: string,
  referenceText: string,
  sourceName: string | undefined,
  deps: StyleDeps,
): Promise<string> {
  const sample = referenceText.trim();
  if (!sample) throw new Error("Reference text is required for style extraction.");

  const { analyzeStyle } = await import("../agents/style-analyzer.js");
  const bookDir = deps.bookDir(bookId);
  const storyDir = join(bookDir, "story");
  await mkdir(storyDir, { recursive: true });

  const profile = analyzeStyle(sample, sourceName);
  await writeFile(join(storyDir, "style_profile.json"), JSON.stringify(profile, null, 2), "utf-8");

  const book = await deps.loadBookConfig(bookId);
  const { profile: gp } = await deps.loadGenreProfile((book as { genre?: string }).genre ?? "xuanhuan");
  const lang: "zh" | "en" = (book.language ?? gp.language) === "en" ? "en" : "zh";

  let qualitativeGuide: string;
  if (sample.length < 500) {
    qualitativeGuide = buildDeterministicStyleGuide(profile, {
      language: lang,
      reason: lang === "en"
        ? `The sample is short (${sample.length} chars), so this guide uses the statistical fingerprint instead of LLM qualitative extraction.`
        : `样本文本较短（${sample.length}字），本次先使用统计指纹生成文风指南，不强行调用 LLM 做定性拆解。`,
    });
  } else {
    try {
      const response = await chatCompletion(ctx.config.client, ctx.config.model, [
        { role: "system", content: BUILD_STYLE_ANALYSIS_SYSTEM_PROMPT },
        { role: "user", content: `分析以下参考文本的写作风格：\n\n${sample.slice(0, 20000)}` },
      ], { temperature: 0.3 });
      qualitativeGuide = response.content.trim()
        ? response.content
        : buildDeterministicStyleGuide(profile, {
            language: lang,
            reason: lang === "en" ? "The LLM returned empty style analysis; using the statistical fingerprint fallback." : "LLM 未返回有效文风分析，本次使用统计指纹兜底生成文风指南。",
          });
    } catch (error) {
      qualitativeGuide = buildDeterministicStyleGuide(profile, {
        language: lang,
        reason: lang === "en"
          ? `LLM qualitative extraction failed: ${error instanceof Error ? error.message : String(error)}. Using the statistical fingerprint fallback.`
          : `LLM 定性拆解失败：${error instanceof Error ? error.message : String(error)}。本次使用统计指纹兜底生成文风指南。`,
      });
    }
  }

  const craftMethodology = buildWritingMethodologySection(lang);
  const fullStyleGuide = `${qualitativeGuide}\n\n${craftMethodology}`;
  await writeFile(join(storyDir, "style_guide.md"), fullStyleGuide, "utf-8");
  return fullStyleGuide;
}

const BUILD_STYLE_ANALYSIS_SYSTEM_PROMPT = `你是一位文学风格分析专家。分析参考文本的写作风格，提取可供模仿的定性特征。

输出格式（Markdown）：
## 叙事声音与语气
（冷峻/热烈/讽刺/温情/...，附1-2个原文例句）

## 对话风格
（角色说话的共性特征：句子长短、口头禅倾向、方言痕迹、对话节奏）

## 场景描写特征
（五感偏好、意象选择、描写密度、环境与情绪的关联方式）

## 转折与衔接手法
（场景如何切换、时间跳跃的处理方式、段落间的过渡特征）

## 节奏特征
（长短句分布、段落长度偏好、高潮/舒缓的交替方式）

## 词汇偏好
（高频特色用词、比喻/修辞倾向、口语化程度）

## 情绪表达方式
（直白抒情 vs 动作外化、内心独白的频率和风格）

## 独特习惯
（任何值得模仿的个人写作习惯）

分析必须基于原文实际特征，不要泛泛而谈。每个部分用1-2个原文例句佐证。`;

export function buildDeterministicStyleGuide(
  profile: {
    readonly avgSentenceLength: number;
    readonly sentenceLengthStdDev: number;
    readonly avgParagraphLength: number;
    readonly vocabularyDiversity: number;
    readonly topPatterns: ReadonlyArray<string>;
    readonly rhetoricalFeatures: ReadonlyArray<string>;
    readonly sourceName?: string;
  },
  options: { readonly language: "zh" | "en"; readonly reason: string },
): string {
  if (options.language === "en") {
    return [
      "# Style Guide", "", `> ${options.reason}`, "",
      "## Statistical Fingerprint",
      `- Source: ${profile.sourceName ?? "unknown"}`,
      `- Average sentence length: ${profile.avgSentenceLength}`,
      `- Sentence length variance: ${profile.sentenceLengthStdDev}`,
      `- Average paragraph length: ${profile.avgParagraphLength}`,
      `- Vocabulary diversity: ${Math.round(profile.vocabularyDiversity * 100)}%`,
      profile.topPatterns.length > 0 ? `- Repeated openings: ${profile.topPatterns.join(", ")}` : "- Repeated openings: none obvious in this sample",
      profile.rhetoricalFeatures.length > 0 ? `- Rhetorical features: ${profile.rhetoricalFeatures.join(", ")}` : "- Rhetorical features: none obvious in this sample",
      "", "## How To Use",
      "- Treat this as a lightweight style fingerprint, not a full imitation bible.",
      "- Keep sentence and paragraph rhythm close to the sample when drafting.",
      "- If this guide feels too thin, import a longer excerpt later; the file will be replaced.",
    ].join("\n");
  }

  return [
    "# 文风指南", "", `> ${options.reason}`, "",
    "## 统计风格指纹",
    `- 来源：${profile.sourceName ?? "unknown"}`,
    `- 平均句长：${profile.avgSentenceLength}`,
    `- 句长波动：${profile.sentenceLengthStdDev}`,
    `- 平均段落长度：${profile.avgParagraphLength}`,
    `- 词汇多样性：${Math.round(profile.vocabularyDiversity * 100)}%`,
    profile.topPatterns.length > 0 ? `- 高频句式：${profile.topPatterns.join("、")}` : "- 高频句式：本样本中无显著句式重复",
    profile.rhetoricalFeatures.length > 0 ? `- 修辞特征：${profile.rhetoricalFeatures.join("、")}` : "- 修辞特征：本样本中无显著修辞重复",
    "", "## 使用说明",
    "- 本文件是文风指纹，不是全量仿写宝典。",
    "- 草稿阶段尽量保持句长和段落节奏与样本一致。",
    "- 如觉得本指南过浅，可导入更长文段，系统会替换本文件。",
  ].join("\n");
}
