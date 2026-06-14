export type BookSection =
  | "overview"
  | "chat"
  | "chapters"
  | "scenes"
  | "characters"
  | "hooks"
  | "truth"
  | "summaries"
  | "audit"
  | "export"
  | "goals"
  | "fanfic"
  | "runtime"
  | "sources"
  | "settings";

export const BOOK_SECTIONS: BookSection[] = [
  "overview",
  "chat",
  "chapters",
  "scenes",
  "characters",
  "hooks",
  "truth",
  "summaries",
  "goals",
  "audit",
  "export",
  "fanfic",
  "runtime",
  "sources",
  "settings",
];

export function isBookSection(value: string): value is BookSection {
  return BOOK_SECTIONS.includes(value as BookSection);
}
