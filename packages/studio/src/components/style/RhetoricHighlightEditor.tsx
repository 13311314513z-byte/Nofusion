/**
 * Rhetoric Highlight Editor — inline rhetoric feature highlighting
 * and editing component.
 *
 * Allows users to see detected rhetorical features (parallelism,
 * metaphor, repetition, etc.) highlighted inline in their text, and
 * optionally rewrite problematic passages.
 *
 * @module
 */

import { AlertCircle,Highlighter,RefreshCw,X } from "lucide-react";
import { useMemo,useState } from "react";
import { fetchJson } from "../../hooks/use-api";

interface RhetoricFinding {
  readonly type: string;
  readonly text: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly severity: "low" | "medium" | "high";
  readonly suggestion?: string;
}

interface RhetoricHighlightEditorProps {
  readonly text: string;
  readonly onTextChange: (newText: string) => void;
  readonly bookId?: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-amber-100/40 dark:bg-amber-900/10 border-amber-500/30",
  medium: "bg-orange-100/40 dark:bg-orange-900/10 border-orange-500/30",
  high: "bg-red-100/40 dark:bg-red-900/10 border-red-500/30",
};

const TYPE_LABELS: Record<string, string> = {
  "duplicate-parallelism": "排比",
  "duplicate-metaphor": "比喻",
  "duplicate-personification": "拟人",
  "duplicate-repetition": "重复",
  "duplicate-transition": "转折聚集",
  "duplicate-hyperbole": "夸张",
  "duplicate-rhetorical-question": "反问",
  "duplicate-anaphora": "首语重复",
  "duplicate-epistrophe": "尾语重复",
  "duplicate-parallel-structure": "并列结构",
};

export function RhetoricHighlightEditor({
  text,
  onTextChange: _onTextChange,
  bookId: _bookId,
}: RhetoricHighlightEditorProps) {
  const [findings, setFindings] = useState<ReadonlyArray<RhetoricFinding>>([]);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFinding, setSelectedFinding] = useState<RhetoricFinding | null>(null);

  const handleDetect = async () => {
    if (!text.trim()) return;
    setDetecting(true);
    setError(null);
    try {
      const data = await fetchJson<{ findings: ReadonlyArray<RhetoricFinding> }>(
        "/style/rhetoric/detect",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        },
      );
      setFindings(data.findings ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "检测失败");
    } finally {
      setDetecting(false);
    }
  };

  // Build highlighted text segments
  const segments = useMemo(() => {
    if (findings.length === 0) return [{ text, type: "clean" as const }];

    // Sort findings by startIndex
    const sorted = [...findings].sort((a, b) => a.startIndex - b.startIndex);
    const segs: Array<{ text: string; type: "clean" | "highlight"; finding?: RhetoricFinding }> = [];
    let cursor = 0;

    for (const f of sorted) {
      if (f.startIndex > cursor) {
        segs.push({ text: text.slice(cursor, f.startIndex), type: "clean" });
      }
      segs.push({
        text: text.slice(f.startIndex, f.endIndex),
        type: "highlight",
        finding: f,
      });
      cursor = f.endIndex;
    }
    if (cursor < text.length) {
      segs.push({ text: text.slice(cursor), type: "clean" });
    }
    return segs;
  }, [text, findings]);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Highlighter size={14} />
          修辞高亮编辑器
        </div>
        <button
          onClick={handleDetect}
          disabled={detecting || !text.trim()}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-violet-100 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400 hover:opacity-90 disabled:opacity-50"
        >
          {detecting ? <RefreshCw size={11} className="animate-spin" /> : <Highlighter size={11} />}
          {detecting ? "检测中..." : "检测修辞"}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* Highlighted text area */}
      <div className="border border-border/30 rounded-xl p-4 bg-card/40 min-h-[200px] max-h-[500px] overflow-y-auto">
        {findings.length === 0 ? (
          <div className="text-xs leading-relaxed whitespace-pre-wrap font-sans text-muted-foreground">
            {text || "输入文本后点击「检测修辞」"}
          </div>
        ) : (
          <p className="text-xs leading-relaxed whitespace-pre-wrap font-sans">
            {segments.map((seg, i) =>
              seg.type === "clean" ? (
                <span key={i}>{seg.text}</span>
              ) : (
                <span
                  key={i}
                  className={`border-b-2 cursor-pointer ${SEVERITY_COLORS[seg.finding?.severity ?? "low"]}`}
                  onClick={() => seg.finding && setSelectedFinding(seg.finding)}
                  title={`${TYPE_LABELS[seg.finding?.type ?? ""] ?? seg.finding?.type}: ${seg.finding?.suggestion ?? ""}`}
                >
                  {seg.text}
                </span>
              ),
            )}
          </p>
        )}
      </div>

      {/* Findings summary */}
      {findings.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            发现 {findings.length} 处修辞特征
          </div>
          <div className="flex flex-wrap gap-1.5">
            {findings.map((f, i) => (
              <button
                key={i}
                onClick={() => setSelectedFinding(f)}
                className={`px-2 py-1 text-[11px] rounded-md border ${SEVERITY_COLORS[f.severity]} hover:opacity-80`}
              >
                {TYPE_LABELS[f.type] ?? f.type}: {f.text.slice(0, 15)}…
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Selected finding detail */}
      {selectedFinding && (
        <div className="border border-border/30 rounded-lg p-3 bg-card/40">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className={`px-1.5 py-0.5 text-[10px] rounded ${SEVERITY_COLORS[selectedFinding.severity]}`}>
                {selectedFinding.severity}
              </span>
              <span className="text-xs font-medium">
                {TYPE_LABELS[selectedFinding.type] ?? selectedFinding.type}
              </span>
            </div>
            <button onClick={() => setSelectedFinding(null)} className="p-1 rounded hover:bg-secondary/50">
              <X size={12} />
            </button>
          </div>
          <pre className="text-xs text-muted-foreground mb-2">{selectedFinding.text}</pre>
          {selectedFinding.suggestion && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              建议: {selectedFinding.suggestion}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
