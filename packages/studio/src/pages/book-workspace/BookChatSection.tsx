import type { Theme } from "../../hooks/use-theme";
import type { TFunction } from "../../hooks/use-i18n";
import type { SSEMessage } from "../../hooks/use-sse";
import { ChatPage } from "../ChatPage";
import { BookSidebar, BookSidebarToggle } from "../../components/chat/BookSidebar";

interface BookChatSectionProps {
  readonly bookId: string;
  readonly nav: {
    readonly toDashboard: () => void;
    readonly toChapter: (bookId: string, num: number) => void;
    readonly toBook: (bookId: string) => void;
    readonly toBookSection: (bookId: string, section: string) => void;
    readonly toServices: () => void;
  };
  readonly theme: Theme;
  readonly t: TFunction;
  readonly sse: { readonly messages: ReadonlyArray<SSEMessage>; readonly connected: boolean };
}

export function BookChatSection({ bookId, nav, theme, t, sse }: BookChatSectionProps) {
  return (
    <div className="flex h-full min-w-0">
      <ChatPage
        activeBookId={bookId}
        mode="book"
        nav={nav}
        theme={theme}
        t={t}
        sse={sse}
      />
      <BookSidebar bookId={bookId} theme={theme} t={t} sse={sse} />
      <BookSidebarToggle bookId={bookId} theme={theme} t={t} sse={sse} />
    </div>
  );
}
