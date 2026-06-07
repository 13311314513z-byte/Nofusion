import { useState } from "react";
import { fetchJson, useApi } from "../../hooks/use-api";
import { Trash2, AlertCircle, Database, CheckCircle } from "lucide-react";
import type { Theme } from "../../hooks/use-theme";
import type { TFunction } from "../../hooks/use-i18n";

interface SourceEntry {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly fileType: string;
  readonly purpose: string;
  readonly charCount: number;
  readonly importedAt: string;
  readonly mode: "create" | "supplement" | "rebuild";
  readonly sourceFileExists: boolean;
}

const PURPOSE_LABELS: Record<string, string> = {
  auto: "auto",
  world: "world",
  character: "character",
  era: "era",
  plot: "plot",
  chapter: "chapter",
  rule: "rule",
  style: "style",
};

interface BookSourceSectionProps {
  readonly bookId: string;
  readonly theme: Theme;
  readonly t: TFunction;
}

export function BookSourceSection({ bookId, t }: BookSourceSectionProps) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { data, loading, error, refetch } = useApi<{ sources: SourceEntry[] }>(
    `/books/${encodeURIComponent(bookId)}/sources`,
  );

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      setActionError(null);
      await fetchJson(
        `/books/${encodeURIComponent(bookId)}/sources/${encodeURIComponent(deleting)}`,
        { method: "DELETE" },
      );
      setDeleting(null);
      await refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading) return <div className="text-sm text-gray-500">{t("common.loading")}</div>;
  if (error) return <div className="text-sm text-red-500">{error}</div>;
  if (!data || data.sources.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-gray-400">
        <Database size={32} />
        <p className="text-sm">{t("sources.noSources")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">{t("sources.disclaimer")}</p>
      {actionError && <p className="text-sm text-red-500">{actionError}</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2">{t("sources.name")}</th>
            <th className="text-left py-2">{t("sources.purpose")}</th>
            <th className="text-right py-2">{t("sources.chars")}</th>
            <th className="text-left py-2">{t("sources.importedAt")}</th>
            <th className="text-center py-2">{t("sources.status")}</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {data.sources.map((entry) => (
            <tr key={entry.sourceId} className="border-b border-gray-800">
              <td className="py-2">{entry.sourceName}</td>
              <td className="py-2">{t(`sources.purpose.${entry.purpose}` as any)}</td>
              <td className="py-2 text-right">{entry.charCount.toLocaleString()}</td>
              <td className="py-2 text-xs">{new Date(entry.importedAt).toLocaleDateString()}</td>
              <td className="py-2 text-center">
                {entry.sourceFileExists
                  ? <CheckCircle size={14} className="text-green-500 inline" />
                  : <AlertCircle size={14} className="text-amber-500 inline" />}
              </td>
              <td className="py-2 text-center">
                <button
                  onClick={() => setDeleting(entry.sourceId)}
                  className="text-red-400 hover:text-red-300"
                >
                  <Trash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Delete confirmation dialog */}
      {deleting && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#1a1a2e] rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold mb-2">{t("sources.deleteTitle")}</h3>
            <p className="text-sm text-gray-400 mb-6">{t("sources.deleteWarning")}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleting(null)}
                className="px-4 py-2 rounded text-sm bg-gray-700 hover:bg-gray-600"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => void handleDelete()}
                className="px-4 py-2 rounded text-sm bg-red-600 hover:bg-red-500 text-white"
              >
                {t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
