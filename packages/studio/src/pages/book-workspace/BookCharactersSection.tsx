import { useState, useEffect } from "react";
import type { Theme } from "../../hooks/use-theme";
import type { TFunction } from "../../hooks/use-i18n";
import type { SSEMessage } from "../../hooks/use-sse";
import { fetchJson, useApi } from "../../hooks/use-api";
import { UserRound, Plus, Save, Trash2, Tags } from "lucide-react";

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
    readonly id: string;
    readonly name: string;
    readonly roleTier: RoleTier;
    readonly aliases?: ReadonlyArray<string>;
    readonly status?: "active" | "hidden" | "dead" | "departed";
    readonly tags?: ReadonlyArray<string>;
  };
  readonly body: string;
}

interface RolesData {
  readonly roles: ReadonlyArray<RoleCardListItem>;
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

export function BookCharactersSection({ bookId, t }: BookCharactersSectionProps) {
  const { data: rolesData, loading: rolesLoading, error: rolesError, refetch: refetchRoles } = useApi<RolesData>(`/books/${bookId}/roles`);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [roleCard, setRoleCard] = useState<RoleCard | null>(null);
  const [roleLoading, setRoleLoading] = useState(false);
  const [roleName, setRoleName] = useState("");
  const [roleTier, setRoleTier] = useState<RoleTier>("major");
  const [roleStatus, setRoleStatus] = useState<"active" | "hidden" | "dead" | "departed" | "">("active");
  const [roleTags, setRoleTags] = useState("");
  const [roleAliases, setRoleAliases] = useState("");
  const [roleBody, setRoleBody] = useState("");
  const [savingRole, setSavingRole] = useState(false);
  const [creatingRole, setCreatingRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleId, setNewRoleId] = useState("");
  const [newRoleTier, setNewRoleTier] = useState<RoleTier>("major");

  const roles = rolesData?.roles ?? [];
  const majorRoleCount = roles.filter((role) => role.roleTier === "major").length;
  const minorRoleCount = roles.filter((role) => role.roleTier === "minor").length;

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
      return;
    }

    setRoleLoading(true);
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
      })
      .catch((e) => {
        if (!cancelled) alert(e instanceof Error ? e.message : "Load role failed");
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
      setNewRoleTier("major");
      await refetchRoles();
      setSelectedRoleId(result.card.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Create role failed");
    } finally {
      setCreatingRole(false);
    }
  };

  const handleSaveRole = async () => {
    if (!roleCard) return;
    setSavingRole(true);
    try {
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
          },
          body: roleBody,
        }),
      });
      setRoleCard(result.card);
      await refetchRoles();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save role failed");
    } finally {
      setSavingRole(false);
    }
  };

  const handleDeleteRole = async () => {
    if (!roleCard) return;
    const ok = window.confirm(`${t("book.deleteRoleConfirm")} ${roleCard.frontmatter.name}`);
    if (!ok) return;
    setSavingRole(true);
    try {
      await fetchJson(`/books/${bookId}/roles/${encodeURIComponent(roleCard.id)}`, { method: "DELETE" });
      setSelectedRoleId("");
      setRoleCard(null);
      await refetchRoles();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete role failed");
    } finally {
      setSavingRole(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="paper-sheet rounded-2xl border border-border/40 shadow-sm p-5">
        {/* Header */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
          <div className="flex items-center gap-2">
            <UserRound size={16} className="text-primary/70" />
            <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{t("book.roleCards")}</h2>
            <span className="rounded-full border border-border/50 bg-secondary/40 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
              {roles.length} · {t("book.majorRole")} {majorRoleCount} / {t("book.minorRole")} {minorRoleCount}
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
              <option value="major">{t("book.majorRole")}</option>
              <option value="minor">{t("book.minorRole")}</option>
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
                {roles.map((role) => (
                  <button
                    key={role.id}
                    onClick={() => setSelectedRoleId(role.id)}
                    className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${
                      selectedRoleId === role.id ? "bg-primary/10 text-primary" : "hover:bg-background/70"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{role.name}</span>
                      <span className="shrink-0 rounded-full border border-border/40 px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                        {role.roleTier === "major" ? t("book.majorRole") : t("book.minorRole")}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {role.status && <MetadataBadge text={role.status} />}
                      {(role.tags ?? []).slice(0, 3).map((tag) => <MetadataBadge key={tag} icon={<Tags size={10} />} text={tag} />)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right: Editor */}
          <div className="min-h-[360px] rounded-xl border border-border/40 bg-secondary/10 p-4">
            {roleLoading ? (
              <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-muted-foreground">{t("common.loading")}</div>
            ) : roleCard ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <MetadataField label={t("book.roleName")} value={roleName} onChange={setRoleName} />
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("book.roleTier")}</span>
                    <select
                      value={roleTier}
                      onChange={(e) => setRoleTier(e.target.value as RoleTier)}
                      className="rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-sm outline-none focus:border-primary/50"
                    >
                      <option value="major">{t("book.majorRole")}</option>
                      <option value="minor">{t("book.minorRole")}</option>
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
              <div className="flex h-full min-h-[320px] items-center justify-center text-center text-sm text-muted-foreground">
                {t("book.selectRole")}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
