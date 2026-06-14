/**
 * Distillation generator — produce structured distillation drafts from author profiles.
 *
 * The generator is a pure function: no file I/O, no LLM calls.
 * It reads from AuthorStyleProfile + sources + evidence and outputs
 * an AuthorDistillation object and its Markdown projection.
 *
 * DistillationStore handles all file persistence separately.
 */

import type {
  AuthorStyleProfile,
  StyleSourceDocument,
  AuthorDistillation,
  DistillationRule,
  DistillationEvidence,
  DistillationStatus,
  SampleAdequacyLevel,
} from "./models.js";
import type { StyleFingerprint } from "../models/style-profile.js";
import type { StyleProfile } from "../models/style-profile.js";

// ---------------------------------------------------------------------------
// Input / Output
// ---------------------------------------------------------------------------

export interface DistillationInput {
  readonly profile: AuthorStyleProfile;
  readonly sources: ReadonlyArray<StyleSourceDocument>;
  readonly evidence: ReadonlyArray<DistillationEvidence>;
  readonly previous?: AuthorDistillation;
}

export interface DistillationOutput {
  readonly distillation: AuthorDistillation;
  readonly markdown: string;
}

// ---------------------------------------------------------------------------
// Sample adequacy evaluation
// ---------------------------------------------------------------------------

export interface AdequacyResult {
  readonly level: SampleAdequacyLevel;
  readonly confidence: number;
  readonly warnings: ReadonlyArray<string>;
}

