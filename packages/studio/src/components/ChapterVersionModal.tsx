import { useState, useEffect } from "react";
import { fetchJson } from "../hooks/use-api";
import { X, FileText, RotateCcw, AlertTriangle } from "lucide-react";

interface VersionInfo {
  readonly revision: number;
  readonly filename: string;
}

interface ChapterVersionModalProps {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly chapterTitle: string;
  readonly onClose: () => void;
  readonly onRestore: (chapterNumber: number, content: string) => void;
}

export function ChapterVersionModal({
  bookId,
  chapterNumber,
  chapterTitle,
  onClose,
  onRestore,
}: ChapterVersionModalProps) {
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRev, setSelectedRev] = useState<number | null>(null);
  const [versionContent, setVersionContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchJson<{ versions: VersionInfo[] }>(`/books/${bookId}/chapters/${chapterNumber}/versions`)
      .then((data: { versions: VersionInfo[] }) => setVersions(data.versions))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load versions"))
      .finally(() => setLoading(false));
  }, [bookId, chapterNumber]);

  const handleSelectVersion = async (rev: number) => {
    setSelectedRev(rev);
    setLoadingContent(true);
    setVersionContent(null);
    try {
      const data = await fetchJson<{ content: string }>(`/books/${bookId}/chapters/${chapterNumber}/versions/${rev}`);
      setVersionContent(data.content);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load version content");
    } finally {
      setLoadingContent(false);
    }
  };

  const handleRestore = async () => {
    if (!versionContent) return;
    setRestoring(true);
    try {
      await fetchJson(`/books/${bookId}/chapters/${chapterNumber}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: versionContent }),
      });
      onRestore(chapterNumber, versionContent);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-background rounded-2xl border border-border/40 shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/40">
          <div>
            <h2 className="text-sm font-bold">版本历史</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              第 {chapterNumber} 章 · {chapterTitle}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Version list */}
          <div className="w-48 border-r border-border/40 overflow-y-auto shrink-0">
            {loading ? (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground">加载中...</div>
            ) : error && versions.length === 0 ? (
              <div className="flex items-center justify-center h-full text-xs text-destructive p-4">{error}</div>
            ) : versions.length === 0 ? (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground p-4">暂无版本</div>
            ) : (
              <div className="py-2">
                {versions.map((v) => (
                  <button
                    key={v.revision}
                    onClick={() => handleSelectVersion(v.revision)}
                    className={`w-full text-left px-4 py-2 text-xs transition-colors ${
                      selectedRev === v.revision
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-secondary/30"
                    }`}
                  >
                    <FileText size={12} className="inline mr-1.5" />
                    版本 {v.revision}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Content preview */}
          <div className="flex-1 overflow-y-auto p-4">
            {loadingContent ? (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground">加载中...</div>
            ) : versionContent ? (
              <div className="space-y-3">
                <pre className="text-xs leading-relaxed whitespace-pre-wrap font-sans break-words max-h-96 overflow-y-auto">
                  {versionContent}
                </pre>
                <button
                  onClick={handleRestore}
                  disabled={restoring}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  <RotateCcw size={12} />
                  {restoring ? "恢复中..." : "恢复到当前版本"}
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                选择一个版本查看内容
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
