import { useState, useEffect, useMemo } from "react";
import { useApi, fetchJson } from "../hooks/use-api";
import type { TFunction } from "../hooks/use-i18n";
import { useServiceStore } from "../store/service";
import { Save, X, Pencil } from "lucide-react";

interface ModelOverrideEntry {
  readonly provider?: string;
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly thinkingBudget?: number;
}

interface ModelOverridesData {
  readonly overrides: Record<string, ModelOverrideEntry>;
}

const AGENT_GROUPS = [
  { label: "创作", agents: ["writer", "planner"] },
  { label: "审计", agents: ["auditor", "reviser", "detector"] },
  { label: "辅助", agents: ["architect", "style", "radar"] },
];

const AGENT_DESCRIPTIONS: Record<string, string> = {
  writer: "生成章节正文",
  planner: "规划卷/章结构",
  auditor: "连续性审计",
  reviser: "修订润色",
  detector: "AI 痕迹检测",
  architect: "世界观/设定构建",
  style: "文风分析与指纹",
  radar: "市场数据分析",
};

const AGENT_RECOMMENDATIONS: Record<string, { costTag: string; note: string }> = {
  writer: { costTag: "高质量", note: "推荐 GPT-4 / Claude" },
  planner: { costTag: "平衡", note: "GPT-4 / GPT-3.5 均可" },
  auditor: { costTag: "高质量", note: "推荐 GPT-4，需强推理" },
  reviser: { costTag: "高质量", note: "推荐 GPT-4 / Claude" },
  detector: { costTag: "高质量", note: "推荐 GPT-4，需强语义" },
  architect: { costTag: "平衡", note: "GPT-4 / GPT-3.5 均可" },
  style: { costTag: "高质量", note: "推荐 GPT-4，需细腻理解" },
  radar: { costTag: "低成本", note: "GPT-3.5 足够" },
};

interface ModelOverridesPanelProps {
  readonly t: TFunction;
}

