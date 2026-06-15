/**
 * Creative Panorama — sidebar context panel for the Interview view.
 *
 * Displays BookSoul, ReaderContract promises, active CreativeTensions,
 * and previous chapter recap. Fed into InterviewPanel as a left sidebar.
 *
 * @module
 */

import { useApi } from "../../hooks/use-api";
import { BookOpen, ScrollText, Zap, ChevronRight, CheckCircle2, AlertTriangle, Clock } from "lucide-react";

interface PanoramaData {
  readonly bookSoul: { readonly coreExpression: string; readonly oneThingToRemember: string };
  readonly readerContract: {
    readonly genrePromise: string;
    readonly satisfactionType: string;
    readonly finalEmotion: string;
    readonly pendingPromises: ReadonlyArray<{ readonly id: string; readonly description: string }>;
  };
  readonly activeTensions: ReadonlyArray<{
    readonly label: string;
    readonly intensity: number;
    readonly trend: string;
    readonly tensionId: string;
  }>;
  readonly previousChapterMoment: string;
}

interface CreativePanoramaProps {
  readonly bookId: string;
  readonly chapterNumber: number;
}

const SATISFACTION_LABELS: Record<string, string> = {
  intellectual: "智慧碾压",
  emotional: "情感共鸣",
  mystery: "悬疑解谜",
  action: "战斗燃爆",
  character: "人物成长",
  hybrid: "复合型",
};

const TREND_LABELS: Record<string, string> = {
  heating: "升温中",
  cooling: "冷却中",
  stable: "稳定",
  resolved: "已解决",
};

const TREND_COLORS: Record<string, string> = {
  heating: "text-red-600 dark:text-red-400",
  cooling: "text-blue-600 dark:text-blue-400",
  stable: "text-muted-foreground",
  resolved: "text-emerald-600 dark:text-emerald-400",
};

export function CreativePanorama({ bookId, chapterNumber }: CreativePanoramaProps) {
  const { data, loading } = useApi<PanoramaData>(
    `/books/${encodeURIComponent(bookId)}/interview/panorama?chapter=${chapterNumber}`,
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
        加载创作全景...
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4 text-xs">
      {/* Book Soul */}
      <div className="border border-border/20 rounded-lg p-3 bg-gradient-to-br from-violet-50/30 to-transparent dark:from-violet-950/10">
        <div className="flex items-center gap-1.5 mb-2 text-violet-600 dark:text-violet-400">
          <BookOpen size={13} />
          <span className="font-semibold tracking-wide uppercase text-[10px]">故事之魂</span>
        </div>
        <p className="text-muted-foreground leading-relaxed italic">
          「{data.bookSoul.coreExpression || "（未设定）"}」
        </p>
        {data.bookSoul.oneThingToRemember && (
          <p className="mt-1.5 text-muted-foreground/70 flex items-start gap-1">
            <span className="shrink-0 mt-0.5">💡</span>
            <span>{data.bookSoul.oneThingToRemember}</span>
          </p>
        )}
      </div>

      {/* Reader Contract */}
      <div className="border border-border/20 rounded-lg p-3">
        <div className="flex items-center gap-1.5 mb-2 text-amber-600 dark:text-amber-400">
          <ScrollText size={13} />
          <span className="font-semibold tracking-wide uppercase text-[10px]">读者契约</span>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">类型承诺</span>
            <span className="font-medium">{data.readerContract.genrePromise || "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">爽点</span>
            <span className="font-medium">
              {SATISFACTION_LABELS[data.readerContract.satisfactionType] ?? data.readerContract.satisfactionType}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">最终情绪</span>
            <span className="font-medium">{data.readerContract.finalEmotion || "—"}</span>
          </div>
        </div>
        {data.readerContract.pendingPromises.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border/10">
            <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400 mb-1">
              <Clock size={10} />
              <span className="text-[10px]">待兑现 {data.readerContract.pendingPromises.length} 项</span>
            </div>
            {data.readerContract.pendingPromises.map((p) => (
              <div key={p.id} className="flex items-center gap-1 text-muted-foreground/70 pl-3">
                <ChevronRight size={10} />
                <span className="truncate">{p.description}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Active Tensions */}
      <div className="border border-border/20 rounded-lg p-3">
        <div className="flex items-center gap-1.5 mb-2 text-red-500 dark:text-red-400">
          <Zap size={13} />
          <span className="font-semibold tracking-wide uppercase text-[10px]">
            活跃张力 ({data.activeTensions.length})
          </span>
        </div>
        {data.activeTensions.length === 0 ? (
          <p className="text-muted-foreground/60 italic">暂无活跃张力</p>
        ) : (
          <div className="space-y-2">
            {data.activeTensions.map((t) => (
              <div key={t.tensionId} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium truncate">{t.label}</span>
                  <span className={`text-[10px] ${TREND_COLORS[t.trend] ?? "text-muted-foreground"}`}>
                    {TREND_LABELS[t.trend] ?? t.trend}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-secondary/30 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${t.intensity * 10}%`,
                      backgroundColor: t.intensity >= 7 ? "#ef4444" : t.intensity >= 4 ? "#f59e0b" : "#22c55e",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Previous Chapter */}
      {data.previousChapterMoment && (
        <div className="border border-border/20 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-2 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={13} />
            <span className="font-semibold tracking-wide uppercase text-[10px]">上一章回顾</span>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            {data.previousChapterMoment}
          </p>
        </div>
      )}
    </div>
  );
}
