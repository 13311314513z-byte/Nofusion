import { fetchJson, useApi, postApi } from "../hooks/use-api";
import { useEffect, useMemo, useState } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import type { SSEMessage } from "../hooks/use-sse";
import { useColors } from "../hooks/use-colors";
import { deriveBookActivity, shouldRefetchBookView } from "../hooks/use-book-activity";
import { ConfirmDialog } from "../components/ConfirmDialog";
import {
  ChevronLeft,
  Zap,
  FileText,
  CheckCheck,
  BarChart2,
  Download,
  Search,
  Wand2,
  Eye,
  Database,
  Check,
  X,
  ShieldCheck,
  RotateCcw,
  RefreshCw,
  Sparkles,
  Trash2,
  Save,
  Tags,
  UserRound,
  MapPin,
  Layers,
  Clock,
  SlidersHorizontal,
  Plus,
  BookOpen,
  Users,
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
    readonly fanficMode?: string;
    readonly volumeCount?: number;
    readonly currentVolume?: number;
    readonly keywords?: ReadonlyArray<string>;
    readonly targetAudience?: string;
    readonly serializationStatus?: "draft" | "serializing" | "completed" | "hiatus";
  };
  readonly chapters: ReadonlyArray<ChapterMeta>;
  readonly nextChapter: number;
}

type RoleTier = "major" | "minor";

interface RoleCardListItem {
  readonly id: string;
  readonly name: string;
  readonly roleTier: RoleTier;
  readonly status?: string;
  readonly tags?: ReadonlyArray<string>;
}

interface RoleCard {
  readonly id: string;
  readonly frontmatter: {
    readonly id: string;
    readonly name: string;
    readonly roleTier: RoleTier;
    readonly aliases?: ReadonlyArray<string>;
    readonly status?: "active" | "hidden" | "dead" | "departed";
    readonly tags?: ReadonlyArray<string>;
  };
  readonly body: string;
}

interface RolesData {
  readonly roles: ReadonlyArray<RoleCardListItem>;
}

type ReviseMode = "spot-fix" | "polish" | "rewrite" | "rework" | "anti-detect";
type ExportFormat = "txt" | "md" | "epub";
type BookStatus = "incubating" | "active" | "paused" | "outlining" | "completed" | "dropped";

interface Nav {
  toDashboard: () => void;
  toChapter: (bookId: string, num: number) => void;
  toAnalytics: (bookId: string) => void;
  toTruth: (bookId: string) => void;
}

function translateChapterStatus(status: string, t: TFunction): string {
  const map: Record<string, () => string> = {
    "ready-for-review": () => t("chapter.readyForReview"),
    "approved": () => t("chapter.approved"),
    "drafted": () => t("chapter.drafted"),
    "needs-revision": () => t("chapter.needsRevision"),
    "imported": () => t("chapter.imported"),
    "audit-failed": () => t("chapter.auditFailed"),
  };
  return map[status]?.() ?? status;
}

const STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode }> = {
  "ready-for-review": { color: "text-amber-500 bg-amber-500/10", icon: <Eye size={12} /> },
  approved: { color: "text-emerald-500 bg-emerald-500/10", icon: <Check size={12} /> },
  drafted: { color: "text-muted-foreground bg-muted/20", icon: <FileText size={12} /> },
  "needs-revision": { color: "text-destructive bg-destructive/10", icon: <RotateCcw size={12} /> },
  imported: { color: "text-blue-500 bg-blue-500/10", icon: <Download size={12} /> },
};

function splitRoleList(value: string): string[] {
  return value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
}

function buildRoleId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff_-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

