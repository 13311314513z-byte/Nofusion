import { useState } from "react";
import { fetchJson, useApi } from "../../hooks/use-api";
import type { TFunction } from "../../hooks/use-i18n";
import type { CoreStyleProfile } from "../style-types.js";
import type { BookSummary } from "../style-types.js";
import type { FullStyleDiagnostics } from "@actalk/inkos-core";
import { StyleDiagnosticsPanel } from "../../components/style/StyleDiagnosticsPanel.js";
import { Stethoscope, BarChart3 } from "lucide-react";

interface StyleDiagnoseTabProps {
  readonly text: string;
  readonly profile: CoreStyleProfile | null;
  readonly diagnostics: FullStyleDiagnostics | null;
  readonly loadingDiagnostics: boolean;
  readonly importBookId: string;
  readonly importChapterNumber: number;
  readonly renderProfileCard: (p: CoreStyleProfile | null, showImport?: boolean) => React.ReactNode;
  readonly c: Record<string, string>;
  readonly t: TFunction;
  readonly handleDiagnostics: () => void;
}

export function StyleDiagnoseTab({
  text,
  profile,
  diagnostics,
  loadingDiagnostics,
  importBookId,
  importChapterNumber,
  renderProfileCard,
  c,
  t,
  handleDiagnostics,
}: StyleDiagnoseTabProps) {

  if (!profile) {
    return (
      <div className="max-w-4xl mx-auto py-4 space-y-6">
        <div className="text-center text-muted-foreground py-16 border border-dashed border-border/40 rounded-lg">
          <p className="text-sm">请在「文本导入」步骤中先粘贴或上传文本并运行分析</p>
          <p className="text-xs mt-2">分析完成后将在此展示详细的文风诊断报告</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-4 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">文风诊断报告</h2>
        <button
          onClick={handleDiagnostics}
          disabled={loadingDiagnostics || !text.trim()}
          className={`px-3 py-1.5 text-xs rounded-lg ${c.btnSecondary} disabled:opacity-30 flex items-center gap-1`}
        >
          {loadingDiagnostics ? <div className="w-3 h-3 border-2 border-muted-foreground/20 border-t-mforeground rounded-full animate-spin" /> : <Stethoscope size={12} />}
          完整诊断
        </button>
      </div>
      {renderProfileCard(profile, true)}
      {diagnostics && <StyleDiagnosticsPanel diagnostics={diagnostics} text={text} t={t as any} />}

      {/* Style drift score — shown when source is a book */}
      {importBookId && (
        <StyleDriftScoreSection bookId={importBookId} chapterNumber={importChapterNumber} t={t as unknown as (key: string) => string} />
      )}
    </div>
  );
}

// ─── Style Drift Score (inline sub-component) ─────────────────────────

function StyleDriftScoreSection({ bookId, chapterNumber, t }: { bookId: string; chapterNumber?: number; t: (key: string) => string }) {
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
