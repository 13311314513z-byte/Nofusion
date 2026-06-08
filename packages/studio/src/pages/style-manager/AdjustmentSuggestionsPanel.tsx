import { useState, useCallback, useEffect } from "react";
import { fetchJson, useApi } from "../../hooks/use-api";
import { Lightbulb, AlertTriangle, ShieldCheck, Shield, ShieldAlert, RotateCcw, CheckCircle, XCircle, ChevronDown, ChevronUp, Eye } from "lucide-react";
import type { AdjustmentPlan, AdjustmentSuggestion } from "@actalk/inkos-core";
import type { AdjustmentState } from "./style-adjustment-state";
import { createAdjustmentReducer, createInitialAdjustmentState } from "./style-adjustment-state";
import { AdjustmentDiffPreview } from "./AdjustmentDiffPreview.js";

interface AuthorItem {
  readonly id: string;
  readonly name: string;
}

interface Props {
  readonly text: string;
  readonly onTextChange: (text: string) => void;
  readonly diagnostics: unknown; // FullStyleDiagnostics | null — passed to API
  readonly t: (key: string) => string;
}

const SEVERITY_CONFIG: Record<string, { icon: React.ElementType; className: string }> = {
  critical: { icon: ShieldAlert, className: "text-destructive border-destructive/20 bg-destructive/5" },
  warning: { icon: Shield, className: "text-amber-600 border-amber-500/20 bg-amber-500/5" },
  info: { icon: ShieldCheck, className: "text-sky-600 border-sky-500/20 bg-sky-500/5" },
};

type CategoryFilter = "all" | AdjustmentSuggestion["category"];

