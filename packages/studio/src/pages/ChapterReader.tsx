import { useState } from "react";
import { fetchJson, useApi, postApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import {
  ChevronLeft,
  Check,
  X,
  List,
  RotateCcw,
  BookOpen,
  CheckCircle2,
  XCircle,
  Hash,
  Type,
  Clock,
  Pencil,
  Save,
  Eye,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  Info,
} from "lucide-react";

interface ChapterData {
  readonly chapterNumber: number;
  readonly filename: string;
  readonly content: string;
}

interface AuditIssue {
  readonly severity: "critical" | "warning" | "info";
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
}

interface AuditResult {
  readonly passed: boolean;
  readonly issues: ReadonlyArray<AuditIssue>;
  readonly summary: string;
  readonly overallScore?: number;
}

interface Nav {
  toBook: (id: string) => void;
  toDashboard: () => void;
}

export function ChapterReader({ bookId, chapterNumber, nav, theme, t }: {
  bookId: string;
  chapterNumber: number;
  nav: Nav;
  theme: Theme;
  t: TFunction;
}) {
  const c = useColors(theme);
  const { data, loading, error, refetch } = useApi<ChapterData>(
    `/books/${bookId}/chapters/${chapterNumber}`,
  );
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [showAudit, setShowAudit] = useState(false);

  const handleStartEdit = () => {
    if (!data) return;
    setEditContent(data.content);
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setEditContent("");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetchJson(`/books/${bookId}/chapters/${chapterNumber}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      setEditing(false);
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-32 space-y-4">
      <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
      <span className="text-sm text-muted-foreground">{t("reader.openingManuscript")}</span>
    </div>
  );

  if (error) return <div className="text-destructive p-8 bg-destructive/5 rounded-xl border border-destructive/20">Error: {error}</div>;
  if (!data) return null;

  // Split markdown content into title and body
  const lines = data.content.split("\n");
  const titleLine = lines.find((l) => l.startsWith("# "));
  const title = titleLine?.replace(/^#\s*/, "") ?? `Chapter ${chapterNumber}`;
  const body = lines
    .filter((l) => l !== titleLine)
    .join("\n")
    .trim();

  const handleApprove = async () => {
    try {
      await postApi(`/books/${bookId}/chapters/${chapterNumber}/approve`);
      nav.toBook(bookId);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Approve failed");
    }
  };

  const handleReject = async () => {
    try {
      await postApi(`/books/${bookId}/chapters/${chapterNumber}/reject`);
      nav.toBook(bookId);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Reject failed");
    }
  };

  const handleAudit = async () => {
    setAuditing(true);
    setAuditError(null);
    setAuditResult(null);
    setShowAudit(true);
    try {
      const result = await postApi<AuditResult>(`/books/${bookId}/audit/${chapterNumber}`);
      setAuditResult(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "审计失败";
      setAuditError(msg);
    } finally {
      setAuditing(false);
    }
  };

  const paragraphs = body.split(/\n\n+/).filter(Boolean);

  /** Count how many audit issues reference content likely in this paragraph */
  function paragraphIssueCount(para: string, issues: ReadonlyArray<AuditIssue>): {
    count: number;
    maxSeverity: "critical" | "warning" | "info" | null;
  } {
    let count = 0;
    let maxSeverity: "critical" | "warning" | "info" | null = null;
    const severityRank = { critical: 3, warning: 2, info: 1 };
    for (const issue of issues) {
      // Extract meaningful keywords from the issue description
      const keywords = issue.description
        .replace(/[「」""''（）()\d，。、；：！？]/g, " ")
        .split(/\s+/)
        .filter((k) => k.length >= 2 && !["一个", "这个", "那个", "什么", "怎么", "如何", "没有", "可以", "可能", "应该", "已经", "之后", "时候", "情况", "问题", "需要", "出现", "存在", "是否", "进行", "使用", "通过", "关于", "其中", "部分", "方式", "阶段", "内容", "相关", "主要", "当前", "目前", "以前", "原本", "原因", "结果", "影响", "属于"].includes(k));
      // Allow single keyword match if it's at least 4 chars (likely a name or key term)
      const longKeywords = keywords.filter((k) => k.length >= 4);
      const matchCount = keywords.filter((k) => para.includes(k)).length;
      if (matchCount >= 1) {
        count++;
        if (severityRank[issue.severity] > (maxSeverity ? severityRank[maxSeverity] : 0)) {
          maxSeverity = issue.severity;
        }
      } else if (longKeywords.some((k) => para.includes(k))) {
        count++;
        if (severityRank[issue.severity] > (maxSeverity ? severityRank[maxSeverity] : 0)) {
          maxSeverity = issue.severity;
        }
      }
    }
    return { count, maxSeverity };
  }

  return (
    <div className="max-w-4xl mx-auto space-y-10 fade-in">
      {/* Navigation & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <nav className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
          <button
            onClick={nav.toDashboard}
            className="hover:text-primary transition-colors flex items-center gap-1"
          >
            {t("bread.books")}
          </button>
          <span className="text-border">/</span>
          <button
            onClick={() => nav.toBook(bookId)}
            className="hover:text-primary transition-colors truncate max-w-[120px]"
          >
            {bookId}
          </button>
          <span className="text-border">/</span>
          <span className="text-foreground flex items-center gap-1">
            <Hash size={12} />
            {chapterNumber}
          </span>
        </nav>

        <div className="flex gap-2">
          <button
            onClick={() => nav.toBook(bookId)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground rounded-xl hover:text-foreground hover:bg-secondary/80 transition-all border border-border/50"
          >
            <List size={14} />
            {t("reader.backToList")}
          </button>

          {/* Edit / Preview toggle */}
          {editing ? (
            <>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-primary text-primary-foreground rounded-xl hover:scale-105 active:scale-95 transition-all shadow-sm disabled:opacity-50"
              >
                {saving ? <div className="w-3.5 h-3.5 border-2 border-primary-foreground/20 border-t-primary-foreground rounded-full animate-spin" /> : <Save size={14} />}
                {saving ? t("book.saving") : t("book.save")}
              </button>
              <button
                onClick={handleCancelEdit}
                className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground rounded-xl hover:text-foreground transition-all border border-border/50"
              >
                <Eye size={14} />
                {t("reader.preview")}
              </button>
            </>
          ) : (
            <button
              onClick={handleStartEdit}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground rounded-xl hover:text-primary hover:bg-primary/10 transition-all border border-border/50"
            >
              <Pencil size={14} />
              {t("reader.edit")}
            </button>
          )}

          <button
            onClick={handleApprove}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-emerald-500/10 text-emerald-600 rounded-xl hover:bg-emerald-500 hover:text-white transition-all border border-emerald-500/20 shadow-sm"
          >
            <CheckCircle2 size={14} />
            {t("reader.approve")}
          </button>
          <button
            onClick={handleReject}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-destructive/10 text-destructive rounded-xl hover:bg-destructive hover:text-white transition-all border border-destructive/20 shadow-sm"
          >
            <XCircle size={14} />
            {t("reader.reject")}
          </button>
          <button
            onClick={handleAudit}
            disabled={auditing}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-amber-500/10 text-amber-600 rounded-xl hover:bg-amber-500 hover:text-white transition-all border border-amber-500/20 shadow-sm disabled:opacity-50"
          >
            {auditing ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            {auditing ? "审计中…" : "审计"}
          </button>
        </div>
      </div>

      {/* Manuscript Sheet */}
      <div className="paper-sheet rounded-2xl p-8 md:p-16 lg:p-24 shadow-2xl shadow-primary/5 min-h-[80vh] relative overflow-hidden">
        {/* Physical Paper Details */}
        <div className="absolute top-0 left-8 w-px h-full bg-primary/5 hidden md:block" />
        <div className="absolute top-0 right-8 w-px h-full bg-primary/5 hidden md:block" />

        <header className="mb-16 text-center">
          <div className="flex items-center justify-center gap-2 text-muted-foreground/30 mb-8 select-none">
            <div className="h-px w-12 bg-border/40" />
            <BookOpen size={20} />
            <div className="h-px w-12 bg-border/40" />
          </div>
          <h1 className="text-4xl md:text-5xl font-serif font-medium italic text-foreground tracking-tight leading-tight">
            {title}
          </h1>
          <div className="mt-8 flex items-center justify-center gap-4 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
            <span>{t("reader.manuscriptPage")}</span>
            <span className="text-border">·</span>
            <span>{chapterNumber.toString().padStart(2, '0')}</span>
          </div>
        </header>

        {editing ? (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full min-h-[60vh] bg-transparent font-serif text-lg leading-[1.8] text-foreground/90 focus:outline-none resize-none border border-border/30 rounded-lg p-6 focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all"
            autoFocus
          />
        ) : (
          <article className="prose prose-zinc dark:prose-invert max-w-none">
            {paragraphs.map((para, i) => {
              const { count: issueCount, maxSeverity } = auditResult && showAudit
                ? paragraphIssueCount(para, auditResult.issues)
                : { count: 0, maxSeverity: null };
              let borderClass = "";
              let bgClass = "";
              if (issueCount > 0 && maxSeverity) {
                if (maxSeverity === "critical") {
                  borderClass = "border-l-4 border-red-400";
                  bgClass = "bg-red-50/50 dark:bg-red-950/20";
                } else if (maxSeverity === "warning") {
                  borderClass = "border-l-4 border-amber-400";
                  bgClass = "bg-amber-50/50 dark:bg-amber-950/20";
                } else {
                  borderClass = "border-l-4 border-blue-300";
                  bgClass = "bg-blue-50/30 dark:bg-blue-950/10";
                }
              }
              return (
                <div key={i} className={`${borderClass} ${bgClass} rounded-r-lg pl-4 pr-2 py-1 mb-8 transition-colors relative`}>
                  {issueCount > 0 && (
                    <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-amber-400 shadow-sm" title={`${issueCount} 个相关问题`} />
                  )}
                  <p className="font-serif text-lg md:text-xl leading-[1.8] text-foreground/90">
                    {para}
                  </p>
                </div>
              );
            })}
          </article>
        )}

        <footer className="mt-24 pt-12 border-t border-border/20 flex flex-col items-center gap-6 text-center">
          <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground">
             <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary/50">
               <Type size={14} className="text-primary/60" />
               <span>{body.length.toLocaleString()} {t("reader.characters")}</span>
             </div>
             <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary/50">
               <Clock size={14} className="text-primary/60" />
               <span>{Math.ceil(body.length / 500)} {t("reader.minRead")}</span>
             </div>
          </div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground/40 font-bold">{t("reader.endOfChapter")}</p>
        </footer>

        {/* Audit Results (below chapter text) */}
        {showAudit && (
          <div className="mt-8 pt-8 border-t border-amber-200 dark:border-amber-800 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <ShieldCheck size={16} className="text-amber-600" />
                审计结果
              </h3>
              <button onClick={() => setShowAudit(false)} className="text-xs text-muted-foreground hover:text-foreground">关闭</button>
            </div>

            {auditing && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground py-4">
                <Loader2 size={16} className="animate-spin" />
                正在审计本章…
              </div>
            )}

            {auditError && (
              <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/20 rounded-lg p-4 border border-red-200 dark:border-red-800">
                <div className="font-medium mb-1">审计失败</div>
                <div className="text-red-500/80 text-xs">{auditError}</div>
                <div className="mt-2 text-xs text-muted-foreground/70">
                  请确保已在「审计」页面中正确配置审计服务、模型和 API Key。
                </div>
              </div>
            )}

            {auditResult && (
              <>
                <div className="flex items-center gap-3">
                  <div className={`text-xs font-bold px-3 py-1.5 rounded-full ${
                    auditResult.passed
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                      : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  }`}>
                    {auditResult.passed ? "✅ 通过" : "❌ 未通过"}
                  </div>
                  {auditResult.overallScore != null && (
                    <span className="text-xs text-muted-foreground">
                      评分: <strong>{auditResult.overallScore}</strong>/100
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {auditResult.issues.length} 个问题
                  </span>
                </div>

                {auditResult.issues.length > 0 && (
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {auditResult.issues.map((issue, i) => (
                      <div key={i} className={`p-3 rounded-lg text-sm border ${
                        issue.severity === "critical"
                          ? "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800"
                          : issue.severity === "warning"
                            ? "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800"
                            : "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800"
                      }`}>
                        <div className="flex items-center gap-1.5 mb-1">
                          {issue.severity === "critical" ? (
                            <XCircle size={12} className="text-red-500" />
                          ) : issue.severity === "warning" ? (
                            <AlertTriangle size={12} className="text-amber-500" />
                          ) : (
                            <Info size={12} className="text-blue-500" />
                          )}
                          <span className="font-medium text-xs uppercase tracking-wider">{issue.category}</span>
                          <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            issue.severity === "critical"
                              ? "bg-red-100 text-red-700 dark:bg-red-900/30"
                              : issue.severity === "warning"
                                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30"
                                : "bg-blue-100 text-blue-700 dark:bg-blue-900/30"
                          }`}>
                            {issue.severity === "critical" ? "严重" : issue.severity === "warning" ? "警告" : "提示"}
                          </span>
                        </div>
                        <p className="text-muted-foreground">{issue.description}</p>
                        {issue.suggestion && (
                          <p className="text-xs text-muted-foreground/70 mt-1 italic">
                            建议: {issue.suggestion}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="text-xs text-muted-foreground/60 italic">
                  {auditResult.summary}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Footer Navigation */}
      <div className="flex justify-between items-center py-8">
        {chapterNumber > 1 ? (
          <button
            onClick={() => nav.toBook(bookId)}
            className="flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-primary transition-all group"
          >
            <RotateCcw size={16} className="group-hover:-rotate-45 transition-transform" />
            {t("reader.chapterList")}
          </button>
        ) : (
          <div />
        )}
      </div>
    </div>
  );
}
