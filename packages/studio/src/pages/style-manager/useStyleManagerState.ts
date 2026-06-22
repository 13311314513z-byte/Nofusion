import { useState, useRef, useMemo, useCallback, type ChangeEvent } from "react";
import { fetchJson, useApi, postApi } from "../../hooks/use-api";
import type { StringKey, TFunction } from "../../hooks/use-i18n";
import type { FullStyleDiagnostics } from "@actalk/inkos-core";
import type { PresetId, InspectionResult } from "../style-preprocess-state.js";
import { computeRemovalStats, requiresConfirmation } from "../style-preprocess-state.js";
import type { CoreStyleProfile, AuthorIndexItem, ExtractedDoc, BookSummary } from "../style-types.js";
import {
  buildStyleStatusNotice,
  inferLocalStyleFileType,
  readLocalTextFile,
  type LocalStyleFileType,
} from "../style-utils.js";

type StyleTab = "import" | "diagnose" | "ai-detect" | "deduplicate" | "audit" | "distillation";

export function useStyleManagerState(t: TFunction) {
  const [activeTab, setActiveTab] = useState<StyleTab>("import");
  const textFileInputRef = useRef<HTMLInputElement | null>(null);
  const fileAnalysisInputRef = useRef<HTMLInputElement | null>(null);
  const authorSampleInputRef = useRef<HTMLInputElement | null>(null);

  // Text analysis state
  const [text, setText] = useState(() => {
    const saved = sessionStorage.getItem("style-chapter-text");
    if (saved) { sessionStorage.removeItem("style-chapter-text"); return saved; }
    return "";
  });
  const [sourceName, setSourceName] = useState(() => {
    const saved = sessionStorage.getItem("style-chapter-source");
    if (saved) { sessionStorage.removeItem("style-chapter-source"); return saved; }
    return "";
  });
  const [urlSource, setUrlSource] = useState("");
  const [profile, setProfile] = useState<CoreStyleProfile | null>(null);
  const [diagnostics, setDiagnostics] = useState<FullStyleDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);
  const [analyzeStatus, setAnalyzeStatus] = useState("");

  // File analysis state
  const [fileText, setFileText] = useState("");
  const [fileSourceName, setFileSourceName] = useState("");
  const [fileType, setFileType] = useState<LocalStyleFileType>("txt");
  const [extractedDoc, setExtractedDoc] = useState<ExtractedDoc | null>(null);
  const [loadedChunks, setLoadedChunks] = useState<number>(1);
  const [loadingChunk, setLoadingChunk] = useState(false);

  // Preprocess state
  const [activePreset, setActivePreset] = useState<PresetId>("fidelity");
  const [analysisStage, setAnalysisStage] = useState<"extracted" | "cleaned" | "relayouted">("extracted");
  const [preprocessedText, setPreprocessedText] = useState("");
  const [preprocessActions, setPreprocessActions] = useState<ReadonlyArray<string>>([]);
  const [showPreprocessPanel, setShowPreprocessPanel] = useState(true);
  const [filterCode, setFilterCode] = useState(false);
  const [filterRepeatedPrompts, setFilterRepeatedPrompts] = useState(false);
  const [filterUrls, setFilterUrls] = useState(false);
  const [filterStructuredData, setFilterStructuredData] = useState(false);
  const [stripMarkdown, setStripMarkdown] = useState(false);
  const [deduplicateParagraphs, setDeduplicateParagraphs] = useState(false);
  const [filterTimestamps, setFilterTimestamps] = useState(false);
  const [filterIds, setFilterIds] = useState(false);
  const [filterNoiseMarkers, setFilterNoiseMarkers] = useState(false);
  const [minLineLength, setMinLineLength] = useState(0);

  // Relayout state
  const [relayoutedText, setRelayoutedText] = useState("");
  const [showRelayoutPanel, setShowRelayoutPanel] = useState(false);
  const [mergeShortParagraphs, setMergeShortParagraphs] = useState(false);
  const [formatDialogue, setFormatDialogue] = useState(false);
  const [ensureParagraphSpacing, setEnsureParagraphSpacing] = useState(false);
  const [normalizeQuotes, setNormalizeQuotes] = useState(false);
  const [compressBlankLines, setCompressBlankLines] = useState(false);

  // Inspection & risk state
  const [inspectionResult, setInspectionResult] = useState<InspectionResult | null>(null);
  const [showRiskConfirm, setShowRiskConfirm] = useState(false);
  const [pendingRiskStats, setPendingRiskStats] = useState<ReturnType<typeof computeRemovalStats> | null>(null);

  // Export state
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [exportFormat, setExportFormat] = useState<"txt" | "md" | "html">("txt");
  const [exportStatus, setExportStatus] = useState("");

  // Library state
  const { data: libraryData, refetch: refetchLibrary } = useApi<{ authors: ReadonlyArray<AuthorIndexItem> }>("/style/authors");

  // Audit author state
  const [selectedAuthorId, setSelectedAuthorId] = useState<string>("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newAuthorId, setNewAuthorId] = useState("");
  const [newAuthorName, setNewAuthorName] = useState("");
  const [newAuthorTags, setNewAuthorTags] = useState("");

  // Apply state
  const [applyStatus, setApplyStatus] = useState("");

  // Shared
  const [importBookId, setImportBookId] = useState("");
  const [importChapterNumber, setImportChapterNumber] = useState(1);
  const [chapterIndex, setChapterIndex] = useState<ReadonlyArray<{ number: number; title: string }> | null>(null);
  const [importStatus, setImportStatus] = useState("");
  const { data: booksData } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const statusNotice = buildStyleStatusNotice(analyzeStatus, importStatus || applyStatus);

  // Derive source hash from text for staleness tracking
  const sourceHash = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(36).slice(0, 8);
  }, [text]);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleTextLocalFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const inferredType = inferLocalStyleFileType(file.name);
    if (!inferredType) { setAnalyzeStatus(`Error: ${t("style.unsupportedLocalFile")}`); return; }
    setLoading(true);
    setAnalyzeStatus("");
    setProfile(null);
    try {
      const loadedText = await readLocalTextFile(file);
      setText(loadedText);
      setSourceName(file.name);
      setAnalyzeStatus(t("style.localFileImported"));
    } catch (e) { setAnalyzeStatus(`Error: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setLoading(false); }
  }, [t]);

  const handleImportUrl = useCallback(async () => {
    const url = urlSource.trim();
    if (!url) return;
    setLoading(true);
    setAnalyzeStatus("");
    setProfile(null);
    try {
      const doc = await fetchJson<ExtractedDoc & { readonly url?: string; readonly contentType?: string }>("/style/import-url", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }),
      });
      if (!doc.text.trim()) { setText(""); setSourceName(doc.sourceName || doc.url || url); setAnalyzeStatus(`Error: ${t("style.urlNoText")}`); return; }
      setText(doc.text);
      setSourceName(doc.sourceName || doc.url || url);
      const warningSuffix = doc.warnings.length > 0 ? ` ${doc.warnings.join("；")}` : "";
      setAnalyzeStatus(`${t("style.urlImported")}${warningSuffix}`);
    } catch (e) { setAnalyzeStatus(`Error: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setLoading(false); }
  }, [urlSource, t]);

  const handleImportBookChapter = useCallback(async (bookId: string, chapterNumber?: number) => {
    const chNum = chapterNumber ?? importChapterNumber;
    setLoading(true); setAnalyzeStatus(""); setProfile(null); setImportBookId(bookId);
    try {
      if (!chapterIndex) {
        try { const data = await fetchJson<{ chapters: ReadonlyArray<{ number: number; title: string }> }>(`/books/${bookId}`); setChapterIndex(data.chapters); }
        catch { /* chapter index not available */ }
      }
      const data = await fetchJson<{ content: string }>(`/books/${bookId}/chapters/${chNum}`);
      if (!data.content?.trim()) { setAnalyzeStatus("Error: 该书暂无章节内容"); return; }
      setText(data.content); setSourceName(bookId); setImportChapterNumber(chNum);
      setAnalyzeStatus(`已导入「${booksData?.books.find((b) => b.id === bookId)?.title ?? bookId}」第 ${chNum} 章`);
    } catch (e) { setAnalyzeStatus(`Error: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setLoading(false); }
  }, [importChapterNumber, chapterIndex, booksData]);

  const handleSelectBook = useCallback(async (bookId: string) => {
    setImportBookId(bookId); setImportChapterNumber(1); setChapterIndex(null);
    if (bookId) {
      try { const data = await fetchJson<{ chapters: ReadonlyArray<{ number: number; title: string }> }>(`/books/${bookId}`); setChapterIndex(data.chapters); }
      catch { setChapterIndex([]); }
    }
  }, []);

  const handleFileAnalysisLocalFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const inferredType = inferLocalStyleFileType(file.name);
    if (!inferredType) { setAnalyzeStatus(`Error: ${t("style.unsupportedLocalFile")}`); return; }
    setLoading(true); setAnalyzeStatus(""); setExtractedDoc(null);
    setPreprocessedText(""); setPreprocessActions([]); setRelayoutedText(""); setExportStatus("");
    try {
      const loadedText = await readLocalTextFile(file);
      setFileText(loadedText); setFileSourceName(file.name); setFileType(inferredType);
      setAnalyzeStatus(t("style.localFileImported"));
    } catch (e) { setAnalyzeStatus(`Error: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setLoading(false); }
  }, [t]);

  const handleAnalyze = useCallback(async () => {
    if (!text.trim()) return;
    setLoading(true); setProfile(null); setDiagnostics(null); setAnalyzeStatus("");
    try {
      const data = await fetchJson<CoreStyleProfile>("/style/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, sourceName: sourceName || "sample" }),
      });
      setProfile(data);
    } catch (e) { setAnalyzeStatus(`Error: ${e instanceof Error ? e.message : String(e)}`); }
    setLoading(false);
  }, [text, sourceName]);

  const handleDiagnostics = useCallback(async () => {
    if (!text.trim()) return;
    setLoadingDiagnostics(true); setDiagnostics(null); setAnalyzeStatus("");
    try {
      const data = await fetchJson<FullStyleDiagnostics>("/style/diagnostics", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, language: "zh" }),
      });
      setDiagnostics(data);
    } catch (e) { setAnalyzeStatus(`Diagnostics Error: ${e instanceof Error ? e.message : String(e)}`); }
    setLoadingDiagnostics(false);
  }, [text]);

  const handleImport = useCallback(async () => {
    if (!importBookId || !text.trim()) return;
    setImportStatus("Importing...");
    try { await postApi(`/books/${importBookId}/style/import`, { text, sourceName: sourceName || "sample" }); setImportStatus("Style guide imported successfully!"); }
    catch (e) { setImportStatus(`Error: ${e instanceof Error ? e.message : String(e)}`); }
  }, [importBookId, text, sourceName]);

  const handleExtractText = useCallback(async () => {
    if (!fileText.trim()) return;
    setLoading(true); setExtractedDoc(null); setLoadedChunks(1);
    setPreprocessedText(""); setPreprocessActions([]); setRelayoutedText(""); setInspectionResult(null); setAnalyzeStatus("");
    try {
      const doc = await fetchJson<ExtractedDoc>("/style/extract-text", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: fileText, sourceName: fileSourceName || "sample", fileType }),
      });
      setExtractedDoc(doc);
      try {
        const inspect = await fetchJson<InspectionResult>("/style/preprocess/inspect", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: doc.text }),
        });
        setInspectionResult(inspect);
      } catch { /* optional */ }
      if (showPreprocessPanel && doc.text) { await runPreprocess(doc.text); }
      setAnalyzeStatus(t("style.extracted"));
    } catch (e) { setAnalyzeStatus(`Error: ${e instanceof Error ? e.message : String(e)}`); }
    setLoading(false);
  }, [fileText, fileSourceName, fileType, showPreprocessPanel, t]);

  const handleLoadNextChunk = useCallback(async () => {
    if (!extractedDoc || loadingChunk) return;
    const nextIndex = loadedChunks;
    if (extractedDoc.totalChunks !== undefined && nextIndex >= extractedDoc.totalChunks) return;
    setLoadingChunk(true);
    try {
      const chunk = await fetchJson<ExtractedDoc>("/style/extract-text", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: fileText, sourceName: fileSourceName || "sample", fileType, chunk: nextIndex }),
      });
      setExtractedDoc((prev) => prev ? { ...prev, text: prev.text + chunk.text, chunkIndex: nextIndex } : prev);
      setLoadedChunks(nextIndex + 1);
    } catch (e) { console.warn(`[StyleManager] Failed to load chunk ${nextIndex}: ${e}`); }
    setLoadingChunk(false);
  }, [extractedDoc, loadingChunk, loadedChunks, fileText, fileSourceName, fileType]);

  const runPreprocess = useCallback(async (sourceText: string, skipRelayout = false) => {
    try {
      const result = await fetchJson<{ text: string; actions: string[]; removedChars: number }>("/style/preprocess", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: sourceText,
          options: { filterCode, filterRepeatedPrompts, filterUrls, filterStructuredData, stripMarkdown, minLineLength: minLineLength > 0 ? minLineLength : undefined, deduplicateParagraphs, filterTimestamps, filterIds, filterNoiseMarkers },
        }),
      });
      setPreprocessedText(result.text); setPreprocessActions(result.actions);
      if (!skipRelayout && showRelayoutPanel && result.text) { await runRelayout(result.text); }
      else { setRelayoutedText(""); }
      setAnalyzeStatus(t("style.preprocessDone"));
    } catch (e) { setAnalyzeStatus(`Error: ${e instanceof Error ? e.message : String(e)}`); }
  }, [filterCode, filterRepeatedPrompts, filterUrls, filterStructuredData, stripMarkdown, minLineLength, deduplicateParagraphs, filterTimestamps, filterIds, filterNoiseMarkers, showRelayoutPanel, t]);

  const runRelayout = useCallback(async (sourceText: string) => {
    try {
      const result = await fetchJson<{ text: string }>("/style/relayout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sourceText, options: { mergeShortParagraphs, shortParagraphThreshold: 20, formatDialogue, ensureParagraphSpacing, normalizeQuotes, compressBlankLines } }),
      });
      setRelayoutedText(result.text);
      setAnalyzeStatus(t("style.relayoutDone"));
    } catch (e) { setAnalyzeStatus(`Error: ${e instanceof Error ? e.message : String(e)}`); }
  }, [mergeShortParagraphs, formatDialogue, ensureParagraphSpacing, normalizeQuotes, compressBlankLines, t]);

  const handleRunPreprocess = useCallback((sourceText: string, skipRelayout = false) => {
    const preprocessOpts = { filterCode, filterRepeatedPrompts, filterUrls, filterStructuredData, stripMarkdown, minLineLength: minLineLength > 0 ? minLineLength : undefined, deduplicateParagraphs, filterTimestamps, filterIds, filterNoiseMarkers };
    const relayoutOpts = { mergeShortParagraphs, formatDialogue, ensureParagraphSpacing, normalizeQuotes, compressBlankLines };
    const stats = computeRemovalStats(sourceText.length, sourceText.length, preprocessOpts, relayoutOpts);
    if (requiresConfirmation(stats)) { setPendingRiskStats(stats); setShowRiskConfirm(true); return; }
    runPreprocess(sourceText, skipRelayout);
  }, [filterCode, filterRepeatedPrompts, filterUrls, filterStructuredData, stripMarkdown, minLineLength, deduplicateParagraphs, filterTimestamps, filterIds, filterNoiseMarkers, mergeShortParagraphs, formatDialogue, ensureParagraphSpacing, normalizeQuotes, compressBlankLines, runPreprocess]);

  const getStageText = useCallback((): string => {
    if (analysisStage === "relayouted" && relayoutedText) return relayoutedText;
    if (analysisStage === "cleaned" && preprocessedText) return preprocessedText;
    return extractedDoc?.text || fileText;
  }, [analysisStage, relayoutedText, preprocessedText, extractedDoc, fileText]);

  const setAnalysisToExtracted = useCallback(() => setAnalysisStage("extracted"), []);
  const setAnalysisToCleaned = useCallback(() => setAnalysisStage("cleaned"), []);
  const setAnalysisToRelayouted = useCallback(() => setAnalysisStage("relayouted"), []);

  const handleImportProcessedToTextAnalysis = useCallback(() => {
    const textToAnalyze = getStageText();
    if (!textToAnalyze.trim()) return;
    setText(textToAnalyze); setSourceName(fileSourceName || "preprocessed-sample"); setProfile(null);
    const stageKey: StringKey = analysisStage === "extracted" ? "style.stage.extracted" : analysisStage === "cleaned" ? "style.stage.cleaned" : "style.stage.relayouted";
    setAnalyzeStatus(`已使用「${t(stageKey)}」版本`);
    setActiveTab("diagnose");
  }, [getStageText, fileSourceName, analysisStage, t]);

  const handleExport = useCallback(() => {
    const textToExport = getStageText();
    if (!textToExport.trim()) return;
    try {
      const safeTitle = (fileSourceName || "export").replace(/[^\w\u4e00-\u9fa5._-]/g, "_");
      let content = textToExport; let mimeType = "text/plain"; let extension = "txt";
      if (exportFormat === "md") { content = `# ${safeTitle}\n\n${textToExport}`; mimeType = "text/markdown"; extension = "md"; }
      else if (exportFormat === "html") {
        const escaped = textToExport.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        content = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${safeTitle}</title><style>body{font-family:system-ui,sans-serif;line-height:1.7;max-width:720px;margin:40px auto;padding:0 20px;color:#333}pre{white-space:pre-wrap;word-wrap:break-word;font-family:inherit;line-height:inherit}</style></head><body><pre>${escaped}</pre></body></html>`;
        mimeType = "text/html"; extension = "html";
      }
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${safeTitle}.${extension}`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      setExportStatus(t("style.exported"));
    } catch (e) { setExportStatus(`Error: ${e instanceof Error ? e.message : String(e)}`); }
  }, [getStageText, fileSourceName, exportFormat, t]);

  const handleSaveAsAuthor = useCallback(async (targetAuthorId?: string) => {
    const authorId = targetAuthorId ?? newAuthorId.trim();
    const authorName = targetAuthorId ? "" : newAuthorName.trim();
    if (!authorId || !text.trim()) return;
    setAnalyzeStatus("Saving...");
    try {
      if (!targetAuthorId) { await postApi("/style/authors", { id: authorId, name: authorName || authorId, language: "zh", tags: newAuthorTags.split(",").map((s) => s.trim()).filter(Boolean) }); }
      await postApi(`/style/authors/${authorId}/sources`, { sourceId: `${Date.now()}`, fileName: sourceName || "sample", fileType: "txt", text });
      setAnalyzeStatus(t("style.sampleAdded"));
      setShowCreateForm(false); setNewAuthorId(""); setNewAuthorName(""); setNewAuthorTags("");
      refetchLibrary();
    } catch (e) { setAnalyzeStatus(`Error: ${e instanceof Error ? e.message : String(e)}`); }
  }, [newAuthorId, newAuthorName, newAuthorTags, text, sourceName, t, refetchLibrary]);

  const sampleLargeText = useCallback((txt: string): { display: string; isSampled: boolean } => {
    const LARGE_TEXT_THRESHOLD = 100_000;
    if (txt.length <= LARGE_TEXT_THRESHOLD) return { display: txt, isSampled: false };
    const head = txt.slice(0, 30_000); const tail = txt.slice(-30_000);
    return { display: `${head}\n\n[… ${(txt.length - head.length - tail.length).toLocaleString()} characters omitted for preview …]\n\n${tail}`, isSampled: true };
  }, []);

  return {
    // State
    activeTab, setActiveTab,
    textFileInputRef, fileAnalysisInputRef, authorSampleInputRef,
    text, setText, sourceName, setSourceName, urlSource, setUrlSource,
    profile, setProfile, diagnostics, setDiagnostics,
    loading, loadingDiagnostics, analyzeStatus, setAnalyzeStatus,
    fileText, fileSourceName, setFileSourceName, fileType,
    extractedDoc, loadedChunks, loadingChunk,
    activePreset, setActivePreset, analysisStage,
    preprocessedText, preprocessActions, showPreprocessPanel, setShowPreprocessPanel,
    filterCode, setFilterCode, filterRepeatedPrompts, setFilterRepeatedPrompts,
    filterUrls, setFilterUrls, filterStructuredData, setFilterStructuredData,
    stripMarkdown, setStripMarkdown, deduplicateParagraphs, setDeduplicateParagraphs,
    filterTimestamps, setFilterTimestamps, filterIds, setFilterIds, filterNoiseMarkers, setFilterNoiseMarkers,
    minLineLength, setMinLineLength,
    relayoutedText, showRelayoutPanel, setShowRelayoutPanel,
    mergeShortParagraphs, setMergeShortParagraphs, formatDialogue, setFormatDialogue,
    ensureParagraphSpacing, setEnsureParagraphSpacing, normalizeQuotes, setNormalizeQuotes,
    compressBlankLines, setCompressBlankLines,
    inspectionResult, showRiskConfirm, setShowRiskConfirm, pendingRiskStats, setPendingRiskStats,
    showExportPanel, setShowExportPanel, exportFormat, setExportFormat, exportStatus,
    libraryData, refetchLibrary,
    selectedAuthorId, setSelectedAuthorId, showCreateForm, setShowCreateForm,
    newAuthorId, setNewAuthorId, newAuthorName, setNewAuthorName, newAuthorTags, setNewAuthorTags,
    applyStatus, setApplyStatus,
    importBookId, importChapterNumber, setImportChapterNumber, chapterIndex, importStatus,
    booksData, statusNotice, sourceHash,
    // Handlers
    handleTextLocalFile, handleImportUrl, handleImportBookChapter, handleSelectBook,
    handleFileAnalysisLocalFile, handleAnalyze, handleDiagnostics, handleImport,
    handleExtractText, handleLoadNextChunk, runPreprocess, runRelayout, handleRunPreprocess,
    getStageText, sampleLargeText,
    setAnalysisToExtracted, setAnalysisToCleaned, setAnalysisToRelayouted,
    handleImportProcessedToTextAnalysis, handleExport, handleSaveAsAuthor,
  };
}