export function BookDetail({
  bookId,
  nav,
  theme,
  t,
  sse,
}: {
  bookId: string;
  nav: Nav;
  theme: Theme;
  t: TFunction;
  sse: { messages: ReadonlyArray<SSEMessage> };
}) {
  const c = useColors(theme);
  const { data, loading, error, refetch } = useApi<BookData>(`/books/${bookId}`);
  const { data: rolesData, loading: rolesLoading, error: rolesError, refetch: refetchRoles } = useApi<RolesData>(`/books/${bookId}/roles`);
  const [writeRequestPending, setWriteRequestPending] = useState(false);
  const [draftRequestPending, setDraftRequestPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [rewritingChapters, setRewritingChapters] = useState<ReadonlyArray<number>>([]);
  const [revisingChapters, setRevisingChapters] = useState<ReadonlyArray<number>>([]);
  const [syncingChapters, setSyncingChapters] = useState<ReadonlyArray<number>>([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [pendingChapterActions, setPendingChapterActions] = useState<ReadonlyArray<number>>([]);
  const [settingsWordCount, setSettingsWordCount] = useState<number | null>(null);
  const [settingsTargetChapters, setSettingsTargetChapters] = useState<number | null>(null);
  const [settingsStatus, setSettingsStatus] = useState<BookStatus | null>(null);
  const [settingsVolumeCount, setSettingsVolumeCount] = useState<number | null>(null);
  const [settingsCurrentVolume, setSettingsCurrentVolume] = useState<number | null>(null);
  const [settingsKeywords, setSettingsKeywords] = useState<string | null>(null);
  const [settingsTargetAudience, setSettingsTargetAudience] = useState<string | null>(null);
  const [settingsSerializationStatus, setSettingsSerializationStatus] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("txt");
  const [exportApprovedOnly, setExportApprovedOnly] = useState(false);
  const [chapterSearch, setChapterSearch] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [filterPov, setFilterPov] = useState("");
  const [filterLocation, setFilterLocation] = useState("");
  const [filterChapterType, setFilterChapterType] = useState("");
  const [metadataEditorChapter, setMetadataEditorChapter] = useState<ChapterMeta | null>(null);
  const [metadataTags, setMetadataTags] = useState("");
  const [metadataPov, setMetadataPov] = useState("");
  const [metadataLocation, setMetadataLocation] = useState("");
  const [metadataChapterType, setMetadataChapterType] = useState("");
  const [metadataTimeOfDay, setMetadataTimeOfDay] = useState("");
  const [metadataMoodScore, setMetadataMoodScore] = useState("");
  const [metadataWordCountTarget, setMetadataWordCountTarget] = useState("");
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [roleCard, setRoleCard] = useState<RoleCard | null>(null);
  const [roleLoading, setRoleLoading] = useState(false);
  const [roleName, setRoleName] = useState("");
  const [roleTier, setRoleTier] = useState<RoleTier>("major");
  const [roleStatus, setRoleStatus] = useState<"active" | "hidden" | "dead" | "departed" | "">("active");
  const [roleTags, setRoleTags] = useState("");
  const [roleAliases, setRoleAliases] = useState("");
  const [roleBody, setRoleBody] = useState("");
  const [savingRole, setSavingRole] = useState(false);
  const [creatingRole, setCreatingRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleId, setNewRoleId] = useState("");
  const [newRoleTier, setNewRoleTier] = useState<RoleTier>("major");
  const activity = useMemo(() => deriveBookActivity(sse.messages, bookId), [bookId, sse.messages]);
  const writing = writeRequestPending || activity.writing;
  const drafting = draftRequestPending || activity.drafting;
  const latestPersistedChapter = data ? data.nextChapter - 1 : 0;

  useEffect(() => {
    const recent = sse.messages.at(-1);
    if (!recent) return;

    const data = recent.data as { bookId?: string } | null;
    if (data?.bookId !== bookId) return;

    if (recent.event === "write:start") {
      setWriteRequestPending(false);
      return;
    }

    if (recent.event === "draft:start") {
      setDraftRequestPending(false);
      return;
    }

    if (shouldRefetchBookView(recent, bookId)) {
      setWriteRequestPending(false);
      setDraftRequestPending(false);
      refetch();
    }
  }, [bookId, refetch, sse.messages]);

  useEffect(() => {
    const roles = rolesData?.roles ?? [];
    if (roles.length === 0) {
      if (selectedRoleId) setSelectedRoleId("");
      setRoleCard(null);
      return;
    }
    if (!selectedRoleId || !roles.some((role) => role.id === selectedRoleId)) {
      setSelectedRoleId(roles[0]!.id);
    }
  }, [rolesData, selectedRoleId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedRoleId) {
      setRoleCard(null);
      setRoleName("");
      setRoleTags("");
      setRoleAliases("");
      setRoleBody("");
      return;
    }

    setRoleLoading(true);
    fetchJson<{ card: RoleCard }>(`/books/${bookId}/roles/${encodeURIComponent(selectedRoleId)}`)
      .then(({ card }) => {
        if (cancelled) return;
        setRoleCard(card);
        setRoleName(card.frontmatter.name);
        setRoleTier(card.frontmatter.roleTier);
        setRoleStatus(card.frontmatter.status ?? "");
        setRoleTags((card.frontmatter.tags ?? []).join(", "));
        setRoleAliases((card.frontmatter.aliases ?? []).join(", "));
        setRoleBody(card.body);
      })
      .catch((e) => {
        if (!cancelled) alert(e instanceof Error ? e.message : "Load role failed");
      })
      .finally(() => {
        if (!cancelled) setRoleLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bookId, selectedRoleId]);

  const handleWriteNext = async () => {
    setWriteRequestPending(true);
    try {
      await postApi(`/books/${bookId}/write-next`);
    } catch (e) {
      setWriteRequestPending(false);
      alert(e instanceof Error ? e.message : "Failed");
    }
  };

  const handleDraft = async () => {
    setDraftRequestPending(true);
    try {
      await postApi(`/books/${bookId}/draft`);
    } catch (e) {
      setDraftRequestPending(false);
      alert(e instanceof Error ? e.message : "Failed");
    }
  };

  const handleDeleteBook = async () => {
    setConfirmDeleteOpen(false);
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/books/${bookId}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? `${res.status}`);
      }
      nav.toDashboard();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const handleRewrite = async (chapterNum: number) => {
    const brief = window.prompt(
      data?.book.language === "en"
        ? "Optional rewrite brief for this run only. Leave blank to use existing focus."
        : "可选：输入这次重写要遵循的补充想法。留空则沿用现有 focus。",
      "",
    );
    if (brief === null) return;
    setRewritingChapters((prev) => [...prev, chapterNum]);
    try {
      await fetchJson(`/books/${bookId}/rewrite/${chapterNum}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: brief.trim() || undefined }),
      });
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Rewrite failed");
    } finally {
      setRewritingChapters((prev) => prev.filter((n) => n !== chapterNum));
    }
  };

  const handleRevise = async (chapterNum: number, mode: ReviseMode) => {
    const brief = window.prompt(
      data?.book.language === "en"
        ? "Optional revise brief for this run only. Leave blank to use existing focus."
        : "可选：输入这次修订要遵循的补充想法。留空则沿用现有 focus。",
      "",
    );
    if (brief === null) return;
    setRevisingChapters((prev) => [...prev, chapterNum]);
    try {
      await fetchJson(`/books/${bookId}/revise/${chapterNum}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, brief: brief.trim() || undefined }),
      });
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Revision failed");
    } finally {
      setRevisingChapters((prev) => prev.filter((n) => n !== chapterNum));
    }
  };

  const handleSync = async (chapterNum: number) => {
    const brief = window.prompt(
      data?.book.language === "en"
        ? "Optional sync brief for interpreting the edited chapter body. Leave blank to sync directly from the text."
        : "可选：输入这次同步时要遵循的补充说明。留空则直接按正文同步。",
      "",
    );
    if (brief === null) return;
    setSyncingChapters((prev) => [...prev, chapterNum]);
    try {
      await fetchJson(`/books/${bookId}/resync/${chapterNum}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: brief.trim() || undefined }),
      });
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncingChapters((prev) => prev.filter((n) => n !== chapterNum));
    }
  };

  const handleSaveSettings = async () => {
    if (!data) return;
    setSavingSettings(true);
    try {
      const body: Record<string, unknown> = {};
      if (settingsWordCount !== null) body.chapterWordCount = settingsWordCount;
      if (settingsTargetChapters !== null) body.targetChapters = settingsTargetChapters;
      if (settingsStatus !== null) body.status = settingsStatus;
      if (settingsVolumeCount !== null) body.volumeCount = settingsVolumeCount;
      if (settingsCurrentVolume !== null) body.currentVolume = settingsCurrentVolume;
      if (settingsKeywords !== null) body.keywords = settingsKeywords.split(/[,，、\n]/).map((s) => s.trim()).filter(Boolean);
      if (settingsTargetAudience !== null) body.targetAudience = settingsTargetAudience;
      if (settingsSerializationStatus !== null) body.serializationStatus = settingsSerializationStatus;
      await fetchJson(`/books/${bookId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleApproveAll = async () => {
    if (!data) return;
    const reviewable = data.chapters.filter((ch) => ch.status === "ready-for-review");
    let failed = 0;
    for (const chapter of reviewable) {
      try {
        await postApi(`/books/${bookId}/chapters/${chapter.number}/approve`);
      } catch {
        failed += 1;
      }
    }
    if (failed > 0) {
      alert(`${failed}/${reviewable.length} approve(s) failed`);
    }
    refetch();
  };

  const openMetadataEditor = (chapter: ChapterMeta) => {
    setMetadataEditorChapter(chapter);
    setMetadataTags((chapter.tags ?? []).join(", "));
    setMetadataPov(chapter.povCharacter ?? "");
    setMetadataLocation(chapter.location ?? "");
    setMetadataChapterType(chapter.chapterType ?? "");
    setMetadataTimeOfDay(chapter.timeOfDay ?? "");
    setMetadataMoodScore(chapter.moodScore === undefined ? "" : String(chapter.moodScore));
    setMetadataWordCountTarget(chapter.wordCountTarget === undefined ? "" : String(chapter.wordCountTarget));
  };

  const handleSaveMetadata = async () => {
    if (!metadataEditorChapter) return;
    setSavingMetadata(true);
    try {
      await fetchJson(`/books/${bookId}/chapters/${metadataEditorChapter.number}/meta`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tags: metadataTags.split(/[,，\n]/).map((tag) => tag.trim()).filter(Boolean),
          povCharacter: metadataPov,
          location: metadataLocation,
          chapterType: metadataChapterType,
          timeOfDay: metadataTimeOfDay,
          moodScore: metadataMoodScore.trim() === "" ? undefined : Number(metadataMoodScore),
          wordCountTarget: metadataWordCountTarget.trim() === "" ? undefined : Number(metadataWordCountTarget),
        }),
      });
      setMetadataEditorChapter(null);
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save metadata failed");
    } finally {
      setSavingMetadata(false);
    }
  };

  const handleCreateRole = async () => {
    const name = newRoleName.trim();
    const id = buildRoleId(newRoleId || name);
    if (!name || !id) return;

    setCreatingRole(true);
    try {
      const result = await fetchJson<{ card: RoleCard }>(`/books/${bookId}/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name, roleTier: newRoleTier }),
      });
      setNewRoleName("");
      setNewRoleId("");
      setNewRoleTier("major");
      await refetchRoles();
      setSelectedRoleId(result.card.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Create role failed");
    } finally {
      setCreatingRole(false);
    }
  };

  const handleSaveRole = async () => {
    if (!roleCard) return;
    setSavingRole(true);
    try {
      const result = await fetchJson<{ card: RoleCard }>(`/books/${bookId}/roles/${encodeURIComponent(roleCard.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          frontmatter: {
            name: roleName.trim() || roleCard.frontmatter.name,
            roleTier,
            status: roleStatus || undefined,
            tags: splitRoleList(roleTags),
            aliases: splitRoleList(roleAliases),
          },
          body: roleBody,
        }),
      });
      setRoleCard(result.card);
      await refetchRoles();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save role failed");
    } finally {
      setSavingRole(false);
    }
  };

  const handleDeleteRole = async () => {
    if (!roleCard) return;
    const ok = window.confirm(`${t("book.deleteRoleConfirm")} ${roleCard.frontmatter.name}`);
    if (!ok) return;
    setSavingRole(true);
    try {
      await fetchJson(`/books/${bookId}/roles/${encodeURIComponent(roleCard.id)}`, { method: "DELETE" });
      setSelectedRoleId("");
      setRoleCard(null);
      await refetchRoles();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete role failed");
    } finally {
      setSavingRole(false);
    }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-32 space-y-4">
      <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
      <span className="text-sm text-muted-foreground">{t("common.loading")}</span>
    </div>
  );

  if (error) return <div className="text-destructive p-8 bg-destructive/5 rounded-xl border border-destructive/20">Error: {error}</div>;
  if (!data) return null;

  const { book, chapters } = data;
  const totalWords = chapters.reduce((sum, ch) => sum + (ch.wordCount ?? 0), 0);
  const reviewCount = chapters.filter((ch) => ch.status === "ready-for-review").length;
  const uniqueSorted = (values: ReadonlyArray<string | undefined>) =>
    [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))]
      .sort((a, b) => a.localeCompare(b));
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

  const currentWordCount = settingsWordCount ?? book.chapterWordCount;
  const currentTargetChapters = settingsTargetChapters ?? book.targetChapters ?? 0;
  const currentStatus = settingsStatus ?? (book.status as BookStatus);
  const currentVolumeCount = settingsVolumeCount ?? book.volumeCount ?? null;
  const currentCurrentVolume = settingsCurrentVolume ?? book.currentVolume ?? null;
  const currentKeywords = settingsKeywords ?? book.keywords?.join(", ") ?? "";
  const currentTargetAudience = settingsTargetAudience ?? book.targetAudience ?? "";
  const currentSerializationStatus = settingsSerializationStatus ?? book.serializationStatus ?? "";
  const roles = rolesData?.roles ?? [];
  const majorRoleCount = roles.filter((role) => role.roleTier === "major").length;
  const minorRoleCount = roles.filter((role) => role.roleTier === "minor").length;

  const exportHref = `/api/v1/books/${bookId}/export?format=${exportFormat}${exportApprovedOnly ? "&approvedOnly=true" : ""}`;

  return (
    <div className="space-y-8 fade-in">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
        <button
          onClick={nav.toDashboard}
          className="hover:text-primary transition-colors flex items-center gap-1"
        >
          <ChevronLeft size={14} />
          {t("bread.books")}
        </button>
        <span className="text-border">/</span>
        <span className="text-foreground">{book.title}</span>
      </nav>

      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-border/40 pb-8">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-4xl font-serif font-medium">{book.title}</h1>
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
              <Zap size={14} />
              <span>{totalWords.toLocaleString()} {t("book.words")}</span>
            </div>
            {book.fanficMode && (
              <span className="flex items-center gap-1 text-purple-500">
                <Sparkles size={12} />
                <span className="italic">fanfic:{book.fanficMode}</span>
              </span>
            )}
            {book.volumeCount !== undefined && book.currentVolume !== undefined && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <BookOpen size={12} />
                <span>{t("book.currentVolume")} {book.currentVolume}/{book.volumeCount}</span>
              </span>
            )}
            {book.serializationStatus && (
              <span className="px-2 py-0.5 rounded bg-secondary/50 text-foreground/70 uppercase tracking-wider text-xs">
                {book.serializationStatus}
              </span>
            )}
            {book.targetAudience && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Users size={12} />
                <span>{book.targetAudience}</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleWriteNext}
            disabled={writing || drafting}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold bg-primary text-primary-foreground rounded-xl hover:scale-105 active:scale-95 transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
          >
            {writing ? <div className="w-4 h-4 border-2 border-primary-foreground/20 border-t-primary-foreground rounded-full animate-spin" /> : <Zap size={16} />}
            {writing ? t("dash.writing") : t("book.writeNext")}
          </button>
          <button
            onClick={handleDraft}
            disabled={writing || drafting}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold bg-secondary text-foreground rounded-xl hover:bg-secondary/80 transition-all border border-border/50 disabled:opacity-50"
          >
            {drafting ? <div className="w-4 h-4 border-2 border-muted-foreground/20 border-t-muted-foreground rounded-full animate-spin" /> : <Wand2 size={16} />}
            {drafting ? t("book.drafting") : t("book.draftOnly")}
          </button>
          <button
            onClick={() => setConfirmDeleteOpen(true)}
            disabled={deleting}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold bg-destructive/10 text-destructive rounded-xl hover:bg-destructive hover:text-white transition-all border border-destructive/20 disabled:opacity-50"
          >
            {deleting ? <div className="w-4 h-4 border-2 border-destructive/20 border-t-destructive rounded-full animate-spin" /> : <Trash2 size={16} />}
            {deleting ? t("common.loading") : t("book.deleteBook")}
          </button>
        </div>
      </div>

      {(writing || drafting || activity.lastError) && (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            activity.lastError
              ? "border-destructive/30 bg-destructive/5 text-destructive"
              : "border-primary/20 bg-primary/[0.04] text-foreground"
          }`}
        >
          {activity.lastError ? (
            <span>
              {t("book.pipelineFailed")}: {activity.lastError}
            </span>
          ) : writing ? (
            <span>{t("book.pipelineWriting")}</span>
          ) : (
            <span>{t("book.pipelineDrafting")}</span>
          )}
        </div>
      )}

      {/* Tool Strip */}
      <div className="flex flex-wrap items-center gap-2 py-1">
          {reviewCount > 0 && (
            <button
              onClick={handleApproveAll}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-emerald-500/10 text-emerald-600 rounded-lg hover:bg-emerald-500/20 transition-all border border-emerald-500/20"
            >
              <CheckCheck size={14} />
              {t("book.approveAll")} ({reviewCount})
            </button>
          )}
          <button
            onClick={() => nav.toTruth(bookId)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary/50 text-muted-foreground rounded-lg hover:text-foreground hover:bg-secondary transition-all border border-border/50"
          >
            <Database size={14} />
            {t("book.truthFiles")}
          </button>
          <button
            onClick={() => nav.toAnalytics(bookId)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary/50 text-muted-foreground rounded-lg hover:text-foreground hover:bg-secondary transition-all border border-border/50"
          >
            <BarChart2 size={14} />
            {t("book.analytics")}
          </button>
          <div className="flex items-center gap-2">
            <select
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
              className="px-2 py-2 text-xs font-bold bg-secondary/50 text-muted-foreground rounded-lg border border-border/50 outline-none"
            >
              <option value="txt">TXT</option>
              <option value="md">MD</option>
              <option value="epub">EPUB</option>
            </select>
            <label className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={exportApprovedOnly}
                onChange={(e) => setExportApprovedOnly(e.target.checked)}
                className="rounded border-border/50"
              />
              {t("book.approvedOnly")}
            </label>
            <button
              onClick={async () => {
                try {
                  const data = await fetchJson<{ path?: string; chapters?: number }>(`/books/${bookId}/export-save`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ format: exportFormat, approvedOnly: exportApprovedOnly }),
                  });
                  alert(`${t("common.exportSuccess")}\n${data.path}\n(${data.chapters} ${t("dash.chapters")})`);
                } catch (e) {
                  alert(e instanceof Error ? e.message : "Export failed");
                }
              }}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary/50 text-muted-foreground rounded-lg hover:text-foreground hover:bg-secondary transition-all border border-border/50"
            >
              <Download size={14} />
              {t("book.export")}
            </button>
          </div>
      </div>

      {/* Book Settings */}
      <div className="paper-sheet rounded-2xl border border-border/40 shadow-sm p-6">
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">{t("book.settings")}</h2>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("create.wordsPerChapter")}</label>
            <input
              type="number"
              value={currentWordCount}
              onChange={(e) => setSettingsWordCount(Number(e.target.value))}
              className="px-3 py-2 text-sm rounded-lg border border-border/50 bg-secondary/30 outline-none focus:border-primary/50 w-32"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("create.targetChapters")}</label>
            <input
              type="number"
              value={currentTargetChapters}
              onChange={(e) => setSettingsTargetChapters(Number(e.target.value))}
              className="px-3 py-2 text-sm rounded-lg border border-border/50 bg-secondary/30 outline-none focus:border-primary/50 w-32"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("book.status")}</label>
            <select
              value={currentStatus}
              onChange={(e) => setSettingsStatus(e.target.value as BookStatus)}
              className="px-3 py-2 text-sm rounded-lg border border-border/50 bg-secondary/30 outline-none focus:border-primary/50"
            >
              <option value="incubating">{t("book.statusIncubating")}</option>
              <option value="active">{t("book.statusActive")}</option>
              <option value="paused">{t("book.statusPaused")}</option>
              <option value="outlining">{t("book.statusOutlining")}</option>
              <option value="completed">{t("book.statusCompleted")}</option>
              <option value="dropped">{t("book.statusDropped")}</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("book.volumeCount")}</label>
            <input
              type="number"
              min={1}
              value={currentVolumeCount ?? ""}
              onChange={(e) => setSettingsVolumeCount(e.target.value ? Number(e.target.value) : null)}
              className="px-3 py-2 text-sm rounded-lg border border-border/50 bg-secondary/30 outline-none focus:border-primary/50 w-20"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("book.currentVolume")}</label>
            <input
              type="number"
              min={1}
              value={currentCurrentVolume ?? ""}
              onChange={(e) => setSettingsCurrentVolume(e.target.value ? Number(e.target.value) : null)}
              className="px-3 py-2 text-sm rounded-lg border border-border/50 bg-secondary/30 outline-none focus:border-primary/50 w-20"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("book.keywords")}</label>
            <input
              value={currentKeywords}
              onChange={(e) => setSettingsKeywords(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-border/50 bg-secondary/30 outline-none focus:border-primary/50 w-40"
              placeholder="悬疑, 商战"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("book.targetAudience")}</label>
            <input
              value={currentTargetAudience}
              onChange={(e) => setSettingsTargetAudience(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-border/50 bg-secondary/30 outline-none focus:border-primary/50 w-36"
              placeholder="悬疑推理爱好者"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("book.serializationStatus")}</label>
            <select
              value={currentSerializationStatus}
              onChange={(e) => setSettingsSerializationStatus(e.target.value || null)}
              className="px-3 py-2 text-sm rounded-lg border border-border/50 bg-secondary/30 outline-none focus:border-primary/50"
            >
              <option value="">{t("common.notSet")}</option>
              <option value="draft">{t("book.statusDraft")}</option>
              <option value="serializing">{t("book.serializing")}</option>
              <option value="completed">{t("book.statusCompleted")}</option>
              <option value="hiatus">{t("book.hiatus")}</option>
            </select>
          </div>
          <button
            onClick={handleSaveSettings}
            disabled={savingSettings}
            className="flex items-center gap-2 px-4 py-2 text-sm font-bold bg-primary text-primary-foreground rounded-lg hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
          >
            {savingSettings ? <div className="w-4 h-4 border-2 border-primary-foreground/20 border-t-primary-foreground rounded-full animate-spin" /> : <Save size={14} />}
            {savingSettings ? t("book.saving") : t("book.save")}
          </button>
        </div>
      </div>

      {/* Role Cards */}
      <div className="paper-sheet rounded-2xl border border-border/40 shadow-sm p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
          <div className="flex items-center gap-2">
            <UserRound size={16} className="text-primary/70" />
            <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{t("book.roleCards")}</h2>
            <span className="rounded-full border border-border/50 bg-secondary/40 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
              {roles.length} · {t("book.majorRole")} {majorRoleCount} / {t("book.minorRole")} {minorRoleCount}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
              placeholder={t("book.newRoleName")}
              className="w-36 rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-xs outline-none focus:border-primary/50"
            />
            <input
              value={newRoleId}
              onChange={(e) => setNewRoleId(e.target.value)}
              placeholder={t("book.newRoleId")}
              className="w-32 rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-xs outline-none focus:border-primary/50"
            />
            <select
              value={newRoleTier}
              onChange={(e) => setNewRoleTier(e.target.value as RoleTier)}
              className="rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-xs outline-none focus:border-primary/50"
            >
              <option value="major">{t("book.majorRole")}</option>
              <option value="minor">{t("book.minorRole")}</option>
            </select>
            <button
              onClick={handleCreateRole}
              disabled={creatingRole || !newRoleName.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
            >
              {creatingRole ? <div className="h-3.5 w-3.5 rounded-full border-2 border-primary-foreground/20 border-t-primary-foreground animate-spin" /> : <Plus size={14} />}
              {t("book.createRole")}
            </button>
          </div>
        </div>

        {rolesError && (
          <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {rolesError}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
          <div className="rounded-xl border border-border/40 bg-secondary/20 p-2">
            {rolesLoading ? (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">{t("common.loading")}</div>
            ) : roles.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">{t("book.noRoles")}</div>
            ) : (
              <div className="max-h-[360px] space-y-1 overflow-y-auto pr-1">
                {roles.map((role) => (
                  <button
                    key={role.id}
                    onClick={() => setSelectedRoleId(role.id)}
                    className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${
                      selectedRoleId === role.id ? "bg-primary/10 text-primary" : "hover:bg-background/70"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{role.name}</span>
                      <span className="shrink-0 rounded-full border border-border/40 px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                        {role.roleTier === "major" ? t("book.majorRole") : t("book.minorRole")}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {role.status && <MetadataBadge text={role.status} />}
                      {(role.tags ?? []).slice(0, 3).map((tag) => <MetadataBadge key={tag} icon={<Tags size={10} />} text={tag} />)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="min-h-[360px] rounded-xl border border-border/40 bg-secondary/10 p-4">
            {roleLoading ? (
              <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-muted-foreground">{t("common.loading")}</div>
            ) : roleCard ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <MetadataField label={t("book.roleName")} value={roleName} onChange={setRoleName} />
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("book.roleTier")}</span>
                    <select
                      value={roleTier}
                      onChange={(e) => setRoleTier(e.target.value as RoleTier)}
                      className="rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-sm outline-none focus:border-primary/50"
                    >
                      <option value="major">{t("book.majorRole")}</option>
                      <option value="minor">{t("book.minorRole")}</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("book.roleStatus")}</span>
                    <select
                      value={roleStatus}
                      onChange={(e) => setRoleStatus(e.target.value as typeof roleStatus)}
                      className="rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-sm outline-none focus:border-primary/50"
                    >
                      <option value="active">{t("book.roleActive")}</option>
                      <option value="hidden">{t("book.roleHidden")}</option>
                      <option value="dead">{t("book.roleDead")}</option>
                      <option value="departed">{t("book.roleDeparted")}</option>
                      <option value="">{t("book.noMetadata")}</option>
                    </select>
                  </label>
                  <MetadataField label="ID" value={roleCard.id} onChange={() => undefined} readOnly />
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <MetadataField label={t("book.roleTags")} value={roleTags} onChange={setRoleTags} placeholder={t("book.roleTagsPlaceholder")} />
                  <MetadataField label={t("book.roleAliases")} value={roleAliases} onChange={setRoleAliases} placeholder={t("book.roleAliasesPlaceholder")} />
                </div>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("book.roleBody")}</span>
                  <textarea
                    value={roleBody}
                    onChange={(e) => setRoleBody(e.target.value)}
                    rows={12}
                    className="min-h-[260px] rounded-lg border border-border/50 bg-background/70 px-3 py-2 font-mono text-sm leading-relaxed outline-none focus:border-primary/50"
                  />
                </label>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={handleDeleteRole}
                    disabled={savingRole}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-destructive/10 px-3 py-2 text-xs font-bold text-destructive transition-colors hover:bg-destructive hover:text-white disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                    {t("common.delete")}
                  </button>
                  <button
                    onClick={handleSaveRole}
                    disabled={savingRole}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
                  >
                    {savingRole ? <div className="h-3.5 w-3.5 rounded-full border-2 border-primary-foreground/20 border-t-primary-foreground animate-spin" /> : <Save size={14} />}
                    {savingRole ? t("book.saving") : t("book.save")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[320px] items-center justify-center text-center text-sm text-muted-foreground">
                {t("book.selectRole")}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Chapter Metadata Filters */}
      <div className="paper-sheet rounded-2xl border border-border/40 shadow-sm p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={16} className="text-primary/70" />
            <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{t("book.chapterMetadata")}</h2>
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
        <p className="mt-3 text-xs text-muted-foreground">
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
                  <td className="px-6 py-4 text-muted-foreground/60 font-mono text-xs">{ch.number.toString().padStart(2, '0')}</td>
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
                              if (pendingChapterActions.includes(ch.number)) return;
                              setPendingChapterActions((prev) => [...prev, ch.number]);
                              try { await postApi(`/books/${bookId}/chapters/${ch.number}/approve`); refetch(); }
                              catch (e) { alert(e instanceof Error ? e.message : "Approve failed"); }
                              finally { setPendingChapterActions((prev) => prev.filter((n) => n !== ch.number)); }
                            }}
                            disabled={pendingChapterActions.includes(ch.number)}
                            className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500 hover:text-white transition-all shadow-sm disabled:opacity-30"
                            title={t("book.approve")}
                          >
                            <Check size={14} />
                          </button>
                          <button
                            onClick={async () => {
                              if (pendingChapterActions.includes(ch.number)) return;
                              setPendingChapterActions((prev) => [...prev, ch.number]);
                              try { await postApi(`/books/${bookId}/chapters/${ch.number}/reject`); refetch(); }
                              catch (e) { alert(e instanceof Error ? e.message : "Reject failed"); }
                              finally { setPendingChapterActions((prev) => prev.filter((n) => n !== ch.number)); }
                            }}
                            disabled={pendingChapterActions.includes(ch.number)}
                            className="p-2 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive hover:text-white transition-all shadow-sm disabled:opacity-30"
                            title={t("book.reject")}
                          >
                            <X size={14} />
                          </button>
                        </>
                      )}
                      <button
                        onClick={async () => {
                          if (pendingChapterActions.includes(ch.number)) return;
                          setPendingChapterActions((prev) => [...prev, ch.number]);
                          try {
                            const auditResult = await fetchJson<{ passed?: boolean; issues?: unknown[] }>(`/books/${bookId}/audit/${ch.number}`, { method: "POST" });
                            alert(auditResult.passed ? "Audit passed" : `Audit failed: ${auditResult.issues?.length ?? 0} issues`);
                            refetch();
                          } catch (e) {
                            alert(e instanceof Error ? e.message : "Audit failed");
                          } finally {
                            setPendingChapterActions((prev) => prev.filter((n) => n !== ch.number));
                          }
                        }}
                        disabled={pendingChapterActions.includes(ch.number)}
                        className="p-2 rounded-lg bg-secondary text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all shadow-sm disabled:opacity-50"
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
                        disabled={syncingChapters.includes(ch.number) || ch.number !== latestPersistedChapter}
                        className="p-2 rounded-lg bg-secondary text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all shadow-sm disabled:opacity-50"
                        title={data?.book.language === "en" ? "Sync truth/state from edited chapter" : "根据已编辑章节同步 truth/state"}
                      >
                        {syncingChapters.includes(ch.number)
                          ? <div className="w-3.5 h-3.5 border-2 border-muted-foreground/20 border-t-muted-foreground rounded-full animate-spin" />
                          : <RefreshCw size={14} />}
                      </button>
                      <button
                        onClick={() => openMetadataEditor(ch)}
                        className="p-2 rounded-lg bg-secondary text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all shadow-sm"
                        title={t("book.editMetadata")}
                      >
                        <Tags size={14} />
                      </button>
                      <select
                        disabled={revisingChapters.includes(ch.number)}
                        value=""
                        onChange={(e) => {
                          const mode = e.target.value as ReviseMode;
                          if (mode) handleRevise(ch.number, mode);
                        }}
                        className="px-2 py-1.5 text-[11px] font-bold rounded-lg bg-secondary text-muted-foreground border border-border/50 outline-none hover:text-primary hover:bg-primary/10 transition-all disabled:opacity-50 cursor-pointer"
                        title="Revise with AI"
                      >
                        <option value="" disabled>{revisingChapters.includes(ch.number) ? t("common.loading") : t("book.curate")}</option>
                        <option value="spot-fix">{t("book.spotFix")}</option>
                        <option value="polish">{t("book.polish")}</option>
                        <option value="rewrite">{t("book.rewrite")}</option>
                        <option value="rework">{t("book.rework")}</option>
                        <option value="anti-detect">{t("book.antiDetect")}</option>
                      </select>
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

      <ConfirmDialog
        open={confirmDeleteOpen}
        title={t("book.deleteBook")}
        message={t("book.confirmDelete")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={handleDeleteBook}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
      {metadataEditorChapter && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-2xl rounded-2xl border border-border bg-background shadow-2xl">
            <div className="border-b border-border/50 px-6 py-4">
              <h2 className="text-lg font-semibold">{t("book.editMetadata")}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {String(metadataEditorChapter.number).padStart(2, "0")} · {metadataEditorChapter.title || t("chapter.label").replace("{n}", String(metadataEditorChapter.number))}
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-6 py-5">
              <MetadataField label={t("book.tags")} value={metadataTags} onChange={setMetadataTags} placeholder={t("book.tagsPlaceholder")} />
              <MetadataField label={t("book.povCharacter")} value={metadataPov} onChange={setMetadataPov} />
              <MetadataField label={t("book.location")} value={metadataLocation} onChange={setMetadataLocation} />
              <MetadataField label={t("book.chapterType")} value={metadataChapterType} onChange={setMetadataChapterType} />
              <MetadataField label={t("book.timeOfDay")} value={metadataTimeOfDay} onChange={setMetadataTimeOfDay} />
              <MetadataField label={t("book.moodScore")} value={metadataMoodScore} onChange={setMetadataMoodScore} type="number" placeholder="-10 ~ 10" />
              <MetadataField label={t("book.wordCountTarget")} value={metadataWordCountTarget} onChange={setMetadataWordCountTarget} type="number" />
            </div>
            <div className="flex justify-end gap-2 border-t border-border/50 px-6 py-4">
              <button
                onClick={() => setMetadataEditorChapter(null)}
                disabled={savingMetadata}
                className="px-4 py-2 text-sm font-bold rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleSaveMetadata}
                disabled={savingMetadata}
                className="px-4 py-2 text-sm font-bold rounded-lg bg-primary text-primary-foreground hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
              >
                {savingMetadata ? t("book.saving") : t("book.save")}
              </button>
            </div>
          </div>
        </div>
      )}
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

function MetadataField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  readOnly = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly type?: "text" | "number";
  readonly readOnly?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        className="px-3 py-2 text-sm rounded-lg border border-border/50 bg-secondary/30 outline-none focus:border-primary/50 read-only:cursor-not-allowed read-only:text-muted-foreground"
      />
    </label>
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
      {chapter.wordCountTarget !== undefined && <MetadataBadge text={`${t("book.targetShort")} ${chapter.wordCountTarget.toLocaleString()}`} />}
      {tags.map((tag) => <MetadataBadge key={tag} icon={<Tags size={11} />} text={tag} />)}
    </div>
  );
}

function MetadataBadge({ icon, text }: { readonly icon?: React.ReactNode; readonly text: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-secondary/40 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
      {icon}
      {text}
    </span>
  );
}
