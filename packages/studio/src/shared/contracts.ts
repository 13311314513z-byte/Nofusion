/**
 * Shared TypeScript contracts for Studio API/UI communication.
 * Ported from PR #96 (Te9ui1a) — prevents client/server type drift.
 */

// --- Health ---

export interface HealthStatus {
  readonly status: "ok";
  readonly projectRoot: string;
  readonly projectConfigFound: boolean;
  readonly envFound: boolean;
  readonly projectEnvFound: boolean;
  readonly globalConfigFound: boolean;
  readonly bookCount: number;
  readonly provider: string | null;
  readonly model: string | null;
}

// --- Books ---

export interface BookSummary {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly platform: string;
  readonly genre: string;
  readonly targetChapters: number;
  readonly chapters: number;
  readonly chapterCount: number;
  readonly lastChapterNumber: number;
  readonly totalWords: number;
  readonly approvedChapters: number;
  readonly pendingReview: number;
  readonly pendingReviewChapters: number;
  readonly failedReview: number;
  readonly failedChapters: number;
  readonly recentRunStatus?: string | null;
  readonly updatedAt: string;
}

export interface BookDetail extends BookSummary {
  readonly createdAt: string;
  readonly chapterWordCount: number;
  readonly language: "zh" | "en" | null;
}

// --- Chapters ---

export interface ChapterSummary {
  readonly number: number;
  readonly title: string;
  readonly status: string;
  readonly wordCount: number;
  readonly auditIssueCount: number;
  readonly updatedAt: string;
  readonly fileName: string | null;
}

export interface ChapterDetail extends ChapterSummary {
  readonly auditIssues: ReadonlyArray<string>;
  readonly reviewNote?: string;
  readonly content: string;
}

export interface SaveChapterPayload {
  readonly content: string;
}

// --- Truth Files ---

export interface TruthFileSummary {
  readonly name: string;
  readonly label: string;
  readonly exists: boolean;
  readonly path: string;
  readonly optional: boolean;
  readonly available: boolean;
}

export interface TruthFileDetail extends TruthFileSummary {
  readonly content: string | null;
}

// --- Review ---

export interface ReviewActionPayload {
  readonly chapterNumber: number;
  readonly reason?: string;
}

// --- Runs ---

export type RunAction = "draft" | "audit" | "revise" | "write-next";

export type RunStatus = "queued" | "running" | "succeeded" | "failed";

export interface RunLogEntry {
  readonly timestamp: string;
  readonly level: "info" | "warn" | "error";
  readonly message: string;
}

export interface RunActionPayload {
  readonly chapterNumber?: number;
}

export interface StudioRun {
  readonly id: string;
  readonly bookId: string;
  readonly chapter: number | null;
  readonly chapterNumber: number | null;
  readonly action: RunAction;
  readonly status: RunStatus;
  readonly stage: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly logs: ReadonlyArray<RunLogEntry>;
  readonly result?: unknown;
  readonly error?: string;
}

export interface RunStreamEvent {
  readonly type: "snapshot" | "status" | "stage" | "log";
  readonly runId: string;
  readonly run?: StudioRun;
  readonly status?: RunStatus;
  readonly stage?: string;
  readonly log?: RunLogEntry;
  readonly result?: unknown;
  readonly error?: string;
}

// --- Style Preprocess Inspection ---

export type InspectionCode =
  | "explicit-think-block"
  | "similar-paragraphs"
  | "repeated-phrase"
  | "mixed-language"
  | "encoded-data"
  | "asr-marker"
  | "translation-pair"
  | "quote-block"
  | "rp-marker"
  | "high-whitespace"
  | "possible-garbled-text"
  // === 语义查重（修辞重复检测）===
  | "duplicate-parallelism"       // 排比句式
  | "duplicate-metaphor"          // 比喻手法
  | "duplicate-personification"   // 拟人手法
  | "duplicate-repetition"        // 词语反复
  | "duplicate-transition"        // 过渡词聚集
  | "duplicate-hyperbole"         // 夸张修辞
  | "duplicate-rhetorical-question" // 反问句式
  | "duplicate-anaphora"          // 首语重复
  | "duplicate-epistrophe"        // 尾语重复
  | "duplicate-parallel-structure"; // 并列结构

export interface InspectionFinding {
  readonly code: InspectionCode;
  readonly severity: "info" | "warning";
  readonly count: number;
  readonly lineNumbers?: readonly number[];
  readonly samples: readonly string[];
  readonly messageKey: string;
  /** 字符级位置范围，用于编辑器高亮（修辞检测专用） */
  readonly ranges?: readonly { readonly start: number; readonly end: number }[];
  /** 三级严重度（修辞检测原生精度） */
  readonly rhetoricSeverity?: "low" | "medium" | "high";
  /** 每千字出现次数 */
  readonly perThousandChars?: number;
  /** 置信度 0-1 */
  readonly confidence?: number;
  /** 唯一标识（用于忽略/标记状态持久化） */
  readonly findingId?: string;
}

export interface InspectionResult {
  readonly charCount: number;
  readonly lineCount: number;
  readonly paragraphCount: number;
  readonly findings: readonly InspectionFinding[];
}

// --- API Error Response ---

export interface ApiErrorResponse {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}
