import { StyleTextTab } from "../StyleTextTab.js";
import { BarChart3, AlertTriangle } from "lucide-react";
import type { StringKey, TFunction } from "../../hooks/use-i18n";
import type { CoreStyleProfile, ExtractedDoc, BookSummary } from "../style-types.js";
import type { FullStyleDiagnostics } from "@actalk/inkos-core";
import type { InspectionCode, InspectionResult } from "../style-preprocess-state.js";
import { computeRemovalStats } from "../style-preprocess-state.js";

const INSPECTION_MESSAGE_KEYS = {
  "explicit-think-block": "style.inspect.explicitThinkBlock",
  "similar-paragraphs": "style.inspect.similarParagraphs",
  "repeated-phrase": "style.inspect.repeatedPhrase",
  "mixed-language": "style.inspect.mixedLanguage",
  "encoded-data": "style.inspect.encodedData",
  "asr-marker": "style.inspect.asrMarker",
  "translation-pair": "style.inspect.translationPair",
  "quote-block": "style.inspect.quoteBlock",
  "rp-marker": "style.inspect.rpMarker",
  "high-whitespace": "style.inspect.highWhitespace",
  "possible-garbled-text": "style.inspect.possibleGarbledText",
  "duplicate-parallelism": "style.inspect.duplicate-parallelism",
  "duplicate-metaphor": "style.inspect.duplicate-metaphor",
  "duplicate-personification": "style.inspect.duplicate-personification",
  "duplicate-repetition": "style.inspect.duplicate-repetition",
  "duplicate-transition": "style.inspect.duplicate-transition",
  "duplicate-hyperbole": "style.inspect.duplicate-hyperbole",
  "duplicate-rhetorical-question": "style.inspect.duplicate-rhetorical-question",
  "duplicate-anaphora": "style.inspect.duplicate-anaphora",
  "duplicate-epistrophe": "style.inspect.duplicate-epistrophe",
  "duplicate-parallel-structure": "style.inspect.duplicate-parallel-structure",
} satisfies Record<InspectionCode, StringKey>;

