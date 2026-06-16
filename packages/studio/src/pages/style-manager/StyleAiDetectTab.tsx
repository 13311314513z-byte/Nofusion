import { AITellsPanel } from "../../components/style/AITellsPanel.js";
import type { TFunction } from "../../hooks/use-i18n";

interface StyleAiDetectTabProps {
  readonly text: string;
  readonly t: TFunction;
}

export function StyleAiDetectTab({ text, t }: StyleAiDetectTabProps) {
  return (
    <div className="max-w-2xl mx-auto py-4">
      <AITellsPanel
        t={t as unknown as (key: string) => string}
        initialText={text || undefined}
        language="zh"
      />
    </div>
  );
}
