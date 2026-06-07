import { useEffect, useState } from "react";
import { Users, ChevronDown, Loader2, Tags } from "lucide-react";
import { useChatStore } from "../../store/chat";
import { fetchJson } from "../../hooks/use-api";
import { SidebarCard } from "./SidebarCard";
import { cn } from "../../lib/utils";

interface CharacterInfo {
  name: string;
  fields: Record<string, string>;
}

type RoleTier = "major" | "minor";

interface RoleCardListItem {
  readonly id: string;
  readonly name: string;
  readonly roleTier: RoleTier;
  readonly status?: string;
  readonly tags?: ReadonlyArray<string>;
}

interface RoleCard {
  readonly id: string;
  readonly frontmatter: {
    readonly name: string;
    readonly roleTier: RoleTier;
    readonly aliases?: ReadonlyArray<string>;
    readonly status?: string;
    readonly tags?: ReadonlyArray<string>;
    readonly arcStage?: string;
  };
  readonly body: string;
}

function parseCharacterMatrix(md: string): CharacterInfo[] {
  const characters: CharacterInfo[] = [];
  // Split by ## headings (level 2 only)
  const sections = md.split(/^## /m).slice(1);
  for (const section of sections) {
    const lines = section.split("\n");
    const name = lines[0].trim();
    if (!name) continue;
    const fields: Record<string, string> = {};
    for (let i = 1; i < lines.length; i++) {
      const match = lines[i].match(/^-\s+\*\*(.+?)\*\*:\s*(.+)/);
      if (match) {
        fields[match[1]] = match[2].trim();
      }
    }
    characters.push({ name, fields });
  }
  return characters;
}

function roleTierLabel(tier: RoleTier): string {
  return tier === "major" ? "主要" : "次要";
}

function extractRoleSummary(body: string): string {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 220);
}

const ROLE_COLORS: Record<string, string> = {
  "主角": "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  "反派": "bg-red-500/15 text-red-600 dark:text-red-400",
  "盟友": "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  "配角": "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  "提及": "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
  "protagonist": "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  "antagonist": "bg-red-500/15 text-red-600 dark:text-red-400",
  "ally": "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  "minor": "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  "mentioned": "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
};

function getRoleColor(role: string): string {
  const lower = role.toLowerCase().trim();
  for (const [key, color] of Object.entries(ROLE_COLORS)) {
    if (lower.includes(key)) return color;
  }
  return "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400";
}

function RoleCardDropdown({ bookId, role }: { readonly bookId: string; readonly role: RoleCardListItem }) {
  const [expanded, setExpanded] = useState(false);
  const [card, setCard] = useState<RoleCard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!expanded || card) return;

    setLoading(true);
    setError(null);
    fetchJson<{ card: RoleCard }>(`/books/${bookId}/roles/${encodeURIComponent(role.id)}`)
      .then((data) => {
        if (!cancelled) setCard(data.card);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bookId, card, expanded, role.id]);

  const roleColor = role.roleTier === "major"
    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
    : "bg-blue-500/15 text-blue-600 dark:text-blue-400";
  const tags = card?.frontmatter.tags ?? role.tags ?? [];
  const aliases = card?.frontmatter.aliases ?? [];
  const summary = card ? extractRoleSummary(card.body) : "";

  return (
    <div className="rounded-lg bg-secondary/30 overflow-hidden">
      <button
        onClick={() => setExpanded((value) => !value)}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left"
      >
        <Users size={14} className="shrink-0 text-muted-foreground/60" />
        <span className="text-sm font-medium text-foreground font-['SimSun','Songti_SC','STSong',serif] flex-1 truncate">
          {role.name}
        </span>
        <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full shrink-0", roleColor)}>
          {roleTierLabel(role.roleTier)}
        </span>
        <ChevronDown size={12} className={cn("text-muted-foreground/50 transition-transform shrink-0", expanded && "rotate-180")} />
      </button>
      {expanded && (
        <div className="px-2.5 pb-2.5 space-y-2">
          {loading && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" />
              读取角色卡...
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          {role.status && (
            <p className="text-xs text-muted-foreground"><span className="text-muted-foreground/60">状态</span> {role.status}</p>
          )}
          {aliases.length > 0 && (
            <p className="text-xs text-muted-foreground"><span className="text-muted-foreground/60">别名</span> {aliases.join("、")}</p>
          )}
          {card?.frontmatter.arcStage && (
            <p className="text-xs text-muted-foreground"><span className="text-muted-foreground/60">弧线</span> {card.frontmatter.arcStage}</p>
          )}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.slice(0, 6).map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-background/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  <Tags size={9} />
                  {tag}
                </span>
              ))}
            </div>
          )}
          {summary && <p className="text-xs leading-5 text-muted-foreground">{summary}</p>}
        </div>
      )}
    </div>
  );
}

