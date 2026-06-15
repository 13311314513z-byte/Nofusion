import { useState } from "react";
import { fetchJson, useApi } from "../../hooks/use-api";
import type { Theme } from "../../hooks/use-theme";
import type { TFunction } from "../../hooks/use-i18n";
import type { SSEMessage } from "../../hooks/use-sse";
import { Mic, Play, RefreshCw, AlertCircle, MessageSquare, Hash, BarChart3 } from "lucide-react";

interface VoiceProfileItem {
  characterId: string;
  characterName: string;
  avgSentenceLength?: number;
  sentenceComplexity: "simple" | "moderate" | "complex";
  prefersShortSentences: boolean;
  usesRhetoricalQuestions: boolean;
  signaturePhrases: string[];
  vocabularyLevel: "colloquial" | "standard" | "literary";
  favoredWords: string[];
  avoidedWords: string[];
  dialogueStyle: string;
  interruptionTendency: number;
  usesDialect: boolean;
  dialectNotes: string;
  analyzedFromChapters: number[];
  confidence: number;
  updatedAt: string;
}

interface VoiceProfilesData {
  profiles: VoiceProfileItem[];
  updatedAt: string;
}

const STYLE_LABELS: Record<string, string> = {
  terse: "简洁", verbose: "啰嗦", formal: "正式", casual: "随性",
  sarcastic: "讽刺", earnest: "认真", cold: "冷淡", warm: "温暖",
};

interface BookVoiceProfilesSectionProps {
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

export function BookVoiceProfilesSection({ bookId, nav, theme, t }: BookVoiceProfilesSectionProps) {
  const [analyzingChar, setAnalyzingChar] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, loading, error, refetch } = useApi<VoiceProfilesData>(
    `/books/${encodeURIComponent(bookId)}/voice-profiles`,
  );

  const profiles = data?.profiles ?? [];

  const handleAnalyze = async (characterId: string) => {
    setAnalyzingChar(characterId);
    setActionError(null);
    try {
      await fetchJson(
        `/books/${encodeURIComponent(bookId)}/voice-profiles/analyze?character=${encodeURIComponent(characterId)}`,
        { method: "POST" },
      );
      refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "分析失败");
    } finally {
      setAnalyzingChar(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Mic size={20} className="text-purple-500" />
            声纹档案
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            角色对话风格分析与一致性保障
          </p>
        </div>
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          <RefreshCw size={16} className="animate-spin mr-2" /> 加载中...
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle size={14} /> {String(error)}
        </div>
      )}
      {actionError && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle size={14} /> {actionError}
        </div>
      )}

      {!loading && !error && profiles.length === 0 && (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          <Mic size={16} className="mr-2" /> 暂无声纹档案 — 需要先运行分析
        </div>
      )}

      {/* Profile cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {profiles.map((p) => (
          <div
            key={p.characterId}
            className="border border-border/30 rounded-xl p-5 bg-card/40 hover:border-purple-500/30 transition-colors"
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold">{p.characterName}</h3>
                <code className="text-[11px] text-muted-foreground font-mono">{p.characterId}</code>
              </div>
              <button
                onClick={() => handleAnalyze(p.characterId)}
                disabled={analyzingChar === p.characterId}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] rounded-lg bg-purple-100 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {analyzingChar === p.characterId ? (
                  <RefreshCw size={11} className="animate-spin" />
                ) : (
                  <Play size={11} />
                )}
                分析
              </button>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="px-3 py-2 rounded-lg bg-secondary/10">
                <div className="text-[10px] text-muted-foreground">句子复杂度</div>
                <div className="text-xs font-medium mt-0.5">
                  {p.sentenceComplexity === "simple" ? "简单" : p.sentenceComplexity === "complex" ? "复杂" : "中等"}
                </div>
              </div>
              <div className="px-3 py-2 rounded-lg bg-secondary/10">
                <div className="text-[10px] text-muted-foreground">词汇等级</div>
                <div className="text-xs font-medium mt-0.5">
                  {p.vocabularyLevel === "colloquial" ? "口语" : p.vocabularyLevel === "literary" ? "书面" : "标准"}
                </div>
              </div>
              <div className="px-3 py-2 rounded-lg bg-secondary/10">
                <div className="text-[10px] text-muted-foreground">对话风格</div>
                <div className="text-xs font-medium mt-0.5">
                  {STYLE_LABELS[p.dialogueStyle] ?? p.dialogueStyle}
                </div>
              </div>
              <div className="px-3 py-2 rounded-lg bg-secondary/10">
                <div className="text-[10px] text-muted-foreground">打断倾向</div>
                <div className="text-xs font-medium mt-0.5">
                  {(p.interruptionTendency * 100).toFixed(0)}%
                </div>
              </div>
            </div>

            {/* Features */}
            <div className="space-y-2">
              {p.avgSentenceLength && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Hash size={11} /> 平均句长: {p.avgSentenceLength.toFixed(0)} 字
                </div>
              )}
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {p.prefersShortSentences && (
                  <span className="px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400">短句倾向</span>
                )}
                {p.usesRhetoricalQuestions && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400">反问句式</span>
                )}
                {p.usesDialect && (
                  <span className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400">方言使用</span>
                )}
              </div>
              {p.signaturePhrases.length > 0 && (
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <MessageSquare size={11} />
                  <span className="font-medium">口头禅:</span>
                  {p.signaturePhrases.map(sp => <code key={sp} className="px-1 rounded bg-secondary/10 font-mono">{sp}</code>)}
                </div>
              )}
              {p.favoredWords.length > 0 && (
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span className="font-medium">偏好词:</span>
                  {p.favoredWords.slice(0, 5).map(w => <code key={w} className="px-1 rounded bg-secondary/10 font-mono">{w}</code>)}
                  {p.favoredWords.length > 5 && <span className="text-muted-foreground/60">+{p.favoredWords.length - 5}</span>}
                </div>
              )}
              {p.avoidedWords.length > 0 && (
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span className="font-medium">避用词:</span>
                  {p.avoidedWords.slice(0, 5).map(w => <code key={w} className="px-1 rounded bg-secondary/10 font-mono">{w}</code>)}
                  {p.avoidedWords.length > 5 && <span className="text-muted-foreground/60">+{p.avoidedWords.length - 5}</span>}
                </div>
              )}
              {p.dialectNotes && (
                <p className="text-[11px] text-muted-foreground italic">方言注: {p.dialectNotes}</p>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border/20 text-[10px] text-muted-foreground">
              <span>置信度: {(p.confidence * 100).toFixed(0)}%</span>
              {p.analyzedFromChapters.length > 0 && (
                <span>分析章数: {p.analyzedFromChapters.length}</span>
              )}
              <span>更新: {new Date(p.updatedAt).toLocaleDateString()}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
