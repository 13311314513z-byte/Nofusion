/**
 * Web search + URL fetch utilities.
 *
 * searchWeb(): Tavily API search (requires TAVILY_API_KEY env var).
 * fetchUrl(): Fetch a specific URL and return plain text.
 */

export interface SearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

/**
 * Search the web via Tavily API.
 * Requires TAVILY_API_KEY environment variable.
 * Throws if key is not set — caller should catch and fall back to regular chat.
 */
export async function searchWeb(query: string, maxResults = 5): Promise<ReadonlyArray<SearchResult>> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY not set. Set this env var to enable web search, or use OpenAI which has native search.");
  }

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      search_depth: "basic",
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Tavily search failed: ${res.status} ${await res.text().catch(() => "")}`);
  }

  const data = await res.json() as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (data.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.content ?? "",
  }));
}

/**
 * Fetch a URL and return its text content.
 * HTML is stripped to plain text. Output is truncated to maxChars.
 */
export async function fetchUrl(url: string, maxChars = 8000): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Accept": "text/html, application/json, text/plain",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();

  if (contentType.includes("html")) {
    // Step 1: Strip script/style tags
    const cleaned = text
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<aside[\s\S]*?<\/aside>/gi, "");

    // Step 2: Try semantic tag extraction (article/main/content)
    const articleMatch = cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    const mainMatch = cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    const contentMatch = cleaned.match(/<div[^>]*(?:class|id)\s*=\s*["'](?:content|post|entry|article|main-text|chapter-text)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);

    let bodyHtml = cleaned;
    if (articleMatch) bodyHtml = articleMatch[1];
    else if (mainMatch) bodyHtml = mainMatch[1];
    else if (contentMatch) bodyHtml = contentMatch[1];

    // Step 3: Strip remaining HTML tags
    return bodyHtml
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxChars);
  }

  return text.slice(0, maxChars);
}
