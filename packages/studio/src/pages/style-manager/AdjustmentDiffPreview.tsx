import { useState, useEffect } from "react";
import { fetchJson } from "../../hooks/use-api";
import { ChevronDown, ChevronUp, AlertTriangle, CheckCircle, XCircle, ArrowRight, FileText, Coins } from "lucide-react";
import type { StyleRewritePreview, AdjustmentPlan } from "@actalk/inkos-core";

interface Props {
  readonly text: string;
  readonly plan: AdjustmentPlan;
  readonly targetAuthorId: string;
  readonly authorProfileVersion: number;
  readonly selectedSuggestionIds: ReadonlyArray<string>;
  readonly onAccept: (adjustedText: string) => void;
  readonly onCancel: () => void;
  readonly t: (key: string) => string;
}

export function AdjustmentDiffPreview({
  text, plan, targetAuthorId, authorProfileVersion,
  selectedSuggestionIds, onAccept, onCancel, t,
}: Props) {
  const [preview, setPreview] = useState<StyleRewritePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  // Reset error state on mount (P1-4)
  useEffect(() => { setError(null); }, []);

  // Mark preview stale when source text changes (P0-4)
  useEffect(() => {
    if (preview && plan.sourceHash) {
      const currentHash = simpleHash(text);
      if (currentHash !== preview.sourceHash) {
        setPreview(null);
        setError(t("style.textChangedRegenerate"));
      }
    }
  }, [text]);

  const handlePreview = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchJson<StyleRewritePreview>("/style/adjustments/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          sourceHash: plan.sourceHash,
          targetAuthorId,
          authorProfileVersion,
          selectedSuggestionIds,
          preserveContent: true,
        }),
      });
      setPreview(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  };

  const handleAccept = () => {
    if (preview) onAccept(preview.adjustedText);
  };

  if (error) {
    return (
      <div className="border border-destructive/30 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle size={16} />
          <span className="text-sm font-medium">{t("style.previewError")}</span>
        </div>
        <p className="text-xs text-muted-foreground">{error}</p>
        <div className="flex gap-2">
          <button onClick={handlePreview} className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground">
            {t("style.retry")}
          </button>
          <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded bg-secondary/30 border border-border">
            {t("common.cancel")}
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="border rounded-lg p-6 space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <Coins size={16} className="animate-pulse text-amber-500" />
          <span>{t("style.previewing")}</span>
        </div>
        <div className="h-2 bg-secondary rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full animate-pulse w-1/3" />
        </div>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="border border-border rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <FileText size={16} />
          <span>{t("style.previewReady")}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {selectedSuggestionIds.length} {t("style.suggestionsSelected")} · {text.length}{t("style.charsUnit")}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => void handlePreview()}
            className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:opacity-90"
          >
            {t("style.generatePreview")}
          </button>
          <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded bg-secondary/30 border border-border">
            {t("common.cancel")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-secondary/10 border-b">
        <div className="flex items-center gap-2">
          <CheckCircle size={16} className="text-emerald-500" />
          <span className="text-sm font-medium">{t("style.previewTitle")}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{t("style.tokens")}: {preview.usage.totalTokens}</span>
        </div>
      </div>

      {/* Warnings */}
      {preview.warnings.length > 0 && (
        <div className="px-4 py-2 text-xs text-amber-600 bg-amber-500/5 border-b space-y-1">
          {preview.warnings.map((w, i) => (
            <div key={i} className="flex items-center gap-1"><AlertTriangle size={12} />{w}</div>
          ))}
        </div>
      )}

      {/* Diagnostics comparison */}
      <div className="px-4 py-3 border-b space-y-2">
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div className="text-center">
            <div className="text-muted-foreground mb-1">{t("style.aiRiskBefore")}</div>
            <div className={`font-bold ${preview.beforeDiagnostics.aiStyleTags.heuristicRiskScore >= 60 ? "text-destructive" : "text-muted-foreground"}`}>
              {preview.beforeDiagnostics.aiStyleTags.heuristicRiskScore}
            </div>
          </div>
          <div className="text-center flex items-center justify-center">
            <ArrowRight size={16} className="text-muted-foreground" />
          </div>
          <div className="text-center">
            <div className="text-muted-foreground mb-1">{t("style.aiRiskAfter")}</div>
            <div className={`font-bold ${preview.afterDiagnostics.aiStyleTags.heuristicRiskScore >= 60 ? "text-destructive"
              : preview.afterDiagnostics.aiStyleTags.heuristicRiskScore < preview.beforeDiagnostics.aiStyleTags.heuristicRiskScore ? "text-emerald-600"
                : "text-muted-foreground"}`}>
              {preview.afterDiagnostics.aiStyleTags.heuristicRiskScore}
            </div>
          </div>
        </div>
      </div>

      {/* Diff toggle */}
      <button
        onClick={() => setShowDiff((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2 text-xs text-muted-foreground hover:bg-secondary/10 border-b"
      >
        <span>{t("style.changes")} ({preview.changedRanges.length})</span>
        {showDiff ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {showDiff && preview.changedRanges.length > 0 && (
        <div className="px-4 py-3 space-y-2 max-h-48 overflow-y-auto border-b">
          {preview.changedRanges.map((range, idx) => (
            <div key={idx} className="text-xs">
              <div className="flex items-start gap-2">
                <div className="w-1/2 p-1.5 rounded bg-destructive/5 text-destructive line-through">
                  {range.original || "(empty)"}
                </div>
                <ArrowRight size={12} className="mt-1 shrink-0 text-muted-foreground" />
                <div className="w-1/2 p-1.5 rounded bg-emerald-500/5 text-emerald-700">
                  {range.replacement || "(empty)"}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="px-4 py-3 flex items-center justify-end gap-2">
        <button
          onClick={handleAccept}
          className="text-xs px-4 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-500 flex items-center gap-1"
        >
          <CheckCircle size={14} />
          {t("style.acceptAdjustment")}
        </button>
        <button
          onClick={onCancel}
          className="text-xs px-3 py-2 rounded bg-secondary/30 border border-border hover:bg-secondary/50 flex items-center gap-1"
        >
          <XCircle size={14} />
          {t("style.discardPreview")}
        </button>
      </div>
    </div>
  );
}

/** Minimal hash used to detect text changes (stable for same string). */
function simpleHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
