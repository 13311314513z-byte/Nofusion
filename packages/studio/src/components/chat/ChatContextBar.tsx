import { useApi } from "../../hooks/use-api";
import { Target, GitBranch, UserRound, AlertTriangle, ExternalLink } from "lucide-react";

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
  };
  readonly warnings: ReadonlyArray<string>;
}

interface ChatContextBarProps {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly onNavigateToSection: (section: string) => void;
}

export function ChatContextBar({ bookId, chapterNumber, onNavigateToSection }: ChatContextBarProps) {
  const { data } = useApi<WritePreview>(
    `/books/${encodeURIComponent(bookId)}/write-preview?chapter=${chapterNumber}`,
  );

  if (!data) return null;
  const s = data.contextSummary;

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border/30 bg-secondary/10 overflow-x-auto text-xs">
      {/* Chapter indicator */}
      <span className="font-semibold text-muted-foreground shrink-0">
        第 {chapterNumber} 章
      </span>

      <span className="text-border/50 shrink-0">|</span>

      {/* Goal status */}
      <button
        onClick={() => onNavigateToSection("goals")}
        className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors shrink-0 ${
          s.hasGoal
            ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
            : "bg-amber-100 text-amber-700 hover:bg-amber-200"
        }`}
        title={s.goalMainConflict ?? "未设定目标"}
      >
        <Target size={12} />
        <span className="max-w-[120px] truncate">
          {s.goalMainConflict ? `目标: ${s.goalMainConflict.slice(0, 20)}...` : "未设定目标"}
        </span>
        <ExternalLink size={10} />
      </button>

      {/* Intent status */}
      <button
        onClick={() => onNavigateToSection("intents")}
        className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors shrink-0 ${
          s.hasIntent
            ? "bg-blue-100 text-blue-700 hover:bg-blue-200"
            : "bg-amber-100 text-amber-700 hover:bg-amber-200"
        }`}
        title={s.intentCoreNarrative ?? "未完成访谈"}
      >
        <Target size={12} />
        <span>
          {s.hasIntent ? "访谈已完成" : "未完成访谈"}
        </span>
        <ExternalLink size={10} />
      </button>

      {/* Hooks */}
      <button
        onClick={() => onNavigateToSection("hooks")}
        className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors shrink-0 ${
          s.overdueHooksCount > 0
            ? "bg-red-100 text-red-700 hover:bg-red-200"
            : "bg-secondary text-muted-foreground hover:bg-secondary/80"
        }`}
      >
        <GitBranch size={12} />
        <span>
          {s.activeHooksCount} 条活跃
          {s.overdueHooksCount > 0 && (
            <span className="ml-1">
              <AlertTriangle size={10} className="inline text-red-500" />
              {s.overdueHooksCount} 逾期
            </span>
          )}
        </span>
        <ExternalLink size={10} />
      </button>

      {/* POV */}
      {s.hasPovCharacter && (
        <button
          onClick={() => onNavigateToSection("characters")}
          className="flex items-center gap-1 px-2 py-1 rounded-md bg-secondary text-muted-foreground hover:bg-secondary/80 transition-colors shrink-0"
        >
          <UserRound size={12} />
          <span>POV: {s.povCharacter}</span>
          <ExternalLink size={10} />
        </button>
      )}

      {/* Warnings summary */}
      {data.warnings.length > 0 && (
        <span className="flex items-center gap-1 px-2 py-1 rounded-md bg-amber-100 text-amber-700 shrink-0">
          <AlertTriangle size={12} />
          {data.warnings.length} 项提醒
        </span>
      )}
    </div>
  );
}
