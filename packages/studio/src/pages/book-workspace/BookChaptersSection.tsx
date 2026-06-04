import { useState, useMemo } from "react";
import type { Theme } from "../../hooks/use-theme";
import type { TFunction } from "../../hooks/use-i18n";
import type { SSEMessage } from "../../hooks/use-sse";
import { useApi, postApi } from "../../hooks/use-api";
import { useColors } from "../../hooks/use-colors";
import {
  FileText,
  Search,
  Check,
  X,
  ShieldCheck,
  RotateCcw,
  RefreshCw,
  Eye,
  Download,
  CheckCheck,
  Clock,
  Layers,
  UserRound,
  MapPin,
} from "lucide-react";

interface ChapterMeta {
  readonly number: number;
  readonly title: string;
  readonly status: string;
  readonly wordCount: number;
  readonly wordCountTarget?: number;
  readonly tags?: ReadonlyArray<string>;
  readonly povCharacter?: string;
  readonly location?: string;
  readonly moodScore?: number;
  readonly revisionCount?: number;
  readonly timeOfDay?: string;
  readonly chapterType?: string;
}

interface BookData {
  readonly book: {
    readonly id: string;
    readonly title: string;
    readonly genre: string;
    readonly status: string;
    readonly chapterWordCount: number;
    readonly targetChapters?: number;
    readonly language?: string;
  };
  readonly chapters: ReadonlyArray<ChapterMeta>;
  readonly nextChapter: number;
}

interface BookChaptersSectionProps {
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

const STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode }> = {
  "ready-for-review": { color: "text-amber-500 bg-amber-500/10", icon: <Eye size={12} /> },
  approved: { color: "text-emerald-500 bg-emerald-500/10", icon: <Check size={12} /> },
  drafted: { color: "text-muted-foreground bg-muted/20", icon: <FileText size={12} /> },
  "needs-revision": { color: "text-destructive bg-destructive/10", icon: <RotateCcw size={12} /> },
  imported: { color: "text-blue-500 bg-blue-500/10", icon: <Download size={12} /> },
};

function translateChapterStatus(status: string, t: TFunction): string {
  const map: Record<string, () => string> = {
    "ready-for-review": () => t("chapter.readyForReview"),
    approved: () => t("chapter.approved"),
    drafted: () => t("chapter.drafted"),
    "needs-revision": () => t("chapter.needsRevision"),
    imported: () => t("chapter.imported"),
    "audit-failed": () => t("chapter.auditFailed"),
  };
  return map[status]?.() ?? status;
}

function MetadataBadge({ icon, text }: { readonly icon?: React.ReactNode; readonly text: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-secondary/40 text-muted-foreground text-[10px]">
      {icon}
      {text}
    </span>
  );
}

function ChapterMetadataBadges({ chapter, t }: { readonly chapter: ChapterMeta; readonly t: TFunction }) {
  const tags = chapter.tags ?? [];
  const hasMetadata = tags.length > 0
    || chapter.povCharacter
    || chapter.location
    || chapter.chapterType
    || chapter.timeOfDay
    || chapter.moodScore !== undefined
    || chapter.wordCountTarget !== undefined;

  if (!hasMetadata) {
    return <span className="text-xs text-muted-foreground/40">{t("book.noMetadata")}</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {chapter.chapterType && <MetadataBadge icon={<Layers size={11} />} text={chapter.chapterType} />}
      {chapter.povCharacter && <MetadataBadge icon={<UserRound size={11} />} text={chapter.povCharacter} />}
      {chapter.location && <MetadataBadge icon={<MapPin size={11} />} text={chapter.location} />}
      {chapter.timeOfDay && <MetadataBadge icon={<Clock size={11} />} text={chapter.timeOfDay} />}
      {chapter.moodScore !== undefined && <MetadataBadge text={`${t("book.moodShort")} ${chapter.moodScore}`} />}
      {chapter.wordCountTarget !== undefined && <MetadataBadge text={`${t("book.targetShort")} ${chapter.wordCountTarget}`} />}
      {tags.map((tag) => (
        <MetadataBadge key={tag} text={tag} />
      ))}
    </div>
  );
}

function MetadataSelect({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: ReadonlyArray<string>;
  readonly onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-2 text-sm rounded-lg border border-border/50 bg-secondary/30 outline-none focus:border-primary/50"
    >
      <option value="">{label}</option>
      {options.map((option) => (
        <option key={option} value={option}>{option}</option>
      ))}
    </select>
  );
}

