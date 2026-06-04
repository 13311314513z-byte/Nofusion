import { useState } from "react";
import { fetchJson, useApi, postApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useI18n } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { FileInput, BookCopy, Feather, AlertTriangle, CheckCircle, ArrowRight, ArrowLeft } from "lucide-react";

interface BookSummary {
  readonly id: string;
  readonly title: string;
}

interface Nav { toDashboard: () => void }

type Tab = "chapters" | "canon" | "fanfic";
type ChapterStep = "paste" | "preview" | "done";

interface ChapterImportItem {
  readonly targetNumber: number;
  readonly title: string;
  readonly content: string;
  readonly wordCount: number;
  readonly firstParagraph: string;
  readonly lastParagraph: string;
  readonly status: "ok" | "too-short" | "too-long" | "empty" | "duplicate-title";
}

interface ChapterImportWarning {
  readonly type: string;
  readonly message: string;
  readonly affectedNumbers: number[];
}

interface ChapterImportPlan {
  readonly chapters: ChapterImportItem[];
  readonly warnings: ChapterImportWarning[];
  readonly suggestedStartNumber: number;
}

function statusLabel(status: ChapterImportItem["status"]): string {
  switch (status) {
    case "ok": return "正常";
    case "too-short": return "过短";
    case "too-long": return "超长";
    case "empty": return "空章节";
    case "duplicate-title": return "重复标题";
    default: return status;
  }
}

function statusClass(status: ChapterImportItem["status"], theme: Theme): string {
  const isDark = theme === "dark";
  switch (status) {
    case "ok": return isDark ? "text-emerald-400" : "text-emerald-600";
    case "too-short": return isDark ? "text-amber-400" : "text-amber-600";
    case "too-long": return isDark ? "text-orange-400" : "text-orange-600";
    case "empty": return isDark ? "text-red-400" : "text-red-600";
    case "duplicate-title": return isDark ? "text-rose-400" : "text-rose-600";
    default: return "";
  }
}

