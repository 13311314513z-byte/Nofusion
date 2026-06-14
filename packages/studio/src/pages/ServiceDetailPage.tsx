import { useState, useEffect } from "react";
import { fetchJson, useApi } from "../hooks/use-api";
import { useServiceStore } from "../store/service";
import { Loader2, ArrowLeft, Trash2, ShieldCheck, FileText, Stethoscope } from "lucide-react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ServiceQuickLinks } from "../components/ServiceQuickLinks";
import { ApiKeyInput } from "../components/ApiKeyInput";
import { WritingParamPresets } from "../components/WritingParamPresets.js";
import {
  deleteServiceConfig,
  matchServiceConfigEntryForDetail,
  probeServiceForDetail,
  rehydrateServiceConnectionStatus,
  saveServiceConfig,
  type ServiceDetailConnectionStatus as ConnectionStatus,
  type ServiceDetailDetectedConfig as DetectedConfig,
  type ServiceDetailModelInfo as ModelInfo,
  type ServiceDetailVerifiedProbe as VerifiedProbe,
} from "./service-detail-state";

interface Nav {
  toServices: () => void;
  toAudit?: () => void;
  toStyle?: () => void;
  toDoctor?: () => void;
  toDashboard?: () => void;
}

function DetailSkeleton() {
  return (
    <div className="max-w-xl mx-auto space-y-6 animate-pulse">
      <div className="h-4 w-16 bg-muted rounded" />
      <div className="h-7 w-40 bg-muted rounded" />
      <div className="space-y-2"><div className="h-3 w-16 bg-muted/60 rounded" /><div className="h-10 w-full bg-muted/40 rounded-lg" /></div>
      <div className="h-9 w-24 bg-muted/40 rounded-lg" />
    </div>
  );
}

