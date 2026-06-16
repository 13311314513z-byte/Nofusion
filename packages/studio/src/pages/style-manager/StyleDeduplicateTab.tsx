import { useState } from "react";
import { fetchJson } from "../../hooks/use-api";
import { ReadabilityDashboard } from "../../components/readability/ReadabilityDashboard.js";
import { DuplicateParagraphPanel } from "../../components/readability/DuplicateParagraphPanel.js";
import { RhetoricIssuePanel } from "../../components/readability/RhetoricIssuePanel.js";
import { BarChart3 } from "lucide-react";

interface StyleDeduplicateTabProps {
  readonly text: string;
  readonly setText: (v: string) => void;
  readonly setAnalyzeStatus: (v: string) => void;
  readonly c: Record<string, string>;
}

export function StyleDeduplicateTab({
  text,
  setText,
  setAnalyzeStatus,
  c,
}: StyleDeduplicateTabProps) {
  const [dedupData, setDedupData] = useState<{
    duplicateGroups: ReadonlyArray<import("@actalk/inkos-core").DuplicateParagraphGroup>;
    similarGroups: ReadonlyArray<import("@actalk/inkos-core").SimilarParagraphGroup>;
    rhetoricFindings: ReadonlyArray<import("@actalk/inkos-core").DuplicateRhetoricFinding>;
    readabilityScore: import("@actalk/inkos-core").ReadabilityScore | null;
  } | null>(null);
  const [loadingDedup, setLoadingDedup] = useState(false);
  const [ignoredRhetoricIds, setIgnoredRhetoricIds] = useState<readonly string[]>([]);
  const [fixedRhetoricIds, setFixedRhetoricIds] = useState<readonly string[]>([]);

  const handleFetchDedupData = async () => {
    if (!text.trim()) return;
    setLoadingDedup(true);
    setDedupData(null);
    try {
      const [paragraphResult, rhetoricResult, readabilityResult] = await Promise.allSettled([
        fetchJson<{ duplicateGroups: ReadonlyArray<import("@actalk/inkos-core").DuplicateParagraphGroup>; similarGroups: ReadonlyArray<import("@actalk/inkos-core").SimilarParagraphGroup> }>("/style/paragraph/dedup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, language: "zh" }),
        }),
        fetchJson<{ findings: ReadonlyArray<import("@actalk/inkos-core").DuplicateRhetoricFinding> }>("/style/rhetoric/detect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, language: "zh" }),
        }),
        fetchJson<import("@actalk/inkos-core").ReadabilityScore>("/style/readability/score", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, language: "zh" }),
        }),
      ]);
      const duplicateGroups = paragraphResult.status === "fulfilled" ? paragraphResult.value.duplicateGroups : [];
      const similarGroups = paragraphResult.status === "fulfilled" ? paragraphResult.value.similarGroups : [];
      const rhetoricFindings = rhetoricResult.status === "fulfilled" && Array.isArray(rhetoricResult.value?.findings)
        ? rhetoricResult.value.findings
        : [];
      const readabilityScore = readabilityResult.status === "fulfilled" ? readabilityResult.value : null;
      setDedupData({ duplicateGroups, similarGroups, rhetoricFindings, readabilityScore });
    } catch {
      // Individual failures already handled by allSettled
    }
    setLoadingDedup(false);
  };

  if (!text.trim()) {
    return (
      <div className="max-w-4xl mx-auto py-4 space-y-6">
        <div className="text-center text-muted-foreground py-16 border border-dashed border-border/40 rounded-lg">
          <p className="text-sm">请先在「文本导入」步骤中导入文本</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-4 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">修辞去重</h2>
        <button
          onClick={handleFetchDedupData}
          disabled={loadingDedup}
          className={`px-3 py-1.5 text-xs rounded-lg ${c.btnSecondary} disabled:opacity-30 flex items-center gap-1`}
        >
          {loadingDedup ? <div className="w-3 h-3 border-2 border-muted-foreground/20 border-t-mforeground rounded-full animate-spin" /> : <BarChart3 size={12} />}
          {loadingDedup ? "检测中..." : "开始检测"}
        </button>
      </div>

      {/* Readability Dashboard */}
      {dedupData?.readabilityScore && (
        <ReadabilityDashboard score={dedupData.readabilityScore} source="style" />
      )}

      {/* Duplicate Paragraph Panel */}
      {dedupData && (dedupData.duplicateGroups.length > 0 || dedupData.similarGroups.length > 0) && (
        <DuplicateParagraphPanel
          duplicateGroups={dedupData.duplicateGroups}
          similarGroups={dedupData.similarGroups}
          onDelete={(ids) => {
            const lines = text.split("\n");
            const indicesToRemove = [...ids]
              .map((id) => id - 1)
              .filter((i) => i >= 0 && i < lines.length)
              .sort((a, b) => b - a);
            for (const idx of indicesToRemove) {
              lines[idx] = "";
            }
            setText(lines.filter((l) => l !== "").join("\n"));
            setAnalyzeStatus(`已删除 ${ids.length} 段重复内容`);
          }}
          onMerge={(group, mergedText) => {
            const lines = text.split("\n");
            if (group.paragraphs && group.paragraphs.length > 0) {
              const firstLineIndex = group.paragraphs[0].lineNumber - 1;
              if (firstLineIndex >= 0 && firstLineIndex < lines.length) {
                lines[firstLineIndex] = mergedText;
              }
              const restIndices = group.paragraphs
                .slice(1)
                .map((p) => p.lineNumber - 1)
                .filter((i) => i >= 0 && i < lines.length)
                .sort((a, b) => b - a);
              for (const idx of restIndices) {
                lines[idx] = "";
              }
            }
            setText(lines.filter((l) => l !== "").join("\n"));
            setAnalyzeStatus("已合并相似段落");
          }}
        />
      )}

      {/* Rhetoric Issue Panel */}
      {dedupData && dedupData.rhetoricFindings.filter((f) => !ignoredRhetoricIds.includes(f.id)).length > 0 && (
        <RhetoricIssuePanel
          findings={dedupData.rhetoricFindings.filter((f) => !ignoredRhetoricIds.includes(f.id) && !fixedRhetoricIds.includes(f.id))}
          mode="full"
          actions={["highlight", "ignore", "ai-rewrite", "mark-fixed"]}
          storageKey="style-dedup-rhetoric"
          onAction={async (action, findingId) => {
            if (action === "ignore") {
              setIgnoredRhetoricIds((prev) => [...prev, findingId]);
            } else if (action === "mark-fixed") {
              setFixedRhetoricIds((prev) => [...prev, findingId]);
            } else if (action === "highlight") {
              const finding = dedupData?.rhetoricFindings.find((f) => f.id === findingId);
              if (finding?.examples?.[0]?.text) {
                const exampleText = finding.examples[0].text;
                const findIdx = text.indexOf(exampleText);
                if (findIdx >= 0) {
                  const textArea = document.querySelector<HTMLTextAreaElement>('textarea[placeholder*="粘贴"]');
                  if (textArea) {
                    textArea.focus();
                    textArea.selectionStart = findIdx;
                    textArea.selectionEnd = Math.min(findIdx + exampleText.length, text.length);
                    textArea.scrollTop = (findIdx / text.length) * textArea.scrollHeight;
                  }
                }
              }
            } else if (action === "ai-rewrite") {
              try {
                const { rewriteRhetoric } = await import("../../hooks/use-api.js");
                const result = await rewriteRhetoric(text, []);
                const prompt = result.prompt;
                if (prompt) {
                  setAnalyzeStatus("AI 改写建议已生成，已复制到剪贴板");
                  navigator.clipboard.writeText(prompt).catch(() => {});
                }
              } catch (e) {
                setAnalyzeStatus(`Error: 生成改写建议失败 — ${e instanceof Error ? e.message : String(e)}`);
              }
            }
          }}
        />
      )}

      {/* Empty state */}
      {dedupData && dedupData.duplicateGroups.length === 0 && dedupData.similarGroups.length === 0 && dedupData.rhetoricFindings.length === 0 && (
        <div className="text-center text-muted-foreground py-8 border border-dashed border-border/40 rounded-lg">
          <p className="text-sm">未发现需要去重或优化的内容</p>
        </div>
      )}

      {!dedupData && !loadingDedup && (
        <div className="text-center text-muted-foreground py-8 border border-dashed border-border/40 rounded-lg">
          <p className="text-sm">点击「开始检测」分析文本中的重复段落和修辞问题</p>
        </div>
      )}
    </div>
  );
}
