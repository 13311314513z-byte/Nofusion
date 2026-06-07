import { useState } from "react";
import { fetchJson, useApi } from "../../hooks/use-api";
import { ChevronDown, ChevronUp, User, AlertTriangle } from "lucide-react";
import type { StyleComparisonResult } from "@actalk/inkos-core";

interface AuthorItem {
  readonly id: string;
  readonly name: string;
  readonly language: string;
}

interface Props {
  readonly text: string;
  readonly onComparisonResult: (result: StyleComparisonResult) => void;
  readonly t: (key: string) => string;
}

export function AuthorStyleComparison({ text, onComparisonResult, t }: Props) {
  const [selectedAuthorId, setSelectedAuthorId] = useState("");
  const [comparison, setComparison] = useState<StyleComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const { data: authorsData } = useApi<{ authors: ReadonlyArray<AuthorItem> }>("/style/authors");
  const authors = authorsData?.authors ?? [];

  const handleCompare = async () => {
    if (!selectedAuthorId || !text.trim()) return;
    setLoading(true);
    setError(null);
    setComparison(null);
    try {
      const result = await fetchJson<StyleComparisonResult>("/style/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, targetAuthorId: selectedAuthorId }),
      });
      setComparison(result);
      onComparisonResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="text-xs text-muted-foreground mb-1 block">{t("style.selectReferenceAuthor")}</label>
          <select
            value={selectedAuthorId}
            onChange={(e) => setSelectedAuthorId(e.target.value)}
            className="w-full text-sm px-2 py-1.5 rounded bg-secondary/30 border border-border"
          >
            <option value="">{t("style.selectAuthorPlaceholder")}</option>
            {authors.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.language})</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => void handleCompare()}
          disabled={!selectedAuthorId || !text.trim() || loading}
          className="text-sm px-3 py-1.5 rounded bg-primary text-primary-foreground disabled:opacity-30 flex items-center gap-1"
        >
          <User size={14} />
          {loading ? t("common.loading") : t("style.compare")}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {comparison && (
        <div className="border rounded-lg overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 bg-secondary/20 border-b">
            <span className="text-sm font-medium">{comparison.targetAuthor}</span>
            <span className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">{t("style.matchScore")}:</span>
              <span className={`font-bold tabular-nums ${
                comparison.overallMatchScore >= 80 ? "text-emerald-600"
                  : comparison.overallMatchScore >= 60 ? "text-amber-600"
                    : "text-destructive"
              }`}>
                {comparison.overallMatchScore}%
              </span>
            </span>
          </div>

          {/* Sample adequacy warning */}
          {comparison.sampleAdequacy !== "sufficient" && (
            <div className="px-3 py-2 text-xs text-amber-600 bg-amber-500/5 border-b flex items-center gap-1">
              <AlertTriangle size={12} />
              {comparison.sampleAdequacy === "limited"
                ? t("style.sampleLimited")
                : t("style.sampleInsufficient")}
            </div>
          )}

          {/* Deviations toggle */}
          <button
            onClick={() => setShowDetails((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs text-muted-foreground hover:bg-secondary/10"
          >
            <span>{t("style.deviations")} ({comparison.deviations.length})</span>
            {showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {showDetails && comparison.deviations.length > 0 && (
            <div className="divide-y">
              {comparison.deviations.map((dev, idx) => {
                const isAbove = dev.direction === "above";
                return (
                  <div key={idx} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="text-xs text-muted-foreground">
                      {t(`style.metric.${dev.metric}`)}
                    </span>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-muted-foreground">{t("style.current")}: {dev.currentValue}</span>
                      <span className="text-muted-foreground">{t("style.target")}: {dev.targetValue}</span>
                      <span className={isAbove ? "text-amber-600" : "text-blue-600"}>
                        {isAbove ? "↑" : "↓"} {Math.abs(Math.round(dev.normalizedDeviation * 100))}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {comparison.deviations.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              {t("style.noDeviations")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
