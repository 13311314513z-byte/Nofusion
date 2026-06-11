import { useState, useEffect } from "react";
import type { Theme } from "../../hooks/use-theme";
import type { TFunction } from "../../hooks/use-i18n";
import type { SSEMessage } from "../../hooks/use-sse";
import { fetchJson, useApi } from "../../hooks/use-api";
import {
  Download,
  FileText,
  BookOpen,
  Save,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  AlertTriangle,
  ListChecks,
  FileWarning,
  Tag,
  GitBranch,
  Clock,
} from "lucide-react";

type ExportFormat = "txt" | "md" | "epub" | "html";

interface BookData {
  readonly book: {
    readonly id: string;
    readonly title: string;
    readonly status: string;
    readonly targetChapters?: number;
    readonly wordCountTarget?: number;
  };
  readonly chapters: ReadonlyArray<{
    readonly number: number;
    readonly title: string;
    readonly status: string;
    readonly wordCount?: number;
    readonly tags?: ReadonlyArray<string>;
    readonly location?: string;
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
  readonly rows: ReadonlyArray<{
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
    readonly issues: ReadonlyArray<{
      readonly severity: string;
      readonly category: string;
      readonly description: string;
    }>;
  }>;
}

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

interface BookExportSectionProps {
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

export function BookExportSection({ bookId, nav, t }: BookExportSectionProps) {
  const { data, loading, error } = useApi<BookData>(`/books/${bookId}`);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("txt");
  const [exportApprovedOnly, setExportApprovedOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ path: string; chapters: number } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [auditSummary, setAuditSummary] = useState<AuditSummary | null>(null);
  const [hooks, setHooks] = useState<ReadonlyArray<HookRecord>>([]);
  const [checksLoading, setChecksLoading] = useState(true);
  const [checksError, setChecksError] = useState<string | null>(null);
  const [expandedChecks, setExpandedChecks] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setChecksLoading(true);
    setChecksError(null);
    Promise.all([
      fetchJson<AuditSummary>(`/audit/books/${encodeURIComponent(bookId)}/summary`),
      fetchJson<{ hooks: ReadonlyArray<HookRecord> }>(`/books/${bookId}/hooks`),
    ])
      .then(([auditData, hooksData]) => {
        if (cancelled) return;
        setAuditSummary(auditData);
        setHooks(hooksData.hooks ?? []);
      })
      .catch((e) => {
        if (cancelled) return;
        setChecksError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setChecksLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

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

  if (!data) return null;

  const { book, chapters } = data;
  const approvedChapters = chapters.filter((ch) => ch.status === "approved");
  const exportChapters = exportApprovedOnly ? approvedChapters : chapters;
  const exportWords = exportChapters.reduce((sum, ch) => sum + (ch.wordCount ?? 0), 0);
  const exportHref = `/api/v1/books/${bookId}/export?format=${exportFormat}${exportApprovedOnly ? "&approvedOnly=true" : ""}`;

  const handleSaveExport = async () => {
    setActionError(null);
    setSaving(true);
    setSaveResult(null);
    try {
      const result = await fetchJson<{ path?: string; chapters?: number }>(`/books/${bookId}/export-save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: exportFormat, approvedOnly: exportApprovedOnly }),
      });
      if (result.path && result.chapters !== undefined) {
        setSaveResult({ path: result.path, chapters: result.chapters });
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setSaving(false);
    }
  };

  // 4 类检查项
  const failedAuditChapters =
    auditSummary?.rows.filter((r) => r.status === "audit-failed").map((r) => ({ number: r.chapterNumber, title: r.title })) ?? [];
  const missingMetaChapters = chapters.filter(
    (ch) => !ch.tags || ch.tags.length === 0 || !ch.location || ch.location.trim() === ""
  );
  const unresolvedCoreHooks = hooks.filter((h) => h.status !== "resolved" && /是|true|yes|1/i.test(h.coreHook));
  const incompleteChapters = chapters.filter((ch) => ch.status !== "approved" && ch.status !== "published");

  const checkItems = [
    {
      id: 1,
      label: t("export.checkAuditFailed"),
      count: failedAuditChapters.length,
      icon: <FileWarning size={14} />,
      section: "audit" as const,
      items: failedAuditChapters.map((ch) => ({ key: String(ch.number), label: `${ch.number.toString().padStart(2, "0")} ${ch.title || t("chapter.label").replace("{n}", String(ch.number))}` })),
    },
    {
      id: 2,
      label: t("export.checkMissingMeta"),
      count: missingMetaChapters.length,
      icon: <Tag size={14} />,
      section: "chapters" as const,
      items: missingMetaChapters.map((ch) => ({ key: String(ch.number), label: `${ch.number.toString().padStart(2, "0")} ${ch.title || t("chapter.label").replace("{n}", String(ch.number))}` })),
    },
    {
      id: 3,
      label: t("export.checkUnresolvedCoreHooks"),
      count: unresolvedCoreHooks.length,
      icon: <GitBranch size={14} />,
      section: "hooks" as const,
      items: unresolvedCoreHooks.map((h) => ({ key: h.hookId, label: h.hookId })),
    },
    {
      id: 4,
      label: t("export.checkIncompleteChapters"),
      count: incompleteChapters.length,
      icon: <Clock size={14} />,
      section: "chapters" as const,
      items: incompleteChapters.map((ch) => ({ key: String(ch.number), label: `${ch.number.toString().padStart(2, "0")} ${ch.title || t("chapter.label").replace("{n}", String(ch.number))}` })),
    },
  ];

  const allChecksPassed = checkItems.every((c) => c.count === 0);

  const toggleCheck = (id: number) => {
    setExpandedChecks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="paper-sheet rounded-2xl border border-border/40 shadow-sm p-5 space-y-6">
        {actionError && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-center justify-between">
            <span>{actionError}</span>
            <button onClick={() => setActionError(null)} className="text-xs font-bold hover:underline">{t("common.dismiss")}</button>
          </div>
        )}
        {/* Header */}
        <div className="flex items-center gap-2">
          <Download size={16} className="text-primary/70" />
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{t("book.export")}</h2>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-xl border border-border/40 bg-secondary/20 p-4">
            <div className="text-xs text-muted-foreground font-medium">{t("dash.chapters")}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{exportChapters.length}</div>
          </div>
          <div className="rounded-xl border border-border/40 bg-secondary/20 p-4">
            <div className="text-xs text-muted-foreground font-medium">{t("book.words")}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{exportWords.toLocaleString()}</div>
          </div>
          <div className="rounded-xl border border-border/40 bg-secondary/20 p-4">
            <div className="text-xs text-muted-foreground font-medium">{t("book.approvedOnly")}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{approvedChapters.length}</div>
          </div>
          <div className="rounded-xl border border-border/40 bg-secondary/20 p-4">
            <div className="text-xs text-muted-foreground font-medium">{t("book.status")}</div>
            <div className="mt-1 text-sm font-semibold">{book.status}</div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <FileText size={14} />
            {t("book.exportFormat")}
          </label>
          <select
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
            className="rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-sm outline-none focus:border-primary/50"
          >
            <option value="txt">TXT</option>
            <option value="md">Markdown</option>
            <option value="html">HTML</option>
            <option value="epub">EPUB</option>
          </select>

          <label className="flex items-center gap-2 text-sm font-medium text-muted-foreground cursor-pointer select-none ml-2">
            <input
              type="checkbox"
              checked={exportApprovedOnly}
              onChange={(e) => { setExportApprovedOnly(e.target.checked); setSaveResult(null); }}
              className="rounded border-border/50"
            />
            {t("book.approvedOnly")}
          </label>
        </div>

        {/* Export Checks */}
        <div className="rounded-xl border border-border/40 bg-secondary/10 overflow-hidden">
          <button
            onClick={() => toggleCheck(0)}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 border-b border-border/30 bg-muted/20"
          >
            <div className="flex items-center gap-2">
              <ListChecks size={14} className="text-muted-foreground" />
              <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{t("export.checkTitle")}</span>
              {checksLoading ? (
                <span className="text-xs text-muted-foreground">({t("common.loading")})</span>
              ) : checksError ? (
                <span className="text-xs text-destructive">({t("export.checkLoadError")})</span>
              ) : allChecksPassed ? (
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 font-medium">
                  <ShieldCheck size={10} />
                  {t("export.checkPassed")}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
                  <AlertTriangle size={10} />
                  {t("export.checkWarning")}
                </span>
              )}
            </div>
            {expandedChecks.has(0) ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
          </button>
          {expandedChecks.has(0) && (
            <div className="divide-y divide-border/25">
              {checksError && (
                <div className="px-4 py-3 text-sm text-destructive">{checksError}</div>
              )}
              {!checksError &&
                checkItems.map((item) => (
                  <div key={item.id}>
                    <button
                      onClick={() => toggleCheck(item.id)}
                      className="w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-secondary/20 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-muted-foreground">{item.icon}</span>
                        <span className="text-sm text-foreground truncate">{item.label}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`text-xs font-semibold tabular-nums ${item.count > 0 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}
                        >
                          {item.count}
                        </span>
                        {expandedChecks.has(item.id) ? <ChevronUp size={12} className="text-muted-foreground" /> : <ChevronDown size={12} className="text-muted-foreground" />}
                      </div>
                    </button>
                    {expandedChecks.has(item.id) && item.items.length > 0 && (
                      <div className="px-4 pb-2 space-y-1">
                        {item.items.map((sub) => (
                          <button
                            key={sub.key}
                            onClick={() => {
                              nav.toBookSection(bookId, item.section);
                            }}
                            className="w-full text-left px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-secondary/30 hover:text-foreground transition-colors truncate"
                          >
                            {sub.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {expandedChecks.has(item.id) && item.items.length === 0 && (
                      <div className="px-4 pb-2 text-xs text-muted-foreground">{t("export.checkEmpty")}</div>
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={exportHref}
            download
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-all hover:scale-105 active:scale-95"
          >
            <Download size={16} />
            {t("book.download")}
          </a>
          <button
            onClick={handleSaveExport}
            disabled={saving || exportChapters.length === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-border/50 bg-secondary/40 px-4 py-2.5 text-sm font-bold text-muted-foreground transition-all hover:bg-secondary hover:text-foreground disabled:opacity-50"
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
            ) : (
              <Save size={16} />
            )}
            {t("book.saveToProject")}
          </button>
        </div>

        {/* Empty hint */}
        {exportChapters.length === 0 && (
          <div className="rounded-lg border border-border/40 bg-secondary/10 p-4 text-sm text-muted-foreground">
            {exportApprovedOnly ? t("book.noApprovedChapters") : t("book.noChapters")}
          </div>
        )}

        {/* Save result */}
        {saveResult && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-1">
            <div className="text-sm font-medium text-primary">{t("common.exportSuccess")}</div>
            <div className="text-xs text-muted-foreground font-mono break-all">{saveResult.path}</div>
            <div className="text-xs text-muted-foreground">{saveResult.chapters} {t("dash.chapters")} · {exportWords.toLocaleString()} {t("book.words")}</div>
          </div>
        )}

        {/* Chapter preview */}
        {exportChapters.length > 0 && (
          <div className="rounded-xl border border-border/40 bg-secondary/10 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/30 bg-muted/20 flex items-center gap-2">
              <BookOpen size={14} className="text-muted-foreground" />
              <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{t("book.manuscriptTitle")}</span>
              <span className="text-xs text-muted-foreground">({exportChapters.length})</span>
            </div>
            <div className="max-h-64 overflow-y-auto divide-y divide-border/25">
              {exportChapters.map((ch) => (
                <div key={ch.number} className="px-4 py-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[11px] text-muted-foreground/70">{ch.number.toString().padStart(2, "0")}</span>
                    <span className="truncate text-sm">{ch.title || t("chapter.label").replace("{n}", String(ch.number))}</span>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{(ch.wordCount ?? 0).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
