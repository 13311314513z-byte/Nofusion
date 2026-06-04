/** Style fingerprint profile extracted from reference text. */

export interface PunctuationRhythm {
  readonly commaRatio: number;
  readonly periodRatio: number;
  readonly questionRatio: number;
  readonly exclamationRatio: number;
  readonly ellipsisRatio: number;
  readonly semicolonRatio: number;
}

export interface SensoryBreakdown {
  readonly visual: number;
  readonly auditory: number;
  readonly tactile: number;
  readonly olfactory: number;
  readonly gustatory: number;
}

export interface StyleFingerprint {
  /** 对话占比 0-1 */
  readonly dialogueRatio: number;
  /** 动作密度 0-1 */
  readonly actionDensity: number;
  /** 心理描写占比 0-1 */
  readonly psychologicalRatio: number;
  /** 感官描写密度 0-1 */
  readonly sensoryDensity: number;
  /** 口语化程度 0-1 */
  readonly colloquialismScore: number;
  /** 修辞密度 0-1 */
  readonly rhetoricDensity: number;
  /** 标点节奏 */
  readonly punctuationRhythm: PunctuationRhythm;
  /** AI腔风险 0-1 */
  readonly aiTellRisk: number;
  /** 五感分布 */
  readonly sensoryBreakdown: SensoryBreakdown;
}

export interface StyleProfile {
  // ─── 基础统计 ───
  readonly avgSentenceLength: number;
  readonly sentenceLengthStdDev: number;
  readonly avgParagraphLength: number;
  readonly paragraphLengthRange: {
    readonly min: number;
    readonly max: number;
  };
  readonly vocabularyDiversity: number;
  readonly topPatterns: ReadonlyArray<string>;
  readonly rhetoricalFeatures: ReadonlyArray<string>;

  // ─── 文风指纹 ───
  readonly fingerprint: StyleFingerprint;

  readonly sourceName?: string;
  readonly analyzedAt?: string;
}
