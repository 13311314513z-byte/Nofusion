/**
 * Location Anchor — validates LLM-returned paragraph positions against
 * actual chapter content, including evidence text matching.
 *
 * LLMs often hallucinate paragraph numbers or use 0-indexed when asked
 * for 1-indexed, or vice versa. This module provides deterministic
 * validation to catch such errors before they reach the Reviser.
 *
 * Evidence text anchoring: when an audit issue includes both a location
 * (paragraph range) and evidence text, this module verifies that the
 * evidence text actually appears within the cited paragraphs. If not,
 * it attempts to find the correct paragraph and adjusts the location.
 *
 * @module
 */

import type { AuditIssue } from "../models/audit-issue.js";

/**
 * Result of anchoring a set of locations against actual paragraph count.
 */
export interface LocationAnchorReport {
  /** Locations that passed validation (within paragraph count). */
  readonly valid: ReadonlyArray<{
    readonly startParagraph: number;
    readonly endParagraph: number;
  }>;
  /** Locations that were clamped to fit within paragraph count. */
  readonly clamped: ReadonlyArray<{
    readonly original: { readonly startParagraph: number; readonly endParagraph: number };
    readonly clamped: { readonly startParagraph: number; readonly endParagraph: number };
    readonly reason: string;
  }>;
  /** Locations that were rejected entirely (invalid). */
  readonly rejected: ReadonlyArray<{
    readonly location: { readonly startParagraph: number; readonly endParagraph: number };
    readonly reason: string;
  }>;
}

/**
 * Validate and correct LLM-returned paragraph locations against actual
 * paragraph count of the chapter.
 *
 * Rules:
 *   - startParagraph must be >= 1
 *   - endParagraph must be >= startParagraph
 *   - Both must be <= totalParagraphs (clamped if slightly over)
 *   - If startParagraph > totalParagraphs, the location is rejected
 *   - If endParagraph > totalParagraphs, it's clamped to totalParagraphs
 */
export function anchorLocations(
  locations: ReadonlyArray<{
    readonly startParagraph: number;
    readonly endParagraph: number;
  }>,
  totalParagraphs: number,
): LocationAnchorReport {
  const valid: Array<{ startParagraph: number; endParagraph: number }> = [];
  const clamped: Array<{
    original: { startParagraph: number; endParagraph: number };
    clamped: { startParagraph: number; endParagraph: number };
    reason: string;
  }> = [];
  const rejected: Array<{
    location: { startParagraph: number; endParagraph: number };
    reason: string;
  }> = [];

  for (const loc of locations) {
    const { startParagraph, endParagraph } = loc;

    // Basic structural validation
    if (!Number.isInteger(startParagraph) || !Number.isInteger(endParagraph)) {
      rejected.push({
        location: loc,
        reason: `Non-integer paragraph numbers (start=${startParagraph}, end=${endParagraph})`,
      });
      continue;
    }

    if (startParagraph < 1) {
      rejected.push({
        location: loc,
        reason: `startParagraph (${startParagraph}) is less than 1`,
      });
      continue;
    }

    if (endParagraph < startParagraph) {
      rejected.push({
        location: loc,
        reason: `endParagraph (${endParagraph}) is less than startParagraph (${startParagraph})`,
      });
      continue;
    }

    // Content-anchor validation
    if (startParagraph > totalParagraphs) {
      rejected.push({
        location: loc,
        reason: `startParagraph (${startParagraph}) exceeds total paragraphs (${totalParagraphs})`,
      });
      continue;
    }

    if (endParagraph > totalParagraphs) {
      const clampedEnd = totalParagraphs;
      clamped.push({
        original: { startParagraph, endParagraph },
        clamped: { startParagraph, endParagraph: clampedEnd },
        reason: `endParagraph (${endParagraph}) exceeds total paragraphs (${totalParagraphs}), clamped to ${clampedEnd}`,
      });
      valid.push({ startParagraph, endParagraph: clampedEnd });
      continue;
    }

    // All checks passed
    valid.push({ startParagraph, endParagraph });
  }

  return { valid, clamped, rejected };
}

/**
 * Result of evidence text anchoring.
 */
