import { AlertCircle,MapPinned,Plus,RefreshCw,Save,Trash2 } from "lucide-react";
import { useState } from "react";
import { fetchJson,useApi } from "../../hooks/use-api";
import type { TFunction } from "../../hooks/use-i18n";
import type { SSEMessage } from "../../hooks/use-sse";
import type { Theme } from "../../hooks/use-theme";

interface SceneTemplateItem {
  id: string;
  name: string;
  type: string;
  location: string;
  atmosphere: string;
  props: string[];
  routines: string[];
  defaultCharacters: string[];
  linkedScenes: string[];
  linkedEvents: string[];
  notes: string;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface SceneTemplatesData {
  templates: SceneTemplateItem[];
  updatedAt: string;
}

interface BookSceneTemplatesSectionProps {
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

const EMPTY_TEMPLATE: SceneTemplateItem = {
  id: "",
  name: "",
  type: "",
  location: "",
  atmosphere: "",
  props: [],
  routines: [],
  defaultCharacters: [],
  linkedScenes: [],
  linkedEvents: [],
  notes: "",
  usageCount: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export function BookSceneTemplatesSection({ bookId, nav: _nav, theme: _theme, t: _t }: BookSceneTemplatesSectionProps) {
  const [editing, setEditing] = useState<SceneTemplateItem | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, loading, error, refetch } = useApi<SceneTemplatesData>(
    `/books/${encodeURIComponent(bookId)}/scene-templates`,
  );

  const templates = data?.templates ?? [];

  const handleNew = () => {
    setEditing({ ...EMPTY_TEMPLATE, id: `tpl-${Date.now()}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    setIsNew(true);
    setActionError(null);
  };

  const handleEdit = (tpl: SceneTemplateItem) => {
    setEditing({ ...tpl });
    setIsNew(false);
    setActionError(null);
  };

  const handleDelete = async (tplId: string) => {
    const updated = templates.filter(t => t.id !== tplId);
    setSaving(true);
    setActionError(null);
    try {
      await fetchJson(`/books/${encodeURIComponent(bookId)}/scene-templates`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templates: updated, updatedAt: new Date().toISOString() }),
      });
      refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!editing) return;
    const updated = isNew
      ? [...templates, { ...editing, updatedAt: new Date().toISOString() }]
      : templates.map(t => t.id === editing.id ? { ...editing, updatedAt: new Date().toISOString() } : t);
    setSaving(true);
    setActionError(null);
    try {
      await fetchJson(`/books/${encodeURIComponent(bookId)}/scene-templates`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templates: updated, updatedAt: new Date().toISOString() }),
      });
      setEditing(null);
      setIsNew(false);
      refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field: keyof SceneTemplateItem, value: unknown) => {
    if (!editing) return;
    setEditing({ ...editing, [field]: value });
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <MapPinned size={20} className="text-emerald-500" />
            场景模板
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            可复用场景配置（地点、道具、惯例）
          </p>
        </div>
        <button
          onClick={handleNew}
          disabled={editing !== null}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          <Plus size={12} />
          新建模板
        </button>
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          <RefreshCw size={16} className="animate-spin mr-2" /> 加载中...
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle size={14} /> {String(error)}
        </div>
      )}
      {actionError && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle size={14} /> {actionError}
        </div>
      )}

      {/* Template list */}
      {!loading && !error && templates.length === 0 && (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          <MapPinned size={16} className="mr-2" /> 暂无场景模板
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {templates.map((tpl) => (
          <div
            key={tpl.id}
            className="border border-border/30 rounded-xl p-4 bg-card/40 hover:border-emerald-500/30 transition-colors"
          >
            <div className="flex items-start justify-between mb-2">
              <div>
                <h3 className="text-sm font-semibold">{tpl.name || tpl.id}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {tpl.type} · {tpl.location} · {tpl.atmosphere}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => handleEdit(tpl)}
                  className="p-1 rounded hover:bg-secondary/50 text-muted-foreground"
                  title="编辑"
                >
                  <Save size={12} />
                </button>
                <button
                  onClick={() => handleDelete(tpl.id)}
                  className="p-1 rounded hover:bg-destructive/10 text-destructive"
                  title="删除"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>

            {(tpl.props.length > 0 || tpl.routines.length > 0 || tpl.defaultCharacters.length > 0) && (
              <div className="space-y-1.5 mt-3">
                {tpl.props.length > 0 && (
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span className="font-medium">道具:</span>
                    {tpl.props.map(p => <code key={p} className="px-1 rounded bg-secondary/10 font-mono">{p}</code>)}
                  </div>
                )}
                {tpl.routines.length > 0 && (
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span className="font-medium">惯例:</span>
                    {tpl.routines.map(r => <code key={r} className="px-1 rounded bg-secondary/10 font-mono">{r}</code>)}
                  </div>
                )}
                {tpl.defaultCharacters.length > 0 && (
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span className="font-medium">默认角色:</span>
                    {tpl.defaultCharacters.map(c => <code key={c} className="px-1 rounded bg-secondary/10 font-mono">{c}</code>)}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-3 mt-3 text-[10px] text-muted-foreground">
              <span>使用 {tpl.usageCount} 次</span>
              {tpl.notes && <span className="truncate max-w-[200px]">{tpl.notes}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Edit panel */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setEditing(null); setIsNew(false); }}>
          <div
            className="bg-background rounded-2xl border border-border/40 shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-border/40">
              <h3 className="text-sm font-bold">{isNew ? "新建场景模板" : "编辑场景模板"}</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {(["name", "type", "location", "atmosphere"] as const).map(f => (
                <div key={f}>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">
                    {f === "name" ? "名称" : f === "type" ? "类型标签" : f === "location" ? "地点" : "氛围"}
                  </label>
                  <input
                    value={editing[f]}
                    onChange={(e) => updateField(f, e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-border/40 rounded-lg bg-background"
                    placeholder={f === "name" ? "药房取药" : f === "type" ? "药房" : f === "location" ? "药房" : "紧张"}
                  />
                </div>
              ))}
              {(["props", "routines", "defaultCharacters"] as const).map(f => (
                <div key={f}>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">
                    {f === "props" ? "道具（逗号分隔）" : f === "routines" ? "惯例（逗号分隔）" : "默认角色（逗号分隔）"}
                  </label>
                  <input
                    value={editing[f].join(", ")}
                    onChange={(e) => updateField(f, e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                    className="w-full px-3 py-2 text-sm border border-border/40 rounded-lg bg-background"
                    placeholder="道具1, 道具2"
                  />
                </div>
              ))}
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">备注</label>
                <textarea
                  value={editing.notes}
                  onChange={(e) => updateField("notes", e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 text-sm border border-border/40 rounded-lg bg-background resize-none"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border/40 flex justify-end gap-2">
              <button
                onClick={() => { setEditing(null); setIsNew(false); }}
                className="px-3 py-1.5 text-xs rounded-lg border border-border/40 hover:bg-secondary/30"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <Save size={12} />
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