export function ImportManager({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { lang } = useI18n();
  const { data: booksData } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const [tab, setTab] = useState<Tab>("chapters");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  // Chapters state
  const [chStep, setChStep] = useState<ChapterStep>("paste");
  const [chText, setChText] = useState("");
  const [chBookId, setChBookId] = useState("");
  const [chSplitRegex, setChSplitRegex] = useState("");
  const [chStartNumber, setChStartNumber] = useState("");
  const [chPlan, setChPlan] = useState<ChapterImportPlan | null>(null);

  // Canon state
  const [canonTarget, setCanonTarget] = useState("");
  const [canonFrom, setCanonFrom] = useState("");

  // Fanfic state
  const [ffTitle, setFfTitle] = useState("");
  const [ffText, setFfText] = useState("");
  const [ffMode, setFfMode] = useState("canon");
  const [ffGenre, setFfGenre] = useState("other");
  const [ffLang, setFfLang] = useState(lang);

  const handlePlanChapters = async () => {
    if (!chText.trim() || !chBookId) return;
    setLoading(true);
    setStatus("");
    try {
      const data = await postApi<{ plan: ChapterImportPlan }>(`/books/${chBookId}/import/chapters/plan`, {
        text: chText,
        splitRegex: chSplitRegex || undefined,
        startNumber: chStartNumber ? Number(chStartNumber) : undefined,
      });
      setChPlan(data.plan);
      setChStep("preview");
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  const handleCommitChapters = async () => {
    if (!chPlan || !chBookId) return;
    setLoading(true);
    setStatus("");
    try {
      const data = await postApi<{ importedCount?: number }>(`/books/${chBookId}/import/chapters/commit`, {
        plan: chPlan,
      });
      setStatus(`Imported ${data.importedCount} chapters`);
      setChStep("done");
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  const handleResetChapters = () => {
    setChStep("paste");
    setChPlan(null);
    setStatus("");
  };

  const handleImportCanon = async () => {
    if (!canonTarget || !canonFrom) return;
    setLoading(true);
    setStatus("");
    try {
      await postApi(`/books/${canonTarget}/import/canon`, { fromBookId: canonFrom });
      setStatus("Canon imported successfully!");
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  const handleFanficInit = async () => {
    if (!ffTitle.trim() || !ffText.trim()) return;
    setLoading(true);
    setStatus("");
    try {
      const data = await fetchJson<{ bookId?: string }>("/fanfic/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: ffTitle, sourceText: ffText, mode: ffMode,
          genre: ffGenre, language: ffLang,
        }),
      });
      setStatus(`Fanfic created: ${data.bookId}`);
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "chapters", label: t("import.chapters"), icon: <FileInput size={14} /> },
    { id: "canon", label: t("import.canon"), icon: <BookCopy size={14} /> },
    { id: "fanfic", label: t("import.fanfic"), icon: <Feather size={14} /> },
  ];

  const hasWarnings = chPlan ? chPlan.warnings.length > 0 : false;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span>{t("nav.import")}</span>
      </div>

      <h1 className="font-serif text-3xl flex items-center gap-3">
        <FileInput size={28} className="text-primary" />
        {t("import.title")}
      </h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-secondary/30 rounded-lg p-1 w-fit">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            onClick={() => { setTab(tb.id); setStatus(""); }}
            className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-all ${
              tab === tb.id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tb.icon} {tb.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className={`border ${c.cardStatic} rounded-lg p-6 space-y-4`}>
        {tab === "chapters" && (
          <>
            {/* Step indicator */}
            <div className="flex items-center gap-2 text-sm mb-4">
              <span className={`px-3 py-1 rounded-full ${chStep === "paste" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>
                1. 粘贴文本
              </span>
              <ArrowRight size={14} className="text-muted-foreground" />
              <span className={`px-3 py-1 rounded-full ${chStep === "preview" ? "bg-primary text-primary-foreground" : chStep === "done" ? "bg-emerald-500/20 text-emerald-600" : "bg-secondary text-muted-foreground"}`}>
                2. 拆分预览
              </span>
              <ArrowRight size={14} className="text-muted-foreground" />
              <span className={`px-3 py-1 rounded-full ${chStep === "done" ? "bg-emerald-500 text-white" : "bg-secondary text-muted-foreground"}`}>
                3. 完成
              </span>
            </div>

            {chStep === "paste" && (
              <>
                <select value={chBookId} onChange={(e) => setChBookId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm">
                  <option value="">{t("import.selectTarget")}</option>
                  {booksData?.books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
                </select>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text" value={chSplitRegex} onChange={(e) => setChSplitRegex(e.target.value)}
                    placeholder={t("import.splitRegex")}
                    className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm font-mono"
                  />
                  <input
                    type="number" value={chStartNumber} onChange={(e) => setChStartNumber(e.target.value)}
                    placeholder="起始章节号 (默认 1)"
                    className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm"
                    min={1}
                  />
                </div>
                <textarea value={chText} onChange={(e) => setChText(e.target.value)} rows={10}
                  placeholder={t("import.pasteChapters")}
                  className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm resize-none font-mono"
                />
                <button onClick={handlePlanChapters} disabled={loading || !chBookId || !chText.trim()}
                  className={`px-4 py-2 text-sm rounded-lg ${c.btnPrimary} disabled:opacity-30`}>
                  {loading ? "分析中..." : "预览拆分"}
                </button>
              </>
            )}

            {chStep === "preview" && chPlan && (
              <div className="space-y-4">
                {/* Warnings */}
                {hasWarnings && (
                  <div className="space-y-2">
                    {chPlan.warnings.map((w, i) => (
                      <div key={i} className={`flex items-start gap-2 text-sm px-3 py-2 rounded-lg ${
                        w.type === "no-chapters" ? "bg-amber-500/10 text-amber-600" :
                        w.type === "duplicate-title" ? "bg-rose-500/10 text-rose-600" :
                        "bg-amber-500/10 text-amber-600"
                      }`}>
                        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                        <div>
                          <div className="font-medium">{w.message}</div>
                          {w.affectedNumbers.length > 0 && (
                            <div className="text-xs opacity-80 mt-0.5">
                              涉及章节: {w.affectedNumbers.join(", ")}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Summary */}
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-muted-foreground">共 <strong className="text-foreground">{chPlan.chapters.length}</strong> 章</span>
                  <span className="text-muted-foreground">起始编号: <strong className="text-foreground">{chPlan.suggestedStartNumber}</strong></span>
                  {!hasWarnings && (
                    <span className="flex items-center gap-1 text-emerald-600">
                      <CheckCircle size={14} /> 无异常
                    </span>
                  )}
                </div>

                {/* Preview table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="py-2 px-2 font-medium">序号</th>
                        <th className="py-2 px-2 font-medium">标题</th>
                        <th className="py-2 px-2 font-medium">字数</th>
                        <th className="py-2 px-2 font-medium">状态</th>
                        <th className="py-2 px-2 font-medium">首段预览</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chPlan.chapters.map((ch) => (
                        <tr key={ch.targetNumber} className="border-b border-border/50 hover:bg-secondary/20">
                          <td className="py-2 px-2 text-muted-foreground">{ch.targetNumber}</td>
                          <td className="py-2 px-2 font-medium">{ch.title || <span className="text-muted-foreground italic">（无标题）</span>}</td>
                          <td className="py-2 px-2">{ch.wordCount}</td>
                          <td className="py-2 px-2">
                            <span className={`text-xs font-medium ${statusClass(ch.status, theme)}`}>
                              {statusLabel(ch.status)}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-muted-foreground max-w-xs truncate" title={ch.firstParagraph}>
                            {ch.firstParagraph || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3 pt-2">
                  <button onClick={handleResetChapters}
                    className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-secondary/50 flex items-center gap-1">
                    <ArrowLeft size={14} /> 重新粘贴
                  </button>
                  <button onClick={handleCommitChapters} disabled={loading || chPlan.chapters.length === 0}
                    className={`px-4 py-2 text-sm rounded-lg ${c.btnPrimary} disabled:opacity-30 flex items-center gap-1`}>
                    {loading ? t("import.importing") : <>确认导入 <ArrowRight size={14} /></>}
                  </button>
                </div>
              </div>
            )}

            {chStep === "done" && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-emerald-600">
                  <CheckCircle size={20} />
                  <span className="font-medium">导入完成</span>
                </div>
                {status && (
                  <div className="text-sm text-muted-foreground">{status}</div>
                )}
                <button onClick={handleResetChapters}
                  className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-secondary/50">
                  导入下一批
                </button>
              </div>
            )}
          </>
        )}

        {tab === "canon" && (
          <>
            <select value={canonFrom} onChange={(e) => setCanonFrom(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm">
              <option value="">{t("import.selectSource")}</option>
              {booksData?.books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
            <select value={canonTarget} onChange={(e) => setCanonTarget(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm">
              <option value="">{t("import.selectDerivative")}</option>
              {booksData?.books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
            <button onClick={handleImportCanon} disabled={loading || !canonTarget || !canonFrom}
              className={`px-4 py-2 text-sm rounded-lg ${c.btnPrimary} disabled:opacity-30`}>
              {loading ? t("import.importing") : t("import.canon")}
            </button>
          </>
        )}

        {tab === "fanfic" && (
          <>
            <input type="text" value={ffTitle} onChange={(e) => setFfTitle(e.target.value)}
              placeholder={t("import.fanficTitle")}
              className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm"
            />
            <div className="grid grid-cols-3 gap-3">
              <select value={ffMode} onChange={(e) => setFfMode(e.target.value)}
                className="px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm">
                <option value="canon">Canon</option>
                <option value="au">AU</option>
                <option value="ooc">OOC</option>
                <option value="cp">CP</option>
              </select>
              <select value={ffGenre} onChange={(e) => setFfGenre(e.target.value)}
                className="px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm">
                <option value="other">Other</option>
                <option value="xuanhuan">玄幻</option>
                <option value="urban">都市</option>
                <option value="xianxia">仙侠</option>
              </select>
              <select value={ffLang} onChange={(e) => setFfLang(e.target.value as "zh" | "en")}
                className="px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm">
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </div>
            <textarea value={ffText} onChange={(e) => setFfText(e.target.value)} rows={10}
              placeholder={t("import.pasteMaterial")}
              className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm resize-none font-mono"
            />
            <button onClick={handleFanficInit} disabled={loading || !ffTitle.trim() || !ffText.trim()}
              className={`px-4 py-2 text-sm rounded-lg ${c.btnPrimary} disabled:opacity-30`}>
              {loading ? t("import.creating") : t("import.fanfic")}
            </button>
          </>
        )}

        {status && chStep !== "done" && (
          <div className={`text-sm px-3 py-2 rounded-lg ${status.startsWith("Error") ? "bg-destructive/10 text-destructive" : "bg-emerald-500/10 text-emerald-600"}`}>
            {status}
          </div>
        )}
      </div>
    </div>
  );
}
