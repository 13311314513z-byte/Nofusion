import { FileText, AlertTriangle, CheckCircle, GitBranch, UserRound, Target, MapPinned, X } from "lucide-react";
import { useApi } from "../../hooks/use-api";
import { createPortal } from "react-dom";

interface WritePreview {
  readonly chapterNumber: number;
  readonly contextSummary: {
    readonly hasGoal: boolean;
    readonly goalMainConflict: string | null;
    readonly hasIntent: boolean;
    readonly intentCoreNarrative: string | null;
    readonly activeHooksCount: number;
    readonly overdueHooksCount: number;
    readonly overdueHookIds: ReadonlyArray<string>;
    readonly hasPovCharacter: boolean;
    readonly povCharacter: string | null;
    readonly hasOpeningFrame: boolean;
    readonly hasClosingFrame: boolean;
  };
  readonly warnings: ReadonlyArray<string>;
}

interface WriteConfirmPanelProps {
  readonly open: boolean;
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly bookTitle: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly onViewGoals: () => void;
  readonly onViewIntents: () => void;
}

function ContextCard({ icon, label, value, ok }: { icon: React.ReactNode; label: string; value: string | null; ok: boolean }) {
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border ${ok ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/50"}`}>
      <div className={`mt-0.5 ${ok ? "text-emerald-500" : "text-amber-500"}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
        <p className="text-sm mt-0.5 truncate">{value ?? (ok ? "已设定" : "未设定")}</p>
        {!ok && <p className="text-[10px] text-amber-600 mt-0.5">建议在写章前完成</p>}
      </div>
    </div>
  );
}

export function WriteConfirmPanel({ open, bookId, chapterNumber, bookTitle, onConfirm, onCancel, onViewGoals, onViewIntents }: WriteConfirmPanelProps) {
  const { data, loading } = useApi<WritePreview>(
    open ? `/books/${encodeURIComponent(bookId)}/write-preview?chapter=${chapterNumber}` : null,
  );

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const summary = data?.contextSummary;
  const warnings = data?.warnings ?? [];

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <div>
            <h3 className="text-lg font-semibold">确认写作</h3>
            <p className="text-sm text-muted-foreground">
              {bookTitle} · 第 {chapterNumber} 章
            </p>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
            </div>
          ) : summary ? (
            <>
              {/* Context summary cards */}
              <div className="grid grid-cols-2 gap-2">
                <ContextCard
                  icon={<Target size={14} />}
                  label="章节目标"
                  value={summary.goalMainConflict}
                  ok={summary.hasGoal}
                />
                <ContextCard
                  icon={<FileText size={14} />}
                  label="创作访谈"
                  value={summary.intentCoreNarrative}
                  ok={summary.hasIntent}
                />
                <ContextCard
                  icon={<GitBranch size={14} />}
                  label="活跃伏笔"
                  value={summary.activeHooksCount > 0 ? `${summary.activeHooksCount} 条${summary.overdueHooksCount > 0 ? ` · ${summary.overdueHooksCount} 逾期` : ""}` : "无"}
                  ok={summary.overdueHooksCount === 0}
                />
                <ContextCard
                  icon={<UserRound size={14} />}
                  label="POV 角色"
                  value={summary.povCharacter}
                  ok={summary.hasPovCharacter}
                />
              </div>

              {/* Warnings */}
              {warnings.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 space-y-1.5">
                  {warnings.map((w: string, i: number) => (
                    <div key={i} className="flex items-start gap-2">
                      <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                      <p className="text-xs text-amber-700">{w}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* All clear */}
              {warnings.length === 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
                  <CheckCircle size={14} className="text-emerald-500" />
                  <p className="text-xs text-emerald-700">所有上下文已就绪，可以开始写作</p>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">无法加载写作预览</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 pb-6 pt-2 gap-3">
          <div className="flex gap-2">
            {summary && !summary.hasGoal && (
              <button onClick={onViewGoals} className="px-3 py-2 text-xs font-medium rounded-lg bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors">
                设定目标 →
              </button>
            )}
            {summary && !summary.hasIntent && (
              <button onClick={onViewIntents} className="px-3 py-2 text-xs font-medium rounded-lg bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors">
                创作访谈 →
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onCancel} className="px-4 py-2 text-sm font-medium rounded-xl bg-secondary text-foreground hover:bg-secondary/80 transition-colors border border-border/50">
              取消
            </button>
            <button onClick={onConfirm} className="px-6 py-2 text-sm font-bold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-sm">
              直接写章
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
