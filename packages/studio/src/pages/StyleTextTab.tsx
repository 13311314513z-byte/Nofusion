import { type ChangeEvent, type RefObject, useState } from "react";
import type { FullStyleDiagnostics } from "@actalk/inkos-core";
import { Upload, BarChart3, Stethoscope, Link, User, BookOpen, Highlighter } from "lucide-react";
import { StyleDiagnosticsPanel } from "../components/style/StyleDiagnosticsPanel.js";
import { AuthorStyleComparison } from "./style-manager/AuthorStyleComparison.js";
import { RhetoricHighlightEditor } from "../components/style/RhetoricHighlightEditor.js";
import type { CoreStyleProfile, AuthorIndexItem, BookSummary } from "./style-types.js";

interface Props {
  readonly text: string;
  readonly setText: (text: string) => void;
  readonly sourceName: string;
  readonly setSourceName: (name: string) => void;
  readonly urlSource: string;
  readonly setUrlSource: (url: string) => void;
  readonly profile: CoreStyleProfile | null;
  readonly diagnostics: FullStyleDiagnostics | null;
  readonly loading: boolean;
  readonly loadingDiagnostics: boolean;
  readonly textFileInputRef: RefObject<HTMLInputElement | null>;
  readonly libraryData: { authors: ReadonlyArray<AuthorIndexItem> } | null;
  readonly booksData: { books: ReadonlyArray<BookSummary> } | null;
  readonly c: Record<string, string>;
  readonly t: (key: string) => string;
  readonly handleTextLocalFile: (e: ChangeEvent<HTMLInputElement>) => void;
  readonly handleImportUrl: () => void;
  readonly handleAnalyze: () => void;
  readonly handleDiagnostics: () => void;
  readonly handleImportBookChapter: (bookId: string, chapterNumber?: number) => Promise<void>;
  readonly renderProfileCard: (p: CoreStyleProfile | null, showImport?: boolean) => React.ReactNode;
  // Chapter selection
  readonly importBookId: string;
  readonly chapterIndex: ReadonlyArray<{ number: number; title: string }> | null;
  readonly importChapterNumber: number;
  readonly handleSelectBook: (bookId: string) => Promise<void>;
  readonly onSelectChapter: (chapterNumber: number) => void;
}

export function StyleTextTab({
  text, setText, sourceName, setSourceName, urlSource, setUrlSource,
  profile, diagnostics, loading, loadingDiagnostics,
  textFileInputRef, libraryData, booksData, c, t,
  handleTextLocalFile, handleImportUrl, handleAnalyze, handleDiagnostics, handleImportBookChapter,
  renderProfileCard,
  importBookId, chapterIndex, importChapterNumber, handleSelectBook, onSelectChapter,
}: Props) {
  const [showRhetoricEditor, setShowRhetoricEditor] = useState(false);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left column: input + adjustments */}
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
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleImportUrl(); } }}
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
        <div>          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-2">
            <BookOpen size={12} className="inline mr-1" />
            已创作书籍导入
          </label>
          <div className="flex gap-2">
            <select
              className="min-w-0 flex-1 px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm focus:outline-none focus:border-primary"
              value={importBookId}
              onChange={(e) => { handleSelectBook(e.target.value); }}
            >
              <option value="">选择书籍...</option>
              {booksData?.books.map((b) => (
                <option key={b.id} value={b.id}>{b.title}</option>
              ))}
            </select>
            {chapterIndex && chapterIndex.length > 0 ? (
              <select
                className="px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm focus:outline-none focus:border-primary"
                value={importChapterNumber}
                onChange={(e) => onSelectChapter(Number(e.target.value))}
              >
                {chapterIndex.map((ch) => (
                  <option key={ch.number} value={ch.number}>
                    第 {ch.number} 章{ch.title ? `: ${ch.title}` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs text-muted-foreground self-center whitespace-nowrap">导入首章</span>
            )}
            <button
              onClick={() => handleImportBookChapter(importBookId, importChapterNumber)}
              disabled={!importBookId || loading}
              className={`px-3 py-2 text-sm rounded-lg ${c.btnPrimary} disabled:opacity-30`}
            >{t("style.importChapter")}</button>
          </div>
        </div>
        <div>          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-2">{t("style.textSample")}</label>
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
          <button
            onClick={handleDiagnostics}
            disabled={!text.trim() || loadingDiagnostics}
            className={`px-4 py-2 text-sm rounded-lg ${c.btnSecondary} disabled:opacity-30 flex items-center gap-2`}
          >
            <Stethoscope size={14} />
            {loadingDiagnostics ? "诊断中…" : "文风诊断"}
          </button>
          <button
            onClick={() => setShowRhetoricEditor(!showRhetoricEditor)}
            disabled={!text.trim()}
            className={`px-4 py-2 text-sm rounded-lg ${showRhetoricEditor ? c.btnPrimary : c.btnSecondary} disabled:opacity-30 flex items-center gap-2`}
          >
            <Highlighter size={14} />
            {showRhetoricEditor ? "关闭修辞" : "修辞检测"}
          </button>
        </div>
        {showRhetoricEditor && (
          <div className="mt-3 border border-border rounded-lg p-3">
            <RhetoricHighlightEditor text={text} onTextChange={setText} />
          </div>
        )}
      </div>

      {/* Right column: results */}
      <div className="space-y-4">
        {renderProfileCard(profile, true)}
        {diagnostics && (
          <div className={`border ${c.cardStatic} rounded-lg p-5`}>
            <StyleDiagnosticsPanel
              diagnostics={diagnostics}
              authors={libraryData?.authors.map((a) => ({ id: a.id, name: a.name })) ?? []}
              t={t}
            />
          </div>
        )}
        {diagnostics && (
          <div className={`border ${c.cardStatic} rounded-lg p-5`}>
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <User size={14} />
              {t("style.authorComparison")}
            </h3>
            <AuthorStyleComparison
              text={text}
              onComparisonResult={() => {}}
              t={t as unknown as (key: string) => string}
            />
          </div>
        )}
        {!profile && !diagnostics && !loading && !loadingDiagnostics && (
          <div className={`border border-dashed ${c.cardStatic} rounded-lg p-8 text-center text-muted-foreground text-sm italic`}>
            {t("style.emptyHint")}
          </div>
        )}
      </div>
    </div>
  );
}