export function ServiceDetailPage({ serviceId, nav }: { serviceId: string; nav: Nav }) {
  // -- Service store --
  const services = useServiceStore((s) => s.services);
  const loading = useServiceStore((s) => s.servicesLoading);
  const fetchServices = useServiceStore((s) => s.fetchServices);
  const refreshServices = useServiceStore((s) => s.refreshServices);
  const setStoreModels = useServiceStore((s) => s.setLiveModels);
  const clearStoreModels = useServiceStore((s) => s.clearModels);

  useEffect(() => { void fetchServices(); }, [fetchServices]);

  const svc = services.find((s) => s.service === serviceId);
  const isCustom = serviceId === "custom" || serviceId.startsWith("custom:");
  const persistedCustomName = serviceId.startsWith("custom:") ? decodeURIComponent(serviceId.slice("custom:".length)) : "";

  // -- Local form state --
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [customName, setCustomName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [temperature, setTemperature] = useState("0.7");
  const [apiFormat, setApiFormat] = useState<"chat" | "responses">("chat");
  const [stream, setStream] = useState(true);
  const [detectedModel, setDetectedModel] = useState<string>("");
  const [detectedConfig, setDetectedConfig] = useState<DetectedConfig | null>(null);
  const [verifiedProbe, setVerifiedProbe] = useState<VerifiedProbe | null>(null);
  // ✅ 写作参数（top_p/核采样 / presence_penalty/主题重复抑制 / frequency_penalty/词汇重复抑制 / seed/随机种子 / repetition_penalty/重复惩罚）
  const [topP, setTopP] = useState("1.0");
  const [presencePenalty, setPresencePenalty] = useState("0");
  const [frequencyPenalty, setFrequencyPenalty] = useState("0");
  const [seed, setSeed] = useState("");
  const [repetitionPenalty, setRepetitionPenalty] = useState("1.0");

  // -- Unified connection status --
  const [status, setStatus] = useState<ConnectionStatus>({ state: "idle" });
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchJson<{ services: Array<Record<string, unknown>> }>("/services/config")
      .then((data) => {
        if (cancelled) return;
        const matched = matchServiceConfigEntryForDetail(data.services ?? [], serviceId);
        if (!matched) return;
        if (isCustom) {
          setCustomName(String(matched.name ?? persistedCustomName));
          setBaseUrl(String(matched.baseUrl ?? ""));
        }
        if (typeof matched.temperature === "number") setTemperature(String(matched.temperature));
        if (matched.apiFormat === "chat" || matched.apiFormat === "responses") setApiFormat(matched.apiFormat);
        if (typeof matched.stream === "boolean") setStream(matched.stream);
        // ✅ 恢复写作参数
        const matchedExtra = matched.extra && typeof matched.extra === "object" && !Array.isArray(matched.extra)
          ? (matched.extra as Record<string, unknown>)
          : {};
        if (typeof matchedExtra.top_p === "number") setTopP(String(matchedExtra.top_p));
        if (typeof matchedExtra.presence_penalty === "number") setPresencePenalty(String(matchedExtra.presence_penalty));
        if (typeof matchedExtra.frequency_penalty === "number") setFrequencyPenalty(String(matchedExtra.frequency_penalty));
        if (typeof matchedExtra.seed === "number") setSeed(String(matchedExtra.seed));
        if (typeof matchedExtra.repetition_penalty === "number") setRepetitionPenalty(String(matchedExtra.repetition_penalty));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isCustom, persistedCustomName, serviceId]);

  const resolvedCustomName = persistedCustomName || customName.trim() || "Custom";
  const effectiveServiceId = isCustom ? `custom:${resolvedCustomName}` : serviceId;
  const label = isCustom ? (customName || persistedCustomName || "自定义服务") : (svc?.label ?? serviceId);
  const storeModels = useServiceStore((s) => s.modelsByService[effectiveServiceId]);
  const { data: overridesData } = useApi<{ overrides: Record<string, { provider?: string; model?: string }> }>("/project/model-overrides");
  const { data: auditConfig } = useApi<{ service: string | null; model: string | null }>("/audit/config");

  useEffect(() => {
    let cancelled = false;
    void rehydrateServiceConnectionStatus({
      effectiveServiceId,
      shouldVerify: Boolean(svc?.connected),
      isCustom,
      baseUrl,
      apiFormat,
      stream,
    })
      .then((result) => {
        if (cancelled) return;
        setApiKey(result.apiKey);
        setHasStoredKey(result.hasStoredKey);
        setDetectedModel(result.detectedModel);
        setDetectedConfig(result.detectedConfig);
        setStatus(result.status);
        if (result.status.state === "connected") {
          setStoreModels(effectiveServiceId, result.status.models);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setStatus({ state: "idle" });
      });
    return () => { cancelled = true; };
  }, [
    apiFormat,
    baseUrl,
    effectiveServiceId,
    isCustom,
    setStoreModels,
    stream,
    svc?.connected,
  ]);

  if (loading) return <DetailSkeleton />;

  // -- Derived state --
  const isConnected = Boolean(svc?.connected);
  const models = status.state === "connected" ? status.models : (storeModels ?? []);
  const selectedModelValue = detectedModel || models[0]?.id || "";
  const isBusy = status.state === "testing" || status.state === "saving";

  // -- Handlers --
  const handleTest = async () => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey && !isCustom && !hasStoredKey) {
      setStatus({ state: "error", message: "请先输入 API Key" });
      return;
    }
    if (isCustom && !baseUrl.trim()) {
      setStatus({ state: "error", message: "请先填写 Base URL" });
      return;
    }
    setApiKey(trimmedKey);
    setStatus({ state: "testing" });
    try {
      const result = await probeServiceForDetail(effectiveServiceId, {
        apiKey: trimmedKey,
        apiFormat,
        stream,
        ...(isCustom ? { baseUrl: baseUrl.trim() } : {}),
      });
      if (result.ok) {
        const models = result.models ?? [];
        const selectedModel = result.selectedModel && models.some((model) => model.id === result.selectedModel)
          ? result.selectedModel
          : models[0]?.id ?? "";
        const verifiedApiFormat = result.detected?.apiFormat ?? apiFormat;
        const verifiedStream = typeof result.detected?.stream === "boolean" ? result.detected.stream : stream;
        const verifiedBaseUrl = isCustom ? (result.detected?.baseUrl ?? baseUrl.trim()) : "";
        if (result.detected?.apiFormat) setApiFormat(result.detected.apiFormat);
        if (typeof result.detected?.stream === "boolean") setStream(result.detected.stream);
        if (isCustom && result.detected?.baseUrl) setBaseUrl(result.detected.baseUrl);
        setDetectedModel(selectedModel);
        setDetectedConfig(result.detected ?? null);
        setVerifiedProbe({
          apiKey: trimmedKey,
          baseUrl: verifiedBaseUrl,
          apiFormat: verifiedApiFormat,
          stream: verifiedStream,
          models,
          selectedModel,
          detected: result.detected,
        });
        setStatus({ state: "connected", models });
        setStoreModels(effectiveServiceId, models); // Write to global store
      } else {
        setVerifiedProbe(null);
        setStatus({ state: "error", message: result.error ?? "连接失败" });
        clearStoreModels(effectiveServiceId);
      }
    } catch (e) {
      setVerifiedProbe(null);
      setStatus({ state: "error", message: e instanceof Error ? e.message : "连接失败" });
    }
  };

  const handleDelete = () => {
    setConfirmOpen(true);
  };

  const doDelete = async () => {
    setConfirmOpen(false);
    setStatus({ state: "saving" });
    try {
      await deleteServiceConfig(effectiveServiceId);
      clearStoreModels(effectiveServiceId);
      await refreshServices();
      nav.toServices();
    } catch (e) {
      setStatus({ state: "error", message: e instanceof Error ? e.message : "删除失败" });
    }
  };

  const handleSave = async () => {
    const trimmedKey = apiKey.trim();
    setApiKey(trimmedKey);
    if (isCustom && !baseUrl.trim()) {
      setStatus({ state: "error", message: "请先填写 Base URL" });
      return;
    }
    setStatus({ state: "saving" });
    try {
      // ✅ 打包写作参数
      const extra: Record<string, number> = {};
      const topPNum = parseFloat(topP);
      if (!Number.isNaN(topPNum) && topPNum >= 0 && topPNum <= 1) extra.top_p = topPNum;
      const presNum = parseFloat(presencePenalty);
      if (!Number.isNaN(presNum) && presNum >= -2 && presNum <= 2) extra.presence_penalty = presNum;
      const freqNum = parseFloat(frequencyPenalty);
      if (!Number.isNaN(freqNum) && freqNum >= -2 && freqNum <= 2) extra.frequency_penalty = freqNum;
      const seedNum = parseInt(seed, 10);
      if (!Number.isNaN(seedNum)) extra.seed = seedNum;
      const repNum = parseFloat(repetitionPenalty);
      if (!Number.isNaN(repNum) && repNum >= 1 && repNum <= 2) extra.repetition_penalty = repNum;

      const result = await saveServiceConfig({
        effectiveServiceId,
        serviceId,
        isCustom,
        resolvedCustomName,
        apiKey: trimmedKey,
        hasStoredKey,
        baseUrl,
        apiFormat,
        stream,
        temperature,
        detectedModel,
        verifiedProbe,
        extra: Object.keys(extra).length > 0 ? extra : undefined,
      });
      if (result.status.state === "connected") {
        if (result.detectedConfig?.apiFormat) setApiFormat(result.detectedConfig.apiFormat);
        if (typeof result.detectedConfig?.stream === "boolean") setStream(result.detectedConfig.stream);
        if (isCustom && result.detectedConfig?.baseUrl) setBaseUrl(result.detectedConfig.baseUrl);
        setDetectedModel(result.detectedModel);
        setDetectedConfig(result.detectedConfig);
        setStoreModels(effectiveServiceId, result.status.models);
        setStatus(result.status);
      } else {
        setStatus(result.status);
        if (result.status.state === "error") return;
      }
      await refreshServices();
      nav.toServices();
    } catch (e) {
      setStatus({ state: "error", message: e instanceof Error ? e.message : "保存失败" });
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {/* Back */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={nav.toServices}
          className="inline-flex items-center gap-2 rounded-lg border border-border/50 bg-card/60 px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary/50 transition-colors"
        >
          <ArrowLeft size={14} />
          返回服务商管理
        </button>
        {nav.toAudit && (
          <button onClick={nav.toAudit} className="inline-flex items-center gap-2 rounded-lg border border-border/50 bg-card/60 px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary/50 transition-colors">
            <ShieldCheck size={14} />
            审计配置
          </button>
        )}
        {nav.toStyle && (
          <button onClick={nav.toStyle} className="inline-flex items-center gap-2 rounded-lg border border-border/50 bg-card/60 px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary/50 transition-colors">
            <FileText size={14} />
            文风分析
          </button>
        )}
        {nav.toDoctor && (
          <button onClick={nav.toDoctor} className="inline-flex items-center gap-2 rounded-lg border border-border/50 bg-card/60 px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary/50 transition-colors">
            <Stethoscope size={14} />
            诊断
          </button>
        )}
      </div>

      {/* Title + status */}
      <div className="flex items-center gap-3">
        <h1 className="font-serif text-2xl">{label}</h1>
        {isConnected && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-medium">
            已连接
          </span>
        )}
      </div>
      <ServiceQuickLinks serviceId={serviceId} />

      <div className="space-y-5">
        {/* Custom fields */}
        {isCustom && (
        <div className="grid grid-cols-2 gap-4">
            <Field label="服务名称">
              <input type="text" value={customName} onChange={(e) => setCustomName(e.target.value)}
                placeholder="例如：本地 Ollama" className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm" />
            </Field>
            <Field label="Base URL">
              <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1" className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono" />
            </Field>
          </div>
        )}

        {/* API Key */}
        <Field label="API Key">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <ApiKeyInput
                value={apiKey}
                visible={showKey}
                onChange={setApiKey}
                onToggleVisible={() => setShowKey((value) => !value)}
                className="rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
              />
            </div>
            {hasStoredKey && !apiKey.trim() && (
              <span className="shrink-0 text-xs text-emerald-500 font-medium px-2 py-1 rounded bg-emerald-500/10">
                Key 已配置
              </span>
            )}
          </div>
          {hasStoredKey && !apiKey.trim() && (
            <p className="text-xs text-muted-foreground mt-1">
              已存储 API Key，留空并使用「测试连接」将使用已有 Key
            </p>
          )}
        </Field>

        {/* Actions + feedback */}
        <div className="flex items-center gap-2">
          <button onClick={handleTest} disabled={isBusy}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg border border-border/60 hover:bg-secondary/50 transition-colors disabled:opacity-50">
            {status.state === "testing" && <Loader2 size={12} className="animate-spin" />}
            测试连接
          </button>
          <button onClick={handleSave} disabled={isBusy}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
            {status.state === "saving" && <Loader2 size={12} className="animate-spin" />}
            保存
          </button>
          {(isConnected || isCustom) && (
            <button onClick={handleDelete} disabled={isBusy}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50">
              <Trash2 size={12} />
              删除配置
            </button>
          )}
          {/* Status feedback */}
          {status.state === "connected" && (
            <span className="text-xs text-emerald-500">
              连接成功，{models.length} 个模型
              {detectedModel ? `，已自动匹配 ${detectedModel}${detectedConfig ? ` / ${detectedConfig.apiFormat === "responses" ? "Responses" : "Chat"} / ${detectedConfig.stream ? "流式" : "非流式"}` : ""}` : ""}
            </span>
          )}
          {status.state === "error" && (
            <span className="text-xs text-destructive">{status.message}</span>
          )}
          {status.state === "saved" && (
            <span className="text-xs text-emerald-500">已保存</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="协议类型">
            <select
              value={apiFormat}
              onChange={(e) => setApiFormat(e.target.value as "chat" | "responses")}
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
            >
              <option value="chat">Chat / Completions</option>
              <option value="responses">Responses</option>
            </select>
          </Field>

          <Field label="流式响应">
            <label className="flex h-10 items-center gap-2 rounded-lg border border-border/60 bg-background px-3 text-sm">
              <input
                type="checkbox"
                checked={stream}
                onChange={(e) => setStream(e.target.checked)}
              />
              <span>{stream ? "开启" : "关闭"}</span>
            </label>
          </Field>
        </div>

        {/* Models */}
        {isConnected && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground/70 font-medium uppercase tracking-wider">
              可用模型（{models.length}）
            </p>
            {models.length > 0 ? (
              <select
                value={selectedModelValue}
                onChange={(event) => setDetectedModel(event.target.value)}
                disabled={isBusy}
                className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono disabled:opacity-50"
              >
                {models.map((model) => {
                  const tags: string[] = [];
                  if ((model as any).contextWindow >= 32000) tags.push("32k");
                  if ((model as any).contextWindow >= 128000) tags.push("128k");
                  if ((model as any).maxOutput >= 4096) tags.push("高输出");
                  const tagStr = tags.length > 0 ? ` [${tags.join("/")}]` : "";
                  return (
                    <option key={model.id} value={model.id}>
                      {model.name ?? model.id}{tagStr}
                    </option>
                  );
                })}
              </select>
            ) : (
              <p className="text-xs text-muted-foreground/60">点击“测试连接”查看可用模型</p>
            )}
          </div>
        )}

        {/* Agent & audit usage */}
        {isConnected && overridesData?.overrides && (
          <div className="pt-2 border-t border-border/20 space-y-1">
            <p className="text-xs text-muted-foreground/70 font-medium uppercase tracking-wider">
              使用此服务的模块
            </p>
            {(Object.entries(overridesData.overrides) as Array<[string, { provider?: string; model?: string }]>)
              .filter(([, entry]) => entry.provider === effectiveServiceId)
              .map(([agent, entry]) => (
                <div key={agent} className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground capitalize">{agent}</span>
                  <span className="font-mono text-foreground">{entry.model ?? "默认"}</span>
                </div>
              ))
            }
            {auditConfig?.service === effectiveServiceId && (
              <div className="flex items-center gap-2 text-xs text-amber-600">
                <span className="text-muted-foreground">auditor</span>
                <span className="font-mono">{auditConfig.model ?? "默认"} (审计)</span>
              </div>
            )}
            {!(Object.entries(overridesData.overrides) as Array<[string, { provider?: string; model?: string }]>).some(([, e]) => e.provider === effectiveServiceId) && auditConfig?.service !== effectiveServiceId && (
              <p className="text-xs text-muted-foreground/60">当前没有模块使用此服务</p>
            )}
          </div>
        )}

        {/* Advanced params */}
        <details className="group pt-2 border-t border-border/20">
          <summary className="text-xs text-muted-foreground/60 cursor-pointer select-none hover:text-muted-foreground transition-colors py-2">
            高级参数
          </summary>
          <div className="space-y-4 pt-2">
            {/* 预设选择器：一键应用文风参数组合 */}
            <WritingParamPresets onApply={(p) => {
              setTemperature(p.temperature);
              setTopP(p.topP);
              setPresencePenalty(p.presencePenalty);
              setFrequencyPenalty(p.frequencyPenalty);
              setSeed(p.seed);
              setRepetitionPenalty(p.repetitionPenalty);
            }} />

            {/* 温度（temperature） */}
            <Field label="temperature">
              <div className="flex items-center gap-3">
                <input type="range" min="0" max="2" step="0.05" value={temperature}
                  onChange={(e) => setTemperature(e.target.value)} className="flex-1 accent-primary h-1" />
                <input type="number" value={temperature} onChange={(e) => setTemperature(e.target.value)}
                  min="0" max="2" step="0.05" className="w-16 rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-right font-mono" />
              </div>
            </Field>

            {/* ✅ top_p（核采样）：截断尾部低概率 token，0.85–0.95 适合叙事 */}
            <Field label="top_p（核采样）">
              <div className="flex items-center gap-3">
                <input type="range" min="0" max="1" step="0.05" value={topP}
                  onChange={(e) => setTopP(e.target.value)} className="flex-1 accent-primary h-1" />
                <input type="number" value={topP} onChange={(e) => setTopP(e.target.value)}
                  min="0" max="1" step="0.05" className="w-16 rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-right font-mono" />
              </div>
              <p className="text-[10px] text-muted-foreground/60 mt-1">限制低概率 token，0.85–0.95 适合叙事类写作</p>
            </Field>

            {/* ✅ presence_penalty（主题重复抑制）：抑制已出现的主题，0–0.3 适合长文本 */}
            <Field label="presence_penalty（主题重复抑制）">
              <div className="flex items-center gap-3">
                <input type="range" min="-2" max="2" step="0.1" value={presencePenalty}
                  onChange={(e) => setPresencePenalty(e.target.value)} className="flex-1 accent-primary h-1" />
                <input type="number" value={presencePenalty} onChange={(e) => setPresencePenalty(e.target.value)}
                  min="-2" max="2" step="0.1" className="w-16 rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-right font-mono" />
              </div>
              <p className="text-[10px] text-muted-foreground/60 mt-1">抑制已出现的主题/词汇，避免内容来回绕，0–0.3 适合长章节</p>
            </Field>

            {/* ✅ frequency_penalty（词汇重复抑制）：按频次惩罚高频词，0–0.3 增加词汇多样性 */}
            <Field label="frequency_penalty（词汇重复抑制）">
              <div className="flex items-center gap-3">
                <input type="range" min="-2" max="2" step="0.1" value={frequencyPenalty}
                  onChange={(e) => setFrequencyPenalty(e.target.value)} className="flex-1 accent-primary h-1" />
                <input type="number" value={frequencyPenalty} onChange={(e) => setFrequencyPenalty(e.target.value)}
                  min="-2" max="2" step="0.1" className="w-16 rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-right font-mono" />
              </div>
              <p className="text-[10px] text-muted-foreground/60 mt-1">按出现频次惩罚高频词，0–0.3 增加描写词汇多样性</p>
            </Field>

            {/* ✅ seed（随机种子）：固定种子可复现输出，方便 A/B 对比调试 */}
            <Field label="seed（随机种子）">
              <input type="number" value={seed} onChange={(e) => setSeed(e.target.value)}
                placeholder="留空表示随机"
                className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono" />
              <p className="text-[10px] text-muted-foreground/60 mt-1">固定种子可复现输出，相同 seed + 相同 prompt 输出完全一致，适合 A/B 调试</p>
            </Field>

            {/* ✅ repetition_penalty（重复惩罚）：1.0 无惩罚，1.05–1.15 抑制 AI 痕迹 */}
            <Field label="repetition_penalty（重复惩罚）">
              <div className="flex items-center gap-3">
                <input type="range" min="1" max="2" step="0.05" value={repetitionPenalty}
                  onChange={(e) => setRepetitionPenalty(e.target.value)} className="flex-1 accent-primary h-1" />
                <input type="number" value={repetitionPenalty} onChange={(e) => setRepetitionPenalty(e.target.value)}
                  min="1" max="2" step="0.05" className="w-16 rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-right font-mono" />
              </div>
              <p className="text-[10px] text-muted-foreground/60 mt-1">1.0 表示无惩罚，1.05–1.15 适合抑制 AI 痕迹</p>
            </Field>
          </div>
        </details>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="确认删除"
        message={`删除"${label}"的配置和密钥？`}
        confirmLabel="删除"
        cancelLabel="取消"
        variant="danger"
        onConfirm={() => void doDelete()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs text-muted-foreground/70 font-medium">{label}</label>
      {children}
    </div>
  );
}
