import { useState, useEffect } from "react";
import { Streamdown } from "streamdown";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { BookOpen, Globe, Users } from "lucide-react";
import { fetchJson } from "../../hooks/use-api";
import type { Theme } from "../../hooks/use-theme";
import type { TFunction } from "../../hooks/use-i18n";
import type { SSEMessage } from "../../hooks/use-sse";

const streamdownPlugins = { cjk, code, math };

const MD_CLASS =
  "text-sm text-muted-foreground leading-relaxed " +
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 " +
  "[&>p+p]:mt-2 [&_strong]:text-foreground [&_strong]:font-medium " +
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 " +
  "[&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mt-3 [&_h2]:mb-1 " +
  "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-foreground [&_h3]:mt-2.5 [&_h3]:mb-1 " +
  "[&_code]:text-xs [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:bg-secondary/60";

interface BookSummary {
  world: string;
  protagonist: string;
  cast: string;
}

function parseStoryBible(content: string): BookSummary {
  const sections = content.split(/^##\s+/m);
  let world = "";
  let protagonist = "";
  let cast = "";

  for (const section of sections) {
    if (/^0?1[_\s]|世界观|world/i.test(section)) {
      world = section.replace(/^[^\n]+\n/, "").trim().split("\n\n")[0] ?? "";
    } else if (/^0?2[_\s]|主角|protagonist/i.test(section)) {
      protagonist = section.replace(/^[^\n]+\n/, "").trim().split("\n\n")[0] ?? "";
    } else if (/^0?3[_\s]|配角|supporting|cast/i.test(section)) {
      cast = section.replace(/^[^\n]+\n/, "").trim().split("\n\n")[0] ?? "";
    }
  }

  return { world, protagonist, cast };
}

interface BookSummariesSectionProps {
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

export function BookSummariesSection({ bookId, t }: BookSummariesSectionProps) {
  const [summary, setSummary] = useState<BookSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    setLoading(true);
    setError("");
    fetchJson<{ content: string | null }>(`/books/${bookId}/truth/story_bible.md`)
      .then((data) => {
        if (data.content) {
          setSummary(parseStoryBible(data.content));
        }
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load story bible");
      })
      .finally(() => setLoading(false));
  }, [bookId]);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="paper-sheet rounded-2xl border border-border/40 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <BookOpen size={16} className="text-primary/70" />
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{t("workspace.section.summaries")}</h2>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</div>
        )}

        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
        ) : summary?.world || summary?.protagonist || summary?.cast ? (
          <div className="grid grid-cols-1 gap-4">
            {summary.world && (
              <SummaryCard title={t("summary.worldView")} icon={<Globe size={16} className="text-primary/70" />} content={summary.world} />
            )}
            {summary.protagonist && (
              <SummaryCard title={t("summary.protagonist")} icon={<Users size={16} className="text-primary/70" />} content={summary.protagonist} />
            )}
            {summary.cast && (
              <SummaryCard title={t("summary.supportingCast")} icon={<Users size={16} className="text-primary/70" />} content={summary.cast} />
            )}
          </div>
        ) : (
          <div className="py-12 text-center text-sm text-muted-foreground">{t("book.noSummary")}</div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ title, icon, content }: { readonly title: string; readonly icon: React.ReactNode; readonly content: string }) {
  return (
    <div className="rounded-xl border border-border/40 bg-secondary/10 p-4">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="text-sm font-semibold text-foreground font-['SimSun','Songti_SC','STSong',serif]">{title}</h3>
      </div>
      <Streamdown className={MD_CLASS} plugins={streamdownPlugins}>
        {content}
      </Streamdown>
    </div>
  );
}
