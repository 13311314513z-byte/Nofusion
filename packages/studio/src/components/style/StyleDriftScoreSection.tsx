import { useState } from "react";
import { fetchJson, useApi } from "../../hooks/use-api";
import { BarChart3 } from "lucide-react";
import type { BookSummary } from "../style-types.js";

interface Props {
  bookId: string;
  chapterNumber?: number;
  t: (key: string) => string;
}

export function StyleDriftScoreSection({ bookId, chapterNumber, t }: Props) {
  const [scoreData, setScoreData] = useState<{ score: number | null; chapterFingerprint?: unknown; profileFingerprint?: unknown } | null>(null);
  const [loadingScore, setLoadingScore] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const { data: booksData } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const bookTitle = booksData?.books.find((b) => b.id === bookId)?.title ?? bookId;
  const chNum = chapterNumber ?? 1;

  const handleFetchScore = async () => {
    setLoadingScore(true);
    setScoreError(null);
    try {
      const data = await fetchJson<{ score: number | null; message?: string }>(`/books/${bookId}/chapters/${chNum}/style-score`, {
        method: "POST",
      });
      setScoreData(data);
    } catch (e) {
      setScoreError(e instanceof Error ? e.message : String(e));
    }
    setLoadingScore(false);
  };

  return (
    <div className="border border-border/40 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <BarChart3 size={14} />
          风格漂移评分 — {bookTitle} 第 {chNum} 章
        </h4>
        <button
          onClick={handleFetchScore}
          disabled={loadingScore}
          className="px-3 py-1 text-xs rounded-lg bg-secondary/30 hover:bg-secondary/50 border border-border disabled:opacity-30"
        >
          {loadingScore ? "计算中..." : "计算评分"}
        </button>
      </div>
      {scoreError && (
        <div className="text-xs text-destructive">{scoreError}</div>
      )}
      {scoreData && (
        <div className="flex items-center gap-3">
          <div className={`text-2xl font-bold font-mono ${
            scoreData.score === null
              ? "text-muted-foreground"
              : scoreData.score >= 80
                ? "text-emerald-500"
                : scoreData.score >= 60
                  ? "text-amber-500"
                  : "text-destructive"
          }`}>
            {scoreData.score !== null ? `${scoreData.score}%` : "N/A"}
          </div>
          <div className="text-xs text-muted-foreground">
            {scoreData.score === null
              ? "该书暂无风格档案，请先导入文风指南"
              : scoreData.score >= 80
                ? "与全书风格高度一致"
                : scoreData.score >= 60
                  ? "有轻微风格漂移，建议检查"
                  : "存在明显风格漂移，建议调整"}
          </div>
        </div>
      )}
      {scoreData === null && !loadingScore && (
        <div className="text-xs text-muted-foreground">点击「计算评分」以比较当前文本与全书风格档案</div>
      )}
    </div>
  );
}
