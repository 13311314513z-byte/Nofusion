import { useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";

interface TokenStats {
  readonly totalPromptTokens: number;
  readonly totalCompletionTokens: number;
  readonly totalTokens: number;
  readonly avgTokensPerChapter: number;
  readonly recentTrend: ReadonlyArray<{ readonly chapter: number; readonly totalTokens: number }>;
}

interface AnalyticsData {
  readonly bookId: string;
  readonly totalChapters: number;
  readonly totalWords: number;
  readonly avgWordsPerChapter: number;
  readonly statusDistribution: Record<string, number>;
  readonly tokenStats?: TokenStats;
  readonly auditPassRate: number;
  readonly topIssueCategories: ReadonlyArray<{ readonly category: string; readonly count: number }>;
  readonly chaptersWithMostIssues: ReadonlyArray<{ readonly chapter: number; readonly issueCount: number }>;
}

interface AuditSummaryRow {
  readonly chapterNumber: number;
  readonly title: string;
  readonly status: string;
  readonly wordCount: number;
  readonly lastScore?: number;
  readonly issueCount: number;
  readonly criticalCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly topCategories: ReadonlyArray<string>;
}

interface AuditSummaryResponse {
  readonly rows: ReadonlyArray<AuditSummaryRow>;
  readonly auditedCount: number;
  readonly passedCount: number;
}

interface Nav {
  toBook: (id: string) => void;
  toDashboard: () => void;
}

export function Analytics({ bookId, nav, theme, t }: { bookId: string; nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data, loading, error } = useApi<AnalyticsData>(`/books/${bookId}/analytics`);
  const { data: auditSummary } = useApi<AuditSummaryResponse>(`/audit/books/${bookId}/summary`);

  if (loading) return <div className={c.muted}>{t("common.loading")}</div>;
  if (error) return <div className="text-red-400">{t("common.error")}: {error}</div>;
  if (!data) return null;

  const statuses = Object.entries(data.statusDistribution);
  const totalFromDist = statuses.reduce((sum, [, count]) => sum + count, 0);
  const ts = data.tokenStats;

  return (
    <div className="space-y-6">
      <div className={`flex items-center gap-2 text-sm ${c.muted}`}>
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.books")}</button>
        <span>/</span>
        <button onClick={() => nav.toBook(bookId)} className={c.link}>{bookId}</button>
        <span>/</span>
        <span className={c.subtle}>{t("analytics.title")}</span>
      </div>

      <h1 className="text-2xl font-semibold">{t("analytics.title")}</h1>

      {/* Basic stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard label={t("analytics.totalChapters")} value={data.totalChapters.toString()} c={c} />
        <StatCard label={t("analytics.totalWords")} value={data.totalWords.toLocaleString()} c={c} />
        <StatCard label={t("analytics.avgWords")} value={data.avgWordsPerChapter.toLocaleString()} c={c} />
        <StatCard label={t("analytics.auditPassRate")} value={`${data.auditPassRate}%`} c={c} accent={data.auditPassRate >= 80} />
        {ts && (
          <>
            <StatCard label={t("analytics.totalTokens")} value={ts.totalTokens.toLocaleString()} c={c} />
            <StatCard label={t("analytics.avgTokens")} value={ts.avgTokensPerChapter.toLocaleString()} c={c} />
          </>
        )}
      </div>

      {/* Token detail */}
      {ts && (
        <div className={`border ${c.cardStatic} rounded-lg p-5`}>
          <h2 className={`text-sm font-medium ${c.subtle} mb-4`}>{t("analytics.tokenStats")}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className={`text-xs ${c.muted} mb-1`}>{t("analytics.totalTokens")}</div>
              <div className="text-xl font-semibold tabular-nums">{ts.totalTokens.toLocaleString()}</div>
            </div>
            <div className="text-center">
              <div className={`text-xs ${c.muted} mb-1`}>{t("analytics.promptTokens")}</div>
              <div className="text-xl font-semibold tabular-nums">{ts.totalPromptTokens.toLocaleString()}</div>
            </div>
            <div className="text-center">
              <div className={`text-xs ${c.muted} mb-1`}>{t("analytics.completionTokens")}</div>
              <div className="text-xl font-semibold tabular-nums">{ts.totalCompletionTokens.toLocaleString()}</div>
            </div>
            <div className="text-center">
              <div className={`text-xs ${c.muted} mb-1`}>{t("analytics.avgTokens")}</div>
              <div className="text-xl font-semibold tabular-nums">{ts.avgTokensPerChapter.toLocaleString()}</div>
            </div>
          </div>
          {ts.recentTrend.length > 0 && (
            <div className="mt-4">
              <div className={`text-xs ${c.muted} mb-2`}>{t("analytics.recentTokenTrend")}</div>
              <div className="flex items-end gap-2 h-24">
                {ts.recentTrend.map((pt) => {
                  const max = Math.max(...ts.recentTrend.map((p) => p.totalTokens), 1);
                  const h = `${(pt.totalTokens / max) * 100}%`;
                  return (
                    <div key={pt.chapter} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full bg-primary/60 rounded-t" style={{ height: h }} title={`Ch${pt.chapter}: ${pt.totalTokens.toLocaleString()}`} />
                      <span className="text-[10px] text-muted-foreground">{pt.chapter}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Audit trend chart */}
      {auditSummary && auditSummary.rows.filter((r) => r.lastScore != null).length > 0 && (
        <div className={`border ${c.cardStatic} rounded-lg p-5`}>
          <h2 className={`text-sm font-medium ${c.subtle} mb-4`}>{t("analytics.auditTrend") ?? "审计趋势"}</h2>
          <div className="overflow-x-auto">
            <div className="flex items-end gap-2 min-w-[400px]" style={{ height: 160 }}>
              {auditSummary.rows
                .filter((r) => r.lastScore != null)
                .slice(-20)
                .map((r) => {
                  const h = `${Math.max(4, r.lastScore ?? 0)}%`;
                  return (
                    <div key={r.chapterNumber} className="flex-1 flex flex-col items-center gap-1 group relative">
                      <div
                        className={`w-full rounded-t cursor-pointer transition-all ${
                          (r.lastScore ?? 0) >= 80 ? "bg-emerald-400" : (r.lastScore ?? 0) >= 60 ? "bg-amber-400" : "bg-red-400"
                        }`}
                        style={{ height: h }}
                        title={`Ch${r.chapterNumber}: ${r.lastScore}分 | ${r.issueCount}问题`}
                      />
                      <span className="text-[10px] text-muted-foreground">{r.chapterNumber}</span>
                      {/* Tooltip on hover */}
                      <div className="absolute bottom-full mb-1 hidden group-hover:block bg-popover text-popover-foreground text-xs rounded px-2 py-1 whitespace-nowrap shadow-lg z-10">
                        Ch{r.chapterNumber} · {r.lastScore}分 · {r.issueCount}问题
                        {r.criticalCount > 0 && ` · 🔴${r.criticalCount}`}
                        {r.warningCount > 0 && ` · 🟠${r.warningCount}`}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-400 inline-block" /> ≥80 分</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-400 inline-block" /> 60-79 分</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-400 inline-block" /> &lt;60 分</span>
            <span>{auditSummary.rows.filter((r) => r.lastScore != null).length} 章已审计</span>
          </div>
        </div>
      )}

      {/* Top issue categories */}
      {data.topIssueCategories.length > 0 && (
        <div className={`border ${c.cardStatic} rounded-lg p-5`}>
          <h2 className={`text-sm font-medium ${c.subtle} mb-4`}>{t("analytics.topIssues")}</h2>
          <div className="space-y-3">
            {data.topIssueCategories.map(({ category, count }) => {
              const max = data.topIssueCategories[0]?.count ?? 1;
              return (
                <div key={category}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className={c.subtle}>{category}</span>
                    <span className={c.muted}>{count}</span>
                  </div>
                  <div className={`h-2 ${c.btnSecondary} rounded-full overflow-hidden`}>
                    <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${Math.max(4, (count / max) * 100)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Chapters with most issues */}
      {data.chaptersWithMostIssues.length > 0 && (
        <div className={`border ${c.cardStatic} rounded-lg p-5`}>
          <h2 className={`text-sm font-medium ${c.subtle} mb-4`}>{t("analytics.chaptersWithMostIssues")}</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {data.chaptersWithMostIssues.map(({ chapter, issueCount }) => (
              <div key={chapter} className={`border ${c.btnSecondary} rounded-lg p-3 text-center`}>
                <div className="text-xs text-muted-foreground">{t("bread.chapter").replace("{n}", String(chapter))}</div>
                <div className="text-lg font-semibold tabular-nums text-destructive">{issueCount}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status distribution */}
      {statuses.length > 0 && (
        <div className={`border ${c.cardStatic} rounded-lg p-5`}>
          <h2 className={`text-sm font-medium ${c.subtle} mb-4`}>{t("analytics.statusDist")}</h2>
          <div className="space-y-3">
            {statuses.map(([status, count]) => (
              <div key={status}>
                <div className="flex justify-between text-sm mb-1">
                  <span className={c.subtle}>{status}</span>
                  <span className={c.muted}>{count}</span>
                </div>
                <div className={`h-2 ${c.btnSecondary} rounded-full overflow-hidden`}>
                  <div className="h-full bg-zinc-500 rounded-full transition-all" style={{ width: `${totalFromDist > 0 ? (count / totalFromDist) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, c, accent }: { label: string; value: string; c: ReturnType<typeof useColors>; accent?: boolean }) {
  return (
    <div className={`border ${c.cardStatic} rounded-lg p-5`}>
      <div className={`text-sm ${c.muted} mb-1`}>{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${accent ? "text-emerald-600" : ""}`}>{value}</div>
    </div>
  );
}
