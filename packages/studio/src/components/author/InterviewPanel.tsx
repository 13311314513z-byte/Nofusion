import { useState } from "react";
import { useApi, fetchJson } from "../../hooks/use-api";
import { MessageSquareHeart, ChevronDown, ChevronRight, AlertTriangle, Info, Lightbulb, Save, SkipForward } from "lucide-react";

interface InterviewQuestion {
  readonly id: string;
  readonly question: string;
  readonly context: string;
  readonly level: number;
  readonly prefill?: string;
}

interface CreativeTrigger {
  readonly type: string;
  readonly message: string;
  readonly severity: "info" | "warning" | "critical";
}

interface InterviewData {
  readonly chapterNumber: number;
  readonly questions: ReadonlyArray<InterviewQuestion>;
  readonly triggers: ReadonlyArray<CreativeTrigger>;
}

interface InterviewPanelProps {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly onSaved?: () => void;
}

const LEVEL_LABELS: Record<number, string> = {
  1: "核心三问",
  2: "场景规划",
  3: "角色状态",
  4: "约束条件",
};

const TRIGGER_COLORS: Record<string, string> = {
  info: "border-blue-200 bg-blue-50 text-blue-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  critical: "border-red-200 bg-red-50 text-red-700",
};

const TRIGGER_ICONS: Record<string, React.ElementType> = {
  info: Info,
  warning: AlertTriangle,
  critical: AlertTriangle,
};

export function InterviewPanel({ bookId, chapterNumber, onSaved }: InterviewPanelProps) {
  const { data, loading, error } = useApi<InterviewData>(
    `/books/${encodeURIComponent(bookId)}/interview?chapter=${chapterNumber}`,
  );

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [expandedLevels, setExpandedLevels] = useState<Set<number>>(new Set([1]));

  const toggleLevel = (level: number) => {
    setExpandedLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      // Build a simplified intent payload from the answers
      const coreNarrative = [answers["core_narrative"], answers["scene_count"]]
        .filter(Boolean).join("\n\n场景规划：");
      const readerTakeaway = answers["reader_takeaway"] || undefined;
      const keyMoment = answers["key_moment"] || undefined;

      const result = await fetchJson<{ ok: boolean }>(
        `/books/${encodeURIComponent(bookId)}/chapter-intents/${chapterNumber}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            coreNarrative: coreNarrative || undefined,
            readerTakeaway,
            keyMoment,
            requiredBeats: answers["must_include"]
              ? answers["must_include"].split(/[,，、\n]/).map((s: string) => s.trim()).filter(Boolean)
              : undefined,
            forbiddenMoves: answers["must_avoid"]
              ? [answers["must_avoid"]].filter(Boolean)
              : undefined,
          }),
        },
      );
      if (result.ok) {
        setSaved(true);
        onSaved?.();
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = () => {
    onSaved?.();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive p-4">{error}</p>;
  }

  if (!data) return null;

  const questionsByLevel = new Map<number, InterviewQuestion[]>();
  for (const q of data.questions) {
    const list = questionsByLevel.get(q.level) || [];
    list.push(q);
    questionsByLevel.set(q.level, list);
  }

  return (
    <div className="flex h-full">
      {/* Main interview area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <MessageSquareHeart size={20} className="text-primary" />
              创作访谈 · 第 {chapterNumber} 章
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              回答以下问题，帮助系统更准确地理解你的创作意图
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSkip}
              className="px-3 py-1.5 text-xs rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              <SkipForward size={12} />
              跳过
            </button>
            <button
              onClick={handleSave}
              disabled={saving || saved}
              className="px-4 py-1.5 text-xs font-bold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center gap-1"
            >
              <Save size={12} />
              {saving ? "保存中..." : saved ? "已保存 ✓" : "保存"}
            </button>
          </div>
        </div>

        {saveError && (
          <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
            {saveError}
          </div>
        )}

        {/* Questions by level */}
        {[1, 2, 3, 4].map((level) => {
          const levelQuestions = questionsByLevel.get(level);
          if (!levelQuestions || levelQuestions.length === 0) return null;
          const isExpanded = expandedLevels.has(level);

          return (
            <div key={level} className="border border-border/50 rounded-xl overflow-hidden">
              <button
                onClick={() => toggleLevel(level)}
                className="w-full flex items-center justify-between px-4 py-3 bg-secondary/30 hover:bg-secondary/50 transition-colors"
              >
                <span className="text-sm font-semibold">
                  Level {level}: {LEVEL_LABELS[level] || "其他"}
                  <span className="text-muted-foreground font-normal ml-2">
                    ({levelQuestions.length} 问)
                  </span>
                </span>
                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>

              {isExpanded && (
                <div className="p-4 space-y-4">
                  {levelQuestions.map((q) => (
                    <div key={q.id} className="space-y-2">
                      <div className="flex items-start gap-2">
                        <Lightbulb size={14} className="text-amber-500 mt-0.5 shrink-0" />
                        <div className="flex-1">
                          <p className="text-sm font-medium">{q.question}</p>
                          {q.context && (
                            <p className="text-xs text-muted-foreground mt-1">{q.context}</p>
                          )}
                        </div>
                      </div>
                      <textarea
                        value={answers[q.id] || q.prefill || ""}
                        onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                        placeholder="输入你的回答..."
                        rows={2}
                        className="w-full rounded-lg border border-border/50 bg-secondary/20 px-3 py-2 text-sm outline-none focus:border-primary/50 resize-none"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Sidebar: triggers */}
      {data.triggers.length > 0 && (
        <div className="w-64 shrink-0 border-l border-border/30 p-4 space-y-3 overflow-y-auto">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            创作提示
          </h3>
          {data.triggers.map((trigger, i) => {
            const Icon = TRIGGER_ICONS[trigger.severity] || Info;
            return (
              <div
                key={i}
                className={`flex items-start gap-2 p-2.5 rounded-lg border text-xs ${TRIGGER_COLORS[trigger.severity] || TRIGGER_COLORS.info}`}
              >
                <Icon size={14} className="shrink-0 mt-0.5" />
                <p>{trigger.message}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
