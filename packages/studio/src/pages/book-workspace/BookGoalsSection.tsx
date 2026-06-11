import { useState, useEffect } from "react";
import type { Theme } from "../../hooks/use-theme";
import type { TFunction } from "../../hooks/use-i18n";
import type { SSEMessage } from "../../hooks/use-sse";
import { fetchJson, useApi } from "../../hooks/use-api";
import { Target, Save, Trash2, Plus, X, TargetIcon } from "lucide-react";
import { ConfirmDialog } from "../../components/ConfirmDialog";

interface ChapterGoalCard {
  readonly chapterNumber: number;
  readonly title?: string;
  readonly povCharacter?: string;
  readonly location?: string;
  readonly timeOfDay?: string;
  readonly mainConflict?: string;
  readonly requiredBeats?: ReadonlyArray<string>;
  readonly forbiddenMoves?: ReadonlyArray<string>;
  readonly targetMood?: string;
  readonly hookIdsToAdvance?: ReadonlyArray<string>;
  readonly targetChars?: number;
}

interface ChapterGoalsIndex {
  readonly goals: ReadonlyArray<ChapterGoalCard>;
  readonly updatedAt: string;
}

interface BookData {
  readonly chapters: ReadonlyArray<{
    readonly number: number;
    readonly title: string;
    readonly status: string;
  }>;
}

interface BookGoalsSectionProps {
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

function buildEmptyGoal(chapterNumber: number): ChapterGoalCard {
  return { chapterNumber };
}

function GoalField({
  label,
  value,
  onChange,
  placeholder,
  rows = 1,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  const inputClass = "w-full rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-sm outline-none focus:border-primary/50";
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
      {rows > 1 ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows} className={inputClass} />
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={inputClass} />
      )}
    </label>
  );
}

