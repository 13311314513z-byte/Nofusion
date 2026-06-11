/**
 * DimensionSamplePreview — Displays a single dimension's sample excerpt.
 */

import React from "react";
import type { DimensionSample } from "@actalk/inkos-core";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DimensionSamplePreviewProps {
  readonly samples: ReadonlyArray<DimensionSample>;
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

const DIMENSION_COLORS: Record<string, string> = {
  dialogue: "bg-blue-50 border-blue-200 text-blue-800",
  action: "bg-green-50 border-green-200 text-green-800",
  psychological: "bg-purple-50 border-purple-200 text-purple-800",
  metaphor: "bg-yellow-50 border-yellow-200 text-yellow-800",
  parallelism: "bg-orange-50 border-orange-200 text-orange-800",
};

const DIMENSION_ICONS: Record<string, string> = {
  dialogue: "💬",
  action: "🏃",
  psychological: "🧠",
  metaphor: "🎨",
  parallelism: "⚡",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DimensionSamplePreview({ samples }: DimensionSamplePreviewProps) {
  if (samples.length === 0) {
    return (
      <div className="text-xs text-gray-400 text-center py-4">
        暂无示例选段
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {samples.map((dim, i) => {
        const colorClass = DIMENSION_COLORS[dim.dimension] ?? "bg-gray-50 border-gray-200 text-gray-800";
        const icon = DIMENSION_ICONS[dim.dimension] ?? "📊";
        const valueLabel = typeof dim.value === "number"
          ? dim.dimension === "dialogue" || dim.dimension === "action" || dim.dimension === "psychological"
            ? `${Math.round(dim.value * 100)}%`
            : `${dim.value.toFixed(1)}/千字`
          : String(dim.value);

        return (
          <div key={i} className={`p-3 rounded border ${colorClass}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium">
                {icon} {dim.label}
              </span>
              <span className="text-xs opacity-75">{valueLabel}</span>
            </div>
            {dim.samples.map((sample, si) => (
              <div key={si} className="text-xs mt-1 bg-white/60 rounded p-1.5">
                <span className="opacity-50 mr-1">L{sample.lineNumber}:</span>
                {sample.text}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
