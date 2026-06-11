import { useState } from "react";
import type { Theme } from "../../hooks/use-theme";
import type { TFunction } from "../../hooks/use-i18n";
import type { SSEMessage } from "../../hooks/use-sse";
import { useApi, fetchJson } from "../../hooks/use-api";
import {
  ShieldCheck,
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  Info,
  BarChart3,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Eye,
  Filter,
  X,
  Play,
} from "lucide-react";

interface AuditIssue {
  readonly severity: string;
  readonly category: string;
  readonly description: string;
}

interface AuditChapterRow {
  readonly chapterNumber: number;
  readonly title: string;
  readonly status: string;
  readonly wordCount: number;
  readonly lastScore?: number;
  readonly lastAuditedAt?: string;
  readonly issueCount: number;
  readonly criticalCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly topCategories: ReadonlyArray<string>;
  readonly issues: ReadonlyArray<AuditIssue>;
}

interface DetectionIssue {
  readonly severity: "warning" | "info";
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
}

interface DetectionResult {
  readonly chapterNumber: number;
  readonly issues: ReadonlyArray<DetectionIssue>;
}

interface DetectionStatsData {
  readonly totalDetections: number;
  readonly totalRewrites: number;
  readonly avgOriginalScore: number;
  readonly avgFinalScore: number;
  readonly avgScoreReduction: number;
  readonly passRate: number;
  readonly chapterBreakdown: ReadonlyArray<{
    readonly chapterNumber: number;
    readonly originalScore: number;
    readonly finalScore: number;
    readonly rewriteAttempts: number;
  }>;
}

interface AuditSummary {
  readonly bookId: string;
  readonly totalChapters: number;
  readonly auditedChapters: number;
  readonly passedChapters: number;
  readonly failedChapters: number;
  readonly averageScore?: number;
  readonly criticalCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly lastAuditedAt?: string;
  readonly categoryCounts: Record<string, number>;
  readonly rows: ReadonlyArray<AuditChapterRow>;
}

interface BookAuditSectionProps {
  readonly bookId: string;
  readonly nav: {
    readonly toDashboard: () => void;
    readonly toChapter: (bookId: string, num: number) => void;
    readonly toBook: (bookId: string) => void;
    readonly toBookSection: (bookId: string, section: string) => void;
    readonly toServices: () => void;
    readonly toAudit: () => void;
  };
  readonly theme: Theme;
  readonly t: TFunction;
  readonly sse: { readonly messages: ReadonlyArray<SSEMessage>; readonly connected: boolean };
}

function SeverityBadge({ severity }: { readonly severity: string }) {
  if (severity === "critical") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-medium">
        <AlertTriangle size={10} />
        {severity}
      </span>
    );
  }
  if (severity === "warning") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
        <AlertTriangle size={10} />
        {severity}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 font-medium">
      <Info size={10} />
      {severity}
    </span>
  );
}

