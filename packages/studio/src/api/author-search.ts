/**
 * Author search — orchestration of internet search for author samples.
 *
 * Searches for author works via Tavily (and future providers),
 * deduplicates results by URL, and returns structured results.
 */

import { searchWeb } from "@actalk/inkos-core";

interface TavilySearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthorSearchConfig {
  readonly authorName: string;
  readonly language: "zh" | "en";
  readonly maxResultsPerSource?: number;
}

export interface SearchSourceResult {
  readonly source: "tavily";
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly relevance: number;
}

// ---------------------------------------------------------------------------
// Search orchestration
// ---------------------------------------------------------------------------

function buildSearchQuery(authorName: string, language: "zh" | "en"): string {
  const queries: Record<string, string> = {
    zh: `${authorName} 小说 原文 节选 经典段落`,
    en: `${authorName} novel excerpt famous passage prose`,
  };
  return queries[language] ?? queries.zh;
}

function computeRelevance(result: TavilySearchResult, authorName: string): number {
  let score = 0.5;
  const lowerTitle = result.title.toLowerCase();
  const lowerSnippet = result.snippet.toLowerCase();
  const lowerAuthor = authorName.toLowerCase();

  // Title contains author name → higher relevance
  if (lowerTitle.includes(lowerAuthor)) score += 0.2;
  // Snippet mentions author
  if (lowerSnippet.includes(lowerAuthor)) score += 0.15;
  // Keywords in title
  if (/\b(节选|原文| excerpt| passage| prose)\b/i.test(result.title)) score += 0.1;
  if (/\b(小说|novel|fiction|写作|作品)\b/i.test(result.title)) score += 0.05;

  return Math.min(1, Math.round(score * 100) / 100);
}

/**
 * Search for author works across configured providers.
 * Currently supports Tavily; Bing/Google can be added as future extensions.
 */
export async function searchAuthorWorks(
  config: AuthorSearchConfig,
): Promise<ReadonlyArray<SearchSourceResult>> {
  const results: SearchSourceResult[] = [];

  // 1. Tavily search
  try {
    const query = buildSearchQuery(config.authorName, config.language);
    const tavilyResults = await searchWeb(query, config.maxResultsPerSource ?? 10);
    results.push(...tavilyResults.map((r) => ({
      source: "tavily" as const,
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      relevance: computeRelevance(r, config.authorName),
    })));
  } catch (e) {
    console.warn("[author-search] Tavily unavailable:", e instanceof Error ? e.message : e);
  }

  // 2. URL deduplication
  const urlMap = new Map<string, SearchSourceResult>();
  for (const r of results) {
    const existing = urlMap.get(r.url);
    if (!existing || existing.relevance < r.relevance) {
      urlMap.set(r.url, r);
    }
  }

  return [...urlMap.values()]
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 20);
}
