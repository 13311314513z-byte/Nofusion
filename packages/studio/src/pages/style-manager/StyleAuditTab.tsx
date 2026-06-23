import { FileText,Plus,RefreshCw,Trash2,Upload } from "lucide-react";
import { useCallback,useState,type ChangeEvent } from "react";
import { fetchJson,postApi } from "../../hooks/use-api";
import type { TFunction } from "../../hooks/use-i18n";
import type { AuthorDetail,AuthorIndexItem,BookSummary } from "../style-types.js";
import { buildLocalStyleSourceId,inferLocalStyleFileType,readLocalTextFile } from "../StyleManager.js";
import { AdjustmentSuggestionsPanel } from "./AdjustmentSuggestionsPanel.js";
import { AuthorStyleComparison } from "./AuthorStyleComparison.js";

interface StyleAuditTabProps {
  readonly text: string;
  readonly setText: (v: string) => void;
  readonly profile: import("../style-types.js").CoreStyleProfile | null;
  readonly setProfile: (v: import("../style-types.js").CoreStyleProfile | null) => void;
  readonly diagnostics: import("@actalk/inkos-core").FullStyleDiagnostics | null;
  readonly setDiagnostics: (v: import("@actalk/inkos-core").FullStyleDiagnostics | null) => void;
  readonly libraryData: { authors: ReadonlyArray<AuthorIndexItem> } | undefined | null;
  readonly refetchLibrary: () => void;
  readonly booksData: { books: ReadonlyArray<BookSummary> } | undefined | null;
  readonly c: Record<string, string>;
  readonly t: TFunction;
  readonly setAnalyzeStatus: (v: string) => void;
  readonly handleAnalyze: () => void;
  readonly handleDiagnostics: () => void;
  readonly authorSampleInputRef: React.RefObject<HTMLInputElement | null>;
  readonly loading: boolean;
}

