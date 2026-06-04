import type { Theme } from "../../hooks/use-theme";
import type { TFunction } from "../../hooks/use-i18n";
import type { SSEMessage } from "../../hooks/use-sse";
import { TruthFiles } from "../TruthFiles";

interface BookTruthSectionProps {
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

export function BookTruthSection({ bookId, nav, theme, t }: BookTruthSectionProps) {
  return (
    <div className="h-full overflow-y-auto">
      <TruthFiles bookId={bookId} nav={nav} theme={theme} t={t} />
    </div>
  );
}
