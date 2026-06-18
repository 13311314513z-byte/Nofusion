import { useState } from "react";
import { fetchJson } from "../hooks/use-api";
import type { TFunction } from "../hooks/use-i18n";
import type { ChapterMeta } from "./BookDetail";

interface Props {
  chapter: ChapterMeta;
  bookId: string;
  t: TFunction;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Chapter metadata editor modal.
 * Extracted from BookDetail.tsx to reduce component size.
 */
export function ChapterMetadataEditor({ chapter, bookId, t, onClose, onSaved }: Props) {
  const [tags, setTags] = useState((chapter.tags ?? []).join(", "));
  const [pov, setPov] = useState(chapter.povCharacter ?? "");
  const [location, setLocation] = useState(chapter.location ?? "");
  const [chapterType, setChapterType] = useState(chapter.chapterType ?? "");
  const [timeOfDay, setTimeOfDay] = useState(chapter.timeOfDay ?? "");
  const [moodScore, setMoodScore] = useState(chapter.moodScore === undefined ? "" : String(chapter.moodScore));
  const [wordCountTarget, setWordCountTarget] = useState(chapter.wordCountTarget === undefined ? "" : String(chapter.wordCountTarget));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetchJson(`/books/${bookId}/chapters/${chapter.number}/meta`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tags: tags.split(/[,，\n]/).map((tag) => tag.trim()).filter(Boolean),
          povCharacter: pov,
          location,
          chapterType,
          timeOfDay,
          moodScore: moodScore.trim() === "" ? undefined : Number(moodScore),
          wordCountTarget: wordCountTarget.trim() === "" ? undefined : Number(wordCountTarget),
        }),
      });
      onSaved();
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save metadata failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-popover border border-border rounded-2xl shadow-2xl p-6 w-full max-w-lg mx-4 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">{t("book.chapterMetadata")} — {t("chapter.label").replace("{n}", String(chapter.number))}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">&times;</button>
        </div>

        <label className="block text-xs font-medium text-muted-foreground">{t("book.tags")}</label>
        <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t("book.tagsPlaceholder")} />

        <label className="block text-xs font-medium text-muted-foreground">{t("book.povCharacter")}</label>
        <input className="input" value={pov} onChange={(e) => setPov(e.target.value)} />

        <label className="block text-xs font-medium text-muted-foreground">{t("book.location")}</label>
        <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground">{t("book.chapterType")}</label>
            <input className="input" value={chapterType} onChange={(e) => setChapterType(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground">{t("book.timeOfDay")}</label>
            <input className="input" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground">{t("book.moodScore")}</label>
            <input className="input" type="number" min={-10} max={10} value={moodScore} onChange={(e) => setMoodScore(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground">{t("book.wordCountTarget")}</label>
            <input className="input" type="number" min={1} value={wordCountTarget} onChange={(e) => setWordCountTarget(e.target.value)} />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn btn-ghost">{t("common.cancel")}</button>
          <button onClick={handleSave} disabled={saving} className="btn btn-primary">
            {saving ? t("book.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
