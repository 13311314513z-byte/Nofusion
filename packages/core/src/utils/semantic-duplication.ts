/**
 * Semantic duplication detection
 *
 * Detects repeated rhetorical devices, metaphors, parallelism, and
 * other stylistic patterns that may indicate writer fatigue or
 * AI-generated text patterns.
 *
 * All detectors are pure functions: no LLM calls, no file I/O.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DuplicateRhetoricFinding {
  /** Unique ID for deduplication */
  readonly id: string;
  /** Category of the finding */
  readonly category: RhetoricCategory;
  /** Human-readable label (Chinese) */
  readonly label: string;
  /** Number of occurrences detected */
  readonly count: number;
  /** Occurrences per 1000 characters */
  readonly perThousandChars: number;
  /** Severity */
  readonly severity: "low" | "medium" | "high";
  /** Confidence score 0-1 */
  readonly confidence: number;
  /** Example matches (first 3) */
  readonly examples: ReadonlyArray<{
    readonly text: string;
    readonly lineNumber: number;
  }>;
  /** Position ranges for highlighting */
  readonly ranges: ReadonlyArray<{ readonly start: number; readonly end: number }>;
}

export type RhetoricCategory =
  | "parallelism"       // 排比：连续使用相同结构
  | "metaphor"          // 比喻：像/仿佛/如同/宛如等高频使用
  | "personification"   // 拟人：赋予非人事物人的特征
  | "repetition"        // 反复：同一词语/短语在短距离内重复
  | "transition"        // 过渡词聚集：然而/但是/却/可是等
  | "hyperbole"         // 夸张：极度/无比/无以复加等
  | "rhetorical-question" // 反问：难道/岂能/怎能等
  | "anaphora"          // 首语重复：连续段落以相同词语开头
  | "epistrophe"        // 尾语重复：连续段落以相同词语结尾
  | "parallel-structure"; // 并列结构：不仅…而且…/既…又…等

export interface DuplicateRhetoricResult {
  readonly findings: ReadonlyArray<DuplicateRhetoricFinding>;
  readonly summary: {
    readonly totalFindings: number;
    readonly highCount: number;
    readonly mediumCount: number;
    readonly categories: Partial<Record<RhetoricCategory, number>>;
  };
}

// ---------------------------------------------------------------------------
// Chinese rhetorical pattern definitions
// ---------------------------------------------------------------------------

interface RhetoricPattern {
  readonly category: RhetoricCategory;
  readonly label: string;
  /** One or more regex patterns to match */
  readonly patterns: ReadonlyArray<RegExp>;
  /** Minimum count to report */
  readonly minCount: number;
  /** Severity thresholds [low, medium] (count thresholds) */
  readonly severityThresholds: [number, number];
  /** The distance (in chars) within which to check for clustering */
  readonly clusterDistance?: number;
}

