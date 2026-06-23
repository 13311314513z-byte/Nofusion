/**
 * Style diagnostics — advanced text analysis beyond basic stats and fingerprints.
 *
 * Detects intent repetition, repeated descriptions, transition clustering,
 * clause complexity, and aggregates AI-style heuristic risk tags.
 *
 * All detectors are pure functions: no LLM calls, no file I/O.
 */

// ---------------------------------------------------------------------------
// Intent Repetition
// ---------------------------------------------------------------------------

export interface IntentRepetitionFinding {
  readonly kind: "action-expression" | "semantic-intent";
  readonly pattern: string;
  readonly count: number;
  readonly perThousandChars: number;
  readonly confidence: number;
  readonly severity: "high" | "medium" | "low";
  readonly examples: ReadonlyArray<{
    readonly sentence: string;
    readonly start: number;
    readonly end: number;
  }>;
}

// ---------------------------------------------------------------------------
// Intent Repetition — word lists
// ---------------------------------------------------------------------------

const ACTION_EXPRESSION_PATTERNS_ZH: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly label: string;
}> = [
  // Head/eye movements
  { pattern: /转(?:过|了)?(?:身|头)|回(?:过|了)?(?:身|头)|侧(?:过|了)?(?:身|头)/g, label: "转身/回头" },
  { pattern: /看(?:向|着|了|见)|望(?:向|着|见)|盯(?:着|住)|瞥(?:了|见)|扫(?:了|过|视)/g, label: "看向/望" },
  { pattern: /目光|视线|眼神|眼(?:睛|底|神)/g, label: "目光/视线" },
  // Breathing / sighing
  { pattern: /叹(?:了|口|息|气)|深吸(?:一口|了口)气|呼气|吸气/g, label: "叹气/呼吸" },
  // Nodding / shaking head
  { pattern: /点(?:了|了点头|点头)|摇(?:了|摇头|摇头)/g, label: "点头/摇头" },
];

const SEMANTIC_INTENT_PATTERNS_ZH: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly label: string;
}> = [
  // Mental verbs
  { pattern: /(?:他|她|它|人|主角|(?:\S{1,6}))[\u4e00-\u9fff]{0,2}(?:想|觉得|感觉|发现|明白|意识到|察觉到|认为|心想|暗想|寻思)/g, label: "心理活动" },
  // Causal expressions
  { pattern: /因为|所以|因此|于是|从而|导致|使得|让(?:他|她|它)/g, label: "因果表达" },
  // Emotional states
  { pattern: /(?:感到|觉得|心中|心里|心底|情绪|心情)(?:\S{0,4})(?:愤怒|悲伤|快乐|痛苦|焦虑|不安|紧张|放松|绝望|欣喜)/g, label: "情绪状态" },
];

const ACTION_EXPRESSION_PATTERNS_EN: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly label: string;
}> = [
  { pattern: /\b(?:turned|turns|turning)\s+(?:around|back|to|toward)/gi, label: "turn around/to" },
  { pattern: /\b(?:looked|looks|looking|glanced|glancing|stared|staring|gazed|gazing)\s+(?:at|toward|into|up|down)/gi, label: "look/glance at" },
  { pattern: /\b(?:sighed|sighing|sighes)\b/gi, label: "sigh" },
  { pattern: /\b(?:nodded|nodding|shook|shaking)\s+(?:his|her|their|\w+)?\s*head\b/gi, label: "nod/shake head" },
  { pattern: /\b(?:eyes|gaze|stare|glance)\b/gi, label: "eyes/gaze" },
];

const SEMANTIC_INTENT_PATTERNS_EN: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly label: string;
}> = [
  { pattern: /\b(?:he|she|they|the\s+\w+)\s+(?:thought|thoughts|felt|feeling|realized|realizing|wondered|wondering|knew|knowing|decided|deciding|believed|believing)\b/gi, label: "mental verb" },
  { pattern: /\b(?:because|since|therefore|thus|hence|so|as\s+a\s+result)\b/gi, label: "causal expression" },
];

function isChineseText(text: string): boolean {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return chineseChars > text.length * 0.1;
}