export function AdjustmentSuggestionsPanel({ text, onTextChange, diagnostics, t }: Props) {
  const [state, setState] = useState<AdjustmentState>(createInitialAdjustmentState());
  const [targetAuthorId, setTargetAuthorId] = useState("");
  const [filterCategory, setFilterCategory] = useState<CategoryFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showApplied, setShowApplied] = useState(false);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const { data: authorsData } = useApi<{ authors: ReadonlyArray<AuthorItem> }>("/style/authors");
  const authors = authorsData?.authors ?? [];

  const actions = createAdjustmentReducer(state, setState);

  // Mark plan stale when text changes
  useEffect(() => {
    if (state.plan && state.plan.sourceHash) {
      const currentHash = simpleHash(text);
      if (currentHash !== state.plan.sourceHash) {
        actions.markStale();
        setSelectedIds([]);
        setShowPreview(false);
      }
    }
  }, [text]);

  const handleGeneratePlan = useCallback(async () => {
    if (!text.trim()) return;
    actions.setLoading(true);
    actions.setError(null);
    try {
      const body: Record<string, unknown> = { text };
      if (targetAuthorId) body.targetAuthorId = targetAuthorId;
      const plan = await fetchJson<AdjustmentPlan>("/style/adjustments/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      actions.setPlan(plan);
      setSelectedIds([]);
    } catch (e) {
      actions.setError(e instanceof Error ? e.message : String(e));
    }
  }, [text, targetAuthorId]);

  const handleTargetAuthorChange = useCallback((authorId: string) => {
    setTargetAuthorId(authorId);
    setSelectedIds([]);
    setShowPreview(false);
    if (state.plan) {
      actions.markStale();
    }
  }, [state.plan, actions]);

  const handleApplyPatch = useCallback(async (suggestion: AdjustmentSuggestion) => {
    if (!suggestion.patch) return;
    const { expectedText, replacementText, position } = suggestion.patch;
    const actualText = text.slice(position.start, position.end);

    if (actualText !== expectedText) {
      actions.setError(t("style.patchMismatch"));
      return;
    }

    // Push undo before applying
    actions.pushUndo(text, `Apply: ${suggestion.category}`);

    // Apply patch
    const newText = text.slice(0, position.start) + replacementText + text.slice(position.end);
    onTextChange(newText);
    actions.markStale();
    setShowApplied(true);
    setTimeout(() => setShowApplied(false), 2000);
  }, [text, onTextChange]);

  const handleUndo = useCallback(() => {
    const restored = actions.popUndo();
    if (restored !== undefined) {
      onTextChange(restored);
    }
  }, [actions, onTextChange]);

  const toggleSuggestion = useCallback((suggestionId: string) => {
    setSelectedIds((prev) =>
      prev.includes(suggestionId)
        ? prev.filter((id) => id !== suggestionId)
        : [...prev, suggestionId],
    );
  }, []);

  const filteredSuggestions = state.plan
    ? filterCategory === "all"
      ? state.plan.suggestions
      : state.plan.suggestions.filter((s) => s.category === filterCategory)
    : [];

  const categories = state.plan
    ? [...new Set(state.plan.suggestions.map((s) => s.category))]
    : [];

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Lightbulb size={16} className="text-amber-500" />
        <h3 className="font-semibold text-sm">{t("style.adjustmentTitle")}</h3>
        {state.stale && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 border border-amber-500/20">
            {t("style.planStale")}
          </span>
        )}
      </div>

      {/* Author selector */}
      <div className="flex items-center gap-2">
        <select
          value={targetAuthorId}
          onChange={(e) => handleTargetAuthorChange(e.target.value)}
          className="flex-1 text-sm px-2 py-1.5 rounded bg-secondary/30 border border-border"
        >
          <option value="">{t("style.noTargetAuthor")}</option>
          {authors.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <button
          onClick={() => void handleGeneratePlan()}
          disabled={!text.trim() || state.loading}
          className="text-sm px-3 py-1.5 rounded bg-primary text-primary-foreground disabled:opacity-30"
        >
          {state.loading ? t("common.loading") : t("style.generatePlan")}
        </button>
        <button
          onClick={handleUndo}
          disabled={state.undoStack.length === 0}
          className="text-sm px-2 py-1.5 rounded bg-secondary/30 border border-border hover:bg-secondary/50 disabled:opacity-20 flex items-center gap-1"
          title={t("style.undo")}
        >
          <RotateCcw size={14} />
        </button>
      </div>

      {state.error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle size={14} />
          {state.error}
        </div>
      )}

      {/* Plan info */}
      {state.plan && (
        <>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="font-mono">{state.plan.sourceHash}</span>
            <span className="text-border">|</span>
            <span>v{state.plan.ruleVersion}</span>
            {state.plan.authorProfileId && (
              <>
                <span className="text-border">|</span>
                <span>{state.plan.authorProfileId} v{state.plan.authorProfileVersion}</span>
              </>
            )}
            <span className="text-border">|</span>
            <span>{t("style.suggestions")}: {state.plan.suggestions.length}</span>
          </div>

          {state.plan.warnings.length > 0 && (
            <div className="text-xs text-amber-600 space-y-1">
              {state.plan.warnings.map((w, i) => (
                <div key={i} className="flex items-center gap-1">
                  <AlertTriangle size={12} />
                  {w}
                </div>
              ))}
            </div>
          )}

          {/* Category filter */}
          {categories.length > 1 && (
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => setFilterCategory("all")}
                className={`text-[10px] px-2 py-0.5 rounded-full border ${
                  filterCategory === "all"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary/30 border-border hover:bg-secondary/50"
                }`}
              >
                {t("style.all")}
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(cat)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border ${
                    filterCategory === cat
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-secondary/30 border-border hover:bg-secondary/50"
                  }`}
                >
                  {t(`style.category.${cat}`)}
                </button>
              ))}
            </div>
          )}

          {/* Suggestions list */}
          {filteredSuggestions.length === 0 && (
            <div className="text-center text-xs text-muted-foreground py-4">
              {t("style.noSuggestions")}
            </div>
          )}

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {filteredSuggestions.map((suggestion) => {
              const sevConfig = SEVERITY_CONFIG[suggestion.severity] ?? SEVERITY_CONFIG.info;
              const SevIcon = sevConfig.icon;
              const isExpanded = expandedId === suggestion.id;
              const hasPatch = !!suggestion.patch;
              const isSelected = selectedIds.includes(suggestion.id);

              return (
                <div
                  key={suggestion.id}
                  className={`border rounded-lg p-3 text-sm ${sevConfig.className}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSuggestion(suggestion.id)}
                        className="shrink-0 rounded border-border/60"
                        aria-label={suggestion.description}
                      />
                      <SevIcon size={14} className="shrink-0" />
                      <span className="text-xs text-muted-foreground">
                        {t(`style.category.${suggestion.category}`)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {(suggestion.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : suggestion.id)}
                      className="shrink-0 text-muted-foreground"
                    >
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </div>

                  {/* Description */}
                  <p className="text-xs mt-1">{suggestion.description}</p>

                  {isExpanded && (
                    <div className="mt-2 space-y-2">
                      {/* Original snippet */}
                      <div className="text-xs bg-secondary/20 rounded p-2 font-mono text-muted-foreground">
                        {suggestion.originalSnippet}
                      </div>

                      {/* Instruction */}
                      <p className="text-xs text-muted-foreground">{suggestion.instruction}</p>

                      {/* Apply button for deterministic patches */}
                      {hasPatch && !state.stale && (
                        <button
                          onClick={() => void handleApplyPatch(suggestion)}
                          className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:opacity-90"
                        >
                          {t("style.apply")}
                        </button>
                      )}
                      {hasPatch && state.stale && (
                        <span className="text-[10px] text-amber-600">{t("style.regenerateRequired")}</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* No plan state */}
      {!state.plan && !state.loading && (
        <div className="text-center text-xs text-muted-foreground py-4">
          {t("style.noPlan")}
        </div>
      )}

      {/* Preview section */}
      {state.plan && !state.stale && (
        <>
          {/* Selected suggestions bar */}
          <div className="flex items-center justify-between text-xs">
            <button
              onClick={() => setSelectedIds((prev) =>
                prev.length === state.plan!.suggestions.length
                  ? []
                  : state.plan!.suggestions.map((s) => s.id)
              )}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <CheckCircle size={12} />
              {selectedIds.length === 0
                ? t("style.selectAll")
                : selectedIds.length === state.plan.suggestions.length
                  ? t("style.selectNone")
                  : `${selectedIds.length} ${t("style.selectedItems")}`}
            </button>
            <button
              onClick={() => {
                if (!targetAuthorId) {
                  actions.setError(t("style.selectAuthorFirst"));
                  return;
                }
                actions.setError(null);
                setShowPreview(true);
              }}
              disabled={selectedIds.length === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 text-xs"
            >
              <Eye size={12} />
              {t("style.previewAdjustment")}
            </button>
          </div>

        {/* Diff preview + Chapter save */}
          {showPreview && (
            <>
              <AdjustmentDiffPreview
                text={text}
                plan={state.plan}
                targetAuthorId={targetAuthorId}
                authorProfileVersion={state.plan.authorProfileVersion ?? 0}
                selectedSuggestionIds={selectedIds}
                onAccept={(adjustedText) => {
                  actions.pushUndo(text, "Accept preview");
                  onTextChange(adjustedText);
                  actions.setPlan(null);
                  setShowPreview(false);
                  setSelectedIds([]);
                }}
                onCancel={() => setShowPreview(false)}
                t={t}
              />
              {/* Save-to-chapter button when coming from a book chapter */}
              {(() => {
                const bookId = sessionStorage.getItem("style-book-id");
                const chNum = sessionStorage.getItem("style-chapter-number");
                if (!bookId || !chNum) return null;
                return (
                  <button
                    onClick={async () => {
                      try {
                        await fetchJson(`/books/${bookId}/chapters/${chNum}`, {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ content: text }),
                        });
                        sessionStorage.removeItem("style-book-id");
                        sessionStorage.removeItem("style-chapter-number");
                        actions.setError(null);
                        // Navigate back to chapter
                        window.location.hash = `#/book/${bookId}/chapters`;
                      } catch (e) {
                        actions.setError(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
                      }
                    }}
                    className="w-full text-xs px-3 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-500 flex items-center justify-center gap-1 mt-2"
                  >
                    <CheckCircle size={14} />
                    保存到章节 #{chNum}
                  </button>
                );
              })()}
            </>
          )}
        </>
      )}
    </div>
  );
}

function simpleHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