interface StyleImportTabProps {
  // Shared text state
  readonly text: string;
  readonly setText: (v: string) => void;
  readonly sourceName: string;
  readonly setSourceName: (v: string) => void;
  // Import-specific state
  readonly urlSource: string;
  readonly setUrlSource: (v: string) => void;
  readonly profile: CoreStyleProfile | null;
  readonly diagnostics: FullStyleDiagnostics | null;
  readonly loading: boolean;
  readonly loadingDiagnostics: boolean;
  readonly textFileInputRef: React.RefObject<HTMLInputElement | null>;
  readonly fileAnalysisInputRef: React.RefObject<HTMLInputElement | null>;
  readonly libraryData: { authors: ReadonlyArray<import("../style-types.js").AuthorIndexItem> } | null;
  readonly booksData: { books: ReadonlyArray<BookSummary> } | null;
  // File processing state
  readonly fileText: string;
  readonly fileSourceName: string;
  readonly setFileSourceName: (v: string) => void;
  readonly fileType: string;
  readonly extractedDoc: ExtractedDoc | null;
  readonly loadedChunks: number;
  readonly loadingChunk: boolean;
  // Preprocess state
  readonly activePreset: string;
  readonly analysisStage: string;
  readonly preprocessedText: string;
  readonly preprocessActions: ReadonlyArray<string>;
  readonly showPreprocessPanel: boolean;
  readonly setShowPreprocessPanel: (v: boolean) => void;
  readonly filterCode: boolean; readonly setFilterCode: (v: boolean) => void;
  readonly filterRepeatedPrompts: boolean; readonly setFilterRepeatedPrompts: (v: boolean) => void;
  readonly filterUrls: boolean; readonly setFilterUrls: (v: boolean) => void;
  readonly filterStructuredData: boolean; readonly setFilterStructuredData: (v: boolean) => void;
  readonly stripMarkdown: boolean; readonly setStripMarkdown: (v: boolean) => void;
  readonly deduplicateParagraphs: boolean; readonly setDeduplicateParagraphs: (v: boolean) => void;
  readonly filterTimestamps: boolean; readonly setFilterTimestamps: (v: boolean) => void;
  readonly filterIds: boolean; readonly setFilterIds: (v: boolean) => void;
  readonly filterNoiseMarkers: boolean; readonly setFilterNoiseMarkers: (v: boolean) => void;
  readonly minLineLength: number; readonly setMinLineLength: (v: number) => void;
  readonly setActivePreset: (v: string) => void;
  // Relayout state
  readonly relayoutedText: string;
  readonly showRelayoutPanel: boolean;
  readonly setShowRelayoutPanel: (v: boolean) => void;
  readonly mergeShortParagraphs: boolean; readonly setMergeShortParagraphs: (v: boolean) => void;
  readonly formatDialogue: boolean; readonly setFormatDialogue: (v: boolean) => void;
  readonly ensureParagraphSpacing: boolean; readonly setEnsureParagraphSpacing: (v: boolean) => void;
  readonly normalizeQuotes: boolean; readonly setNormalizeQuotes: (v: boolean) => void;
  readonly compressBlankLines: boolean; readonly setCompressBlankLines: (v: boolean) => void;
  // Inspection/risk
  readonly inspectionResult: InspectionResult | null;
  readonly showRiskConfirm: boolean;
  readonly setShowRiskConfirm: (v: boolean) => void;
  readonly pendingRiskStats: ReturnType<typeof computeRemovalStats> | null;
  readonly setPendingRiskStats: (v: ReturnType<typeof computeRemovalStats> | null) => void;
  // Export
  readonly showExportPanel: boolean;
  readonly setShowExportPanel: (v: boolean) => void;
  readonly exportFormat: string;
  readonly setExportFormat: (v: string) => void;
  readonly exportStatus: string;
  // Import
  readonly importBookId: string;
  readonly importChapterNumber: number;
  readonly setImportChapterNumber: (v: number) => void;
  readonly chapterIndex: ReadonlyArray<{ number: number; title: string }> | null;
  // UI
  readonly c: Record<string, string>;
  readonly t: TFunction;
  // Handlers
  readonly handleTextLocalFile: (event: React.ChangeEvent<HTMLInputElement>) => void;
  readonly handleImportUrl: () => void;
  readonly handleAnalyze: () => void;
  readonly handleDiagnostics: () => void;
  readonly handleImportBookChapter: (bookId: string, chapterNumber?: number) => Promise<void>;
  readonly handleSelectBook: (bookId: string) => Promise<void>;
  readonly handleFileAnalysisLocalFile: (event: React.ChangeEvent<HTMLInputElement>) => void;
  readonly handleExtractText: () => void;
  readonly handleLoadNextChunk: () => void;
  readonly runPreprocess: (sourceText: string, skipRelayout?: boolean) => void;
  readonly runRelayout: (sourceText: string) => void;
  readonly handleRunPreprocess: (sourceText: string, skipRelayout?: boolean) => void;
  readonly getStageText: () => string;
  readonly sampleLargeText: (text: string) => { display: string; isSampled: boolean };
  readonly setAnalysisToExtracted: () => void;
  readonly setAnalysisToCleaned: () => void;
  readonly setAnalysisToRelayouted: () => void;
  readonly handleImportProcessedToTextAnalysis: () => void;
  readonly handleExport: () => void;
  readonly renderProfileCard: (p: CoreStyleProfile | null, showImport?: boolean) => React.ReactNode;
}

