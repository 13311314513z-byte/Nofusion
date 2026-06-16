import { useState, useRef, useMemo, type ChangeEvent } from "react";
import { fetchJson, useApi, postApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { BarChart3, Library, Plus, Upload, Wand2 } from "lucide-react";
import { DistillationPage } from "./DistillationPage";
import { StyleAiDetectTab } from "./style-manager/StyleAiDetectTab.js";
import { StyleDiagnoseTab } from "./style-manager/StyleDiagnoseTab.js";
import { StyleDeduplicateTab } from "./style-manager/StyleDeduplicateTab.js";
import { StyleAuditTab } from "./style-manager/StyleAuditTab.js";
import { StyleImportTab } from "./style-manager/StyleImportTab.js";
import type { FullStyleDiagnostics } from "@actalk/inkos-core";
import type { PresetId, InspectionResult } from "./style-preprocess-state.js";
import { PRESETS, computeRemovalStats, requiresConfirmation } from "./style-preprocess-state.js";
import type { CoreStyleProfile, AuthorIndexItem, ExtractedDoc, BookSummary } from "./style-types.js";

type StyleTab = "import" | "diagnose" | "ai-detect" | "deduplicate" | "audit" | "distillation";
type LocalStyleFileType = "txt" | "md" | "jsonl" | "json" | "ts" | "js" | "html" | "css";

interface Nav { toDashboard: () => void }

export interface StyleStatusNotice {
  readonly tone: "error" | "success" | "info";
  readonly message: string;
}

export function buildStyleStatusNotice(analyzeStatus: string, importStatus: string): StyleStatusNotice | null {
  const message = analyzeStatus.trim() || importStatus.trim();
  if (!message) return null;
  if (message.startsWith("Error:")) {
    return { tone: "error", message };
  }
  if (message.endsWith("...")) {
    return { tone: "info", message };
  }
  return { tone: "success", message };
}

export function inferLocalStyleFileType(fileName: string): LocalStyleFileType | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".jsonl.md") || lower.endsWith(".jsonl.markdown")) return "jsonl";
  if (lower.endsWith(".json.md") || lower.endsWith(".json.markdown")) return "json";
  if (lower.endsWith(".txt")) return "txt";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "md";
  if (lower.endsWith(".jsonl")) return "jsonl";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".ts")) return "ts";
  if (lower.endsWith(".js")) return "js";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".css")) return "css";
  return null;
}