const ZH_PATTERNS: ReadonlyArray<RhetoricPattern> = [
  // =======================================================================
  // 排比 Parallelism — 连续使用相同句式结构
  // =======================================================================
  {
    category: "parallelism",
    label: "排比句式",
    patterns: [
      // 是……，是……，是……
      /是[^。，；！？\n]{4,40}，[^。，；！？\n]{0,10}是/g,
      // 没有……，没有……，没有……
      /没有[^。，；！？\n]{4,40}，[^。，；！？\n]{0,10}没有/g,
      // 有……，有……，有……
      /有[^。，；！？\n]{4,40}，[^。，；！？\n]{0,10}有/g,
      // 就是……，就是……，就是……
      /就是[^。，；！？\n]{4,40}，[^。，；！？\n]{0,10}就是/g,
    ],
    minCount: 3,
    severityThresholds: [5, 10],
    clusterDistance: 500,
  },

  // =======================================================================
  // 比喻 Metaphor — 像/仿佛/如同/宛如/好似/恰似/犹如
  // =======================================================================
  {
    category: "metaphor",
    label: "比喻手法",
    patterns: [
      /像[^。，；！？\n]{4,60}一样/g,
      /像[^。，；！？\n]{4,60}似的/g,
      /仿佛[^。，；！？\n]{4,60}/g,
      /如同[^。，；！？\n]{4,60}/g,
      /宛如[^。，；！？\n]{4,60}/g,
      /好似[^。，；！？\n]{4,60}/g,
      /犹如[^。，；！？\n]{4,60}/g,
      /恰似[^。，；！？\n]{4,60}/g,
      // 如……般
      /如[^，。；！？\n]{2,20}般/g,
    ],
    minCount: 3,
    severityThresholds: [5, 10],
    clusterDistance: 300,
  },

  // =======================================================================
  // 拟人 Personification
  // =======================================================================
  {
    category: "personification",
    label: "拟人手法",
    patterns: [
      // 风/云/雨/月/花/草/树 + 笑了/哭了/叹了口气/发出
      /[风风云雨月花草木夜时光岁阳][^。，；！？\n]{0,10}(?:笑|哭|叹|讲|说|诉|告诉|听|听见|聆听|注视|凝视|张开|伸|拥抱)/g,
      // ……仿佛在说
      /仿佛在[^。，；！？\n]{0,10}说/g,
      // ……似乎在诉说着
      /似乎在[^。，；！？\n]{0,10}诉说/g,
    ],
    minCount: 2,
    severityThresholds: [3, 6],
    clusterDistance: 500,
  },

  // =======================================================================
  // 反复 Repetition — 同一短语在短距离内重复
  // =======================================================================
  {
    category: "repetition",
    label: "词语反复",
    patterns: [
      // 重复的二字词（连续使用两次）
      /([\u4e00-\u9fff]{2,4})[\u3000\s]*\1/g,
    ],
    minCount: 3,
    severityThresholds: [5, 10],
    clusterDistance: 200,
  },

  // =======================================================================
  // 过渡词聚集 Transition clustering
  // =======================================================================
  {
    category: "transition",
    label: "过渡词聚集",
    patterns: [
      /[。！？\n][^。！？\n]{0,30}(?:然而|但是|可是|却|不过|只是|但|而|竟然|居然|偏偏|反倒|反而|当然|自然|其实|事实上|实际上)[^。！？\n]{0,30}[。！？]/g,
    ],
    minCount: 3,
    severityThresholds: [5, 10],
    clusterDistance: 300,
  },

  // =======================================================================
  // 夸张 Hyperbole
  // =======================================================================
  {
    category: "hyperbole",
    label: "夸张修辞",
    patterns: [
      /无以复加/g,
      /无法用[^。，；！？\n]{2,30}形容/g,
      /到了(?:极点|极致|极限)/g,
      /前所未有的/g,
      /(?:世间|天下|古往今来)(?:最|第一)/g,
      /(?:震|惊|吓)[^。，；！？\n]{0,5}(?:天|地|人|世|古|今)/g,
      /(?:汗|泪|血)[^。，；！？\n]{0,3}(?:如|似|若)[^。，；！？\n]{0,6}/g,
    ],
    minCount: 2,
    severityThresholds: [3, 6],
  },

  // =======================================================================
  // 反问 Rhetorical question
  // =======================================================================
  {
    category: "rhetorical-question",
    label: "反问句式",
    patterns: [
      /难道[^。；！？\n]{4,40}[?？]/g,
      /岂[^。；！？\n]{4,40}[?？]/g,
      /怎能[^。；！？\n]{4,40}[?？]/g,
      /何以[^。；！？\n]{4,40}[?？]/g,
      /何尝[^。；！？\n]{4,40}[?？]/g,
      /(?:不是|不就是)[^。；！？\n]{4,40}[?？]/g,
    ],
    minCount: 2,
    severityThresholds: [4, 8],
    clusterDistance: 400,
  },

  // =======================================================================
  // 首语重复 Anaphora — 连续段落以相同字词开头
  // =======================================================================
  {
    category: "anaphora",
    label: "首语重复",
    patterns: [
      // 连续两段以相同2-4字词开头
      /^(.){2,4}(?:[\s\S]*?)^\1{2,4}/gm,
    ],
    minCount: 2,
    severityThresholds: [3, 6],
  },

  // =======================================================================
  // 尾语重复 Epistrophe — 连续段落以相同字词结尾
  // =======================================================================
  {
    category: "epistrophe",
    label: "尾语重复",
    patterns: [
      // 连续两段以相同2-4字结尾
      /([\u4e00-\u9fff]{2,4})\s*$\n\n[\s\S]*?\n\n[\s\S]{0,100}\1\s*$/gm,
    ],
    minCount: 2,
    severityThresholds: [3, 6],
  },

  // =======================================================================
  // 并列结构 Parallel structure — 不仅…而且…/既…又…/一边…一边…
  // =======================================================================
  {
    category: "parallel-structure",
    label: "并列结构",
    patterns: [
      /不仅[^，。；！？\n]{4,40}(?:而且|还|更|也)/g,
      /既[^，。；！？\n]{2,20}(?:又|也)/g,
      /一边[^，。；！？\n]{2,20}一边/g,
      /一方面[^，。；！？\n]{4,40}(?:另一方面|同时)/g,
      /越[^，。；！？\n]{2,10}越/g,
    ],
    minCount: 3,
    severityThresholds: [5, 10],
    clusterDistance: 400,
  },
];

// ---------------------------------------------------------------------------
// Main detection function
// ---------------------------------------------------------------------------

/**
 * Detect repeated rhetorical devices in text.
 * Pure function, no side effects.
 */
