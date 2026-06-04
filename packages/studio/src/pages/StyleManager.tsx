import { useState, useCallback, useRef, type ChangeEvent } from "react";
import { fetchJson, useApi, postApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { Wand2, Upload, BarChart3, FileText, Library, Plus, RefreshCw, Trash2, AlertCircle, Link } from "lucide-react";


interface PunctuationRhythm {
  readonly commaRatio: number;
  readonly periodRatio: number;
  readonly questionRatio: number;
  readonly exclamationRatio: number;
  readonly ellipsisRatio: number;
  readonly semicolonRatio: number;
}

interface StyleFingerprint {
  readonly dialogueRatio: number;
  readonly actionDensity: number;
  readonly psychologicalRatio: number;
  readonly sensoryDensity: number;
  readonly colloquialismScore: number;
  readonly rhetoricDensity: number;
  readonly punctuationRhythm: PunctuationRhythm;
  readonly aiTellRisk: number;
  readonly sensoryBreakdown: {
    readonly visual: number;
    readonly auditory: number;
    readonly tactile: number;
    readonly olfactory: number;
    readonly gustatory: number;
  };
}

interface CoreStyleProfile {
  readonly sourceName: string;
  readonly avgSentenceLength: number;
  readonly sentenceLengthStdDev: number;
  readonly avgParagraphLength: number;
  readonly vocabularyDiversity: number;
  readonly topPatterns: ReadonlyArray<string>;
  readonly rhetoricalFeatures: ReadonlyArray<string>;
  readonly fingerprint: StyleFingerprint;
}

interface AuthorIndexItem {
  readonly id: string;
  readonly name: string;
  readonly language: "zh" | "en";
  readonly tags: ReadonlyArray<string>;
  readonly sourceCount: number;
  readonly updatedAt: string;
}

interface AuthorProfile {
  readonly id: string;
  readonly name: string;
  readonly language: "zh" | "en";
  readonly tags: ReadonlyArray<string>;
  readonly sampleStats: { readonly sourceCount: number; readonly totalChars: number; readonly avgCharsPerSource: number };
  readonly aggregateProfile: CoreStyleProfile;
}

interface AuthorDetail {
  readonly profile: AuthorProfile;
  readonly sources: ReadonlyArray<{
    readonly id: string;
    readonly fileName: string;
    readonly fileType: string;
    readonly charCount: number;
    readonly status: string;
    readonly error?: string;
  }>;
}

interface BookSummary {
  readonly id: string;
  readonly title: string;
}

interface ExtractedDoc {
  readonly sourceName?: string;
  readonly text: string;
  readonly charCount: number;
  readonly warnings: ReadonlyArray<string>;
}

type StyleTab = "text" | "files" | "library" | "apply";
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

function readLocalTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read local file"));
    reader.readAsText(file, "utf-8");
  });
}