export interface EvidenceAnchorReport {
  /** Evidence that matched the cited paragraphs — location is correct. */
  readonly matched: ReadonlyArray<{
    readonly originalLocation: { readonly startParagraph: number; readonly endParagraph: number };
    readonly evidence: string;
  }>;
  /** Evidence that was found in a DIFFERENT paragraph range — location corrected. */
  readonly relocated: ReadonlyArray<{
    readonly originalLocation: { readonly startParagraph: number; readonly endParagraph: number };
    readonly correctedLocation: { readonly startParagraph: number; readonly endParagraph: number };
    readonly evidence: string;
    readonly reason: string;
  }>;
  /** Evidence that could not be found anywhere in the chapter — location rejected. */
  readonly notFound: ReadonlyArray<{
    readonly originalLocation: { readonly startParagraph: number; readonly endParagraph: number };
    readonly evidence: string;
    readonly reason: string;
  }>;
}

/**
 * Evidence text anchoring: verify that LLM-cited evidence text actually
 * appears in the cited paragraphs. If the evidence is found in a different
 * paragraph, the location is corrected. If not found at all, it is flagged.
 *
 * This addresses the common LLM hallucination where the model correctly
 * identifies a problem but cites the wrong paragraph numbers.
 *
 * @param chapterContent - Full chapter text.
 * @param evidenceLocations - Array of { location, evidence } pairs from audit issues.
 * @returns Report of matched, relocated, and not-found evidence.
 */
export function anchorEvidenceText(
  chapterContent: string,
  evidenceLocations: ReadonlyArray<{
    readonly location: { readonly startParagraph: number; readonly endParagraph: number };
    readonly evidence: ReadonlyArray<string>;
  }>,
): EvidenceAnchorReport {
  const paragraphs = chapterContent
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const matched: Array<{
    originalLocation: { startParagraph: number; endParagraph: number };
    evidence: string;
  }> = [];
  const relocated: Array<{
    originalLocation: { startParagraph: number; endParagraph: number };
    correctedLocation: { startParagraph: number; endParagraph: number };
    evidence: string;
    reason: string;
  }> = [];
  const notFound: Array<{
    originalLocation: { startParagraph: number; endParagraph: number };
    evidence: string;
    reason: string;
  }> = [];

  for (const { location, evidence: evidenceList } of evidenceLocations) {
    for (const evidence of evidenceList) {
      if (!evidence || evidence.trim().length === 0) continue;

      const evidenceNormalized = evidence.trim().toLowerCase();

      // Step 1: Check if evidence appears in the cited paragraph range (1-indexed)
      let foundInCitedRange = false;
      for (let i = location.startParagraph - 1; i < location.endParagraph && i < paragraphs.length; i++) {
        if (paragraphs[i]?.toLowerCase().includes(evidenceNormalized)) {
          foundInCitedRange = true;
          break;
        }
      }

      if (foundInCitedRange) {
        matched.push({
          originalLocation: { startParagraph: location.startParagraph, endParagraph: location.endParagraph },
          evidence,
        });
        continue;
      }

      // Step 2: Evidence not found in cited range — search entire chapter
      let foundParagraph = -1;
      for (let i = 0; i < paragraphs.length; i++) {
        if (paragraphs[i]?.toLowerCase().includes(evidenceNormalized)) {
          foundParagraph = i + 1; // Convert to 1-indexed
          break;
        }
      }

      if (foundParagraph > 0) {
        relocated.push({
          originalLocation: { startParagraph: location.startParagraph, endParagraph: location.endParagraph },
          correctedLocation: { startParagraph: foundParagraph, endParagraph: foundParagraph },
          evidence,
          reason: `Evidence found in paragraph ${foundParagraph}, not cited range ${location.startParagraph}-${location.endParagraph}`,
        });
      } else {
        // Step 3: Try fuzzy matching — check if key terms from evidence appear
        const keyTerms = extractKeyTerms(evidence);
        let bestMatchParagraph = -1;
        let bestMatchCount = 0;

        for (let i = 0; i < paragraphs.length; i++) {
          const paraLower = paragraphs[i]?.toLowerCase() ?? "";
          const matchCount = keyTerms.filter((term) => paraLower.includes(term)).length;
          if (matchCount > bestMatchCount) {
            bestMatchCount = matchCount;
            bestMatchParagraph = i + 1;
          }
        }

        if (bestMatchParagraph > 0 && bestMatchCount >= Math.max(1, Math.floor(keyTerms.length * 0.3))) {
          relocated.push({
            originalLocation: { startParagraph: location.startParagraph, endParagraph: location.endParagraph },
            correctedLocation: { startParagraph: bestMatchParagraph, endParagraph: bestMatchParagraph },
            evidence,
            reason: `Evidence not found verbatim; key terms matched best in paragraph ${bestMatchParagraph} (${bestMatchCount}/${keyTerms.length} terms)`,
          });
        } else {
          notFound.push({
            originalLocation: { startParagraph: location.startParagraph, endParagraph: location.endParagraph },
            evidence,
            reason: `Evidence text not found in any paragraph${keyTerms.length > 0 ? ` (best match: ${bestMatchCount}/${keyTerms.length} key terms)` : ""}`,
          });
        }
      }
    }
  }

  return { matched, relocated, notFound };
}

