import { useState, useEffect } from "react";
import type { Theme } from "../../hooks/use-theme";
import type { TFunction } from "../../hooks/use-i18n";
import type { SSEMessage } from "../../hooks/use-sse";
import { fetchJson, useApi } from "../../hooks/use-api";
import { Target, Save, Trash2, Plus, X, TargetIcon, ChevronDown, ChevronRight, FileText } from "lucide-react";
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

interface AuthorScenePlan {
  readonly goal: string;
  readonly location: string;
  readonly povCharacter: string;
  readonly targetEmotion?: string;
}

interface AuthorCharacterState {
  readonly characterId: string;
  readonly emotion: string;
  readonly relationshipChanges?: string;
}

interface AuthorChapterIntent {
  readonly chapterNumber: number;
  readonly coreNarrative: string;
  readonly readerTakeaway: string;
  readonly keyMoment: string;
  readonly scenes: ReadonlyArray<AuthorScenePlan>;
  readonly characterStates: ReadonlyArray<AuthorCharacterState>;
  readonly requiredBeats: ReadonlyArray<string>;
  readonly forbiddenMoves: ReadonlyArray<string>;
  readonly pendingHookIds: ReadonlyArray<string>;
  readonly narrativePosition: "opening" | "rising" | "climax" | "falling" | "resolution";
  readonly plotLine?: string;
  readonly interviewCompletedAt?: string;
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

function buildEmptyIntent(chapterNumber: number): AuthorChapterIntent {
  return {
    chapterNumber,
    coreNarrative: "",
    readerTakeaway: "",
    keyMoment: "",
    scenes: [],
    characterStates: [],
    requiredBeats: [],
    forbiddenMoves: [],
    pendingHookIds: [],
    narrativePosition: "rising",
  };
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

  // Author interview state
  const [intents, setIntents] = useState<Record<number, AuthorChapterIntent>>({});
  const [intentDraft, setIntentDraft] = useState<AuthorChapterIntent | null>(null);
  const [interviewExpanded, setInterviewExpanded] = useState(false);
  const [intentSaving, setIntentSaving] = useState(false);

  // Suggestion state
  const [suggestions, setSuggestions] = useState<ReadonlyArray<{
    id: string; question: string; context: string; level: number; prefill?: string;
  }>>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

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

  // Load chapter intents
  useEffect(() => {
    fetchJson<{ intents: ReadonlyArray<AuthorChapterIntent> }>(`/books/${bookId}/chapter-intents`)
      .then((data) => {
        const map: Record<number, AuthorChapterIntent> = {};
        for (const i of data.intents ?? []) {
          map[i.chapterNumber] = i;
        }
        setIntents(map);
      })
      .catch(() => { /* intents are optional, silent fail */ });
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

  const handleSaveIntent = async (chapterNumber: number) => {
    const payload = intentDraft ?? buildEmptyIntent(chapterNumber);
    setIntentSaving(true);
    try {
      const existing = intents[chapterNumber];
      const merged: AuthorChapterIntent = {
        ...buildEmptyIntent(chapterNumber),
        ...existing,
        ...payload,
      };
      const result = await fetchJson<{ ok: boolean; intent: AuthorChapterIntent }>(
        `/books/${bookId}/chapter-intents/${chapterNumber}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(merged),
        },
      );
      if (result.ok && result.intent) {
        setIntents((prev) => ({ ...prev, [result.intent.chapterNumber]: result.intent }));
        setIntentDraft(null);
        setInterviewExpanded(false);
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to save interview");
    } finally {
      setIntentSaving(false);
    }
  };

  const loadSuggestions = async (chapterNumber: number) => {
    setSuggestionsLoading(true);
    try {
      const data = await fetchJson<{ suggestions: ReadonlyArray<{ id: string; question: string; context: string; level: number; prefill?: string }> }>(
        `/books/${bookId}/chapter-intents/${chapterNumber}/suggestions`,
      );
      setSuggestions(data.suggestions ?? []);
    } catch {
      // silent fail
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const isFieldAnswered = (chapterNumber: number, s: { id: string }): boolean => {
    const intent = intents[chapterNumber];
    if (!intent) return false;
    switch (s.id) {
      case "core_narrative": return !!intent.coreNarrative;
      case "reader_takeaway": return !!intent.readerTakeaway;
      case "key_moment": return !!intent.keyMoment;
      case "scene_start": return (intent.scenes?.length ?? 0) > 0;
      case "character_emotions": return (intent.characterStates?.length ?? 0) > 0;
      case "required_beats": return (intent.requiredBeats?.length ?? 0) > 0;
      case "forbidden_moves": return (intent.forbiddenMoves?.length ?? 0) > 0;
      case "hooks_to_advance": return (intent.pendingHookIds?.length ?? 0) > 0;
      default: return false;
    }
  };

  const applySuggestion = (chapterNumber: number, s: { id: string; question: string }) => {
    // Open the interview section if not already open, and prefocus the relevant field
    setInterviewExpanded(true);
    // Map suggestion IDs to intent fields
    const intent = intents[chapterNumber] ?? buildEmptyIntent(chapterNumber);
    setIntentDraft({ ...intent });
    // Scroll to the relevant field
    setTimeout(() => {
      const textareas = document.querySelectorAll("[data-suggestion-field]");
      for (const ta of textareas) {
        if (ta.getAttribute("data-suggestion-field") === s.id) {
          (ta as HTMLTextAreaElement).focus();
          break;
        }
      }
    }, 100);
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

                    {/* ── Author Interview Section ── */}
                    <div className="border-t border-border/30 pt-3 mt-2">
                      <button
                        onClick={() => setInterviewExpanded((p) => !p)}
                        className="flex items-center gap-2 w-full text-left text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors py-1"
                      >
                        {interviewExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <FileText size={14} />
                        写作前深度访谈
                        {(intents[ch.number]?.coreNarrative) && <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">已填写</span>}
                      </button>

                      {interviewExpanded && (
                        <div className="mt-3 space-y-3 pl-1">
                          <p className="text-[10px] text-muted-foreground italic">
                            在生成之前，先想清楚这些问题会让输出更接近你的预期。
                          </p>

                          {/* Suggestions button */}
                          <div className="flex items-center justify-between">
                            <button
                              onClick={() => loadSuggestions(ch.number)}
                              disabled={suggestionsLoading}
                              className="inline-flex items-center gap-1 rounded-lg border border-border/40 bg-secondary/20 px-2.5 py-1.5 text-[10px] font-bold text-muted-foreground hover:bg-secondary transition-colors disabled:opacity-50"
                            >
                              {suggestionsLoading ? (
                                <div className="w-3 h-3 border-2 border-muted-foreground/20 border-t-muted-foreground rounded-full animate-spin" />
                              ) : (
                                <span>💡</span>
                              )}
                              {suggestionsLoading ? "读取中..." : "查看提问建议"}
                            </button>
                            {suggestions.length > 0 && (
                              <span className="text-[10px] text-muted-foreground">
                                {suggestions.filter((s) => !isFieldAnswered(ch.number, s)).length} 个待回答
                              </span>
                            )}
                          </div>

                          {/* Suggestions list */}
                          {suggestions.length > 0 && (
                            <div className="space-y-1.5">
                              {suggestions.map((s) => {
                                const answered = isFieldAnswered(ch.number, s);
                                return (
                                  <div
                                    key={s.id}
                                    className={`rounded-lg border p-2.5 text-xs ${
                                      answered
                                        ? "border-green-200/30 bg-green-500/5"
                                        : "border-primary/10 bg-primary/5"
                                    }`}
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="flex-1 min-w-0">
                                        <p className="font-medium text-foreground">{s.question}</p>
                                        <p className="text-[10px] text-muted-foreground mt-0.5">{s.context}</p>
                                      </div>
                                      {!answered && (
                                        <button
                                          onClick={() => applySuggestion(ch.number, s)}
                                          className="shrink-0 rounded bg-primary/20 px-2 py-1 text-[10px] font-bold text-primary hover:bg-primary/30 transition-colors"
                                        >
                                          回答
                                        </button>
                                      )}
                                      {answered && (
                                        <span className="shrink-0 text-[10px] text-green-600 font-medium">✓</span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Level 1: Core */}
                          <div className="rounded-lg border border-primary/10 bg-primary/5 p-3 space-y-2">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-primary">核心问题（建议必填）</p>
                            <label className="flex flex-col gap-1">
                              <span className="text-[10px] font-medium text-muted-foreground">用一句话说清：这一章在讲什么？</span>
                              <textarea
                                value={intentDraft?.coreNarrative ?? intents[ch.number]?.coreNarrative ?? ""}
                                onChange={(e) => setIntentDraft((p) => ({ ...(p ?? buildEmptyIntent(ch.number)), coreNarrative: e.target.value }))}
                                rows={2}
                                className="w-full rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-sm outline-none focus:border-primary/50"
                                placeholder="例：陈墨发现朋友在骗他，必须在信任和证据之间做选择"
                                data-suggestion-field="core_narrative"
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-[10px] font-medium text-muted-foreground">你希望读者读完后的核心感受是什么？</span>
                              <textarea
                                value={intentDraft?.readerTakeaway ?? intents[ch.number]?.readerTakeaway ?? ""}
                                onChange={(e) => setIntentDraft((p) => ({ ...(p ?? buildEmptyIntent(ch.number)), readerTakeaway: e.target.value }))}
                                rows={2}
                                className="w-full rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-sm outline-none focus:border-primary/50"
                                placeholder="例：从'震惊'过渡到'愤怒'，结尾留下'他会怎么做？'的悬念"
                                data-suggestion-field="reader_takeaway"
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-[10px] font-medium text-muted-foreground">这一章最重要的一个时刻/画面是什么？</span>
                              <textarea
                                value={intentDraft?.keyMoment ?? intents[ch.number]?.keyMoment ?? ""}
                                onChange={(e) => setIntentDraft((p) => ({ ...(p ?? buildEmptyIntent(ch.number)), keyMoment: e.target.value }))}
                                rows={2}
                                className="w-full rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-sm outline-none focus:border-primary/50"
                                placeholder="例：陈墨看到朋友手机里的消息记录时的表情变化"
                                data-suggestion-field="key_moment"
                              />
                            </label>
                          </div>

                          {/* Level 4: Narrative position */}
                          <div className="grid grid-cols-2 gap-2">
                            <label className="flex flex-col gap-1">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">叙事位置</span>
                              <select
                                value={intentDraft?.narrativePosition ?? intents[ch.number]?.narrativePosition ?? "rising"}
                                onChange={(e) => setIntentDraft((p) => ({ ...(p ?? buildEmptyIntent(ch.number)), narrativePosition: e.target.value as AuthorChapterIntent["narrativePosition"] }))}
                                className="w-full rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-sm outline-none focus:border-primary/50"
                              >
                                <option value="opening">开篇</option>
                                <option value="rising">发展</option>
                                <option value="climax">高潮</option>
                                <option value="falling">回落</option>
                                <option value="resolution">收尾</option>
                              </select>
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">故事线</span>
                              <input
                                type="text"
                                value={intentDraft?.plotLine ?? intents[ch.number]?.plotLine ?? ""}
                                onChange={(e) => setIntentDraft((p) => ({ ...(p ?? buildEmptyIntent(ch.number)), plotLine: e.target.value }))}
                                className="w-full rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-sm outline-none focus:border-primary/50"
                                placeholder="主线/支线A/支线B"
                              />
                            </label>
                          </div>

                          {/* Save interview button */}
                          <div className="flex justify-end">
                            <button
                              onClick={() => handleSaveIntent(ch.number)}
                              disabled={intentSaving}
                              className="inline-flex items-center gap-1 rounded-lg bg-primary/80 px-3 py-1.5 text-xs font-bold text-primary-foreground transition-all hover:bg-primary active:scale-95 disabled:opacity-50"
                            >
                              {intentSaving ? <div className="w-3 h-3 border-2 border-primary-foreground/20 border-t-primary-foreground rounded-full animate-spin" /> : <Save size={12} />}
                              保存访谈
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    {/* ── End Author Interview Section ── */}

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
