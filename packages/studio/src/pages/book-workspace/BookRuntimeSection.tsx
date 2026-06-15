import { useState, useMemo } from "react";
import { useApi, fetchJson } from "../../hooks/use-api";
import type { Theme } from "../../hooks/use-theme";
import type { TFunction } from "../../hooks/use-i18n";
import type { SSEMessage } from "../../hooks/use-sse";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "../../components/ui/collapsible";
import {
  Cpu,
  FileText,
  Folder,
  RefreshCw,
  ChevronDown,
} from "lucide-react";

interface RuntimeFile {
  readonly name: string;
  readonly path: string;
  readonly size: number;
  readonly isDirectory: boolean;
}

interface RuntimeData {
  readonly files: ReadonlyArray<RuntimeFile>;
}

interface BookRuntimeSectionProps {
  readonly bookId: string;
  readonly nav: {
    readonly toDashboard: () => void;
    readonly toChapter: (bookId: string, num: number) => void;
    readonly toBook: (bookId: string) => void;
    readonly toBookSection: (bookId: string, section: string) => void;
    readonly toServices: () => void;
  };
  readonly theme: Theme;
  readonly t: TFunction;
  readonly sse: { readonly messages: ReadonlyArray<SSEMessage>; readonly connected: boolean };
}

const TYPE_ORDER = [
  "intent",
  "plan",
  "context",
  "trace",
  "memo",
  "delta",
  "unknown",
] as const;

const REQUIRED_TYPES = new Set<string>(["intent", "plan", "trace"]);

const TYPE_STYLES: Record<string, string> = {
  intent:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  plan:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  context:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  trace:
    "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  memo:
    "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400",
  delta:
    "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
  unknown: "bg-muted text-muted-foreground",
};

const PLACEHOLDER_STYLES =
  "bg-secondary/30 text-muted-foreground/50 border-border/20";

function detectFileType(name: string): string {
  const lower = name.toLowerCase();
  for (const type of TYPE_ORDER) {
    if (type === "unknown") continue;
    if (lower.includes(type)) return type;
  }
  return "unknown";
}

function extractChapterNumber(path: string): number | null {
  const chapterMatch = path.match(/chapter-(\d{4})/i);
  if (chapterMatch) return parseInt(chapterMatch[1], 10);
  // Safer fallback: match 4 digits bounded by path separators or file extension,
  // avoiding embedded numbers like years (e.g. 2024)
  const genericMatch = path.match(/[/_-](\d{4})(?=[/_-]|\.|$)/);
  if (genericMatch) return parseInt(genericMatch[1], 10);
  return null;
}

interface ChapterGroup {
  readonly chapterNumber: number | null;
  readonly files: ReadonlyArray<RuntimeFile>;
}

