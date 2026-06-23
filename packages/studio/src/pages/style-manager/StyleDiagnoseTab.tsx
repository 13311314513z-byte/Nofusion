import type { FullStyleDiagnostics } from "@actalk/inkos-core";
import { Stethoscope } from "lucide-react";
import { StyleDiagnosticsPanel } from "../../components/style/StyleDiagnosticsPanel.js";
import { StyleDriftScoreSection } from "../../components/style/StyleDriftScoreSection.js";
import type { TFunction } from "../../hooks/use-i18n";
import type { CoreStyleProfile } from "../style-types.js";

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
      {diagnostics && <StyleDiagnosticsPanel diagnostics={diagnostics} text={text} t={t} />}

      {/* Style drift score — shown when source is a book */}
      {importBookId && (
        <StyleDriftScoreSection bookId={importBookId} chapterNumber={importChapterNumber} t={t as unknown as (key: string) => string} />
      )}
    </div>
  );
}
