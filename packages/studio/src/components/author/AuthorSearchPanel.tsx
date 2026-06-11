/**
 * AuthorSearchPanel — UI for searching and fetching author works from the web.
 */

import React, { useState, useCallback } from "react";
import type { SearchSourceResult } from "../../api/author-search";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AuthorSearchPanelProps {
  readonly onSearch: (authorName: string) => Promise<ReadonlyArray<SearchSourceResult>>;
  readonly onFetch: (urls: ReadonlyArray<string>) => Promise<void>;
  readonly disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AuthorSearchPanel({
  onSearch,
  onFetch,
  disabled = false,
}: AuthorSearchPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ReadonlyArray<SearchSourceResult>>([]);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await onSearch(query.trim());
      setResults(res);
      setSelectedUrls(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "搜索失败");
    } finally {
      setLoading(false);
    }
  }, [query, onSearch]);

  const toggleUrl = useCallback((url: string) => {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }, []);

  const handleFetch = useCallback(async () => {
    if (selectedUrls.size === 0) return;
    setLoading(true);
    setError(null);
    try {
      await onFetch([...selectedUrls]);
      setSelectedUrls(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "抓取失败");
    } finally {
      setLoading(false);
    }
  }, [selectedUrls, onFetch]);

  const handleSelectAll = useCallback(() => {
    setSelectedUrls(new Set(results.map((r) => r.url)));
  }, [results]);

  const handleClear = useCallback(() => {
    setSelectedUrls(new Set());
    setResults([]);
    setQuery("");
  }, []);

  return (
    <div className="space-y-3 p-4 bg-white rounded-lg border border-gray-200">
      <h3 className="text-sm font-semibold text-gray-800">搜索作家原文</h3>

      {/* Search input */}
      <div className="flex gap-2">
        <input
          type="text"
          className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-400"
          placeholder="输入作家名..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          disabled={disabled || loading}
        />
        <button
          className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
          onClick={handleSearch}
          disabled={disabled || loading || !query.trim()}
        >
          {loading ? "搜索中…" : "搜索"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="text-xs text-red-600 bg-red-50 rounded p-2">
          {error}
          {error.includes("TAVILY_API_KEY") && (
            <span className="block mt-1 text-gray-500">
              如需启用互联网搜索，请设置 TAVILY_API_KEY 环境变量。
            </span>
          )}
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <>
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>搜索结果（来源: Tavily）— {results.length} 条</span>
            <div className="flex gap-2">
              <button className="hover:text-gray-700" onClick={handleSelectAll}>全选</button>
              <button className="hover:text-gray-700" onClick={handleClear}>取消</button>
            </div>
          </div>

          <div className="space-y-2 max-h-80 overflow-y-auto">
            {results.map((r) => (
              <label
                key={r.url}
                className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${
                  selectedUrls.has(r.url)
                    ? "border-blue-300 bg-blue-50"
                    : "border-gray-100 hover:bg-gray-50"
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={selectedUrls.has(r.url)}
                  onChange={() => toggleUrl(r.url)}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 truncate">{r.title}</div>
                  <div className="text-xs text-gray-400 truncate">{r.url}</div>
                  {r.snippet && (
                    <div className="text-xs text-gray-500 mt-1 line-clamp-2">{r.snippet}</div>
                  )}
                </div>
                <div className="text-xs text-gray-400 shrink-0">
                  {Math.round(r.relevance * 100)}%
                </div>
              </label>
            ))}
          </div>

          {selectedUrls.size > 0 && (
            <button
              className="w-full py-2 text-sm bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
              onClick={handleFetch}
              disabled={disabled || loading}
            >
              {loading ? "抓取中…" : `抓取选中 (${selectedUrls.size} 条)`}
            </button>
          )}
        </>
      )}

      {/* Empty state */}
      {results.length === 0 && !loading && !error && (
        <div className="text-center text-xs text-gray-400 py-4">
          <p>输入作家名后点击搜索，查找可分析原文</p>
          <button
            className="text-blue-500 hover:text-blue-700 underline mt-1"
            onClick={() => setShowManualInput(!showManualInput)}
          >
            {showManualInput ? "收起" : "或手动输入 URL"}
          </button>
          {showManualInput && (
            <div className="mt-2 flex gap-2 max-w-md mx-auto">
              <input
                type="url"
                className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded"
                placeholder="https://example.com/article"
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
              />
              <button
                className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                disabled={!manualUrl.trim() || loading}
                onClick={async () => {
                  if (!manualUrl.trim()) return;
                  setLoading(true);
                  setError(null);
                  try {
                    await onFetch([manualUrl.trim()]);
                    setManualUrl("");
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "抓取失败");
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                抓取
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
