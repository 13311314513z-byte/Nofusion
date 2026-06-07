import { useState, useMemo } from "react";
import type { TFunction } from "../../hooks/use-i18n";
import { useApi } from "../../hooks/use-api";
import { FileText, Layers, MapPinned, Search, Tags, UserRound, AlertTriangle } from "lucide-react";

const COMMON_SUFFIXES = ["城", "市", "镇", "村", "山", "湖", "河", "岛", "林", "宫", "殿", "楼", "阁", "院", "府", "堡", "寨", "庄", "谷", "峰", "江", "海", "原", "域", "区"];

function stripSuffix(name: string): string {
  for (const suffix of COMMON_SUFFIXES) {
    if (name.endsWith(suffix) && name.length > suffix.length) {
      return name.slice(0, -suffix.length);
    }
  }
  return name;
}

interface ChapterMeta {
  readonly number: number;
  readonly title: string;
  readonly status: string;
  readonly wordCount: number;
  readonly tags?: ReadonlyArray<string>;
  readonly povCharacter?: string;
  readonly location?: string;
  readonly chapterType?: string;
}

interface BookData {
  readonly book: {
    readonly id: string;
    readonly title: string;
    readonly genre: string;
    readonly language?: string;
  };
  readonly chapters: ReadonlyArray<ChapterMeta>;
}

interface BookScenesSectionProps {
  readonly bookId: string;
  readonly nav: {
    readonly toDashboard: () => void;
    readonly toChapter: (bookId: string, num: number) => void;
    readonly toBook: (bookId: string) => void;
    readonly toBookSection: (bookId: string, section: string) => void;
    readonly toServices: () => void;
  };
  readonly t: TFunction;
}

function MetadataBadge({ icon, text }: { readonly icon?: React.ReactNode; readonly text: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-secondary/40 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
      {icon}
      {text}
    </span>
  );
}

function uniqueSorted(values: ReadonlyArray<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))]
    .sort((a, b) => a.localeCompare(b));
}

