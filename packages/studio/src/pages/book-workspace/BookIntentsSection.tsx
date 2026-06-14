import { useState } from "react";
import type { Theme } from "../../hooks/use-theme";
import type { TFunction } from "../../hooks/use-i18n";
import type { SSEMessage } from "../../hooks/use-sse";
import { useApi } from "../../hooks/use-api";
import { useBookContext } from "../../hooks/use-book-context";
import { InterviewPanel } from "../../components/author/InterviewPanel";
import { MessageSquareHeart, ChevronLeft, ChevronRight } from "lucide-react";

interface BookData {
  readonly chapters: ReadonlyArray<{ readonly number: number; readonly title: string }>;
}

interface BookIntentsSectionProps {
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

export function BookIntentsSection({ bookId }: BookIntentsSectionProps) {
  const { data } = useApi<BookData>(`/books/${encodeURIComponent(bookId)}`);
  const { notify } = useBookContext();
  const [chapterNumber, setChapterNumber] = useState<number>(() => {
    const chapters = data?.chapters ?? [];
    return chapters.length > 0 ? chapters[chapters.length - 1]!.number + 1 : 1;
  });

  const chapters = data?.chapters ?? [];
  const maxChapter = chapters.length > 0 ? chapters[chapters.length - 1]!.number + 1 : 1;

  const handlePrev = () => setChapterNumber((prev) => Math.max(1, prev - 1));
  const handleNext = () => setChapterNumber((prev) => Math.min(maxChapter + 5, prev + 1));

  const handleSaved = () => {
    notify({ type: "intent-updated", chapterNumber });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Chapter selector */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border/30 bg-secondary/20">
        <div className="flex items-center gap-3">
          <MessageSquareHeart size={18} className="text-primary" />
          <span className="text-sm font-semibold">创作访谈</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrev}
            disabled={chapterNumber <= 1}
            className="p-1.5 rounded-lg hover:bg-secondary transition-colors disabled:opacity-30"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-medium min-w-[80px] text-center">
            第 {chapterNumber} 章
          </span>
          <button
            onClick={handleNext}
            className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Interview panel */}
      <div className="flex-1 overflow-hidden">
        <InterviewPanel
          bookId={bookId}
          chapterNumber={chapterNumber}
          onSaved={handleSaved}
        />
      </div>
    </div>
  );
}