export function detectDuplicateRhetoric(text: string, language: "zh" | "en" = "zh"): DuplicateRhetoricResult {
  if (language !== "zh") {
    // English detection not yet implemented
    return { findings: [], summary: { totalFindings: 0, highCount: 0, mediumCount: 0, categories: {} } };
  }

  const findings: Array<DuplicateRhetoricFinding> = [];
  const totalChars = text.length;

  for (const pattern of ZH_PATTERNS) {
    const allMatches: Array<{ text: string; start: number; end: number }> = [];
    const matchSet = new Set<string>();

    for (const regex of pattern.patterns) {
      const cloned = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
      let m: RegExpExecArray | null;
      while ((m = cloned.exec(text)) !== null) {
        // Deduplicate by match text + position
        const key = `${m[0]}-${m.index}`;
        if (!matchSet.has(key)) {
          matchSet.add(key);
          allMatches.push({ text: m[0], start: m.index, end: m.index + m[0].length });
        }
        // Prevent infinite loop on zero-length matches
        if (m.index === cloned.lastIndex) cloned.lastIndex++;
      }
    }

    if (allMatches.length < pattern.minCount) continue;

    // Calculate per-thousand chars
    const perThousandChars = (allMatches.length / totalChars) * 1000;

    // Determine severity
    let severity: "low" | "medium" | "high" = "low";
    if (allMatches.length >= pattern.severityThresholds[0]) {
      severity = "medium";
    }
    if (allMatches.length >= pattern.severityThresholds[1]) {
      severity = "high";
    }

    // Check for clustering (if pattern defines a cluster distance)
    let clusteringFactor = 1;
    if (pattern.clusterDistance) {
      const sortedPositions = allMatches.map((m) => m.start).sort((a, b) => a - b);
      let clusterCount = 0;
      for (let i = 1; i < sortedPositions.length; i++) {
        if (sortedPositions[i] - sortedPositions[i - 1] < pattern.clusterDistance) {
          clusterCount++;
        }
      }
      // Boost severity if matches are clustered
      if (clusterCount >= 3) clusteringFactor = 1.5;
      if (clusterCount >= 6) clusteringFactor = 2;
    }

    // Calculate line numbers
    const lines = text.split("\n");
    const lineMap = new Map<number, number>();
    let charOffset = 0;
    for (let i = 0; i < lines.length; i++) {
      const lineStart = charOffset;
      for (const m of allMatches) {
        if (m.start >= lineStart && m.start < charOffset + lines[i].length + 1) {
          lineMap.set(m.start, i + 1);
        }
      }
      charOffset += lines[i].length + 1;
    }

    const examples = allMatches.slice(0, 3).map((m) => ({
      text: m.text.length > 80 ? m.text.slice(0, 80) + "…" : m.text,
      lineNumber: lineMap.get(m.start) ?? 0,
    }));

    const ranges = allMatches.map((m) => ({ start: m.start, end: m.end }));

    // Compute confidence based on count and clustering
    const confidence = Math.min(0.95, 0.4 + (allMatches.length / 20) * 0.3 + (clusteringFactor - 1) * 0.15);

    findings.push({
      id: `rhetoric-${pattern.category}-${Date.now()}`,
      category: pattern.category,
      label: pattern.label,
      count: allMatches.length,
      perThousandChars: Math.round(perThousandChars * 10) / 10,
      severity: severity === "low"
        ? "low"
        : severity === "medium"
          ? "medium"
          : "high",
      confidence: Math.round(confidence * 100) / 100,
      examples,
      ranges,
    });
  }

  // Build summary
  const categories: Partial<Record<RhetoricCategory, number>> = {};
  let highCount = 0;
  let mediumCount = 0;

  for (const f of findings) {
    categories[f.category] = (categories[f.category] ?? 0) + f.count;
    if (f.severity === "high") highCount++;
    if (f.severity === "medium") mediumCount++;
  }

  return {
    findings,
    summary: {
      totalFindings: findings.length,
      highCount,
      mediumCount,
      categories,
    },
  };
}

// ---------------------------------------------------------------------------
// English pattern definitions (stub — can be extended)
// ---------------------------------------------------------------------------

const EN_PATTERNS: ReadonlyArray<RhetoricPattern> = [
  // Simile — like/as if/as though
  {
    category: "metaphor",
    label: "Simile",
    patterns: [
      /\b(?:like|as\s+if|as\s+though|similar\s+to|reminiscent\s+of)\s+[^.]{10,60}/gi,
    ],
    minCount: 3,
    severityThresholds: [5, 10],
    clusterDistance: 300,
  },
  // Rhetorical questions
  {
    category: "rhetorical-question",
    label: "Rhetorical question",
    patterns: [
      /\b(?:wouldn't|couldn't|shouldn't|isn't|aren't|wasn't|weren't|don't|doesn't|didn't)\s+(?:it|he|she|they|you|we)\s+/gi,
    ],
    minCount: 2,
    severityThresholds: [4, 8],
    clusterDistance: 400,
  },
];
