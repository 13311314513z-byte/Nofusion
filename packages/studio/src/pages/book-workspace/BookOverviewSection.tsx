import { useEffect, useState } from "react";
import type { Theme } from "../../hooks/use-theme";
import type { TFunction } from "../../hooks/use-i18n";
import type { SSEMessage } from "../../hooks/use-sse";
import { useApi, fetchJson } from "../../hooks/use-api";
import {
  LayoutDashboard,
  Files,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Tag,
  MapPin,
  GitBranch,
  Cpu,
  Activity,
} from "lucide-react";

interface ChapterMeta {
  readonly number: number;
  readonly title: string;
  readonly status: string;
  readonly wordCount: number;
  readonly tags?: ReadonlyArray<string>;
  readonly location?: string;
}

interface BookData {
  readonly book: {
    readonly id: string;
    readonly title: string;
    readonly genre: string;
    readonly status: string;
    readonly chapterWordCount: number;
  };
  readonly chapters: ReadonlyArray<ChapterMeta>;
}

interface AuditSummary {
  readonly bookId: string;
  readonly totalChapters: number;
  readonly auditedChapters: number;
  readonly passedChapters: number;
  readonly failedChapters: number;
}

interface HookRecord {
  readonly hookId: string;
  readonly status: string;
}

interface RuntimeFile {
  readonly name: string;
  readonly path: string;
  readonly size: number;
  readonly isDirectory: boolean;
}

interface RuntimeData {
  readonly files: ReadonlyArray<RuntimeFile>;
}

interface BookOverviewSectionProps {
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

function StatCard({
  label,
  value,
  icon,
  accent,
  danger,
  onClick,
}: {
  readonly label: string;
  readonly value: string | number;
  readonly icon: React.ReactNode;
  readonly accent?: boolean;
  readonly danger?: boolean;
  readonly onClick?: () => void;
}) {
  const content = (
    <div className="flex items-center gap-2 text-muted-foreground mb-2">
      {icon}
      <span className="text-xs font-medium">{label}</span>
    </div>
  );

  const valueNode = (
    <div className={`text-2xl font-bold tabular-nums ${danger ? "text-red-600" : accent ? "text-emerald-600" : ""}`}>
      {value}
    </div>
  );

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className="text-left rounded-xl border border-border/40 bg-card p-4 hover:border-primary/30 hover:bg-primary/[0.02] transition-colors"
      >
        {content}
        {valueNode}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border/40 bg-card p-4">
      {content}
      {valueNode}
    </div>
  );
}

