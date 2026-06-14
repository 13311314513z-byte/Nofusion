import { useState, useEffect, useMemo } from "react";
import type { Theme } from "../../hooks/use-theme";
import type { TFunction } from "../../hooks/use-i18n";
import type { SSEMessage } from "../../hooks/use-sse";
import { fetchJson, useApi } from "../../hooks/use-api";
import {
  GitBranch,
  AlertTriangle,
  CheckCircle2,
  Clock,
  HelpCircle,
  ShieldAlert,
  Ban,
  ArrowRight,
  SortAsc,
  Plus,
  Trash2,
  Save,
  X,
} from "lucide-react";

interface HookRecord {
  readonly hookId: string;
  readonly startChapter: number;
  readonly type: string;
  readonly status: string;
  readonly lastAdvancedChapter: number;
  readonly expectedPayoff: string;
  readonly payoffTiming: string;
  readonly dependsOn: string;
  readonly paysOffInArc: string;
  readonly coreHook: string;
  readonly halfLife: string;
  readonly notes: string;
}

interface BookHooksSectionProps {
  readonly bookId: string;
  readonly nav: {
    readonly toDashboard: () => void;
    readonly toChapter: (bookId: string, num: number) => void;
    readonly toBook: (bookId: string) => void;
    readonly toBookSection: (bookId: string, section: string) => void;
    readonly toServices: () => void;
  };
  readonly theme: Theme;
  readonly t: TFunction;
  readonly sse: { readonly messages: ReadonlyArray<SSEMessage>; readonly connected: boolean };
}

function statusIcon(status: string) {
  switch (status) {
    case "resolved": return <CheckCircle2 size={14} className="text-emerald-600" />;
    case "deferred": return <Clock size={14} className="text-amber-600" />;
    case "progressing": return <GitBranch size={14} className="text-blue-600" />;
    case "open": return <AlertTriangle size={14} className="text-red-600" />;
    case "stale": return <ShieldAlert size={14} className="text-purple-600" />;
    case "blocked": return <Ban size={14} className="text-orange-600" />;
    default: return <HelpCircle size={14} className="text-muted-foreground" />;
  }
}

function statusLabel(status: string, t: TFunction): string {
  switch (status) {
    case "resolved": return t("hook.status.resolved");
    case "deferred": return t("hook.status.deferred");
    case "progressing": return t("hook.status.progressing");
    case "open": return t("hook.status.open");
    case "stale": return t("hook.status.stale");
    case "blocked": return t("hook.status.blocked");
    default: return status;
  }
}

function statusClass(status: string): string {
  switch (status) {
    case "resolved": return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
    case "deferred": return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
    case "progressing": return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
    case "open": return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
    case "stale": return "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400";
    case "blocked": return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400";
    default: return "bg-muted text-muted-foreground";
  }
}

function computeRiskScore(hook: HookRecord, currentChapter: number): number {
  let score = 0;
  // Core hook gets higher base risk
  if (/是|true|yes|1/i.test(hook.coreHook)) score += 30;
  // Overdue magnitude
  const halfLifeNum = parseInt(hook.halfLife, 10);
  if (halfLifeNum > 0) {
    const elapsed = currentChapter - (hook.startChapter || 0);
    const overdue = elapsed - halfLifeNum;
    if (overdue > 0) {
      score += Math.min(40, overdue * 2); // cap at 40
    } else if (elapsed > halfLifeNum * 0.7) {
      score += 10; // approaching half-life
    }
  }
  // Status weight
  if (hook.status === "blocked") score += 20;
  if (hook.status === "stale") score += 15;
  if (hook.status === "open") score += 10;
  return score;
}