export function BookChaptersSection({ bookId, nav, theme, t }: BookChaptersSectionProps) {
  const c = useColors(theme);
  const { data, loading, error, refetch } = useApi<BookData>(`/books/${bookId}`);
  const [chapterSearch, setChapterSearch] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [filterPov, setFilterPov] = useState("");
  const [filterLocation, setFilterLocation] = useState("");
  const [filterChapterType, setFilterChapterType] = useState("");
  const [rewritingChapters, setRewritingChapters] = useState<ReadonlyArray<number>>([]);
  const [syncingChapters, setSyncingChapters] = useState<ReadonlyArray<number>>([]);

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
        <div className="text-destructive p-8 bg-destructive/5 rounded-xl border border-destructive/20">
          Error: {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { book, chapters } = data;
  const totalWords = chapters.reduce((sum, ch) => sum + (ch.wordCount ?? 0), 0);

  const uniqueSorted = (values: ReadonlyArray<string | undefined>) =>
    [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(a));

  const tagOptions = uniqueSorted(chapters.flatMap((ch) => [...(ch.tags ?? [])]));
  const povOptions = uniqueSorted(chapters.map((ch) => ch.povCharacter));
  const locationOptions = uniqueSorted(chapters.map((ch) => ch.location));
  const chapterTypeOptions = uniqueSorted(chapters.map((ch) => ch.chapterType));

  const normalizedSearch = chapterSearch.trim().toLowerCase();
  const filteredChapters = chapters.filter((ch) => {
    const searchHaystack = [
      ch.number,
      ch.title,
      ch.status,
      ch.povCharacter,
      ch.location,
      ch.chapterType,
      ch.timeOfDay,
      ...(ch.tags ?? []),
    ].join(" ").toLowerCase();
    return (!normalizedSearch || searchHaystack.includes(normalizedSearch))
      && (!filterTag || (ch.tags ?? []).includes(filterTag))
      && (!filterPov || ch.povCharacter === filterPov)
      && (!filterLocation || ch.location === filterLocation)
      && (!filterChapterType || ch.chapterType === filterChapterType);
  });

  const hasMetadataFilters = Boolean(
    chapterSearch || filterTag || filterPov || filterLocation || filterChapterType,
  );

  const handleRewrite = async (chapterNumber: number) => {
    setRewritingChapters((prev) => [...prev, chapterNumber]);
    try {
      await postApi(`/books/${bookId}/chapters/${chapterNumber}/rewrite`, {});
      await refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Rewrite failed");
    } finally {
      setRewritingChapters((prev) => prev.filter((n) => n !== chapterNumber));
    }
  };

  const handleSync = async (chapterNumber: number) => {
    setSyncingChapters((prev) => [...prev, chapterNumber]);
    try {
      await postApi(`/books/${bookId}/chapters/${chapterNumber}/sync`, {});
      await refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncingChapters((prev) => prev.filter((n) => n !== chapterNumber));
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-border/40 pb-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-serif font-medium">{book.title}</h1>
            {book.language === "en" && (
              <span className="px-1.5 py-0.5 rounded border border-primary/20 text-primary text-[10px] font-bold">EN</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground font-medium">
            <span className="px-2 py-0.5 rounded bg-secondary/50 text-foreground/70 uppercase tracking-wider text-xs">{book.genre}</span>
            <div className="flex items-center gap-1.5">
              <FileText size={14} />
              <span>{chapters.length} {t("dash.chapters")}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCheck size={14} />
              <span>{totalWords.toLocaleString()} {t("book.words")}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Search size={14} className="text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">{t("dash.chapters")}</h3>
          </div>
          {hasMetadataFilters && (
            <button
              onClick={() => {
                setChapterSearch("");
                setFilterTag("");
                setFilterPov("");
                setFilterLocation("");
                setFilterChapterType("");
              }}
              className="text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("book.clearFilters")}
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input
            value={chapterSearch}
            onChange={(e) => setChapterSearch(e.target.value)}
            placeholder={t("book.searchMetadata")}
            className="px-3 py-2 text-sm rounded-lg border border-border/50 bg-secondary/30 outline-none focus:border-primary/50"
          />
          <MetadataSelect label={t("book.filterTag")} value={filterTag} options={tagOptions} onChange={setFilterTag} />
          <MetadataSelect label={t("book.filterPov")} value={filterPov} options={povOptions} onChange={setFilterPov} />
          <MetadataSelect label={t("book.filterLocation")} value={filterLocation} options={locationOptions} onChange={setFilterLocation} />
          <MetadataSelect label={t("book.filterType")} value={filterChapterType} options={chapterTypeOptions} onChange={setFilterChapterType} />
        </div>
        <p className="text-xs text-muted-foreground">
          {t("book.filteredChapters")}: {filteredChapters.length}/{chapters.length}
        </p>
      </div>

      {/* Chapters Table */}
      <div className="paper-sheet rounded-2xl overflow-hidden border border-border/40 shadow-xl shadow-primary/5">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/30 border-b border-border/50">
                <th className="text-left px-6 py-4 font-bold text-[11px] uppercase tracking-widest text-muted-foreground w-16">#</th>
                <th className="text-left px-6 py-4 font-bold text-[11px] uppercase tracking-widest text-muted-foreground">{t("book.manuscriptTitle")}</th>
                <th className="text-left px-6 py-4 font-bold text-[11px] uppercase tracking-widest text-muted-foreground min-w-64">{t("book.metadata")}</th>
                <th className="text-left px-6 py-4 font-bold text-[11px] uppercase tracking-widest text-muted-foreground w-28">{t("book.words")}</th>
                <th className="text-left px-6 py-4 font-bold text-[11px] uppercase tracking-widest text-muted-foreground w-36">{t("book.status")}</th>
                <th className="text-right px-6 py-4 font-bold text-[11px] uppercase tracking-widest text-muted-foreground">{t("book.curate")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {filteredChapters.map((ch, index) => {
                const staggerClass = `stagger-${Math.min(index + 1, 5)}`;
                return (
                  <tr key={ch.number} className={`group hover:bg-primary/[0.02] transition-colors fade-in ${staggerClass}`}>
                    <td className="px-6 py-4 text-muted-foreground/60 font-mono text-xs">{ch.number.toString().padStart(2, "0")}</td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => nav.toChapter(bookId, ch.number)}
                        className="font-serif text-lg font-medium hover:text-primary transition-colors text-left"
                      >
                        {ch.title || t("chapter.label").replace("{n}", String(ch.number))}
                      </button>
                    </td>
                    <td className="px-6 py-4">
                      <ChapterMetadataBadges chapter={ch} t={t} />
                    </td>
                    <td className="px-6 py-4 text-muted-foreground font-medium tabular-nums text-xs">{(ch.wordCount ?? 0).toLocaleString()}</td>
                    <td className="px-6 py-4">
                      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-tight ${STATUS_CONFIG[ch.status]?.color ?? "bg-muted text-muted-foreground"}`}>
                        {STATUS_CONFIG[ch.status]?.icon}
                        {translateChapterStatus(ch.status, t)}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex gap-1.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        {ch.status === "ready-for-review" && (
                          <>
                            <button
                              onClick={async () => {
                                try { await postApi(`/books/${bookId}/chapters/${ch.number}/approve`); refetch(); }
                                catch (e) { alert(e instanceof Error ? e.message : "Approve failed"); }
                              }}
                              className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500 hover:text-white transition-all shadow-sm"
                              title={t("book.approve")}
                            >
                              <Check size={14} />
                            </button>
                            <button
                              onClick={async () => {
                                try { await postApi(`/books/${bookId}/chapters/${ch.number}/reject`); refetch(); }
                                catch (e) { alert(e instanceof Error ? e.message : "Reject failed"); }
                              }}
                              className="p-2 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive hover:text-white transition-all shadow-sm"
                              title={t("book.reject")}
                            >
                              <X size={14} />
                            </button>
                          </>
                        )}
                        <button
                          onClick={async () => {
                            try {
                              const result = await postApi<{ passed?: boolean; issues?: unknown[] }>(`/books/${bookId}/audit/${ch.number}`, {});
                              alert(result.passed ? "Audit passed" : `Audit failed: ${result.issues?.length ?? 0} issues`);
                              refetch();
                            } catch (e) {
                              alert(e instanceof Error ? e.message : "Audit failed");
                            }
                          }}
                          className="p-2 rounded-lg bg-secondary text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all shadow-sm"
                          title={t("book.audit")}
                        >
                          <ShieldCheck size={14} />
                        </button>
                        <button
                          onClick={() => handleRewrite(ch.number)}
                          disabled={rewritingChapters.includes(ch.number)}
                          className="p-2 rounded-lg bg-secondary text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all shadow-sm disabled:opacity-50"
                          title={t("book.rewrite")}
                        >
                          {rewritingChapters.includes(ch.number)
                            ? <div className="w-3.5 h-3.5 border-2 border-muted-foreground/20 border-t-muted-foreground rounded-full animate-spin" />
                            : <RotateCcw size={14} />}
                        </button>
                        <button
                          onClick={() => handleSync(ch.number)}
                          disabled={syncingChapters.includes(ch.number)}
                          className="p-2 rounded-lg bg-secondary text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all shadow-sm disabled:opacity-50"
                          title="Sync truth/state"
                        >
                          {syncingChapters.includes(ch.number)
                            ? <div className="w-3.5 h-3.5 border-2 border-muted-foreground/20 border-t-muted-foreground rounded-full animate-spin" />
                            : <RefreshCw size={14} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {chapters.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-12 h-12 rounded-full bg-muted/20 flex items-center justify-center mb-4">
              <FileText size={20} className="text-muted-foreground/40" />
            </div>
            <p className="text-sm italic font-serif text-muted-foreground">
              {t("book.noChapters")}
            </p>
          </div>
        )}
        {chapters.length > 0 && filteredChapters.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Search size={20} className="text-muted-foreground/40 mb-3" />
            <p className="text-sm italic font-serif text-muted-foreground">
              {t("book.noMetadataMatches")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
