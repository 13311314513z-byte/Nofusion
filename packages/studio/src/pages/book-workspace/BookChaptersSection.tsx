import { useState, useRef, useEffect } from "react";
import type { Theme } from "../../hooks/use-theme";
import type { TFunction, StringKey } from "../../hooks/use-i18n";
import type { SSEMessage } from "../../hooks/use-sse";
import { useApi, fetchJson, postApi } from "../../hooks/use-api";
import type { StyleFingerprint } from "@actalk/inkos-core";
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
  Save,
  Palette,
  ListChecks,
  Tag,
  ChevronDown,
  ChevronUp,
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

interface ChapterMetadataDraft {
  readonly tags: string;
  readonly povCharacter: string;
  readonly location: string;
  readonly chapterType: string;
  readonly timeOfDay: string;
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

const CHAPTER_TYPE_PRESETS = ["开场", "推进", "反转", "高潮", "过渡", "回收", "收束"] as const;

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

function buildMetadataDraft(chapter: ChapterMeta): ChapterMetadataDraft {
  return {
    tags: (chapter.tags ?? []).join(", "),
    povCharacter: chapter.povCharacter ?? "",
    location: chapter.location ?? "",
    chapterType: chapter.chapterType ?? "",
    timeOfDay: chapter.timeOfDay ?? "",
  };
}

function splitTags(value: string): string[] {
  return [...new Set(value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean))].slice(0, 12);
}


function ChapterMetadataEditor({
  draft,
  saving,
  message,
  t,
  onChange,
  onSave,
}: {
  readonly draft: ChapterMetadataDraft;
  readonly saving: boolean;
  readonly message?: string;
  readonly t: TFunction;
  readonly onChange: (patch: Partial<ChapterMetadataDraft>) => void;
  readonly onSave: () => void;
}) {
  const fieldClass = "rounded-lg border border-border/50 bg-secondary/30 px-2.5 py-2 text-xs outline-none focus:border-primary/50";
  const labelClass = "text-[10px] font-bold uppercase tracking-widest text-muted-foreground";

  return (
    <form
      className="mt-3 rounded-lg border border-border/30 bg-background/45 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[1.3fr_1fr_1fr_1fr_1fr_auto] gap-2">
        <label className="flex min-w-0 flex-col gap-1">
          <span className={labelClass}>{t("book.tags")}</span>
          <input
            type="text"
            value={draft.tags}
            onChange={(event) => onChange({ tags: event.target.value })}
            placeholder={t("book.tagsPlaceholder")}
            className={fieldClass}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className={labelClass}>{t("book.povCharacter")}</span>
          <input
            type="text"
            value={draft.povCharacter}
            onChange={(event) => onChange({ povCharacter: event.target.value })}
            placeholder={t("book.povPlaceholder")}
            className={fieldClass}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className={labelClass}>{t("book.location")}</span>
          <input
            type="text"
            value={draft.location}
            onChange={(event) => onChange({ location: event.target.value })}
            placeholder={t("book.locationPlaceholder")}
            className={fieldClass}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className={labelClass}>{t("book.chapterType")}</span>
          <input
            type="text"
            list="chapter-type-presets"
            value={draft.chapterType}
            onChange={(event) => onChange({ chapterType: event.target.value })}
            placeholder={t("book.typePlaceholder")}
            className={fieldClass}
          />
          <datalist id="chapter-type-presets">
            {CHAPTER_TYPE_PRESETS.map((preset) => (
              <option key={preset} value={preset} />
            ))}
          </datalist>
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className={labelClass}>{t("book.timeOfDay")}</span>
          <input
            type="text"
            value={draft.timeOfDay}
            onChange={(event) => onChange({ timeOfDay: event.target.value })}
            placeholder={t("book.timePlaceholder")}
            className={fieldClass}
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          className="mt-5 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-50"
          title={t("book.save")}
        >
          {saving
            ? <div className="w-3.5 h-3.5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
            : <Save size={14} />}
        </button>
      </div>
      {message && <p className="mt-2 text-[11px] font-medium text-muted-foreground">{message}</p>}
    </form>
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

interface StyleScoreEntry {
  score: number | null;
  loading: boolean;
  chapterFingerprint?: StyleFingerprint;
  profileFingerprint?: StyleFingerprint;
}

function MetricBar({
  label,
  value,
  target,
}: {
  readonly label: string;
  readonly value: number;
  readonly target?: number;
}) {
  const pct = Math.round(value * 100);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{pct}%</span>
      </div>
      <div className="relative h-2 rounded-full bg-secondary/60 overflow-hidden">
        <div
          className="absolute top-0 left-0 h-full rounded-full bg-primary/70 transition-all"
          style={{ width: `${pct}%` }}
        />
        {target !== undefined && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-amber-500 z-10"
            style={{ left: `${Math.round(target * 100)}%` }}
          />
        )}
      </div>
    </div>
  );
}

