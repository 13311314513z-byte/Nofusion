import { useState, useEffect, useMemo } from "react";
import type { Theme } from "../../hooks/use-theme";
import type { TFunction } from "../../hooks/use-i18n";
import type { SSEMessage } from "../../hooks/use-sse";
import { fetchJson, useApi } from "../../hooks/use-api";
import { UserRound, Plus, Save, Trash2, Tags, ChevronDown, ChevronUp, Edit3, ArrowLeft, Flag, Briefcase } from "lucide-react";
import { ConfirmDialog } from "../../components/ConfirmDialog";

// Helper to allow new i18n keys before they are added to use-i18n.ts

type RoleTier = "core" | "major" | "minor" | "functional";

interface ChapterMeta {
  readonly number: number;
  readonly title: string;
  readonly status: string;
  readonly wordCount: number;
  readonly povCharacter?: string;
}

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
    readonly id: string;
    readonly name: string;
    readonly roleTier: RoleTier;
    readonly aliases?: ReadonlyArray<string>;
    readonly status?: "active" | "hidden" | "dead" | "departed";
    readonly tags?: ReadonlyArray<string>;
    readonly age?: string;
    readonly identity?: string;
    readonly goal?: string;
    readonly voiceMarker?: string;
  };
  readonly body: string;
}

interface RolesData {
  readonly roles: ReadonlyArray<RoleCardListItem>;
}

interface BookData {
  readonly book: {
    readonly chapters: ReadonlyArray<ChapterMeta>;
  };
}

interface BookCharactersSectionProps {
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

function splitRoleList(value: string): string[] {
  return value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
}

function buildRoleId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff_-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function MetadataField({
  label,
  value,
  onChange,
  placeholder,
  readOnly = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly readOnly?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        className={`rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-sm outline-none focus:border-primary/50 ${readOnly ? "opacity-60 cursor-not-allowed" : ""}`}
      />
    </label>
  );
}

function MetadataBadge({ icon, text }: { readonly icon?: React.ReactNode; readonly text: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-secondary/40 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
      {icon}
      {text}
    </span>
  );
}

// === 角色卡标签分类工具函数（不改动 Core / Server）===
type TagCategory = "faction" | "occupation" | "attribute" | "age" | "custom";

const META_BLOCK_MARKER = "<!-- role-tags -->";
const META_BLOCK_END = "<!-- /role-tags -->";

const ATTRIBUTE_PRESETS = [
  "冷静", "冲动", "忠诚", "狡诈", "仁慈", "残忍",
  "睿智", "天真", "世故", "豪爽", "阴沉", "热情",
  "理性", "感性", "勇敢", "懦弱", "固执", "变通",
];

function parseTag(tag: string): { category: TagCategory; value: string } {
  if (tag.startsWith("势力:")) return { category: "faction", value: tag.slice(3) };
  if (tag.startsWith("职业:")) return { category: "occupation", value: tag.slice(3) };
  if (tag.startsWith("attr:")) return { category: "attribute", value: tag.slice(5) };
  if (tag.startsWith("age:")) return { category: "age", value: tag.slice(4) };
  return { category: "custom", value: tag };
}

interface GroupedTags {
  faction?: string;
  occupation?: string;
  attributes: string[];
  age?: string;
  customs: string[];
}

function categorizeTags(tags: readonly string[]): GroupedTags {
  const result: GroupedTags = { attributes: [], customs: [] };
  for (const tag of tags) {
    const { category, value } = parseTag(tag);
    switch (category) {
      case "faction": result.faction = value; break;
      case "occupation": result.occupation = value; break;
      case "attribute": result.attributes.push(value); break;
      case "age": result.age = value; break;
      case "custom": result.customs.push(value); break;
    }
  }
  return result;
}

function buildBodyMetaBlock(opts: {
  roleTier: string;
  age?: string;
  faction?: string;
  occupation?: string;
  identity?: string;
  attributes: string[];
  customs: string[];
}): string {
  const lines: string[] = [META_BLOCK_MARKER, "", "## 角色标签", ""];
  if (opts.roleTier) {
    const labelMap: Record<string, string> = {
      core: "核心角色", major: "重要角色", minor: "次要角色", functional: "功能角色",
    };
    lines.push(`- **类型**：${labelMap[opts.roleTier] ?? opts.roleTier}`);
  }
  if (opts.age) lines.push(`- **年龄**：${opts.age}`);
  if (opts.faction) lines.push(`- **势力**：${opts.faction}`);
  if (opts.occupation) lines.push(`- **职业**：${opts.occupation}`);
  if (!opts.occupation && opts.identity) lines.push(`- **身份**：${opts.identity}`);
  if (opts.attributes.length) lines.push(`- **属性**：${opts.attributes.join("、")}`);
  if (opts.customs.length) lines.push(`- **自定义**：${opts.customs.join("、")}`);
  lines.push("", META_BLOCK_END);
  return lines.join("\n");
}

function syncBodyMeta(body: string, meta: string): string {
  const startIdx = body.indexOf(META_BLOCK_MARKER);
  const endIdx = body.indexOf(META_BLOCK_END);
  if (startIdx !== -1 && endIdx !== -1) {
    return body.slice(0, startIdx) + meta + body.slice(endIdx + META_BLOCK_END.length);
  }
  return meta + "\n\n" + body;
}

function currentTagList(tagsStr: string): string[] {
  return tagsStr.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean);
}

