/**
 * SSRF-safe style import URL guards — single source of truth.
 *
 * Previously duplicated across routes/style.ts, routes/authors.ts,
 * and the old server.ts. Extracted for P1-3 to eliminate the
 * three-way duplication.
 *
 * @module
 */

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STYLE_ID_RE = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,127}$/u;
const WINDOWS_RESERVED_STYLE_ID_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// ---------------------------------------------------------------------------
// Style ID validation
// ---------------------------------------------------------------------------

/** Validate a style/author/source ID against path-traversal and reserved-name risks. */
export function isSafeStyleId(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    STYLE_ID_RE.test(value.trim()) &&
    value.trim() !== "." &&
    value.trim() !== ".." &&
    !WINDOWS_RESERVED_STYLE_ID_RE.test(value.trim())
  );
}

/** Validate that a file type string is one of the supported text formats. */
export function isTextStyleFileType(value: unknown): value is "md" | "txt" | "jsonl" | "json" | "ts" | "js" | "html" | "css" {
  return value === "md" || value === "txt" || value === "jsonl" || value === "json" || value === "ts" || value === "js" || value === "html" || value === "css";
}

// ---------------------------------------------------------------------------
// SSRF protection — URL import guards
// ---------------------------------------------------------------------------

function isBlockedStyleImportAddress(address: string): boolean {
  const host = address.toLowerCase().replace(/^\[|\]$/g, "");
  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const [a = 0, b = 0] = host.split(".").map((part) => Number(part));
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (ipVersion === 6) {
    if (host.startsWith("::ffff:")) {
      return isBlockedStyleImportAddress(host.slice("::ffff:".length));
    }
    return (
      host === "::" ||
      host === "::1" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe80:")
    );
  }
  return false;
}

function isBlockedStyleImportHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    isBlockedStyleImportAddress(host)
  );
}

/** Parse and validate a style import URL. Rejects private/local/credentialed URLs. */
export function parseSafeStyleImportUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("url is required");
  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("only http and https URLs are supported");
  }
  if (url.username || url.password) {
    throw new Error("URL credentials are not allowed");
  }
  if (isBlockedStyleImportHostname(url.hostname)) {
    throw new Error("private or local URLs are not allowed");
  }
  return url;
}

/** DNS-level SSRF check: resolve the URL hostname and verify it doesn't point to a private address. */
export async function assertSafeStyleImportTarget(url: URL): Promise<void> {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isBlockedStyleImportHostname(host)) {
    throw new Error("private or local URLs are not allowed");
  }
  if (isIP(host)) return;
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("URL hostname could not be resolved");
  }
  if (addresses.length === 0 || addresses.some((record) => isBlockedStyleImportAddress(record.address))) {
    throw new Error("private or local URLs are not allowed");
  }
}

// ---------------------------------------------------------------------------
// HTML / response helpers
// ---------------------------------------------------------------------------

export function extractHtmlTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  return match[1]
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || null;
}

export async function readStyleImportBody(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error(`URL response is too large (max ${Math.floor(maxBytes / 1_000_000)}MB)`);
    }
    return text;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        reader.cancel();
        throw new Error(`URL response is too large (max ${Math.floor(maxBytes / 1_000_000)}MB)`);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}
