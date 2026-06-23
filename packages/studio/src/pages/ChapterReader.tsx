import type { DuplicateRhetoricFinding,FullStyleDiagnostics } from "@actalk/inkos-core";
import {
AlertTriangle,
BarChart3,
BookOpen,
Bug,
CheckCircle2,
ChevronDown,
Clock,
Eye,
Hash,
Info,
List,
Loader2,
Pencil,
RotateCcw,
Save,
ShieldCheck,
Type,
Wand2,
XCircle
} from "lucide-react";
import { useCallback,useState } from "react";
import { fetchJson,postApi,useApi } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import type { TFunction } from "../hooks/use-i18n";
import type { Theme } from "../hooks/use-theme";
import type { CoreStyleProfile } from "./style-types.js";

interface ChapterData {
  readonly chapterNumber: number;
  readonly filename: string;
  readonly content: string;
}

interface AuditIssue {
  readonly severity: "critical" | "warning" | "info";
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
}

interface AuditResult {
  readonly passed: boolean;
  readonly issues: ReadonlyArray<AuditIssue>;
  readonly summary: string;
  readonly overallScore?: number;
}

interface Nav {
  toBook: (id: string) => void;
  toDashboard: () => void;
}

/** Compact style analysis panel — shared between editing sidebar and reading view. */
function StyleAnalysisSidebar({ styleProfile, styleDiagnostics, rhetoricFindings, rhetoricLoading, currentText, styleLoading, styleError, onClose, onRefresh, onIssueClick, onApplyRewrite }: {
  readonly styleProfile: CoreStyleProfile | null;
  readonly styleDiagnostics: FullStyleDiagnostics | null;
  readonly rhetoricFindings: ReadonlyArray<DuplicateRhetoricFinding>;
  readonly rhetoricLoading: boolean;
  readonly currentText: string;
  readonly styleLoading: boolean;
  readonly styleError: string | null;
  readonly onClose: () => void;
  readonly onRefresh: () => void;
  readonly onIssueClick: (start: number, end: number) => void;
  readonly onApplyRewrite?: (start: number, end: number, pattern: string) => Promise<string | null>;
}) {
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showRhetoric, setShowRhetoric] = useState(false);
  const [fixingIdx, setFixingIdx] = useState<string | null>(null);
  const [fixStatus, setFixStatus] = useState<string | null>(null);

  const severityColor = (severity: string) => {
    if (severity === "high" || severity === "critical") return "text-red-500 bg-red-500/10 border-red-500/20";
    if (severity === "medium" || severity === "warning") return "text-amber-600 bg-amber-500/10 border-amber-500/20";
    return "text-sky-600 bg-sky-500/10 border-sky-500/20";
  };

  const totalDiagnosticIssues = (styleDiagnostics?.intentRepetitions?.length ?? 0)
    + (styleDiagnostics?.repeatedDescriptions?.length ?? 0)
    + (styleDiagnostics?.transitionClustering?.length ?? 0)
    + (styleDiagnostics?.clauseComplexity?.length ?? 0);

  return (
    <div className="border border-indigo-500/20 rounded-lg p-4 bg-card/50 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Wand2 size={12} />
          文风快照
        </h4>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
      </div>

      {styleLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
          <Loader2 size={12} className="animate-spin" />
          分析中…
        </div>
      )}

      {styleError && (
        <div className="text-xs text-destructive bg-destructive/5 rounded p-2">{styleError}</div>
      )}

      {styleProfile && (
        <>
          {/* Basic Stats */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="bg-secondary/30 rounded-lg p-2.5">
              <div className="text-[10px] text-muted-foreground">句长</div>
              <div className="text-lg font-bold">{styleProfile.avgSentenceLength.toFixed(1)}</div>
            </div>
            <div className="bg-secondary/30 rounded-lg p-2.5">
              <div className="text-[10px] text-muted-foreground">词汇多样性</div>
              <div className="text-lg font-bold">{(styleProfile.vocabularyDiversity * 100).toFixed(0)}%</div>
            </div>
            <div className="bg-secondary/30 rounded-lg p-2.5">
              <div className="text-[10px] text-muted-foreground">段落均长</div>
              <div className="text-lg font-bold">{styleProfile.avgParagraphLength.toFixed(0)}</div>
            </div>
            <div className="bg-secondary/30 rounded-lg p-2.5">
              <div className="text-[10px] text-muted-foreground">句长标准差</div>
              <div className="text-lg font-bold">{styleProfile.sentenceLengthStdDev.toFixed(1)}</div>
            </div>
          </div>

          {styleProfile.topPatterns.length > 0 && (
            <div>
              <h5 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">常见句式</h5>
              <div className="flex flex-wrap gap-1">
                {styleProfile.topPatterns.slice(0, 6).map((pt: string) => (
                  <span key={pt} className="px-1.5 py-0.5 text-[10px] bg-secondary rounded">{pt}</span>
                ))}
              </div>
            </div>
          )}

          {styleProfile.rhetoricalFeatures.length > 0 && (
            <div>
              <h5 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">修辞特征</h5>
              <div className="flex flex-wrap gap-1">
                {styleProfile.rhetoricalFeatures.slice(0, 6).map((rf: string) => (
                  <span key={rf} className="px-1.5 py-0.5 text-[10px] bg-primary/10 text-primary rounded">{rf}</span>
                ))}
              </div>
            </div>
          )}

          {styleProfile.fingerprint && (
            <div>
              <h5 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">风格指纹</h5>
              <div className="space-y-1.5">
                {[
                  { label: "对话占比", value: styleProfile.fingerprint.dialogueRatio, color: "bg-emerald-500" },
                  { label: "动作密度", value: styleProfile.fingerprint.actionDensity, color: "bg-amber-500" },
                  { label: "心理占比", value: styleProfile.fingerprint.psychologicalRatio, color: "bg-purple-500" },
                  { label: "修辞密度", value: styleProfile.fingerprint.rhetoricDensity, color: "bg-indigo-500" },
                  { label: "AI 风险", value: styleProfile.fingerprint.aiTellRisk, color: styleProfile.fingerprint.aiTellRisk > 0.5 ? "bg-destructive" : "bg-emerald-500" },
                ].map((item) => (
                  <div key={item.label} className="space-y-0.5">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground">{item.label}</span>
                      <span className="font-medium">{(item.value * 100).toFixed(0)}%</span>
                    </div>
                    <div className="h-1 bg-secondary rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${item.color}`} style={{ width: `${Math.min(item.value * 100, 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Risk Diagnosis Section (collapsible) */}
          {styleDiagnostics && totalDiagnosticIssues > 0 && (
            <div className="border border-amber-500/20 rounded-lg overflow-hidden">
              <button
                onClick={() => setShowDiagnostics(!showDiagnostics)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-amber-700 bg-amber-500/5 hover:bg-amber-500/10 transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <AlertTriangle size={12} />
                  风险诊断（{totalDiagnosticIssues}）
                </span>
                <ChevronDown size={12} className={`transition-transform ${showDiagnostics ? "rotate-180" : ""}`} />
              </button>
              {showDiagnostics && (
                <div className="p-2 space-y-1 max-h-60 overflow-y-auto">
                  {/* Intent Repetitions */}
                  {styleDiagnostics.intentRepetitions.map((item, idx) => {
                    const key = `ir-${idx}`;
                    const ex = item.examples?.[0];
                    return (
                    <div key={key} className="overflow-hidden flex items-center gap-1 text-[10px] py-1 px-1.5 rounded hover:bg-amber-500/10 transition-colors border border-transparent hover:border-amber-500/20 group">
                      <button
                        onClick={() => { if (ex) onIssueClick(ex.start, ex.end); }}
                        className="flex items-center gap-2 flex-1 min-w-0 text-left overflow-hidden"
                      >
                        <span className={`px-1 py-0.5 rounded border shrink-0 ${severityColor(item.severity)}`}>{item.severity}</span>
                        <span className="truncate flex-1">{item.pattern}</span>
                        <span className="text-muted-foreground shrink-0">{item.count}次</span>
                      </button>
                      <button
                        onClick={async () => {
                          if (fixingIdx) return;
                          setFixingIdx(key);
                          setFixStatus(null);
                          try {
                            const result = onApplyRewrite
                              ? await onApplyRewrite(ex?.start ?? 0, ex?.end ?? 0, item.pattern)
                              : null;
                            setFixStatus(result ? "已替换" : "无法替换");
                          } catch (e) {
                            setFixStatus(`失败: ${e instanceof Error ? e.message : String(e)}`);
                          }
                          setFixingIdx(null);
                          setTimeout(() => setFixStatus(null), 3000);
                        }}
                        disabled={fixingIdx === key}
                        className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 hover:bg-indigo-500/20 border border-indigo-500/20 shrink-0 disabled:opacity-30"
                      >
                        {fixingIdx === key ? <Loader2 size={8} className="animate-spin" /> : "修复"}
                      </button>
                      {fixStatus && fixingIdx !== key && (
                        <span className="text-[8px] text-muted-foreground shrink-0 max-w-[60px] truncate">{fixStatus}</span>
                      )}
                    </div>
                  );})}
                  {/* Repeated Descriptions */}
                  {styleDiagnostics.repeatedDescriptions.map((item, idx) => {
                    const key = `rd-${idx}`;
                    const oc = item.occurrences?.[0];
                    return (
                    <div key={key} className="overflow-hidden flex items-center gap-1 text-[10px] py-1 px-1.5 rounded hover:bg-purple-500/10 transition-colors border border-transparent hover:border-purple-500/20 group">
                      <button
                        onClick={() => { if (oc) onIssueClick(oc.start, oc.end); }}
                        className="flex items-center gap-2 flex-1 min-w-0 text-left overflow-hidden"
                      >
                        <span className={`px-1 py-0.5 rounded border shrink-0 ${severityColor(item.severity)}`}>{item.severity}</span>
                        <span className="truncate flex-1">{item.cluster}</span>
                        <span className="text-muted-foreground shrink-0">{item.occurrences.length}处</span>
                      </button>
                      <button
                        onClick={async () => {
                          if (fixingIdx) return;
                          setFixingIdx(key);
                          setFixStatus(null);
                          try {
                            const result = onApplyRewrite
                              ? await onApplyRewrite(oc?.start ?? 0, oc?.end ?? 0, item.cluster)
                              : null;
                            setFixStatus(result ? "已替换" : "无法替换");
                          } catch (e) {
                            setFixStatus(`失败: ${e instanceof Error ? e.message : String(e)}`);
                          }
                          setFixingIdx(null);
                          setTimeout(() => setFixStatus(null), 3000);
                        }}
                        disabled={fixingIdx === key}
                        className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 hover:bg-indigo-500/20 border border-indigo-500/20 shrink-0 disabled:opacity-30"
                      >
                        {fixingIdx === key ? <Loader2 size={8} className="animate-spin" /> : "修复"}
                      </button>
                    </div>
                  );})}
                  {/* Transition Clustering — highlight by searching transition word */}
                  {styleDiagnostics.transitionClustering.map((item, idx) => {
                    const word = item.transitionWord;
                    const wordPos = currentText ? currentText.indexOf(word) : -1;
                    return (
                    <div key={`tc-${idx}`} className="overflow-hidden flex items-center gap-1 text-[10px] py-1 px-1.5 rounded hover:bg-sky-500/10 transition-colors border border-transparent hover:border-sky-500/20">
                      <button
                        onClick={() => { if (wordPos >= 0) onIssueClick(wordPos, wordPos + word.length); else onIssueClick(0, 0); }}
                        className="flex items-center gap-2 flex-1 min-w-0 text-left overflow-hidden"
                      >
                        <span className={`px-1 py-0.5 rounded border shrink-0 ${severityColor(item.severity)}`}>{item.severity}</span>
                        <span className="truncate flex-1">"{item.transitionWord}" 连续{item.consecutiveTransitions}次</span>
                        <span className="text-muted-foreground shrink-0">{item.totalCount}次</span>
                      </button>
                    </div>
                  );})}
                  {/* Clause Complexity */}
                  {styleDiagnostics.clauseComplexity.map((item, idx) => {
                    const snippet = item.sentence.slice(0, 30);
                    const snipPos = currentText ? currentText.indexOf(snippet) : -1;
                    return (
                    <div key={`cc-${idx}`} className="overflow-hidden flex items-center gap-1 text-[10px] py-1 px-1.5 rounded hover:bg-rose-500/10 transition-colors border border-transparent hover:border-rose-500/20">
                      <button
                        onClick={() => { if (snipPos >= 0) onIssueClick(snipPos, snipPos + snippet.length); else onIssueClick(0, 0); }}
                        className="flex items-center gap-2 flex-1 min-w-0 text-left overflow-hidden"
                      >
                        <span className={`px-1 py-0.5 rounded border shrink-0 ${severityColor(item.severity)}`}>{item.severity}</span>
                        <span className="truncate flex-1">{item.sentence.slice(0, 40)}…</span>
                        <span className="text-muted-foreground shrink-0">{item.sentenceLength}字</span>
                      </button>
                    </div>
                  );})}
                </div>
              )}
            </div>
          )}

          {/* Rhetoric Deduplication Section (collapsible) */}
          {rhetoricFindings.length > 0 && (
            <div className="border border-purple-500/20 rounded-lg overflow-hidden">
              <button
                onClick={() => setShowRhetoric(!showRhetoric)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-purple-700 bg-purple-500/5 hover:bg-purple-500/10 transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <Bug size={12} />
                  修辞去重（{rhetoricFindings.length}）
                </span>
                <ChevronDown size={12} className={`transition-transform ${showRhetoric ? "rotate-180" : ""}`} />
              </button>
              {showRhetoric && (
                <div className="p-2 space-y-1 max-h-60 overflow-y-auto">
                  {rhetoricFindings.map((finding, idx) => {
                    // Find ALL occurrences of the example text in currentText, pick the one nearest to the middle
                    const exampleText = finding.examples?.[0]?.text;
                    let bestPos = -1;
                    if (exampleText && currentText) {
                      let searchFrom = 0;
                      let iteration = 0;
                      while (iteration < finding.count && searchFrom < currentText.length) {
                        const p = currentText.indexOf(exampleText, searchFrom);
                        if (p < 0) break;
                        if (iteration === 0) bestPos = p;
                        // Pick the occurrence closest to the middle of the text
                        const mid = currentText.length / 2;
                        if (Math.abs(p - mid) < Math.abs(bestPos - mid)) bestPos = p;
                        searchFrom = p + exampleText.length;
                        iteration++;
                      }
                    }
                    return (
                    <button
                      key={`rf-${idx}`}
                      onClick={() => {
                        if (bestPos >= 0) onIssueClick(bestPos, bestPos + (exampleText?.length ?? 0));
                        else onIssueClick(0, 0);
                      }}
                      className="w-full text-left flex items-center gap-2 text-[10px] py-1.5 px-2 rounded hover:bg-purple-500/10 transition-colors border border-transparent hover:border-purple-500/20"
                    >
                      <span className={`px-1 py-0.5 rounded border ${severityColor(finding.severity ?? "info")}`}>
                        {finding.severity ?? "info"}
                      </span>
                      <span className="truncate flex-1">{finding.label ?? finding.category}</span>
                      <span className="text-muted-foreground shrink-0">{finding.count ?? 0}次</span>
                    </button>
                  );})}
                </div>
              )}
            </div>
          )}

          {/* Refresh button */}
          <div className="flex gap-2">
            <button
              onClick={onRefresh}
              disabled={styleLoading}
              className="flex-1 text-xs px-3 py-1.5 rounded-lg bg-secondary/50 hover:bg-secondary border border-border disabled:opacity-30 flex items-center justify-center gap-1"
            >
              <BarChart3 size={10} />
              {styleLoading ? "分析中…" : "刷新分析"}
            </button>
            {rhetoricLoading && (
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Loader2 size={10} className="animate-spin" />
                检测修辞…
              </div>
            )}
          </div>
        </>
      )}

      {!styleProfile && !styleLoading && !styleError && (
        <div className="text-xs text-muted-foreground text-center py-8">
          点击工具栏的「文风」按钮分析当前文本
        </div>
      )}
    </div>
  );
}

/** Heuristic text variation for common style issues — used when AI rewrite is not available. */
function generateVariedReplacement(originalText: string, _pattern: string): string {
  if (!originalText.trim()) return originalText;

  const SYNONYM_LIB: Record<string, ReadonlyArray<string>> = {
    "转": ["扭", "侧", "偏"],
    "看": ["望", "瞧", "瞅", "瞥", "观"],
    "目光": ["视线", "眼神", "眼光", "眼波"],
    "视线": ["目光", "眼神", "视野", "眼帘"],
    "眼神": ["目光", "视线", "眼色", "神情"],
    "叹": ["吁", "呼"],
    "叹气": ["叹息", "吁气", "舒气"],
    "点头": ["颔首", "首肯"],
    "摇头": ["摆手", "晃首"],
    "但是": ["然而", "不过", "可是"],
    "然而": ["但是", "不过", "可是"],
    "所以": ["因此", "因而", "于是"],
    "于是": ["便", "就", "随即"],
    "突然": ["忽然", "猛然", "骤然"],
    "忽然": ["突然", "猛然", "蓦然"],
    "终于": ["总算", "终究", "到底"],
    "虽然": ["尽管", "虽说", "固然"],
    "因为": ["由于", "鉴于", "基于"],
  };

  for (const [key, synonyms] of Object.entries(SYNONYM_LIB)) {
    if (originalText.includes(key)) {
      const synonym = synonyms[Math.floor(Math.random() * synonyms.length)];
      return originalText.replace(key, synonym);
    }
  }

  return originalText;
}

export function ChapterReader({ bookId, chapterNumber, nav, theme, t }: {
  bookId: string;
  chapterNumber: number;
  nav: Nav;
  theme: Theme;
  t: TFunction;
}) {
  const _c = useColors(theme);
  const { data, loading, error, refetch } = useApi<ChapterData>(
    `/books/${bookId}/chapters/${chapterNumber}`,
  );
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [showAudit, setShowAudit] = useState(false);

  // Inline style analysis state
  const [showStylePanel, setShowStylePanel] = useState(false);
  const [styleProfile, setStyleProfile] = useState<CoreStyleProfile | null>(null);
  const [styleDiagnostics, setStyleDiagnostics] = useState<FullStyleDiagnostics | null>(null);
  const [rhetoricFindings, setRhetoricFindings] = useState<ReadonlyArray<DuplicateRhetoricFinding>>([]);
  const [rhetoricLoading, _setRhetoricLoading] = useState(false);
  const [styleLoading, setStyleLoading] = useState(false);
  const [styleError, setStyleError] = useState<string | null>(null);

  const handleStyleAnalysis = async () => {
    const textToAnalyze = editing ? editContent : data?.content ?? "";
    if (!textToAnalyze.trim()) return;
    setStyleLoading(true);
    setStyleError(null);
    setStyleProfile(null);
    setStyleDiagnostics(null);
    setRhetoricFindings([]);
    setShowStylePanel(true);
    try {
      const [profile, diagnostics, rhetoricResult] = await Promise.all([
        fetchJson<CoreStyleProfile>("/style/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: textToAnalyze, sourceName: `chapter-${chapterNumber}` }),
        }),
        fetchJson<FullStyleDiagnostics>("/style/diagnostics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: textToAnalyze, language: "zh" }),
        }),
        fetchJson<{ findings: ReadonlyArray<DuplicateRhetoricFinding> }>("/style/rhetoric/detect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: textToAnalyze, language: "zh" }),
        }),
      ]);
      setStyleProfile(profile);
      setStyleDiagnostics(diagnostics);
      setRhetoricFindings(Array.isArray(rhetoricResult?.findings) ? rhetoricResult.findings : []);
    } catch (e) {
      setStyleError(e instanceof Error ? e.message : String(e));
    }
    setStyleLoading(false);
  };

  /** Replacement library — maps original pattern to replacement text */
  const [replacementLib, setReplacementLib] = useState<Record<string, string>>(() => {
    try { return JSON.parse(sessionStorage.getItem("style-replacement-lib") ?? "{}"); }
    catch { return {}; }
  });

  const saveToReplacementLib = useCallback((original: string, replacement: string) => {
    setReplacementLib((prev) => {
      const next = { ...prev, [original]: replacement };
      try { sessionStorage.setItem("style-replacement-lib", JSON.stringify(next)); } catch { /* ignore storage errors */ }
      return next;
    });
  }, []);

  const handleIssueClick = useCallback((start: number, end: number) => {
    const jumpToPosition = () => {
      const textarea = document.querySelector<HTMLTextAreaElement>('textarea');
      if (!textarea) {
        // If no textarea (reading mode), try again with delay
        if (!editing && data) {
          setEditContent(data.content);
          setEditing(true);
          setTimeout(jumpToPosition, 150);
        }
        return;
      }
      textarea.focus();
      if (start > 0 || end > 0) {
        const clampedStart = Math.max(0, Math.min(start, textarea.value.length));
        const clampedEnd = Math.min(end || start + 100, textarea.value.length);
        textarea.selectionStart = clampedStart;
        textarea.selectionEnd = clampedEnd;
        // Calculate scroll position: show target line in middle of viewport
        const beforeText = textarea.value.substring(0, clampedStart);
        const lineCount = beforeText.split('\n').length;
        const lineHeight = 29;
        const viewportLines = Math.floor(textarea.clientHeight / lineHeight);
        const targetScrollLine = Math.max(0, lineCount - Math.floor(viewportLines / 2));
        textarea.scrollTop = targetScrollLine * lineHeight;
      }
    };

    jumpToPosition();
  }, [editing, data]);

  /** Apply AI rewrite: replace text directly, store in replacement library */
  const handleApplyRewrite = useCallback(async (start: number, end: number, pattern: string): Promise<string | null> => {
    const textToFix = editing ? editContent : data?.content ?? "";
    if (!textToFix || start < 0 || end > textToFix.length) {
      // Fallback: enter edit mode and select from beginning
      if (!editing && data) {
        setEditContent(data.content);
        setEditing(true);
      }
      return null;
    }

    const originalText = textToFix.substring(start, end);
    if (!originalText.trim()) return null;

    // Check replacement library first
    const cached = replacementLib[originalText];
    if (cached) {
      await doTextReplace(start, end, cached);
      return cached;
    }

    // Try API first
    try {
      const { rewriteRhetoric } = await import("../hooks/use-api.js");
      const result = await rewriteRhetoric(textToFix, [pattern]);
      if (result.prompt) {
        await navigator.clipboard.writeText(result.prompt).catch(() => {});
      }
    } catch { /* ignore API errors, fall back to heuristic */ }

    // Use heuristic replacement (always works locally)
    const replacement = generateVariedReplacement(originalText, pattern);
    await doTextReplace(start, end, replacement);
    saveToReplacementLib(originalText, replacement);
    return replacement;
  }, [editing, editContent, data, replacementLib, saveToReplacementLib]);

  const doTextReplace = useCallback(async (start: number, end: number, replacement: string) => {
    if (!editing && data) {
      setEditContent(data.content);
      setEditing(true);
      // Wait for state update + render, then apply
      await new Promise((r) => setTimeout(r, 80));
    }
    setEditContent((prev) => prev.substring(0, start) + replacement + prev.substring(end));
    // Refresh style analysis after a short delay — only when editing mode is active
    setTimeout(() => { if (editing) handleStyleAnalysis(); }, 600);
  }, [editing, data]);

  /** Apply text replacement to editContent */
  const _applyTextReplacement = useCallback((start: number, end: number, replacement: string) => {
    if (!editing) {
      // Enter edit mode first
      if (data) setEditContent(data.content);
      setEditing(true);
      setTimeout(() => {
        setEditContent((prev) => prev.substring(0, start) + replacement + prev.substring(end));
      }, 50);
    } else {
      setEditContent((prev) => prev.substring(0, start) + replacement + prev.substring(end));
    }
    // Refresh analysis after a short delay
    setTimeout(() => { handleStyleAnalysis(); }, 500);
  }, [editing, data]);


  const handleStartEdit = () => {
    if (!data) return;
    setEditContent(data.content);
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setEditContent("");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetchJson(`/books/${bookId}/chapters/${chapterNumber}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      setEditing(false);
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-32 space-y-4">
      <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
      <span className="text-sm text-muted-foreground">{t("reader.openingManuscript")}</span>
    </div>
  );

  if (error) return <div className="text-destructive p-8 bg-destructive/5 rounded-xl border border-destructive/20">Error: {error}</div>;
  if (!data) return null;

  // Split markdown content into title and body
  const lines = data.content.split("\n");
  const titleLine = lines.find((l) => l.startsWith("# "));
  const title = titleLine?.replace(/^#\s*/, "") ?? `Chapter ${chapterNumber}`;
  const body = lines
    .filter((l) => l !== titleLine)
    .join("\n")
    .trim();

  const handleApprove = async () => {
    try {
      await postApi(`/books/${bookId}/chapters/${chapterNumber}/approve`);
      nav.toBook(bookId);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Approve failed");
    }
  };

  const handleReject = async () => {
    try {
      await postApi(`/books/${bookId}/chapters/${chapterNumber}/reject`);
      nav.toBook(bookId);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Reject failed");
    }
  };

  const handleAudit = async () => {
    setAuditing(true);
    setAuditError(null);
    setAuditResult(null);
    setShowAudit(true);
    try {
      const result = await postApi<AuditResult>(`/books/${bookId}/audit/${chapterNumber}`);
      setAuditResult(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "审计失败";
      setAuditError(msg);
    } finally {
      setAuditing(false);
    }
  };

  const paragraphs = body.split(/\n\n+/).filter(Boolean);

  /** Count how many audit issues reference content likely in this paragraph */
  function paragraphIssueCount(para: string, issues: ReadonlyArray<AuditIssue>): {
    count: number;
    maxSeverity: "critical" | "warning" | "info" | null;
  } {
    let count = 0;
    let maxSeverity: "critical" | "warning" | "info" | null = null;
    const severityRank = { critical: 3, warning: 2, info: 1 };
    for (const issue of issues) {
      // Extract meaningful keywords from the issue description
      const keywords = issue.description
        .replace(/[「」""''（）()\d，。、；：！？]/g, " ")
        .split(/\s+/)
        .filter((k) => k.length >= 2 && !["一个", "这个", "那个", "什么", "怎么", "如何", "没有", "可以", "可能", "应该", "已经", "之后", "时候", "情况", "问题", "需要", "出现", "存在", "是否", "进行", "使用", "通过", "关于", "其中", "部分", "方式", "阶段", "内容", "相关", "主要", "当前", "目前", "以前", "原本", "原因", "结果", "影响", "属于"].includes(k));
      // Allow single keyword match if it's at least 4 chars (likely a name or key term)
      const longKeywords = keywords.filter((k) => k.length >= 4);
      const matchCount = keywords.filter((k) => para.includes(k)).length;
      if (matchCount >= 1) {
        count++;
        if (severityRank[issue.severity] > (maxSeverity ? severityRank[maxSeverity] : 0)) {
          maxSeverity = issue.severity;
        }
      } else if (longKeywords.some((k) => para.includes(k))) {
        count++;
        if (severityRank[issue.severity] > (maxSeverity ? severityRank[maxSeverity] : 0)) {
          maxSeverity = issue.severity;
        }
      }
    }
    return { count, maxSeverity };
  }

  return (
    <div className="mx-auto space-y-10 fade-in">
      {/* Navigation & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <nav className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
          <button
            onClick={nav.toDashboard}
            className="hover:text-primary transition-colors flex items-center gap-1"
          >
            {t("bread.books")}
          </button>
          <span className="text-border">/</span>
          <button
            onClick={() => nav.toBook(bookId)}
            className="hover:text-primary transition-colors truncate max-w-[120px]"
          >
            {bookId}
          </button>
          <span className="text-border">/</span>
          <span className="text-foreground flex items-center gap-1">
            <Hash size={12} />
            {chapterNumber}
          </span>
        </nav>

        <div className="flex gap-2">
          <button
            onClick={() => nav.toBook(bookId)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground rounded-xl hover:text-foreground hover:bg-secondary/80 transition-all border border-border/50"
          >
            <List size={14} />
            {t("reader.backToList")}
          </button>

          {/* Edit / Preview toggle */}
          {editing ? (
            <>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-primary text-primary-foreground rounded-xl hover:scale-105 active:scale-95 transition-all shadow-sm disabled:opacity-50"
              >
                {saving ? <div className="w-3.5 h-3.5 border-2 border-primary-foreground/20 border-t-primary-foreground rounded-full animate-spin" /> : <Save size={14} />}
                {saving ? t("book.saving") : t("book.save")}
              </button>
              <button
                onClick={handleCancelEdit}
                className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground rounded-xl hover:text-foreground transition-all border border-border/50"
              >
                <Eye size={14} />
                {t("reader.preview")}
              </button>
            </>
          ) : (
            <button
              onClick={handleStartEdit}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground rounded-xl hover:text-primary hover:bg-primary/10 transition-all border border-border/50"
            >
              <Pencil size={14} />
              {t("reader.edit")}
            </button>
          )}

          <button
            onClick={handleApprove}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-emerald-500/10 text-emerald-600 rounded-xl hover:bg-emerald-500 hover:text-white transition-all border border-emerald-500/20 shadow-sm"
          >
            <CheckCircle2 size={14} />
            {t("reader.approve")}
          </button>
          <button
            onClick={handleReject}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-destructive/10 text-destructive rounded-xl hover:bg-destructive hover:text-white transition-all border border-destructive/20 shadow-sm"
          >
            <XCircle size={14} />
            {t("reader.reject")}
          </button>
          <button
            onClick={handleAudit}
            disabled={auditing}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-amber-500/10 text-amber-600 rounded-xl hover:bg-amber-500 hover:text-white transition-all border border-amber-500/20 shadow-sm disabled:opacity-50"
          >
            {auditing ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            {auditing ? "审计中…" : "审计"}
          </button>
          <button
            onClick={handleStyleAnalysis}
            disabled={styleLoading}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition-all border shadow-sm disabled:opacity-50 ${
              showStylePanel
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-indigo-500/10 text-indigo-600 border-indigo-500/20 hover:bg-indigo-500 hover:text-white"
            }`}
          >
            {styleLoading ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            文风
          </button>
        </div>
      </div>

      {/* Manuscript Sheet */}
      <div className="paper-sheet rounded-2xl p-8 md:p-16 lg:p-24 shadow-2xl shadow-primary/5 min-h-[80vh] relative overflow-hidden">
        {/* Physical Paper Details */}
        <div className="absolute top-0 left-8 w-px h-full bg-primary/5 hidden md:block" />
        <div className="absolute top-0 right-8 w-px h-full bg-primary/5 hidden md:block" />

        <header className="mb-16 text-center">
          <div className="flex items-center justify-center gap-2 text-muted-foreground/30 mb-8 select-none">
            <div className="h-px w-12 bg-border/40" />
            <BookOpen size={20} />
            <div className="h-px w-12 bg-border/40" />
          </div>
          <h1 className="text-4xl md:text-5xl font-serif font-medium italic text-foreground tracking-tight leading-tight">
            {title}
          </h1>
          <div className="mt-8 flex items-center justify-center gap-4 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
            <span>{t("reader.manuscriptPage")}</span>
            <span className="text-border">·</span>
            <span>{chapterNumber.toString().padStart(2, '0')}</span>
          </div>
        </header>

        {editing ? (
          <div className="flex gap-4">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className={`bg-transparent font-serif text-lg leading-[1.8] text-foreground/90 focus:outline-none resize-none border border-border/30 rounded-lg p-6 focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all ${
                showStylePanel ? "w-4/5" : "w-full"
              }`}
              style={{ minHeight: "60vh" }}
              autoFocus
            />

            {/* Inline Style Panel (editing mode — side by side) */}
            {showStylePanel && editing && (
              <StyleAnalysisSidebar
                styleProfile={styleProfile}
                styleDiagnostics={styleDiagnostics}
                rhetoricFindings={rhetoricFindings}
                rhetoricLoading={rhetoricLoading}
                currentText={editing ? editContent : data?.content ?? ""}
                styleLoading={styleLoading}
                styleError={styleError}
                onClose={() => setShowStylePanel(false)}
                onRefresh={handleStyleAnalysis}
                onIssueClick={handleIssueClick}
                onApplyRewrite={handleApplyRewrite}
              />
            )}
          </div>
        ) : (
          <article className="prose prose-zinc dark:prose-invert max-w-none">
            {paragraphs.map((para, i) => {
              const { count: issueCount, maxSeverity } = auditResult && showAudit
                ? paragraphIssueCount(para, auditResult.issues)
                : { count: 0, maxSeverity: null };
              let borderClass = "";
              let bgClass = "";
              if (issueCount > 0 && maxSeverity) {
                if (maxSeverity === "critical") {
                  borderClass = "border-l-4 border-red-400";
                  bgClass = "bg-red-50/50 dark:bg-red-950/20";
                } else if (maxSeverity === "warning") {
                  borderClass = "border-l-4 border-amber-400";
                  bgClass = "bg-amber-50/50 dark:bg-amber-950/20";
                } else {
                  borderClass = "border-l-4 border-blue-300";
                  bgClass = "bg-blue-50/30 dark:bg-blue-950/10";
                }
              }
              return (
                <div key={i} className={`${borderClass} ${bgClass} rounded-r-lg pl-4 pr-2 py-1 mb-8 transition-colors relative`}>
                  {issueCount > 0 && (
                    <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-amber-400 shadow-sm" title={`${issueCount} 个相关问题`} />
                  )}
                  <p className="font-serif text-lg md:text-xl leading-[1.8] text-foreground/90">
                    {para}
                  </p>
                </div>
              );
            })}
          </article>
        )}

        <footer className="mt-24 pt-12 border-t border-border/20 flex flex-col items-center gap-6 text-center">
          <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground">
             <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary/50">
               <Type size={14} className="text-primary/60" />
               <span>{body.length.toLocaleString()} {t("reader.characters")}</span>
             </div>
             <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary/50">
               <Clock size={14} className="text-primary/60" />
               <span>{Math.ceil(body.length / 500)} {t("reader.minRead")}</span>
             </div>
          </div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground/40 font-bold">{t("reader.endOfChapter")}</p>
        </footer>

        {/* Audit Results (below chapter text) */}
        {showAudit && (
          <div className="mt-8 pt-8 border-t border-amber-200 dark:border-amber-800 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <ShieldCheck size={16} className="text-amber-600" />
                审计结果
              </h3>
              <button onClick={() => setShowAudit(false)} className="text-xs text-muted-foreground hover:text-foreground">关闭</button>
            </div>

            {auditing && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground py-4">
                <Loader2 size={16} className="animate-spin" />
                正在审计本章…
              </div>
            )}

            {auditError && (
              <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/20 rounded-lg p-4 border border-red-200 dark:border-red-800">
                <div className="font-medium mb-1">审计失败</div>
                <div className="text-red-500/80 text-xs">{auditError}</div>
                <div className="mt-2 text-xs text-muted-foreground/70">
                  请确保已在「审计」页面中正确配置审计服务、模型和 API Key。
                </div>
              </div>
            )}

            {auditResult && (
              <>
                <div className="flex items-center gap-3">
                  <div className={`text-xs font-bold px-3 py-1.5 rounded-full ${
                    auditResult.passed
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                      : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  }`}>
                    {auditResult.passed ? "✅ 通过" : "❌ 未通过"}
                  </div>
                  {auditResult.overallScore != null && (
                    <span className="text-xs text-muted-foreground">
                      评分: <strong>{auditResult.overallScore}</strong>/100
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {auditResult.issues.length} 个问题
                  </span>
                </div>

                {auditResult.issues.length > 0 && (
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {auditResult.issues.map((issue, i) => (
                      <div key={i} className={`p-3 rounded-lg text-sm border ${
                        issue.severity === "critical"
                          ? "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800"
                          : issue.severity === "warning"
                            ? "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800"
                            : "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800"
                      }`}>
                        <div className="flex items-center gap-1.5 mb-1">
                          {issue.severity === "critical" ? (
                            <XCircle size={12} className="text-red-500" />
                          ) : issue.severity === "warning" ? (
                            <AlertTriangle size={12} className="text-amber-500" />
                          ) : (
                            <Info size={12} className="text-blue-500" />
                          )}
                          <span className="font-medium text-xs uppercase tracking-wider">{issue.category}</span>
                          <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            issue.severity === "critical"
                              ? "bg-red-100 text-red-700 dark:bg-red-900/30"
                              : issue.severity === "warning"
                                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30"
                                : "bg-blue-100 text-blue-700 dark:bg-blue-900/30"
                          }`}>
                            {issue.severity === "critical" ? "严重" : issue.severity === "warning" ? "警告" : "提示"}
                          </span>
                        </div>
                        <p className="text-muted-foreground">{issue.description}</p>
                        {issue.suggestion && (
                          <p className="text-xs text-muted-foreground/70 mt-1 italic">
                            建议: {issue.suggestion}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="text-xs text-muted-foreground/60 italic">
                  {auditResult.summary}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Inline Style Panel (non-editing mode — below manuscript) */}
      {showStylePanel && !editing && (
        <div className="mt-8 pt-8 border-t border-indigo-200 dark:border-indigo-800">
          <StyleAnalysisSidebar
            styleProfile={styleProfile}
            styleDiagnostics={styleDiagnostics}
            rhetoricFindings={rhetoricFindings}
            rhetoricLoading={rhetoricLoading}
            currentText={data?.content ?? ""}
            styleLoading={styleLoading}
            styleError={styleError}
            onClose={() => setShowStylePanel(false)}
            onRefresh={handleStyleAnalysis}
            onIssueClick={handleIssueClick}
            onApplyRewrite={handleApplyRewrite}
          />
        </div>
      )}

      {/* Footer Navigation */}
      <div className="flex justify-between items-center py-8">
        {chapterNumber > 1 ? (
          <button
            onClick={() => nav.toBook(bookId)}
            className="flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-primary transition-all group"
          >
            <RotateCcw size={16} className="group-hover:-rotate-45 transition-transform" />
            {t("reader.chapterList")}
          </button>
        ) : (
          <div />
        )}
      </div>
    </div>
  );
}
