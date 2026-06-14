/**
 * Paired Preference Evaluation — comparing two versions of a chapter.
 *
 * Instead of relying on absolute 1-10 scores (which vary across readers),
 * this module uses head-to-head pairwise comparisons: "Which version is better?"
 * This produces more reliable signals with fewer readers.
 *
 * Usage:
 *   1. Collect paired preferences via the CLI tool or manual form
 *   2. Call `computePreferenceMetrics()` to get aggregated results
 *   3. Use the metrics to decide whether a change is an improvement
 *
 * @module
 */

// ─── Data structures ──────────────────────────────────────────────

export interface PairedPreferenceQuestion {
  readonly id: string;
  /** e.g. "哪个更想继续读？", "哪个角色更可信？" */
  readonly text: string;
  readonly answer: "A" | "B" | "tie" | "unable";
  readonly confidence: 1 | 2 | 3 | 4 | 5;
  readonly freeform?: string;
}

export interface PairedPreference {
  readonly pairId: string;
  readonly versionA: string;       // identifier or hash of version A
  readonly versionB: string;       // identifier or hash of version B
  readonly questions: ReadonlyArray<PairedPreferenceQuestion>;
  readonly readerId: string;
  readonly timestamp: string;
  readonly blindingInfo: {
    readonly versionAMasked: boolean;
    readonly versionBMasked: boolean;
  };
  readonly taskMeta?: {
    readonly genre?: string;
    readonly chapterFunction?: string;
    readonly modelA?: string;
    readonly modelB?: string;
    readonly tokensA?: number;
    readonly tokensB?: number;
    readonly latencyA?: number;
    readonly latencyB?: number;
  };
}

// ─── Metrics ──────────────────────────────────────────────────────

export interface PreferenceMetrics {
  /** Overall win rate of version B over A (0-1). */
  readonly winRate: number;
  /** 95% confidence interval for win rate. */
  readonly ci95: [number, number];
  /** Proportion of ties (0-1). */
  readonly tieRate: number;
  /** Total number of paired comparisons considered. */
  readonly totalComparisons: number;
  /** Inter-reader agreement (Fleiss' Kappa, -1 to 1). */
  readonly interReaderAgreement: number;
  /** Break down by question dimension. */
  readonly byDimension: Record<string, {
    readonly winRate: number;
    readonly ci95: [number, number];
    readonly count: number;
  }>;
  /** Defect rates — how often version B introduces new issues. */
  readonly defectDelta: {
    readonly newCriticalIssues: number;
    readonly newWarnings: number;
  };
  /** Cost efficiency — preference gain per additional token. */
  readonly tokenEfficiency: number | null;
}

// ─── Computation ──────────────────────────────────────────────────

/**
 * Compute aggregate metrics from a collection of paired preferences.
 * Filters out "unable" answers before computation.
 */
