/**
 * Shared source utility functions for Studio browser environment.
 * Pure function layer — no React dependencies, no side effects.
 * CLI should NOT import this file (uses browser APIs like File/FileReader).
 */

import type { DocumentFileType } from "@actalk/inkos-core";

export type ExtractApiFileType = Exclude<DocumentFileType, "htm">;

/** Infer API-acceptable file type from file name, including compound extensions. */
export function inferFileType(fileName: string): ExtractApiFileType | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".jsonl.md") || lower.endsWith(".jsonl.markdown")) return "jsonl";
  if (lower.endsWith(".json.md") || lower.endsWith(".json.markdown")) return "json";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "md";
  if (lower.endsWith(".txt")) return "txt";
  if (lower.endsWith(".jsonl")) return "jsonl";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".ts")) return "ts";
  if (lower.endsWith(".js")) return "js";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".css")) return "css";
  return null;
}

/** Read a browser File object as UTF-8 text. */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsText(file);
  });
}

/**
 * Basic client-side file validation.
 * Server-side MAX_CHARS and chunking still apply — this is just UX protection.
 */
export function validateSourceFile(file: File, maxBytes = 50 * 1024 * 1024): string | null {
  if (!file.name || file.size === 0) return "File is empty";
  if (file.size > maxBytes) return `File exceeds ${Math.round(maxBytes / 1024 / 1024)}MB limit`;
  if (!inferFileType(file.name)) return `Unsupported file type: ${file.name}`;
  return null;
}

/** Format byte count to human-readable string. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