export function BookScenesSection({ bookId, nav, t }: BookScenesSectionProps) {
  const { data, loading, error } = useApi<BookData>(`/books/${bookId}`);
  const [sceneSearch, setSceneSearch] = useState("");

  // All hooks must be called before early returns (React Rules of Hooks).
  const unassignedLocation = t("book.scenesUnassigned");

  const aliasGroups = useMemo(() => {
    if (!data) return [];
    const { chapters } = data;
    const normalizedSearch = sceneSearch.trim().toLowerCase();
    const matchedChapters = chapters.filter((chapter) => {
      const haystack = [
        chapter.number,
        chapter.title,
        chapter.status,
        chapter.location,
        chapter.chapterType,
        chapter.povCharacter,
        ...(chapter.tags ?? []),
      ].join(" ").toLowerCase();
      return !normalizedSearch || haystack.includes(normalizedSearch);
    });

    const grouped = new Map<string, ChapterMeta[]>();
    for (const chapter of matchedChapters) {
      const location = chapter.location?.trim() || unassignedLocation;
      grouped.set(location, [...(grouped.get(location) ?? []), chapter]);
    }

    const sceneGroups = [...grouped.entries()]
      .map(([location, items]) => ({
        location,
        chapters: [...items].sort((a, b) => a.number - b.number),
        totalWords: items.reduce((sum, chapter) => sum + (chapter.wordCount ?? 0), 0),
        povs: uniqueSorted(items.map((chapter) => chapter.povCharacter)),
        types: uniqueSorted(items.map((chapter) => chapter.chapterType)),
        tags: uniqueSorted(items.flatMap((chapter) => [...(chapter.tags ?? [])])).slice(0, 8),
      }))
      .sort((a, b) => {
        if (a.location === unassignedLocation) return -1;
        if (b.location === unassignedLocation) return 1;
        return a.chapters[0]!.number - b.chapters[0]!.number;
      });

    const locationNames = sceneGroups
      .map((g) => g.location)
      .filter((loc) => loc !== unassignedLocation);

    const aliases: Array<{ canonical: string; variants: string[] }> = [];
    const seen = new Set<string>();
    for (const name of locationNames) {
      if (seen.has(name)) continue;
      const base = stripSuffix(name);
      const group = [name];
      seen.add(name);
      for (const other of locationNames) {
        if (seen.has(other)) continue;
        const otherBase = stripSuffix(other);
        if (base === otherBase || (base.length > 1 && other.includes(base)) || (otherBase.length > 1 && name.includes(otherBase))) {
          group.push(other);
          seen.add(other);
        }
      }
      if (group.length > 1) {
        aliases.push({ canonical: group[0]!, variants: group.slice(1) });
      }
    }
    return aliases;
  }, [data, sceneSearch, unassignedLocation]);

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
  const normalizedSearch = sceneSearch.trim().toLowerCase();
  const matchedChapters = chapters.filter((chapter) => {
    const haystack = [
      chapter.number,
      chapter.title,
      chapter.status,
      chapter.location,
      chapter.chapterType,
      chapter.povCharacter,
      ...(chapter.tags ?? []),
    ].join(" ").toLowerCase();
    return !normalizedSearch || haystack.includes(normalizedSearch);
  });

  const grouped = new Map<string, ChapterMeta[]>();
  for (const chapter of matchedChapters) {
    const location = chapter.location?.trim() || unassignedLocation;
    grouped.set(location, [...(grouped.get(location) ?? []), chapter]);
  }

  const sceneGroups = [...grouped.entries()]
    .map(([location, items]) => ({
      location,
      chapters: [...items].sort((a, b) => a.number - b.number),
      totalWords: items.reduce((sum, chapter) => sum + (chapter.wordCount ?? 0), 0),
      povs: uniqueSorted(items.map((chapter) => chapter.povCharacter)),
      types: uniqueSorted(items.map((chapter) => chapter.chapterType)),
      tags: uniqueSorted(items.flatMap((chapter) => [...(chapter.tags ?? [])])).slice(0, 8),
    }))
    .sort((a, b) => {
      if (a.location === unassignedLocation) return -1;
      if (b.location === unassignedLocation) return 1;
      return a.chapters[0]!.number - b.chapters[0]!.number;
    });

  const totalWords = matchedChapters.reduce((sum, chapter) => sum + (chapter.wordCount ?? 0), 0);
  const unassignedCount = grouped.get(unassignedLocation)?.length ?? 0;

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-border/40 pb-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-serif font-medium">{t("book.scenesTitle")}</h1>
            {book.language === "en" && (
              <span className="px-1.5 py-0.5 rounded border border-primary/20 text-primary text-[10px] font-bold">EN</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground font-medium">
            <span className="px-2 py-0.5 rounded bg-secondary/50 text-foreground/70 uppercase tracking-wider text-xs">{book.genre}</span>
            <div className="flex items-center gap-1.5">
              <MapPinned size={14} />
              <span>{sceneGroups.length} {t("workspace.section.scenes")}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <FileText size={14} />
              <span>{matchedChapters.length} {t("dash.chapters")}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span>{totalWords.toLocaleString()} {t("book.words")}</span>
            </div>
          </div>
        </div>
        <div className="relative w-full md:w-80">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={sceneSearch}
            onChange={(e) => setSceneSearch(e.target.value)}
            placeholder={t("book.scenesSearch")}
            className="w-full rounded-lg border border-border/50 bg-secondary/30 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary/50"
          />
        </div>
      </div>

      {sceneGroups.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center border border-border/40 rounded-2xl bg-card/30">
          <MapPinned size={24} className="text-muted-foreground/40 mb-3" />
          <p className="text-sm italic font-serif text-muted-foreground">
            {chapters.length === 0 ? t("book.noChapters") : t("book.scenesEmpty")}
          </p>
        </div>
      )}

      {/* Alias warnings */}
      {aliasGroups.length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/30 bg-amber-50/20 dark:bg-amber-950/10 p-4 space-y-2">
          <h3 className="text-xs font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
            <AlertTriangle size={12} />
            检测到可能的地名别名（建议统一标注）
          </h3>
          <div className="flex flex-wrap gap-2">
            {aliasGroups.map((ag) => (
              <span key={ag.canonical} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-amber-100/50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300">
                <span className="font-medium">{ag.canonical}</span>
                <span className="text-muted-foreground">≈</span>
                {ag.variants.map((v, i) => (
                  <span key={v}>{i > 0 && ", "}{v}</span>
                ))}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Unassigned warning banner */}
      {unassignedCount > 0 && (
        <div className="rounded-xl border border-red-200 dark:border-red-900/30 bg-red-50/20 dark:bg-red-950/10 p-4 flex items-center gap-3">
          <AlertTriangle size={16} className="text-red-500 shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-700 dark:text-red-400">
              {unassignedCount} 个章节未标注地点
            </p>
            <p className="text-xs text-red-600/70 dark:text-red-400/70">
              建议前往章节页批量补全地点信息，便于场景治理
            </p>
          </div>
          <button
            onClick={() => nav.toBookSection(bookId, "chapters")}
            className="ml-auto shrink-0 inline-flex items-center gap-1 rounded-lg border border-red-200 dark:border-red-900/30 bg-red-100/50 dark:bg-red-900/20 px-3 py-1.5 text-xs font-bold text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
          >
            去补全
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {sceneGroups.map((group) => {
          const isUnassigned = group.location === unassignedLocation;
          return (
            <section
              key={group.location}
              className={`rounded-xl border overflow-hidden ${
                isUnassigned
                  ? "border-red-200 dark:border-red-900/30 bg-red-50/10 dark:bg-red-950/5"
                  : "border-border/40 bg-card/40"
              }`}
            >
            <div className={`px-4 py-3 border-b ${isUnassigned ? "border-red-200 dark:border-red-900/20 bg-red-50/30 dark:bg-red-950/10" : "border-border/30 bg-muted/20"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <MapPinned size={16} className={`shrink-0 ${isUnassigned ? "text-red-500" : "text-primary"}`} />
                    <h2 className={`font-serif text-lg font-medium truncate ${isUnassigned ? "text-red-700 dark:text-red-400" : ""}`} title={group.location}>{group.location}</h2>
                    {isUnassigned && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-medium shrink-0">
                        未标注
                      </span>
                    )}
                  </div>
                  <p className={`mt-1 text-xs ${isUnassigned ? "text-red-600/70 dark:text-red-400/70" : "text-muted-foreground"}`}>
                    {group.chapters.length} {t("book.sceneChapters")} · {group.totalWords.toLocaleString()} {t("book.words")}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {group.types.map((type) => <MetadataBadge key={type} icon={<Layers size={11} />} text={type} />)}
                {group.povs.map((pov) => <MetadataBadge key={pov} icon={<UserRound size={11} />} text={pov} />)}
                {group.tags.map((tag) => <MetadataBadge key={tag} icon={<Tags size={11} />} text={tag} />)}
              </div>
            </div>
            <div className={`divide-y ${isUnassigned ? "divide-red-100 dark:divide-red-900/20" : "divide-border/25"}`}>
              {group.chapters.map((chapter) => (
                <button
                  key={chapter.number}
                  onClick={() => nav.toChapter(bookId, chapter.number)}
                  className={`w-full px-4 py-3 text-left transition-colors ${
                    isUnassigned
                      ? "hover:bg-red-50/30 dark:hover:bg-red-950/10"
                      : "hover:bg-primary/[0.03]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-muted-foreground/70">{chapter.number.toString().padStart(2, "0")}</span>
                        <span className="truncate font-medium">{chapter.title || t("chapter.label").replace("{n}", String(chapter.number))}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {chapter.chapterType && <MetadataBadge icon={<Layers size={10} />} text={chapter.chapterType} />}
                        {chapter.povCharacter && <MetadataBadge icon={<UserRound size={10} />} text={chapter.povCharacter} />}
                        {(chapter.tags ?? []).slice(0, 4).map((tag) => <MetadataBadge key={tag} text={tag} />)}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{(chapter.wordCount ?? 0).toLocaleString()}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>
          );
        })}
      </div>
    </div>
  );
}
