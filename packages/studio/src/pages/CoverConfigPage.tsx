import { useState, useEffect } from "react";
import { fetchJson, putApi } from "../hooks/use-api";
import { Image, Save, AlertCircle, CheckCircle, Loader2, Eye, EyeOff, Settings } from "lucide-react";

interface ProviderInfo {
  readonly service: string;
  readonly label: string;
  readonly baseUrl: string;
  readonly defaultModel: string;
  readonly models: ReadonlyArray<string>;
  readonly connected: boolean;
}

interface CoverConfigData {
  readonly service: string | null;
  readonly model: string | null;
  readonly providers: ReadonlyArray<ProviderInfo>;
}

interface Props {
  readonly t: (key: string) => string;
}

export function CoverConfigPage({ t }: Props) {
  const [config, setConfig] = useState<CoverConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [selectedService, setSelectedService] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [hasStoredKeys, setHasStoredKeys] = useState<Record<string, boolean>>({});
  const [keyPreviews, setKeyPreviews] = useState<Record<string, string>>({});
  const [keyDirty, setKeyDirty] = useState<Record<string, boolean>>({});
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<CoverConfigData>("/cover/config")
      .then((data: CoverConfigData) => {
        setConfig(data);
        if (data.service) setSelectedService(data.service);
        if (data.model) setSelectedModel(data.model);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const currentProvider = config?.providers.find((p) => p.service === selectedService);
  const models = currentProvider?.models ?? [];

  const handleSaveConfig = async () => {
    setSaving(true);
    setSaveStatus(null);
    try {
      await putApi("/cover/config", { service: selectedService || null, model: selectedModel || null });
      setSaveStatus("saved");
    } catch (e) {
      setSaveStatus(`error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setSaving(false);
  };

  const handleLoadKey = async (service: string) => {
    try {
      const data = await fetchJson<{ hasApiKey: boolean; keyPreview: string }>(`/cover/secret/${service}`);
      setHasStoredKeys((prev) => ({ ...prev, [service]: data.hasApiKey }));
      setKeyPreviews((prev) => ({ ...prev, [service]: data.keyPreview }));
      setApiKeys((prev) => ({ ...prev, [service]: "" })); // Don't keep plaintext
      setKeyDirty((prev) => ({ ...prev, [service]: false }));
    } catch { /* ignore */ }
  };

  const handleSaveKey = async (service: string) => {
    setSavingKey(service);
    try {
      const payload: Record<string, string> = {};
      const keyValue = (apiKeys[service] ?? "").trim();
      if (keyValue) {
        payload.apiKey = keyValue;
      } else if (keyDirty[service]) {
        payload.clear = "true";
      } else {
        // No change — skip
        setSavingKey(null);
        return;
      }
      await putApi(`/cover/secret/${service}`, payload);
      setHasStoredKeys((prev) => ({ ...prev, [service]: !!keyValue }));
      setKeyPreviews((prev) => ({ ...prev, [service]: keyValue ? keyValue.slice(0, 4) + "..." : "" }));
      setKeyDirty((prev) => ({ ...prev, [service]: false }));
      setSaveStatus(`key-saved:${service}`);
    } catch (e) {
      setSaveStatus(`key-error:${e instanceof Error ? e.message : String(e)}`);
    }
    setSavingKey(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-6 space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Image size={20} />
        <div>
          <h1 className="text-lg font-bold">封面生成配置</h1>
          <p className="text-xs text-muted-foreground">配置 AI 封面生成的服务商、模型和密钥</p>
        </div>
      </div>

      {/* Service Selection */}
      <div className="border rounded-lg p-5 space-y-4">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Settings size={14} />
          服务商与模型
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">服务商</label>
            <select
              value={selectedService}
              onChange={(e) => {
                setSelectedService(e.target.value);
                setSelectedModel("");
                void handleLoadKey(e.target.value);
              }}
              className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm"
            >
              <option value="">-- 选择服务商 --</option>
              {config?.providers.map((p) => (
                <option key={p.service} value={p.service}>
                  {p.label} {p.connected ? "✅" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">模型</label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={models.length === 0}
              className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm disabled:opacity-40"
            >
              <option value="">-- 选择模型 --</option>
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
        {currentProvider && (
          <div className="text-xs text-muted-foreground">
            Base URL: <code className="text-xs bg-secondary/30 px-1 py-0.5 rounded">{currentProvider.baseUrl}</code>
          </div>
        )}
        <button
          onClick={handleSaveConfig}
          disabled={saving || !selectedService}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground disabled:opacity-30 hover:opacity-90"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          保存配置
        </button>
        {saveStatus === "saved" && (
          <span className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle size={12} />已保存</span>
        )}
        {saveStatus?.startsWith("error:") && (
          <span className="text-xs text-destructive flex items-center gap-1"><AlertCircle size={12} />{saveStatus.slice(6)}</span>
        )}
      </div>

      {/* API Key per service */}
      {selectedService && (
        <div className="border rounded-lg p-5 space-y-4">
          <h3 className="font-semibold text-sm">API 密钥 — {currentProvider?.label ?? selectedService}</h3>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={visibleKeys[selectedService] ? "text" : "password"}
                value={apiKeys[selectedService] ?? ""}
                onChange={(e) => {
                  setApiKeys((prev) => ({ ...prev, [selectedService]: e.target.value }));
                  setKeyDirty((prev) => ({ ...prev, [selectedService]: true }));
                }}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                name={`cover-api-token-${selectedService}`}
                data-form-type="other"
                data-lpignore="true"
                data-1p-ignore="true"
                data-bwignore="true"
                placeholder={hasStoredKeys[selectedService] ? `已有密钥 ${keyPreviews[selectedService] ?? ""}，输入新值替换` : "粘贴 API Key..."}
                className="w-full px-3 py-2 pr-10 rounded-lg bg-secondary/30 border border-border text-sm font-mono focus:outline-none focus:border-primary"
              />
              <button
                onClick={() => setVisibleKeys((prev) => ({ ...prev, [selectedService]: !prev[selectedService] }))}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {visibleKeys[selectedService] ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <div className="flex flex-col gap-1">
              <button
                onClick={() => void handleSaveKey(selectedService)}
                disabled={savingKey === selectedService}
                className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground disabled:opacity-30 hover:opacity-90 flex items-center gap-1"
              >
                {savingKey === selectedService ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                保存
              </button>
              {hasStoredKeys[selectedService] && !keyDirty[selectedService] && (
                <span className="text-xs text-muted-foreground">已有密钥，留空不修改</span>
              )}
              {hasStoredKeys[selectedService] && keyDirty[selectedService] && !apiKeys[selectedService]?.trim() && (
                <button
                  onClick={() => void handleSaveKey(selectedService)}
                  className="text-xs text-destructive hover:underline text-left"
                >
                  清除已存储的密钥
                </button>
              )}
            </div>
          </div>
          {saveStatus === `key-saved:${selectedService}` && (
            <span className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle size={12} />密钥已保存</span>
          )}
        </div>
      )}
    </div>
  );
}
