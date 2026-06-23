import { AlertTriangle,Bug,FileText,Info,Loader2,Search } from "lucide-react";
import { useEffect,useRef,useState } from "react";
import { fetchJson } from "../../hooks/use-api";

interface AITellIssue {
  readonly severity: "warning" | "info";
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
}

interface AITellResult {
  readonly issues: ReadonlyArray<AITellIssue>;
}

interface Props {
  readonly t: (key: string) => string;
  readonly initialText?: string;
  readonly language?: "zh" | "en";
}

function severityIcon(severity: "warning" | "info") {
  if (severity === "warning") return <AlertTriangle size={14} className="text-amber-500" />;
  return <Info size={14} className="text-sky-500" />;
}

function severityBorder(severity: "warning" | "info") {
  return severity === "warning"
    ? "border-amber-500/20 bg-amber-500/5"
    : "border-sky-500/20 bg-sky-500/5";
}

/** Shared detection logic — used by both auto and manual triggers. */
async function runDetection(
  text: string,
  language: "zh" | "en",
  signal?: AbortSignal,
): Promise<AITellResult> {
  return fetchJson<AITellResult>("/style/ai-tells", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, language }),
    signal,
  });
}

export function AITellsPanel({ t: _t, initialText, language = "zh" }: Props) {
  const [text, setText] = useState(initialText ?? "");
  const [result, setResult] = useState<AITellResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Cancel any in-flight request
  const cancel = useRef(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  });

  // Auto-detect with debounce — fires only when initialText stabilizes
  useEffect(() => {
    if (!initialText?.trim()) return;
    setText(initialText);

    const debounceTimer = setTimeout(async () => {
      cancel.current();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);
      setResult(null);
      try {
        const data = await runDetection(initialText, language, controller.signal);
        if (!controller.signal.aborted) {
          setResult(data);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }, 400);

    return () => {
      clearTimeout(debounceTimer);
      cancel.current();
    };
  }, [initialText, language]);

  const handleAnalyze = async () => {
    if (!text.trim()) return;
    cancel.current();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await runDetection(text, language, controller.signal);
      if (!controller.signal.aborted) {
        setResult(data);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (!controller.signal.aborted) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    if (!controller.signal.aborted) {
      setLoading(false);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => cancel.current();
  }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Bug size={16} className="text-amber-500" />
        <h3 className="font-semibold text-sm">AI 痕迹检测</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        检测文本中常见的 AI 生成特征：段落等长、套话密度、公式化转折、列表式结构。
      </p>

      {/* Input */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder="粘贴需要检测的文本..."
        className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm focus:outline-none focus:border-primary resize-none font-mono"
      />
      <button
        onClick={() => void handleAnalyze()}
        disabled={!text.trim() || loading}
        className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground disabled:opacity-30 hover:opacity-90"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
        {loading ? "检测中..." : "检测 AI 痕迹"}
      </button>

      {/* Error */}
      {error && (
        <div className="border border-destructive/30 rounded-lg p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">检测结果</span>
            <span className="text-xs text-muted-foreground">
              发现 {result.issues.length} 个问题
            </span>
          </div>

          {result.issues.length === 0 && (
            <div className="border border-emerald-500/20 bg-emerald-500/5 rounded-lg p-4 text-center text-sm text-emerald-600">
              未检测到明显 AI 生成特征
            </div>
          )}

          {result.issues.map((issue, idx) => (
            <div
              key={idx}
              className={`border rounded-lg p-4 space-y-2 ${severityBorder(issue.severity)}`}
            >
              <div className="flex items-center gap-2">
                {severityIcon(issue.severity)}
                <span className="text-sm font-medium">{issue.category}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                  issue.severity === "warning"
                    ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                    : "bg-sky-500/10 text-sky-600 border-sky-500/20"
                }`}>
                  {issue.severity === "warning" ? "警告" : "提示"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{issue.description}</p>
              <div className="flex items-start gap-1.5 text-xs text-emerald-600 bg-emerald-500/5 rounded p-2">
                <span className="font-medium shrink-0">建议:</span>
                <span>{issue.suggestion}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && !error && (
        <div className="text-center text-xs text-muted-foreground py-8 border border-dashed border-border rounded-lg">
          <FileText size={24} className="mx-auto mb-2 opacity-40" />
          输入文本后点击检测
        </div>
      )}
    </div>
  );
}
