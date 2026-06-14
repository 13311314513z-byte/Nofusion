/**
 * ReadabilityDashboard — Display readability score and dimension breakdown.
 *
 * Shared component used by StyleManager, ImportManager, and AuditView.
 * Shows overall score + per-dimension breakdown with visual indicators.
 */

import React from "react";
import type { ReadabilityScore } from "@actalk/inkos-core";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ReadabilityDashboardProps {
  readonly score: ReadabilityScore;
  readonly showTrend?: boolean;
  readonly source: "style" | "import" | "audit";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scoreColor(score: number): string {
  if (score >= 80) return "text-green-600";
  if (score >= 60) return "text-yellow-600";
  if (score >= 40) return "text-orange-600";
  return "text-red-600";
}

function scoreBar(score: number): string {
  const filled = Math.round(score / 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

function dimensionLabel(key: string): string {
  const labels: Record<string, string> = {
    rhetoricVariety: "修辞多样性",
    vocabularyDiversity: "词汇多样性",
    sentenceVariety: "句式多样性",
    paragraphCoherence: "段落连贯性",
    repetitionPenalty: "重复扣分",
  };
  return labels[key] ?? key;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReadabilityDashboard({
  score,
  showTrend = false,
  source,
}: ReadabilityDashboardProps) {
  const suggestions: string[] = [];

  if (score.dimensions.rhetoricVariety < 60) {
    suggestions.push("减少比喻和排比的重复使用，增加修辞手法的多样性");
  }
  if (score.dimensions.vocabularyDiversity < 60) {
    suggestions.push("扩大词汇使用范围，减少同一词语的反复出现");
  }
  if (score.dimensions.sentenceVariety < 60) {
    suggestions.push("调整句式长度分布，混合使用长短句");
  }
  if (score.dimensions.paragraphCoherence < 60) {
    suggestions.push("增加段落间的主题过渡，避免相邻段落内容重叠");
  }
  if (score.dimensions.repetitionPenalty > 20) {
    suggestions.push("修辞重复度过高，建议使用 AI 改写或手动调整");
  }

  return (
    <div className="p-4 bg-white rounded-lg border border-gray-200 space-y-4">
      {/* Overall score */}
      <div className="text-center">
        <div className="text-xs text-gray-500 mb-1">可阅读性评分</div>
        <div className={`text-4xl font-bold ${scoreColor(score.overall)}`}>
          {score.overall}
          <span className="text-base font-normal text-gray-400">/100</span>
        </div>
        <div className="mt-1 text-2xl tracking-widest text-gray-300">
          {scoreBar(score.overall)}
        </div>
      </div>

      {/* Dimension breakdown */}
      <div className="space-y-2">
        {Object.entries(score.dimensions).map(([key, value]) => (
          <div key={key} className="flex items-center gap-2">
            <span className="text-xs text-gray-600 w-20 shrink-0">
              {dimensionLabel(key)}
            </span>
            <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  key === "repetitionPenalty"
                    ? "bg-red-300"
                    : value >= 80
                      ? "bg-green-400"
                      : value >= 60
                        ? "bg-yellow-400"
                        : "bg-orange-400"
                }`}
                style={{ width: `${Math.min(100, value)}%` }}
              />
            </div>
            <span className={`text-xs w-8 text-right ${scoreColor(value)}`}>
              {Math.round(value)}
            </span>
          </div>
        ))}
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 && source !== "import" && (
        <div className="bg-blue-50 rounded p-3">
          <div className="text-xs font-medium text-blue-700 mb-1">
            {source === "audit" ? "审计建议" : "改进建议"}
          </div>
          <ul className="text-xs text-blue-600 space-y-1">
            {suggestions.map((s, i) => (
              <li key={i}>• {s}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Trend placeholder */}
      {showTrend && (
        <div className="text-center text-xs text-gray-400 pt-2 border-t border-gray-100">
          趋势功能将在跨章节评分后显示
        </div>
      )}
    </div>
  );
}
