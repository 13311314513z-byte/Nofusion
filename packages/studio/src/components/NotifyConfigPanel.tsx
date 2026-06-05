import { useState, useEffect } from "react";
import { useApi, fetchJson } from "../hooks/use-api";
import type { TFunction } from "../hooks/use-i18n";
import { Save, Plus, X, Pencil, CheckCircle, AlertCircle, Send, ChevronDown, ChevronRight } from "lucide-react";

interface NotifyChannel {
  readonly enabled: boolean;
  readonly type: string;
  readonly webhook?: string;
  readonly token?: string;
  readonly chatId?: string;
  readonly events?: string[];
}

interface NotifyData {
  readonly channels: ReadonlyArray<NotifyChannel>;
}

const CHANNEL_TYPES = ["telegram", "feishu", "wechat", "webhook"];
const EVENT_OPTIONS = [
  "chapter-complete",
  "audit-passed",
  "audit-failed",
  "revision-complete",
  "pipeline-complete",
  "pipeline-error",
  "diagnostic-alert",
];

const EVENT_DESCRIPTIONS: Record<string, string> = {
  "chapter-complete": "章节写作完成",
  "audit-passed": "审计通过",
  "audit-failed": "审计失败",
  "revision-complete": "修订完成",
  "pipeline-complete": "Pipeline 完成",
  "pipeline-error": "Pipeline 错误",
  "diagnostic-alert": "诊断告警",
};

interface NotifyConfigPanelProps {
  readonly t: TFunction;
}

