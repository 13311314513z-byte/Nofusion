import {
  LayoutDashboard,
  MessageSquare,
  Files,
  MapPinned,
  Users,
  GitBranch,
  BookOpen,
  ListTree,
  Target,
  ShieldCheck,
  Download,
  Library,
  Sparkles,
  Cpu,
  Database,
} from "lucide-react";
import { useColors } from "../../hooks/use-colors";
import type { Theme } from "../../hooks/use-theme";
import type { TFunction } from "../../hooks/use-i18n";
import type { BookSection } from "./book-workspace-types";

const MENU_ITEMS: { readonly key: BookSection; readonly icon: React.ElementType }[] = [
  { key: "overview", icon: LayoutDashboard },
  { key: "chat", icon: MessageSquare },
  { key: "chapters", icon: Files },
  { key: "scenes", icon: MapPinned },
  { key: "characters", icon: Users },
  { key: "hooks", icon: GitBranch },
  { key: "truth", icon: BookOpen },
  { key: "summaries", icon: ListTree },
  { key: "goals", icon: Target },
  { key: "audit", icon: ShieldCheck },
  { key: "export", icon: Download },
  { key: "fanfic", icon: Sparkles },
  { key: "runtime", icon: Cpu },
  { key: "sources", icon: Database },
];

interface BookWorkspaceNavProps {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly activeSection: BookSection;
  readonly onSectionChange: (section: BookSection) => void;
  readonly onBackToLibrary: () => void;
  readonly theme: Theme;
  readonly t: TFunction;
}

export function BookWorkspaceNav({
  bookId,
  bookTitle,
  activeSection,
  onSectionChange,
  onBackToLibrary,
  theme,
  t,
}: BookWorkspaceNavProps) {
  const c = useColors(theme);

  return (
    <div className="w-56 shrink-0 border-r border-border/40 bg-card/30 flex flex-col h-full">
      {/* Back to library */}
      <div className="px-3 py-3 border-b border-border/20">
        <button
          onClick={onBackToLibrary}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${c.btnSecondary}`}
        >
          <Library size={14} />
          {t("workspace.backToLibrary")}
        </button>
      </div>

      {/* Book title */}
      <div className="px-4 py-3 border-b border-border/20">
        <h2 className="text-sm font-semibold truncate" title={bookTitle}>
          {bookTitle}
        </h2>
        <p className={`text-[10px] ${c.muted} mt-0.5`}>{bookId}</p>
      </div>

      {/* Section menu */}
      <nav className="flex-1 overflow-y-auto py-2 space-y-0.5 px-2">
        {MENU_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.key;
          return (
            <button
              key={item.key}
              onClick={() => onSectionChange(item.key)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-primary/10 text-primary font-medium"
                  : `text-muted-foreground hover:bg-muted/50 hover:text-foreground`
              }`}
            >
              <Icon size={15} />
              <span className="capitalize">{t(`workspace.section.${item.key}`)}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