export function BookChaptersSection({ bookId, nav, t }: BookChaptersSectionProps) {
  const { data, loading, error, refetch } = useApi<BookData>(`/books/${bookId}`);
  const [chapterSearch, setChapterSearch] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [filterPov, setFilterPov] = useState("");
  const [filterLocation, setFilterLocation] = useState("");
  const [filterChapterType, setFilterChapterType] = useState("");
  const [missingTagFilter, setMissingTagFilter] = useState(false);
  const [missingPovFilter, setMissingPovFilter] = useState(false);
  const [missingLocationFilter, setMissingLocationFilter] = useState(false);
  const [missingTypeFilter, setMissingTypeFilter] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedChapters, setSelectedChapters] = useState<Set<number>>(new Set());
  const [bulkAction, setBulkAction] = useState<null | "location" | "pov" | "tags" | "type">(null);
  const [bulkValue, setBulkValue] = useState("");
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number; success: number; failed: number } | null>(null);
  const [rewritingChapters, setRewritingChapters] = useState<ReadonlyArray<number>>([]);
  const [syncingChapters, setSyncingChapters] = useState<ReadonlyArray<number>>([]);
  const [metadataDrafts, setMetadataDrafts] = useState<Record<number, ChapterMetadataDraft>>({});
  const [savingMetadata, setSavingMetadata] = useState<ReadonlyArray<number>>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [metadataMessages, setMetadataMessages] = useState<Record<number, string>>({});
  const [styleScores, setStyleScores] = useState<Record<number, StyleScoreEntry>>({});
  const [sortBy, setSortBy] = useState<"default" | "style-drift">("default");
  const [calculatingAll, setCalculatingAll] = useState(false);
  const [metricsExpanded, setMetricsExpanded] = useState(true);
  const calculateCancelledRef = useRef(false);

  useEffect(() => {
    return () => { calculateCancelledRef.current = true; };
  }, []);

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
    [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));

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
    const matchesSearch = !normalizedSearch || searchHaystack.includes(normalizedSearch);
    const matchesTag = !filterTag || (ch.tags ?? []).includes(filterTag);
    const matchesPov = !filterPov || ch.povCharacter === filterPov;
    const matchesLocation = !filterLocation || ch.location === filterLocation;
    const matchesType = !filterChapterType || ch.chapterType === filterChapterType;
    const matchesMissingTag = !missingTagFilter || (!ch.tags || ch.tags.length === 0);
    const matchesMissingPov = !missingPovFilter || !ch.povCharacter;
    const matchesMissingLocation = !missingLocationFilter || !ch.location;
    const matchesMissingType = !missingTypeFilter || !ch.chapterType;
    return matchesSearch && matchesTag && matchesPov && matchesLocation && matchesType
      && matchesMissingTag && matchesMissingPov && matchesMissingLocation && matchesMissingType;
  });

  const hasMetadataFilters = Boolean(
    chapterSearch || filterTag || filterPov || filterLocation || filterChapterType
    || missingTagFilter || missingPovFilter || missingLocationFilter || missingTypeFilter,
  );

  const handleRewrite = async (chapterNumber: number) => {
    setActionError(null);
    setRewritingChapters((prev) => [...prev, chapterNumber]);
    try {
      await postApi(`/books/${bookId}/rewrite/${chapterNumber}`, {});
      await refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Rewrite failed");
    } finally {
      setRewritingChapters((prev) => prev.filter((n) => n !== chapterNumber));
    }
  };

  const handleSync = async (chapterNumber: number) => {
    setActionError(null);
    setSyncingChapters((prev) => [...prev, chapterNumber]);
    try {
      await postApi(`/books/${bookId}/resync/${chapterNumber}`, {});
      await refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncingChapters((prev) => prev.filter((n) => n !== chapterNumber));
    }
  };

  const handleCalculateAllStyleScores = async () => {
    if (!data || data.chapters.length === 0 || calculatingAll) return;
    calculateCancelledRef.current = false;
    setCalculatingAll(true);
    setActionError(null);
    try {
      for (const ch of data.chapters) {
        if (calculateCancelledRef.current) break;
        const existing = styleScores[ch.number];
        if (existing?.score !== undefined && existing?.score !== null) continue;
        setStyleScores((prev) => ({
          ...prev,
          [ch.number]: { ...(prev[ch.number] ?? { score: null }), loading: true },
        }));
        try {
          const result = await postApi<{
            score: number | null;
            chapterFingerprint?: StyleFingerprint;
            profileFingerprint?: StyleFingerprint;
          }>(`/books/${bookId}/chapters/${ch.number}/style-score`, {});
          if (calculateCancelledRef.current) break;
          setStyleScores((prev) => ({
            ...prev,
            [ch.number]: {
              score: result.score ?? null,
              loading: false,
              chapterFingerprint: result.chapterFingerprint,
              profileFingerprint: result.profileFingerprint,
            },
          }));
        } catch (e) {
          if (calculateCancelledRef.current) break;
          setStyleScores((prev) => ({
            ...prev,
            [ch.number]: { score: null, loading: false },
          }));
        }
      }
    } finally {
      setCalculatingAll(false);
    }
  };

  const sortedChapters = [...filteredChapters].sort((a, b) => {
    if (sortBy === "style-drift") {
      const scoreA = styleScores[a.number]?.score;
      const scoreB = styleScores[b.number]?.score;
      if (scoreA === undefined || scoreA === null) return 1;
      if (scoreB === undefined || scoreB === null) return -1;
      return scoreA - scoreB;
    }
    return a.number - b.number;
  });

  const computedStyleEntries = Object.values(styleScores).filter(
    (entry): entry is StyleScoreEntry & { chapterFingerprint: StyleFingerprint; score: number } =>
      entry.score !== null && entry.score !== undefined && entry.chapterFingerprint !== undefined,
  );

  const avgMetrics =
    computedStyleEntries.length > 0
      ? {
          dialogueRatio:
            computedStyleEntries.reduce((s, e) => s + e.chapterFingerprint.dialogueRatio, 0) /
            computedStyleEntries.length,
          actionDensity:
            computedStyleEntries.reduce((s, e) => s + e.chapterFingerprint.actionDensity, 0) /
            computedStyleEntries.length,
          aiTellRisk:
            computedStyleEntries.reduce((s, e) => s + e.chapterFingerprint.aiTellRisk, 0) /
            computedStyleEntries.length,
        }
      : null;

  const profileFingerprint = computedStyleEntries.find((e) => e.profileFingerprint)?.profileFingerprint;

  const getMetadataDraft = (chapter: ChapterMeta) => metadataDrafts[chapter.number] ?? buildMetadataDraft(chapter);

  const updateMetadataDraft = (chapter: ChapterMeta, patch: Partial<ChapterMetadataDraft>) => {
    setMetadataDrafts((prev) => ({
      ...prev,
      [chapter.number]: {
        ...getMetadataDraft(chapter),
        ...patch,
      },
    }));
    setMetadataMessages((prev) => {
      if (!prev[chapter.number]) return prev;
      const next = { ...prev };
      delete next[chapter.number];
      return next;
    });
  };

  const saveChapterMetadata = async (chapter: ChapterMeta) => {
    const draft = getMetadataDraft(chapter);
    setSavingMetadata((prev) => [...prev, chapter.number]);
    setMetadataMessages((prev) => {
      const next = { ...prev };
      delete next[chapter.number];
      return next;
    });
    try {
      await fetchJson<{ ok: boolean; chapter: ChapterMeta }>(`/books/${bookId}/chapters/${chapter.number}/meta`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tags: splitTags(draft.tags),
          povCharacter: draft.povCharacter,
          location: draft.location,
          chapterType: draft.chapterType,
          timeOfDay: draft.timeOfDay,
        }),
      });
      await refetch();
      setMetadataDrafts((prev) => {
        const next = { ...prev };
        delete next[chapter.number];
        return next;
      });
      setMetadataMessages((prev) => ({ ...prev, [chapter.number]: t("book.metadataSaved") }));
    } catch (e) {
      setMetadataMessages((prev) => ({
        ...prev,
        [chapter.number]: e instanceof Error ? e.message : t("book.metadataSaveFailed"),
      }));
    } finally {
      setSavingMetadata((prev) => prev.filter((number) => number !== chapter.number));
    }
  };

  const executeBulkAction = async () => {
    if (!bulkAction || selectedChapters.size === 0 || !data) return;

    const nums = Array.from(selectedChapters).sort((a, b) => a - b);
    setBulkProgress({ current: 0, total: nums.length, success: 0, failed: 0 });

    let successCount = 0;
    let failedCount = 0;

    // Execute all PATCH requests concurrently for better performance
    const results = await Promise.allSettled(
      nums.map(async (num) => {
        const chapter = data.chapters.find((ch) => ch.number === num);
        if (!chapter) return Promise.reject(new Error(`Chapter ${num} not found`));

        const payload: Record<string, unknown> = {};
        if (bulkAction === "location") {
          payload.location = bulkValue || null;
        } else if (bulkAction === "pov") {
          payload.povCharacter = bulkValue || null;
        } else if (bulkAction === "type") {
          payload.chapterType = bulkValue || null;
        } else if (bulkAction === "tags") {
          const newTags = splitTags(bulkValue);
          payload.tags = [...new Set([...(chapter.tags ?? []), ...newTags])].slice(0, 12);
        }

        await fetchJson(`/books/${bookId}/chapters/${num}/meta`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        successCount++;
      } else {
        failedCount++;
        console.error(`Bulk update failed:`, result.reason);
      }
    }

    setBulkProgress({ current: nums.length, total: nums.length, success: successCount, failed: failedCount });
    await refetch();
    setSelectedChapters(new Set());

    setTimeout(() => {
      setBulkProgress(null);
      setBulkAction(null);
      setBulkValue("");
    }, 2500);
  };

  return (
    <div className={`h-full overflow-y-auto p-6 space-y-6 ${batchMode ? "pb-24" : ""}`}>
      {actionError && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-center justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-xs font-bold hover:underline">Dismiss</button>
        </div>
      )}
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
          <div className="flex items-center gap-2">
            <button
              onClick={handleCalculateAllStyleScores}
              disabled={calculatingAll}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-violet-500/10 text-violet-600 hover:bg-violet-500 hover:text-white transition-colors disabled:opacity-50"
            >
              {calculatingAll ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-violet-600/20 border-t-violet-600 rounded-full animate-spin" />
                  <button
                    onClick={(e) => { e.stopPropagation(); calculateCancelledRef.current = true; }}
                    className="ml-1 text-[10px] underline hover:no-underline"
                  >
                    {t("common.cancel")}
                  </button>
                </>
              ) : (
                <Palette size={14} />
              )}
              {calculatingAll ? t("book.calculatingStyleScores") : t("book.calculateAllStyleScores")}
            </button>
            <button
              onClick={() => {
                setBatchMode((prev) => !prev);
                setSelectedChapters(new Set());
                setBulkAction(null);
                setBulkValue("");
                setBulkProgress(null);
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                batchMode
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              <ListChecks size={14} />
              {batchMode ? t("book.exitBatchMode") : t("book.enterBatchMode")}
            </button>
            {hasMetadataFilters && (
              <button
                onClick={() => {
                  setChapterSearch("");
                  setFilterTag("");
                  setFilterPov("");
                  setFilterLocation("");
                  setFilterChapterType("");
                  setMissingTagFilter(false);
                  setMissingPovFilter(false);
                  setMissingLocationFilter(false);
                  setMissingTypeFilter(false);
                }}
                className="text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
              >
                {t("book.clearFilters")}
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
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
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "default" | "style-drift")}
            className="px-3 py-2 text-sm rounded-lg border border-border/50 bg-secondary/30 outline-none focus:border-primary/50"
          >
            <option value="default">{t("book.sortDefault")}</option>
            <option value="style-drift">{t("book.sortStyleDrift")}</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={missingTagFilter}
              onChange={(e) => setMissingTagFilter(e.target.checked)}
              className="rounded border-border/50"
            />
            {t("book.missingTag")}
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={missingPovFilter}
              onChange={(e) => setMissingPovFilter(e.target.checked)}
              className="rounded border-border/50"
            />
            {t("book.missingPov")}
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={missingLocationFilter}
              onChange={(e) => setMissingLocationFilter(e.target.checked)}
              className="rounded border-border/50"
            />
            {t("book.missingLocation")}
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={missingTypeFilter}
              onChange={(e) => setMissingTypeFilter(e.target.checked)}
              className="rounded border-border/50"
            />
            {t("book.missingType")}
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("book.filteredChapters")}: {filteredChapters.length}/{chapters.length}
        </p>
      </div>

      {/* Style Metrics Panel */}
      {avgMetrics && (
        <div className="rounded-xl border border-border/40 bg-background/60 overflow-hidden">
          <button
            onClick={() => setMetricsExpanded((p) => !p)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/20 transition-colors"
          >
            <span className="flex items-center gap-2">
              <Palette size={14} className="text-muted-foreground" />
              {t("book.styleMetrics")}
              <span className="text-[10px] text-muted-foreground font-normal">
                ({computedStyleEntries.length}/{chapters.length})
              </span>
            </span>
            {metricsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {metricsExpanded && (
            <div className="px-4 pb-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <MetricBar
                  label={t("book.metricDialogueRatio")}
                  value={avgMetrics.dialogueRatio}
                  target={profileFingerprint?.dialogueRatio}
                />
                <MetricBar
                  label={t("book.metricActionDensity")}
                  value={avgMetrics.actionDensity}
                  target={profileFingerprint?.actionDensity}
                />
                <MetricBar
                  label={t("book.metricAiTellRisk")}
                  value={avgMetrics.aiTellRisk}
                  target={profileFingerprint?.aiTellRisk}
                />
              </div>
              {profileFingerprint && (
                <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
                  {t("book.targetStyleLine")}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Chapters Table */}
      <div className="paper-sheet rounded-2xl overflow-hidden border border-border/40 shadow-xl shadow-primary/5">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/30 border-b border-border/50">
                {batchMode && (
                  <th className="text-left px-6 py-4 font-bold text-[11px] uppercase tracking-widest text-muted-foreground w-10">
                    <input
                      type="checkbox"
                      checked={filteredChapters.length > 0 && filteredChapters.every((ch) => selectedChapters.has(ch.number))}
                      onChange={(e) => {
                        const next = new Set(selectedChapters);
                        if (e.target.checked) {
                          filteredChapters.forEach((ch) => next.add(ch.number));
                        } else {
                          filteredChapters.forEach((ch) => next.delete(ch.number));
                        }
                        setSelectedChapters(next);
                      }}
                      className="rounded border-border/50"
                    />
                  </th>
                )}
                <th className="text-left px-6 py-4 font-bold text-[11px] uppercase tracking-widest text-muted-foreground w-16">#</th>
                <th className="text-left px-6 py-4 font-bold text-[11px] uppercase tracking-widest text-muted-foreground">{t("book.manuscriptTitle")}</th>
                <th className="text-left px-6 py-4 font-bold text-[11px] uppercase tracking-widest text-muted-foreground min-w-[640px]">{t("book.metadata")}</th>
                <th className="text-left px-6 py-4 font-bold text-[11px] uppercase tracking-widest text-muted-foreground w-28">{t("book.words")}</th>
                <th className="text-left px-6 py-4 font-bold text-[11px] uppercase tracking-widest text-muted-foreground w-36">{t("book.status")}</th>
                <th className="text-right px-6 py-4 font-bold text-[11px] uppercase tracking-widest text-muted-foreground">{t("book.curate")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {sortedChapters.map((ch, index) => {
                const staggerClass = `stagger-${Math.min(index + 1, 5)}`;
                const scoreVal = styleScores[ch.number]?.score;
                const isLowScore = scoreVal !== undefined && scoreVal !== null && scoreVal < 50;
                return (
                  <tr key={ch.number} className={`group hover:bg-primary/[0.02] transition-colors fade-in ${staggerClass} ${isLowScore ? "bg-red-500/[0.04]" : ""}`}>
                    {batchMode && (
                      <td className="px-6 py-4">
                        <input
                          type="checkbox"
                          checked={selectedChapters.has(ch.number)}
                          onChange={(e) => {
                            const next = new Set(selectedChapters);
                            if (e.target.checked) next.add(ch.number);
                            else next.delete(ch.number);
                            setSelectedChapters(next);
                          }}
                          className="rounded border-border/50"
                        />
                      </td>
                    )}
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
                      <ChapterMetadataEditor
                        draft={getMetadataDraft(ch)}
                        saving={savingMetadata.includes(ch.number)}
                        message={metadataMessages[ch.number]}
                        t={t}
                        onChange={(patch) => updateMetadataDraft(ch, patch)}
                        onSave={() => void saveChapterMetadata(ch)}
                      />
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
                                setActionError(null);
                                try { await postApi(`/books/${bookId}/chapters/${ch.number}/approve`); refetch(); }
                                catch (e) { setActionError(e instanceof Error ? e.message : "Approve failed"); }
                              }}
                              className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500 hover:text-white transition-all shadow-sm"
                              title={t("book.approve")}
                            >
                              <Check size={14} />
                            </button>
                            <button
                              onClick={async () => {
                                setActionError(null);
                                try { await postApi(`/books/${bookId}/chapters/${ch.number}/reject`); refetch(); }
                                catch (e) { setActionError(e instanceof Error ? e.message : "Reject failed"); }
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
                            setActionError(null);
                            setStyleScores((prev) => ({ ...prev, [ch.number]: { score: null, loading: true } }));
                            try {
                              const result = await postApi<{
                                score: number | null;
                                chapterFingerprint?: StyleFingerprint;
                                profileFingerprint?: StyleFingerprint;
                              }>(`/books/${bookId}/chapters/${ch.number}/style-score`, {});
                              setStyleScores((prev) => ({
                                ...prev,
                                [ch.number]: {
                                  score: result.score ?? null,
                                  loading: false,
                                  chapterFingerprint: result.chapterFingerprint,
                                  profileFingerprint: result.profileFingerprint,
                                },
                              }));
                            } catch (e) {
                              setStyleScores((prev) => ({ ...prev, [ch.number]: { score: null, loading: false } }));
                              setActionError(e instanceof Error ? e.message : "Style score failed");
                            }
                          }}
                          disabled={styleScores[ch.number]?.loading}
                          className="p-2 rounded-lg bg-secondary text-muted-foreground hover:text-violet-600 hover:bg-violet-500/10 transition-all shadow-sm disabled:opacity-50"
                          title={t("chapter.styleScore")}
                        >
                          {styleScores[ch.number]?.loading ? (
                            <div className="w-3.5 h-3.5 border-2 border-muted-foreground/20 border-t-muted-foreground rounded-full animate-spin" />
                          ) : (
                            <Palette size={14} />
                          )}
                        </button>
                        {styleScores[ch.number]?.score !== undefined && styleScores[ch.number]?.score !== null && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            (styleScores[ch.number]?.score ?? 0) >= 80
                              ? "bg-emerald-100 text-emerald-700"
                              : (styleScores[ch.number]?.score ?? 0) >= 50
                                ? "bg-amber-100 text-amber-700"
                                : "bg-red-100 text-red-700"
                          }`}>
                            {styleScores[ch.number]?.score}
                          </span>
                        )}
                        <button
                          onClick={async () => {
                            setActionError(null);
                            try {
                              const result = await postApi<{ passed?: boolean; issues?: unknown[] }>(`/books/${bookId}/audit/${ch.number}`, {});
                              if (!result.passed) {
                                setActionError(`Audit failed: ${result.issues?.length ?? 0} issues`);
                              }
                              refetch();
                            } catch (e) {
                              setActionError(e instanceof Error ? e.message : "Audit failed");
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

      {/* Batch toolbar */}
      {batchMode && (
        <div className="fixed bottom-0 left-0 right-0 border-t border-border/40 bg-background/95 backdrop-blur-sm px-6 py-3 flex items-center justify-between z-50 shadow-lg">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium">
              {t("book.batchSelected").replace("{count}", String(selectedChapters.size))}
            </span>
            {bulkProgress && (
              <span className="text-xs text-muted-foreground">
                {t("book.batchProgress")}: {bulkProgress.current}/{bulkProgress.total} ({t("book.batchSuccess")} {bulkProgress.success}, {t("book.batchFailed")} {bulkProgress.failed})
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {bulkAction ? (
              <div className="flex items-center gap-2">
                {bulkAction === "type" ? (
                  <>
                    <input
                      type="text"
                      list="bulk-type-presets"
                      value={bulkValue}
                      onChange={(e) => setBulkValue(e.target.value)}
                      placeholder={t("book.batchTypePlaceholder")}
                      className="px-3 py-2 text-sm rounded-lg border border-border/50 bg-secondary/30 outline-none focus:border-primary/50"
                    />
                    <datalist id="bulk-type-presets">
                      {CHAPTER_TYPE_PRESETS.map((preset) => (
                        <option key={preset} value={preset} />
                      ))}
                      {chapterTypeOptions.map((option) => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                  </>
                ) : bulkAction === "tags" ? (
                  <input
                    type="text"
                    value={bulkValue}
                    onChange={(e) => setBulkValue(e.target.value)}
                    placeholder={t("book.batchTagsPlaceholder")}
                    className="px-3 py-2 text-sm rounded-lg border border-border/50 bg-secondary/30 outline-none focus:border-primary/50"
                  />
                ) : (
                  <input
                    type="text"
                    value={bulkValue}
                    onChange={(e) => setBulkValue(e.target.value)}
                    placeholder={
                      bulkAction === "location"
                        ? t("book.batchLocationPlaceholder")
                        : t("book.batchPovPlaceholder")
                    }
                    className="px-3 py-2 text-sm rounded-lg border border-border/50 bg-secondary/30 outline-none focus:border-primary/50"
                  />
                )}
                <button
                  onClick={executeBulkAction}
                  disabled={bulkProgress !== null}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {bulkProgress ? (
                    <div className="w-3.5 h-3.5 border-2 border-primary-foreground/20 border-t-primary-foreground rounded-full animate-spin" />
                  ) : (
                    t("book.batchConfirm")
                  )}
                </button>
                <button
                  onClick={() => {
                    setBulkAction(null);
                    setBulkValue("");
                    setBulkProgress(null);
                  }}
                  disabled={bulkProgress !== null}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {t("book.batchCancel")}
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={() => setBulkAction("location")}
                  disabled={selectedChapters.size === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-50"
                >
                  <MapPin size={12} />
                  {t("book.batchSetLocation")}
                </button>
                <button
                  onClick={() => setBulkAction("pov")}
                  disabled={selectedChapters.size === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-50"
                >
                  <UserRound size={12} />
                  {t("book.batchSetPov")}
                </button>
                <button
                  onClick={() => setBulkAction("tags")}
                  disabled={selectedChapters.size === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-50"
                >
                  <Tag size={12} />
                  {t("book.batchAddTags")}
                </button>
                <button
                  onClick={() => setBulkAction("type")}
                  disabled={selectedChapters.size === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-50"
                >
                  <Layers size={12} />
                  {t("book.batchSetType")}
                </button>
                <button
                  onClick={() => {
                    if (selectedChapters.size > 0) {
                      setSelectedChapters(new Set());
                    } else {
                      setBatchMode(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                >
                  {selectedChapters.size > 0 ? t("book.clearSelection") : t("book.exitBatchMode")}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