function groupByChapter(files: ReadonlyArray<RuntimeFile>): ChapterGroup[] {
  const map = new Map<number | null, RuntimeFile[]>();
  for (const file of files) {
    const num = extractChapterNumber(file.path);
    const list = map.get(num) ?? [];
    list.push(file);
    map.set(num, list);
  }

  const numeric: ChapterGroup[] = [];
  const other: ChapterGroup[] = [];

  for (const [chapterNumber, fileList] of map) {
    const group: ChapterGroup = {
      chapterNumber,
      files: fileList.sort((a, b) => a.name.localeCompare(b.name)),
    };
    if (chapterNumber === null) {
      other.push(group);
    } else {
      numeric.push(group);
    }
  }

  numeric.sort((a, b) => (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0));
  return [...numeric, ...other];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BookRuntimeSection({
  bookId,
  nav,
  t,
}: BookRuntimeSectionProps) {
  const { data, loading, error, refetch } = useApi<RuntimeData>(
    `/books/${bookId}/runtime`
  );
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const selectedType = selectedFile ? detectFileType(selectedFile.split("/").pop() ?? selectedFile) : null;
  const [expandedChapters, setExpandedChapters] = useState<Set<number | null>>(
    () => new Set()
  );

  const groups = useMemo(() => {
    if (!data) return [];
    return groupByChapter(data.files);
  }, [data]);

  const toggleChapter = (num: number | null) => {
    setExpandedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(num)) {
        next.delete(num);
      } else {
        next.add(num);
      }
      return next;
    });
  };

  const handleSelectFile = async (file: RuntimeFile) => {
    if (file.isDirectory) return;
    setSelectedFile(file.path);
    setLoadingFile(true);
    try {
      const result = await fetchJson<{ content: string }>(
        `/books/${bookId}/runtime/${encodeURIComponent(file.path)}`
      );
      setFileContent(result.content);
    } catch (e) {
      setFileContent(e instanceof Error ? e.message : "Failed to load file");
    } finally {
      setLoadingFile(false);
    }
  };

  const renderFileList = (files: ReadonlyArray<RuntimeFile>) => {
    const typeMap = new Map<string, RuntimeFile[]>();
    for (const file of files) {
      const type = detectFileType(file.name);
      const list = typeMap.get(type) ?? [];
      list.push(file);
      typeMap.set(type, list);
    }

    const items: Array<
      | { kind: "file"; file: RuntimeFile }
      | { kind: "placeholder"; type: string }
    > = [];

    for (const type of TYPE_ORDER) {
      const list = typeMap.get(type);
      if (list && list.length > 0) {
        for (const file of list) {
          items.push({ kind: "file", file });
        }
      } else if (REQUIRED_TYPES.has(type)) {
        items.push({ kind: "placeholder", type });
      }
    }

    return (
      <div className="divide-y divide-border/20">
        {items.map((item, idx) => {
          if (item.kind === "placeholder") {
            return (
              <div
                key={`placeholder-${item.type}-${idx}`}
                className="flex items-center gap-3 px-4 py-2.5"
              >
                <span className="text-xs text-muted-foreground/40 shrink-0 w-4">
                  —
                </span>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${PLACEHOLDER_STYLES}`}
                >
                  {item.type}
                </span>
              </div>
            );
          }

          const file = item.file;
          const type = detectFileType(file.name);
          return (
            <button
              key={file.path}
              onClick={() => void handleSelectFile(file)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-background/50 transition-colors ${
                selectedFile === file.path ? "bg-primary/5" : ""
              }`}
            >
              {file.isDirectory ? (
                <Folder size={14} className="text-muted-foreground shrink-0" />
              ) : (
                <FileText
                  size={14}
                  className="text-muted-foreground shrink-0"
                />
              )}
              <span className="text-xs truncate flex-1">{file.name}</span>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium shrink-0 ${TYPE_STYLES[type] ?? TYPE_STYLES.unknown}`}
              >
                {type}
              </span>
              {!file.isDirectory && (
                <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                  {formatSize(file.size)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="paper-sheet rounded-2xl border border-border/40 shadow-sm p-5 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Cpu size={16} className="text-primary/70" />
            <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
              {t("workspace.section.runtime")}
            </h2>
          </div>
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-secondary/40 px-3 py-2 text-xs font-bold text-muted-foreground hover:bg-secondary transition-colors"
            title={t("common.refresh")}
          >
            <RefreshCw size={14} />
            {t("common.refresh")}
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
          </div>
        )}

        {!loading && data && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Chapter groups */}
            <div className="space-y-3">
              {groups.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {t("runtime.noFiles")}
                </p>
              ) : (
                groups.map((group) => {
                  const isOther = group.chapterNumber === null;
                  const isOpen = expandedChapters.has(group.chapterNumber);
                  const title = isOther
                    ? t("runtime.other")
                    : t("chapter.label").replace(
                        "{n}",
                        String(group.chapterNumber)
                      );

                  return (
                    <Collapsible
                      key={isOther ? "other" : group.chapterNumber}
                      open={isOpen}
                      onOpenChange={() =>
                        toggleChapter(group.chapterNumber)
                      }
                      className="rounded-xl border border-border/40 bg-secondary/10 overflow-hidden"
                    >
                      <CollapsibleTrigger className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-muted/20 transition-colors cursor-pointer">
                        <div className="flex items-center gap-3 min-w-0">
                          {isOther ? (
                            <Folder
                              size={14}
                              className="text-muted-foreground shrink-0"
                            />
                          ) : (
                            <FileText
                              size={14}
                              className="text-primary/60 shrink-0"
                            />
                          )}
                          <span
                            role="button"
                            tabIndex={isOther ? undefined : 0}
                            onClick={(e) => {
                              if (!isOther && group.chapterNumber !== null) {
                                e.stopPropagation();
                                nav.toChapter(bookId, group.chapterNumber);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (!isOther && group.chapterNumber !== null && (e.key === "Enter" || e.key === " ")) {
                                e.stopPropagation();
                                e.preventDefault();
                                nav.toChapter(bookId, group.chapterNumber);
                              }
                            }}
                            className={`text-sm font-semibold truncate ${
                              isOther
                                ? "text-muted-foreground"
                                : "hover:text-primary transition-colors cursor-pointer"
                            }`}
                          >
                            {title}
                          </span>
                          <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-md bg-secondary/60 text-[10px] font-bold text-muted-foreground tabular-nums">
                            {group.files.length}
                          </span>
                        </div>
                        <ChevronDown
                          size={14}
                          className={`text-muted-foreground transition-transform shrink-0 ${
                            isOpen ? "rotate-180" : ""
                          }`}
                        />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="overflow-y-auto max-h-[400px]">
                          {renderFileList(group.files)}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })
              )}
            </div>

            {/* File content */}
            <div className="rounded-xl border border-border/40 bg-secondary/10 overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-border/30 bg-muted/20">
                <h3 className="text-sm font-semibold truncate">
                  {selectedFile ?? "Content"}
                </h3>
              </div>
              <div className="flex-1 overflow-auto p-4 min-h-[300px]">
                {loadingFile ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                  </div>
                ) : fileContent !== null ? (
                  selectedType === "plan" || selectedFile?.endsWith(".plan.md") ? (
                    <PlanCardView content={fileContent} />
                  ) : (
                    <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed text-muted-foreground">
                      {fileContent}
                    </pre>
                  )
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-12">
                    {t("runtime.selectFile")}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Parse YAML frontmatter from plan.md content and render as structured cards. */
function PlanCardView({ content }: { content: string }) {
  // Extract YAML frontmatter between --- markers
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  const yamlText = fmMatch?.[1] ?? "";
  const body = fmMatch ? content.slice(fmMatch[0].length).trim() : content;

  // Simple YAML parser for key: value pairs
  const fields: Record<string, string> = {};
  for (const line of yamlText.split("\n")) {
    const m = line.match(/^(\w[\w_-]*)\s*:\s*(.+)$/);
    if (m) fields[m[1]] = m[2].trim();
  }

  // Extract 7 memo sections from body (## Section Name)
  const sections = body.split(/^## /m).filter(Boolean);
  const memoBlocks: Array<{ title: string; text: string }> = [];
  for (const sec of sections) {
    const nl = sec.indexOf("\n");
    const title = nl > 0 ? sec.slice(0, nl).trim() : sec.trim();
    const text = nl > 0 ? sec.slice(nl + 1).trim() : "";
    if (title) memoBlocks.push({ title, text });
  }

  const hasYaml = Object.keys(fields).length > 0;
  const hasSections = memoBlocks.length > 0;

  if (!hasYaml && !hasSections) {
    return <pre className="text-xs whitespace-pre-wrap font-mono">{content}</pre>;
  }

  return (
    <div className="space-y-4">
      {/* YAML frontmatter cards */}
      {hasYaml && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {Object.entries(fields).map(([key, value]) => (
            <div key={key} className="border border-border/30 rounded-lg p-3 bg-secondary/5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                {key.replace(/([A-Z])/g, " $1").trim()}
              </div>
              <div className="text-sm font-medium text-foreground line-clamp-2">
                {String(value).slice(0, 100)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Memo section cards */}
      {hasSections && (
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground uppercase tracking-wider">
            Planner Memo ({memoBlocks.length} sections)
          </div>
          {memoBlocks.map((block, i) => (
            <div key={i} className="border border-border/30 rounded-lg p-4 bg-secondary/5">
              <h4 className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 mb-2">
                {i + 1}. {block.title}
              </h4>
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                {block.text.slice(0, 800)}
                {block.text.length > 800 && "…"}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Raw YAML & body toggle */}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">查看原始文本</summary>
        <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed max-h-64 overflow-y-auto border border-border/30 rounded p-3 bg-secondary/5">
          {content.slice(0, 5000)}
        </pre>
      </details>
    </div>
  );
}