function CharacterCard({ char }: { readonly char: CharacterInfo }) {
  const [expanded, setExpanded] = useState(false);
  const role = char.fields["定位"] ?? char.fields["Role"] ?? "";
  const tags = char.fields["标签"] ?? char.fields["Tags"] ?? "";
  const current = char.fields["当前"] ?? char.fields["Current"] ?? "";

  return (
    <div className="rounded-lg bg-secondary/30 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left"
      >
        <Users size={14} className="shrink-0 text-muted-foreground/60" />
        <span className="text-sm font-medium text-foreground font-['SimSun','Songti_SC','STSong',serif] flex-1 truncate">
          {char.name}
        </span>
        {role && (
          <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full shrink-0", getRoleColor(role))}>
            {role.split("/")[0].trim()}
          </span>
        )}
        <ChevronDown size={12} className={cn("text-muted-foreground/50 transition-transform shrink-0", expanded && "rotate-180")} />
      </button>
      {expanded && (
        <div className="px-2.5 pb-2.5 space-y-1">
          {tags && (
            <p className="text-xs text-muted-foreground"><span className="text-muted-foreground/60">标签</span> {tags}</p>
          )}
          {current && (
            <p className="text-xs text-muted-foreground"><span className="text-muted-foreground/60">当前</span> {current}</p>
          )}
          {Object.entries(char.fields)
            .filter(([k]) => !["定位", "Role", "标签", "Tags", "当前", "Current"].includes(k))
            .map(([key, val]) => (
              <p key={key} className="text-xs text-muted-foreground">
                <span className="text-muted-foreground/60">{key}</span> {val}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}

interface CharacterSectionProps {
  readonly bookId: string;
}

export function CharacterSection({ bookId }: CharacterSectionProps) {
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [roles, setRoles] = useState<RoleCardListItem[]>([]);
  const bookDataVersion = useChatStore((s) => s.bookDataVersion);

  useEffect(() => {
    let cancelled = false;

    fetchJson<{ roles: RoleCardListItem[] }>(`/books/${bookId}/roles`)
      .then((data) => {
        if (cancelled) return;
        const nextRoles = data.roles ?? [];
        setRoles(nextRoles);
        if (nextRoles.length > 0) {
          setCharacters([]);
          return;
        }

        fetchJson<{ content: string | null }>(`/books/${bookId}/truth/character_matrix.md`)
          .then((matrixData) => {
            if (cancelled) return;
            setCharacters(matrixData.content ? parseCharacterMatrix(matrixData.content) : []);
          })
          .catch(() => {
            if (!cancelled) setCharacters([]);
          });
      })
      .catch(() => {
        if (cancelled) return;
        setRoles([]);
        fetchJson<{ content: string | null }>(`/books/${bookId}/truth/character_matrix.md`)
          .then((data) => {
            if (!cancelled) setCharacters(data.content ? parseCharacterMatrix(data.content) : []);
          })
          .catch(() => {
            if (!cancelled) setCharacters([]);
          });
      });

    return () => {
      cancelled = true;
    };
  }, [bookId, bookDataVersion]);

  if (roles.length === 0 && characters.length === 0) return null;

  return (
    <SidebarCard title="角色">
      <div className="space-y-1.5">
        {roles.length > 0 ? (
          roles.map((role) => (
            <RoleCardDropdown key={role.id} bookId={bookId} role={role} />
          ))
        ) : (
          characters.map((char) => (
            <CharacterCard key={char.name} char={char} />
          ))
        )}
      </div>
    </SidebarCard>
  );
}