export function StyleImportTab(props: StyleImportTabProps) {
  const {
    text, setText, sourceName, setSourceName,
    urlSource, setUrlSource,
    profile, diagnostics, loading, loadingDiagnostics,
    textFileInputRef, fileAnalysisInputRef,
    libraryData, booksData,
    fileText, fileSourceName, setFileSourceName, fileType,
    extractedDoc, loadedChunks, loadingChunk,
    activePreset, analysisStage, preprocessedText, preprocessActions,
    showPreprocessPanel, setShowPreprocessPanel,
    filterCode, setFilterCode, filterRepeatedPrompts, setFilterRepeatedPrompts,
    filterUrls, setFilterUrls, filterStructuredData, setFilterStructuredData,
    stripMarkdown, setStripMarkdown, deduplicateParagraphs, setDeduplicateParagraphs,
    filterTimestamps, setFilterTimestamps, filterIds, setFilterIds,
    filterNoiseMarkers, setFilterNoiseMarkers, minLineLength, setMinLineLength, setActivePreset,
    relayoutedText, showRelayoutPanel, setShowRelayoutPanel,
    mergeShortParagraphs, setMergeShortParagraphs, formatDialogue, setFormatDialogue,
    ensureParagraphSpacing, setEnsureParagraphSpacing, normalizeQuotes, setNormalizeQuotes,
    compressBlankLines, setCompressBlankLines,
    inspectionResult, showRiskConfirm, setShowRiskConfirm, pendingRiskStats, setPendingRiskStats,
    showExportPanel, setShowExportPanel, exportFormat, setExportFormat, exportStatus,
    importBookId, importChapterNumber, setImportChapterNumber, chapterIndex,
    c, t,
    handleTextLocalFile, handleImportUrl, handleAnalyze, handleDiagnostics,
    handleImportBookChapter, handleSelectBook, handleFileAnalysisLocalFile,
    handleExtractText, handleLoadNextChunk, runPreprocess, runRelayout,
    handleRunPreprocess, getStageText, sampleLargeText,
    setAnalysisToExtracted, setAnalysisToCleaned, setAnalysisToRelayouted,
    handleImportProcessedToTextAnalysis, handleExport, renderProfileCard,
  } = props;

  return (
    <>
      <StyleTextTab
        text={text} setText={setText}
        sourceName={sourceName} setSourceName={setSourceName}
        urlSource={urlSource} setUrlSource={setUrlSource}
        profile={profile} diagnostics={diagnostics}
        loading={loading} loadingDiagnostics={loadingDiagnostics}
        textFileInputRef={textFileInputRef}
        libraryData={libraryData} booksData={booksData}
        c={c} t={t as unknown as (key: string) => string}
        handleTextLocalFile={handleTextLocalFile}
        handleImportUrl={handleImportUrl}
        handleAnalyze={handleAnalyze}
        handleDiagnostics={handleDiagnostics}
        handleImportBookChapter={handleImportBookChapter}
        renderProfileCard={renderProfileCard}
        importBookId={importBookId}
        chapterIndex={chapterIndex}
        importChapterNumber={importChapterNumber}
        handleSelectBook={handleSelectBook}
        onSelectChapter={setImportChapterNumber}
      />

      {/* File Processing section */}
      {fileText && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-2">{t("style.sourceName")}</label>
              <input type="text" value={fileSourceName} onChange={(e) => setFileSourceName(e.target.value)} placeholder={t("style.sourceExample")} className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-2">{t("style.textSample")}</label>
              {(() => { const { display, isSampled } = sampleLargeText(fileText); return (<><textarea value={display} readOnly rows={10} className="w-full px-3 py-2 rounded-lg bg-secondary/20 border border-border text-xs focus:outline-none resize-none font-mono" />{isSampled && <div className="text-xs text-amber-600 mt-1">{t("style.largeTextSampled")}</div>}</>); })()}
              {extractedDoc && extractedDoc.totalChunks !== undefined && loadedChunks < extractedDoc.totalChunks && (<button onClick={handleLoadNextChunk} disabled={loadingChunk} className={`mt-2 px-3 py-1 text-xs rounded-lg ${c.btnSecondary} disabled:opacity-30`}>{loadingChunk ? t("common.loading") : `${t("style.loadNextChunk")} (${loadedChunks + 1}/${extractedDoc.totalChunks})`}</button>)}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleExtractText} disabled={!fileText.trim() || loading} className={`px-3 py-1.5 text-xs rounded-lg ${c.btnPrimary} disabled:opacity-30`}>{t("style.extractText")}</button>
              <span className="text-xs text-muted-foreground">{fileType}</span>
            </div>
            {extractedDoc && (<div className={`border ${c.cardStatic} rounded-lg p-4 space-y-2`}><div className="flex items-center justify-between"><span className="text-xs">{t("style.extracted")}</span><span className="text-xs text-muted-foreground">{extractedDoc.charCount?.toLocaleString()} {t("truth.chars")}</span></div></div>)}

            {/* Preprocess Panel */}
            <div className={`border ${c.cardStatic} rounded-lg p-4 space-y-3`}>
              <div className="flex items-center justify-between"><h4 className="font-semibold text-sm">{t("style.preprocessTitle")}</h4><button onClick={() => setShowPreprocessPanel(!showPreprocessPanel)} className={`text-xs px-2 py-1 rounded ${showPreprocessPanel ? c.btnPrimary : c.btnSecondary}`}>{showPreprocessPanel ? t("common.on") : t("common.off")}</button></div>
              {showPreprocessPanel && (<div className="space-y-3">
                <div className="flex flex-wrap gap-1.5"><button onClick={() => { setActivePreset("fidelity"); }} className={`text-xs px-2 py-0.5 rounded ${activePreset === "fidelity" ? c.btnPrimary : c.btnSecondary}`}>{t("style.preset.fidelity")}</button><button onClick={() => { setActivePreset("conservative"); }} className={`text-xs px-2 py-0.5 rounded ${activePreset === "conservative" ? c.btnPrimary : c.btnSecondary}`}>{t("style.preset.conservative")}</button><button onClick={() => { setActivePreset("chatExport"); }} className={`text-xs px-2 py-0.5 rounded ${activePreset === "chatExport" ? c.btnPrimary : c.btnSecondary}`}>{t("style.preset.chatExport")}</button></div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={filterCode} onChange={(e) => { setFilterCode(e.target.checked); setActivePreset("custom"); }} /><span>{t("style.filterCode")}</span></label>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={filterRepeatedPrompts} onChange={(e) => { setFilterRepeatedPrompts(e.target.checked); setActivePreset("custom"); }} /><span>{t("style.filterRepeatedPrompts")}</span></label>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={filterUrls} onChange={(e) => { setFilterUrls(e.target.checked); setActivePreset("custom"); }} /><span>{t("style.filterUrls")}</span></label>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={filterStructuredData} onChange={(e) => { setFilterStructuredData(e.target.checked); setActivePreset("custom"); }} /><span>{t("style.filterStructuredData")}</span></label>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={stripMarkdown} onChange={(e) => { setStripMarkdown(e.target.checked); setActivePreset("custom"); }} /><span>{t("style.stripMarkdown")}</span></label>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={deduplicateParagraphs} onChange={(e) => { setDeduplicateParagraphs(e.target.checked); setActivePreset("custom"); }} /><span>{t("style.deduplicateParagraphs")}</span></label>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={filterTimestamps} onChange={(e) => { setFilterTimestamps(e.target.checked); setActivePreset("custom"); }} /><span>{t("style.filterTimestamps")}</span></label>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={filterIds} onChange={(e) => { setFilterIds(e.target.checked); setActivePreset("custom"); }} /><span>{t("style.filterIds")}</span></label>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={filterNoiseMarkers} onChange={(e) => { setFilterNoiseMarkers(e.target.checked); setActivePreset("custom"); }} /><span>{t("style.filterNoiseMarkers")}</span></label>
                </div>
                <div className="flex items-center gap-2 text-xs"><span>{t("style.minLineLength")}</span><input type="number" min={0} max={100} value={minLineLength} onChange={(e) => { setMinLineLength(Math.max(0, Math.min(100, Number(e.target.value) || 0))); setActivePreset("custom"); }} className="w-16 px-1.5 py-0.5 rounded border border-border bg-background text-xs text-right" /><span className="text-muted-foreground">(0 = {t("common.off")})</span></div>
                {inspectionResult && inspectionResult.findings.length > 0 && (<div className="space-y-1 p-2 rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800"><div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400"><AlertTriangle className="w-3.5 h-3.5" />{t("style.inspect.title")}（{inspectionResult.findings.length}）</div>{inspectionResult.findings.map((f, i) => (<div key={i} className="text-xs text-amber-600 dark:text-amber-500">{f.count > 1 ? `${t(INSPECTION_MESSAGE_KEYS[f.code])}（${f.count} 处）` : t(INSPECTION_MESSAGE_KEYS[f.code])}</div>))}</div>)}
                {preprocessActions.length > 0 && (<div className="space-y-1">{preprocessActions.map((a, i) => (<div key={i} className="text-xs text-muted-foreground">✓ {a}</div>))}</div>)}
                <div className="flex items-center gap-2">
                  <button onClick={() => handleRunPreprocess(extractedDoc?.text || fileText)} disabled={!(extractedDoc?.text || fileText).trim() || loading} className={`px-3 py-1.5 text-xs rounded-lg ${c.btnPrimary} disabled:opacity-30`}>{t("style.runPreprocess")}</button>
                  {preprocessedText && (<div className="flex items-center gap-2 text-xs text-muted-foreground"><span>{t("style.removalRate")}: {(() => { const orig = extractedDoc?.text.length ?? 1; return ((orig - preprocessedText.length) / orig * 100).toFixed(1); })()}%</span></div>)}
                </div>
                {preprocessedText && (<div className="flex flex-wrap items-center gap-2 p-2 rounded bg-primary/5 border border-primary/20"><span className="text-xs font-medium">{t("style.stage.analysisSource")}:</span><button onClick={setAnalysisToExtracted} className={`text-xs px-2 py-0.5 rounded ${analysisStage === "extracted" ? c.btnPrimary : c.btnSecondary}`}>{t("style.stage.extracted")}（{extractedDoc?.text.length.toLocaleString()}）</button><button onClick={setAnalysisToCleaned} className={`text-xs px-2 py-0.5 rounded ${analysisStage === "cleaned" ? c.btnPrimary : c.btnSecondary}`}>{t("style.stage.cleaned")}（{preprocessedText.length.toLocaleString()}）</button>{relayoutedText && (<button onClick={setAnalysisToRelayouted} className={`text-xs px-2 py-0.5 rounded ${analysisStage === "relayouted" ? c.btnPrimary : c.btnSecondary}`}>{t("style.stage.relayouted")}（{relayoutedText.length.toLocaleString()}）</button>)}</div>)}
                {preprocessedText && (<div><div className="text-xs text-muted-foreground mb-1">{t("style.preprocessed")}（{getStageText().length.toLocaleString()} {t("truth.chars")}）</div><textarea value={getStageText()} readOnly rows={4} className="w-full px-2 py-1 rounded bg-secondary/20 border border-border text-xs font-mono resize-none" /></div>)}
              </div>)}
            </div>

            {/* Relayout Panel */}
            <div className={`border ${c.cardStatic} rounded-lg p-4 space-y-3`}>
              <div className="flex items-center justify-between"><h4 className="font-semibold text-sm">{t("style.relayoutTitle")}</h4><button onClick={() => setShowRelayoutPanel(!showRelayoutPanel)} className={`text-xs px-2 py-1 rounded ${showRelayoutPanel ? c.btnPrimary : c.btnSecondary}`}>{showRelayoutPanel ? t("common.on") : t("common.off")}</button></div>
              {showRelayoutPanel && (<div className="space-y-2">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={mergeShortParagraphs} onChange={(e) => setMergeShortParagraphs(e.target.checked)} /><span>{t("style.mergeShortParagraphs")}</span></label>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={formatDialogue} onChange={(e) => setFormatDialogue(e.target.checked)} /><span>{t("style.formatDialogue")}</span></label>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={normalizeQuotes} onChange={(e) => setNormalizeQuotes(e.target.checked)} /><span>{t("style.normalizeQuotes")}</span></label>
                </div>
                <button onClick={() => runRelayout(preprocessedText || extractedDoc?.text || fileText)} disabled={!(preprocessedText || extractedDoc?.text || fileText).trim() || loading} className={`px-3 py-1.5 text-xs rounded-lg ${c.btnPrimary} disabled:opacity-30`}>{t("style.runRelayout")}</button>
                {relayoutedText && (<div><div className="text-xs text-muted-foreground mb-1">{t("style.relayouted")}（{relayoutedText.length} {t("truth.chars")}）</div><textarea value={relayoutedText} readOnly rows={4} className="w-full px-2 py-1 rounded bg-secondary/20 border border-border text-xs font-mono resize-none" /></div>)}
              </div>)}
            </div>

            {/* Export Panel */}
            <div className={`border ${c.cardStatic} rounded-lg p-4 space-y-3`}>
              <div className="flex items-center justify-between"><h4 className="font-semibold text-sm">{t("style.exportTitle")}</h4><button onClick={() => setShowExportPanel(!showExportPanel)} className={`text-xs px-2 py-1 rounded ${showExportPanel ? c.btnPrimary : c.btnSecondary}`}>{showExportPanel ? t("common.on") : t("common.off")}</button></div>
              {showExportPanel && (<div className="flex gap-2 items-center"><select value={exportFormat} onChange={(e) => setExportFormat(e.target.value)} className="px-3 py-1.5 rounded-lg bg-secondary/30 border border-border text-xs"><option value="txt">.txt</option><option value="md">.md</option><option value="html">.html</option></select><button onClick={handleExport} disabled={!extractedDoc && !fileText} className={`px-3 py-1.5 text-xs rounded-lg ${c.btnPrimary} disabled:opacity-30`}>{t("style.export")}</button>{exportStatus && <span className="text-xs text-muted-foreground">{exportStatus}</span>}</div>)}
            </div>
          </div>
          <div className="space-y-4">
            {(preprocessedText || extractedDoc?.text) ? (<div className={`border ${c.cardStatic} rounded-lg p-5 space-y-4`}><div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">{t("style.preprocessResult")}</h3><button onClick={handleImportProcessedToTextAnalysis} className={`px-3 py-1.5 text-xs rounded-lg ${c.btnPrimary} flex items-center gap-1`}><BarChart3 size={12} />{t("style.importToTextAnalysis")}</button></div><div className="grid grid-cols-2 gap-3 text-sm"><div className="bg-secondary/30 rounded-lg p-3"><div className="text-muted-foreground text-xs">{t("style.extractedChars")}</div><div className="text-xl font-bold">{(extractedDoc?.charCount ?? 0).toLocaleString()}</div></div><div className="bg-secondary/30 rounded-lg p-3"><div className="text-muted-foreground text-xs">{t("style.finalChars")}</div><div className="text-xl font-bold">{getStageText().length.toLocaleString()}</div></div></div><textarea value={getStageText()} readOnly rows={18} className="w-full px-3 py-2 rounded-lg bg-secondary/20 border border-border text-xs focus:outline-none resize-none font-mono" /></div>) : (!loading && (<div className={`border border-dashed ${c.cardStatic} rounded-lg p-8 text-center text-muted-foreground text-sm italic`}>{t("style.preprocessEmptyHint")}</div>))}
          </div>
        </div>
      )}

      {/* Risk confirmation modal */}
      {showRiskConfirm && pendingRiskStats && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md p-6 rounded-xl bg-background border border-border shadow-xl space-y-4">
            <h3 className="text-lg font-semibold text-destructive">{t("style.riskConfirmTitle")}</h3>
            <div className="space-y-2 text-sm"><p>{t("style.riskConfirmMessage")}</p><ul className="list-disc list-inside text-muted-foreground">{pendingRiskStats.highRiskOptions.map((opt: string) => (<li key={opt}>{opt}</li>))}</ul><p className="font-medium">{t("style.removalRate")}: {(pendingRiskStats.removalRate * 100).toFixed(1)}%</p></div>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowRiskConfirm(false); setPendingRiskStats(null); }} className={`px-3 py-1.5 text-xs rounded-lg ${c.btnSecondary}`}>{t("common.cancel")}</button>
              <button onClick={() => { setShowRiskConfirm(false); const srcText = extractedDoc?.text || fileText; runPreprocess(srcText); setPendingRiskStats(null); }} className={`px-3 py-1.5 text-xs rounded-lg ${c.btnPrimary}`}>{t("common.confirm")}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
