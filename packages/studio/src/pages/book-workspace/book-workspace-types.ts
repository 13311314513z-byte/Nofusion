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
  | "intents"
  | "fanfic"
  | "runtime"
  | "sources"
  | "event-chain"
  | "scene-templates"
  | "voice-profiles"
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
  "intents",
  "audit",
  "export",
  "fanfic",
  "runtime",
  "sources",
  "event-chain",
  "scene-templates",
  "voice-profiles",
  "settings",
];

export function isBookSection(value: string): value is BookSection {
  return BOOK_SECTIONS.includes(value as BookSection);
}
