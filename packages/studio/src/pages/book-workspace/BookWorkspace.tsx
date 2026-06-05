import type { Theme } from "../../hooks/use-theme";
import type { TFunction } from "../../hooks/use-i18n";
import type { SSEMessage } from "../../hooks/use-sse";
import { useApi } from "../../hooks/use-api";
import type { BookSection } from "./book-workspace-types";
import { BookWorkspaceNav } from "./BookWorkspaceNav";
import { BookOverviewSection } from "./BookOverviewSection";
import { BookChatSection } from "./BookChatSection";
import { BookChaptersSection } from "./BookChaptersSection";
import { BookScenesSection } from "./BookScenesSection";
import { BookCharactersSection } from "./BookCharactersSection";
import { BookHooksSection } from "./BookHooksSection";
import { BookTruthSection } from "./BookTruthSection";
import { BookSummariesSection } from "./BookSummariesSection";
import { BookGoalsSection } from "./BookGoalsSection";
import { BookAuditSection } from "./BookAuditSection";
import { BookExportSection } from "./BookExportSection";
import { BookFanficSection } from "./BookFanficSection";
import { BookRuntimeSection } from "./BookRuntimeSection";

interface NavLike {
  readonly toDashboard: () => void;
  readonly toChapter: (bookId: string, num: number) => void;
  readonly toBook: (bookId: string) => void;
  readonly toBookSection: (bookId: string, section: string) => void;
  readonly toServices: () => void;
  readonly toAudit: () => void;
}

interface BookWorkspaceProps {
  readonly bookId: string;
  readonly section: BookSection;
  readonly nav: NavLike;
  readonly theme: Theme;
  readonly t: TFunction;
  readonly sse: { readonly messages: ReadonlyArray<SSEMessage>; readonly connected: boolean };
}

export function BookWorkspace({ bookId, section, nav, theme, t, sse }: BookWorkspaceProps) {
  const { data: bookData } = useApi<{ book: { title: string } }>(`/books/${encodeURIComponent(bookId)}`);
  const bookTitle = bookData?.book.title ?? bookId;

  const handleSectionChange = (s: BookSection) => {
    nav.toBookSection(bookId, s);
  };

  return (
    <div className="flex h-full w-full min-w-0">
      <BookWorkspaceNav
        bookId={bookId}
        bookTitle={bookTitle}
        activeSection={section}
        onSectionChange={handleSectionChange}
        onBackToLibrary={nav.toDashboard}
        theme={theme}
        t={t}
      />
      <main className="flex-1 min-w-0 overflow-y-auto bg-background/30">
        <SectionRenderer bookId={bookId} section={section} nav={nav} theme={theme} t={t} sse={sse} />
      </main>
    </div>
  );
}

function SectionRenderer({
  bookId,
  section,
  nav,
  theme,
  t,
  sse,
}: {
  readonly bookId: string;
  readonly section: BookSection;
  readonly nav: NavLike;
  readonly theme: Theme;
  readonly t: TFunction;
  readonly sse: { readonly messages: ReadonlyArray<SSEMessage>; readonly connected: boolean };
}) {
  const commonProps = { bookId, nav, theme, t, sse };
  switch (section) {
    case "overview":
      return <BookOverviewSection {...commonProps} />;
    case "chat":
      return <BookChatSection {...commonProps} />;
    case "chapters":
      return <BookChaptersSection {...commonProps} />;
    case "scenes":
      return <BookScenesSection {...commonProps} />;
    case "characters":
      return <BookCharactersSection {...commonProps} />;
    case "hooks":
      return <BookHooksSection {...commonProps} />;
    case "truth":
      return <BookTruthSection {...commonProps} />;
    case "summaries":
      return <BookSummariesSection {...commonProps} />;
    case "goals":
      return <BookGoalsSection {...commonProps} />;
    case "audit":
      return <BookAuditSection {...commonProps} />;
    case "export":
      return <BookExportSection {...commonProps} />;
    case "fanfic":
      return <BookFanficSection {...commonProps} />;
    case "runtime":
      return <BookRuntimeSection {...commonProps} />;
    default:
      return <BookOverviewSection {...commonProps} />;
  }
}
