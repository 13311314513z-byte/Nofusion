import { useState } from "react";
import { useApi, fetchJson } from "../../hooks/use-api";
import type { Theme } from "../../hooks/use-theme";
import type { TFunction } from "../../hooks/use-i18n";
import type { SSEMessage } from "../../hooks/use-sse";
import { useColors } from "../../hooks/use-colors";
import { RefreshCw, Save, BookOpen, Eye, X, AlertTriangle, ShieldAlert, Play } from "lucide-react";

interface FanficData {
  readonly bookId: string;
  readonly content: string | null;
}

interface BookFanficSectionProps {
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

function extractSection(content: string, titles: string[]): string | null {
  for (const title of titles) {
    // Pattern 1: ## Title\n ... (until next ## or end)
    const p1 = new RegExp(`##\\s*${title}\\s*\n([\\s\\S]*?)(?=\\n?##|\\s*$)`, "i");
    const m1 = content.match(p1);
    if (m1?.[1]?.trim()) return m1[1].trim();

    // Pattern 2: **Title**：content (fullwidth or halfwidth colon)
    const p2 = new RegExp(`\\*\\*${title}\\*\\*[：:]\\s*([\\s\\S]*?)(?=\\n\\*\\*|\\n##|$)`, "i");
    const m2 = content.match(p2);
    if (m2?.[1]?.trim()) return m2[1].trim();
  }
  return null;
}

function computeLineDiff(current: string, next: string): Array<{ line: string; isNew: boolean }> {
  const currentLines = current.split("\n").map((l) => l.trim());
  const currentSet = new Set(currentLines.filter((l) => l.length > 0));
  const nextLines = next.split("\n");
  return nextLines.map((line) => ({
    line,
    isNew: line.trim().length > 0 && !currentSet.has(line.trim()),
  }));
}

const MODE_BADGE: Record<
  string,
  { label: string; classes: string }
> = {
  canon: {
    label: "严格遵守原作",
    classes:
      "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900",
  },
  au: {
    label: "平行宇宙，适度偏离",
    classes:
      "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-900",
  },
  ooc: {
    label: "角色重塑，大幅偏离",
    classes:
      "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-400 dark:border-purple-900",
  },
  cp: {
    label: "关系向，关注人物配对",
    classes:
      "bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-950/30 dark:text-pink-400 dark:border-pink-900",
  },
};

export function BookFanficSection({ bookId, nav, theme, t }: BookFanficSectionProps) {
  const c = useColors(theme);
  const { data, loading, error, refetch } = useApi<FanficData>(`/books/${bookId}/fanfic`);
  const { data: bookData } = useApi<{ book: { title: string; fanficMode?: string } }>(
    `/books/${encodeURIComponent(bookId)}`,
  );
  const [sourceText, setSourceText] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const fanficMode = bookData?.book.fanficMode;

  const CONSTRAINT_LEVEL: Record<string, { label: string; classes: string }> = {
  hard: { label: "硬约束", classes: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  soft: { label: "软约束", classes: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
};

  const canonCards = data?.content
    ? [
        {
          key: "characters",
          title: "人物",
          constraint: "hard" as const,
          content: extractSection(data.content, ["人物", "角色", "Characters"]),
        },
        {
          key: "relationships",
          title: "关系",
          constraint: "soft" as const,
          content: extractSection(data.content, ["关系", "人物关系", "Relationships"]),
        },
        {
          key: "forbidden",
          title: "禁改设定",
          constraint: "hard" as const,
          content: extractSection(data.content, ["禁改", "禁改设定", "不可更改", "Forbidden"]),
        },
        {
          key: "events",
          title: "关键事件",
          constraint: "hard" as const,
          content: extractSection(data.content, ["事件", "关键事件", "剧情", "Events"]),
        },
      ]
    : [];

  const diffLines =
    showPreview && sourceText ? computeLineDiff(data?.content ?? "", sourceText) : [];

  const newLineCount = diffLines.filter((d) => d.isNew).length;

  const handleRefresh = async () => {
    if (!sourceText.trim()) {
      setActionError(t("fanfic.sourceRequired"));
      return;
    }
    setActionError(null);
    setRefreshing(true);
    try {
      await fetchJson(`/books/${bookId}/fanfic/refresh`, {
        method: "POST",
        body: JSON.stringify({
          sourceText: sourceText.trim(),
          sourceName: sourceName.trim() || undefined,
        }),
      });
      await refetch();
      setSourceText("");
      setSourceName("");
      setShowPreview(false);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="paper-sheet rounded-2xl border border-border/40 shadow-sm p-5 space-y-6">
        {actionError && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-center justify-between">
            <span>{actionError}</span>
            <button
              onClick={() => setActionError(null)}
              className="text-xs font-bold hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <BookOpen size={16} className="text-primary/70" />
            <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
              {t("workspace.section.fanfic")}
            </h2>
          </div>
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-secondary/40 px-3 py-2 text-xs font-bold text-muted-foreground hover:bg-secondary transition-colors"
            title={t("common.refresh")}
          >
            <RefreshCw size={14} />
            {t("common.refresh")}
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
          </div>
        )}

        {/* Canon content */}
        {!loading && data && (
          <div className="space-y-4">
            {/* Fanfic mode badge */}
            {fanficMode && MODE_BADGE[fanficMode] && (
              <div className="flex">
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-bold ${MODE_BADGE[fanficMode].classes}`}
                >
                  {MODE_BADGE[fanficMode].label}
                </span>
              </div>
            )}

            {data.content ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {canonCards.map((card) => {
                    const level = CONSTRAINT_LEVEL[card.constraint];
                    return (
                      <div key={card.key} className="rounded-xl border bg-secondary/10 p-4 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-sm font-bold">{card.title}</h3>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${level.classes}`} title={card.constraint === "hard" ? "偏离将触发审计警告" : "允许适度偏离原作"}>
                            {level.label}
                          </span>
                        </div>
                        {card.content ? (
                          <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed text-muted-foreground overflow-auto max-h-[200px]">
                            {card.content}
                          </pre>
                        ) : (
                          <p className="text-xs text-muted-foreground italic">暂无</p>
                        )}
                      </div>
                    );
                  })}
                </div>
                {/* Deviation check action */}
                <div className="flex items-center justify-end gap-3">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <ShieldAlert size={12} />
                    检查当前章节是否偏离原作约束
                  </span>
                  <button
                    onClick={() => nav.toBookSection(bookId, "audit")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-secondary/40 px-3 py-2 text-xs font-bold text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                  >
                    <Play size={12} />
                    打开审计面板
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border/40 p-8 text-center">
                <p className="text-sm text-muted-foreground">{t("fanfic.noCanon")}</p>
              </div>
            )}

            {/* Refresh form */}
            <div className="rounded-xl border border-border/40 bg-secondary/10 p-4 space-y-3">
              <h3 className="text-sm font-semibold">{t("fanfic.refreshTitle")}</h3>
              <input
                type="text"
                placeholder={t("fanfic.sourceNamePlaceholder")}
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                className="w-full rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-sm outline-none"
              />
              <textarea
                placeholder={t("fanfic.sourceTextPlaceholder")}
                value={sourceText}
                onChange={(e) => {
                  setSourceText(e.target.value);
                  if (showPreview) setShowPreview(false);
                }}
                rows={6}
                className="w-full rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-sm outline-none resize-y"
              />

              {/* Preview panel */}
              {showPreview && sourceText && (
                <div className="rounded-lg border border-border/40 bg-background p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-muted-foreground">变更预览</h4>
                    <button
                      onClick={() => setShowPreview(false)}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <X size={12} />
                      关闭预览
                    </button>
                  </div>
                  <div className="max-h-[300px] overflow-auto rounded border border-border/30 bg-secondary/20 p-2 space-y-0.5">
                    {diffLines.map((d, i) => (
                      <div
                        key={i}
                        className={`text-xs font-mono leading-relaxed px-1 rounded ${
                          d.isNew
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                            : "text-muted-foreground"
                        }`}
                      >
                        {d.line || " "}
                      </div>
                    ))}
                  </div>
                  {newLineCount > 0 && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                      +{newLineCount} 新增行
                    </p>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between gap-4">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <AlertTriangle size={12} />
                  将覆盖现有 canon
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowPreview((v) => !v)}
                    disabled={!sourceText.trim()}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
                      !sourceText.trim()
                        ? "bg-muted text-muted-foreground cursor-not-allowed"
                        : "border border-border/50 bg-secondary/40 text-muted-foreground hover:bg-secondary"
                    }`}
                  >
                    <Eye size={14} />
                    预览变更
                  </button>
                  <button
                    onClick={() => void handleRefresh()}
                    disabled={refreshing || !sourceText.trim()}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold transition-transform ${
                      refreshing || !sourceText.trim()
                        ? "bg-muted text-muted-foreground cursor-not-allowed"
                        : "bg-primary text-primary-foreground hover:scale-[1.02] active:scale-[0.98]"
                    }`}
                  >
                    {refreshing ? (
                      <div className="w-3 h-3 border-2 border-primary-foreground/20 border-t-primary-foreground rounded-full animate-spin" />
                    ) : (
                      <Save size={14} />
                    )}
                    {t("fanfic.refreshButton")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
