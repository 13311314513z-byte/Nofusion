/**
 * RhetoricHighlightEditor — Editor-level highlighting of rhetoric repetition findings.
 *
 * Shared component used by StyleManager, ImportManager, and AuditView.
 * Highlights text ranges based on DuplicateRhetoricFinding.ranges.
 */

import React, { useMemo } from "react";
import type { DuplicateRhetoricFinding, RhetoricCategory } from "@actalk/inkos-core";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RhetoricHighlightEditorProps {
  readonly text: string;
  readonly findings: ReadonlyArray<DuplicateRhetoricFinding>;
  readonly readonly?: boolean;
  readonly filterCategories?: ReadonlyArray<RhetoricCategory>;
  readonly onSelectRange?: (range: { start: number; end: number }) => void;
}

// ---------------------------------------------------------------------------
// Color map
// ---------------------------------------------------------------------------

const SEVERITY_COLORS: Record<string, string> = {
  high: "bg-red-200/60 text-red-900 border-b-2 border-red-400",
  medium: "bg-orange-200/60 text-orange-900 border-b-2 border-orange-400",
  low: "bg-yellow-100/60 text-yellow-900 border-b-2 border-yellow-400",
};

const MAX_HIGHLIGHTS = 100;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RhetoricHighlightEditor({
  text,
  findings,
  readonly = false,
  filterCategories,
  onSelectRange,
}: RhetoricHighlightEditorProps) {
  const filteredFindings = useMemo(() => {
    let f = findings;
    if (filterCategories && filterCategories.length > 0) {
      f = f.filter((finding) => filterCategories.includes(finding.category));
    }
    return f;
  }, [findings, filterCategories]);

  const highlightRanges = useMemo(() => {
    const ranges: Array<{
      start: number;
      end: number;
      severity: string;
      category: string;
      label: string;
      findingId: string;
    }> = [];

    for (const finding of filteredFindings) {
      for (const range of finding.ranges) {
        ranges.push({
          start: range.start,
          end: range.end,
          severity: finding.severity,
          category: finding.category,
          label: finding.label,
          findingId: finding.id,
        });
        if (ranges.length >= MAX_HIGHLIGHTS) break;
      }
      if (ranges.length >= MAX_HIGHLIGHTS) break;
    }

    return ranges.sort((a, b) => a.start - b.start);
  }, [filteredFindings]);

  // Build segmented text with highlights
  const segments = useMemo(() => {
    if (highlightRanges.length === 0) {
      return [{ text, highlight: false as const, data: null as any }];
    }

    const segs: Array<{
      text: string;
      highlight: boolean;
      data: (typeof highlightRanges)[number] | null;
    }> = [];

    let lastEnd = 0;
    for (const r of highlightRanges) {
      if (r.start > lastEnd) {
        segs.push({ text: text.slice(lastEnd, r.start), highlight: false, data: null });
      }
      segs.push({
        text: text.slice(r.start, r.end),
        highlight: true,
        data: r,
      });
      lastEnd = r.end;
    }
    if (lastEnd < text.length) {
      segs.push({ text: text.slice(lastEnd), highlight: false, data: null });
    }

    return segs;
  }, [text, highlightRanges]);

  const handleClick = (data: (typeof highlightRanges)[number]) => {
    if (onSelectRange) {
      onSelectRange({ start: data.start, end: data.end });
    }
  };

  return (
    <div className="relative font-mono text-sm leading-relaxed whitespace-pre-wrap">
      {segments.map((seg, i) => {
        if (seg.highlight && seg.data) {
          const colorClass = SEVERITY_COLORS[seg.data.severity] ?? SEVERITY_COLORS.low;
          return (
            <mark
              key={i}
              className={`${colorClass} cursor-pointer rounded-sm px-0.5 ${readonly ? "" : "hover:opacity-80"}`}
              title={`${seg.data.label} (${seg.data.category})`}
              onClick={() => handleClick(seg.data!)}
            >
              {seg.text}
            </mark>
          );
        }
        return <span key={i}>{seg.text}</span>;
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side markers
// ---------------------------------------------------------------------------

export interface RhetoricSideMarkerProps {
  readonly findings: ReadonlyArray<DuplicateRhetoricFinding>;
  readonly lineHeight: number;
  readonly onNavigate?: (lineNumber: number) => void;
}

/**
 * Minimal side markers showing finding density per line.
 * Rendered as colored dots/glyphs in the editor gutter.
 */
export function RhetoricSideMarker({
  findings,
  lineHeight,
  onNavigate,
}: RhetoricSideMarkerProps) {
  const lineMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const f of findings) {
      for (const ex of f.examples) {
        const ln = ex.lineNumber;
        map.set(ln, (map.get(ln) ?? 0) + 1);
      }
    }
    return map;
  }, [findings]);

  const maxLine = useMemo(() => {
    let max = 0;
    for (const ln of lineMap.keys()) {
      if (ln > max) max = ln;
    }
    return max;
  }, [lineMap]);

  return (
    <div className="absolute right-0 top-0 bottom-0 w-6 pointer-events-none">
      {Array.from({ length: Math.min(maxLine, 100) }, (_, i) => {
        const ln = i + 1;
        const count = lineMap.get(ln);
        if (!count) return null;
        return (
          <div
            key={ln}
            className="absolute right-1 w-2 h-2 rounded-full bg-orange-400 cursor-pointer pointer-events-auto"
            style={{ top: `${(ln - 1) * lineHeight}px` }}
            title={`第 ${ln} 行: ${count} 个问题`}
            onClick={() => onNavigate?.(ln)}
          />
        );
      })}
    </div>
  );
}
