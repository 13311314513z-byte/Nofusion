/**
 * BookSourcesSection — manage foundation sources for a book.
 *
 * Displays sources registered in story/sources/index.json.
 * Supports viewing source content inline and toggling source status.
 */

import { useState } from "react";
import { useApi } from "../../hooks/use-api";
import type { Theme } from "../../hooks/use-theme";
import type { TFunction } from "../../hooks/use-i18n";
import { useColors } from "../../hooks/use-colors";

interface SourceEntry {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly type?: string;
  readonly linkedCharacters?: ReadonlyArray<string>;
  readonly tags?: ReadonlyArray<string>;
  readonly active: boolean;
}

interface SourcesIndex {
  readonly sources: ReadonlyArray<SourceEntry>;
  readonly updatedAt?: string;
}

interface SourceContent {
  readonly content: string;
  readonly path: string;
}

interface SectionProps {
  readonly bookId: string;
  readonly theme: Theme;
  readonly t: TFunction;
}

export function BookSourcesSection({ bookId, theme, t }: SectionProps) {
  const c = useColors(theme);
  const { data, loading, error, refetch } = useApi<SourcesIndex>(`/books/${bookId}/sources`);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const { data: sourceContent } = useApi<SourceContent>(
    selectedSource ? `/books/${bookId}/sources/${encodeURIComponent(selectedSource)}` : null,
  );

  if (loading) return <div className={c.muted}>{t("common.loading")}</div>;
  if (error) return <div className="text-red-400">{t("common.error")}: {error}</div>;
  if (!data) return null;

  const sources = data.sources ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className={`text-sm font-medium ${c.subtle}`}>
          {t("workspace.section.sources") ?? "资料来源"} ({sources.length})
        </h2>
        <button
          onClick={() => refetch()}
          className={`text-xs px-2 py-1 rounded ${c.btnSecondary} ${c.link}`}
        >
          {t("common.refresh") ?? "刷新"}
        </button>
      </div>

      {sources.length === 0 ? (
        <div className={`border ${c.cardStatic} rounded-lg p-6 text-center`}>
          <p className={`text-sm ${c.muted}`}>暂无资料来源</p>
          <p className={`text-xs ${c.muted} mt-1`}>
            在书籍目录下的 story/sources/ 文件夹中添加 .md 文件作为资料来源
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Source list */}
          <div className={`border ${c.cardStatic} rounded-lg divide-y ${c.btnSecondary}`}>
            {sources.map((src) => (
              <button
                key={src.id}
                onClick={() => setSelectedSource(selectedSource === src.id ? null : src.id)}
                className={`w-full text-left p-3 text-sm hover:bg-accent/50 transition-colors ${
                  selectedSource === src.id ? "bg-accent" : ""
                } ${!src.active ? "opacity-50" : ""}`}
              >
                <div className="font-medium truncate">{src.title || src.id}</div>
                <div className={`text-xs ${c.muted} mt-0.5`}>
                  {src.type && <span className="mr-2">{src.type}</span>}
                  {src.tags && src.tags.length > 0 && (
                    <span>{src.tags.slice(0, 3).join(", ")}</span>
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* Source preview */}
          <div className={`md:col-span-2 border ${c.cardStatic} rounded-lg p-4 min-h-[200px]`}>
            {!selectedSource ? (
              <div className={`text-sm ${c.muted} text-center py-12`}>
                选择左侧资料来源查看内容
              </div>
            ) : sourceContent ? (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className={`text-sm font-medium ${c.subtle}`}>
                    {sources.find(s => s.id === selectedSource)?.title ?? selectedSource}
                  </h3>
                  <span className={`text-xs ${c.muted}`}>{sourceContent.path}</span>
                </div>
                <pre className={`text-sm ${c.subtle} whitespace-pre-wrap max-h-96 overflow-y-auto leading-relaxed`}>
                  {sourceContent.content.slice(0, 5000)}
                  {sourceContent.content.length > 5000 && (
                    <span className={c.muted}>{"\n\n... (内容过长，仅显示前 5000 字符)"}</span>
                  )}
                </pre>
              </div>
            ) : (
              <div className={c.muted}>{t("common.loading")}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
