/**
 * RhetoricIssuePanel — Categorized issue browser for rhetoric repetition findings.
 *
 * Shared component used by StyleManager, ImportManager, and AuditView.
 * Supports full and compact modes, with configurable actions per entry point.
 */

import React, { useMemo, useState, useCallback } from "react";
import type { DuplicateRhetoricFinding, RhetoricCategory } from "@actalk/inkos-core";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RhetoricIssuePanelProps {
  readonly findings: ReadonlyArray<DuplicateRhetoricFinding>;
  readonly mode: "full" | "compact";
  readonly actions: ReadonlyArray<"highlight" | "ignore" | "ai-rewrite" | "mark-fixed">;
  readonly storageKey: string;
  readonly onAction?: (action: string, findingId: string) => void;
}

// ---------------------------------------------------------------------------
// Severity labels
// ---------------------------------------------------------------------------

const SEVERITY_LABEL: Record<string, { label: string; color: string }> = {
  high: { label: "严重", color: "text-red-600 bg-red-50" },
  medium: { label: "中等", color: "text-orange-600 bg-orange-50" },
  low: { label: "轻微", color: "text-yellow-600 bg-yellow-50" },
};

// ---------------------------------------------------------------------------
// Category display names
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Partial<Record<RhetoricCategory, string>> = {
  parallelism: "排比句式",
  metaphor: "比喻手法",
  personification: "拟人手法",
  repetition: "词语反复",
  transition: "过渡词聚集",
  hyperbole: "夸张修辞",
  "rhetorical-question": "反问句式",
  anaphora: "首语重复",
  epistrophe: "尾语重复",
  "parallel-structure": "并列结构",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RhetoricIssuePanel({
  findings,
  mode,
  actions,
  storageKey,
  onAction,
}: RhetoricIssuePanelProps) {
  const [selectedCategory, setSelectedCategory] = useState<RhetoricCategory | null>(null);
  const [ignoredIds, setIgnoredIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(`inkos-rhetoric-ignore-${storageKey}`);
      if (stored) return JSON.parse(stored) as string[];
    } catch { /* ignore */ }
    return [];
  });

  const categoryCounts = useMemo(() => {
    const counts = new Map<RhetoricCategory, { count: number; severities: string[] }>();
    for (const f of findings) {
      if (ignoredIds.includes(f.id)) continue;
      const entry = counts.get(f.category) ?? { count: 0, severities: [] };
      entry.count += f.count;
      entry.severities.push(f.severity);
      counts.set(f.category, entry);
    }
    return counts;
  }, [findings, ignoredIds]);

  const selectedFindings = useMemo(() => {
    if (!selectedCategory) return findings.filter((f) => !ignoredIds.includes(f.id));
    return findings.filter(
      (f) => f.category === selectedCategory && !ignoredIds.includes(f.id),
    );
  }, [findings, selectedCategory, ignoredIds]);

  const totalIssues = useMemo(
    () => findings.reduce((sum, f) => sum + f.count, 0),
    [findings],
  );

  const activeIssues = useMemo(
    () => findings.filter((f) => !ignoredIds.includes(f.id)).reduce((sum, f) => sum + f.count, 0),
    [findings, ignoredIds],
  );

  const handleIgnore = useCallback((findingId: string) => {
    const newIgnored = [...ignoredIds, findingId];
    setIgnoredIds(newIgnored);
    localStorage.setItem(`inkos-rhetoric-ignore-${storageKey}`, JSON.stringify(newIgnored));
    onAction?.("ignore", findingId);
  }, [ignoredIds, storageKey, onAction]);

  const handleIgnoreAll = useCallback(() => {
    const allIds = findings.map((f) => f.id);
    setIgnoredIds(allIds);
    localStorage.setItem(`inkos-rhetoric-ignore-${storageKey}`, JSON.stringify(allIds));
  }, [findings, storageKey]);

  const handleAction = useCallback((action: string, findingId: string) => {
    onAction?.(action, findingId);
  }, [onAction]);

  // Compute max severity for a category
  const maxSeverity = (severities: string[]): string => {
    if (severities.includes("high")) return "high";
    if (severities.includes("medium")) return "medium";
    return "low";
  };

  if (mode === "compact") {
    return (
      <div className="space-y-2 p-3 bg-white rounded-lg border border-gray-200">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-700">
            修辞问题 ({activeIssues})
          </h3>
          {actions.includes("ignore") && activeIssues > 0 && (
            <button
              className="text-xs text-gray-400 hover:text-gray-600"
              onClick={handleIgnoreAll}
            >
              全部忽略
            </button>
          )}
        </div>
        {selectedFindings.slice(0, 5).map((f) => (
          <div key={f.id} className="flex items-start gap-2 text-xs">
            <span className={`px-1.5 py-0.5 rounded ${SEVERITY_LABEL[f.severity]?.color ?? ""}`}>
              {SEVERITY_LABEL[f.severity]?.label ?? f.severity}
            </span>
            <span className="text-gray-600 flex-1">
              {f.label}: {f.count} 次 ({f.perThousandChars.toFixed(1)}/千字)
            </span>
            {actions.includes("ignore") && (
              <button
                className="text-gray-300 hover:text-gray-500"
                onClick={() => handleIgnore(f.id)}
                title="忽略"
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {selectedFindings.length > 5 && (
          <div className="text-xs text-gray-400 text-center">
            还有 {selectedFindings.length - 5} 项...
          </div>
        )}
      </div>
    );
  }

  // Full mode
  return (
    <div className="space-y-3 p-4 bg-white rounded-lg border border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">
          查重结果 ({activeIssues}/{totalIssues} 个问题)
        </h3>
        <div className="flex gap-2">
          {actions.includes("ignore") && (
            <button
              className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-500 hover:bg-gray-200"
              onClick={handleIgnoreAll}
            >
              全部忽略
            </button>
          )}
          {actions.includes("highlight") && (
            <button
              className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100"
              onClick={() => setSelectedCategory(null)}
            >
              全部高亮
            </button>
          )}
        </div>
      </div>

      {/* Category list */}
      <div className="space-y-1">
        <button
          className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
            !selectedCategory ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-600 hover:bg-gray-50"
          }`}
          onClick={() => setSelectedCategory(null)}
        >
          全部 ({activeIssues})
        </button>
        {[...categoryCounts.entries()]
          .sort(([, a], [, b]) => b.count - a.count)
          .map(([cat, info]) => {
            const severity = maxSeverity(info.severities);
            const severityInfo = SEVERITY_LABEL[severity];
            return (
              <button
                key={cat}
                className={`w-full text-left px-3 py-2 rounded text-sm transition-colors flex items-center justify-between ${
                  selectedCategory === cat
                    ? "bg-blue-50 text-blue-700 font-medium"
                    : "text-gray-600 hover:bg-gray-50"
                }`}
                onClick={() => setSelectedCategory(cat)}
              >
                <span>
                  {CATEGORY_LABELS[cat] ?? cat} ({info.count})
                </span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${severityInfo?.color ?? ""}`}>
                  {severityInfo?.label ?? ""}
                </span>
              </button>
            );
          })}
      </div>

      {/* Findings detail */}
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {selectedFindings.map((f) => (
          <div key={f.id} className="p-3 rounded bg-gray-50 text-sm space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-medium text-gray-800">{f.label}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${SEVERITY_LABEL[f.severity]?.color ?? ""}`}>
                {SEVERITY_LABEL[f.severity]?.label ?? f.severity}
              </span>
            </div>
            <div className="text-xs text-gray-500 space-x-2">
              <span>{f.count} 次</span>
              <span>{f.perThousandChars.toFixed(1)}/千字</span>
              <span>置信度 {(f.confidence * 100).toFixed(0)}%</span>
            </div>
            {/* Examples */}
            {f.examples.slice(0, 3).map((ex, i) => (
              <div key={i} className="text-xs text-gray-600 bg-white rounded p-1.5 border border-gray-100">
                <span className="text-gray-400 mr-1">L{ex.lineNumber}:</span>
                {ex.text.length > 60 ? ex.text.slice(0, 60) + "…" : ex.text}
              </div>
            ))}
            {/* Actions */}
            <div className="flex gap-2 pt-1">
              {actions.includes("highlight") && (
                <button
                  className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100"
                  onClick={() => handleAction("highlight", f.id)}
                >
                  跳转
                </button>
              )}
              {actions.includes("ignore") && !ignoredIds.includes(f.id) && (
                <button
                  className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500 hover:bg-gray-200"
                  onClick={() => handleIgnore(f.id)}
                >
                  忽略
                </button>
              )}
              {actions.includes("ai-rewrite") && (
                <button
                  className="text-xs px-2 py-0.5 rounded bg-purple-50 text-purple-600 hover:bg-purple-100"
                  onClick={() => handleAction("ai-rewrite", f.id)}
                >
                  AI 改写
                </button>
              )}
              {actions.includes("mark-fixed") && (
                <button
                  className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-600 hover:bg-green-100"
                  onClick={() => handleAction("mark-fixed", f.id)}
                >
                  标记已修复
                </button>
              )}
            </div>
          </div>
        ))}
        {selectedFindings.length === 0 && (
          <div className="text-center text-gray-400 py-4">
            {ignoredIds.length > 0 ? "所有问题已忽略" : "未发现修辞重复问题"}
          </div>
        )}
      </div>
    </div>
  );
}