function splitIntoSentences(text: string): string[] {
  // Simple sentence split: Chinese punctuation + English sentence endings
  return text
    .replace(/([。！？；.!?;])/g, "$1\n")
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function findMatches(
  text: string,
  patterns: ReadonlyArray<{ readonly pattern: RegExp; readonly label: string }>,
): Array<{ readonly label: string; readonly match: string; readonly index: number }> {
  const results: Array<{ readonly label: string; readonly match: string; readonly index: number }> = [];
  for (const { pattern, label } of patterns) {
    // Reset regex state
    const re = new RegExp(pattern.source, pattern.flags.replace("g", "") + "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      results.push({ label, match: m[0], index: m.index });
    }
  }
  return results.sort((a, b) => a.index - b.index);
}

function computeLocalWindowDensity(
  matches: ReadonlyArray<{ readonly index: number }>,
  textLength: number,
  windowSize = 500,
): number {
  if (matches.length < 2 || textLength === 0) return 0;
  let maxInWindow = 0;
  for (let i = 0; i < matches.length; i++) {
    let count = 1;
    for (let j = i + 1; j < matches.length; j++) {
      if (matches[j].index - matches[i].index <= windowSize) {
        count++;
      } else {
        break;
      }
    }
    if (count > maxInWindow) maxInWindow = count;
  }
  return maxInWindow;
}

export function detectIntentRepetition(
  text: string,
  thresholdPerThousand = 3,
): ReadonlyArray<IntentRepetitionFinding> {
  if (!text || text.trim().length < 50) return [];

  const isZh = isChineseText(text);
  const totalChars = text.length;
  const thousandFactor = Math.max(totalChars, 500) / 1000;

  const actionPatterns = isZh ? ACTION_EXPRESSION_PATTERNS_ZH : ACTION_EXPRESSION_PATTERNS_EN;
  const semanticPatterns = isZh ? SEMANTIC_INTENT_PATTERNS_ZH : SEMANTIC_INTENT_PATTERNS_EN;

  const actionMatches = findMatches(text, actionPatterns);
  const semanticMatches = findMatches(text, semanticPatterns);

  const findings: IntentRepetitionFinding[] = [];

  // Aggregate by label
  function aggregateByLabel(
    matches: ReadonlyArray<{ readonly label: string; readonly match: string; readonly index: number }>,
    kind: "action-expression" | "semantic-intent",
  ): void {
    const byLabel = new Map<string, Array<{ readonly match: string; readonly index: number }>>();
    for (const m of matches) {
      const arr = byLabel.get(m.label) ?? [];
      arr.push(m);
      byLabel.set(m.label, arr);
    }

    for (const [label, ms] of byLabel) {
      if (ms.length < 2) continue;
      const count = ms.length;
      const perThousand = count / thousandFactor;

      // Local window density
      const maxInWindow = computeLocalWindowDensity(ms, totalChars, isZh ? 500 : 300);

      // Confidence: action-expression is rule-based (high), semantic-intent is heuristic (lower)
      const baseConfidence = kind === "action-expression" ? 0.85 : 0.6;
      // Reduce confidence if local density is very high (might be a scene naturally involving the action)
      const densityPenalty = maxInWindow > 5 ? 0.15 : 0;
      // Reduce confidence for very short samples
      const samplePenalty = totalChars < 500 ? 0.2 : 0;
      const confidence = Math.max(0, baseConfidence - densityPenalty - samplePenalty);

      // Severity
      let severity: "high" | "medium" | "low";
      if (totalChars < 500) {
        severity = "low";
      } else if (perThousand >= thresholdPerThousand * 1.5 && maxInWindow >= 3) {
        severity = "high";
      } else if (perThousand >= thresholdPerThousand) {
        severity = "medium";
      } else {
        severity = "low";
      }

      const examples = ms.slice(0, 5).map((m) => {
        // Extract surrounding context (~40 chars)
        const contextStart = Math.max(0, m.index - 20);
        const contextEnd = Math.min(text.length, m.index + m.match.length + 20);
        return {
          sentence: text.slice(contextStart, contextEnd).replace(/\s+/g, " ").trim(),
          start: m.index,
          end: m.index + m.match.length,
        };
      });

      findings.push({
        kind,
        pattern: label,
        count,
        perThousandChars: Math.round(perThousand * 10) / 10,
        confidence: Math.round(confidence * 100) / 100,
        severity,
        examples,
      });
    }
  }

  aggregateByLabel(actionMatches, "action-expression");
  aggregateByLabel(semanticMatches, "semantic-intent");

  // Sort by severity then count
  const severityOrder = { high: 3, medium: 2, low: 1 };
  findings.sort((a, b) => {
    const diff = severityOrder[b.severity] - severityOrder[a.severity];
    return diff !== 0 ? diff : b.count - a.count;
  });

  return findings;
}

// ---------------------------------------------------------------------------
// Repeated Descriptions
// ---------------------------------------------------------------------------

export interface RepeatedDescriptionFinding {
  readonly cluster: string;
  readonly subject?: string;
  readonly matchedPhrases: ReadonlyArray<string>;
  readonly occurrences: ReadonlyArray<{ readonly start: number; readonly end: number }>;
  readonly density: number;
  readonly similarity: number;
  readonly confidence: number;
  readonly severity: "high" | "medium" | "low";
}

// ---------------------------------------------------------------------------
// Repeated Descriptions
// ---------------------------------------------------------------------------

interface DescriptionClusterDef {
  readonly cluster: string;
  readonly subject?: string;
  readonly patterns: ReadonlyArray<RegExp>;
}

const DESCRIPTION_CLUSTERS_ZH: ReadonlyArray<DescriptionClusterDef> = [
  {
    cluster: "眼睛/目光描写",
    subject: "眼睛",
    patterns: [
      /眼睛|目光|眼神|眸子|双眸|瞳孔|眼帘|眼角|眼眶|眼珠|眸光|眼波/g,
    ],
  },
  {
    cluster: "表情/脸色描写",
    subject: "表情",
    patterns: [
      /表情|神情|神色|脸色|面容|面容|神态|模样|样子|神情|神色/g,
    ],
  },
  {
    cluster: "嘴角/微笑描写",
    subject: "嘴",
    patterns: [
      /嘴角|微笑|笑容|笑意|咧嘴|抿嘴|嘴唇|嘴(?:角|边|唇|上)/g,
    ],
  },
  {
    cluster: "手部动作描写",
    subject: "手",
    patterns: [
      /手指|手掌|手腕|手臂|拳头|掌心|手背|指尖|手(?:指|掌|腕|臂|上)/g,
    ],
  },
  {
    cluster: "脚步/身影描写",
    subject: "身影",
    patterns: [
      /脚步|步伐|身影|背影|身形|身姿|身躯|身体|身子|体形|体型/g,
    ],
  },
  {
    cluster: "头发/发丝描写",
    subject: "头发",
    patterns: [
      /头发|发丝|秀发|黑发|长发|短发|发(?:丝|梢|间|上)|青丝/g,
    ],
  },
];

const DESCRIPTION_CLUSTERS_EN: ReadonlyArray<DescriptionClusterDef> = [
  {
    cluster: "eyes/gaze",
    subject: "eyes",
    patterns: [
      /\b(?:eyes?|gaze|stare|glance|look|pupil|iris|eyelid)\b/gi,
    ],
  },
  {
    cluster: "expression/smile",
    subject: "face",
    patterns: [
      /\b(?:expression|smile|grin|frown|face|features|complexion)\b/gi,
    ],
  },
  {
    cluster: "hands/fingers",
    subject: "hands",
    patterns: [
      /\b(?:hand|hands|finger|fingers|palm|wrist|fist|knuckle)\b/gi,
    ],
  },
  {
    cluster: "hair",
    subject: "hair",
    patterns: [
      /\b(?:hair|locks|tresses|strand|curl)\b/gi,
    ],
  },
];

function findDescriptionMatches(
  text: string,
  clusters: ReadonlyArray<DescriptionClusterDef>,
): Map<string, Array<{ readonly match: string; readonly index: number; readonly sentence: string }>> {
  const sentences = splitIntoSentences(text);
  const sentenceRanges: Array<{ readonly start: number; readonly end: number; readonly text: string }> = [];
  let offset = 0;
  for (const s of sentences) {
    const idx = text.indexOf(s, offset);
    const start = idx >= 0 ? idx : offset;
    const end = start + s.length;
    sentenceRanges.push({ start, end, text: s });
    offset = end;
  }

  const result = new Map<string, Array<{ readonly match: string; readonly index: number; readonly sentence: string }>>();

  for (const def of clusters) {
    const matches: Array<{ readonly match: string; readonly index: number; readonly sentence: string }> = [];
    for (const pattern of def.patterns) {
      const re = new RegExp(pattern.source, pattern.flags.replace("g", "") + "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const sr = sentenceRanges.find((r) => r.start <= m!.index && m!.index < r.end);
        matches.push({ match: m[0], index: m.index, sentence: sr?.text ?? "" });
      }
    }
    if (matches.length > 0) {
      result.set(def.cluster, matches);
    }
  }

  return result;
}

function computeDescriptionDensity(
  matches: ReadonlyArray<{ readonly index: number }>,
  textLength: number,
  windowSize = 500,
): number {
  if (matches.length < 2 || textLength === 0) return 0;
  let maxInWindow = 0;
  for (let i = 0; i < matches.length; i++) {
    let count = 1;
    for (let j = i + 1; j < matches.length; j++) {
      if (matches[j].index - matches[i].index <= windowSize) {
        count++;
      } else {
        break;
      }
    }
    if (count > maxInWindow) maxInWindow = count;
  }
  return maxInWindow;
}

export function detectRepeatedDescriptions(
  text: string,
): ReadonlyArray<RepeatedDescriptionFinding> {
  if (!text || text.trim().length < 100) return [];

  const isZh = isChineseText(text);
  const clusters = isZh ? DESCRIPTION_CLUSTERS_ZH : DESCRIPTION_CLUSTERS_EN;
  const matchesByCluster = findDescriptionMatches(text, clusters);
  const textLength = text.length;
  const findings: RepeatedDescriptionFinding[] = [];

  for (const [clusterName, matches] of matchesByCluster) {
    if (matches.length < 3) continue;

    const maxInWindow = computeDescriptionDensity(matches, textLength, isZh ? 500 : 300);
    const perThousand = matches.length / (textLength / 1000);

    // Similarity: rough estimate based on unique match strings vs total matches
    const uniqueMatches = new Set(matches.map((m) => m.match)).size;
    const similarity = uniqueMatches / matches.length;

    // Confidence: higher with more matches and diverse wording, lower with very uniform wording
    let confidence = Math.min(0.9, 0.5 + matches.length * 0.05);
    if (similarity > 0.8) confidence -= 0.15; // Too uniform may be false positive
    if (textLength < 500) confidence -= 0.2;
    confidence = Math.max(0, Math.round(confidence * 100) / 100);

    let severity: "high" | "medium" | "low";
    if (textLength < 500) {
      severity = "low";
    } else if (maxInWindow >= 4 && perThousand >= 5) {
      severity = "high";
    } else if (maxInWindow >= 3 || perThousand >= 3) {
      severity = "medium";
    } else {
      severity = "low";
    }

    const clusterDef = clusters.find((c) => c.cluster === clusterName);
    const uniquePhrases = [...new Set(matches.map((m) => m.sentence.trim()).filter((s) => s.length > 0))].slice(0, 10);

    findings.push({
      cluster: clusterName,
      subject: clusterDef?.subject,
      matchedPhrases: uniquePhrases,
      occurrences: matches.slice(0, 20).map((m) => ({ start: m.index, end: m.index + m.match.length })),
      density: Math.round(maxInWindow * 10) / 10,
      similarity: Math.round(similarity * 100) / 100,
      confidence,
      severity,
    });
  }

  // Sort by severity then count
  const severityOrder = { high: 3, medium: 2, low: 1 };
  findings.sort((a, b) => severityOrder[b.severity] - severityOrder[a.severity]);
  return findings;
}

// ---------------------------------------------------------------------------
// Transition Clustering
// ---------------------------------------------------------------------------

export interface TransitionClusteringFinding {
  readonly transitionWord: string;
  readonly totalCount: number;
  readonly paragraphsWithTransition: number;
  readonly paragraphRatio: number;
  readonly gapParagraphs: ReadonlyArray<number>;
  readonly minGap: number;
  readonly avgGap: number;
  readonly consecutiveTransitions: number;
  readonly severity: "high" | "medium" | "low";
}

interface TransitionDef {
  readonly label: string;
  readonly pattern: RegExp;
}

const TRANSITION_PATTERNS_ZH: ReadonlyArray<TransitionDef> = [
  { label: "于是", pattern: /于是/g },
  { label: "然后", pattern: /然后/g },
  { label: "接着", pattern: /接着/g },
  { label: "之后", pattern: /之后/g },
  { label: "随后", pattern: /随后/g },
  { label: "随即", pattern: /随即/g },
  { label: "忽然", pattern: /忽然/g },
  { label: "突然", pattern: /突然/g },
  { label: "猛然", pattern: /猛然/g },
  { label: "霎时", pattern: /霎时/g },
  { label: "顿时", pattern: /顿时/g },
  { label: "立刻", pattern: /立刻/g },
  { label: "马上", pattern: /马上/g },
  { label: "终于", pattern: /终于/g },
  { label: "但是", pattern: /但是/g },
  { label: "然而", pattern: /然而/g },
  { label: "不过", pattern: /不过/g },
  { label: "可是", pattern: /可是/g },
  { label: "却", pattern: /却/g },
  { label: "又", pattern: /又/g },
  { label: "再", pattern: /再/g },
  { label: "还", pattern: /还/g },
  { label: "也", pattern: /也/g },
  { label: "而且", pattern: /而且/g },
  { label: "并且", pattern: /并且/g },
  { label: "同时", pattern: /同时/g },
  { label: "另外", pattern: /另外/g },
  { label: "因此", pattern: /因此/g },
  { label: "所以", pattern: /所以/g },
  { label: "从而", pattern: /从而/g },
  { label: "因而", pattern: /因而/g },
];

const TRANSITION_PATTERNS_EN: ReadonlyArray<TransitionDef> = [
  { label: "then", pattern: /\bthen\b/gi },
  { label: "suddenly", pattern: /\bsuddenly\b/gi },
  { label: "immediately", pattern: /\bimmediately\b/gi },
  { label: "finally", pattern: /\bfinally\b/gi },
  { label: "meanwhile", pattern: /\bmeanwhile\b/gi },
  { label: "however", pattern: /\bhowever\b/gi },
  { label: "but", pattern: /\bbut\b/gi },
  { label: "yet", pattern: /\byet\b/gi },
  { label: "although", pattern: /\balthough\b/gi },
  { label: "though", pattern: /\bthough\b/gi },
  { label: "nevertheless", pattern: /\bnevertheless\b/gi },
  { label: "also", pattern: /\balso\b/gi },
  { label: "moreover", pattern: /\bmoreover\b/gi },
  { label: "furthermore", pattern: /\bfurthermore\b/gi },
  { label: "additionally", pattern: /\badditionally\b/gi },
  { label: "besides", pattern: /\bbesides\b/gi },
  { label: "therefore", pattern: /\btherefore\b/gi },
  { label: "thus", pattern: /\bthus\b/gi },
  { label: "hence", pattern: /\bhence\b/gi },
  { label: "consequently", pattern: /\bconsequently\b/gi },
  { label: "so", pattern: /\bso\b/gi },
  { label: "as a result", pattern: /\bas a result\b/gi },
];

function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export function detectTransitionClustering(
  text: string,
  language?: "zh" | "en",
): ReadonlyArray<TransitionClusteringFinding> {
  if (!text || text.trim().length < 100) return [];

  const isZh = language ? language === "zh" : isChineseText(text);
  const transitions = isZh ? TRANSITION_PATTERNS_ZH : TRANSITION_PATTERNS_EN;
  const paragraphs = splitIntoParagraphs(text);
  const totalParagraphs = paragraphs.length || 1;
  const findings: TransitionClusteringFinding[] = [];

  for (const { label, pattern } of transitions) {
    const paragraphHits: number[] = [];
    let totalCount = 0;
    let consecutiveTransitions = 0;
    let maxConsecutive = 0;
    let lastHitParagraph = -2;

    for (let i = 0; i < paragraphs.length; i++) {
      const re = new RegExp(pattern.source, pattern.flags.replace("g", "") + "g");
      let countInParagraph = 0;
      while (re.exec(paragraphs[i]) !== null) {
        countInParagraph++;
        totalCount++;
      }

      if (countInParagraph > 0) {
        paragraphHits.push(i);
        if (i - lastHitParagraph === 1) {
          consecutiveTransitions++;
          if (consecutiveTransitions > maxConsecutive) {
            maxConsecutive = consecutiveTransitions;
          }
        } else {
          consecutiveTransitions = countInParagraph > 1 ? countInParagraph - 1 : 0;
          if (consecutiveTransitions > maxConsecutive) {
            maxConsecutive = consecutiveTransitions;
          }
        }
        lastHitParagraph = i;
      }
    }

    if (totalCount < 2) continue;

    const paragraphsWithTransition = paragraphHits.length;
    const paragraphRatio = Math.round((paragraphsWithTransition / totalParagraphs) * 100) / 100;

    const gapParagraphs: number[] = [];
    for (let i = 1; i < paragraphHits.length; i++) {
      gapParagraphs.push(paragraphHits[i] - paragraphHits[i - 1] - 1);
    }
    const minGap = gapParagraphs.length > 0 ? Math.min(...gapParagraphs) : 0;
    const avgGap = gapParagraphs.length > 0
      ? Math.round((gapParagraphs.reduce((a, b) => a + b, 0) / gapParagraphs.length) * 10) / 10
      : 0;

    // Severity based on density and clustering
    let severity: "high" | "medium" | "low";
    const perThousandChars = totalCount / (text.length / 1000);
    if (maxConsecutive >= 3 || (perThousandChars >= 6 && paragraphRatio >= 0.3)) {
      severity = "high";
    } else if (maxConsecutive >= 2 || perThousandChars >= 3 || paragraphRatio >= 0.2) {
      severity = "medium";
    } else {
      severity = "low";
    }

    findings.push({
      transitionWord: label,
      totalCount,
      paragraphsWithTransition,
      paragraphRatio,
      gapParagraphs,
      minGap,
      avgGap,
      consecutiveTransitions: maxConsecutive,
      severity,
    });
  }

  // Sort by severity then totalCount
  const severityOrder = { high: 3, medium: 2, low: 1 };
  findings.sort((a, b) => {
    const diff = severityOrder[b.severity] - severityOrder[a.severity];
    return diff !== 0 ? diff : b.totalCount - a.totalCount;
  });

  return findings;
}

// ---------------------------------------------------------------------------
// Clause Complexity (proxy metrics)
// ---------------------------------------------------------------------------

export interface ClauseComplexityFinding {
  readonly sentence: string;
  readonly position: { readonly start: number; readonly end: number };
  readonly sentenceLength: number;
  readonly separatorCount: number;
  readonly connectiveCount: number;
  readonly estimatedClauseCount: number;
  readonly hasNestedClause: boolean;
  readonly maxAttributeChain: number;
  readonly confidence: number;
  readonly severity: "high" | "medium" | "low";
}

// ---------------------------------------------------------------------------
// Clause Complexity (proxy metrics)
// ---------------------------------------------------------------------------

const CONNECTIVE_PATTERNS_ZH: ReadonlyArray<{ readonly pattern: RegExp; readonly category: string }> = [
  { pattern: /因为|由于|鉴于|考虑到/g, category: "causal" },
  { pattern: /所以|因此|因而|于是|从而|故而/g, category: "causal" },
  { pattern: /但是|然而|不过|可是|却|只是|偏偏/g, category: "contrast" },
  { pattern: /虽然|尽管|即使|即便|纵然|哪怕/g, category: "contrast" },
  { pattern: /如果|假如|假设|倘若|若是|要是/g, category: "conditional" },
  { pattern: /只要|只有|除非|无论|不管|不论/g, category: "conditional" },
  { pattern: /不仅|不但|不只|不光|而且|并且|还|也|又|既/g, category: "coordinate" },
  { pattern: /一边|一方面|另一方面|一则|二则/g, category: "coordinate" },
  { pattern: /同时|另外|此外|再者|否则|不然|反之/g, category: "additive" },
  { pattern: /当|在……时|随着|自从|直到|等到/g, category: "temporal" },
];

const CONNECTIVE_PATTERNS_EN: ReadonlyArray<{ readonly pattern: RegExp; readonly category: string }> = [
  { pattern: /\bbecause\b|\bsince\b|\bas\b/gi, category: "causal" },
  { pattern: /\bso\b|\btherefore\b|\bthus\b|\bhence\b|\bconsequently\b/gi, category: "causal" },
  { pattern: /\bbut\b|\byet\b|\bhowever\b|\bnevertheless\b|\balthough\b|\bthough\b/gi, category: "contrast" },
  { pattern: /\bif\b|\bunless\b|\bprovided\b|\bsupposing\b/gi, category: "conditional" },
  { pattern: /\band\b|\bor\b|\balso\b|\bmoreover\b|\bfurthermore\b|\badditionally\b|\bbesides\b/gi, category: "coordinate" },
  { pattern: /\bwhile\b|\bwhen\b|\bafter\b|\bbefore\b|\buntil\b|\bsince\b|\bmeanwhile\b/gi, category: "temporal" },
  { pattern: /\botherwise\b|\binstead\b/gi, category: "additive" },
];

function countConnectives(sentence: string, language: "zh" | "en"): { count: number; categories: Set<string> } {
  const patterns = language === "zh" ? CONNECTIVE_PATTERNS_ZH : CONNECTIVE_PATTERNS_EN;
  let count = 0;
  const categories = new Set<string>();
  for (const { pattern, category } of patterns) {
    const re = new RegExp(pattern.source, pattern.flags.replace("g", "") + "g");
    while (re.exec(sentence) !== null) {
      count++;
      categories.add(category);
    }
  }
  return { count, categories };
}

function countSeparators(sentence: string, language: "zh" | "en"): number {
  if (language === "zh") {
    return (sentence.match(/[，、；…——]/g) ?? []).length;
  }
  return (sentence.match(/[,;…—]/g) ?? []).length;
}

function maxAttributeChain(sentence: string, language: "zh" | "en"): number {
  if (language === "zh") {
    // Count consecutive 的-structures: 美丽的红色的大的 → 3
    const matches = sentence.match(/(?:[^。，；！？\s]{1,6}的)+/g) ?? [];
    let max = 0;
    for (const m of matches) {
      const deCount = (m.match(/的/g) ?? []).length;
      if (deCount > max) max = deCount;
    }
    return max;
  }
  // English: consecutive adjectives before a noun (simplified)
  const _adjPattern = /\b(?:the|a|an)?\s*(?:\w+\s+){0,5}(?:\w+\s+)(?:\w+\s+)?\w+\b/gi;
  // Simpler: count commas between determiner and noun
  const segments = sentence.split(/\b\w+\b/);
  let max = 0;
  for (const seg of segments) {
    const commaCount = (seg.match(/,/g) ?? []).length;
    if (commaCount > max) max = commaCount;
  }
  return max;
}

export function detectClauseComplexity(
  text: string,
  language: "zh" | "en" = "zh",
): ReadonlyArray<ClauseComplexityFinding> {
  if (!text || text.trim().length < 50) return [];

  const sentences = splitIntoSentences(text);
  const findings: ClauseComplexityFinding[] = [];
  let offset = 0;

  for (const sentence of sentences) {
    const idx = text.indexOf(sentence, offset);
    const start = idx >= 0 ? idx : offset;
    const end = start + sentence.length;
    offset = end;

    const sentenceLength = sentence.length;
    const separatorCount = countSeparators(sentence, language);
    const { count: connectiveCount, categories } = countConnectives(sentence, language);
    const estimatedClauseCount = Math.max(1, separatorCount + connectiveCount);
    const hasNestedClause = categories.size >= 2 || connectiveCount >= 3;
    const attrChain = maxAttributeChain(sentence, language);

    let severity: "high" | "medium" | "low";
    if (sentenceLength > (language === "zh" ? 80 : 120) && estimatedClauseCount >= 4) {
      severity = "high";
    } else if (sentenceLength > (language === "zh" ? 50 : 80) && estimatedClauseCount >= 2) {
      severity = "medium";
    } else if (hasNestedClause || attrChain >= (language === "zh" ? 4 : 3)) {
      severity = "medium";
    } else {
      continue; // Not complex enough to report
    }

    const confidence = Math.min(
      0.95,
      0.5 + (estimatedClauseCount * 0.08) + (hasNestedClause ? 0.1 : 0),
    );

    findings.push({
      sentence: sentence.slice(0, 60),
      position: { start, end },
      sentenceLength,
      separatorCount,
      connectiveCount,
      estimatedClauseCount,
      hasNestedClause,
      maxAttributeChain: attrChain,
      confidence: Math.round(confidence * 100) / 100,
      severity,
    });
  }

  // Sort by severity then estimatedClauseCount
  const severityOrder = { high: 3, medium: 2, low: 1 };
  findings.sort((a, b) => {
    const diff = severityOrder[b.severity] - severityOrder[a.severity];
    return diff !== 0 ? diff : b.estimatedClauseCount - a.estimatedClauseCount;
  });

  return findings;
}

// ---------------------------------------------------------------------------
// AI Style Tag Summary
// ---------------------------------------------------------------------------

export interface AIStyleTagSummary {
  readonly heuristicRiskScore: number;
  readonly confidence: number;
  readonly sampleAdequacy: "insufficient" | "limited" | "sufficient";
  readonly ruleVersion: string;
  readonly paragraphUniformity: number;
  readonly hedgeWordDensity: number;
  readonly transitionWordDensity: number;
  readonly markerWordDensity: number;
  readonly metaNarrationCount: number;
  readonly collectiveShockCount: number;
  readonly reportTermCount: number;
  readonly sermonWordCount: number;
  readonly breakdown: ReadonlyArray<{
    readonly tag: string;
    readonly count: number;
    readonly severity: "critical" | "warning" | "info";
  }>;
}

// ---------------------------------------------------------------------------
// AI Style Tag Summary
// ---------------------------------------------------------------------------

const HEDGE_PATTERNS_ZH = /似乎|好像|大概|可能|也许|某种|一定程度|某种程度上|仿佛|隐约|好似|宛如|犹如|大约|约莫|估计|想必|恐怕|应该|应当|尽量|尽可能|一定程度上/g;
const MARKER_PATTERNS_ZH = /值得注意的是|不难发现|总而言之|综上所述|归根结底|说到底|换句话说|也就是说|换言之|一言以蔽之|总的来说|总体上看|从整体上看/g;
const META_NARRATION_PATTERNS_ZH = /读者可能会想|让我们回到|正如前文所述|前文提到|前文说过|前文已经提到|回到正题|言归正传|暂且不提|暂且不说|让我们把目光转向|故事回到|时间回到|镜头回到/g;
const COLLECTIVE_SHOCK_PATTERNS_ZH = /所有人都惊呆了|全场哗然|众人倒吸一口凉气|所有人都不约而同|全场寂静|众人面面相觑|全场震惊|众人骇然|所有人都愣住了|全场一片死寂/g;
const REPORT_PATTERNS_ZH = /根据|数据显示|研究表明|调查结果|实验证明|统计数据显示|相关数据显示|调查结果显示|实验结果表明|报告显示|研究指出|专家指出|资料显示|数据表明/g;
const SERMON_PATTERNS_ZH = /我们应该|必须认识到|重要的是|值得深思的是|引人深思|发人深省|值得警惕|必须引起|不容忽视|不可小觑|不可忽略|必须重视|应该重视|需要重视|应该认识到|必须明白|应该明白/g;

const HEDGE_PATTERNS_EN = /\b(?:seems?|seemed|apparently|probably|possibly|maybe|perhaps|somewhat|somehow|kind of|sort of|roughly|approximately|likely|presumably|arguably|potentially|theoretically|hypothetically)\b/gi;
const MARKER_PATTERNS_EN = /\b(?:it is worth noting|it is not difficult to find|in summary|in conclusion|in short|to sum up|all in all|in other words|that is to say|to put it another way|overall|on the whole|generally speaking)\b/gi;
const META_NARRATION_PATTERNS_EN = /\b(?:the reader might think|let us return|as mentioned earlier|as previously stated|as discussed earlier|back to the main topic|returning to|let us turn our attention to|the story returns to)\b/gi;
const COLLECTIVE_SHOCK_PATTERNS_EN = /\b(?:everyone was stunned|the whole room fell silent|everyone gasped|all eyes widened|the crowd was shocked|everyone froze|a hush fell over the room)\b/gi;
const REPORT_PATTERNS_EN = /\b(?:according to|data shows|research shows|studies show|statistics show|the survey shows|experiments show|reports show|experts point out|data indicates)\b/gi;
const SERMON_PATTERNS_EN = /\b(?:we should|we must|it is important to|it is worth pondering|thought-provoking|cannot be ignored|must be taken seriously|should be recognized|needs attention|deserves attention)\b/gi;

function countPattern(text: string, pattern: RegExp): number {
  const re = new RegExp(pattern.source, pattern.flags.replace("g", "") + "g");
  let count = 0;
  while (re.exec(text) !== null) count++;
  return count;
}

function computeParagraphUniformity(text: string): number {
  const paragraphs = splitIntoParagraphs(text);
  if (paragraphs.length < 2) return 0;
  const lengths = paragraphs.map((p) => p.length);
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  if (avg === 0) return 0;
  const variance = lengths.reduce((sum, len) => sum + (len - avg) ** 2, 0) / lengths.length;
  const stdDev = Math.sqrt(variance);
  // Coefficient of variation (lower = more uniform, higher = more varied)
  const cv = stdDev / avg;
  // Invert so that high uniformity = high score
  // CV of 0 = perfect uniformity, CV > 0.5 = highly varied
  return Math.min(1, Math.max(0, 1 - cv));
}

export function summarizeAIStyleTags(
  text: string,
  language: "zh" | "en" = "zh",
): AIStyleTagSummary {
  if (!text || text.trim().length < 50) {
    return {
      heuristicRiskScore: 0,
      confidence: 0.2,
      sampleAdequacy: "insufficient",
      ruleVersion: "1.0.0",
      paragraphUniformity: 0,
      hedgeWordDensity: 0,
      transitionWordDensity: 0,
      markerWordDensity: 0,
      metaNarrationCount: 0,
      collectiveShockCount: 0,
      reportTermCount: 0,
      sermonWordCount: 0,
      breakdown: [],
    };
  }

  const isZh = language === "zh";
  const thousandChars = Math.max(text.length, 500) / 1000;

  const hedgeCount = countPattern(text, isZh ? HEDGE_PATTERNS_ZH : HEDGE_PATTERNS_EN);
  const markerCount = countPattern(text, isZh ? MARKER_PATTERNS_ZH : MARKER_PATTERNS_EN);
  const metaCount = countPattern(text, isZh ? META_NARRATION_PATTERNS_ZH : META_NARRATION_PATTERNS_EN);
  const shockCount = countPattern(text, isZh ? COLLECTIVE_SHOCK_PATTERNS_ZH : COLLECTIVE_SHOCK_PATTERNS_EN);
  const reportCount = countPattern(text, isZh ? REPORT_PATTERNS_ZH : REPORT_PATTERNS_EN);
  const sermonCount = countPattern(text, isZh ? SERMON_PATTERNS_ZH : SERMON_PATTERNS_EN);

  // Transition density from detectTransitionClustering
  const transitionFindings = detectTransitionClustering(text, language);
  const transitionTotal = transitionFindings.reduce((sum, f) => sum + f.totalCount, 0);

  const paragraphUniformity = computeParagraphUniformity(text);
  const hedgeWordDensity = Math.round((hedgeCount / thousandChars) * 10) / 10;
  const transitionWordDensity = Math.round((transitionTotal / thousandChars) * 10) / 10;
  const markerWordDensity = Math.round((markerCount / thousandChars) * 10) / 10;

  // Build breakdown
  const breakdown: Array<{ tag: string; count: number; severity: "critical" | "warning" | "info" }> = [];

  function addBreakdown(tag: string, count: number, perThousand: number) {
    if (count === 0) return;
    let severity: "critical" | "warning" | "info";
    if (perThousand >= 3) severity = "critical";
    else if (perThousand >= 1.5) severity = "warning";
    else severity = "info";
    breakdown.push({ tag, count, severity });
  }

  addBreakdown("hedge_words", hedgeCount, hedgeWordDensity);
  addBreakdown("transition_clustering", transitionTotal, transitionWordDensity);
  addBreakdown("marker_phrases", markerCount, markerWordDensity);
  addBreakdown("meta_narration", metaCount, metaCount / thousandChars);
  addBreakdown("collective_shock", shockCount, shockCount / thousandChars);
  addBreakdown("report_terms", reportCount, reportCount / thousandChars);
  addBreakdown("sermon_words", sermonCount, sermonCount / thousandChars);

  // Paragraph uniformity: very high uniformity is suspicious (AI-like)
  if (paragraphUniformity > 0.85 && text.length > 1000) {
    breakdown.push({ tag: "paragraph_uniformity", count: Math.round(paragraphUniformity * 100), severity: "warning" });
  }

  // Calculate heuristic risk score (0-100)
  let score = 0;
  const weights: Record<string, number> = {
    hedge_words: 12,
    transition_clustering: 10,
    marker_phrases: 15,
    meta_narration: 18,
    collective_shock: 20,
    report_terms: 14,
    sermon_words: 12,
    paragraph_uniformity: 8,
  };
  for (const item of breakdown) {
    const weight = weights[item.tag] ?? 10;
    const multiplier = item.severity === "critical" ? 1.0 : item.severity === "warning" ? 0.6 : 0.2;
    score += Math.min(weight, item.count * weight * 0.15) * multiplier;
  }
  score = Math.round(Math.min(100, score));

  const sampleAdequacy: "insufficient" | "limited" | "sufficient" =
    text.length < 500 ? "insufficient" : text.length < 2000 ? "limited" : "sufficient";

  const confidence = sampleAdequacy === "sufficient" ? 0.75 : sampleAdequacy === "limited" ? 0.5 : 0.25;

  // Sort breakdown by severity
  const sevOrder = { critical: 3, warning: 2, info: 1 };
  breakdown.sort((a, b) => sevOrder[b.severity] - sevOrder[a.severity]);

  return {
    heuristicRiskScore: score,
    confidence: Math.round(confidence * 100) / 100,
    sampleAdequacy,
    ruleVersion: "1.0.0",
    paragraphUniformity: Math.round(paragraphUniformity * 100) / 100,
    hedgeWordDensity,
    transitionWordDensity,
    markerWordDensity,
    metaNarrationCount: metaCount,
    collectiveShockCount: shockCount,
    reportTermCount: reportCount,
    sermonWordCount: sermonCount,
    breakdown,
  };
}

// ---------------------------------------------------------------------------
// Full diagnostics runner
// ---------------------------------------------------------------------------

export interface FullStyleDiagnostics {
  readonly sourceHash: string;
  readonly sampleAdequacy: "insufficient" | "limited" | "sufficient";
  readonly ruleVersion: string;
  readonly intentRepetitions: ReadonlyArray<IntentRepetitionFinding>;
  readonly repeatedDescriptions: ReadonlyArray<RepeatedDescriptionFinding>;
  readonly transitionClustering: ReadonlyArray<TransitionClusteringFinding>;
  readonly clauseComplexity: ReadonlyArray<ClauseComplexityFinding>;
  readonly aiStyleTags: AIStyleTagSummary;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function computeTextHash(text: string): string {
  // Simple DJB2-like hash for stable, deterministic fingerprints
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) & 0xffffffff;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Run all diagnostics and return a unified result. */
export function runFullDiagnostics(text: string, language: "zh" | "en" = "zh"): FullStyleDiagnostics {
  return {
    sourceHash: computeTextHash(text),
    sampleAdequacy: text.length < 500 ? "insufficient" : text.length < 2000 ? "limited" : "sufficient",
    ruleVersion: "1.0.0",
    intentRepetitions: detectIntentRepetition(text),
    repeatedDescriptions: detectRepeatedDescriptions(text),
    transitionClustering: detectTransitionClustering(text, language),
    clauseComplexity: detectClauseComplexity(text, language),
    aiStyleTags: summarizeAIStyleTags(text, language),
  };
}
