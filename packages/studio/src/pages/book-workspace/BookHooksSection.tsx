import type { Theme } from "../../hooks/use-theme";
import type { TFunction } from "../../hooks/use-i18n";
import type { SSEMessage } from "../../hooks/use-sse";

interface BookHooksSectionProps {
  readonly bookId: string;
  readonly nav: {
    readonly toDashboard: () => void;
    readonly toChapter: (bookId: string, num: number) => void;
    readonly toBook: (bookId: string) => void;
    readonly toBookSection: (bookId: string, section: string) => void;
  };
  readonly theme: Theme;
  readonly t: TFunction;
  readonly sse: { readonly messages: ReadonlyArray<SSEMessage>; readonly connected: boolean };
}

export function BookHooksSection({ bookId }: BookHooksSectionProps) {
  return (
    <div className="flex items-center justify-center h-full text-muted-foreground">
      <span>Hooks section placeholder for {bookId}</span>
    </div>
  );
}