function riskBadge(score: number): { label: string; classes: string } {
  if (score >= 50) return { label: "高风险", classes: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" };
  if (score >= 25) return { label: "中风险", classes: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" };
  return { label: "低风险", classes: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" };
}

export function BookHooksSection({ bookId, nav, t }: BookHooksSectionProps) {
  const [hooks, setHooks] = useState<ReadonlyArray<HookRecord>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortByRisk, setSortByRisk] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingHookId, setEditingHookId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<HookRecord>>({});
  const [saving, setSaving] = useState(false);

  const loadHooks = () => {
    setLoading(true);
    setError("");
    fetchJson<{ hooks: ReadonlyArray<HookRecord> }>(`/books/${bookId}/hooks`)
      .then((data) => {
        setHooks(data.hooks ?? []);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load hooks");
      })
      .finally(() => setLoading(false));
  };

  const handleCreate = async () => {
    const hookId = editForm.hookId?.trim();
    if (!hookId) return;
    setSaving(true);
    try {
      await fetchJson(`/books/${bookId}/hooks`, {
        method: "POST",
        body: JSON.stringify(editForm),
      });
      setShowCreateForm(false);
      setEditForm({});
      loadHooks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create hook");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (hookId: string) => {
    setSaving(true);
    try {
      await fetchJson(`/books/${bookId}/hooks/${encodeURIComponent(hookId)}`, {
        method: "PUT",
        body: JSON.stringify(editForm),
      });
      setEditingHookId(null);
      setEditForm({});
      loadHooks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update hook");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (hookId: string) => {
    if (!confirm(`${t("hook.deleteConfirm")} "${hookId}"？`)) return;
    try {
      await fetchJson(`/books/${bookId}/hooks/${encodeURIComponent(hookId)}`, {
        method: "DELETE",
      });
      loadHooks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete hook");
    }
  };

  const startEdit = (hook: HookRecord) => {
    setEditingHookId(hook.hookId);
    setEditForm({ ...hook });
  };

  const startCreate = () => {
    setEditForm({ hookId: `hook-${Date.now()}`, status: "open" });
    setShowCreateForm(true);
  };

  // Fetch actual book chapters for accurate "current chapter" calculation
  const { data: bookData } = useApi<{ chapters: ReadonlyArray<{ number: number }> }>(`/books/${bookId}`);

  useEffect(() => {
    setLoading(true);
    setError("");
    fetchJson<{ hooks: ReadonlyArray<HookRecord> }>(`/books/${bookId}/hooks`)
      .then((data) => {
        setHooks(data.hooks ?? []);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load hooks");
      })
      .finally(() => setLoading(false));
  }, [bookId]);

  const currentChapterNum = useMemo(() => {
    if (bookData?.chapters?.length) {
      return Math.max(...bookData.chapters.map((c) => c.number));
    }
    // Fallback: use max lastAdvancedChapter from hooks (old behavior, but only when book data unavailable)
    return hooks.length > 0
      ? Math.max(...hooks.map((h) => h.lastAdvancedChapter || h.startChapter || 0))
      : 0;
  }, [bookData, hooks]);

  // Build hook lookup map for dependency visualization
  const hookMap = useMemo(() => {
    const map = new Map<string, HookRecord>();
    for (const h of hooks) map.set(h.hookId, h);
    return map;
  }, [hooks]);

  // Build reverse-dependency map: hookId -> list of hooks that depend on it
  const dependedByMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const h of hooks) {
      if (!h.dependsOn) continue;
      const deps = h.dependsOn
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const dep of deps) {
        const list = map.get(dep) ?? [];
        list.push(h.hookId);
        map.set(dep, list);
      }
    }
    return map;
  }, [hooks]);

  const grouped = new Map<string, HookRecord[]>();
  for (const hook of hooks) {
    const group = hook.status || "unknown";
    grouped.set(group, [...(grouped.get(group) ?? []), hook]);
  }

  const groupOrder = ["open", "progressing", "deferred", "blocked", "stale", "resolved"];
  const sortedGroups = groupOrder
    .filter((g) => grouped.has(g))
    .map((g) => {
      const items = grouped.get(g)!;
      const sorted = sortByRisk
        ? [...items].sort((a, b) => computeRiskScore(b, currentChapterNum) - computeRiskScore(a, currentChapterNum))
        : items;
      return { status: g, items: sorted };
    })
    .concat(
      [...grouped.keys()]
        .filter((g) => !groupOrder.includes(g))
        .sort((a, b) => a.localeCompare(b))
        .map((g) => ({ status: g, items: grouped.get(g)! })),
    );

  const unresolvedCount = hooks.filter((h) => h.status !== "resolved" && h.status !== "deferred").length;
  const coreCount = hooks.filter((h) => /是|true|yes|1/i.test(h.coreHook)).length;
  const overdueCount = hooks.filter((h) => {
    const halfLifeNum = parseInt(h.halfLife, 10);
    return halfLifeNum > 0 && currentChapterNum > (h.startChapter || 0) + halfLifeNum;
  }).length;

  // Top 5 highest-risk unresolved hooks across all statuses
  const topRiskHooks = useMemo(() => {
    return [...hooks]
      .filter((h) => h.status !== "resolved" && h.status !== "deferred")
      .sort((a, b) => computeRiskScore(b, currentChapterNum) - computeRiskScore(a, currentChapterNum))
      .slice(0, 5);
  }, [hooks, currentChapterNum]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
        <span className="text-sm text-muted-foreground">{t("common.loading")}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-destructive p-8 bg-destructive/5 rounded-xl border border-destructive/20">{error}</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="paper-sheet rounded-2xl border border-border/40 shadow-sm p-5 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <GitBranch size={16} className="text-primary/70" />
            <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{t("workspace.section.hooks")}</h2>
            <span className="rounded-full border border-border/50 bg-secondary/40 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
              {hooks.length} · {t("hook.unresolved")} {unresolvedCount}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={startCreate}
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/10 transition-colors"
            >
              <Plus size={12} />
              {t("hook.create")}
            </button>
            <button
              onClick={() => setSortByRisk((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-lg border border-border/50 px-3 py-1.5 text-xs font-bold transition-colors ${
                sortByRisk
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-secondary/40 text-muted-foreground hover:bg-secondary"
              }`}
              title={sortByRisk ? t("hook.sortByRiskTitle") : t("hook.sortDefaultTitle")}
            >
              <SortAsc size={12} />
              {sortByRisk ? t("hook.sortByRisk") : t("hook.sortDefault")}
            </button>
          </div>
        </div>

        {hooks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center border border-border/40 rounded-2xl bg-card/30">
            <GitBranch size={24} className="text-muted-foreground/40 mb-3" />
            <p className="text-sm italic font-serif text-muted-foreground">{t("hook.noHooks")}</p>
          </div>
        ) : (
          <>
            {/* Summary stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="rounded-xl border border-border/40 bg-secondary/20 p-4">
                <div className="text-xs text-muted-foreground font-medium">{t("hook.total")}</div>
                <div className="mt-1 text-xl font-semibold tabular-nums">{hooks.length}</div>
              </div>
              <div className="rounded-xl border border-border/40 bg-secondary/20 p-4">
                <div className="text-xs text-muted-foreground font-medium">{t("hook.coreHooks")}</div>
                <div className="mt-1 text-xl font-semibold tabular-nums">{coreCount}</div>
              </div>
              <div className="rounded-xl border border-border/40 bg-secondary/20 p-4">
                <div className="text-xs text-muted-foreground font-medium">{t("hook.open")}</div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-red-600">{grouped.get("open")?.length ?? 0}</div>
              </div>
              <div className="rounded-xl border border-border/40 bg-secondary/20 p-4">
                <div className="text-xs text-muted-foreground font-medium">{t("hook.resolved")}</div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-emerald-600">{grouped.get("resolved")?.length ?? 0}</div>
              </div>
              <div className={`rounded-xl border p-4 ${overdueCount > 0 ? "border-red-200 bg-red-50/30 dark:border-red-900/30 dark:bg-red-950/10" : "border-border/40 bg-secondary/20"}`}>
                <div className="text-xs text-muted-foreground font-medium">{t("hook.overdueCount")}</div>
                <div className={`mt-1 text-xl font-semibold tabular-nums ${overdueCount > 0 ? "text-red-600" : ""}`}>{overdueCount}</div>
              </div>
            </div>

            {/* Top risk alerts */}
            {topRiskHooks.length > 0 && (
              <div className="rounded-xl border border-red-200 dark:border-red-900/30 bg-red-50/20 dark:bg-red-950/10 p-4 space-y-2">
                <h3 className="text-xs font-bold text-red-700 dark:text-red-400 flex items-center gap-1.5">
                  <AlertTriangle size={12} />
                  {t("hook.topRiskHooks")}
                </h3>
                <div className="space-y-1.5">
                  {topRiskHooks.map((hook) => {
                    const score = computeRiskScore(hook, currentChapterNum);
                    const badge = riskBadge(score);
                    return (
                      <div key={hook.hookId} className="flex items-center gap-3 text-xs">
                        <span className={`px-1.5 py-0.5 rounded font-medium ${badge.classes}`}>{badge.label}</span>
                        <span className="font-mono text-muted-foreground">{hook.hookId}</span>
                        <span className="truncate flex-1 text-foreground">{hook.expectedPayoff || hook.type}</span>
                        <button
                          onClick={() => nav.toChapter(bookId, hook.startChapter)}
                          className="text-primary hover:underline shrink-0"
                        >
                          {t("hook.jumpTo")} #{hook.startChapter}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Grouped hooks */}
            <div className="space-y-4">
              {sortedGroups.map(({ status, items }) => (
                <div key={status} className="rounded-xl border border-border/40 bg-secondary/10 overflow-hidden">
                  <div className="px-4 py-3 border-b border-border/30 bg-muted/20 flex items-center gap-2">
                    {statusIcon(status)}
                    <h3 className="text-sm font-semibold">{statusLabel(status, t)}</h3>
                    <span className="text-xs text-muted-foreground">({items.length})</span>
                  </div>
                  <div className="divide-y divide-border/25">
                    {items.map((hook) => {
                      const riskScore = computeRiskScore(hook, currentChapterNum);
                      const rBadge = riskBadge(riskScore);
                      const halfLifeNum = parseInt(hook.halfLife, 10);
                      const isOverdue = halfLifeNum > 0 && currentChapterNum > (hook.startChapter || 0) + halfLifeNum;

                      // Parse dependencies
                      const deps = hook.dependsOn
                        ? hook.dependsOn.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
                        : [];
                      const dependedBy = dependedByMap.get(hook.hookId) ?? [];

                      return (
                        <div key={hook.hookId} className="px-4 py-3 hover:bg-primary/[0.03] transition-colors">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-[11px] text-muted-foreground/70">{hook.hookId}</span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${statusClass(hook.status)}`}>{statusLabel(hook.status, t)}</span>
                                {hook.type && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{hook.type}</span>}
                                {/是|true|yes|1/i.test(hook.coreHook) && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">{t("hook.core")}</span>
                                )}
                                {isOverdue && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-medium">
                                    {t("hook.overdue")}
                                  </span>
                                )}
                                {sortByRisk && (
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${rBadge.classes}`}>
                                    {rBadge.label} · {riskScore}
                                  </span>
                                )}
                              </div>
                              {hook.expectedPayoff && (
                                <p className="mt-1 text-sm text-foreground">{hook.expectedPayoff}</p>
                              )}
                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                {hook.startChapter > 0 && <span>{t("hook.startChapter")}: {hook.startChapter}</span>}
                                {hook.lastAdvancedChapter > 0 && <span>{t("hook.lastAdvanced")}: {hook.lastAdvancedChapter}</span>}
                                {hook.payoffTiming && <span>{t("hook.payoffTiming")}: {hook.payoffTiming}</span>}
                                {hook.paysOffInArc && <span>{t("hook.paysOffInArc")}: {hook.paysOffInArc}</span>}
                                {hook.halfLife && <span>{t("hook.halfLife")}: {hook.halfLife}</span>}
                                {currentChapterNum > 0 && halfLifeNum > 0 && (
                                  <span className={isOverdue ? "text-red-600 font-medium" : ""}>
                                    {t("hook.remaining")}: {Math.max(0, halfLifeNum - (currentChapterNum - hook.startChapter))} {t("hook.chaptersLeft")}
                                  </span>
                                )}
                              </div>

                              {/* Dependency chain visualization */}
                              {(deps.length > 0 || dependedBy.length > 0) && (
                                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                                  {deps.length > 0 && (
                                    <div className="flex items-center gap-1 text-muted-foreground">
                                      <span className="text-[10px] font-medium">{t("hook.depends")}:</span>
                                      {deps.map((depId, i) => {
                                        const depHook = hookMap.get(depId);
                                        return (
                                          <span key={depId} className="inline-flex items-center gap-0.5">
                                            {i > 0 && <span className="text-muted-foreground/50">,</span>}
                                            <span
                                              className={`px-1 py-0.5 rounded ${
                                                depHook
                                                  ? statusClass(depHook.status).replace("text-", "bg-").split(" ")[0] + " text-foreground/80"
                                                  : "bg-muted text-muted-foreground"
                                              }`}
                                              title={depHook ? `${depHook.expectedPayoff || ""} (${statusLabel(depHook.status, t)})` : t("hook.notFound")}
                                            >
                                              {depId}
                                            </span>
                                          </span>
                                        );
                                      })}
                                    </div>
                                  )}
                                  {dependedBy.length > 0 && (
                                    <div className="flex items-center gap-1 text-muted-foreground">
                                      <ArrowRight size={10} className="text-muted-foreground/50" />
                                      <span className="text-[10px] font-medium">{t("hook.dependedBy")}:</span>
                                      {dependedBy.slice(0, 3).map((depId, i) => {
                                        const depHook = hookMap.get(depId);
                                        return (
                                          <span key={depId} className="inline-flex items-center gap-0.5">
                                            {i > 0 && <span className="text-muted-foreground/50">,</span>}
                                            <span
                                              className={`px-1 py-0.5 rounded ${
                                                depHook
                                                  ? statusClass(depHook.status).replace("text-", "bg-").split(" ")[0] + " text-foreground/80"
                                                  : "bg-muted text-muted-foreground"
                                              }`}
                                              title={depHook ? `${depHook.expectedPayoff || ""} (${statusLabel(depHook.status, t)})` : t("hook.notFound")}
                                            >
                                              {depId}
                                            </span>
                                          </span>
                                        );
                                      })}
                                      {dependedBy.length > 3 && (
                                        <span className="text-muted-foreground/60">+{dependedBy.length - 3}</span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}

                              {hook.notes && <p className="mt-1 text-xs text-muted-foreground italic">{hook.notes}</p>}
                            </div>
                            {/* Actions */}
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => startEdit(hook)}
                                className="p-1 rounded text-muted-foreground/50 hover:text-primary hover:bg-primary/5 transition-colors"
                                title="编辑"
                              >
                                <Save size={12} />
                              </button>
                              <button
                                onClick={() => void handleDelete(hook.hookId)}
                                className="p-1 rounded text-muted-foreground/50 hover:text-destructive hover:bg-destructive/5 transition-colors"
                                title="删除"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Create / Edit Form Modal */}
        {(showCreateForm || editingHookId) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => { setShowCreateForm(false); setEditingHookId(null); }}>
            <div className="bg-card border border-border/50 rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold">{showCreateForm ? t("hook.create") : t("hook.edit")}</h3>
                <button onClick={() => { setShowCreateForm(false); setEditingHookId(null); }} className="p-1 rounded hover:bg-muted transition-colors">
                  <X size={14} />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">{t("hook.fieldId")}</label>
                  <input
                    value={editForm.hookId ?? ""}
                    onChange={(e) => setEditForm((f) => ({ ...f, hookId: e.target.value }))}
                    className="w-full mt-1 px-3 py-2 rounded-lg border border-border/50 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="hook-xxx"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">{t("hook.statusLabel")}</label>
                    <select
                      value={editForm.status ?? "open"}
                      onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                      className="w-full mt-1 px-3 py-2 rounded-lg border border-border/50 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      <option value="open">{t("hook.status.open")}</option>
                      <option value="progressing">{t("hook.status.progressing")}</option>
                      <option value="deferred">{t("hook.status.deferred")}</option>
                      <option value="resolved">{t("hook.status.resolved")}</option>
                      <option value="stale">{t("hook.status.stale")}</option>
                      <option value="blocked">{t("hook.status.blocked")}</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">{t("hook.fieldType")}</label>
                    <input
                      value={editForm.type ?? ""}
                      onChange={(e) => setEditForm((f) => ({ ...f, type: e.target.value }))}
                      className="w-full mt-1 px-3 py-2 rounded-lg border border-border/50 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder={t("hook.fieldType")}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">{t("hook.fieldExpectedPayoff")}</label>
                  <input
                    value={editForm.expectedPayoff ?? ""}
                    onChange={(e) => setEditForm((f) => ({ ...f, expectedPayoff: e.target.value }))}
                    className="w-full mt-1 px-3 py-2 rounded-lg border border-border/50 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder={t("hook.fieldExpectedPayoff")}
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">{t("hook.fieldStartChapter")}</label>
                    <input
                      type="number"
                      value={editForm.startChapter ?? ""}
                      onChange={(e) => setEditForm((f) => ({ ...f, startChapter: parseInt(e.target.value) || 0 }))}
                      className="w-full mt-1 px-3 py-2 rounded-lg border border-border/50 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">{t("hook.fieldHalfLife")}</label>
                    <input
                      value={editForm.halfLife ?? ""}
                      onChange={(e) => setEditForm((f) => ({ ...f, halfLife: e.target.value }))}
                      className="w-full mt-1 px-3 py-2 rounded-lg border border-border/50 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder={t("hook.halfLife")}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">{t("hook.fieldCoreHook")}</label>
                    <select
                      value={editForm.coreHook ?? ""}
                      onChange={(e) => setEditForm((f) => ({ ...f, coreHook: e.target.value }))}
                      className="w-full mt-1 px-3 py-2 rounded-lg border border-border/50 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      <option value="">{t("hook.no")}</option>
                      <option value="是">{t("hook.yes")}</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">{t("hook.fieldNotes")}</label>
                  <textarea
                    value={editForm.notes ?? ""}
                    onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                    className="w-full mt-1 px-3 py-2 rounded-lg border border-border/50 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                    rows={2}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => { setShowCreateForm(false); setEditingHookId(null); }}
                  className="px-4 py-2 rounded-lg text-xs font-bold text-muted-foreground hover:bg-muted transition-colors"
                >
                  {t("hook.cancel")}
                </button>
                <button
                  onClick={() => {
                    if (showCreateForm) void handleCreate();
                    else if (editingHookId) void handleUpdate(editingHookId);
                  }}
                  disabled={saving || !editForm.hookId?.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
                >
                  <Save size={12} />
                  {saving ? t("hook.saving") : t("hook.save")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
