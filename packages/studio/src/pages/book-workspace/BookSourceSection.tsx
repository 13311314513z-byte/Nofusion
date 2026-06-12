import { useState } from "react";
import { fetchJson, useApi } from "../../hooks/use-api";
import { Trash2, AlertCircle, Database, CheckCircle, X, Upload } from "lucide-react";
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

const PURPOSE_OPTIONS = [
  { value: "auto", label: "自动检测" },
  { value: "world", label: "世界观" },
  { value: "character", label: "角色" },
  { value: "era", label: "时代背景" },
  { value: "plot", label: "剧情" },
  { value: "rule", label: "规则" },
  { value: "style", label: "文风" },
];

interface BookSourceSectionProps {
  readonly bookId: string;
  readonly theme: Theme;
  readonly t: TFunction;
}

export function BookSourceSection({ bookId, t }: BookSourceSectionProps) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadText, setUploadText] = useState("");
  const [uploadPurpose, setUploadPurpose] = useState("auto");
  const [uploading, setUploading] = useState(false);
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

  const handleUpload = async () => {
    if (!uploadName.trim() || !uploadText.trim()) return;
    setUploading(true);
    setActionError(null);
    try {
      await fetchJson(`/books/${encodeURIComponent(bookId)}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceName: uploadName.trim(),
          text: uploadText,
          purpose: uploadPurpose,
        }),
      });
      setShowUpload(false);
      setUploadName("");
      setUploadText("");
      setUploadPurpose("auto");
      await refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  if (loading) return <div className="text-sm text-gray-500">{t("common.loading")}</div>;
  if (error) return <div className="text-sm text-red-500">{error}</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{t("sources.disclaimer")}</p>
        <button
          onClick={() => setShowUpload(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors"
        >
          <Upload size={12} />
          上传资料
        </button>
      </div>
      {actionError && <p className="text-sm text-red-500">{actionError}</p>}
      {!data || data.sources.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-gray-400">
          <Database size={32} />
          <p className="text-sm">{t("sources.noSources")}</p>
        </div>
      ) : (
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
      )}

      {/* Delete confirmation dialog */}
      {deleting && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#1a1a2e] rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold mb-2">{t("sources.deleteTitle")}</h3>
            <p className="text-sm text-gray-400 mb-6">{t("sources.deleteWarning")}</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleting(null)} className="px-4 py-2 rounded text-sm bg-gray-700 hover:bg-gray-600">
                {t("common.cancel")}
              </button>
              <button onClick={() => void handleDelete()} className="px-4 py-2 rounded text-sm bg-red-600 hover:bg-red-500 text-white">
                {t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload dialog */}
      {showUpload && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowUpload(false)}>
          <div className="bg-background rounded-2xl border border-border/40 shadow-xl w-full max-w-lg mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/40">
              <h3 className="text-sm font-bold">上传资料</h3>
              <button onClick={() => setShowUpload(false)} className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground">
                <X size={16} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">名称</label>
                <input value={uploadName} onChange={(e) => setUploadName(e.target.value)} placeholder="例如：世界观设定文档"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border/50 bg-secondary/30 outline-none focus:border-primary/50" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">用途</label>
                <select value={uploadPurpose} onChange={(e) => setUploadPurpose(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border/50 bg-secondary/30 outline-none focus:border-primary/50">
                  {PURPOSE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">内容</label>
                <textarea value={uploadText} onChange={(e) => setUploadText(e.target.value)} placeholder="粘贴资料内容..."
                  rows={8} className="w-full px-3 py-2 text-sm rounded-lg border border-border/50 bg-secondary/30 outline-none focus:border-primary/50 resize-none" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowUpload(false)}
                  className="px-4 py-2 text-sm rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors">
                  {t("common.cancel")}
                </button>
                <button onClick={() => void handleUpload()} disabled={uploading || !uploadName.trim() || !uploadText.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50">
                  {uploading ? "上传中..." : "上传"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}