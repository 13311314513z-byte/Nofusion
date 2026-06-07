/**
 * Document extraction adapter for Studio.
 * Wraps /style/extract-text API calls so Studio pages share one code path.
 * Uses fetchJson for consistent base URL handling and error parsing.
 */

import { fetchJson } from "../hooks/use-api";
import type { ExtractApiFileType } from "./source-utils";

export interface ExtractedDoc {
  readonly sourceName: string;
  readonly fileType: ExtractApiFileType;
  readonly text: string;
  readonly charCount: number;
  readonly textHash: string;
  readonly warnings: ReadonlyArray<string>;
  readonly truncated: boolean;
  readonly totalChunks: number;
  readonly chunkIndex: number;
  readonly originalLength?: number;
}

export interface ExtractOptions {
  readonly sourceName?: string;
  readonly fileType?: ExtractApiFileType;
  readonly maxChars?: number;
  readonly chunk?: number;
}

/** Call Studio API to extract text from raw input. */
export async function extractDocument(
  text: string,
  options: ExtractOptions = {},
): Promise<ExtractedDoc> {
  const { sourceName, fileType, maxChars, chunk } = options;
  const body: Record<string, unknown> = { text, sourceName: sourceName || "sample" };
  if (fileType) body.fileType = fileType;
  if (typeof maxChars === "number") body.maxChars = maxChars;
  if (typeof chunk === "number") body.chunk = chunk;

  return fetchJson<ExtractedDoc>("/style/extract-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