export function computePreferenceMetrics(
  pairs: ReadonlyArray<PairedPreference>,
): PreferenceMetrics {
  // Collect all valid (non-unable) answers
  const validAnswers = pairs.flatMap((p) =>
    p.questions
      .filter((q) => q.answer !== "unable")
      .map((q) => ({
        ...q,
        readerId: p.readerId,
        pairId: p.pairId,
        dimension: q.id,
        taskMeta: p.taskMeta,
      })),
  );

  const totalComparisons = validAnswers.length;

  // Count wins (B over A), losses, and ties
  let wins = 0;
  let losses = 0;
  let ties = 0;

  for (const a of validAnswers) {
    if (a.answer === "B") wins++;
    else if (a.answer === "A") losses++;
    else if (a.answer === "tie") ties++;
  }

  const decisiveComparisons = wins + losses;
  const winRate = decisiveComparisons > 0 ? wins / decisiveComparisons : 0;
  const tieRate = totalComparisons > 0 ? ties / totalComparisons : 0;

  // Wilson score confidence interval
  const ci95 = computeWilsonCI(wins, decisiveComparisons);

  // Per-dimension breakdown
  const byDimension: Record<string, { winRates: number[]; ties: number; count: number }> = {};
  for (const a of validAnswers) {
    if (!byDimension[a.dimension]) {
      byDimension[a.dimension] = { winRates: [], ties: 0, count: 0 };
    }
    byDimension[a.dimension]!.count++;
    if (a.answer === "B") byDimension[a.dimension]!.winRates.push(1);
    else if (a.answer === "A") byDimension[a.dimension]!.winRates.push(0);
    else if (a.answer === "tie") byDimension[a.dimension]!.ties++;
  }

  const byDimensionMetrics: Record<string, {
    winRate: number;
    ci95: [number, number];
    count: number;
  }> = {};

  for (const [dim, data] of Object.entries(byDimension)) {
    const dimWins = data.winRates.reduce((a, b) => a + b, 0);
    const decisiveCount = data.winRates.length;
    byDimensionMetrics[dim] = {
      winRate: decisiveCount > 0 ? dimWins / decisiveCount : 0,
      ci95: computeWilsonCI(dimWins, decisiveCount),
      count: data.count,
    };
  }

  // Inter-reader agreement using Fleiss' Kappa.
  const interReaderAgreement = computeInterReaderAgreement(pairs);

  // Token efficiency
  const tokenEfficiency = computeTokenEfficiency(pairs);

  return {
    winRate,
    ci95,
    tieRate,
    totalComparisons,
    interReaderAgreement,
    byDimension: byDimensionMetrics,
    defectDelta: { newCriticalIssues: 0, newWarnings: 0 }, // Placeholder — requires defect tracking
    tokenEfficiency,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Wilson score confidence interval for a binomial proportion.
 * Returns [lower, upper] bounds for 95% confidence.
 */
function computeWilsonCI(wins: number, total: number): [number, number] {
  if (total === 0) return [0, 1];
  const z = 1.96; // 95% confidence
  const p = wins / total;
  const denominator = 1 + z * z / total;
  const centre = (p + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denominator;
  return [
    Math.max(0, centre - margin),
    Math.min(1, centre + margin),
  ];
}

/**
 * Compute Fleiss' Kappa across pair/question items.
 * "unable" answers are excluded because they are not preference judgments.
 */
function computeInterReaderAgreement(
  pairs: ReadonlyArray<PairedPreference>,
): number {
  const items = new Map<string, Array<"A" | "B" | "tie">>();
  for (const p of pairs) {
    for (const question of p.questions) {
      if (question.answer === "unable") continue;
      const key = `${p.pairId}:${question.id}`;
      const ratings = items.get(key) ?? [];
      ratings.push(question.answer);
      items.set(key, ratings);
    }
  }

  const eligibleItems = [...items.values()].filter((ratings) => ratings.length >= 2);
  if (eligibleItems.length === 0) return 0;

  const categoryTotals = { A: 0, B: 0, tie: 0 };
  let totalRatings = 0;
  let observedAgreement = 0;

  for (const ratings of eligibleItems) {
    const counts = { A: 0, B: 0, tie: 0 };
    for (const rating of ratings) {
      counts[rating]++;
      categoryTotals[rating]++;
      totalRatings++;
    }
    const n = ratings.length;
    observedAgreement +=
      (counts.A ** 2 + counts.B ** 2 + counts.tie ** 2 - n) / (n * (n - 1));
  }

  const meanObservedAgreement = observedAgreement / eligibleItems.length;
  const expectedAgreement = totalRatings > 0
    ? (categoryTotals.A / totalRatings) ** 2
      + (categoryTotals.B / totalRatings) ** 2
      + (categoryTotals.tie / totalRatings) ** 2
    : 0;

  if (expectedAgreement >= 1) return 1;
  return (meanObservedAgreement - expectedAgreement) / (1 - expectedAgreement);
}

/**
 * Compute preference gain per additional token.
 * Returns null when cost data is unavailable.
 */
function computeTokenEfficiency(
  pairs: ReadonlyArray<PairedPreference>,
): number | null {
  const withCost = pairs.filter((p) => p.taskMeta?.tokensA && p.taskMeta?.tokensB);
  if (withCost.length === 0) return null;

  let totalWinDelta = 0;
  let totalTokenDelta = 0;

  for (const p of withCost) {
    const tokensA = p.taskMeta!.tokensA!;
    const tokensB = p.taskMeta!.tokensB!;
    const tokenDelta = tokensB - tokensA;
    if (tokenDelta <= 0) continue; // Only consider cases where B costs more

    // Win delta: net wins minus losses for this pair
    let netWins = 0;
    for (const q of p.questions) {
      if (q.answer === "B") netWins++;
      else if (q.answer === "A") netWins--;
    }

    totalWinDelta += netWins;
    totalTokenDelta += tokenDelta;
  }

  return totalTokenDelta > 0 ? totalWinDelta / totalTokenDelta : null;
}
