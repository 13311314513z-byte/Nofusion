import { useState, useCallback, useRef, useMemo, type ChangeEvent } from "react";
import { fetchJson, useApi, postApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { Wand2, Upload, BarChart3, FileText, Library, Plus, RefreshCw, Trash2, AlertCircle, Link, ChevronDown, ChevronRight, AlertTriangle, Stethoscope, User } from "lucide-react";
import { StyleDiagnosticsPanel } from "../components/style/StyleDiagnosticsPanel.js";
import { AITellsPanel } from "../components/style/AITellsPanel.js";
import { AdjustmentSuggestionsPanel } from "./style-manager/AdjustmentSuggestionsPanel.js";
import { AuthorStyleComparison } from "./style-manager/AuthorStyleComparison.js";
import { ReadabilityDashboard } from "../components/readability/ReadabilityDashboard.js";
import { DuplicateParagraphPanel } from "../components/readability/DuplicateParagraphPanel.js";
import { RhetoricIssuePanel } from "../components/readability/RhetoricIssuePanel.js";
import { StyleTextTab } from "./StyleTextTab.js";
import { DistillationPage } from "./DistillationPage";
import { StyleAiDetectTab } from "./style-manager/StyleAiDetectTab.js";
import { StyleDiagnoseTab } from "./style-manager/StyleDiagnoseTab.js";
import { StyleDeduplicateTab } from "./style-manager/StyleDeduplicateTab.js";
import { StyleAuditTab } from "./style-manager/StyleAuditTab.js";
import type { FullStyleDiagnostics } from "@actalk/inkos-core";
import type { PresetId, RiskLevel, TextStage, InspectionResult, InspectionFinding } from "./style-preprocess-state.js";
import { PRESETS, getPreset, computeRemovalStats, requiresConfirmation, buildSnapshot, getInvalidatedStages } from "./style-preprocess-state.js";
import type { CoreStyleProfile, AuthorIndexItem, AuthorDetail, ExtractedDoc, BookSummary } from "./style-types.js";

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

  // Audit state — moved to StyleAuditTab

  // Apply state — moved to StyleAuditTab

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
        <StyleTextTab
          text={text}
          setText={setText}
          sourceName={sourceName}
          setSourceName={setSourceName}
          urlSource={urlSource}
          setUrlSource={setUrlSource}
          profile={profile}
          diagnostics={diagnostics}
          loading={loading}
          loadingDiagnostics={loadingDiagnostics}
          textFileInputRef={textFileInputRef}
          libraryData={libraryData}
          booksData={booksData}
          c={c}
          t={t as unknown as (key: string) => string}
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

      {/* Step: File Processing (shown alongside import) */}
      {activeTab === "import" && fileText && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-2">{t("style.sourceName")}</label>
              <input
                type="text"
                value={fileSourceName}
                onChange={(e) => setFileSourceName(e.target.value)}
                placeholder={t("style.sourceExample")}
                className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-2">{t("style.textSample")}</label>
              {(() => {
                const { display, isSampled } = sampleLargeText(fileText);
                return (
                  <>
                    {isSampled && (
                      <div className="text-xs text-amber-600 mb-1">
                        {t("style.largeTextSampled")} ({fileText.length.toLocaleString()} chars)
                      </div>
                    )}
                    <textarea
                      value={display}
                      onChange={(e) => setFileText(e.target.value)}
                      rows={10}
                      placeholder={t("style.uploadHint")}
                      className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm focus:outline-none focus:border-primary resize-none font-mono"
                    />
                  </>
                );
              })()}
            </div>
            <div className="flex gap-3 items-center flex-wrap">
              <input
                ref={fileAnalysisInputRef}
                type="file"
                accept=".txt,.md,.markdown,.jsonl,.json,.ts,.js,.html,.htm,.css"
                className="hidden"
                onChange={handleFileAnalysisLocalFile}
              />
              <button
                onClick={() => fileAnalysisInputRef.current?.click()}
                disabled={loading}
                className={`px-4 py-2 text-sm rounded-lg ${c.btnSecondary} disabled:opacity-30 flex items-center gap-2`}
              >
                <Upload size={14} />
                {t("style.importLocalFile")}
              </button>
              <select
                value={fileType}
                onChange={(e) => setFileType(e.target.value as LocalStyleFileType)}
                className="px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm"
              >
                <option value="txt">.txt</option>
                <option value="md">.md</option>
                <option value="jsonl">.jsonl</option>
                <option value="json">.json</option>
                <option value="ts">.ts</option>
                <option value="js">.js</option>
                <option value="html">.html</option>
                <option value="css">.css</option>
              </select>
              <button
                onClick={handleExtractText}
                disabled={!fileText.trim() || loading}
                className={`px-4 py-2 text-sm rounded-lg ${c.btnPrimary} disabled:opacity-30 flex items-center gap-2`}
              >
                <FileText size={14} />
                {loading ? t("style.processing") : t("style.extractText")}
              </button>
              <button
                onClick={handleImportProcessedToTextAnalysis}
                disabled={!getStageText().trim()}
                className={`px-4 py-2 text-sm rounded-lg ${c.btnSecondary} disabled:opacity-30 flex items-center gap-2`}
              >
                <BarChart3 size={14} />
                {t("style.importToTextAnalysis")}
              </button>
            </div>
            {extractedDoc && extractedDoc.warnings.length > 0 && (
              <div className="space-y-1">
                {extractedDoc.warnings.map((w, i) => (
                  <div key={i} className="flex items-center gap-1 text-xs text-amber-600">
                    <AlertCircle size={12} />
                    {w}
                  </div>
                ))}
              </div>
            )}

            {/* Chunked extraction indicator */}
            {extractedDoc && extractedDoc.totalChunks !== undefined && extractedDoc.totalChunks > 1 && (
              <div className="flex items-center gap-2 text-xs text-secondary">
                <FileText size={12} />
                <span>
                  {t("style.chunkProgress").replace("{{loaded}}", String(loadedChunks)).replace("{{total}}", String(extractedDoc.totalChunks))}
                </span>
                {loadedChunks < extractedDoc.totalChunks && (
                  <button
                    className={`text-xs px-2 py-0.5 rounded ${c.btnSecondary} hover:opacity-80`}
                    onClick={handleLoadNextChunk}
                    disabled={loadingChunk}
                  >
                    {loadingChunk ? t("common.loading") : t("style.loadNextChunk")}
                  </button>
                )}
                {loadedChunks === extractedDoc.totalChunks && (
                  <span className="text-green-600">{t("style.allChunksLoaded")}</span>
                )}
              </div>
            )}

            {/* Preprocess Panel */}
            <div className={`border ${c.cardStatic} rounded-lg p-4 space-y-3`}>
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-sm">{t("style.preprocessTitle")}</h4>
                <button
                  onClick={() => setShowPreprocessPanel(!showPreprocessPanel)}
                  className={`text-xs px-2 py-1 rounded ${showPreprocessPanel ? c.btnPrimary : c.btnSecondary}`}
                >
                  {showPreprocessPanel ? t("common.on") : t("common.off")}
                </button>
              </div>
              {showPreprocessPanel && (
                <div className="space-y-2">
                  {/* Preset selector */}
                  <div className="flex flex-wrap gap-1.5">
                    {PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        onClick={() => {
                          setActivePreset(preset.id);
                          setFilterCode(preset.preprocess.filterCode ?? false);
                          setFilterRepeatedPrompts(preset.preprocess.filterRepeatedPrompts ?? false);
                          setFilterUrls(preset.preprocess.filterUrls ?? false);
                          setFilterStructuredData(preset.preprocess.filterStructuredData ?? false);
                          setStripMarkdown(preset.preprocess.stripMarkdown ?? false);
                          setDeduplicateParagraphs(preset.preprocess.deduplicateParagraphs ?? false);
                          setFilterTimestamps(preset.preprocess.filterTimestamps ?? false);
                          setFilterIds(preset.preprocess.filterIds ?? false);
                          setFilterNoiseMarkers(preset.preprocess.filterNoiseMarkers ?? false);
                          setMinLineLength(preset.preprocess.minLineLength ?? 0);
                          // Also update relayout options to match preset
                          setMergeShortParagraphs(preset.relayout.mergeShortParagraphs ?? false);
                          setFormatDialogue(preset.relayout.formatDialogue ?? false);
                          setEnsureParagraphSpacing(preset.relayout.ensureParagraphSpacing ?? false);
                          setNormalizeQuotes(preset.relayout.normalizeQuotes ?? false);
                          setCompressBlankLines(preset.relayout.compressBlankLines ?? false);
                        }}
                        className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                          activePreset === preset.id
                            ? `${c.btnPrimary} border-transparent`
                            : `${c.btnSecondary} border-border hover:opacity-80`
                        } ${preset.risk === "high" ? "text-amber-600" : ""}`}
                        title={t(preset.descriptionKey as any)}
                      >
                        {t(preset.labelKey as any)}
                      </button>
                    ))}
                  </div>

                  {/* Options grid */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={filterCode} onChange={(e) => { setFilterCode(e.target.checked); setActivePreset("custom" as any); }} />
                      <span>{t("style.filterCode")}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={filterRepeatedPrompts} onChange={(e) => { setFilterRepeatedPrompts(e.target.checked); setActivePreset("custom" as any); }} />
                      <span className={filterRepeatedPrompts ? "text-amber-600" : ""}>{t("style.filterRepeatedPrompts")}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={filterUrls} onChange={(e) => { setFilterUrls(e.target.checked); setActivePreset("custom" as any); }} />
                      <span>{t("style.filterUrls")}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={filterStructuredData} onChange={(e) => { setFilterStructuredData(e.target.checked); setActivePreset("custom" as any); }} />
                      <span className="text-amber-600">{t("style.filterStructuredData")}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={stripMarkdown} onChange={(e) => { setStripMarkdown(e.target.checked); setActivePreset("custom" as any); }} />
                      <span>{t("style.stripMarkdown")}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={deduplicateParagraphs} onChange={(e) => { setDeduplicateParagraphs(e.target.checked); setActivePreset("custom" as any); }} />
                      <span>{t("style.deduplicateParagraphs")}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={filterTimestamps} onChange={(e) => { setFilterTimestamps(e.target.checked); setActivePreset("custom" as any); }} />
                      <span>{t("style.filterTimestamps")}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={filterIds} onChange={(e) => { setFilterIds(e.target.checked); setActivePreset("custom" as any); }} />
                      <span>{t("style.filterIds")}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={filterNoiseMarkers} onChange={(e) => { setFilterNoiseMarkers(e.target.checked); setActivePreset("custom" as any); }} />
                      <span>{t("style.filterNoiseMarkers")}</span>
                    </label>
                  </div>

                  {/* Numeric threshold */}
                  <div className="flex items-center gap-2 text-xs">
                    <span>{t("style.minLineLength")}</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={minLineLength}
                      onChange={(e) => { setMinLineLength(Math.max(0, Math.min(100, Number(e.target.value) || 0))); setActivePreset("custom" as any); }}
                      className="w-16 px-1.5 py-0.5 rounded border border-border bg-background text-xs text-right"
                    />
                    <span className="text-muted-foreground">(0 = {t("common.off")})</span>
                  </div>

                  {/* Inspection results */}
                  {inspectionResult && inspectionResult.findings.length > 0 && (
                    <div className="space-y-1 p-2 rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {t("style.inspect.title")}（{inspectionResult.findings.length}）
                      </div>
                      {inspectionResult.findings.map((f, i) => (
                        <div key={i} className="text-xs text-amber-600 dark:text-amber-500">
                          {f.count > 1 ? `${t(f.messageKey as any)}（${f.count} 处）` : t(f.messageKey as any)}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Actions log */}
                  {preprocessActions.length > 0 && (
                    <div className="space-y-1">
                      {preprocessActions.map((a, i) => (
                        <div key={i} className="text-xs text-muted-foreground">✓ {a}</div>
                      ))}
                    </div>
                  )}

                  {/* Run button with risk warning */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleRunPreprocess(extractedDoc?.text || fileText)}
                      disabled={!(extractedDoc?.text || fileText).trim() || loading}
                      className={`px-3 py-1.5 text-xs rounded-lg ${c.btnPrimary} disabled:opacity-30`}
                    >
                      {t("style.runPreprocess")}
                    </button>
                    {preprocessedText && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{t("style.removalRate")}: {((extractedDoc?.text.length ?? 1 - preprocessedText.length) / (extractedDoc?.text.length ?? 1) * 100).toFixed(1)}%</span>
                      </div>
                    )}
                  </div>

                  {/* Analysis stage selector */}
                  {preprocessedText && (
                    <div className="flex flex-wrap items-center gap-2 p-2 rounded bg-primary/5 border border-primary/20">
                      <span className="text-xs font-medium">{t("style.stage.analysisSource")}:</span>
                      <button
                        onClick={setAnalysisToExtracted}
                        className={`text-xs px-2 py-0.5 rounded ${analysisStage === "extracted" ? c.btnPrimary : c.btnSecondary}`}
                      >
                        {t("style.stage.extracted")}（{extractedDoc?.text.length.toLocaleString()}）
                      </button>
                      <button
                        onClick={setAnalysisToCleaned}
                        className={`text-xs px-2 py-0.5 rounded ${analysisStage === "cleaned" ? c.btnPrimary : c.btnSecondary}`}
                      >
                        {t("style.stage.cleaned")}（{preprocessedText.length.toLocaleString()}）
                      </button>
                      {relayoutedText && (
                        <button
                          onClick={setAnalysisToRelayouted}
                          className={`text-xs px-2 py-0.5 rounded ${analysisStage === "relayouted" ? c.btnPrimary : c.btnSecondary}`}
                        >
                          {t("style.stage.relayouted")}（{relayoutedText.length.toLocaleString()}）
                        </button>
                      )}
                    </div>
                  )}

                  {/* Preview */}
                  {preprocessedText && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">
                        {t("style.preprocessed")}（{getStageText().length.toLocaleString()} {t("truth.chars")}）
                      </div>
                      <textarea
                        value={getStageText()}
                        readOnly
                        rows={4}
                        className="w-full px-2 py-1 rounded bg-secondary/20 border border-border text-xs font-mono resize-none"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Relayout Panel */}
            <div className={`border ${c.cardStatic} rounded-lg p-4 space-y-3`}>
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-sm">{t("style.relayoutTitle")}</h4>
                <button
                  onClick={() => setShowRelayoutPanel(!showRelayoutPanel)}
                  className={`text-xs px-2 py-1 rounded ${showRelayoutPanel ? c.btnPrimary : c.btnSecondary}`}
                >
                  {showRelayoutPanel ? t("common.on") : t("common.off")}
                </button>
              </div>
              {showRelayoutPanel && (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={mergeShortParagraphs} onChange={(e) => setMergeShortParagraphs(e.target.checked)} />
                      <span>{t("style.mergeShortParagraphs")}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={formatDialogue} onChange={(e) => setFormatDialogue(e.target.checked)} />
                      <span>{t("style.formatDialogue")}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={normalizeQuotes} onChange={(e) => setNormalizeQuotes(e.target.checked)} />
                      <span>{t("style.normalizeQuotes")}</span>
                    </label>
                  </div>
                  <button
                    onClick={() => runRelayout(preprocessedText || extractedDoc?.text || fileText)}
                    disabled={!(preprocessedText || extractedDoc?.text || fileText).trim() || loading}
                    className={`px-3 py-1.5 text-xs rounded-lg ${c.btnPrimary} disabled:opacity-30`}
                  >
                    {t("style.runRelayout")}
                  </button>
                  {relayoutedText && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">{t("style.relayouted")}（{relayoutedText.length} {t("truth.chars")}）</div>
                      <textarea
                        value={relayoutedText}
                        readOnly
                        rows={4}
                        className="w-full px-2 py-1 rounded bg-secondary/20 border border-border text-xs font-mono resize-none"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Export Panel */}
            <div className={`border ${c.cardStatic} rounded-lg p-4 space-y-3`}>
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-sm">{t("style.exportTitle")}</h4>
                <button
                  onClick={() => setShowExportPanel(!showExportPanel)}
                  className={`text-xs px-2 py-1 rounded ${showExportPanel ? c.btnPrimary : c.btnSecondary}`}
                >
                  {showExportPanel ? t("common.on") : t("common.off")}
                </button>
              </div>
              {showExportPanel && (
                <div className="flex gap-2 items-center">
                  <select
                    value={exportFormat}
                    onChange={(e) => setExportFormat(e.target.value as "txt" | "md" | "html")}
                    className="px-3 py-1.5 rounded-lg bg-secondary/30 border border-border text-xs"
                  >
                    <option value="txt">.txt</option>
                    <option value="md">.md</option>
                    <option value="html">.html</option>
                  </select>
                  <button
                    onClick={handleExport}
                    disabled={!extractedDoc && !fileText}
                    className={`px-3 py-1.5 text-xs rounded-lg ${c.btnPrimary} disabled:opacity-30`}
                  >
                    {t("style.export")}
                  </button>
                  {exportStatus && <span className="text-xs text-muted-foreground">{exportStatus}</span>}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            {(preprocessedText || extractedDoc?.text) ? (
              <div className={`border ${c.cardStatic} rounded-lg p-5 space-y-4`}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">{t("style.preprocessResult")}</h3>
                  <button
                    onClick={handleImportProcessedToTextAnalysis}
                    className={`px-3 py-1.5 text-xs rounded-lg ${c.btnPrimary} flex items-center gap-1`}
                  >
                    <BarChart3 size={12} />
                    {t("style.importToTextAnalysis")}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-secondary/30 rounded-lg p-3">
                    <div className="text-muted-foreground text-xs">{t("style.extractedChars")}</div>
                    <div className="text-xl font-bold">{(extractedDoc?.charCount ?? 0).toLocaleString()}</div>
                  </div>
                  <div className="bg-secondary/30 rounded-lg p-3">
                    <div className="text-muted-foreground text-xs">{t("style.finalChars")}</div>
                    <div className="text-xl font-bold">{getStageText().length.toLocaleString()}</div>
                  </div>
                </div>
                <textarea
                  value={getStageText()}
                  readOnly
                  rows={18}
                  className="w-full px-3 py-2 rounded-lg bg-secondary/20 border border-border text-xs focus:outline-none resize-none font-mono"
                />
              </div>
            ) : (
              !loading && (
                <div className={`border border-dashed ${c.cardStatic} rounded-lg p-8 text-center text-muted-foreground text-sm italic`}>
                  {t("style.preprocessEmptyHint")}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Step 5: Audit - Author Library */}
      {activeTab === "audit" && (
        <StyleAuditTab
          text={text}
          setText={setText}
          profile={profile}
          setProfile={setProfile}
          diagnostics={diagnostics}
          setDiagnostics={setDiagnostics}
          libraryData={libraryData}
          refetchLibrary={refetchLibrary}
          booksData={booksData}
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

      {/* Risk confirmation modal */}
      {showRiskConfirm && pendingRiskStats && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md p-6 rounded-xl bg-background border border-border shadow-xl space-y-4">
            <h3 className="text-lg font-semibold text-destructive">{t("style.riskConfirmTitle")}</h3>
            <div className="space-y-2 text-sm">
              <p>{t("style.riskConfirmMessage")}</p>
              <ul className="list-disc list-inside text-muted-foreground">
                {pendingRiskStats.highRiskOptions.map((opt) => (
                  <li key={opt}>{opt}</li>
                ))}
              </ul>
              <p className="font-medium">{t("style.removalRate")}: {(pendingRiskStats.removalRate * 100).toFixed(1)}%</p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowRiskConfirm(false); setPendingRiskStats(null); }}
                className={`px-3 py-1.5 text-xs rounded-lg ${c.btnSecondary}`}
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => {
                  setShowRiskConfirm(false);
                  const text = extractedDoc?.text || fileText;
                  runPreprocess(text);
                  setPendingRiskStats(null);
                }}
                className={`px-3 py-1.5 text-xs rounded-lg ${c.btnPrimary}`}
              >
                {t("common.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
