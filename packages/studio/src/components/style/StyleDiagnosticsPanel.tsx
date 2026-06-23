import type { FullStyleDiagnostics } from "@actalk/inkos-core";
import { AlertTriangle,ChevronDown,ChevronUp,FileText,Hash,Save,Shield,ShieldAlert,ShieldCheck } from "lucide-react";
import { useState } from "react";
import { fetchJson } from "../../hooks/use-api";
import type { TFunction } from "../../hooks/use-i18n";

interface AuthorItem {
  readonly id: string;
  readonly name: string;
}

function severityBadge(severity: "high" | "medium" | "low") {
  const map = {
    high: "bg-destructive/10 text-destructive border-destructive/20",
    medium: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    low: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  };
  return map[severity];
}

function severityIcon(severity: "high" | "medium" | "low") {
  if (severity === "high") return <ShieldAlert size={14} className="text-destructive" />;
  if (severity === "medium") return <Shield size={14} className="text-amber-500" />;
  return <ShieldCheck size={14} className="text-sky-500" />;
}

function tagSeverityClass(severity: "critical" | "warning" | "info") {
  const map = {
    critical: "bg-destructive/10 text-destructive border-destructive/20",
    warning: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    info: "bg-secondary text-muted-foreground border-border",
  };
  return map[severity];
}

interface Props {
  readonly diagnostics: FullStyleDiagnostics;
  readonly authors?: ReadonlyArray<AuthorItem>;
  readonly t?: TFunction;
  readonly text?: string;
}