export function BookGoalsSection({ bookId, nav, t }: BookGoalsSectionProps) {
  const { data: bookData } = useApi<BookData>(`/books/${bookId}`);
  const [goals, setGoals] = useState<Record<number, ChapterGoalCard>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingChapter, setEditingChapter] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmChapter, setConfirmChapter] = useState<number | null>(null);
  const [saving, setSaving] = useState<ReadonlyArray<number>>([]);
  const [draft, setDraft] = useState<ChapterGoalCard>(buildEmptyGoal(0));

  const chapters = bookData?.chapters ?? [];

  useEffect(() => {
    setLoading(true);
    fetchJson<ChapterGoalsIndex>(`/books/${bookId}/chapter-goals`)
      .then((data) => {
        const map: Record<number, ChapterGoalCard> = {};
        for (const g of data.goals) {
          map[g.chapterNumber] = g;
        }
        setGoals(map);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load goals");
      })
      .finally(() => setLoading(false));
  }, [bookId]);

  const startEdit = (chapterNumber: number) => {
    const existing = goals[chapterNumber] ?? buildEmptyGoal(chapterNumber);
    setDraft({ ...existing });
    setEditingChapter(chapterNumber);
  };

  const cancelEdit = () => {
    setEditingChapter(null);
    setDraft(buildEmptyGoal(0));
  };

  const handleSave = async () => {
    if (!editingChapter) return;
    setSaving((prev) => [...prev, editingChapter]);
    try {
      const result = await fetchJson<{ ok: boolean; goal: ChapterGoalCard }>(
        `/books/${bookId}/chapter-goals/${editingChapter}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: draft.title,
            povCharacter: draft.povCharacter,
            location: draft.location,
            timeOfDay: draft.timeOfDay,
            mainConflict: draft.mainConflict,
            requiredBeats: draft.requiredBeats?.filter(Boolean),
            forbiddenMoves: draft.forbiddenMoves?.filter(Boolean),
            targetMood: draft.targetMood,
            hookIdsToAdvance: draft.hookIdsToAdvance?.filter(Boolean),
            targetChars: draft.targetChars,
          }),
        },
      );
      if (result.ok && result.goal) {
        setGoals((prev) => ({ ...prev, [result.goal.chapterNumber]: result.goal }));
      }
      setActionError(null);
      setEditingChapter(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving((prev) => prev.filter((n) => n !== editingChapter));
    }
  };

  const handleDelete = async (chapterNumber: number) => {
    setConfirmChapter(chapterNumber);
    setConfirmOpen(true);
  };

  const doDelete = async () => {
    setConfirmOpen(false);
    const chapterNumber = confirmChapter;
    if (chapterNumber == null) return;
    setSaving((prev) => [...prev, chapterNumber]);
    try {
      await fetchJson(`/books/${bookId}/chapter-goals/${chapterNumber}`, { method: "DELETE" });
      setGoals((prev) => {
        const next = { ...prev };
        delete next[chapterNumber];
        return next;
      });
      setActionError(null);
      if (editingChapter === chapterNumber) setEditingChapter(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving((prev) => prev.filter((n) => n !== chapterNumber));
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
        <span className="text-sm text-muted-foreground">{t("common.loading")}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-destructive p-8 bg-destructive/5 rounded-xl border border-destructive/20">{error}</div>
      </div>
    );
  }

  const hasGoals = Object.keys(goals).length > 0;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="paper-sheet rounded-2xl border border-border/40 shadow-sm p-5 space-y-6">
        {actionError && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-center justify-between">
            <span>{actionError}</span>
            <button onClick={() => setActionError(null)} className="text-xs font-bold hover:underline">{t("common.dismiss")}</button>
          </div>
        )}
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Target size={16} className="text-primary/70" />
            <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{t("workspace.section.goals")}</h2>
            <span className="rounded-full border border-border/50 bg-secondary/40 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
              {Object.keys(goals).length} / {chapters.length}
            </span>
          </div>
        </div>

        {chapters.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center border border-border/40 rounded-2xl bg-card/30">
            <TargetIcon size={24} className="text-muted-foreground/40 mb-3" />
            <p className="text-sm italic font-serif text-muted-foreground">{t("book.noChapters")}</p>
          </div>
        )}

        {/* Goal cards */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {chapters.map((ch) => {
            const goal = goals[ch.number];
            const isEditing = editingChapter === ch.number;

            return (
              <div key={ch.number} className="rounded-xl border border-border/40 bg-secondary/10 overflow-hidden">
                <div className="px-4 py-3 border-b border-border/30 bg-muted/20 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[11px] text-muted-foreground/70">{ch.number.toString().padStart(2, "0")}</span>
                    <span className="text-sm font-semibold truncate">{ch.title || t("chapter.label").replace("{n}", String(ch.number))}</span>
                    {goal && <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">{t("goal.hasGoal")}</span>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!isEditing && (
                      <button
                        onClick={() => startEdit(ch.number)}
                        className="inline-flex items-center gap-1 rounded-lg bg-secondary/40 px-2 py-1 text-xs font-bold text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                      >
                        <Plus size={12} />
                        {goal ? t("common.edit") : t("goal.add")}
                      </button>
                    )}
                    {goal && !isEditing && (
                      <button
                        onClick={() => handleDelete(ch.number)}
                        disabled={saving.includes(ch.number)}
                        className="p-1.5 rounded-lg text-destructive/70 hover:bg-destructive/10 transition-colors disabled:opacity-50"
                        title={t("common.delete")}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>

                {isEditing ? (
                  <div className="p-4 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <GoalField label={t("goal.title")} value={draft.title ?? ""} onChange={(v) => setDraft((p) => ({ ...p, title: v }))} />
                      <GoalField label={t("goal.povCharacter")} value={draft.povCharacter ?? ""} onChange={(v) => setDraft((p) => ({ ...p, povCharacter: v }))} />
                      <GoalField label={t("goal.location")} value={draft.location ?? ""} onChange={(v) => setDraft((p) => ({ ...p, location: v }))} />
                      <GoalField label={t("goal.timeOfDay")} value={draft.timeOfDay ?? ""} onChange={(v) => setDraft((p) => ({ ...p, timeOfDay: v }))} />
                      <GoalField label={t("goal.targetMood")} value={draft.targetMood ?? ""} onChange={(v) => setDraft((p) => ({ ...p, targetMood: v }))} />
                      <GoalField label={t("goal.targetChars")} value={draft.targetChars ? String(draft.targetChars) : ""} onChange={(v) => setDraft((p) => ({ ...p, targetChars: Number.parseInt(v, 10) || undefined }))} />
                    </div>
                    <GoalField label={t("goal.mainConflict")} value={draft.mainConflict ?? ""} onChange={(v) => setDraft((p) => ({ ...p, mainConflict: v }))} rows={2} />
                    <GoalField label={t("goal.requiredBeats")} value={(draft.requiredBeats ?? []).join(", ")} onChange={(v) => setDraft((p) => ({ ...p, requiredBeats: v.split(/[,，]/).map((s) => s.trim()).filter(Boolean) }))} placeholder={t("goal.beatsPlaceholder")} />
                    <GoalField label={t("goal.forbiddenMoves")} value={(draft.forbiddenMoves ?? []).join(", ")} onChange={(v) => setDraft((p) => ({ ...p, forbiddenMoves: v.split(/[,，]/).map((s) => s.trim()).filter(Boolean) }))} placeholder={t("goal.forbiddenPlaceholder")} />
                    <GoalField label={t("goal.hookIdsToAdvance")} value={(draft.hookIdsToAdvance ?? []).join(", ")} onChange={(v) => setDraft((p) => ({ ...p, hookIdsToAdvance: v.split(/[,，]/).map((s) => s.trim()).filter(Boolean) }))} placeholder={t("goal.hooksPlaceholder")} />
                    <div className="flex justify-end gap-2 pt-1">
                      <button onClick={cancelEdit} className="inline-flex items-center gap-1 rounded-lg border border-border/50 px-3 py-2 text-xs font-bold text-muted-foreground hover:bg-secondary transition-colors">
                        <X size={14} />
                        {t("common.cancel")}
                      </button>
                      <button
                        onClick={handleSave}
                        disabled={saving.includes(ch.number)}
                        className="inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
                      >
                        {saving.includes(ch.number) ? <div className="w-3.5 h-3.5 border-2 border-primary-foreground/20 border-t-primary-foreground rounded-full animate-spin" /> : <Save size={14} />}
                        {t("book.save")}
                      </button>
                    </div>
                  </div>
                ) : goal ? (
                  <div className="p-4 space-y-2">
                    {goal.title && <p className="text-sm font-medium">{goal.title}</p>}
                    {goal.mainConflict && <p className="text-sm text-muted-foreground">{goal.mainConflict}</p>}
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {goal.povCharacter && <span>{t("book.povCharacter")}: {goal.povCharacter}</span>}
                      {goal.location && <span>{t("book.location")}: {goal.location}</span>}
                      {goal.timeOfDay && <span>{t("book.timeOfDay")}: {goal.timeOfDay}</span>}
                      {goal.targetMood && <span>{t("goal.targetMood")}: {goal.targetMood}</span>}
                      {goal.targetChars && <span>{t("goal.targetChars")}: {goal.targetChars}</span>}
                    </div>
                    {(goal.requiredBeats?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {(goal.requiredBeats ?? []).map((b) => (
                          <span key={b} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">{b}</span>
                        ))}
                      </div>
                    )}
                    {(goal.forbiddenMoves?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {(goal.forbiddenMoves ?? []).map((m) => (
                          <span key={m} className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-medium">{m}</span>
                        ))}
                      </div>
                    )}
                    {(goal.hookIdsToAdvance?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {(goal.hookIdsToAdvance ?? []).map((h) => (
                          <span key={h} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">{h}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-4 text-sm text-muted-foreground italic">{t("goal.noGoal")}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title={t("common.confirmDelete")}
        message={confirmChapter != null ? `${t("common.delete")} #${confirmChapter} ${t("workspace.section.goals")}?` : ""}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={() => void doDelete()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