function OverviewCard({
  label,
  value,
  icon,
  accent,
  danger,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border/40 bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className={`text-2xl font-bold ${danger ? "text-red-600" : accent ? "text-emerald-600" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function statusLabel(status: string, t: TFunction): string {
  switch (status) {
    case "ready-for-review": return t("audit.status.ready");
    case "audit-failed": return t("audit.status.failed");
    case "approved": return t("audit.status.approved");
    case "drafted": return t("audit.status.drafted");
    case "published": return t("audit.status.published");
    default: return status;
  }
}

function statusClass(status: string): string {
  switch (status) {
    case "ready-for-review":
    case "approved":
    case "published":
      return "text-emerald-600 dark:text-emerald-400";
    case "audit-failed":
      return "text-red-600 dark:text-red-400";
    case "drafted":
      return "text-amber-600 dark:text-amber-400";
    default:
      return "text-muted-foreground";
  }
}

export function BookAuditSection({ bookId, nav, t }: BookAuditSectionProps) {
  const [activeTab, setActiveTab] = useState<"audit" | "detection">("audit");

  const {
    data: summary,
    loading,
    error,
    refetch: refetchSummary,
  } = useApi<AuditSummary>(`/audit/books/${encodeURIComponent(bookId)}/summary`);

  const {
    data: detectionStats,
    loading: detectionLoading,
    error: detectionError,
    refetch: refetchDetection,
  } = useApi<DetectionStatsData>(activeTab === "detection" ? `/books/${bookId}/detect/stats` : null);

  const [severityFilter, setSeverityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerChapter, setDrawerChapter] = useState<AuditChapterRow | null>(null);
  const [auditingChapters, setAuditingChapters] = useState<ReadonlyArray<number>>([]);
  const [detectingChapters, setDetectingChapters] = useState<ReadonlyArray<number>>([]);
  const [detectingAll, setDetectingAll] = useState(false);
  const [detectionResults, setDetectionResults] = useState<ReadonlyArray<DetectionResult>>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reauditingAll, setReauditingAll] = useState(false);
  const [reauditProgress, setReauditProgress] = useState({ current: 0, total: 0 });
  const [trendOpen, setTrendOpen] = useState(true);
  const [failedSort, setFailedSort] = useState<"critical" | "recent">("critical");

  const passRate = summary && summary.totalChapters > 0
    ? Math.round((summary.passedChapters / summary.totalChapters) * 100)
    : 0;

  const allCategories = summary
    ? Array.from(new Set(summary.rows.flatMap((r) => r.issues.map((i) => i.category)))).filter(Boolean)
    : [];

  const filteredRows = summary
    ? summary.rows.filter((row) => {
        if (severityFilter !== "all") {
          const counts: Record<string, number> = {
            critical: row.criticalCount,
            warning: row.warningCount,
            info: row.infoCount,
          };
          if (counts[severityFilter] === 0) return false;
        }
        if (categoryFilter !== "all") {
          if (!row.issues.some((i) => i.category === categoryFilter)) return false;
        }
        return true;
      })
    : [];

  const categoryEntries = summary
    ? Object.entries(summary.categoryCounts).sort((a, b) => b[1] - a[1])
    : [];

  const maxCategoryCount = categoryEntries.length > 0 ? categoryEntries[0][1] : 1;

  const failedRows = summary
    ? summary.rows
        .filter((r) => r.status === "audit-failed")
        .sort((a, b) => {
          if (failedSort === "critical") return b.criticalCount - a.criticalCount;
          const ta = a.lastAuditedAt ? new Date(a.lastAuditedAt).getTime() : 0;
          const tb = b.lastAuditedAt ? new Date(b.lastAuditedAt).getTime() : 0;
          return tb - ta;
        })
    : [];

  const repeatedIssueCounts = summary
    ? summary.rows
        .flatMap((r) => r.issues)
        .reduce<Record<string, number>>((acc, issue) => {
          acc[issue.category] = (acc[issue.category] || 0) + 1;
          return acc;
        }, {})
    : {};

  const topRepeatedIssues = Object.entries(repeatedIssueCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const maxRepeatedCount = topRepeatedIssues.length > 0 ? topRepeatedIssues[0][1] : 1;

  const chartRows = summary
    ? [...summary.rows].sort((a, b) => a.chapterNumber - b.chapterNumber).slice(0, 20)
    : [];

  const recentChanges = summary
    ? [...summary.rows]
        .filter((r): r is AuditChapterRow & { lastAuditedAt: string } => !!r.lastAuditedAt)
        .sort((a, b) => new Date(b.lastAuditedAt).getTime() - new Date(a.lastAuditedAt).getTime())
        .slice(0, 5)
    : [];

  const handleAuditChapter = async (chapterNumber: number) => {
    setActionError(null);
    setAuditingChapters((prev) => [...prev, chapterNumber]);
    try {
      await fetchJson(`/books/${bookId}/audit/${chapterNumber}`, { method: "POST" });
      await refetchSummary();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Audit failed");
    } finally {
      setAuditingChapters((prev) => prev.filter((n) => n !== chapterNumber));
    }
  };

  const handleReauditAllFailed = async () => {
    if (!summary) return;
    const failed = summary.rows
      .filter((r) => r.status === "audit-failed")
      .sort((a, b) => b.criticalCount - a.criticalCount);
    if (failed.length === 0) return;

    setActionError(null);
    setReauditingAll(true);
    setReauditProgress({ current: 0, total: failed.length });

    try {
      for (let i = 0; i < failed.length; i++) {
        const row = failed[i];
        setReauditProgress({ current: i + 1, total: failed.length });
        await fetchJson(`/books/${bookId}/audit/${row.chapterNumber}`, { method: "POST" });
      }
      await refetchSummary();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Reaudit failed");
    } finally {
      setReauditingAll(false);
      setReauditProgress({ current: 0, total: 0 });
    }
  };

  const handleDetectChapter = async (chapterNumber: number) => {
    setActionError(null);
    setDetectingChapters((prev) => [...prev, chapterNumber]);
    try {
      const result = await fetchJson<DetectionResult>(`/books/${bookId}/detect/${chapterNumber}`, { method: "POST" });
      setDetectionResults((prev) => {
        const filtered = prev.filter((r) => r.chapterNumber !== chapterNumber);
        return [...filtered, result];
      });
      await refetchDetection();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Detection failed");
    } finally {
      setDetectingChapters((prev) => prev.filter((n) => n !== chapterNumber));
    }
  };

  const handleDetectAll = async () => {
    setActionError(null);
    setDetectingAll(true);
    try {
      const result = await fetchJson<{ results: ReadonlyArray<DetectionResult> }>(`/books/${bookId}/detect-all`, { method: "POST" });
      setDetectionResults(result.results);
      await refetchDetection();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Full detection failed");
    } finally {
      setDetectingAll(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="paper-sheet rounded-2xl border border-border/40 shadow-sm p-5 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-primary/70" />
            <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{t("workspace.section.audit")}</h2>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-border/50 bg-secondary/30 overflow-hidden">
              <button
                onClick={() => setActiveTab("audit")}
                className={`px-3 py-1.5 text-xs font-bold transition-colors ${activeTab === "audit" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t("audit.tab.audit")}
              </button>
              <button
                onClick={() => setActiveTab("detection")}
                className={`px-3 py-1.5 text-xs font-bold transition-colors ${activeTab === "detection" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t("audit.tab.detection")}
              </button>
            </div>
            <button
              onClick={() => activeTab === "audit" ? refetchSummary() : refetchDetection()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-secondary/40 px-3 py-2 text-xs font-bold text-muted-foreground hover:bg-secondary transition-colors"
              title={t("common.refresh")}
            >
              <RefreshCw size={14} />
              {t("common.refresh")}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {actionError && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-center justify-between">
            <span>{actionError}</span>
            <button onClick={() => setActionError(null)} className="text-xs font-bold hover:underline">{t("common.dismiss")}</button>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
          </div>
        )}

        {activeTab === "audit" && !loading && !summary && !error && (
          <div className="rounded-xl border border-border/40 bg-secondary/10 p-8 text-center space-y-4">
            <ShieldCheck size={32} className="mx-auto text-muted-foreground/40" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">{t("audit.notConfigured")}</p>
              <p className="text-xs text-muted-foreground/60">{t("audit.configureHint")}</p>
            </div>
            <button
              onClick={nav.toAudit}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:scale-[1.02] active:scale-[0.98] transition-transform"
            >
              {t("audit.goToConfig")}
            </button>
          </div>
        )}

        {activeTab === "audit" && !loading && summary && (
          <>
            {/* Overview cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <OverviewCard label={t("audit.totalChapters")} value={String(summary.totalChapters)} icon={<BookOpen size={16} />} />
              <OverviewCard label={t("audit.audited")} value={`${summary.auditedChapters}/${summary.totalChapters}`} icon={<Eye size={16} />} />
              <OverviewCard label={t("audit.passRate")} value={`${passRate}%`} icon={<CheckCircle2 size={16} />} accent={passRate >= 80} />
              <OverviewCard label={t("audit.averageScore")} value={summary.averageScore !== undefined ? String(summary.averageScore) : "—"} icon={<BarChart3 size={16} />} />
              <OverviewCard label={t("audit.critical")} value={String(summary.criticalCount)} icon={<AlertTriangle size={16} />} danger={summary.criticalCount > 0} />
              <OverviewCard label={t("audit.issues")} value={`${summary.warningCount}W / ${summary.infoCount}I`} icon={<Info size={16} />} />
            </div>

            {/* Failure queue */}
            <div className="rounded-xl border border-border/40 bg-secondary/10 overflow-hidden">
              <div className="px-4 py-3 border-b border-border/30 bg-muted/20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <AlertTriangle size={14} className="text-red-500" />
                    {t("audit.failureQueue")}
                  </h3>
                  {failedRows.length > 1 && (
                    <div className="inline-flex rounded border border-border/50 overflow-hidden text-[10px]">
                      <button
                        onClick={() => setFailedSort("critical")}
                        className={`px-2 py-0.5 font-medium transition-colors ${failedSort === "critical" ? "bg-primary text-primary-foreground" : "bg-secondary/30 text-muted-foreground hover:text-foreground"}`}
                      >
                        按严重度
                      </button>
                      <button
                        onClick={() => setFailedSort("recent")}
                        className={`px-2 py-0.5 font-medium transition-colors ${failedSort === "recent" ? "bg-primary text-primary-foreground" : "bg-secondary/30 text-muted-foreground hover:text-foreground"}`}
                      >
                        按最近审计
                      </button>
                    </div>
                  )}
                </div>
                {failedRows.length > 0 && (
                  <button
                    onClick={() => void handleReauditAllFailed()}
                    disabled={reauditingAll}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:scale-[1.02] active:scale-[0.98] transition-transform disabled:opacity-50"
                  >
                    {reauditingAll ? (
                      <div className="w-3 h-3 border-2 border-primary-foreground/20 border-t-primary-foreground rounded-full animate-spin" />
                    ) : (
                      <RefreshCw size={12} />
                    )}
                    {reauditingAll ? `${t("audit.reauditing")} ${reauditProgress.current}/${reauditProgress.total}` : t("audit.reauditAllFailed")}
                  </button>
                )}
              </div>
              {failedRows.length > 0 ? (
                <div className="divide-y divide-border/25">
                  {failedRows.map((row) => (
                    <div key={row.chapterNumber} className="px-4 py-3 flex items-center justify-between hover:bg-background/50 transition-colors">
                      <div className="flex items-center gap-4 min-w-0 flex-1">
                        <span className="font-mono text-xs text-muted-foreground w-8 shrink-0">{row.chapterNumber}</span>
                        <span className="text-sm truncate flex-1">{row.title}</span>
                        <div className="flex items-center gap-2 text-xs shrink-0">
                          {row.criticalCount > 0 && (
                            <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                              <AlertTriangle size={10} />
                              {row.criticalCount}
                            </span>
                          )}
                          {row.warningCount > 0 && (
                            <span className="inline-flex items-center gap-1 text-amber-600">
                              <AlertTriangle size={10} />
                              {row.warningCount}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => nav.toChapter(bookId, row.chapterNumber)}
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline ml-2 shrink-0"
                        title={t("audit.gotoChapter")}
                      >
                        <Eye size={12} />
                        {t("audit.gotoChapter")}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {t("audit.noFailedChapters")}
                </div>
              )}
            </div>

            {/* Audit trend chart */}
            {chartRows.length > 0 && (
              <div className="rounded-xl border border-border/40 bg-secondary/10 overflow-hidden">
                <button
                  onClick={() => setTrendOpen((v) => !v)}
                  className="w-full px-4 py-3 border-b border-border/30 bg-muted/20 flex items-center justify-between"
                >
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <BarChart3 size={14} />
                    {t("audit.auditTrend")}
                  </h3>
                  <ChevronDown
                    size={14}
                    className={`text-muted-foreground transition-transform ${trendOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {trendOpen && (
                  <div className="p-4 space-y-3">
                    <div className="flex items-end gap-1 h-40 px-2">
                      {chartRows.map((row) => {
                        const score = row.lastScore ?? 50;
                        const heightPct = `${score}%`;
                        let barColor = "bg-emerald-500";
                        if (row.status === "audit-failed") barColor = "bg-red-500";
                        else if (row.status === "ready-for-review") barColor = "bg-amber-400";
                        return (
                          <div key={row.chapterNumber} className="flex-1 flex flex-col items-center gap-1 group">
                            <div className="relative w-full flex justify-center">
                              <div
                                className={`w-full max-w-[24px] rounded-t ${barColor} opacity-90 group-hover:opacity-100 transition-opacity`}
                                style={{ height: heightPct }}
                                title={`${t("audit.chapter")} ${row.chapterNumber}: ${score}`}
                              />
                            </div>
                            <span className="text-[10px] text-muted-foreground font-mono">{row.chapterNumber}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" />
                        {t("audit.status.approved")}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2 h-2 rounded-sm bg-amber-400 inline-block" />
                        {t("audit.status.ready")}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2 h-2 rounded-sm bg-red-500 inline-block" />
                        {t("audit.status.failed")}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Recent audit changes */}
            {recentChanges.length > 0 && (
              <div className="rounded-xl border border-border/40 bg-secondary/10 overflow-hidden">
                <div className="px-4 py-3 border-b border-border/30 bg-muted/20">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <RefreshCw size={14} />
                    {t("audit.recentChanges")}
                  </h3>
                </div>
                <div className="divide-y divide-border/25">
                  {recentChanges.map((row) => {
                    let changeLabel = t("audit.status.ready");
                    let changeClass = "text-amber-600";
                    if (row.status === "approved" || row.status === "published") {
                      changeLabel = t("audit.changePassed");
                      changeClass = "text-emerald-600";
                    } else if (row.status === "audit-failed") {
                      changeLabel = t("audit.changeFailed");
                      changeClass = "text-red-600";
                    }
                    return (
                      <div key={row.chapterNumber} className="px-4 py-3 flex items-center justify-between hover:bg-background/50 transition-colors">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(row.lastAuditedAt).toLocaleString()}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground w-8 shrink-0">#{row.chapterNumber}</span>
                          <span className="text-sm truncate">{row.title}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 ml-2">
                          <span className={`text-xs font-medium ${changeClass}`}>{changeLabel}</span>
                          <span className={`font-mono text-xs font-medium ${(row.lastScore ?? 50) >= 80 ? "text-emerald-600" : (row.lastScore ?? 50) >= 60 ? "text-amber-600" : "text-red-600"}`}>
                            {row.lastScore ?? 50}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Category distribution */}
            {categoryEntries.length > 0 && (
              <div className="rounded-xl border border-border/40 bg-secondary/10 p-4">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <BarChart3 size={14} />
                  {t("audit.categoryDistribution")}
                </h3>
                <div className="space-y-2">
                  {categoryEntries.map(([category, count]) => (
                    <div key={category} className="flex items-center gap-3">
                      <div className="w-24 text-xs truncate" title={category}>{category}</div>
                      <div className="flex-1 h-4 bg-muted/50 rounded-full overflow-hidden">
                        <div className="h-full bg-primary/70 rounded-full transition-all" style={{ width: `${Math.max(4, (count / maxCategoryCount) * 100)}%` }} />
                      </div>
                      <div className="w-6 text-right text-xs font-medium">{count}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top 5 repeated issues */}
            {topRepeatedIssues.length > 0 && (
              <div className="rounded-xl border border-border/40 bg-secondary/10 p-4">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <BarChart3 size={14} />
                  {t("audit.topRepeatedIssues")}
                </h3>
                <div className="space-y-2">
                  {topRepeatedIssues.map(([category, count]) => (
                    <div key={category} className="flex items-center gap-3">
                      <div className="w-24 text-xs truncate" title={category}>{category}</div>
                      <div className="flex-1 h-4 bg-muted/50 rounded-full overflow-hidden">
                        <div className="h-full bg-amber-500/70 rounded-full transition-all" style={{ width: `${Math.max(4, (count / maxRepeatedCount) * 100)}%` }} />
                      </div>
                      <div className="w-6 text-right text-xs font-medium">{count}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Chapter table */}
            <div className="rounded-xl border border-border/40 bg-secondary/10 overflow-hidden">
              <div className="px-4 py-3 border-b border-border/30 bg-muted/20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <h3 className="text-sm font-semibold">{t("audit.chapterTable")}</h3>
                <div className="flex items-center gap-2">
                  <select
                    value={severityFilter}
                    onChange={(e) => setSeverityFilter(e.target.value)}
                    className="rounded-lg border border-border/50 bg-secondary/30 px-2 py-1.5 text-xs outline-none"
                  >
                    <option value="all">{t("audit.allSeverities")}</option>
                    <option value="critical">{t("audit.critical")}</option>
                    <option value="warning">{t("audit.warning")}</option>
                    <option value="info">{t("audit.info")}</option>
                  </select>
                  {allCategories.length > 0 && (
                    <select
                      value={categoryFilter}
                      onChange={(e) => setCategoryFilter(e.target.value)}
                      className="rounded-lg border border-border/50 bg-secondary/30 px-2 py-1.5 text-xs outline-none max-w-[140px]"
                    >
                      <option value="all">{t("audit.allCategories")}</option>
                      {allCategories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {t("audit.lastAudited")}: {summary.lastAuditedAt ? new Date(summary.lastAuditedAt).toLocaleString() : "—"}
                  </span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/30 border-b border-border/50">
                      <th className="text-left px-4 py-3 font-bold text-[11px] uppercase tracking-widest text-muted-foreground">#</th>
                      <th className="text-left px-4 py-3 font-bold text-[11px] uppercase tracking-widest text-muted-foreground">{t("audit.title")}</th>
                      <th className="text-left px-4 py-3 font-bold text-[11px] uppercase tracking-widest text-muted-foreground">{t("audit.status")}</th>
                      <th className="text-right px-4 py-3 font-bold text-[11px] uppercase tracking-widest text-muted-foreground">{t("audit.score")}</th>
                      <th className="text-right px-4 py-3 font-bold text-[11px] uppercase tracking-widest text-muted-foreground">{t("audit.issues")}</th>
                      <th className="text-left px-4 py-3 font-bold text-[11px] uppercase tracking-widest text-muted-foreground">{t("audit.topCategories")}</th>
                      <th className="text-right px-4 py-3 font-bold text-[11px] uppercase tracking-widest text-muted-foreground">{t("book.curate")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/25">
                    {filteredRows.map((row) => (
                      <tr key={row.chapterNumber} className="hover:bg-background/50 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs">{row.chapterNumber}</td>
                        <td className="px-4 py-3">{row.title}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium ${statusClass(row.status)}`}>{statusLabel(row.status, t)}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {row.lastScore !== undefined ? (
                            <span className={`font-mono font-medium ${row.lastScore >= 80 ? "text-emerald-600" : row.lastScore >= 60 ? "text-amber-600" : "text-red-600"}`}>
                              {row.lastScore}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {row.issueCount > 0 ? (
                            <button
                              onClick={() => { setDrawerChapter(row); setDrawerOpen(true); }}
                              className="font-mono hover:underline"
                            >
                              {row.criticalCount > 0 && <span className="text-red-600 font-medium">{row.criticalCount}C </span>}
                              {row.warningCount > 0 && <span className="text-amber-600">{row.warningCount}W </span>}
                              {row.infoCount > 0 && <span className="text-blue-600">{row.infoCount}I</span>}
                            </button>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {row.topCategories.map((cat) => (
                              <span key={cat} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{cat}</span>
                            ))}
                            {row.topCategories.length === 0 && <span className="text-muted-foreground">—</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => nav.toChapter(bookId, row.chapterNumber)}
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                              title={t("audit.view")}
                            >
                              <Eye size={12} />
                            </button>
                            <button
                              onClick={() => void handleAuditChapter(row.chapterNumber)}
                              disabled={auditingChapters.includes(row.chapterNumber)}
                              className="inline-flex items-center gap-1 rounded-lg bg-secondary/40 px-2 py-1 text-xs font-bold text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-50"
                              title={t("audit.run")}
                            >
                              {auditingChapters.includes(row.chapterNumber) ? (
                                <div className="w-3 h-3 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                              ) : (
                                <Play size={12} />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredRows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center text-sm text-muted-foreground">{t("audit.noChapters")}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {activeTab === "detection" && (
          <>
            {detectionError && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {detectionError}
              </div>
            )}

            {detectionLoading && (
              <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
              </div>
            )}

            {!detectionLoading && detectionStats && (
              <>
                {/* Detection stats overview */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <OverviewCard label={t("audit.totalDetections")} value={String(detectionStats.totalDetections)} icon={<BarChart3 size={16} />} />
                  <OverviewCard label={t("audit.passRate")} value={`${Math.round(detectionStats.passRate * 100)}%`} icon={<CheckCircle2 size={16} />} accent={detectionStats.passRate >= 0.8} />
                  <OverviewCard label={t("audit.avgScoreReduction")} value={detectionStats.avgScoreReduction.toFixed(1)} icon={<AlertTriangle size={16} />} />
                  <OverviewCard label={t("audit.totalRewrites")} value={String(detectionStats.totalRewrites)} icon={<RefreshCw size={16} />} />
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => void handleDetectAll()}
                    disabled={detectingAll}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground hover:scale-[1.02] active:scale-[0.98] transition-transform disabled:opacity-50"
                  >
                    {detectingAll ? (
                      <div className="w-3 h-3 border-2 border-primary-foreground/20 border-t-primary-foreground rounded-full animate-spin" />
                    ) : (
                      <Play size={14} />
                    )}
                    {t("audit.runDetectionAll")}
                  </button>
                </div>

                {/* Chapter breakdown */}
                {detectionStats.chapterBreakdown.length > 0 ? (
                  <div className="rounded-xl border border-border/40 bg-secondary/10 overflow-hidden">
                    <div className="px-4 py-3 border-b border-border/30 bg-muted/20">
                      <h3 className="text-sm font-semibold">{t("audit.chapterBreakdown")}</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/30 border-b border-border/50">
                            <th className="text-left px-4 py-3 font-bold text-[11px] uppercase tracking-widest text-muted-foreground">#</th>
                            <th className="text-right px-4 py-3 font-bold text-[11px] uppercase tracking-widest text-muted-foreground">{t("audit.originalScore")}</th>
                            <th className="text-right px-4 py-3 font-bold text-[11px] uppercase tracking-widest text-muted-foreground">{t("audit.finalScore")}</th>
                            <th className="text-right px-4 py-3 font-bold text-[11px] uppercase tracking-widest text-muted-foreground">{t("audit.rewriteAttempts")}</th>
                            <th className="text-right px-4 py-3 font-bold text-[11px] uppercase tracking-widest text-muted-foreground">{t("book.curate")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/25">
                          {detectionStats.chapterBreakdown.map((row) => (
                            <tr key={row.chapterNumber} className="hover:bg-background/50 transition-colors">
                              <td className="px-4 py-3 font-mono text-xs">{row.chapterNumber}</td>
                              <td className="px-4 py-3 text-right">
                                <span className={`font-mono font-medium ${row.originalScore >= 80 ? "text-emerald-600" : row.originalScore >= 60 ? "text-amber-600" : "text-red-600"}`}>
                                  {row.originalScore.toFixed(1)}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <span className={`font-mono font-medium ${row.finalScore >= 80 ? "text-emerald-600" : row.finalScore >= 60 ? "text-amber-600" : "text-red-600"}`}>
                                  {row.finalScore.toFixed(1)}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right font-mono">{row.rewriteAttempts}</td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    onClick={() => nav.toChapter(bookId, row.chapterNumber)}
                                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                    title={t("audit.view")}
                                  >
                                    <Eye size={12} />
                                  </button>
                                  <button
                                    onClick={() => void handleDetectChapter(row.chapterNumber)}
                                    disabled={detectingChapters.includes(row.chapterNumber)}
                                    className="inline-flex items-center gap-1 rounded-lg bg-secondary/40 px-2 py-1 text-xs font-bold text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-50"
                                    title={t("audit.runDetection")}
                                  >
                                    {detectingChapters.includes(row.chapterNumber) ? (
                                      <div className="w-3 h-3 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                                    ) : (
                                      <Play size={12} />
                                    )}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-border/40 bg-secondary/10 p-8 text-center">
                    <p className="text-sm text-muted-foreground">{t("audit.noDetectionData")}</p>
                    <button
                      onClick={() => void handleDetectAll()}
                      disabled={detectingAll}
                      className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:scale-[1.02] active:scale-[0.98] transition-transform disabled:opacity-50"
                    >
                      {detectingAll ? (
                        <div className="w-3 h-3 border-2 border-primary-foreground/20 border-t-primary-foreground rounded-full animate-spin" />
                      ) : (
                        <Play size={14} />
                      )}
                      {t("audit.runDetectionAll")}
                    </button>
                  </div>
                )}

                {/* Latest detection results */}
                {detectionResults.length > 0 && (
                  <div className="rounded-xl border border-border/40 bg-secondary/10 overflow-hidden">
                    <div className="px-4 py-3 border-b border-border/30 bg-muted/20">
                      <h3 className="text-sm font-semibold">{t("audit.issuesFound")}</h3>
                    </div>
                    <div className="p-4 space-y-3">
                      {detectionResults.map((result) => (
                        <div key={result.chapterNumber} className="border border-border/40 rounded-lg p-4 space-y-2 bg-background/50">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold">{t("audit.chapter")} #{result.chapterNumber}</span>
                            {result.issues.length > 0 ? (
                              <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
                                {result.issues.length} {t("audit.issues")}
                              </span>
                            ) : (
                              <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-medium">
                                {t("audit.status.approved")}
                              </span>
                            )}
                          </div>
                          {result.issues.length > 0 && (
                            <div className="space-y-2">
                              {result.issues.map((issue, idx) => (
                                <div key={idx} className="text-xs space-y-1">
                                  <div className="flex items-center gap-2">
                                    <SeverityBadge severity={issue.severity} />
                                    <span className="text-muted-foreground">{issue.category}</span>
                                  </div>
                                  <p className="text-muted-foreground">{issue.description}</p>
                                  {issue.suggestion && (
                                    <p className="text-primary/80">{t("audit.suggestion")}: {issue.suggestion}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Issue detail drawer */}
      {drawerOpen && drawerChapter && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setDrawerOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-lg h-full bg-card border-l shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold">{t("audit.chapterIssues")} #{drawerChapter.chapterNumber}</h3>
              <button onClick={() => setDrawerOpen(false)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {drawerChapter.issues.length === 0 ? (
                <p className="text-center text-muted-foreground py-12">{t("audit.noIssues")}</p>
              ) : (
                drawerChapter.issues.map((issue, idx) => (
                  <div key={idx} className="border border-border/40 rounded-lg p-4 space-y-2 bg-secondary/10">
                    <div className="flex items-center gap-2">
                      <SeverityBadge severity={issue.severity} />
                      {issue.category && <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">{issue.category}</span>}
                    </div>
                    <p className="text-sm">{issue.description || issue.category}</p>
                  </div>
                ))
              )}
            </div>
            <div className="px-6 py-4 border-t">
              <button
                onClick={() => { setDrawerOpen(false); nav.toChapter(bookId, drawerChapter.chapterNumber); }}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:scale-[1.02] active:scale-[0.98] transition-transform"
              >
                {t("audit.gotoChapter")}
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
