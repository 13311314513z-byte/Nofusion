import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { Library, Plus, Upload, Wand2 } from "lucide-react";
import { DistillationPage } from "./DistillationPage";
import { StyleAiDetectTab } from "./style-manager/StyleAiDetectTab.js";
import { StyleDiagnoseTab } from "./style-manager/StyleDiagnoseTab.js";
import { StyleDeduplicateTab } from "./style-manager/StyleDeduplicateTab.js";
import { StyleAuditTab } from "./style-manager/StyleAuditTab.js";
import { StyleImportTab } from "./style-manager/StyleImportTab.js";
import { useStyleManagerState } from "./style-manager/useStyleManagerState.js";
import type { CoreStyleProfile } from "./style-types.js";
import {
  buildStyleStatusNotice,
  inferLocalStyleFileType,
  buildLocalStyleSourceId,
  readLocalTextFile,
} from "./style-utils.js";

// Re-export for backward compat (consumed by StyleAuditTab, tests, etc.)
export { buildStyleStatusNotice, inferLocalStyleFileType, buildLocalStyleSourceId, readLocalTextFile };

type StyleTab = "import" | "diagnose" | "ai-detect" | "deduplicate" | "audit" | "distillation";

interface Nav { toDashboard: () => void }

export function StyleManager({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const state = useStyleManagerState(t);

  // ── Render helpers ──

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

  const renderProfileCard = (p: CoreStyleProfile | null, showImport?: boolean) => {
    if (!p) return null;
    const f = p.fingerprint;
    return (
      <div className={`border ${c.cardStatic} rounded-lg p-5 space-y-5`}>
        <div>
          <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-3">{t("style.basicStats")}</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-secondary/30 rounded-lg p-3"><div className="text-muted-foreground text-xs">{t("style.avgSentence")}</div><div className="text-xl font-bold">{p.avgSentenceLength.toFixed(1)}</div></div>
            <div className="bg-secondary/30 rounded-lg p-3"><div className="text-muted-foreground text-xs">{t("style.vocabDiversity")}</div><div className="text-xl font-bold">{(p.vocabularyDiversity * 100).toFixed(0)}%</div></div>
            <div className="bg-secondary/30 rounded-lg p-3"><div className="text-muted-foreground text-xs">{t("style.avgParagraph")}</div><div className="text-xl font-bold">{p.avgParagraphLength.toFixed(0)}</div></div>
            <div className="bg-secondary/30 rounded-lg p-3"><div className="text-muted-foreground text-xs">{t("style.sentenceStdDev")}</div><div className="text-xl font-bold">{p.sentenceLengthStdDev.toFixed(1)}</div></div>
          </div>
        </div>
        <div>
          <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-3">{t("style.fingerprint")}</h3>
          <div className="mb-4"><div className="text-xs font-medium text-foreground mb-2">{t("style.narrativeStyle")}</div><div className="space-y-2">{renderBar(t("style.dialogueRatio"), f.dialogueRatio, "bg-emerald-500")}{renderBar(t("style.actionDensity"), f.actionDensity, "bg-amber-500")}{renderBar(t("style.psychologicalRatio"), f.psychologicalRatio, "bg-purple-500")}</div></div>
          <div className="mb-4"><div className="text-xs font-medium text-foreground mb-2">{t("style.languageTemperament")}</div><div className="space-y-2">{renderBar(t("style.colloquialism"), f.colloquialismScore, "bg-sky-500")}{renderBar(t("style.sensoryDensity"), f.sensoryDensity, "bg-rose-500")}</div></div>
          <div className="mb-4"><div className="text-xs font-medium text-foreground mb-2">{t("style.expressionHabits")}</div><div className="space-y-2">{renderBar(t("style.rhetoricDensity"), f.rhetoricDensity, "bg-indigo-500")}</div></div>
          <div><div className="text-xs font-medium text-foreground mb-2">{t("style.narrativeControl")}</div>{renderBar(t("style.aiTellRisk"), f.aiTellRisk, f.aiTellRisk > 0.5 ? "bg-destructive" : "bg-emerald-500")}</div>
        </div>
        {p.topPatterns.length > 0 && (<div><div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">{t("style.topPatterns")}</div><div className="flex gap-2 flex-wrap">{p.topPatterns.map((pt) => (<span key={pt} className="px-2 py-1 text-xs bg-secondary rounded">{pt}</span>))}</div></div>)}
        {p.rhetoricalFeatures.length > 0 && (<div><div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">{t("style.rhetoricalFeatures")}</div><div className="flex gap-2 flex-wrap">{p.rhetoricalFeatures.map((f2) => (<span key={f2} className="px-2 py-1 text-xs bg-primary/10 text-primary rounded">{f2}</span>))}</div></div>)}
        {showImport && (
          <div className="border-t border-border pt-4 mt-4 space-y-3">
            <h4 className="font-semibold text-sm flex items-center gap-2"><Upload size={14} />{t("style.importToBook")}</h4>
            <select value={state.importBookId} onChange={(e) => { /* handled by StyleImportTab */ }} className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm">
              <option value="">{t("style.selectBook")}</option>
              {state.booksData?.books.map((b) => (<option key={b.id} value={b.id}>{b.title}</option>))}
            </select>
            <button onClick={state.handleImport} disabled={!state.importBookId} className={`px-4 py-2 text-sm rounded-lg ${c.btnSecondary} disabled:opacity-30`}>{t("style.importGuide")}</button>
            {state.importStatus && <div className="text-xs text-muted-foreground">{state.importStatus}</div>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span>{t("nav.style")}</span>
      </div>

      <h1 className="font-serif text-3xl flex items-center gap-3">
        <Wand2 size={28} className="text-primary" />
        {t("style.title")}
      </h1>

      {/* Step progression */}
      <div className="flex gap-0 border border-border/40 rounded-lg overflow-hidden">
        {([
          { key: "import", label: "1. 文本导入" },
          { key: "diagnose", label: "2. 文风诊断" },
          { key: "ai-detect", label: "3. AI 检测" },
          { key: "deduplicate", label: "4. 修辞去重" },
          { key: "audit", label: "5. 应用审计" },
          { key: "distillation", label: "6. 蒸馏规则" },
        ] as const).map((step) => {
          const stepKeys: ReadonlyArray<StyleTab> = ["import", "diagnose", "ai-detect", "deduplicate", "audit", "distillation"];
          const currentIdx = stepKeys.indexOf(state.activeTab);
          const thisIdx = stepKeys.indexOf(step.key);
          const completed = thisIdx >= 0 && thisIdx < currentIdx;
          const active = thisIdx === currentIdx;
          return (
            <button key={step.key} onClick={() => state.setActiveTab(step.key)}
              className={`flex-1 px-3 py-2.5 text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                active ? "bg-primary text-primary-foreground" : completed ? "bg-primary/10 text-primary hover:bg-primary/15" : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
              }`}>
              <span className="hidden sm:inline">{step.label}</span>
              {completed && <span className="text-[10px] opacity-70 ml-1">✓</span>}
            </button>
          );
        })}
      </div>

      {/* Step 1: Text Import & Analysis */}
      {state.activeTab === "import" && (
        <StyleImportTab
          text={state.text} setText={state.setText}
          sourceName={state.sourceName} setSourceName={state.setSourceName}
          urlSource={state.urlSource} setUrlSource={state.setUrlSource}
          profile={state.profile} diagnostics={state.diagnostics}
          loading={state.loading} loadingDiagnostics={state.loadingDiagnostics}
          textFileInputRef={state.textFileInputRef}
          fileAnalysisInputRef={state.fileAnalysisInputRef}
          libraryData={state.libraryData} booksData={state.booksData}
          fileText={state.fileText} fileSourceName={state.fileSourceName} setFileSourceName={state.setFileSourceName}
          fileType={state.fileType} extractedDoc={state.extractedDoc}
          loadedChunks={state.loadedChunks} loadingChunk={state.loadingChunk}
          activePreset={state.activePreset} analysisStage={state.analysisStage}
          preprocessedText={state.preprocessedText} preprocessActions={state.preprocessActions}
          showPreprocessPanel={state.showPreprocessPanel} setShowPreprocessPanel={state.setShowPreprocessPanel}
          filterCode={state.filterCode} setFilterCode={state.setFilterCode}
          filterRepeatedPrompts={state.filterRepeatedPrompts} setFilterRepeatedPrompts={state.setFilterRepeatedPrompts}
          filterUrls={state.filterUrls} setFilterUrls={state.setFilterUrls}
          filterStructuredData={state.filterStructuredData} setFilterStructuredData={state.setFilterStructuredData}
          stripMarkdown={state.stripMarkdown} setStripMarkdown={state.setStripMarkdown}
          deduplicateParagraphs={state.deduplicateParagraphs} setDeduplicateParagraphs={state.setDeduplicateParagraphs}
          filterTimestamps={state.filterTimestamps} setFilterTimestamps={state.setFilterTimestamps}
          filterIds={state.filterIds} setFilterIds={state.setFilterIds}
          filterNoiseMarkers={state.filterNoiseMarkers} setFilterNoiseMarkers={state.setFilterNoiseMarkers}
          minLineLength={state.minLineLength} setMinLineLength={state.setMinLineLength}
          setActivePreset={state.setActivePreset as unknown as (v: string) => void}
          relayoutedText={state.relayoutedText}
          showRelayoutPanel={state.showRelayoutPanel} setShowRelayoutPanel={state.setShowRelayoutPanel}
          mergeShortParagraphs={state.mergeShortParagraphs} setMergeShortParagraphs={state.setMergeShortParagraphs}
          formatDialogue={state.formatDialogue} setFormatDialogue={state.setFormatDialogue}
          ensureParagraphSpacing={state.ensureParagraphSpacing} setEnsureParagraphSpacing={state.setEnsureParagraphSpacing}
          normalizeQuotes={state.normalizeQuotes} setNormalizeQuotes={state.setNormalizeQuotes}
          compressBlankLines={state.compressBlankLines} setCompressBlankLines={state.setCompressBlankLines}
          inspectionResult={state.inspectionResult}
          showRiskConfirm={state.showRiskConfirm} setShowRiskConfirm={state.setShowRiskConfirm}
          pendingRiskStats={state.pendingRiskStats} setPendingRiskStats={state.setPendingRiskStats}
          showExportPanel={state.showExportPanel} setShowExportPanel={state.setShowExportPanel}
          exportFormat={state.exportFormat} setExportFormat={state.setExportFormat as unknown as (v: string) => void}
          exportStatus={state.exportStatus}
          importBookId={state.importBookId} importChapterNumber={state.importChapterNumber}
          setImportChapterNumber={state.setImportChapterNumber} chapterIndex={state.chapterIndex}
          c={c} t={t}
          handleTextLocalFile={state.handleTextLocalFile}
          handleImportUrl={state.handleImportUrl}
          handleAnalyze={state.handleAnalyze}
          handleDiagnostics={state.handleDiagnostics}
          handleImportBookChapter={state.handleImportBookChapter}
          handleSelectBook={state.handleSelectBook}
          handleFileAnalysisLocalFile={state.handleFileAnalysisLocalFile}
          handleExtractText={state.handleExtractText}
          handleLoadNextChunk={state.handleLoadNextChunk}
          runPreprocess={state.runPreprocess}
          runRelayout={state.runRelayout}
          handleRunPreprocess={state.handleRunPreprocess}
          getStageText={state.getStageText}
          sampleLargeText={state.sampleLargeText}
          setAnalysisToExtracted={state.setAnalysisToExtracted}
          setAnalysisToCleaned={state.setAnalysisToCleaned}
          setAnalysisToRelayouted={state.setAnalysisToRelayouted}
          handleImportProcessedToTextAnalysis={state.handleImportProcessedToTextAnalysis}
          handleExport={state.handleExport}
          renderProfileCard={renderProfileCard}
        />
      )}

      {state.activeTab === "ai-detect" && <StyleAiDetectTab text={state.text} t={t} />}

      {state.activeTab === "diagnose" && (
        <StyleDiagnoseTab text={state.text} profile={state.profile} diagnostics={state.diagnostics}
          loadingDiagnostics={state.loadingDiagnostics} importBookId={state.importBookId}
          importChapterNumber={state.importChapterNumber} renderProfileCard={renderProfileCard}
          c={c} t={t} handleDiagnostics={state.handleDiagnostics} />
      )}

      {state.activeTab === "deduplicate" && (
        <StyleDeduplicateTab text={state.text} setText={state.setText} setAnalyzeStatus={state.setAnalyzeStatus} c={c} />
      )}

      {state.activeTab === "audit" && (
        <StyleAuditTab text={state.text} setText={state.setText} profile={state.profile} setProfile={state.setProfile}
          diagnostics={state.diagnostics} setDiagnostics={state.setDiagnostics}
          libraryData={state.libraryData ?? undefined} refetchLibrary={state.refetchLibrary as () => void}
          booksData={state.booksData ?? undefined} c={c} t={t} setAnalyzeStatus={state.setAnalyzeStatus}
          handleAnalyze={state.handleAnalyze} handleDiagnostics={state.handleDiagnostics}
          authorSampleInputRef={state.authorSampleInputRef} loading={state.loading} />
      )}

      {state.activeTab === "distillation" && (
        <DistillationPage authorId={state.selectedAuthorId ?? ""} nav={nav} theme={theme} t={t} />
      )}

      {state.statusNotice && (
        <div className={`px-4 py-3 rounded-lg text-sm ${
          state.statusNotice.tone === "error" ? "bg-destructive/10 text-destructive"
            : state.statusNotice.tone === "info" ? "bg-secondary text-muted-foreground"
            : "bg-emerald-500/10 text-emerald-600"
        }`}>{state.statusNotice.message}</div>
      )}
    </div>
  );
}
