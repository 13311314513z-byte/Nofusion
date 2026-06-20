// ─── Types ────────────────────────────────────────────────────────────────────

export interface StyleStatusNotice {
  readonly tone: "error" | "success" | "info";
  readonly message: string;
}

// ─── File type helpers ────────────────────────────────────────────────────────

export type LocalStyleFileType = "txt" | "md" | "jsonl" | "json" | "ts" | "js" | "html" | "css";

export function inferLocalStyleFileType(fileName: string): LocalStyleFileType | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".jsonl.md") || lower.endsWith(".jsonl.markdown")) return "jsonl";
  if (lower.endsWith(".json.md") || lower.endsWith(".json.markdown")) return "json";
  if (lower.endsWith(".txt")) return "txt";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "md";
  if (lower.endsWith(".jsonl")) return "jsonl";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".ts")) return "ts";
  if (lower.endsWith(".js")) return "js";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".css")) return "css";
  return null;
}

export function buildLocalStyleSourceId(fileName: string, seed: number, index = 0): string {
  const localName = fileName.split(/[/\\]/).pop() ?? fileName;
  const baseName = localName.replace(/\.[^.]+$/, "").trim();
  const safeBase = baseName.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${seed}-${index}-${safeBase || "sample"}`;
}

export function readLocalTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read local file"));
    reader.readAsText(file, "utf-8");
  });
}

// ─── Status notice builder ────────────────────────────────────────────────────

export function buildStyleStatusNotice(analyzeStatus: string, importStatus: string): StyleStatusNotice | null {
  const message = analyzeStatus.trim() || importStatus.trim();
  if (!message) return null;
  if (message.startsWith("Error:")) {
    return { tone: "error", message };
  }
  if (message.endsWith("...")) {
    return { tone: "info", message };
  }
  return { tone: "success", message };
}
