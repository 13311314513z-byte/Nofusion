/**
 * Audit Issue — unified issue type shared across all audit components.
 *
 * This replaces the inline AuditIssue type in continuity.ts and provides
 * additional fields for location tracking, confidence scoring, and fix scope.
 *
 * @module
 */

// ─── Issue type ────────────────────────────────────────────────────

export type AuditIssueSource =
  | "continuity"
  | "post-write"
  | "beta-reader"
  | "human"
  | "genre-promises"
  | "ai-tells"
  | "hook-health"
  | "long-span-fatigue"
  | "state-validation"
  | "detection";

export interface AuditIssue {
  /** Unique identifier for this issue instance. */
  readonly id?: string;
  /** Which component reported this issue. */
  readonly source?: AuditIssueSource;
  /** Severity — determines whether the issue blocks the pipeline. */
  readonly severity: "critical" | "warning" | "info";
  /** Category label (e.g. "OOC Check", "Pacing Check"). */
  readonly category: string;
  /** Human-readable description of the issue. */
  readonly description: string;
  /** Suggested fix or remediation. */
  readonly suggestion: string;
  /** Paragraph range in the chapter where the issue occurs (1-indexed). */
  readonly location?: {
    readonly startParagraph: number;
    readonly endParagraph: number;
  };
  /** Supporting evidence text snippets. */
  readonly evidence?: ReadonlyArray<string>;
  /** Confidence level 0-1 (0 = guess, 1 = certain). */
  readonly confidence?: number;
  /** The smallest scope of changes needed to fix this issue. */
  readonly fixScope?: "word" | "sentence" | "paragraph" | "scene" | "chapter";
  /** If true, the pipeline must block until this issue is resolved. */
  readonly blocking?: boolean;
  /** ISO timestamp when the issue was created. */
  readonly createdAt?: string;
}

/** Fully resolved issue guaranteed by IssueNormalizer and createIssue(). */
export interface ResolvedAuditIssue extends AuditIssue {
  readonly id: string;
  readonly source: AuditIssueSource;
  readonly fixScope: NonNullable<AuditIssue["fixScope"]>;
  readonly blocking: boolean;
  readonly createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────

let _nextId = 0;

/**
 * Generate a unique issue ID.
 */
export function generateIssueId(source: AuditIssueSource): string {
  const seq = (_nextId++).toString(36).padStart(4, "0");
  return `${source.slice(0, 3)}-${Date.now().toString(36)}-${seq}`;
}

/**
 * Create an AuditIssue with defaults for optional fields.
 */
export function createIssue(input: {
  readonly source: AuditIssueSource;
  readonly severity: AuditIssue["severity"];
  readonly category: string;
  readonly description: string;
  readonly suggestion?: string;
  readonly location?: AuditIssue["location"];
  readonly evidence?: ReadonlyArray<string>;
  readonly confidence?: number;
  readonly fixScope?: AuditIssue["fixScope"];
  readonly blocking?: boolean;
}): ResolvedAuditIssue {
  return {
    id: generateIssueId(input.source),
    source: input.source,
    severity: input.severity,
    category: input.category,
    description: input.description,
    suggestion: input.suggestion ?? "",
    location: input.location,
    evidence: input.evidence,
    confidence: input.confidence,
    fixScope: input.fixScope ?? "paragraph",
    blocking: input.blocking ?? (input.severity === "critical"),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Resolve a compatibility issue into the complete pipeline contract.
 * This is the only supported bridge for legacy four-field issue producers.
 */
export function resolveAuditIssue(
  issue: AuditIssue,
  defaultSource: AuditIssueSource = "continuity",
): ResolvedAuditIssue {
  const source = issue.source ?? defaultSource;
  return {
    ...issue,
    id: issue.id ?? generateIssueId(source),
    source,
    fixScope: issue.fixScope ?? inferFixScope(issue),
    blocking: issue.blocking ?? issue.severity === "critical",
    createdAt: issue.createdAt ?? new Date().toISOString(),
  };
}

export function hasAuditIssueParagraphLocation(
  issue: AuditIssue,
): issue is AuditIssue & { readonly location: NonNullable<AuditIssue["location"]> } {
  return Boolean(
    issue.location
      && Number.isInteger(issue.location.startParagraph)
      && Number.isInteger(issue.location.endParagraph)
      && issue.location.startParagraph > 0
      && issue.location.endParagraph >= issue.location.startParagraph,
  );
}

function inferFixScope(issue: AuditIssue): ResolvedAuditIssue["fixScope"] {
  if (issue.location) return "paragraph";
  if (issue.severity === "critical") return "chapter";
  return "paragraph";
}

// ─── Mapper from legacy continuity AuditIssue ──────────────────────

/**
 * Convert a legacy continuity-style AuditIssue (from continuity.ts) to the
 * unified model. Legacy issues don't have location/confidence/fixScope/blocking,
 * so we infer reasonable defaults.
 */
export function fromLegacyContinuityIssue(
  legacy: {
    readonly severity: "critical" | "warning" | "info";
    readonly category: string;
    readonly description: string;
    readonly suggestion: string;
  },
  source?: AuditIssueSource,
): ResolvedAuditIssue {
  return resolveAuditIssue(legacy, source ?? "continuity");
}