export function NotifyConfigPanel({ t }: NotifyConfigPanelProps) {
  const { data, loading, error, refetch } = useApi<NotifyData>("/project/notify");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<NotifyChannel[]>([]);
  const [saving, setSaving] = useState(false);
  const [testResults, setTestResults] = useState<Record<number, { ok: boolean; msg?: string; ts?: number }>>({});
  const [testingIdx, setTestingIdx] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [webhookExpanded, setWebhookExpanded] = useState<Record<number, boolean>>({});

  // Load persisted test results from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem("inkos.notify.testResults");
      if (raw) setTestResults(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  const persistTestResult = (idx: number, result: { ok: boolean; msg?: string }) => {
    setTestResults((prev) => {
      const next = { ...prev, [idx]: { ...result, ts: Date.now() } };
      try { localStorage.setItem("inkos.notify.testResults", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const channels = data?.channels ?? [];

  const startEdit = () => {
    setDraft(channels.map((c) => ({ ...c })));
    setEditing(true);
    setWebhookExpanded({});
    setActionError(null);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft([]);
    setWebhookExpanded({});
  };

  const updateDraft = (index: number, channel: NotifyChannel) => {
    setDraft((prev) => {
      const copy = [...prev];
      copy[index] = channel;
      return copy;
    });
  };

  const removeDraft = (index: number) => {
    setDraft((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetchJson("/project/notify", {
        method: "PUT",
        body: JSON.stringify({ channels: draft }),
      });
      setEditing(false);
      await refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const toggleWebhookGuide = (idx: number) => {
    setWebhookExpanded((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <div className="rounded-xl border border-border/40 bg-secondary/10 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">{t("config.notifyChannels")}</h3>
          <p className="text-xs text-muted-foreground">{t("config.notifyChannelsDesc")}</p>
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
        <div className="overflow-x-auto">
          {channels.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">{t("config.noChannels")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/30 border-b border-border/50">
                  <th className="text-left px-3 py-2 font-bold text-[11px] uppercase tracking-widest text-muted-foreground">{t("config.channelType")}</th>
                  <th className="text-left px-3 py-2 font-bold text-[11px] uppercase tracking-widest text-muted-foreground">{t("config.webhook")}</th>
                  <th className="text-left px-3 py-2 font-bold text-[11px] uppercase tracking-widest text-muted-foreground">订阅事件</th>
                  <th className="text-center px-3 py-2 font-bold text-[11px] uppercase tracking-widest text-muted-foreground">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/25">
                {channels.map((ch, idx) => {
                  const isConfigured = ch.type === "webhook" ? !!ch.webhook : !!(ch.token || ch.chatId);
                  const lastTest = testResults[idx];
                  const testFailed = lastTest && !lastTest.ok;
                  return (
                    <tr key={idx} className="hover:bg-background/50">
                      <td className="px-3 py-2 text-xs capitalize">{ch.type}</td>
                      <td className="px-3 py-2 text-xs truncate max-w-[200px]" title={ch.webhook ?? ch.token}>{ch.webhook ?? ch.token ?? "—"}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {(ch.events?.length ?? 0) === 0 ? (
                            <span className="text-[10px] text-muted-foreground italic">未选择</span>
                          ) : (
                            ch.events!.slice(0, 4).map((ev) => (
                              <span key={ev} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/60 text-muted-foreground">
                                {EVENT_DESCRIPTIONS[ev] ?? ev}
                              </span>
                            ))
                          )}
                          {(ch.events?.length ?? 0) > 4 && (
                            <span className="text-[10px] text-muted-foreground">+{(ch.events!.length - 4)}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <div className="inline-flex items-center gap-1.5">
                          {!isConfigured && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-destructive">
                              <span className="w-1.5 h-1.5 rounded-full bg-destructive" />
                              未配置
                            </span>
                          )}
                          {testFailed && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-red-600" title={lastTest.msg}>
                              <span className="w-1.5 h-1.5 rounded-full bg-red-600" />
                              测试失败
                            </span>
                          )}
                          <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${ch.enabled ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                            {ch.enabled ? t("common.on") : t("common.off")}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {editing && (
        <div className="space-y-3">
          {draft.map((ch, idx) => (
            <div key={idx} className="rounded-lg border border-border/30 bg-background/50 p-3 space-y-2">
              <div className="grid grid-cols-6 gap-2 items-center">
                <select
                  value={ch.type}
                  onChange={(e) => updateDraft(idx, { ...ch, type: e.target.value })}
                  className="rounded-lg border border-border/50 bg-secondary/30 px-2 py-1.5 text-xs outline-none"
                >
                  {CHANNEL_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Webhook / Token"
                  value={ch.webhook ?? ch.token ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (ch.type === "webhook") {
                      updateDraft(idx, { ...ch, webhook: val || undefined, token: undefined });
                    } else {
                      updateDraft(idx, { ...ch, token: val || undefined, webhook: undefined });
                    }
                  }}
                  className="rounded-lg border border-border/50 bg-secondary/30 px-2 py-1.5 text-xs outline-none"
                />
                <input
                  type="text"
                  placeholder="Chat ID"
                  value={ch.chatId ?? ""}
                  onChange={(e) => updateDraft(idx, { ...ch, chatId: e.target.value || undefined })}
                  className="rounded-lg border border-border/50 bg-secondary/30 px-2 py-1.5 text-xs outline-none"
                />
                <div className="col-span-3 flex items-center gap-2 flex-wrap justify-end">
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ch.enabled}
                      onChange={(e) => updateDraft(idx, { ...ch, enabled: e.target.checked })}
                      className="rounded border-border/50"
                    />
                    {t("config.enabled")}
                  </label>
                  <button
                    onClick={async () => {
                      setTestingIdx(idx);
                      try {
                        const res = await fetchJson("/project/notify/test", {
                          method: "POST",
                          body: JSON.stringify({ channel: ch }),
                        });
                        persistTestResult(idx, { ok: true, msg: (res as { message?: string } | undefined)?.message });
                      } catch (e) {
                        persistTestResult(idx, { ok: false, msg: e instanceof Error ? e.message : "Test failed" });
                      } finally {
                        setTestingIdx(null);
                      }
                    }}
                    disabled={testingIdx === idx}
                    className="inline-flex items-center gap-1 rounded-lg border border-border/50 bg-secondary/40 px-2 py-1 text-[10px] font-bold text-muted-foreground hover:bg-secondary transition-colors disabled:opacity-50"
                    title={t("config.testChannel")}
                  >
                    {testingIdx === idx ? (
                      <div className="w-3 h-3 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                    ) : (
                      <Send size={10} />
                    )}
                    {t("common.test")}
                  </button>
                  {testResults[idx] && (
                    <span className={`inline-flex items-center gap-0.5 text-[10px] ${testResults[idx].ok ? "text-emerald-600" : "text-destructive"}`} title={testResults[idx].msg}>
                      {testResults[idx].ok ? <CheckCircle size={10} /> : <AlertCircle size={10} />}
                      {testResults[idx].ok ? t("common.success") : "失败"}
                      {testResults[idx].ts && (
                        <span className="text-muted-foreground/60">
                          ({new Date(testResults[idx].ts!).toLocaleDateString()})
                        </span>
                      )}
                    </span>
                  )}
                  <button
                    onClick={() => removeDraft(idx)}
                    className="inline-flex items-center justify-center p-1.5 rounded-lg hover:bg-destructive/10 text-destructive transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
              <div>
                <p className="text-[10px] font-medium text-muted-foreground mb-1">订阅事件</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {EVENT_OPTIONS.map((ev) => (
                    <label key={ev} className="flex items-start gap-1.5 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ch.events?.includes(ev) ?? false}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          const current = ch.events ?? [];
                          const next = checked ? [...current, ev] : current.filter((x) => x !== ev);
                          updateDraft(idx, { ...ch, events: next });
                        }}
                        className="mt-0.5 rounded border-border/50"
                      />
                      <div className="leading-tight">
                        <div className="text-xs">{ev}</div>
                        <div className="text-[10px] text-muted-foreground">{EVENT_DESCRIPTIONS[ev]}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              {ch.type === "webhook" && (
                <div className="rounded border border-border/30 bg-secondary/20">
                  <button
                    onClick={() => toggleWebhookGuide(idx)}
                    className="w-full flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {webhookExpanded[idx] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    Webhook 接入说明
                  </button>
                  {webhookExpanded[idx] && (
                    <div className="px-2 pb-2 space-y-1.5 text-xs text-muted-foreground">
                      <pre className="rounded bg-secondary/40 p-2 text-[10px] overflow-x-auto">
{`{
  "event": "chapter-complete",
  "bookId": "your-book-id",
  "timestamp": "2024-01-01T00:00:00Z",
  "data": { ... }
}`}
                      </pre>
                      <p>• URL 填入你的 n8n / Make / Zapier Webhook URL</p>
                      <p>• Secret 用于 HMAC-SHA256 签名，可选</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <button
            onClick={() => setDraft((prev) => [...prev, { enabled: true, type: "webhook", events: [] }])}
            className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border/50 px-3 py-1.5 text-xs font-bold text-muted-foreground hover:border-primary/30 hover:text-primary transition-colors"
          >
            <Plus size={12} />
            {t("config.addChannel")}
          </button>
        </div>
      )}
    </div>
  );
}