export interface AuditIssueAnchorReport {
  readonly issues: ReadonlyArray<AuditIssue>;
  readonly rejectedLocations: number;
  readonly relocatedLocations: number;
  readonly degradedIssues: number;
}

/**
 * Anchor issue locations and evidence as one operation.
 *
 * Evidence is evaluated per issue so identical quote text on separate issues
 * cannot relocate or degrade the wrong issue.
 */
export function anchorAuditIssues(
  chapterContent: string,
  issues: ReadonlyArray<AuditIssue>,
): AuditIssueAnchorReport {
  const totalParagraphs = countParagraphs(chapterContent);
  const anchored: AuditIssue[] = [];
  let rejectedLocations = 0;
  let relocatedLocations = 0;
  let degradedIssues = 0;

  for (const issue of issues) {
    if (!issue.location) {
      anchored.push(issue);
      continue;
    }

    const locationReport = anchorLocations([issue.location], totalParagraphs);
    const validLocation = locationReport.valid[0];
    if (!validLocation) {
      const { location: _, ...withoutLocation } = issue;
      anchored.push(withoutLocation);
      rejectedLocations++;
      continue;
    }

    if (!issue.evidence || issue.evidence.length === 0) {
      anchored.push({ ...issue, location: validLocation });
      continue;
    }

    const evidenceReport = anchorEvidenceText(chapterContent, [{
      location: validLocation,
      evidence: issue.evidence,
    }]);
    const verifiedLocations = [
      ...evidenceReport.matched.map(() => validLocation),
      ...evidenceReport.relocated.map((item) => item.correctedLocation),
    ];

    if (verifiedLocations.length === 0) {
      const { location: _, ...withoutLocation } = issue;
      anchored.push({
        ...withoutLocation,
        severity: downgradeSeverity(issue.severity),
        blocking: false,
      });
      degradedIssues++;
      continue;
    }

    const correctedLocation = {
      startParagraph: Math.min(...verifiedLocations.map((item) => item.startParagraph)),
      endParagraph: Math.max(...verifiedLocations.map((item) => item.endParagraph)),
    };
    if (
      correctedLocation.startParagraph !== validLocation.startParagraph
      || correctedLocation.endParagraph !== validLocation.endParagraph
    ) {
      relocatedLocations++;
    }
    anchored.push({ ...issue, location: correctedLocation });
  }

  return {
    issues: anchored,
    rejectedLocations,
    relocatedLocations,
    degradedIssues,
  };
}

function downgradeSeverity(
  severity: AuditIssue["severity"],
): AuditIssue["severity"] {
  if (severity === "critical") return "warning";
  if (severity === "warning") return "info";
  return "info";
}

/**
 * Extract meaningful key terms from text for fuzzy matching.
 */
function extractKeyTerms(text: string): string[] {
  const terms = new Set<string>();

  // Extract CJK bigrams (Chinese)
  const cjkMatch = text.match(/[\u4e00-\u9fff]+/g);
  if (cjkMatch) {
    for (const segment of cjkMatch) {
      if (segment.length >= 3) terms.add(segment.toLowerCase());
      // Add bigrams for shorter segments
      for (let i = 0; i < segment.length - 1; i++) {
        const bigram = segment.slice(i, i + 2);
        if (!/^[的了是在有和里与及或把被从到时]$/.test(bigram)) {
          terms.add(bigram.toLowerCase());
        }
      }
    }
  }

  // Extract English words 4+ chars
  const engMatch = text.match(/[A-Za-z]{4,}/g);
  if (engMatch) {
    for (const w of engMatch) {
      terms.add(w.toLowerCase());
    }
  }

  return [...terms];
}

/**
 * Count paragraphs in a chapter content string.
 * Paragraphs are separated by one or more blank lines.
 */
export function countParagraphs(content: string): number {
  return content
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean).length;
}