export function buildLocalStyleSourceId(fileName: string, seed: number, index = 0): string {
  const localName = fileName.split(/[/\\]/).pop() ?? fileName;
  const baseName = localName.replace(/\.[^.]+$/, "").trim();
  const safeBase = baseName.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${seed}-${index}-${safeBase || "sample"}`;
}

export function readLocalTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read local file"));
    reader.readAsText(file, "utf-8");
  });
}

/** Style drift score display — compares current text against book's style profile. */
function StyleDriftScoreSection({ bookId, chapterNumber, t }: { bookId: string; chapterNumber?: number; t: (key: string) => string }) {
  const [scoreData, setScoreData] = useState<{ score: number | null; chapterFingerprint?: unknown; profileFingerprint?: unknown } | null>(null);
  const [loadingScore, setLoadingScore] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const { data: booksData } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const bookTitle = booksData?.books.find((b) => b.id === bookId)?.title ?? bookId;
  const chNum = chapterNumber ?? 1;

  const handleFetchScore = async () => {
    setLoadingScore(true);
    setScoreError(null);
    try {
      const data = await fetchJson<{ score: number | null; message?: string }>(`/books/${bookId}/chapters/${chNum}/style-score`, {
        method: "POST",
      });
      setScoreData(data);
    } catch (e) {
      setScoreError(e instanceof Error ? e.message : String(e));
    }
    setLoadingScore(false);
  };

  return (
    <div className="border border-border/40 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <BarChart3 size={14} />
          风格漂移评分 — {bookTitle} 第 {chNum} 章
        </h4>
        <button
          onClick={handleFetchScore}
          disabled={loadingScore}
          className="px-3 py-1 text-xs rounded-lg bg-secondary/30 hover:bg-secondary/50 border border-border disabled:opacity-30"
        >
          {loadingScore ? "计算中..." : "计算评分"}
        </button>
      </div>
      {scoreError && (
        <div className="text-xs text-destructive">{scoreError}</div>
      )}
      {scoreData && (
        <div className="flex items-center gap-3">
          <div className={`text-2xl font-bold font-mono ${
            scoreData.score === null
              ? "text-muted-foreground"
              : scoreData.score >= 80
                ? "text-emerald-500"
                : scoreData.score >= 60
                  ? "text-amber-500"
                  : "text-destructive"
          }`}>
            {scoreData.score !== null ? `${scoreData.score}%` : "N/A"}
          </div>
          <div className="text-xs text-muted-foreground">
            {scoreData.score === null
              ? "该书暂无风格档案，请先导入文风指南"
              : scoreData.score >= 80
                ? "与全书风格高度一致"
                : scoreData.score >= 60
                  ? "有轻微风格漂移，建议检查"
                  : "存在明显风格漂移，建议调整"}
          </div>
        </div>
      )}
      {scoreData === null && !loadingScore && (
        <div className="text-xs text-muted-foreground">点击「计算评分」以比较当前文本与全书风格档案</div>
      )}
    </div>
  );
}

export function StyleManager({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const [activeTab, setActiveTab] = useState<StyleTab>("import");
  const textFileInputRef = useRef<HTMLInputElement | null>(null);
  const fileAnalysisInputRef = useRef<HTMLInputElement | null>(null);
  const authorSampleInputRef = useRef<HTMLInputElement | null>(null);

  // Text analysis state
  const [text, setText] = useState(() => {
    // Restore chapter text passed from BookChaptersSection via sessionStorage
    const saved = sessionStorage.getItem("style-chapter-text");
    if (saved) {
      sessionStorage.removeItem("style-chapter-text");
      return saved;
    }
    return "";
  });
  const [sourceName, setSourceName] = useState(() => {
    const saved = sessionStorage.getItem("style-chapter-source");
    if (saved) {
      sessionStorage.removeItem("style-chapter-source");
      return saved;
    }
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
  // Chunked extraction tracking
  const [loadedChunks, setLoadedChunks] = useState<number>(1);
  const [loadingChunk, setLoadingChunk] = useState(false);

  function stableHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36).slice(0, 6);
}

// --- Four-stage preprocess state ---
  const [activePreset, setActivePreset] = useState<PresetId>("fidelity");
  const [analysisStage, setAnalysisStage] = useState<"extracted" | "cleaned" | "relayouted">("extracted");

  // Preprocess state
  const [preprocessedText, setPreprocessedText] = useState("");
  const [preprocessActions, setPreprocessActions] = useState<ReadonlyArray<string>>([]);
  const [showPreprocessPanel, setShowPreprocessPanel] = useState(true);
  // Initial state matches "fidelity" preset (all cleaning off)
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
  // Relayout options also start from "fidelity" preset (all off)
  const [mergeShortParagraphs, setMergeShortParagraphs] = useState(false);
  const [formatDialogue, setFormatDialogue] = useState(false);
  const [ensureParagraphSpacing, setEnsureParagraphSpacing] = useState(false);
  const [normalizeQuotes, setNormalizeQuotes] = useState(false);
  const [compressBlankLines, setCompressBlankLines] = useState(false);

  // Inspection & risk state
  const [inspectionResult, setInspectionResult] = useState<InspectionResult | null>(null);
  const [showRiskConfirm, setShowRiskConfirm] = useState(false);
  const [pendingRiskAction, setPendingRiskAction] = useState<(() => void) | null>(null);
  const [pendingRiskStats, setPendingRiskStats] = useState<ReturnType<typeof computeRemovalStats> | null>(null);

  // Export state
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [exportFormat, setExportFormat] = useState<"txt" | "md" | "html">("txt");
  const [exportStatus, setExportStatus] = useState("");

  // Library state — kept for Import tab usage
  const { data: libraryData, refetch: refetchLibrary } = useApi<{ authors: ReadonlyArray<AuthorIndexItem> }>("/style/authors");

  // Audit author state — kept for renderProfileCard + DistillationPage
  const [selectedAuthorId, setSelectedAuthorId] = useState<string>("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newAuthorId, setNewAuthorId] = useState("");
  const [newAuthorName, setNewAuthorName] = useState("");
  const [newAuthorTags, setNewAuthorTags] = useState("");

  // Apply state — kept for statusNotice
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

  // Step 4: Deduplication state — moved to StyleDeduplicateTab

  // ── Audit handlers — moved to StyleAuditTab ──

  const handleTextLocalFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    const inferredType = inferLocalStyleFileType(file.name);
    if (!inferredType) {
      setAnalyzeStatus(`Error: ${t("style.unsupportedLocalFile")}`);
      return;
    }

    setLoading(true);
    setAnalyzeStatus("");
    setProfile(null);
    try {
      const loadedText = await readLocalTextFile(file);
      setText(loadedText);
      setSourceName(file.name);
      setAnalyzeStatus(t("style.localFileImported"));
    } catch (e) {
      setAnalyzeStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleImportUrl = async () => {
    const url = urlSource.trim();
    if (!url) return;

    setLoading(true);
    setAnalyzeStatus("");
    setProfile(null);
    try {
      const doc = await fetchJson<ExtractedDoc & { readonly url?: string; readonly contentType?: string }>("/style/import-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!doc.text.trim()) {
        setText("");
        setSourceName(doc.sourceName || doc.url || url);
        setAnalyzeStatus(`Error: ${t("style.urlNoText")}`);
        return;
      }
      setText(doc.text);
      setSourceName(doc.sourceName || doc.url || url);
      const warningSuffix = doc.warnings.length > 0 ? ` ${doc.warnings.join("；")}` : "";
      setAnalyzeStatus(`${t("style.urlImported")}${warningSuffix}`);
    } catch (e) {
      setAnalyzeStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  /** Import a specific chapter from a book for style analysis. Defaults to chapter 1. */
  const handleImportBookChapter = async (bookId: string, chapterNumber?: number) => {
    const chNum = chapterNumber ?? importChapterNumber;
    setLoading(true);
    setAnalyzeStatus("");
    setProfile(null);
    setImportBookId(bookId);
    try {
      // Fetch chapter index when a book is first selected
      if (!chapterIndex) {
        try {
          const data = await fetchJson<{ chapters: ReadonlyArray<{ number: number; title: string }> }>(`/books/${bookId}`);
          setChapterIndex(data.chapters);
        } catch {
          // Chapter index not available — proceed with default
        }
      }

      const data = await fetchJson<{ content: string }>(`/books/${bookId}/chapters/${chNum}`);
      if (!data.content?.trim()) {
        setAnalyzeStatus("Error: 该书暂无章节内容");
        return;
      }
      setText(data.content);
      setSourceName(bookId);
      setImportChapterNumber(chNum);
      setAnalyzeStatus(`已导入「${booksData?.books.find((b) => b.id === bookId)?.title ?? bookId}」第 ${chNum} 章`);
    } catch (e) {
      setAnalyzeStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  /** Fetch book detail (including chapter index) for a book without importing. */
  const handleSelectBook = async (bookId: string) => {
    setImportBookId(bookId);
    setImportChapterNumber(1);
    setChapterIndex(null);
    if (bookId) {
      try {
        const data = await fetchJson<{ chapters: ReadonlyArray<{ number: number; title: string }> }>(`/books/${bookId}`);
        setChapterIndex(data.chapters);
      } catch {
        setChapterIndex([]);
      }
    }
  };

  /** Fetch deduplication — moved to StyleDeduplicateTab */

  const handleFileAnalysisLocalFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    const inferredType = inferLocalStyleFileType(file.name);
    if (!inferredType) {
      setAnalyzeStatus(`Error: ${t("style.unsupportedLocalFile")}`);
      return;
    }

    setLoading(true);
    setAnalyzeStatus("");
    setExtractedDoc(null);
    setPreprocessedText("");
    setPreprocessActions([]);
    setRelayoutedText("");
    setExportStatus("");
    try {
      const loadedText = await readLocalTextFile(file);
      setFileText(loadedText);
      setFileSourceName(file.name);
      setFileType(inferredType);
      setAnalyzeStatus(t("style.localFileImported"));
    } catch (e) {
      setAnalyzeStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  // ── Import handlers ──

  const handleAnalyze = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setProfile(null);
    setDiagnostics(null);
    setAnalyzeStatus("");
    try {
      const data = await fetchJson<CoreStyleProfile>("/style/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, sourceName: sourceName || "sample" }),
      });
      setProfile(data);
    } catch (e) {
      setAnalyzeStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  const handleDiagnostics = async () => {
    if (!text.trim()) return;
    setLoadingDiagnostics(true);
    setDiagnostics(null);
    setAnalyzeStatus("");
    try {
      const data = await fetchJson<FullStyleDiagnostics>("/style/diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language: "zh" }),
      });
      setDiagnostics(data);
    } catch (e) {
      setAnalyzeStatus(`Diagnostics Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoadingDiagnostics(false);
  };

  const handleImport = async () => {
    if (!importBookId || !text.trim()) return;
    setImportStatus("Importing...");
    try {
      await postApi(`/books/${importBookId}/style/import`, { text, sourceName: sourceName || "sample" });
      setImportStatus("Style guide imported successfully!");
    } catch (e) {
      setImportStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleExtractText = async () => {
    if (!fileText.trim()) return;
    setLoading(true);
    setExtractedDoc(null);
    setLoadedChunks(1);
    setPreprocessedText("");
    setPreprocessActions([]);
    setRelayoutedText("");
    setInspectionResult(null);
    setAnalyzeStatus("");
    try {
      const doc = await fetchJson<ExtractedDoc>("/style/extract-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: fileText, sourceName: fileSourceName || "sample", fileType }),
      });
      setExtractedDoc(doc);
      // Run input inspection
      try {
        const inspect = await fetchJson<InspectionResult>("/style/preprocess/inspect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: doc.text }),
        });
        setInspectionResult(inspect);
      } catch { /* inspection is optional */ }
      // Auto-run preprocess with current preset if panel is visible
      if (showPreprocessPanel && doc.text) {
        await runPreprocess(doc.text);
      }
      setAnalyzeStatus(t("style.extracted"));
    } catch (e) {
      setAnalyzeStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  /** Load the next chunk and append it to the current extracted text. */
  const handleLoadNextChunk = async () => {
    if (!extractedDoc || loadingChunk) return;
    const nextIndex = loadedChunks;
    if (extractedDoc.totalChunks !== undefined && nextIndex >= extractedDoc.totalChunks) return;
    setLoadingChunk(true);
    try {
      const chunk = await fetchJson<ExtractedDoc>("/style/extract-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: fileText,
          sourceName: fileSourceName || "sample",
          fileType,
          chunk: nextIndex,
        }),
      });
      setExtractedDoc((prev) => prev ? {
        ...prev,
        text: prev.text + chunk.text,
        chunkIndex: nextIndex,
      } : prev);
      setLoadedChunks(nextIndex + 1);
    } catch (e) {
      console.warn(`[StyleManager] Failed to load chunk ${nextIndex}: ${e}`);
    }
    setLoadingChunk(false);
  };

  const runPreprocess = async (sourceText: string, skipRelayout = false) => {
    try {
      const result = await fetchJson<{ text: string; actions: string[]; removedChars: number }>("/style/preprocess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: sourceText,
          options: {
            filterCode,
            filterRepeatedPrompts,
            filterUrls,
            filterStructuredData,
            stripMarkdown,
            minLineLength: minLineLength > 0 ? minLineLength : undefined,
            deduplicateParagraphs,
            filterTimestamps,
            filterIds,
            filterNoiseMarkers,
          },
        }),
      });
      setPreprocessedText(result.text);
      setPreprocessActions(result.actions);
      if (!skipRelayout && showRelayoutPanel && result.text) {
        await runRelayout(result.text);
      } else {
        setRelayoutedText("");
      }
      setAnalyzeStatus(t("style.preprocessDone"));
    } catch (e) {
      setAnalyzeStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const runRelayout = async (sourceText: string) => {
    try {
      const result = await fetchJson<{ text: string }>("/style/relayout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: sourceText,
          options: {
            mergeShortParagraphs,
            shortParagraphThreshold: 20,
            formatDialogue,
            ensureParagraphSpacing,
            normalizeQuotes,
            compressBlankLines,
          },
        }),
      });
      setRelayoutedText(result.text);
      setAnalyzeStatus(t("style.relayoutDone"));
    } catch (e) {
      setAnalyzeStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleRunPreprocess = (sourceText: string, skipRelayout = false) => {
    // Build current options to compute risk before calling API
    const preprocessOpts = {
      filterCode,
      filterRepeatedPrompts,
      filterUrls,
      filterStructuredData,
      stripMarkdown,
      minLineLength: minLineLength > 0 ? minLineLength : undefined,
      deduplicateParagraphs,
      filterTimestamps,
      filterIds,
      filterNoiseMarkers,
    };
    const relayoutOpts = {
      mergeShortParagraphs,
      formatDialogue,
      ensureParagraphSpacing,
      normalizeQuotes,
      compressBlankLines,
    };
    // Use a rough estimate: assume 5% removal for conservative presets,
    // actual removal is computed server-side. Here we use the high-risk
    // option count as a proxy for pre-flight check.
    const estimatedRemoval = 0;
    const stats = computeRemovalStats(sourceText.length, sourceText.length - estimatedRemoval, preprocessOpts, relayoutOpts);
    if (requiresConfirmation(stats)) {
      setPendingRiskStats(stats);
      setShowRiskConfirm(true);
      return;
    }
    runPreprocess(sourceText, skipRelayout);
  };

  const getStageText = (): string => {
    if (analysisStage === "relayouted" && relayoutedText) return relayoutedText;
    if (analysisStage === "cleaned" && preprocessedText) return preprocessedText;
    return extractedDoc?.text || fileText;
  };

  const LARGE_TEXT_THRESHOLD = 100_000;

  /** Sample large text for UI rendering without mounting full content. */
  function sampleLargeText(text: string): { display: string; isSampled: boolean } {
    if (text.length <= LARGE_TEXT_THRESHOLD) {
      return { display: text, isSampled: false };
    }
    const head = text.slice(0, 30_000);
    const tail = text.slice(-30_000);
    const omitted = text.length - head.length - tail.length;
    return {
      display: `${head}\n\n[… ${omitted.toLocaleString()} characters omitted for preview …]\n\n${tail}`,
      isSampled: true,
    };
  }

  const setAnalysisToExtracted = () => setAnalysisStage("extracted");
  const setAnalysisToCleaned = () => setAnalysisStage("cleaned");
  const setAnalysisToRelayouted = () => setAnalysisStage("relayouted");

  const handleImportProcessedToTextAnalysis = () => {
    const textToAnalyze = getStageText();
    if (!textToAnalyze.trim()) return;
    setText(textToAnalyze);
    setSourceName(fileSourceName || "preprocessed-sample");
    setProfile(null);
    const stageKey = analysisStage === "extracted" ? "style.stage.extracted" : analysisStage === "cleaned" ? "style.stage.cleaned" : "style.stage.relayouted";
    setAnalyzeStatus(`已使用「${t(stageKey as any)}」版本`);
    setActiveTab("diagnose");
  };

  const handleExport = () => {
    const textToExport = getStageText();
    if (!textToExport.trim()) return;
    try {
      const safeTitle = (fileSourceName || "export").replace(/[^\w\u4e00-\u9fa5._-]/g, "_");
      let content = textToExport;
      let mimeType = "text/plain";
      let extension = "txt";
      if (exportFormat === "md") {
        content = `# ${safeTitle}\n\n${textToExport}`;
        mimeType = "text/markdown";
        extension = "md";
      } else if (exportFormat === "html") {
        const escaped = textToExport
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
        content = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${safeTitle}</title><style>body{font-family:system-ui,sans-serif;line-height:1.7;max-width:720px;margin:40px auto;padding:0 20px;color:#333}pre{white-space:pre-wrap;word-wrap:break-word;font-family:inherit;line-height:inherit}</style></head><body><pre>${escaped}</pre></body></html>`;
        mimeType = "text/html";
        extension = "html";
      }
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeTitle}.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportStatus(t("style.exported"));
    } catch (e) {
      setExportStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleSaveAsAuthor = async (targetAuthorId?: string) => {
    const sampleText = text;
    const sampleSource = sourceName;
    const authorId = targetAuthorId ?? newAuthorId.trim();
    const authorName = targetAuthorId ? "" : newAuthorName.trim();

    if (!authorId || !sampleText.trim()) return;

    setAnalyzeStatus("Saving...");
    try {
      if (!targetAuthorId) {
        await postApi("/style/authors", {
          id: authorId,
          name: authorName || authorId,
          language: "zh",
          tags: newAuthorTags.split(",").map((s) => s.trim()).filter(Boolean),
        });
      }
      await postApi(`/style/authors/${authorId}/sources`, {
        sourceId: `${Date.now()}`,
        fileName: sampleSource || "sample",
        fileType: "txt",
        text: sampleText,
      });
      setAnalyzeStatus(t("style.sampleAdded"));
      setShowCreateForm(false);
      setNewAuthorId("");
      setNewAuthorName("");
      setNewAuthorTags("");
      refetchLibrary();
    } catch (e) {
      setAnalyzeStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

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
        {/* Layer 1: Basic Statistics */}
        <div>
          <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-3">{t("style.basicStats")}</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-secondary/30 rounded-lg p-3">
              <div className="text-muted-foreground text-xs">{t("style.avgSentence")}</div>
              <div className="text-xl font-bold">{p.avgSentenceLength.toFixed(1)}</div>
            </div>
            <div className="bg-secondary/30 rounded-lg p-3">
              <div className="text-muted-foreground text-xs">{t("style.vocabDiversity")}</div>
              <div className="text-xl font-bold">{(p.vocabularyDiversity * 100).toFixed(0)}%</div>
            </div>
            <div className="bg-secondary/30 rounded-lg p-3">
              <div className="text-muted-foreground text-xs">{t("style.avgParagraph")}</div>
              <div className="text-xl font-bold">{p.avgParagraphLength.toFixed(0)}</div>
            </div>
            <div className="bg-secondary/30 rounded-lg p-3">
              <div className="text-muted-foreground text-xs">{t("style.sentenceStdDev")}</div>
              <div className="text-xl font-bold">{p.sentenceLengthStdDev.toFixed(1)}</div>
            </div>
          </div>
        </div>

        {/* Layer 2: Style Fingerprint */}
        <div>
          <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-3">{t("style.fingerprint")}</h3>

          {/* Narrative Style */}
          <div className="mb-4">
            <div className="text-xs font-medium text-foreground mb-2">{t("style.narrativeStyle")}</div>
            <div className="space-y-2">
              {renderBar(t("style.dialogueRatio"), f.dialogueRatio, "bg-emerald-500")}
              {renderBar(t("style.actionDensity"), f.actionDensity, "bg-amber-500")}
              {renderBar(t("style.psychologicalRatio"), f.psychologicalRatio, "bg-purple-500")}
            </div>
          </div>

          {/* Language Temperament */}
          <div className="mb-4">
            <div className="text-xs font-medium text-foreground mb-2">{t("style.languageTemperament")}</div>
            <div className="space-y-2">
              {renderBar(t("style.colloquialism"), f.colloquialismScore, "bg-sky-500")}
              {renderBar(t("style.sensoryDensity"), f.sensoryDensity, "bg-rose-500")}
            </div>
            {f.sensoryBreakdown && (
              <div className="mt-2 flex gap-2 text-[10px]">
                {[
                  { key: "visual", label: t("style.visual"), val: f.sensoryBreakdown.visual },
                  { key: "auditory", label: t("style.auditory"), val: f.sensoryBreakdown.auditory },
                  { key: "tactile", label: t("style.tactile"), val: f.sensoryBreakdown.tactile },
                  { key: "olfactory", label: t("style.olfactory"), val: f.sensoryBreakdown.olfactory },
                  { key: "gustatory", label: t("style.gustatory"), val: f.sensoryBreakdown.gustatory },
                ].map((s) => (
                  <div key={s.key} className="flex-1 text-center">
                    <div className="text-muted-foreground">{s.label}</div>
                    <div className="font-medium">{(s.val * 100).toFixed(0)}%</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Expression Habits */}
          <div className="mb-4">
            <div className="text-xs font-medium text-foreground mb-2">{t("style.expressionHabits")}</div>
            <div className="space-y-2">
              {renderBar(t("style.rhetoricDensity"), f.rhetoricDensity, "bg-indigo-500")}
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">{t("style.punctuationRhythm")}</div>
                <div className="flex gap-1 h-1.5">
                  <div className="bg-secondary rounded-l-full" style={{ width: `${f.punctuationRhythm.commaRatio * 100}%` }} />
                  <div className="bg-primary" style={{ width: `${f.punctuationRhythm.periodRatio * 100}%` }} />
                  <div className="bg-amber-500" style={{ width: `${f.punctuationRhythm.questionRatio * 100}%` }} />
                  <div className="bg-rose-500" style={{ width: `${f.punctuationRhythm.exclamationRatio * 100}%` }} />
                  <div className="bg-purple-500 rounded-r-full" style={{ width: `${f.punctuationRhythm.ellipsisRatio * 100}%` }} />
                </div>
                <div className="flex gap-2 text-[10px] text-muted-foreground">
                  <span>，{(f.punctuationRhythm.commaRatio * 100).toFixed(0)}%</span>
                  <span>。{(f.punctuationRhythm.periodRatio * 100).toFixed(0)}%</span>
                  <span>？{(f.punctuationRhythm.questionRatio * 100).toFixed(0)}%</span>
                  <span>！{(f.punctuationRhythm.exclamationRatio * 100).toFixed(0)}%</span>
                  <span>…{(f.punctuationRhythm.ellipsisRatio * 100).toFixed(0)}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Narrative Control */}
          <div>
            <div className="text-xs font-medium text-foreground mb-2">{t("style.narrativeControl")}</div>
            {renderBar(t("style.aiTellRisk"), f.aiTellRisk, f.aiTellRisk > 0.5 ? "bg-destructive" : "bg-emerald-500")}
          </div>
        </div>

        {p.topPatterns.length > 0 && (
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">{t("style.topPatterns")}</div>
            <div className="flex gap-2 flex-wrap">
              {p.topPatterns.map((pt) => (
                <span key={pt} className="px-2 py-1 text-xs bg-secondary rounded">{pt}</span>
              ))}
            </div>
          </div>
        )}
        {p.rhetoricalFeatures.length > 0 && (
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">{t("style.rhetoricalFeatures")}</div>
            <div className="flex gap-2 flex-wrap">
              {p.rhetoricalFeatures.map((f2) => (
                <span key={f2} className="px-2 py-1 text-xs bg-primary/10 text-primary rounded">{f2}</span>
              ))}
            </div>
          </div>
        )}

        {/* Save to library */}
        <div className="border-t border-border pt-4 mt-4 space-y-3">
          <h4 className="font-semibold text-sm flex items-center gap-2">
            <Library size={14} />
            {t("style.saveAsAuthor")}
          </h4>
          {!showCreateForm ? (
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setShowCreateForm(true)}
                className={`px-3 py-1.5 text-xs rounded-lg ${c.btnPrimary} flex items-center gap-1`}
              >
                <Plus size={12} />
                {t("style.createAuthor")}
              </button>
              {libraryData && libraryData.authors.length > 0 && (
                <select
                  value={newAuthorId}
                  onChange={(e) => { setNewAuthorId(e.target.value); if (e.target.value) handleSaveAsAuthor(e.target.value); }}
                  className="px-3 py-1.5 rounded-lg bg-secondary/30 border border-border text-xs"
                >
                  <option value="">{t("style.appendToAuthor")}</option>
                  {libraryData.authors.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <input
                type="text"
                placeholder={t("style.authorId")}
                value={newAuthorId}
                onChange={(e) => setNewAuthorId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm"
              />
              <input
                type="text"
                placeholder={t("style.authorName")}
                value={newAuthorName}
                onChange={(e) => setNewAuthorName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm"
              />
              <input
                type="text"
                placeholder={t("style.tags")}
                value={newAuthorTags}
                onChange={(e) => setNewAuthorTags(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleSaveAsAuthor()}
                  disabled={!newAuthorId.trim()}
                  className={`px-3 py-1.5 text-xs rounded-lg ${c.btnPrimary} disabled:opacity-30`}
                >
                  {t("common.save")}
                </button>
                <button
                  onClick={() => { setShowCreateForm(false); setNewAuthorId(""); setNewAuthorName(""); setNewAuthorTags(""); }}
                  className={`px-3 py-1.5 text-xs rounded-lg ${c.btnSecondary}`}
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          )}

          {showImport && (
            <div className="border-t border-border pt-4 mt-4 space-y-3">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <Upload size={14} />
                {t("style.importToBook")}
              </h4>
              <select
                value={importBookId}
                onChange={(e) => setImportBookId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm"
              >
                <option value="">{t("style.selectBook")}</option>
                {booksData?.books.map((b) => (
                  <option key={b.id} value={b.id}>{b.title}</option>
                ))}
              </select>
              <button
                onClick={handleImport}
                disabled={!importBookId}
                className={`px-4 py-2 text-sm rounded-lg ${c.btnSecondary} disabled:opacity-30`}
              >
                {t("style.importGuide")}
              </button>
              {importStatus && <div className="text-xs text-muted-foreground">{importStatus}</div>}
            </div>
          )}
        </div>
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

      {/* Step progression — unified style analysis workflow */}
      <div className="flex gap-0 border border-border/40 rounded-lg overflow-hidden">
        {([
          { key: "import", label: "1. 文本导入" },
          { key: "diagnose", label: "2. 文风诊断" },
          { key: "ai-detect", label: "3. AI 检测" },
          { key: "deduplicate", label: "4. 修辞去重" },
          { key: "audit", label: "5. 应用审计" },
          { key: "distillation", label: "6. 蒸馏规则" },
        ] as const).map((step, idx) => {
          const stepKeys: ReadonlyArray<StyleTab> = ["import", "diagnose", "ai-detect", "deduplicate", "audit", "distillation"];
          const currentIdx = stepKeys.indexOf(activeTab);
          const thisIdx = stepKeys.indexOf(step.key);
          const completed = thisIdx >= 0 && thisIdx < currentIdx;
          const active = thisIdx === currentIdx;
          return (
            <button
              key={step.key}
              onClick={() => setActiveTab(step.key)}
              className={`flex-1 px-3 py-2.5 text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                active
                  ? "bg-primary text-primary-foreground"
                  : completed
                    ? "bg-primary/10 text-primary hover:bg-primary/15"
                    : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
              }`}
            >
              <span className="hidden sm:inline">{step.label}</span>
              {completed && <span className="text-[10px] opacity-70 ml-1">✓</span>}
            </button>
          );
        })}
      </div>

      {/* Step 1: Text Import & Analysis */}
      {activeTab === "import" && (
        <StyleImportTab
          text={text} setText={setText}
          sourceName={sourceName} setSourceName={setSourceName}
          urlSource={urlSource} setUrlSource={setUrlSource}
          profile={profile} diagnostics={diagnostics}
          loading={loading} loadingDiagnostics={loadingDiagnostics}
          textFileInputRef={textFileInputRef}
          fileAnalysisInputRef={fileAnalysisInputRef}
          libraryData={libraryData} booksData={booksData}
          fileText={fileText} fileSourceName={fileSourceName} setFileSourceName={setFileSourceName}
          fileType={fileType} extractedDoc={extractedDoc}
          loadedChunks={loadedChunks} loadingChunk={loadingChunk}
          activePreset={activePreset} analysisStage={analysisStage}
          preprocessedText={preprocessedText} preprocessActions={preprocessActions}
          showPreprocessPanel={showPreprocessPanel} setShowPreprocessPanel={setShowPreprocessPanel}
          filterCode={filterCode} setFilterCode={setFilterCode}
          filterRepeatedPrompts={filterRepeatedPrompts} setFilterRepeatedPrompts={setFilterRepeatedPrompts}
          filterUrls={filterUrls} setFilterUrls={setFilterUrls}
          filterStructuredData={filterStructuredData} setFilterStructuredData={setFilterStructuredData}
          stripMarkdown={stripMarkdown} setStripMarkdown={setStripMarkdown}
          deduplicateParagraphs={deduplicateParagraphs} setDeduplicateParagraphs={setDeduplicateParagraphs}
          filterTimestamps={filterTimestamps} setFilterTimestamps={setFilterTimestamps}
          filterIds={filterIds} setFilterIds={setFilterIds}
          filterNoiseMarkers={filterNoiseMarkers} setFilterNoiseMarkers={setFilterNoiseMarkers}
          minLineLength={minLineLength} setMinLineLength={setMinLineLength}
          setActivePreset={setActivePreset as unknown as (v: string) => void}
          relayoutedText={relayoutedText}
          showRelayoutPanel={showRelayoutPanel} setShowRelayoutPanel={setShowRelayoutPanel}
          mergeShortParagraphs={mergeShortParagraphs} setMergeShortParagraphs={setMergeShortParagraphs}
          formatDialogue={formatDialogue} setFormatDialogue={setFormatDialogue}
          ensureParagraphSpacing={ensureParagraphSpacing} setEnsureParagraphSpacing={setEnsureParagraphSpacing}
          normalizeQuotes={normalizeQuotes} setNormalizeQuotes={setNormalizeQuotes}
          compressBlankLines={compressBlankLines} setCompressBlankLines={setCompressBlankLines}
          inspectionResult={inspectionResult}
          showRiskConfirm={showRiskConfirm} setShowRiskConfirm={setShowRiskConfirm}
          pendingRiskStats={pendingRiskStats} setPendingRiskStats={setPendingRiskStats}
          showExportPanel={showExportPanel} setShowExportPanel={setShowExportPanel}
          exportFormat={exportFormat} setExportFormat={setExportFormat as unknown as (v: string) => void}
          exportStatus={exportStatus}
          importBookId={importBookId} importChapterNumber={importChapterNumber}
          setImportChapterNumber={setImportChapterNumber} chapterIndex={chapterIndex}
          c={c} t={t}
          handleTextLocalFile={handleTextLocalFile}
          handleImportUrl={handleImportUrl}
          handleAnalyze={handleAnalyze}
          handleDiagnostics={handleDiagnostics}
          handleImportBookChapter={handleImportBookChapter}
          handleSelectBook={handleSelectBook}
          handleFileAnalysisLocalFile={handleFileAnalysisLocalFile}
          handleExtractText={handleExtractText}
          handleLoadNextChunk={handleLoadNextChunk}
          runPreprocess={runPreprocess}
          runRelayout={runRelayout}
          handleRunPreprocess={handleRunPreprocess}
          getStageText={getStageText}
          sampleLargeText={sampleLargeText}
          setAnalysisToExtracted={setAnalysisToExtracted}
          setAnalysisToCleaned={setAnalysisToCleaned}
          setAnalysisToRelayouted={setAnalysisToRelayouted}
          handleImportProcessedToTextAnalysis={handleImportProcessedToTextAnalysis}
          handleExport={handleExport}
          renderProfileCard={renderProfileCard}
        />
      )}

      {/* Step 3: AI Detection */}
      {activeTab === "ai-detect" && (
        <StyleAiDetectTab text={text} t={t} />
      )}

      {/* Step 2: Style Diagnosis */}
      {activeTab === "diagnose" && (
        <StyleDiagnoseTab
          text={text}
          profile={profile}
          diagnostics={diagnostics}
          loadingDiagnostics={loadingDiagnostics}
          importBookId={importBookId}
          importChapterNumber={importChapterNumber}
          renderProfileCard={renderProfileCard}
          c={c}
          t={t}
          handleDiagnostics={handleDiagnostics}
        />
      )}

      {/* Step 4: Rhetoric Deduplication */}
      {activeTab === "deduplicate" && (
        <StyleDeduplicateTab
          text={text}
          setText={setText}
          setAnalyzeStatus={setAnalyzeStatus}
          c={c}
        />
      )}

      {/* Step: File Processing — moved to StyleImportTab */}

      {/* Step 5: Audit - Author Library */}
      {activeTab === "audit" && (
        <StyleAuditTab
          text={text}
          setText={setText}
          profile={profile}
          setProfile={setProfile}
          diagnostics={diagnostics}
          setDiagnostics={setDiagnostics}
          libraryData={libraryData ?? undefined}
          refetchLibrary={refetchLibrary as () => void}
          booksData={booksData ?? undefined}
          c={c}
          t={t}
          setAnalyzeStatus={setAnalyzeStatus}
          handleAnalyze={handleAnalyze}
          handleDiagnostics={handleDiagnostics}
          authorSampleInputRef={authorSampleInputRef}
          loading={loading}
        />
      )}

      {/* Step 6: Distillation — writer style distillation rules */}
      {activeTab === "distillation" && (
        <DistillationPage
          authorId={selectedAuthorId ?? ""}
          nav={nav}
          theme={theme}
          t={t}
        />
      )}

      {statusNotice && (
        <div
          className={`px-4 py-3 rounded-lg text-sm ${
            statusNotice.tone === "error"
              ? "bg-destructive/10 text-destructive"
              : statusNotice.tone === "info"
                ? "bg-secondary text-muted-foreground"
                : "bg-emerald-500/10 text-emerald-600"
          }`}
        >
          {statusNotice.message}
        </div>
      )}

    </div>
  );
}