export function StyleDiagnosticsPanel({ diagnostics, authors, t, text }: Props) {
  const _t = t ?? ((key: string) => key);
  const [showClauseDetails, setShowClauseDetails] = useState(false);
  const [showTransitionDetails, setShowTransitionDetails] = useState(false);
  const [showDescriptionDetails, setShowDescriptionDetails] = useState(false);
  const [showRiskAnnotations, setShowRiskAnnotations] = useState(false);
  const [selectedAuthorId, setSelectedAuthorId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");

  const handleSave = async () => {
    if (!selectedAuthorId) return;
    setSaving(true);
    setSaveStatus("");
    try {
      await fetchJson(`/style/authors/${selectedAuthorId}/diagnostics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: diagnostics }),
      });
      setSaveStatus("已保存");
    } catch (e) {
      setSaveStatus(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
    }
    setSaving(false);
  };

  const { aiStyleTags, intentRepetitions, repeatedDescriptions, transitionClustering, clauseComplexity } = diagnostics;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Hash size={12} />
          <span className="font-mono">{diagnostics.sourceHash}</span>
          <span className="text-border">|</span>
          <span>v{diagnostics.ruleVersion}</span>
        </div>
        <div className="flex items-center gap-2">
          {authors && authors.length > 0 && (
            <>
              <select
                value={selectedAuthorId}
                onChange={(e) => setSelectedAuthorId(e.target.value)}
                className="text-xs px-2 py-0.5 rounded bg-secondary/30 border border-border"
              >
                <option value="">保存到作者…</option>
                {authors.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              <button
                onClick={handleSave}
                disabled={!selectedAuthorId || saving}
                className="text-xs px-2 py-0.5 rounded bg-primary text-primary-foreground disabled:opacity-30 flex items-center gap-1"
              >
                <Save size={10} />
                {saving ? "保存中" : "保存"}
              </button>
            </>
          )}
          <span className={`text-xs px-2 py-0.5 rounded border ${
            diagnostics.sampleAdequacy === "sufficient"
              ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
              : diagnostics.sampleAdequacy === "limited"
                ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                : "bg-destructive/10 text-destructive border-destructive/20"
          }`}>
            {diagnostics.sampleAdequacy}
          </span>
        </div>
      </div>
      {saveStatus && (
        <div className={`text-xs ${saveStatus.startsWith("保存失败") ? "text-destructive" : "text-emerald-600"}`}>
          {saveStatus}
        </div>
      )}

      {/* AI Style Risk Overview */}
      <div className="border rounded-lg p-4 space-y-3 bg-card/50">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-500" />
          <h3 className="font-semibold text-sm">AI 风格启发式风险</h3>
        </div>
        <div className="flex items-end gap-3">
          <div className="text-3xl font-bold tabular-nums">{aiStyleTags.heuristicRiskScore}</div>
          <div className="text-sm text-muted-foreground mb-1">/ 100</div>
          <div className="flex-1 h-3 bg-secondary rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                aiStyleTags.heuristicRiskScore >= 60
                  ? "bg-destructive"
                  : aiStyleTags.heuristicRiskScore >= 30
                    ? "bg-amber-500"
                    : "bg-emerald-500"
              }`}
              style={{ width: `${Math.min(100, aiStyleTags.heuristicRiskScore)}%` }}
            />
          </div>
        </div>
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span>置信度: {(aiStyleTags.confidence * 100).toFixed(0)}%</span>
          <span>段落均匀度: {(aiStyleTags.paragraphUniformity * 100).toFixed(0)}%</span>
        </div>
        {aiStyleTags.breakdown.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {aiStyleTags.breakdown.map((item) => (
              <span
                key={item.tag}
                className={`text-[10px] px-1.5 py-0.5 rounded border ${tagSeverityClass(item.severity)}`}
                title={`${item.tag}: ${item.count}`}
              >
                {item.tag} {item.count}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Original Text Risk Annotations — link diagnostics to actual text */}
      {text && text.trim() && (
        <div className="border rounded-lg p-4 space-y-3">
          <button
            className="w-full flex items-center justify-between font-semibold text-sm"
            onClick={() => setShowRiskAnnotations((v) => !v)}
          >
            <span className="flex items-center gap-2">
              <FileText size={14} className="text-muted-foreground" />
              原文风险标注
            </span>
            {showRiskAnnotations ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {showRiskAnnotations && text && (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {/* Intent repetition examples with exact position snippets */}
              {intentRepetitions.filter((r) => r.examples?.length > 0).length > 0 && (
                <div className="space-y-1">
                  <h4 className="text-xs font-medium text-muted-foreground">高频重复 — 原文片段</h4>
                  {intentRepetitions.filter((r) => r.examples?.length > 0).slice(0, 5).map((item, ri) => (
                    <div key={`ir-${ri}`} className="flex flex-col gap-1 text-xs bg-amber-500/5 rounded px-2 py-1.5 border border-amber-500/10">
                      <div className="flex items-center gap-2">
                        <AlertTriangle size={10} className="text-amber-500 shrink-0" />
                        <span className="font-medium truncate">"{item.pattern}"</span>
                        <span className="text-muted-foreground shrink-0">×{item.count}</span>
                      </div>
                      {item.examples.slice(0, 2).map((ex, ei) => (
                        <div key={ei} className="font-mono text-[10px] pl-4 text-muted-foreground truncate border-l-2 border-amber-500/30 ml-1">
                          {text.slice(Math.max(0, ex.start), Math.min(text.length, ex.end)) || ex.sentence}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {/* Repeated description occurrences with position data */}
              {repeatedDescriptions.filter((r) => r.occurrences?.length > 0).length > 0 && (
                <div className="space-y-1">
                  <h4 className="text-xs font-medium text-muted-foreground">重复描写 — 原文位置</h4>
                  {repeatedDescriptions.filter((r) => r.occurrences?.length > 0).slice(0, 3).map((item, ri) => (
                    <div key={`rd-${ri}`} className="flex flex-col gap-1 text-xs bg-purple-500/5 rounded px-2 py-1.5 border border-purple-500/10">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{item.cluster}</span>
                        <span className="text-muted-foreground shrink-0">×{item.occurrences.length}</span>
                      </div>
                      {item.occurrences.slice(0, 2).map((occ, oi) => (
                        <div key={oi} className="font-mono text-[10px] pl-4 text-muted-foreground truncate border-l-2 border-purple-500/30 ml-1">
                          {text.slice(Math.max(0, occ.start), Math.min(text.length, occ.end))}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {/* Transition clustering with position */}
              {transitionClustering.length > 0 && (
                <div className="space-y-1">
                  <h4 className="text-xs font-medium text-muted-foreground">过渡词密集区</h4>
                  {transitionClustering.slice(0, 3).map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs text-purple-600 bg-purple-500/5 rounded px-2 py-1">
                      <span className="font-mono">"{item.transitionWord}"</span>
                      <span>连续 {item.consecutiveTransitions} 次 · 共 {item.totalCount} 次</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Complex sentence snippets */}
              {clauseComplexity.length > 0 && (
                <div className="space-y-1">
                  <h4 className="text-xs font-medium text-muted-foreground">复杂句式</h4>
                  {clauseComplexity.slice(0, 3).map((item, idx) => (
                    <div key={idx} className="text-xs text-rose-600 bg-rose-500/5 rounded px-2 py-1 font-mono truncate">
                      {item.sentence}
                    </div>
                  ))}
                </div>
              )}

              {intentRepetitions.filter((r) => r.examples?.length > 0).length === 0 &&
                repeatedDescriptions.filter((r) => r.occurrences?.length > 0).length === 0 &&
                transitionClustering.length === 0 &&
                clauseComplexity.length === 0 && (
                <div className="text-xs text-muted-foreground">诊断结果中未发现需要特别标注的风险项</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Intent Repetitions */}
      {intentRepetitions.length > 0 && (
        <div className="border rounded-lg p-4 space-y-3">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            意图重复 ({intentRepetitions.length})
          </h3>
          <div className="space-y-2">
            {intentRepetitions.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between text-sm py-1.5 border-b border-border/30 last:border-0">
                <div className="flex items-center gap-2 min-w-0">
                  {severityIcon(item.severity)}
                  <span className="truncate">{item.pattern}</span>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">{item.kind === "action-expression" ? "动作" : "语义"}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-muted-foreground">{item.count} 次</span>
                  <span className="text-xs text-muted-foreground">{item.perThousandChars}/千字符</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${severityBadge(item.severity)}`}>
                    {item.severity}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Repeated Descriptions */}
      {repeatedDescriptions.length > 0 && (
        <div className="border rounded-lg p-4 space-y-3">
          <button
            className="w-full flex items-center justify-between font-semibold text-sm"
            onClick={() => setShowDescriptionDetails((v) => !v)}
          >
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
              重复描写 ({repeatedDescriptions.length})
            </span>
            {showDescriptionDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {showDescriptionDetails && (
            <div className="space-y-2">
              {repeatedDescriptions.map((item, idx) => (
                <div key={idx} className="text-sm py-1.5 border-b border-border/30 last:border-0">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{item.cluster}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${severityBadge(item.severity)}`}>
                      {item.severity}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    匹配 {item.occurrences.length} 次 · 密度 {item.density} · 相似度 {(item.similarity * 100).toFixed(0)}%
                  </div>
                  {item.matchedPhrases.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {item.matchedPhrases.map((phrase, i) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground truncate max-w-[200px]">
                          {phrase}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Transition Clustering */}
      {transitionClustering.length > 0 && (
        <div className="border rounded-lg p-4 space-y-3">
          <button
            className="w-full flex items-center justify-between font-semibold text-sm"
            onClick={() => setShowTransitionDetails((v) => !v)}
          >
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              过渡词聚集 ({transitionClustering.length})
            </span>
            {showTransitionDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {showTransitionDetails && (
            <div className="space-y-2">
              {transitionClustering.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm py-1.5 border-b border-border/30 last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    {severityIcon(item.severity)}
                    <span className="truncate">{item.transitionWord}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
                    <span>{item.totalCount} 次</span>
                    <span>{item.paragraphsWithTransition} 段</span>
                    <span>连续 {item.consecutiveTransitions}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${severityBadge(item.severity)}`}>
                      {item.severity}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Clause Complexity */}
      {clauseComplexity.length > 0 && (
        <div className="border rounded-lg p-4 space-y-3">
          <button
            className="w-full flex items-center justify-between font-semibold text-sm"
            onClick={() => setShowClauseDetails((v) => !v)}
          >
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              复杂句式 ({clauseComplexity.length})
            </span>
            {showClauseDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {showClauseDetails && (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {clauseComplexity.map((item, idx) => (
                <div key={idx} className="text-sm py-1.5 border-b border-border/30 last:border-0">
                  <div className="flex items-center justify-between">
                    <span className="truncate max-w-[70%] text-muted-foreground font-mono text-xs">{item.sentence}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${severityBadge(item.severity)}`}>
                      {item.severity}
                    </span>
                  </div>
                  <div className="flex gap-3 text-[10px] text-muted-foreground mt-0.5">
                    <span>{item.sentenceLength} 字</span>
                    <span>分隔符 {item.separatorCount}</span>
                    <span>连接词 {item.connectiveCount}</span>
                    <span>估计从句 {item.estimatedClauseCount}</span>
                    {item.hasNestedClause && <span className="text-amber-600">嵌套</span>}
                    {item.maxAttributeChain > 0 && <span>修饰链 {item.maxAttributeChain}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {intentRepetitions.length === 0 &&
        repeatedDescriptions.length === 0 &&
        transitionClustering.length === 0 &&
        clauseComplexity.length === 0 && (
        <div className="text-center text-sm text-muted-foreground py-8">
          未发现明显风格问题
        </div>
      )}
    </div>
  );
}