export function BookOverviewSection({ bookId, nav, t, sse }: BookOverviewSectionProps) {
  const {
    data: bookData,
    loading: bookLoading,
    error: bookError,
    refetch: refetchBook,
  } = useApi<BookData>(`/books/${encodeURIComponent(bookId)}`);

  const {
    data: auditData,
    loading: auditLoading,
    error: auditError,
    refetch: refetchAudit,
  } = useApi<AuditSummary>(`/audit/books/${encodeURIComponent(bookId)}/summary`);

  const [hooks, setHooks] = useState<ReadonlyArray<HookRecord>>([]);
  const [hooksLoading, setHooksLoading] = useState(true);
  const [hooksError, setHooksError] = useState<string | null>(null);

  const [runtime, setRuntime] = useState<RuntimeData | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(true);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHooksLoading(true);
    setHooksError(null);
    fetchJson<{ hooks: ReadonlyArray<HookRecord> }>(`/books/${bookId}/hooks`)
      .then((data) => { if (!cancelled) setHooks(data.hooks ?? []); })
      .catch((e) => { if (!cancelled) setHooksError(e instanceof Error ? e.message : "Failed to load hooks"); })
      .finally(() => { if (!cancelled) setHooksLoading(false); });
    return () => { cancelled = true; };
  }, [bookId]);

  useEffect(() => {
    let cancelled = false;
    setRuntimeLoading(true);
    setRuntimeError(null);
    fetchJson<RuntimeData>(`/books/${bookId}/runtime`)
      .then((data) => { if (!cancelled) setRuntime(data); })
      .catch((e) => { if (!cancelled) setRuntimeError(e instanceof Error ? e.message : "Failed to load runtime"); })
      .finally(() => { if (!cancelled) setRuntimeLoading(false); });
    return () => { cancelled = true; };
  }, [bookId]);

  const chapters = bookData?.chapters ?? [];
  const missingTags = chapters.filter((ch) => !(ch.tags && ch.tags.length > 0)).length;
  const missingLocation = chapters.filter((ch) => !ch.location || ch.location.trim() === "").length;
  // 与 Hooks 页面口径一致：排除 deferred 和 resolved
  const unresolvedHooks = hooks.filter((h) => h.status !== "resolved" && h.status !== "deferred").length;
  const runtimeFiles = runtime?.files.length ?? 0;

  const loading = bookLoading || auditLoading || hooksLoading || runtimeLoading;
  const errors = [bookError, auditError, hooksError, runtimeError].filter(Boolean) as string[];

  const handleRetryAll = () => {
    refetchBook();
    refetchAudit();
    // Re-fetch hooks and runtime via manual calls
    setHooksLoading(true);
    setHooksError(null);
    fetchJson<{ hooks: ReadonlyArray<HookRecord> }>(`/books/${bookId}/hooks`)
      .then((data) => setHooks(data.hooks ?? []))
      .catch((e) => setHooksError(e instanceof Error ? e.message : "Failed to load hooks"))
      .finally(() => setHooksLoading(false));

    setRuntimeLoading(true);
    setRuntimeError(null);
    fetchJson<RuntimeData>(`/books/${bookId}/runtime`)
      .then((data) => setRuntime(data))
      .catch((e) => setRuntimeError(e instanceof Error ? e.message : "Failed to load runtime"))
      .finally(() => setRuntimeLoading(false));
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
        <span className="text-sm text-muted-foreground">{t("common.loading")}</span>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="paper-sheet rounded-2xl border border-border/40 shadow-sm p-5 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-2">
          <LayoutDashboard size={16} className="text-primary/70" />
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{t("workspace.section.overview")}</h2>
        </div>

        {/* Errors */}
        {errors.map((err, idx) => (
          <div
            key={idx}
            className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-center justify-between"
          >
            <span>{err}</span>
            <button
              onClick={handleRetryAll}
              className="text-xs font-bold underline hover:no-underline shrink-0 ml-2"
            >
              {t("common.retry")}
            </button>
          </div>
        ))}

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          <StatCard
            label={t("overview.totalChapters")}
            value={chapters.length}
            icon={<Files size={16} />}
            onClick={() => nav.toBookSection(bookId, "chapters")}
          />
          <StatCard
            label={t("overview.audited")}
            value={auditData?.auditedChapters ?? 0}
            icon={<ShieldCheck size={16} />}
            onClick={() => nav.toBookSection(bookId, "audit")}
          />
          <StatCard
            label={t("overview.passed")}
            value={auditData?.passedChapters ?? 0}
            icon={<CheckCircle2 size={16} />}
            accent
            onClick={() => nav.toBookSection(bookId, "audit")}
          />
          <StatCard
            label={t("overview.failed")}
            value={auditData?.failedChapters ?? 0}
            icon={<XCircle size={16} />}
            danger={(auditData?.failedChapters ?? 0) > 0}
            onClick={() => nav.toBookSection(bookId, "audit")}
          />
          <StatCard
            label={t("overview.missingTags")}
            value={missingTags}
            icon={<Tag size={16} />}
            danger={missingTags > 0}
            onClick={() => nav.toBookSection(bookId, "chapters")}
          />
          <StatCard
            label={t("overview.missingLocation")}
            value={missingLocation}
            icon={<MapPin size={16} />}
            danger={missingLocation > 0}
            onClick={() => nav.toBookSection(bookId, "chapters")}
          />
          <StatCard
            label={t("overview.unresolvedHooks")}
            value={unresolvedHooks}
            icon={<GitBranch size={16} />}
            danger={unresolvedHooks > 0}
            onClick={() => nav.toBookSection(bookId, "hooks")}
          />
          <StatCard
            label={t("overview.runtimeFiles")}
            value={runtimeFiles}
            icon={<Cpu size={16} />}
            onClick={() => nav.toBookSection(bookId, "runtime")}
          />
        </div>

        {/* Recent SSE events */}
        <div className="rounded-xl border border-border/40 bg-secondary/10 overflow-hidden">
          <div className="px-4 py-3 border-b border-border/30 bg-muted/20 flex items-center gap-2">
            <Activity size={14} />
            <h3 className="text-sm font-semibold">{t("overview.recentEvents")}</h3>
          </div>
          <div className="divide-y divide-border/25">
            {sse.messages.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                {t("overview.noEvents")}
              </div>
            ) : (
              sse.messages.slice(-3).reverse().map((msg, idx) => (
                <div key={idx} className="px-4 py-3 flex items-start gap-3 text-sm">
                  <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0 mt-0.5">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-primary/70 shrink-0">
                    {msg.event}
                  </span>
                  <span className="text-xs text-muted-foreground truncate">
                    {typeof msg.data === "string" ? msg.data : JSON.stringify(msg.data)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
