export type BookSection =
  | "chat"
  | "chapters"
  | "characters"
  | "hooks"
  | "truth"
  | "summaries"
  | "audit"
  | "export";

export const BOOK_SECTIONS: BookSection[] = [
  "chat",
  "chapters",
  "characters",
  "hooks",
  "truth",
  "summaries",
  "audit",
  "export",
];

export function isBookSection(value: string): value is BookSection {
  return BOOK_SECTIONS.includes(value as BookSection);
}
