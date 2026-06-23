import { AlertCircle,GitBranch,Network,Play,RefreshCw } from "lucide-react";
import { useState } from "react";
import { fetchJson,useApi } from "../../hooks/use-api";
import type { TFunction } from "../../hooks/use-i18n";
import type { SSEMessage } from "../../hooks/use-sse";
import type { Theme } from "../../hooks/use-theme";

interface EventChainData {
  chain: {
    bookId: string;
    chapterNumber: number;
    events: EventItem[];
    generatedAt: string;
    confidence: number;
  } | null;
  message?: string;
}

interface EventItem {
  eventId: string;
  chapterNumber: number;
  sceneIndex: number;
  location: string;
  timeOfDay: string;
  atmosphere: string;
  participants: Array<{ characterId: string; role: string; initialEmotion: string; goalInScene: string }>;
  actions: Array<{ actorId: string; type: string; description: string; intent: string; outcome: string }>;
  sourceFiles: string[];
  confidence: number;
}

interface BookEventChainSectionProps {
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

export function BookEventChainSection({ bookId, nav: _nav, theme: _theme, t: _t }: BookEventChainSectionProps) {
  const [chapterNum, setChapterNum] = useState(1);
  const [extracting, setExtracting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, loading, error, refetch } = useApi<EventChainData>(
    `/books/${encodeURIComponent(bookId)}/event-chain?chapter=${chapterNum}`,
  );

  const handleExtract = async () => {
    setExtracting(true);
    setActionError(null);
    try {
      await fetchJson(`/books/${encodeURIComponent(bookId)}/event-chain/extract?chapter=${chapterNum}`, {
        method: "POST",
      });
      refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "提取失败");
    } finally {
      setExtracting(false);
    }
  };

  const chain = data?.chain;
  const events = chain?.events ?? [];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <GitBranch size={20} className="text-amber-500" />
            事件链
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            场景间因果事件序列管线
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">章节</label>
            <input
              type="number"
              min={1}
              value={chapterNum}
              onChange={(e) => setChapterNum(Math.max(1, Number(e.target.value)))}
              className="w-20 px-2 py-1.5 text-sm border border-border/40 rounded-lg bg-background"
            />
          </div>
          <button
            onClick={handleExtract}
            disabled={extracting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {extracting ? (
              <RefreshCw size={12} className="animate-spin" />
            ) : (
              <Play size={12} />
            )}
            {extracting ? "提取中..." : "提取事件链"}
          </button>
        </div>
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          <RefreshCw size={16} className="animate-spin mr-2" />
          加载中...
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle size={14} />
          {String(error)}
        </div>
      )}
      {actionError && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle size={14} />
          {actionError}
        </div>
      )}
      {!loading && !error && !chain && data?.message && (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          <Network size={16} className="mr-2" />
          {data.message}
        </div>
      )}

      {/* Chain metadata */}
      {chain && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground bg-secondary/5 rounded-lg px-4 py-2 border border-border/20">
          <span>生成时间: {new Date(chain.generatedAt).toLocaleString()}</span>
          <span>置信度: {(chain.confidence * 100).toFixed(0)}%</span>
          <span>事件数: {events.length}</span>
        </div>
      )}

      {/* Event list */}
      {events.length > 0 && (
        <div className="space-y-4">
          {events.map((evt, i) => (
            <div
              key={evt.eventId}
              className="border border-border/30 rounded-xl p-4 bg-card/40 hover:border-amber-500/30 transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 text-[11px] font-mono rounded bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400">
                    {evt.eventId}
                  </span>
                  <span className="text-sm font-semibold">{evt.location}</span>
                  <span className="text-xs text-muted-foreground">· {evt.timeOfDay}</span>
                  <span className="text-xs text-muted-foreground">· {evt.atmosphere}</span>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  #{(i + 1)}
                </span>
              </div>

              {/* Participants */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {evt.participants.map((p) => (
                  <span
                    key={p.characterId}
                    className="px-2 py-0.5 text-[11px] rounded-full bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400"
                    title={`${p.role}: ${p.goalInScene} (${p.initialEmotion})`}
                  >
                    {p.characterId} ({p.role})
                  </span>
                ))}
              </div>

              {/* Actions */}
              <div className="space-y-1.5 mb-3">
                {evt.actions.map((a, ai) => (
                  <div key={ai} className="flex items-start gap-2 text-xs">
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-secondary/20 font-mono shrink-0 mt-0.5">
                      {a.type}
                    </span>
                    <span className="font-medium">{a.actorId}:</span>
                    <span className="text-muted-foreground">{a.description}</span>
                    <span className="text-muted-foreground/60">→ {a.outcome}</span>
                  </div>
                ))}
              </div>

              {/* Source files */}
              {evt.sourceFiles.length > 0 && (
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span>来源:</span>
                  {evt.sourceFiles.map((f) => (
                    <code key={f} className="px-1 py-0.5 rounded bg-secondary/10 font-mono">{f}</code>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