export function StyleManager({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const [activeTab, setActiveTab] = useState<StyleTab>("text");
  const textFileInputRef = useRef<HTMLInputElement | null>(null);
  const fileAnalysisInputRef = useRef<HTMLInputElement | null>(null);
  const authorSampleInputRef = useRef<HTMLInputElement | null>(null);

  // Text analysis state
  const [text, setText] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [urlSource, setUrlSource] = useState("");
  const [profile, setProfile] = useState<CoreStyleProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzeStatus, setAnalyzeStatus] = useState("");

  // File analysis state
  const [fileText, setFileText] = useState("");
  const [fileSourceName, setFileSourceName] = useState("");
  const [fileType, setFileType] = useState<LocalStyleFileType>("txt");
  const [extractedDoc, setExtractedDoc] = useState<ExtractedDoc | null>(null);

  // Preprocess state
  const [preprocessedText, setPreprocessedText] = useState("");
  const [preprocessActions, setPreprocessActions] = useState<ReadonlyArray<string>>([]);
  const [showPreprocessPanel, setShowPreprocessPanel] = useState(true);
  const [filterCode, setFilterCode] = useState(true);
  const [filterRepeatedPrompts, setFilterRepeatedPrompts] = useState(true);
  const [filterUrls, setFilterUrls] = useState(true);
  const [filterStructuredData, setFilterStructuredData] = useState(true);
  const [stripMarkdown, setStripMarkdown] = useState(true);
  const [deduplicateParagraphs, setDeduplicateParagraphs] = useState(true);
  const [filterTimestamps, setFilterTimestamps] = useState(true);
  const [filterIds, setFilterIds] = useState(true);
  const [filterNoiseMarkers, setFilterNoiseMarkers] = useState(true);

  // Relayout state
  const [relayoutedText, setRelayoutedText] = useState("");
  const [showRelayoutPanel, setShowRelayoutPanel] = useState(false);
  const [mergeShortParagraphs, setMergeShortParagraphs] = useState(true);
  const [formatDialogue, setFormatDialogue] = useState(true);
  const [normalizeQuotes, setNormalizeQuotes] = useState(true);

  // Export state
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [exportFormat, setExportFormat] = useState<"txt" | "md" | "html">("txt");
  const [exportStatus, setExportStatus] = useState("");

  // Library state
  const { data: libraryData, refetch: refetchLibrary } = useApi<{ authors: ReadonlyArray<AuthorIndexItem> }>("/style/authors");
  const [selectedAuthorId, setSelectedAuthorId] = useState<string>("");
  const [authorDetail, setAuthorDetail] = useState<AuthorDetail | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newAuthorId, setNewAuthorId] = useState("");
  const [newAuthorName, setNewAuthorName] = useState("");
  const [newAuthorTags, setNewAuthorTags] = useState("");

  // Apply state
  const [applyAuthorId, setApplyAuthorId] = useState("");
  const [applyBookId, setApplyBookId] = useState("");
  const [applyStatus, setApplyStatus] = useState("");

  // Shared
  const [importBookId, setImportBookId] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const { data: booksData } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const statusNotice = buildStyleStatusNotice(analyzeStatus, importStatus || applyStatus);

  const loadAuthorDetail = useCallback(async (authorId: string) => {
    if (!authorId) { setAuthorDetail(null); return; }
    try {
      const data = await fetchJson<AuthorDetail>(`/style/authors/${authorId}`);
      setAuthorDetail(data);
    } catch (e) {
      setAuthorDetail(null);
    }
  }, []);

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

  const handleAuthorLocalSamples = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (files.length === 0) return;
    if (!selectedAuthorId) {
      setAnalyzeStatus(`Error: ${t("style.selectAuthor")}`);
      return;
    }

    setLoading(true);
    setAnalyzeStatus("Importing...");
    const seed = Date.now();
    let importedCount = 0;
    const failures: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const inferredType = inferLocalStyleFileType(file.name);
      if (!inferredType) {
        failures.push(file.name);
        continue;
      }

      try {
        const loadedText = await readLocalTextFile(file);
        await postApi(`/style/authors/${selectedAuthorId}/sources`, {
          sourceId: buildLocalStyleSourceId(file.name, seed, i),
          fileName: file.name,
          fileType: inferredType,
          text: loadedText,
        });
        importedCount++;
      } catch {
        failures.push(file.name);
      }
    }

    await refetchLibrary();
    await loadAuthorDetail(selectedAuthorId);
    setLoading(false);

    if (failures.length > 0) {
      setAnalyzeStatus(`Error: ${t("style.localSamplesPartial")} ${failures.join(", ")}`);
    } else {
      setAnalyzeStatus(`${t("style.localSamplesImported")} ${importedCount}`);
    }
  };

  const handleAnalyze = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setProfile(null);
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
    setPreprocessedText("");
    setPreprocessActions([]);
    setRelayoutedText("");
    setAnalyzeStatus("");
    try {
      const doc = await fetchJson<ExtractedDoc>("/style/extract-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: fileText, sourceName: fileSourceName || "sample", fileType }),
      });
      setExtractedDoc(doc);
      if (showPreprocessPanel && doc.text) {
        await runPreprocess(doc.text);
      }
      setAnalyzeStatus(t("style.extracted"));
    } catch (e) {
      setAnalyzeStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  const runPreprocess = async (sourceText: string) => {
    try {
      const result = await fetchJson<{ text: string; actions: string[] }>("/style/preprocess", {
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
            deduplicateParagraphs,
            filterTimestamps,
            filterIds,
            filterNoiseMarkers,
          },
        }),
      });
      setPreprocessedText(result.text);
      setPreprocessActions(result.actions);
      if (showRelayoutPanel) {
        await runRelayout(result.text);
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
            formatDialogue,
            normalizeQuotes,
          },
        }),
      });
      setRelayoutedText(result.text);
      setAnalyzeStatus(t("style.relayoutDone"));
    } catch (e) {
      setAnalyzeStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleImportProcessedToTextAnalysis = () => {
    const textToAnalyze = relayoutedText || preprocessedText || extractedDoc?.text || fileText;
    if (!textToAnalyze.trim()) return;
    setText(textToAnalyze);
    setSourceName(fileSourceName || "preprocessed-sample");
    setProfile(null);
    setAnalyzeStatus(t("style.importedToTextAnalysis"));
    setActiveTab("text");
  };

  const handleExport = () => {
    const textToExport = relayoutedText || preprocessedText || extractedDoc?.text || fileText;
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

  const handleCreateAuthorOnly = async () => {
    const authorId = newAuthorId.trim();
    const authorName = newAuthorName.trim();
    if (!authorId) return;

    setAnalyzeStatus("Saving...");
    try {
      await postApi("/style/authors", {
        id: authorId,
        name: authorName || authorId,
        language: "zh",
        tags: newAuthorTags.split(",").map((s) => s.trim()).filter(Boolean),
      });
      setAnalyzeStatus(t("style.authorCreated"));
      setShowCreateForm(false);
      setNewAuthorId("");
      setNewAuthorName("");
      setNewAuthorTags("");
      refetchLibrary();
    } catch (e) {
      setAnalyzeStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleApplyAuthor = async () => {
    if (!applyAuthorId || !applyBookId) return;
    if (!confirm(t("style.confirmApply"))) return;
    setApplyStatus("Applying...");
    try {
      await postApi(`/books/${applyBookId}/style/apply-author`, { authorId: applyAuthorId });
      setApplyStatus(t("style.applySuccess"));
    } catch (e) {
      setApplyStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleDeleteAuthor = async (authorId: string) => {
    if (!confirm(t("common.confirmDelete"))) return;
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

  const renderBar = (label: string, value: number, colorClass?: string) => (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{(value * 100).toFixed(0)}%</span>
      </div>
      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${colorClass ?? "bg-primary"}`}
          style={{ width: `${Math.min(value * 100, 100)}%` }}
        />
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

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {([
          { key: "text", label: t("style.tabs.text") },
          { key: "files", label: t("style.tabs.files") },
          { key: "library", label: t("style.tabs.library") },
          { key: "apply", label: t("style.tabs.apply") },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab: Text Analysis */}
      {activeTab === "text" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-2">{t("style.sourceName")}</label>
              <input
                type="text"
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                placeholder={t("style.sourceExample")}
                className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-2">{t("style.urlSource")}</label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={urlSource}
                  onChange={(e) => setUrlSource(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleImportUrl();
                    }
                  }}
                  placeholder={t("style.urlPlaceholder")}
                  className="min-w-0 flex-1 px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm focus:outline-none focus:border-primary"
                />
                <button
                  onClick={handleImportUrl}
                  disabled={!urlSource.trim() || loading}
                  className={`px-4 py-2 text-sm rounded-lg ${c.btnSecondary} disabled:opacity-30 flex items-center gap-2`}
                >
                  <Link size={14} />
                  {t("style.importUrl")}
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-2">{t("style.textSample")}</label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={12}
                placeholder={t("style.pasteHint")}
                className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm focus:outline-none focus:border-primary resize-none font-mono"
              />
            </div>
            <div className="flex gap-3">
              <input
                ref={textFileInputRef}
                type="file"
                accept=".txt,.md,.markdown,text/plain,text/markdown"
                className="hidden"
                onChange={handleTextLocalFile}
              />
              <button
                onClick={() => textFileInputRef.current?.click()}
                disabled={loading}
                className={`px-4 py-2 text-sm rounded-lg ${c.btnSecondary} disabled:opacity-30 flex items-center gap-2`}
              >
                <Upload size={14} />
                {t("style.importLocalFile")}
              </button>
              <button
                onClick={handleAnalyze}
                disabled={!text.trim() || loading}
                className={`px-4 py-2 text-sm rounded-lg ${c.btnPrimary} disabled:opacity-30 flex items-center gap-2`}
              >
                <BarChart3 size={14} />
                {loading ? t("style.analyzing") : t("style.analyze")}
              </button>
            </div>
          </div>
          <div className="space-y-4">
            {renderProfileCard(profile, true)}
            {!profile && !loading && (
              <div className={`border border-dashed ${c.cardStatic} rounded-lg p-8 text-center text-muted-foreground text-sm italic`}>
                {t("style.emptyHint")}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: File Analysis */}
      {activeTab === "files" && (
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
              <textarea
                value={fileText}
                onChange={(e) => setFileText(e.target.value)}
                rows={10}
                placeholder={t("style.uploadHint")}
                className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm focus:outline-none focus:border-primary resize-none font-mono"
              />
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
                disabled={!(relayoutedText || preprocessedText || extractedDoc?.text || fileText).trim()}
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
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={filterCode} onChange={(e) => setFilterCode(e.target.checked)} />
                      <span>{t("style.filterCode")}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={filterRepeatedPrompts} onChange={(e) => setFilterRepeatedPrompts(e.target.checked)} />
                      <span>{t("style.filterRepeatedPrompts")}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={filterUrls} onChange={(e) => setFilterUrls(e.target.checked)} />
                      <span>{t("style.filterUrls")}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={filterStructuredData} onChange={(e) => setFilterStructuredData(e.target.checked)} />
                      <span>{t("style.filterStructuredData")}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={stripMarkdown} onChange={(e) => setStripMarkdown(e.target.checked)} />
                      <span>{t("style.stripMarkdown")}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={deduplicateParagraphs} onChange={(e) => setDeduplicateParagraphs(e.target.checked)} />
                      <span>{t("style.deduplicateParagraphs")}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={filterTimestamps} onChange={(e) => setFilterTimestamps(e.target.checked)} />
                      <span>{t("style.filterTimestamps")}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={filterIds} onChange={(e) => setFilterIds(e.target.checked)} />
                      <span>{t("style.filterIds")}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={filterNoiseMarkers} onChange={(e) => setFilterNoiseMarkers(e.target.checked)} />
                      <span>{t("style.filterNoiseMarkers")}</span>
                    </label>
                  </div>
                  {preprocessActions.length > 0 && (
                    <div className="space-y-1">
                      {preprocessActions.map((a, i) => (
                        <div key={i} className="text-xs text-muted-foreground">✓ {a}</div>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => runPreprocess(extractedDoc?.text || fileText)}
                    disabled={!(extractedDoc?.text || fileText).trim() || loading}
                    className={`px-3 py-1.5 text-xs rounded-lg ${c.btnPrimary} disabled:opacity-30`}
                  >
                    {t("style.runPreprocess")}
                  </button>
                  {preprocessedText && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">{t("style.preprocessed")}（{preprocessedText.length} {t("truth.chars")}）</div>
                      <textarea
                        value={preprocessedText}
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
            {(relayoutedText || preprocessedText || extractedDoc?.text) ? (
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
                    <div className="text-xl font-bold">{(relayoutedText || preprocessedText || extractedDoc?.text || "").length.toLocaleString()}</div>
                  </div>
                </div>
                <textarea
                  value={relayoutedText || preprocessedText || extractedDoc?.text || ""}
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

      {/* Tab: Library */}
      {activeTab === "library" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">{t("style.tabs.library")}</h3>
              <button
                onClick={() => { setShowCreateForm(true); setActiveTab("library"); }}
                className={`px-3 py-1.5 text-xs rounded-lg ${c.btnPrimary} flex items-center gap-1`}
              >
                <Plus size={12} />
                {t("style.createAuthor")}
              </button>
            </div>
            {showCreateForm && (
              <div className={`border ${c.cardStatic} rounded-lg p-4 space-y-2`}>
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
                    onClick={handleCreateAuthorOnly}
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
            {(!libraryData || libraryData.authors.length === 0) ? (
              <div className={`border border-dashed ${c.cardStatic} rounded-lg p-6 text-center text-muted-foreground text-sm italic`}>
                {t("style.noAuthors")}
              </div>
            ) : (
              <div className="space-y-2">
                {libraryData.authors.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => { setSelectedAuthorId(a.id); loadAuthorDetail(a.id); }}
                    className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                      selectedAuthorId === a.id ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/30"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{a.name}</span>
                      <span className="text-xs text-muted-foreground">{a.sourceCount} {t("style.sampleCount")}</span>
                    </div>
                    <div className="flex gap-1 mt-1">
                      {a.tags.map((tag) => (
                        <span key={tag} className="px-1.5 py-0.5 text-[10px] bg-secondary rounded">{tag}</span>
                      ))}
                    </div>
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
                    <button
                      onClick={async () => {
                        await fetchJson(`/style/authors/${selectedAuthorId}/reanalyze`, { method: "POST" });
                        loadAuthorDetail(selectedAuthorId);
                        refetchLibrary();
                      }}
                      className={`px-3 py-1.5 text-xs rounded-lg ${c.btnSecondary} flex items-center gap-1`}
                    >
                      <RefreshCw size={12} />
                      {t("style.reanalyzeAuthor")}
                    </button>
                    <button
                      onClick={() => handleDeleteAuthor(selectedAuthorId)}
                      className={`px-3 py-1.5 text-xs rounded-lg ${c.btnDanger} flex items-center gap-1`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="bg-secondary/30 rounded-lg p-3">
                    <div className="text-muted-foreground text-xs">{t("style.sampleCount")}</div>
                    <div className="text-xl font-bold">{authorDetail.profile.sampleStats.sourceCount}</div>
                  </div>
                  <div className="bg-secondary/30 rounded-lg p-3">
                    <div className="text-muted-foreground text-xs">{t("style.totalChars")}</div>
                    <div className="text-xl font-bold">{authorDetail.profile.sampleStats.totalChars.toLocaleString()}</div>
                  </div>
                  <div className="bg-secondary/30 rounded-lg p-3">
                    <div className="text-muted-foreground text-xs">{t("style.avgSentence")}</div>
                    <div className="text-xl font-bold">{authorDetail.profile.aggregateProfile.avgSentenceLength.toFixed(1)}</div>
                  </div>
                </div>

                {authorDetail.profile.aggregateProfile.topPatterns.length > 0 && (
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">{t("style.topPatterns")}</div>
                    <div className="flex gap-2 flex-wrap">
                      {authorDetail.profile.aggregateProfile.topPatterns.map((pt) => (
                        <span key={pt} className="px-2 py-1 text-xs bg-secondary rounded">{pt}</span>
                      ))}
                    </div>
                  </div>
                )}
                {authorDetail.profile.aggregateProfile.rhetoricalFeatures.length > 0 && (
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">{t("style.rhetoricalFeatures")}</div>
                    <div className="flex gap-2 flex-wrap">
                      {authorDetail.profile.aggregateProfile.rhetoricalFeatures.map((f) => (
                        <span key={f} className="px-2 py-1 text-xs bg-primary/10 text-primary rounded">{f}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Fingerprint */}
                {authorDetail.profile.aggregateProfile.fingerprint && (
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("style.fingerprint")}</h4>
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
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("style.sampleCount")}</h4>
                    <div>
                      <input
                        ref={authorSampleInputRef}
                        type="file"
                        multiple
                        accept=".txt,.md,.markdown,.jsonl,.json,.ts,.js,.html,.htm,.css,text/plain,text/markdown"
                        className="hidden"
                        onChange={handleAuthorLocalSamples}
                      />
                      <button
                        onClick={() => authorSampleInputRef.current?.click()}
                        disabled={loading}
                        className={`px-3 py-1.5 text-xs rounded-lg ${c.btnSecondary} disabled:opacity-30 flex items-center gap-1`}
                      >
                        <Upload size={12} />
                        {t("style.importLocalSamples")}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {authorDetail.sources.map((s) => (
                      <div key={s.id} className="flex items-center justify-between text-sm px-3 py-2 bg-secondary/20 rounded">
                        <div className="flex items-center gap-2">
                          <FileText size={14} className="text-muted-foreground" />
                          <span>{s.fileName}</span>
                          <span className="text-xs text-muted-foreground">({s.fileType})</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{s.charCount} 字</span>
                          {s.status === "failed" && <span className="text-xs text-destructive">{s.error}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className={`border border-dashed ${c.cardStatic} rounded-lg p-8 text-center text-muted-foreground text-sm italic`}>
                {t("style.noAuthors")}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: Apply */}
      {activeTab === "apply" && (
        <div className="max-w-xl space-y-6">
          <div className={`border ${c.cardStatic} rounded-lg p-5 space-y-4`}>
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">{t("style.tabs.apply")}</h3>

            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-2">{t("style.selectAuthor")}</label>
              <select
                value={applyAuthorId}
                onChange={(e) => setApplyAuthorId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm"
              >
                <option value="">{t("style.selectAuthor")}</option>
                {libraryData?.authors.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-2">{t("style.selectBook")}</label>
              <select
                value={applyBookId}
                onChange={(e) => setApplyBookId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm"
              >
                <option value="">{t("style.selectBook")}</option>
                {booksData?.books.map((b) => (
                  <option key={b.id} value={b.id}>{b.title}</option>
                ))}
              </select>
            </div>

            <button
              onClick={handleApplyAuthor}
              disabled={!applyAuthorId || !applyBookId}
              className={`px-4 py-2 text-sm rounded-lg ${c.btnPrimary} disabled:opacity-30 flex items-center gap-2`}
            >
              <Upload size={14} />
              {t("style.applyAuthor")}
            </button>

            {applyStatus && (
              <div className={`text-sm ${applyStatus.startsWith("Error") ? "text-destructive" : "text-emerald-600"}`}>
                {applyStatus}
              </div>
            )}
          </div>
        </div>
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