export function ModelOverridesPanel({ t }: ModelOverridesPanelProps) {
  const { data, loading, error, refetch } = useApi<ModelOverridesData>("/project/model-overrides");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, ModelOverrideEntry>>({});
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const services = useServiceStore((s) => s.services);
  const modelsByService = useServiceStore((s) => s.modelsByService);
  const fetchServices = useServiceStore((s) => s.fetchServices);
  const fetchBankModels = useServiceStore((s) => s.fetchBankModels);
  const fetchCustomModels = useServiceStore((s) => s.fetchCustomModels);
  const fetchLiveModels = useServiceStore((s) => s.fetchLiveModels);

  useEffect(() => { void fetchServices(); }, [fetchServices]);
  useEffect(() => {
    void fetchBankModels();
    void fetchCustomModels();
  }, [fetchBankModels, fetchCustomModels]);

  const connectedServices = useMemo(
    () => services.filter((s) => s.connected),
    [services],
  );

  const overrides = data?.overrides ?? {};

  const startEdit = () => {
    setDraft({ ...overrides });
    setEditing(true);
    setActionError(null);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft({});
  };

  const updateDraft = (key: string, entry: ModelOverrideEntry) => {
    setDraft((prev) => ({ ...prev, [key]: entry }));
  };

  const removeDraft = (key: string) => {
    setDraft((prev) => {
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetchJson("/project/model-overrides", {
        method: "PUT",
        body: JSON.stringify({ overrides: draft }),
      });
      setEditing(false);
      await refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border/40 bg-secondary/10 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">{t("config.modelOverrides")}</h3>
          <p className="text-xs text-muted-foreground">{t("config.modelOverridesDesc")}</p>
        </div>
        {!editing ? (
          <button
            onClick={startEdit}
            className="inline-flex items-center gap-1 rounded-lg border border-border/50 bg-secondary/40 px-3 py-1.5 text-xs font-bold text-muted-foreground hover:bg-secondary transition-colors"
          >
            <Pencil size={12} />
            {t("common.edit")}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={cancelEdit}
              className="inline-flex items-center gap-1 rounded-lg border border-border/50 bg-secondary/40 px-3 py-1.5 text-xs font-bold text-muted-foreground hover:bg-secondary transition-colors"
            >
              <X size={12} />
              {t("common.cancel")}
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:scale-[1.02] active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              <Save size={12} />
              {t("common.save")}
            </button>
          </div>
        )}
      </div>

      {actionError && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {actionError}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {!loading && !editing && (
        <div className="space-y-4">
          {AGENT_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 px-1">
                {group.label}
              </div>
              <div className="rounded-lg border border-border/40 divide-y divide-border/20">
                {group.agents.map((key) => {
                  const entry = overrides[key];
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between px-3 py-2 gap-4"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-xs">{key}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {AGENT_DESCRIPTIONS[key]}
                        </div>
                      </div>
                      {entry ? (
                        <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
                          <span>{entry.provider ?? "—"}</span>
                          <span>{entry.model ?? "—"}</span>
                          <span className="font-mono">{entry.temperature ?? "—"}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/60 text-muted-foreground">
                            {AGENT_RECOMMENDATIONS[key]?.costTag}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] text-muted-foreground">
                            继承默认模型
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/60 text-muted-foreground" title={AGENT_RECOMMENDATIONS[key]?.note}>
                            {AGENT_RECOMMENDATIONS[key]?.costTag}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="space-y-4">
          {AGENT_GROUPS.map((group) => (
            <div
              key={group.label}
              className="rounded-lg border border-border/50 bg-secondary/20 p-3 space-y-2"
            >
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                {group.label}
              </div>
              {group.agents.map((key) => {
                const entry = draft[key];
                const isConfigured = key in draft;
                const baseClass =
                  "rounded-lg px-2 py-1.5 text-xs outline-none w-full";
                const inputClass = isConfigured
                  ? `${baseClass} border border-border/50 bg-secondary/30 text-foreground`
                  : `${baseClass} border border-dashed border-border/40 bg-transparent text-muted-foreground placeholder:text-muted-foreground/60`;

                return (
                  <div
                    key={key}
                    className="grid grid-cols-[140px_1fr_1fr_80px_32px] gap-2 items-center"
                  >
                    <div className="min-w-0">
                      <div className="font-mono text-xs truncate">{key}</div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {AGENT_DESCRIPTIONS[key]}
                      </div>
                    </div>

                    <select
                      value={entry?.provider ?? ""}
                      onChange={(e) => {
                        const provider = e.target.value || undefined;
                        if (!isConfigured) {
                          if (provider) {
                            updateDraft(key, { provider });
                            if (!modelsByService[provider]) {
                              void fetchLiveModels(provider);
                            }
                          }
                        } else {
                          if (provider) {
                            updateDraft(key, {
                              ...entry,
                              provider,
                              model: undefined,
                            });
                            if (!modelsByService[provider]) {
                              void fetchLiveModels(provider);
                            }
                          } else {
                            removeDraft(key);
                          }
                        }
                      }}
                      className={inputClass}
                    >
                      <option value="">{t("config.provider")}</option>
                      {connectedServices.map((s) => (
                        <option key={s.service} value={s.service}>
                          {s.label}
                        </option>
                      ))}
                    </select>

                    {entry?.provider &&
                    (modelsByService[entry.provider]?.length ?? 0) > 0 ? (
                      <select
                        value={entry.model ?? ""}
                        onChange={(e) =>
                          updateDraft(key, {
                            ...entry,
                            model: e.target.value || undefined,
                          })
                        }
                        className={inputClass}
                      >
                        <option value="">{t("config.model")}</option>
                        {modelsByService[entry.provider]?.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name ?? m.id}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        placeholder={t("config.model")}
                        value={entry?.model ?? ""}
                        onChange={(e) => {
                          const model = e.target.value || undefined;
                          if (!isConfigured) {
                            updateDraft(key, { model });
                          } else {
                            updateDraft(key, { ...entry, model });
                          }
                        }}
                        className={inputClass}
                      />
                    )}

                    <input
                      type="number"
                      placeholder={t("config.temperature")}
                      value={entry?.temperature ?? ""}
                      onChange={(e) => {
                        const temperature = e.target.value
                          ? Number(e.target.value)
                          : undefined;
                        if (!isConfigured) {
                          updateDraft(key, { temperature });
                        } else {
                          updateDraft(key, { ...entry, temperature });
                        }
                      }}
                      className={inputClass}
                      step={0.1}
                      min={0}
                      max={2}
                    />

                    {isConfigured && (
                      <button
                        onClick={() => removeDraft(key)}
                        className="inline-flex items-center justify-center p-1.5 rounded-lg hover:bg-destructive/10 text-destructive transition-colors"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