export function StyleAuditTab({
  text,
  setText,
  profile: _profile,
  setProfile,
  diagnostics,
  setDiagnostics,
  libraryData,
  refetchLibrary,
  booksData,
  c,
  t,
  setAnalyzeStatus,
  handleAnalyze,
  handleDiagnostics,
  authorSampleInputRef,
  loading,
}: StyleAuditTabProps) {
  const [activeAuditSection, setActiveAuditSection] = useState<"library" | "apply">("library");
  const [selectedAuthorId, setSelectedAuthorId] = useState<string>("");
  const [authorDetail, setAuthorDetail] = useState<AuthorDetail | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newAuthorId, setNewAuthorId] = useState("");
  const [newAuthorName, setNewAuthorName] = useState("");
  const [newAuthorTags, setNewAuthorTags] = useState("");
  const [reanalyzing, setReanalyzing] = useState(false);
  const [applyAuthorId, setApplyAuthorId] = useState("");
  const [applyBookId, setApplyBookId] = useState("");
  const [applyStatus, setApplyStatus] = useState("");

  const loadAuthorDetail = useCallback(async (authorId: string) => {
    if (!authorId) { setAuthorDetail(null); return; }
    try {
      const data = await fetchJson<AuthorDetail>(`/style/authors/${authorId}`);
      setAuthorDetail(data);
    } catch { setAuthorDetail(null); }
  }, []);

  const handleCreateAuthorOnly = async () => {
    if (!newAuthorId.trim()) return;
    setAnalyzeStatus("Saving...");
    try {
      await postApi("/style/authors", {
        id: newAuthorId.trim(),
        name: newAuthorName.trim() || newAuthorId.trim(),
        language: "zh",
        tags: newAuthorTags.split(",").map((s) => s.trim()).filter(Boolean),
      });
      setAnalyzeStatus("作者已创建");
      setShowCreateForm(false);
      setNewAuthorId("");
      setNewAuthorName("");
      setNewAuthorTags("");
      refetchLibrary();
    } catch (e) {
      setAnalyzeStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleDeleteAuthor = async (authorId: string) => {
    if (!confirm("确定要删除该作者？")) return;
    try {
      await fetchJson(`/style/authors/${authorId}`, { method: "DELETE" });
      refetchLibrary();
      if (selectedAuthorId === authorId) {
        setSelectedAuthorId("");
        setAuthorDetail(null);
      }
    } catch (e) {
      setAnalyzeStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleApplyAuthor = async () => {
    if (!applyAuthorId || !applyBookId) return;
    if (!confirm("确定要应用此作者风格到所选书籍？")) return;
    setApplyStatus("Applying...");
    try {
      await postApi(`/books/${applyBookId}/style/apply-author`, { authorId: applyAuthorId });
      setApplyStatus("应用成功");
    } catch (e) {
      setApplyStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleAuthorLocalSamples = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (files.length === 0) return;
    if (!selectedAuthorId) {
      setAnalyzeStatus("Error: 请先选择作者");
      return;
    }
    setAnalyzeStatus("Importing...");
    const seed = Date.now();
    let importedCount = 0;
    const failures: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const inferredType = inferLocalStyleFileType(file.name);
      if (!inferredType) { failures.push(file.name); continue; }
      try {
        const loadedText = await readLocalTextFile(file);
        await postApi(`/style/authors/${selectedAuthorId}/sources`, {
          sourceId: buildLocalStyleSourceId(file.name, seed, i),
          fileName: file.name,
          fileType: inferredType,
          text: loadedText,
        });
        importedCount++;
      } catch { failures.push(file.name); }
    }
    await refetchLibrary();
    await loadAuthorDetail(selectedAuthorId);
    if (failures.length > 0) {
      setAnalyzeStatus(`Error: 部分导入失败 ${failures.join(", ")}`);
    } else {
      setAnalyzeStatus(`已导入 ${importedCount} 个样本`);
    }
  };

  const renderBar = (label: string, value: number, colorClass?: string) => (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{(value * 100).toFixed(0)}%</span>
      </div>
      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${colorClass ?? "bg-primary"}`} style={{ width: `${Math.min(value * 100, 100)}%` }} />
      </div>
    </div>
  );

  return (
    <>
      <div className="flex gap-0 border border-border/40 rounded-lg overflow-hidden mb-4">
        <button onClick={() => setActiveAuditSection("library")} className={`flex-1 px-3 py-2 text-xs font-medium transition-all ${activeAuditSection === "library" ? "bg-primary text-primary-foreground" : "bg-muted/30 text-muted-foreground hover:bg-muted/50"}`}>
          {t("style.tabs.library")}
        </button>
        <button onClick={() => setActiveAuditSection("apply")} className={`flex-1 px-3 py-2 text-xs font-medium transition-all ${activeAuditSection === "apply" ? "bg-primary text-primary-foreground" : "bg-muted/30 text-muted-foreground hover:bg-muted/50"}`}>
          {t("style.tabs.apply")}
        </button>
      </div>

      {activeAuditSection === "library" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">{t("style.tabs.library")}</h3>
              <button onClick={() => { setShowCreateForm(true); }} className={`px-3 py-1.5 text-xs rounded-lg ${c.btnPrimary} flex items-center gap-1`}>
                <Plus size={12} />{t("style.createAuthor")}
              </button>
            </div>
            {showCreateForm && (
              <div className={`border ${c.cardStatic} rounded-lg p-4 space-y-2`}>
                <input type="text" placeholder={t("style.authorId")} value={newAuthorId} onChange={(e) => setNewAuthorId(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm" />
                <input type="text" placeholder={t("style.authorName")} value={newAuthorName} onChange={(e) => setNewAuthorName(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm" />
                <input type="text" placeholder={t("style.tags")} value={newAuthorTags} onChange={(e) => setNewAuthorTags(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm" />
                <div className="flex gap-2">
                  <button onClick={handleCreateAuthorOnly} disabled={!newAuthorId.trim()} className={`px-3 py-1.5 text-xs rounded-lg ${c.btnPrimary} disabled:opacity-30`}>{t("common.save")}</button>
                  <button onClick={() => { setShowCreateForm(false); setNewAuthorId(""); setNewAuthorName(""); setNewAuthorTags(""); }} className={`px-3 py-1.5 text-xs rounded-lg ${c.btnSecondary}`}>{t("common.cancel")}</button>
                </div>
              </div>
            )}
            {(!libraryData || libraryData.authors.length === 0) ? (
              <div className={`border border-dashed ${c.cardStatic} rounded-lg p-6 text-center text-muted-foreground text-sm italic`}>{t("style.noAuthors")}</div>
            ) : (
              <div className="space-y-2">
                {libraryData.authors.map((a) => (
                  <button key={a.id} onClick={() => { setSelectedAuthorId(a.id); loadAuthorDetail(a.id); }} className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors ${selectedAuthorId === a.id ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/30"}`}>
                    <div className="flex items-center justify-between"><span className="font-medium">{a.name}</span><span className="text-xs text-muted-foreground">{a.sourceCount} {t("style.sampleCount")}</span></div>
                    <div className="flex gap-1 mt-1">{a.tags.map((tag) => (<span key={tag} className="px-1.5 py-0.5 text-[10px] bg-secondary rounded">{tag}</span>))}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="lg:col-span-2 space-y-4">
            {authorDetail ? (
              <div className={`border ${c.cardStatic} rounded-lg p-5 space-y-4`}>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-lg">{authorDetail.profile.name}</h3>
                  <div className="flex gap-2">
                    <button onClick={async () => { if (reanalyzing) return; setReanalyzing(true); try { await fetchJson(`/style/authors/${selectedAuthorId}/reanalyze`, { method: "POST" }); loadAuthorDetail(selectedAuthorId); refetchLibrary(); } finally { setReanalyzing(false); } }} className={`px-3 py-1.5 text-xs rounded-lg ${c.btnSecondary} disabled:opacity-30 flex items-center gap-1`} disabled={reanalyzing}><RefreshCw size={12} />{t("style.reanalyzeAuthor")}</button>
                    <button onClick={() => handleDeleteAuthor(selectedAuthorId)} className={`px-3 py-1.5 text-xs rounded-lg ${c.btnDanger} flex items-center gap-1`}><Trash2 size={12} /></button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="bg-secondary/30 rounded-lg p-3"><div className="text-muted-foreground text-xs">{t("style.sampleCount")}</div><div className="text-xl font-bold">{authorDetail.profile.sampleStats.sourceCount}</div></div>
                  <div className="bg-secondary/30 rounded-lg p-3"><div className="text-muted-foreground text-xs">{t("style.totalChars")}</div><div className="text-xl font-bold">{authorDetail.profile.sampleStats.totalChars.toLocaleString()}</div></div>
                  <div className="bg-secondary/30 rounded-lg p-3"><div className="text-muted-foreground text-xs">{t("style.avgSentence")}</div><div className="text-xl font-bold">{authorDetail.profile.aggregateProfile.avgSentenceLength.toFixed(1)}</div></div>
                </div>
                {authorDetail.profile.aggregateProfile.topPatterns.length > 0 && (<div><div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">{t("style.topPatterns")}</div><div className="flex gap-2 flex-wrap">{authorDetail.profile.aggregateProfile.topPatterns.map((pt) => (<span key={pt} className="px-2 py-1 text-xs bg-secondary rounded">{pt}</span>))}</div></div>)}
                {authorDetail.profile.aggregateProfile.rhetoricalFeatures.length > 0 && (<div><div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">{t("style.rhetoricalFeatures")}</div><div className="flex gap-2 flex-wrap">{authorDetail.profile.aggregateProfile.rhetoricalFeatures.map((f) => (<span key={f} className="px-2 py-1 text-xs bg-primary/10 text-primary rounded">{f}</span>))}</div></div>)}
                {authorDetail.profile.aggregateProfile.fingerprint && (
                  <div className="space-y-3"><h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("style.fingerprint")}</h4>
                    <div className="space-y-2">
                      {renderBar(t("style.dialogueRatio"), authorDetail.profile.aggregateProfile.fingerprint.dialogueRatio, "bg-emerald-500")}
                      {renderBar(t("style.actionDensity"), authorDetail.profile.aggregateProfile.fingerprint.actionDensity, "bg-amber-500")}
                      {renderBar(t("style.psychologicalRatio"), authorDetail.profile.aggregateProfile.fingerprint.psychologicalRatio, "bg-purple-500")}
                      {renderBar(t("style.rhetoricDensity"), authorDetail.profile.aggregateProfile.fingerprint.rhetoricDensity, "bg-indigo-500")}
                      {renderBar(t("style.aiTellRisk"), authorDetail.profile.aggregateProfile.fingerprint.aiTellRisk, authorDetail.profile.aggregateProfile.fingerprint.aiTellRisk > 0.5 ? "bg-destructive" : "bg-emerald-500")}
                    </div>
                  </div>
                )}
                <div className="border-t border-border pt-4">
                  <div className="flex items-center justify-between gap-3 mb-2"><h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("style.sampleCount")}</h4>
                    <div><input ref={authorSampleInputRef} type="file" multiple accept=".txt,.md,.markdown,.jsonl,.json,.ts,.js,.html,.htm,.css,text/plain,text/markdown" className="hidden" onChange={handleAuthorLocalSamples} />
                      <button onClick={() => authorSampleInputRef.current?.click()} disabled={loading} className={`px-3 py-1.5 text-xs rounded-lg ${c.btnSecondary} disabled:opacity-30 flex items-center gap-1`}><Upload size={12} />{t("style.importLocalSamples")}</button>
                    </div>
                  </div>
                  <div className="space-y-1">{authorDetail.sources.map((s) => (<div key={s.id} className="flex items-center justify-between text-sm px-3 py-2 bg-secondary/20 rounded"><div className="flex items-center gap-2"><FileText size={14} className="text-muted-foreground" /><span>{s.fileName}</span><span className="text-xs text-muted-foreground">({s.fileType})</span></div><div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{s.charCount} 字</span>{s.status === "failed" && <span className="text-xs text-destructive">{s.error}</span>}</div></div>))}</div>
                </div>
              </div>
            ) : (
              <div className={`border border-dashed ${c.cardStatic} rounded-lg p-8 text-center text-muted-foreground text-sm italic`}>{t("style.noAuthors")}</div>
            )}
          </div>
        </div>
      )}

      {activeAuditSection === "apply" && (
        <div className="max-w-[48rem] space-y-6">
          <div className={`border ${c.cardStatic} rounded-lg p-5 space-y-4`}>
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">{t("style.tabs.apply")}</h3>
            <div><label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-2">{t("style.selectAuthor")}</label>
              <select value={applyAuthorId} onChange={(e) => setApplyAuthorId(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm"><option value="">{t("style.selectAuthor")}</option>{libraryData?.authors.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}</select>
            </div>
            <div><label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-2">{t("style.selectBook")}</label>
              <select value={applyBookId} onChange={(e) => setApplyBookId(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm"><option value="">{t("style.selectBook")}</option>{booksData?.books.map((b) => (<option key={b.id} value={b.id}>{b.title}</option>))}</select>
            </div>
            <button onClick={handleApplyAuthor} disabled={!applyAuthorId || !applyBookId} className={`px-4 py-2 text-sm rounded-lg ${c.btnPrimary} disabled:opacity-30 flex items-center gap-2`}><Upload size={14} />{t("style.applyAuthor")}</button>
            {applyStatus && (<div className={`text-sm ${applyStatus.startsWith("Error") ? "text-destructive" : "text-emerald-600"}`}>{applyStatus}</div>)}
          </div>
          <div className={`border ${c.cardStatic} rounded-lg p-5 space-y-4`}>
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">{t("style.adjustmentSuggestions")}</h3>
            <AdjustmentSuggestionsPanel text={text} onTextChange={setText} diagnostics={diagnostics} t={t as unknown as (key: string) => string}
              onApply={() => { setProfile(null); setDiagnostics(null); setTimeout(() => { handleAnalyze(); handleDiagnostics(); }, 300); }} />
          </div>
          <div className={`border ${c.cardStatic} rounded-lg p-5 space-y-4`}>
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">{t("style.compareWithAuthor")}</h3>
            <AuthorStyleComparison text={text} onComparisonResult={() => {}} t={t as unknown as (key: string) => string} />
          </div>
        </div>
      )}
    </>
  );
}