function setTagWithPrefix(prefix: string, value: string, tagsStr: string, setter: (s: string) => void): void {
  const tags = currentTagList(tagsStr).filter((t) => !t.startsWith(prefix));
  if (value.trim()) tags.push(`${prefix}${value.trim()}`);
  setter(tags.join(", "));
}

function toggleTag(tag: string, tagsStr: string, setter: (s: string) => void): void {
  const tags = currentTagList(tagsStr);
  const idx = tags.indexOf(tag);
  if (idx >= 0) tags.splice(idx, 1);
  else tags.push(tag);
  setter(tags.join(", "));
}

export function BookCharactersSection({ bookId, t }: BookCharactersSectionProps) {
  const { data: rolesData, loading: rolesLoading, error: rolesError, refetch: refetchRoles } = useApi<RolesData>(`/books/${bookId}/roles`);
  const { data: bookData } = useApi<BookData>(`/books/${bookId}`);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const [roleCard, setRoleCard] = useState<RoleCard | null>(null);
  const [roleLoading, setRoleLoading] = useState(false);
  const [roleName, setRoleName] = useState("");
  const [roleTier, setRoleTier] = useState<RoleTier>("major");
  const [roleStatus, setRoleStatus] = useState<"active" | "hidden" | "dead" | "departed" | "">("active");
  const [roleTags, setRoleTags] = useState("");
  const [roleAliases, setRoleAliases] = useState("");
  const [roleBody, setRoleBody] = useState("");
  const [roleAge, setRoleAge] = useState("");
  const [roleIdentity, setRoleIdentity] = useState("");
  const [roleGoal, setRoleGoal] = useState("");
  const [roleVoiceMarker, setRoleVoiceMarker] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [savingRole, setSavingRole] = useState(false);
  const [creatingRole, setCreatingRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleId, setNewRoleId] = useState("");
  const [newRoleTier, setNewRoleTier] = useState<RoleTier>("major");

  const roles = rolesData?.roles ?? [];
  const chapters = bookData?.book?.chapters ?? [];
  const coreRoleCount       = roles.filter((role) => role.roleTier === "core").length;
  const majorRoleCount      = roles.filter((role) => role.roleTier === "major").length;
  const minorRoleCount      = roles.filter((role) => role.roleTier === "minor").length;
  const functionalRoleCount = roles.filter((role) => role.roleTier === "functional").length;

  const povCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const role of roles) {
      const count = chapters.filter(
        (ch) => ch.povCharacter === role.name || ch.povCharacter === role.id
      ).length;
      map.set(role.id, count);
    }
    return map;
  }, [chapters, roles]);

  useEffect(() => {
    if (roles.length === 0) {
      if (selectedRoleId) setSelectedRoleId("");
      setRoleCard(null);
      return;
    }
    if (!selectedRoleId || !roles.some((role) => role.id === selectedRoleId)) {
      setSelectedRoleId(roles[0]!.id);
    }
  }, [rolesData, selectedRoleId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedRoleId) {
      setRoleCard(null);
      setRoleName("");
      setRoleTags("");
      setRoleAliases("");
      setRoleBody("");
      setRoleAge("");
      setRoleIdentity("");
      setRoleGoal("");
      setRoleVoiceMarker("");
      setIsEditing(false);
      setBodyExpanded(false);
      return;
    }

    setRoleLoading(true);
    setIsEditing(false);
    setBodyExpanded(false);
    fetchJson<{ card: RoleCard }>(`/books/${bookId}/roles/${encodeURIComponent(selectedRoleId)}`)
      .then(({ card }) => {
        if (cancelled) return;
        setRoleCard(card);
        setRoleName(card.frontmatter.name);
        setRoleTier(card.frontmatter.roleTier);
        setRoleStatus(card.frontmatter.status ?? "");
        setRoleTags((card.frontmatter.tags ?? []).join(", "));
        setRoleAliases((card.frontmatter.aliases ?? []).join(", "));
        setRoleBody(card.body);
        setRoleAge(card.frontmatter.age ?? "");
        setRoleIdentity(card.frontmatter.identity ?? "");
        setRoleGoal(card.frontmatter.goal ?? "");
        setRoleVoiceMarker(card.frontmatter.voiceMarker ?? "");
      })
      .catch((e) => {
        if (!cancelled) setActionError(e instanceof Error ? e.message : "Load role failed");
      })
      .finally(() => {
        if (!cancelled) setRoleLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bookId, selectedRoleId]);

  const handleCreateRole = async () => {
    const name = newRoleName.trim();
    const id = buildRoleId(newRoleId || name);
    if (!name || !id) return;

    setCreatingRole(true);
    try {
      const result = await fetchJson<{ card: RoleCard }>(`/books/${bookId}/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name, roleTier: newRoleTier }),
      });
      setNewRoleName("");
      setNewRoleId("");
      setNewRoleTier("core");
      setActionError(null);
      await refetchRoles();
      setSelectedRoleId(result.card.id);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Create role failed");
    } finally {
      setCreatingRole(false);
    }
  };

  const handleSaveRole = async () => {
    if (!roleCard) return;
    setSavingRole(true);
    try {
      // 从当前 UI state 收集标签信息
      const groupedTags = categorizeTags(splitRoleList(roleTags));

      // 构建元信息区块
      const metaBlock = buildBodyMetaBlock({
        roleTier,
        age: roleAge.trim() || undefined,
        faction: groupedTags.faction,
        occupation: groupedTags.occupation,
        identity: roleIdentity.trim() || undefined,
        attributes: groupedTags.attributes,
        customs: groupedTags.customs,
      });

      // 同步到 body
      const finalBody = syncBodyMeta(roleBody, metaBlock);

      const result = await fetchJson<{ card: RoleCard }>(`/books/${bookId}/roles/${encodeURIComponent(roleCard.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          frontmatter: {
            name: roleName.trim() || roleCard.frontmatter.name,
            roleTier,
            status: roleStatus || undefined,
            tags: splitRoleList(roleTags),
            aliases: splitRoleList(roleAliases),
            age: roleAge.trim() || undefined,
            identity: roleIdentity.trim() || undefined,
            goal: roleGoal.trim() || undefined,
            voiceMarker: roleVoiceMarker.trim() || undefined,
          },
          body: finalBody,
        }),
      });
      setActionError(null);
      setRoleCard(result.card);
      // 同步返回的 body 到 state（包含新生成的元信息区块）
      setRoleBody(result.card.body);
      await refetchRoles();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Save role failed");
    } finally {
      setSavingRole(false);
    }
  };

  const handleDeleteRole = async () => {
    if (!roleCard) return;
    setConfirmOpen(true);
  };

  const doDeleteRole = async () => {
    setConfirmOpen(false);
    if (!roleCard) return;
    setSavingRole(true);
    try {
      await fetchJson(`/books/${bookId}/roles/${encodeURIComponent(roleCard.id)}`, { method: "DELETE" });
      setSelectedRoleId("");
      setActionError(null);
      setRoleCard(null);
      await refetchRoles();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Delete role failed");
    } finally {
      setSavingRole(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="paper-sheet rounded-2xl border border-border/40 shadow-sm p-5">
        {actionError && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-center justify-between mb-4">
            <span>{actionError}</span>
            <button onClick={() => setActionError(null)} className="text-xs font-bold hover:underline">{t("common.dismiss")}</button>
          </div>
        )}
        {/* Header */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
          <div className="flex items-center gap-2">
            <UserRound size={16} className="text-primary/70" />
            <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{t("book.roleCards")}</h2>
            <span className="rounded-full border border-border/50 bg-secondary/40 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
              {roles.length} · 核心 {coreRoleCount} / 重要 {majorRoleCount} / 次要 {minorRoleCount} / 功能 {functionalRoleCount}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
              placeholder={t("book.newRoleName")}
              className="w-36 rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-xs outline-none focus:border-primary/50"
            />
            <input
              value={newRoleId}
              onChange={(e) => setNewRoleId(e.target.value)}
              placeholder={t("book.newRoleId")}
              className="w-32 rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-xs outline-none focus:border-primary/50"
            />
            <select
              value={newRoleTier}
              onChange={(e) => setNewRoleTier(e.target.value as RoleTier)}
              className="rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-xs outline-none focus:border-primary/50"
            >
              <option value="core">{t("book.coreRole")}</option>
              <option value="major">{t("book.majorRole")}</option>
              <option value="minor">{t("book.minorRole")}</option>
              <option value="functional">{t("book.functionalRole")}</option>
            </select>
            <button
              onClick={handleCreateRole}
              disabled={creatingRole || !newRoleName.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
            >
              {creatingRole ? <div className="h-3.5 w-3.5 rounded-full border-2 border-primary-foreground/20 border-t-primary-foreground animate-spin" /> : <Plus size={14} />}
              {t("book.createRole")}
            </button>
          </div>
        </div>

        {rolesError && (
          <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {rolesError}
          </div>
        )}

        {/* Two-column layout */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
          {/* Left: Role list */}
          <div className="rounded-xl border border-border/40 bg-secondary/20 p-2">
            {rolesLoading ? (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">{t("common.loading")}</div>
            ) : roles.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">{t("book.noRoles")}</div>
            ) : (
              <div className="max-h-[360px] space-y-1 overflow-y-auto pr-1">
                {roles.map((role) => {
                  const povCount = povCountMap.get(role.id) ?? 0;
                  return (
                    <button
                      key={role.id}
                      onClick={() => setSelectedRoleId(role.id)}
                      className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${
                        selectedRoleId === role.id ? "bg-primary/10 text-primary" : "hover:bg-background/70"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold">{role.name}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {povCount > 0 && (
                            <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                              {t("book.povCount").replace("{count}", String(povCount))}
                            </span>
                          )}
                          <span className="shrink-0 rounded-full border border-border/40 px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                            {{core: t("book.coreRole"), major: t("book.majorRole"), minor: t("book.minorRole"), functional: t("book.functionalRole")}[role.roleTier] ?? role.roleTier}
                          </span>
                        </div>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {role.status && <MetadataBadge text={role.status} />}
                        {(role.tags ?? []).slice(0, 3).map((tag) => <MetadataBadge key={tag} icon={<Tags size={10} />} text={tag} />)}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: Summary or Editor */}
          <div className="min-h-[360px] rounded-xl border border-border/40 bg-secondary/10 p-4">
            {roleLoading ? (
              <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-muted-foreground">{t("common.loading")}</div>
            ) : roleCard ? (
              isEditing ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setIsEditing(false)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-secondary/40 px-3 py-2 text-xs font-bold text-muted-foreground transition-colors hover:bg-secondary/60"
                    >
                      <ArrowLeft size={14} />
                      {t("book.backToSummary")}
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <MetadataField label={t("book.roleName")} value={roleName} onChange={setRoleName} />
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("book.roleTier")}</span>
                      <select
                        value={roleTier}
                        onChange={(e) => setRoleTier(e.target.value as RoleTier)}
                        className="rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-sm outline-none focus:border-primary/50"
                      >
                        <option value="core">{t("book.coreRole")}</option>
                        <option value="major">{t("book.majorRole")}</option>
                        <option value="minor">{t("book.minorRole")}</option>
                        <option value="functional">{t("book.functionalRole")}</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("book.roleStatus")}</span>
                      <select
                        value={roleStatus}
                        onChange={(e) => setRoleStatus(e.target.value as typeof roleStatus)}
                        className="rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-sm outline-none focus:border-primary/50"
                      >
                        <option value="active">{t("book.roleActive")}</option>
                        <option value="hidden">{t("book.roleHidden")}</option>
                        <option value="dead">{t("book.roleDead")}</option>
                        <option value="departed">{t("book.roleDeparted")}</option>
                        <option value="">{t("book.noMetadata")}</option>
                      </select>
                    </label>
                    <MetadataField label="ID" value={roleCard.id} onChange={() => undefined} readOnly />
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <MetadataField label={t("book.roleTags")} value={roleTags} onChange={setRoleTags} placeholder={t("book.roleTagsPlaceholder")} />
                    <MetadataField label={t("book.roleAliases")} value={roleAliases} onChange={setRoleAliases} placeholder={t("book.roleAliasesPlaceholder")} />
                  </div>
                  {/* 快速标签生成器 */}
                  <details className="rounded-lg border border-border/40 bg-secondary/20 overflow-hidden">
                    <summary className="px-3 py-2 text-xs font-bold text-muted-foreground cursor-pointer hover:bg-secondary/40 transition-colors select-none">
                      {t("book.quickTagGenerator")}
                    </summary>
                    <div className="p-3 space-y-3">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <MetadataField
                          label={t("book.faction")}
                          value={categorizeTags(splitRoleList(roleTags)).faction ?? ""}
                          onChange={(v) => setTagWithPrefix("势力:", v, roleTags, setRoleTags)}
                          placeholder={t("book.factionPlaceholder")}
                        />
                        <MetadataField
                          label={t("book.occupation")}
                          value={categorizeTags(splitRoleList(roleTags)).occupation ?? ""}
                          onChange={(v) => setTagWithPrefix("职业:", v, roleTags, setRoleTags)}
                          placeholder={t("book.occupationPlaceholder")}
                        />
                      </div>
                      <div>
                        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2 block">{t("book.attributeTags")}</span>
                        <div className="flex flex-wrap gap-1.5">
                          {ATTRIBUTE_PRESETS.map((attr) => {
                            const tag = `attr:${attr}`;
                            const active = currentTagList(roleTags).includes(tag);
                            return (
                              <button
                                key={attr}
                                onClick={() => toggleTag(tag, roleTags, setRoleTags)}
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold transition-colors ${
                                  active
                                    ? "border-primary/40 bg-primary/10 text-primary"
                                    : "border-border/40 bg-secondary/30 text-muted-foreground hover:bg-secondary/50"
                                }`}
                              >
                                {attr}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </details>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <MetadataField label={t("book.roleAge")} value={roleAge} onChange={setRoleAge} placeholder={t("book.roleAge")} />
                    <MetadataField label={t("book.roleIdentity")} value={roleIdentity} onChange={setRoleIdentity} placeholder={t("book.roleIdentity")} />
                    <MetadataField label={t("book.roleGoal")} value={roleGoal} onChange={setRoleGoal} placeholder={t("book.roleGoal")} />
                    <MetadataField label={t("book.roleVoiceMarker")} value={roleVoiceMarker} onChange={setRoleVoiceMarker} placeholder={t("book.roleVoiceMarker")} />
                  </div>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("book.roleBody")}</span>
                    <textarea
                      value={roleBody}
                      onChange={(e) => setRoleBody(e.target.value)}
                      rows={12}
                      className="min-h-[260px] rounded-lg border border-border/50 bg-background/70 px-3 py-2 font-mono text-sm leading-relaxed outline-none focus:border-primary/50"
                    />
                  </label>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={handleDeleteRole}
                      disabled={savingRole}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-destructive/10 px-3 py-2 text-xs font-bold text-destructive transition-colors hover:bg-destructive hover:text-white disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                      {t("common.delete")}
                    </button>
                    <button
                      onClick={handleSaveRole}
                      disabled={savingRole}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
                    >
                      {savingRole ? <div className="h-3.5 w-3.5 rounded-full border-2 border-primary-foreground/20 border-t-primary-foreground animate-spin" /> : <Save size={14} />}
                      {savingRole ? t("book.saving") : t("book.save")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Summary header */}
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-2xl font-bold">{roleCard.frontmatter.name}</h3>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <MetadataBadge text={{core: t("book.coreRole"), major: t("book.majorRole"), minor: t("book.minorRole"), functional: t("book.functionalRole")}[roleCard.frontmatter.roleTier] ?? roleCard.frontmatter.roleTier} />
                        {roleCard.frontmatter.status && <MetadataBadge text={roleCard.frontmatter.status} />}
                        {(povCountMap.get(roleCard.id) ?? 0) > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                            {t("book.povCount").replace("{count}", String(povCountMap.get(roleCard.id) ?? 0))}
                          </span>
                        )}
                      </div>
                      {/* 分类标签徽章 */}
                      {(() => {
                        const g = categorizeTags(roleCard.frontmatter.tags ?? []);
                        if (!g.faction && !g.occupation && g.attributes.length === 0 && g.customs.length === 0) return null;
                        return (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {g.faction && <MetadataBadge icon={<Flag size={11} />} text={g.faction} />}
                            {g.occupation && <MetadataBadge icon={<Briefcase size={11} />} text={g.occupation} />}
                            {g.attributes.map((a) => <MetadataBadge key={a} icon={<Tags size={11} />} text={a} />)}
                            {g.customs.map((c) => <MetadataBadge key={c} text={c} />)}
                          </div>
                        );
                      })()}
                    </div>
                    <button
                      onClick={() => setIsEditing(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-secondary/40 px-3 py-2 text-xs font-bold text-muted-foreground transition-colors hover:bg-secondary/60"
                    >
                      <Edit3 size={14} />
                      {t("book.editRoleCard")}
                    </button>
                  </div>

                  {/* Key fields */}
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {roleCard.frontmatter.age && (
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("book.roleAge")}</span>
                        <span className="text-sm font-medium">{roleCard.frontmatter.age}</span>
                      </div>
                    )}
                    {roleCard.frontmatter.identity && (
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("book.roleIdentity")}</span>
                        <span className="text-sm font-medium">{roleCard.frontmatter.identity}</span>
                      </div>
                    )}
                    {roleCard.frontmatter.goal && (
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("book.roleGoal")}</span>
                        <span className="text-sm font-medium">{roleCard.frontmatter.goal}</span>
                      </div>
                    )}
                    {roleCard.frontmatter.voiceMarker && (
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("book.roleVoiceMarker")}</span>
                        <span className="text-sm font-medium">{roleCard.frontmatter.voiceMarker}</span>
                      </div>
                    )}
                  </div>

                  {/* Tags & Aliases */}
                  <div className="space-y-2">
                    {(roleCard.frontmatter.tags && roleCard.frontmatter.tags.length > 0) && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mr-1">{t("book.roleTags")}</span>
                        {roleCard.frontmatter.tags.map((tag) => (
                          <MetadataBadge key={tag} icon={<Tags size={10} />} text={tag} />
                        ))}
                      </div>
                    )}
                    {(roleCard.frontmatter.aliases && roleCard.frontmatter.aliases.length > 0) && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mr-1">{t("book.roleAliases")}</span>
                        {roleCard.frontmatter.aliases.map((alias) => (
                          <MetadataBadge key={alias} text={alias} />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Body preview */}
                  <div className="rounded-xl border border-border/40 bg-secondary/20 p-4">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("book.roleBody")}</span>
                    <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-foreground/80">
                      {bodyExpanded ? roleCard.body : roleCard.body.slice(0, 200) + (roleCard.body.length > 200 ? "..." : "")}
                    </p>
                    {roleCard.body.length > 200 && (
                      <button
                        onClick={() => setBodyExpanded((v) => !v)}
                        className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
                      >
                        {bodyExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        {bodyExpanded ? t("book.collapseBody") : t("book.expandBody")}
                      </button>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-between gap-2">
                    <button
                      disabled
                      className="inline-flex items-center gap-1.5 rounded-lg bg-muted/40 px-3 py-2 text-xs font-bold text-muted-foreground/60 cursor-not-allowed"
                    >
                      {t("book.voiceDriftCheck")}
                    </button>
                    <button
                      onClick={() => setIsEditing(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground transition-all hover:scale-105 active:scale-95"
                    >
                      <Edit3 size={14} />
                      {t("book.editRoleCard")}
                    </button>
                  </div>
                </div>
              )
            ) : (
              <div className="flex h-full min-h-[320px] items-center justify-center text-center text-sm text-muted-foreground">
                {t("book.selectRole")}
              </div>
            )}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title={t("common.confirmDelete")}
        message={roleCard ? `${t("book.deleteRoleConfirm")} ${roleCard.frontmatter.name}?` : ""}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={() => void doDeleteRole()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
