import { useState, useEffect, useMemo } from "react";
import { fetchJson } from "../hooks/use-api";
import { X, FileText, RotateCcw, AlertTriangle, GitCompare, ArrowLeftRight } from "lucide-react";

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
  const [diffMode, setDiffMode] = useState(false);
  const [leftRev, setLeftRev] = useState<number | null>(null);
  const [rightRev, setRightRev] = useState<number | null>(null);
  const [leftContent, setLeftContent] = useState<string | null>(null);
  const [rightContent, setRightContent] = useState<string | null>(null);

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

  // ── Diff mode ──

  const loadBothForDiff = async (left: number, right: number) => {
    setLeftContent(null);
    setRightContent(null);
    try {
      const [lData, rData] = await Promise.all([
        fetchJson<{ content: string }>(`/books/${bookId}/chapters/${chapterNumber}/versions/${left}`),
        fetchJson<{ content: string }>(`/books/${bookId}/chapters/${chapterNumber}/versions/${right}`),
      ]);
      setLeftContent(lData.content);
      setRightContent(rData.content);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load versions for diff");
    }
  };

  const toggleLeft = (rev: number) => {
    const next = leftRev === rev ? null : rev;
    setLeftRev(next);
    if (next !== null && rightRev !== null) loadBothForDiff(next, rightRev);
  };

  const toggleRight = (rev: number) => {
    const next = rightRev === rev ? null : rev;
    setRightRev(next);
    if (leftRev !== null && next !== null) loadBothForDiff(leftRev, next);
  };

  const diffLines = useMemo(() => {
    if (!leftContent || !rightContent) return null;
    // Simple line-by-line diff
    const leftLines = leftContent.split("\n");
    const rightLines = rightContent.split("\n");
    const result: Array<{ type: "same" | "added" | "removed"; text: string; leftNum?: number; rightNum?: number }> = [];

    // Simple LCS-based diff for small texts, fall back to character-by-character for performance
    const maxLen = Math.max(leftLines.length, rightLines.length);
    if (maxLen > 500) {
      // Fast path: just compare aligned by index
      const minLen = Math.min(leftLines.length, rightLines.length);
      for (let i = 0; i < minLen; i++) {
        if (leftLines[i] === rightLines[i]) {
          result.push({ type: "same", text: leftLines[i], leftNum: i + 1, rightNum: i + 1 });
        } else {
          result.push({ type: "removed", text: leftLines[i], leftNum: i + 1 });
          result.push({ type: "added", text: rightLines[i], rightNum: i + 1 });
        }
      }
      for (let i = minLen; i < leftLines.length; i++) {
        result.push({ type: "removed", text: leftLines[i], leftNum: i + 1 });
      }
      for (let i = minLen; i < rightLines.length; i++) {
        result.push({ type: "added", text: rightLines[i], rightNum: i + 1 });
      }
    } else {
      // Full LCS diff for texts under 500 lines
      const lcsMatrix: number[][] = Array.from({ length: leftLines.length + 1 }, () => new Array(rightLines.length + 1).fill(0));
      for (let i = 1; i <= leftLines.length; i++) {
        for (let j = 1; j <= rightLines.length; j++) {
          if (leftLines[i - 1] === rightLines[j - 1]) {
            lcsMatrix[i][j] = lcsMatrix[i - 1][j - 1] + 1;
          } else {
            lcsMatrix[i][j] = Math.max(lcsMatrix[i - 1][j], lcsMatrix[i][j - 1]);
          }
        }
      }
      // Backtrack
      let i = leftLines.length, j = rightLines.length;
      const temp: Array<{ type: "same" | "added" | "removed"; text: string; leftNum?: number; rightNum?: number }> = [];
      while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && leftLines[i - 1] === rightLines[j - 1]) {
          temp.unshift({ type: "same", text: leftLines[i - 1], leftNum: i, rightNum: j });
          i--; j--;
        } else if (j > 0 && (i === 0 || lcsMatrix[i][j - 1] >= lcsMatrix[i - 1][j])) {
          temp.unshift({ type: "added", text: rightLines[j - 1], rightNum: j });
          j--;
        } else {
          temp.unshift({ type: "removed", text: leftLines[i - 1], leftNum: i });
          i--;
        }
      }
      result.push(...temp);
    }
    return result;
  }, [leftContent, rightContent]);

  const hasDiff = diffLines && diffLines.some(d => d.type !== "same");
  const diffStats = useMemo(() => {
    if (!diffLines) return null;
    const added = diffLines.filter(d => d.type === "added").length;
    const removed = diffLines.filter(d => d.type === "removed").length;
    return { added, removed, total: diffLines.length };
  }, [diffLines]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-background rounded-2xl border border-border/40 shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/40">
          <div>
            <h2 className="text-sm font-bold">{diffMode ? "版本对比" : "版本历史"}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              第 {chapterNumber} 章 · {chapterTitle}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setDiffMode(!diffMode); setSelectedRev(null); setVersionContent(null); setLeftRev(null); setRightRev(null); setLeftContent(null); setRightContent(null); }}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-colors ${
                diffMode ? "bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" : "hover:bg-secondary/50 text-muted-foreground"
              }`}
            >
              {diffMode ? <ArrowLeftRight size={12} /> : <GitCompare size={12} />}
              {diffMode ? "对比中" : "对比"}
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Version list */}
          <div className="w-52 border-r border-border/40 overflow-y-auto shrink-0">
            {loading ? (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground">加载中...</div>
            ) : error && versions.length === 0 ? (
              <div className="flex items-center justify-center h-full text-xs text-destructive p-4">{error}</div>
            ) : versions.length === 0 ? (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground p-4">暂无版本</div>
            ) : diffMode ? (
              <div className="py-2 space-y-4">
                <div>
                  <div className="px-3 py-1 text-[10px] text-muted-foreground uppercase tracking-wider">左侧 (旧版)</div>
                  {versions.map((v) => (
                    <button
                      key={`l-${v.revision}`}
                      onClick={() => toggleLeft(v.revision)}
                      className={`w-full text-left px-4 py-2 text-xs transition-colors ${
                        leftRev === v.revision ? "bg-blue-100 dark:bg-blue-900/20 text-blue-700 font-medium" : "text-muted-foreground hover:bg-secondary/30"
                      }`}
                    >
                      <FileText size={12} className="inline mr-1.5" />
                      版本 {v.revision}
                    </button>
                  ))}
                </div>
                <div className="border-t border-border/20 pt-2">
                  <div className="px-3 py-1 text-[10px] text-muted-foreground uppercase tracking-wider">右侧 (新版)</div>
                  {versions.map((v) => (
                    <button
                      key={`r-${v.revision}`}
                      onClick={() => toggleRight(v.revision)}
                      className={`w-full text-left px-4 py-2 text-xs transition-colors ${
                        rightRev === v.revision ? "bg-emerald-100 dark:bg-emerald-900/20 text-emerald-700 font-medium" : "text-muted-foreground hover:bg-secondary/30"
                      }`}
                    >
                      <FileText size={12} className="inline mr-1.5" />
                      版本 {v.revision}
                    </button>
                  ))}
                </div>
              </div>
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
            {diffMode ? (
              leftContent && rightContent && diffLines ? (
                <div className="space-y-2">
                  {diffStats && (
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3 pb-3 border-b border-border/20">
                      <span className="text-emerald-600 dark:text-emerald-400">+{diffStats.added} 新增</span>
                      <span className="text-red-600 dark:text-red-400">-{diffStats.removed} 删除</span>
                      <span>{diffStats.total} 行总计</span>
                      {!hasDiff && <span className="text-muted-foreground">（无差异）</span>}
                    </div>
                  )}
                  <div className="font-mono text-xs leading-relaxed">
                    {diffLines.map((dl, i) => (
                      <div
                        key={i}
                        className={`px-2 py-0.5 ${
                          dl.type === "added"
                            ? "bg-emerald-100/50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-300"
                            : dl.type === "removed"
                              ? "bg-red-100/50 dark:bg-red-900/20 text-red-800 dark:text-red-300"
                              : ""
                        }`}
                      >
                        <span className="inline-block w-10 text-right mr-3 text-[10px] text-muted-foreground select-none">
                          {dl.leftNum ? `L${dl.leftNum}` : ""}{dl.rightNum ? ` R${dl.rightNum}` : ""}
                        </span>
                        <span className="whitespace-pre-wrap break-all">{dl.type === "added" ? "+ " : dl.type === "removed" ? "- " : "  "}{dl.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                  {!leftRev || !rightRev ? "在左侧选择两个版本进行对比" : "加载中..."}
                </div>
              )
            ) : loadingContent ? (
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