export function evaluateAuthorSampleAdequacy(
  sampleStats: AuthorStyleProfile["sampleStats"],
  sources: ReadonlyArray<StyleSourceDocument>,
): AdequacyResult {
  const warnings: string[] = [];
  const readySources = sources.filter((s) => s.status === "ready");
  const readyCount = readySources.length;
  const totalChars = readySources.reduce((sum, s) => sum + s.charCount, 0);

  if (readyCount === 0 || totalChars < 1000) {
    return {
      level: "insufficient",
      confidence: 0,
      warnings: ["没有足够的有效样本（需要至少 1,000 字）"],
    };
  }

  if (readyCount < 2 || totalChars < 3000) {
    return {
      level: "limited",
      confidence: 0.3,
      warnings: ["样本数量或字数不足，生成的规则可靠性有限"],
    };
  }

  if (readyCount < 3 || totalChars < 15000) {
    return {
      level: "sufficient",
      confidence: 0.6,
      warnings: ["样本基本充足，但建议增加更多来源以提高置信度"],
    };
  }

  return {
    level: "sufficient",
    confidence: 0.85,
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// Automatic rule builder
// ---------------------------------------------------------------------------

function buildAutomaticRules(
  profile: StyleProfile,
  adequacy: AdequacyResult,
): DistillationRule[] {
  const rules: DistillationRule[] = [];
  const fp = profile.fingerprint;

  // Sentence length
  if (profile.avgSentenceLength > 0) {
    const range: { min: number; max: number } = {
      min: Math.max(5, Math.round(profile.avgSentenceLength * 0.7)),
      max: Math.round(profile.avgSentenceLength * 1.3),
    };
    rules.push({
      id: "rule-sentence-length",
      dimension: "sentence-length",
      mode: "target-range",
      instruction: `句子长度控制在 ${range.min}-${range.max} 字`,
      targetRange: range,
      confidence: adequacy.confidence,
      source: "automatic",
      enabled: true,
    });
  }

  // Dialogue ratio
  rules.push({
    id: "rule-dialogue-ratio",
    dimension: "dialogue",
    mode: "target-range",
    instruction: `对话占比保持在 ${(fp.dialogueRatio * 100).toFixed(0)}% 左右`,
    targetRange: {
      min: Math.max(0, Math.round((fp.dialogueRatio - 0.1) * 100)),
      max: Math.min(100, Math.round((fp.dialogueRatio + 0.1) * 100)),
    },
    confidence: adequacy.confidence,
    source: "automatic",
    enabled: true,
  });

  // Rhetoric density
  if (fp.rhetoricDensity > 0) {
    const threshold = Math.round((fp.rhetoricDensity + 0.05) * 100) / 100;
    rules.push({
      id: "rule-rhetoric-density",
      dimension: "rhetoric",
      mode: "avoid",
      instruction: `修辞密度控制在 ${threshold} 以下，避免过度修饰`,
      targetRange: { min: 0, max: threshold },
      confidence: adequacy.confidence,
      source: "automatic",
      enabled: true,
    });
  }

  // Action density
  rules.push({
    id: "rule-action-density",
    dimension: "action",
    mode: "target-range",
    instruction: `动作描写密度保持在 ${(fp.actionDensity * 100).toFixed(0)}% 左右`,
    targetRange: {
      min: Math.max(0, Math.round((fp.actionDensity - 0.1) * 100)),
      max: Math.min(100, Math.round((fp.actionDensity + 0.1) * 100)),
    },
    confidence: adequacy.confidence,
    source: "automatic",
    enabled: true,
  });

  // Colloquialism
  if (fp.colloquialismScore > 0.3) {
    rules.push({
      id: "rule-colloquialism",
      dimension: "vocabulary",
      mode: "prefer",
      instruction: "偏向口语化叙事风格，多使用日常用语",
      confidence: adequacy.confidence,
      source: "automatic",
      enabled: true,
    });
  } else {
    rules.push({
      id: "rule-colloquialism",
      dimension: "vocabulary",
      mode: "prefer",
      instruction: "偏向书面语叙事风格，保持语言精炼",
      confidence: adequacy.confidence,
      source: "automatic",
      enabled: true,
    });
  }

  return rules;
}

// ---------------------------------------------------------------------------
// Manual override merge
// ---------------------------------------------------------------------------

function mergeManualOverrides(
  automatic: ReadonlyArray<DistillationRule>,
  previous: ReadonlyArray<DistillationRule>,
): DistillationRule[] {
  const manualRules = previous.filter((r) => r.source === "manual");

  const merged = automatic.map((auto) => {
    // Check if any manual rule overrides this automatic one by ID
    const override = previous.find(
      (p) => p.id === auto.id && p.source === "manual",
    );
    if (override) return { ...override, source: "manual" as const };

    // Check if a manual rule with same dimension exists
    const dimOverride = manualRules.find(
      (m) => m.dimension === auto.dimension,
    );
    if (dimOverride) {
      return {
        ...auto,
        instruction: dimOverride.instruction,
        targetRange: dimOverride.targetRange,
        mode: dimOverride.mode,
        enabled: dimOverride.enabled,
        confidence: Math.max(auto.confidence, dimOverride.confidence),
      };
    }

    return auto;
  });

  // Add manual rules that don't have an automatic counterpart
  for (const manual of manualRules) {
    if (!merged.some((m) => m.id === manual.id)) {
      merged.push(manual);
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

function renderDistillationMarkdown(
  distillation: AuthorDistillation,
  profile: AuthorStyleProfile,
  evidence: ReadonlyArray<DistillationEvidence>,
): string {
  const fp = profile.aggregateProfile.fingerprint;
  const stats = profile.aggregateProfile;

  const frontmatter = [
    "---",
    `name: ${profile.name} 风格定义`,
    `version: ${distillation.version}.0.0`,
    `type: author-distillation`,
    `language: ${profile.language}`,
    `sourceCount: ${profile.sampleStats.sourceCount}`,
    `totalChars: ${profile.sampleStats.totalChars}`,
    `analyzedAt: ${distillation.generatedAt}`,
    `status: ${distillation.status}`,
    `sampleAdequacy: ${distillation.sampleAdequacy}`,
    `confidence: ${distillation.confidence}`,
    `tags: [${profile.tags.join(", ")}]`,
    "---",
  ].join("\n");

  // Numerical fingerprint table
  const fpTable = [
    "| 维度 | 值 |",
    "|------|:--:|",
    `| 平均句长 | ${stats.avgSentenceLength} 字 |`,
    `| 词汇多样性 | ${(stats.vocabularyDiversity * 100).toFixed(0)}% |`,
    `| 对话占比 | ${(fp.dialogueRatio * 100).toFixed(0)}% |`,
    `| 动作密度 | ${(fp.actionDensity * 100).toFixed(0)}% |`,
    `| 心理占比 | ${(fp.psychologicalRatio * 100).toFixed(0)}% |`,
    `| 口语化程度 | ${(fp.colloquialismScore * 100).toFixed(0)}% |`,
    `| 修辞密度 | ${(fp.rhetoricDensity * 100).toFixed(0)}% |`,
  ].join("\n");

  // Rules section
  const enabledRules = distillation.rules.filter((r) => r.enabled);
  const ruleLines = enabledRules.map((r) => {
    const rangeStr = r.targetRange
      ? ` [${r.targetRange.min}-${r.targetRange.max}]`
      : "";
    const srcLabel = r.source === "manual" ? "🖊️" : "🤖";
    return `- ${srcLabel} ${r.instruction}${rangeStr}`;
  });

  // Evidence section
  const approvedEvidence = evidence.filter((e) => e.approved);
  const evidenceLines = approvedEvidence.slice(0, 5).map((e) => {
    return `> ${e.excerpt} *(来源: ${e.sourceName}${e.lineNumber ? ` L${e.lineNumber}` : ""})*`;
  });

  // Warnings
  const warningLines = distillation.warnings.map((w) => `- ⚠️ ${w}`);

  return [
    frontmatter,
    "",
    `# ${profile.name} — 文风蒸馏`,
    "",
    `> 状态: **${distillation.status}** | 样本: ${profile.sampleStats.sourceCount} 个 | 字数: ${profile.sampleStats.totalChars.toLocaleString()}`,
    `> 充分度: ${distillation.sampleAdequacy} | 置信度: ${(distillation.confidence * 100).toFixed(0)}%`,
    "",
    "## 1. 数值指纹",
    "",
    fpTable,
    "",
    "## 2. 蒸馏规则",
    "",
    ...(ruleLines.length > 0 ? ruleLines : ["（暂无启用规则）"]),
    "",
    "## 3. 样本证据",
    "",
    ...(evidenceLines.length > 0 ? evidenceLines : ["（暂无已审核的样本证据）"]),
    "",
    ...(distillation.warnings.length > 0
      ? [`## 4. 警告`, "", ...warningLines, ""]
      : []),
    "",
    "---",
    "",
    `*由 InkOS Studio 于 ${distillation.generatedAt.slice(0, 10)} 自动生成 | 版本 ${distillation.version}*`,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

/**
 * Generate a distillation draft from an author profile.
 * Pure function: no side effects.
 */
export function generateDistillation(input: DistillationInput): DistillationOutput {
  const adequacy = evaluateAuthorSampleAdequacy(
    input.profile.sampleStats,
    input.sources,
  );
  const automaticRules = buildAutomaticRules(
    input.profile.aggregateProfile,
    adequacy,
  );
  const rules = mergeManualOverrides(
    automaticRules,
    input.previous?.rules ?? [],
  );

  const distillation: AuthorDistillation = {
    authorId: input.profile.id,
    authorProfileVersion: input.profile.version,
    version: input.previous?.status === "published"
      ? input.previous.version + 1
      : input.previous?.version ?? 1,
    status: "draft",
    generatedAt: new Date().toISOString(),
    sampleAdequacy: adequacy.level,
    confidence: adequacy.confidence,
    rules,
    evidenceRefs: input.evidence
      .filter((item) => item.approved)
      .map((item) => item.id),
    warnings: adequacy.warnings,
  };

  return {
    distillation,
    markdown: renderDistillationMarkdown(distillation, input.profile, input.evidence),
  };
}
