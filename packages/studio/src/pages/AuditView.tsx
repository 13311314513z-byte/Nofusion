import { useState, useCallback, useEffect } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { useApi, fetchJson, postApi } from "../hooks/use-api";
import {
  ShieldCheck,
  BookOpen,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  BarChart3,
  Loader2,
  RefreshCw,
  Eye,
  ChevronRight,
  Settings,
  Save,
  Zap,
  KeyRound,
  Server,
  Lock,
  Unlock,
  X,
  Filter,
  ListOrdered,
} from "lucide-react";

interface BookSummary {
  readonly id: string;
  readonly title: string;
}

interface AuditProviderInfo {
  readonly service: string;
  readonly label: string;
  readonly group?: string;
  readonly baseUrl: string;
  readonly api: string;
  readonly apiLabel: string;
  readonly apiFormat: "chat" | "responses";
  readonly defaultModel?: string;
  readonly models: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
  }>;
  readonly connected: boolean;
  readonly writingConnected: boolean;
}

interface AuditConfig {
  readonly service: string | null;
  readonly model: string | null;
  readonly baseUrl: string | null;
  readonly api?: string;
  readonly apiLabel?: string;
  readonly apiFormat: string;
  readonly connected: boolean;
  readonly auditKeyFingerprint: string;
  readonly writingKeyFingerprint: string;
  readonly keySeparated: boolean;
}

interface AuditIssue {
  readonly severity: string;
  readonly category: string;
  readonly description: string;
}

interface AuditChapterRow {
  readonly chapterNumber: number;
  readonly title: string;
  readonly status: string;
  readonly wordCount: number;
  readonly lastScore?: number;
  readonly lastAuditedAt?: string;
  readonly issueCount: number;
  readonly criticalCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly topCategories: ReadonlyArray<string>;
  readonly issues: ReadonlyArray<AuditIssue>;
}

interface AuditSummary {
  readonly bookId: string;
  readonly totalChapters: number;
  readonly auditedChapters: number;
  readonly passedChapters: number;
  readonly failedChapters: number;
  readonly averageScore?: number;
  readonly criticalCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly lastAuditedAt?: string;
  readonly categoryCounts: Record<string, number>;
  readonly rows: ReadonlyArray<AuditChapterRow>;
}

interface Nav {
  toBook: (id: string) => void;
  toChapter: (bookId: string, chapterNumber: number) => void;
}

export function AuditView({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data: booksData } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const books = booksData?.books ?? [];

  const { data: providersData } = useApi<{ providers: ReadonlyArray<AuditProviderInfo> }>("/audit/providers");
  const auditProviders = providersData?.providers ?? [];

  const [selectedBookId, setSelectedBookId] = useState<string>("");

  const {
    data: summary,
    loading: summaryLoading,
    error: summaryError,
    refetch: refetchSummary,
  } = useApi<AuditSummary>(
    selectedBookId ? `/audit/books/${encodeURIComponent(selectedBookId)}/summary` : null,
  );

  const {
    data: auditConfig,
    loading: configLoading,
    refetch: refetchConfig,
  } = useApi<AuditConfig>("/audit/config");

  const [configService, setConfigService] = useState("");
  const [configModel, setConfigModel] = useState("");
  const [configBaseUrl, setConfigBaseUrl] = useState("");
  const [configApiKey, setConfigApiKey] = useState("");
  const [configApiFormat, setConfigApiFormat] = useState<"chat" | "responses">("chat");
  const [savingConfig, setSavingConfig] = useState(false);
  const [configMessage, setConfigMessage] = useState("");
  const [testingConfig, setTestingConfig] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!auditConfig) return;
    setConfigService(auditConfig.service ?? "");
    setConfigModel(auditConfig.model ?? "");
    setConfigBaseUrl(auditConfig.baseUrl ?? "");
    setConfigApiFormat(auditConfig.apiFormat === "responses" ? "responses" : "chat");
  }, [auditConfig]);

  // Filters & drawer
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerChapter, setDrawerChapter] = useState<AuditChapterRow | null>(null);

  const passRate = summary && summary.totalChapters > 0
    ? Math.round((summary.passedChapters / summary.totalChapters) * 100)
    : 0;

  // Collect all unique categories for filter
  const allCategories = summary
    ? Array.from(new Set(summary.rows.flatMap((r) => r.issues.map((i) => i.category)))).filter(Boolean)
    : [];

  // Filter rows
  const filteredRows = summary
    ? summary.rows.filter((row) => {
        if (severityFilter !== "all") {
          const counts: Record<string, number> = {
            critical: row.criticalCount,
            warning: row.warningCount,
            info: row.infoCount,
          };
          if (counts[severityFilter] === 0) return false;
        }
        if (categoryFilter !== "all") {
          if (!row.issues.some((i) => i.category === categoryFilter)) return false;
        }
        return true;
      })
    : [];

  // Fix queue: all critical/warning issues across chapters
  const fixQueueItems = summary
    ? summary.rows.flatMap((row) =>
        row.issues
          .filter((i) => i.severity === "critical" || i.severity === "warning")
          .map((issue) => ({ ...issue, chapterNumber: row.chapterNumber, title: row.title }))
      )
    : [];

  const categoryEntries = summary
    ? Object.entries(summary.categoryCounts).sort((a, b) => b[1] - a[1])
    : [];

  const maxCategoryCount = categoryEntries.length > 0 ? categoryEntries[0][1] : 1;

  const handleSaveConfig = useCallback(async () => {
    setConfigMessage("");
    setTestResult(null);
    if (!configService || !configModel || !configApiKey) {
      setConfigMessage(t("audit.configRequired"));
      return;
    }
    setSavingConfig(true);
    try {
      await fetchJson("/audit/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service: configService,
          model: configModel,
          baseUrl: configBaseUrl || undefined,
          apiFormat: configApiFormat,
          apiKey: configApiKey,
        }),
      });
      setConfigMessage(t("audit.configSaved"));
      await refetchConfig();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setConfigMessage(msg);
    } finally {
      setSavingConfig(false);
    }
  }, [configService, configModel, configBaseUrl, configApiFormat, configApiKey, refetchConfig, t]);

  const handleTestConfig = useCallback(async () => {
    setTestResult(null);
    setConfigMessage("");
    if (!configService || !configApiKey) {
      setTestResult({ ok: false, message: t("audit.configRequired") });
      return;
    }
    setTestingConfig(true);
    try {
      const result = await postApi<{
        ok: boolean;
        error?: string;
        modelCount?: number;
      }>("/audit/test", {
        service: configService,
        model: configModel || undefined,
        baseUrl: configBaseUrl || undefined,
        apiFormat: configApiFormat,
        apiKey: configApiKey,
      });
      setTestResult({
        ok: result.ok,
        message: result.ok
          ? `${t("audit.testSuccess")} (${result.modelCount ?? 0} models)`
          : (result.error ?? t("audit.testFailed")),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTestResult({ ok: false, message: msg });
    } finally {
      setTestingConfig(false);
    }
  }, [configService, configModel, configBaseUrl, configApiFormat, configApiKey, t]);

  function statusLabel(status: string): string {
    switch (status) {
      case "ready-for-review": return t("audit.status.ready");
      case "audit-failed": return t("audit.status.failed");
      case "approved": return t("audit.status.approved");
      case "drafted": return t("audit.status.drafted");
      case "published": return t("audit.status.published");
      default: return status;
    }
  }

  function statusClass(status: string): string {
    switch (status) {
      case "ready-for-review":
      case "approved":
      case "published":
        return "text-emerald-600 dark:text-emerald-400";
      case "audit-failed":
        return "text-red-600 dark:text-red-400";
      case "drafted":
        return "text-amber-600 dark:text-amber-400";
      default:
        return c.muted;
    }
  }

  const selectedProvider = auditProviders.find((provider) => provider.service === configService);
  const isCustomProvider = configService === "custom" || configService.startsWith("custom:");
  const modelTypeLabel = selectedProvider?.apiLabel
    ?? auditConfig?.apiLabel
    ?? (configApiFormat === "responses" ? "OpenAI Responses" : "OpenAI Chat / Completions");

  const handleServiceChange = useCallback((service: string) => {
    const provider = auditProviders.find((item) => item.service === service);
    setConfigService(service);
    setConfigModel(provider?.defaultModel ?? provider?.models[0]?.id ?? "");
    setConfigBaseUrl("");
    setConfigApiFormat(provider?.apiFormat ?? "chat");
    setConfigMessage("");
    setTestResult(null);
  }, [auditProviders]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-7 h-7 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">{t("nav.audit")}</h1>
        </div>
        <div className="flex items-center gap-3">
          <select
            className={`${c.input} px-3 py-2 rounded-lg text-sm min-w-[200px]`}
            value={selectedBookId}
            onChange={(e) => setSelectedBookId(e.target.value)}
          >
            <option value="">{t("audit.selectBook")}</option>
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
          {selectedBookId && (
            <button
              onClick={() => refetchSummary()}
              className={`${c.btnSecondary} p-2 rounded-lg`}
              title={t("common.refresh")}
            >
              <RefreshCw size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Audit Config Card */}
      <div className={`${c.cardStatic} border rounded-xl p-6`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Settings size={18} />
            {t("audit.configTitle")}
          </h2>
          {auditConfig && (
            <div className="flex items-center gap-2 text-xs">
              {auditConfig.keySeparated ? (
                <span className="flex items-center gap-1 text-emerald-600 font-medium">
                  <Lock size={12} />
                  {t("audit.keySeparated")}
                </span>
              ) : auditConfig.connected ? (
                <span className="flex items-center gap-1 text-amber-600 font-medium">
                  <Unlock size={12} />
                  {t("audit.keySame")}
                </span>
              ) : (
                <span className={`flex items-center gap-1 ${c.muted}`}>
                  <KeyRound size={12} />
                  {t("audit.notConfigured")}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="space-y-1">
            <label className={`text-xs font-medium ${c.muted}`}>{t("audit.service")}</label>
            <select
              className={`${c.input} w-full px-3 py-2 rounded-lg text-sm`}
              value={configService}
              onChange={(e) => handleServiceChange(e.target.value)}
            >
              <option value="">{t("audit.selectService")}</option>
              {auditProviders.map((s) => (
                <option key={s.service} value={s.service}>
                  {s.label}{s.group ? ` - ${s.group}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className={`text-xs font-medium ${c.muted}`}>{t("audit.modelType")}</label>
            {isCustomProvider ? (
              <select
                className={`${c.input} w-full px-3 py-2 rounded-lg text-sm`}
                value={configApiFormat}
                onChange={(e) => setConfigApiFormat(e.target.value as "chat" | "responses")}
              >
                <option value="chat">OpenAI Chat / Completions</option>
                <option value="responses">OpenAI Responses</option>
              </select>
            ) : (
              <input
                type="text"
                readOnly
                className={`${c.input} w-full px-3 py-2 rounded-lg text-sm`}
                value={configService ? modelTypeLabel : ""}
                placeholder={t("audit.modelTypePlaceholder")}
              />
            )}
          </div>
          <div className="space-y-1">
            <label className={`text-xs font-medium ${c.muted}`}>{t("audit.model")}</label>
            <input
              type="text"
              className={`${c.input} w-full px-3 py-2 rounded-lg text-sm`}
              placeholder={t("audit.modelPlaceholder")}
              list="audit-model-options"
              value={configModel}
              onChange={(e) => setConfigModel(e.target.value)}
            />
            <datalist id="audit-model-options">
              {(selectedProvider?.models ?? []).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </datalist>
          </div>
          <div className="space-y-1">
            <label className={`text-xs font-medium ${c.muted}`}>{t("audit.baseUrl")}</label>
            <input
              type="text"
              className={`${c.input} w-full px-3 py-2 rounded-lg text-sm`}
              placeholder={t("audit.baseUrlPlaceholder")}
              value={configBaseUrl}
              onChange={(e) => setConfigBaseUrl(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className={`text-xs font-medium ${c.muted}`}>{t("audit.apiKey")}</label>
            <input
              type="password"
              className={`${c.input} w-full px-3 py-2 rounded-lg text-sm`}
              placeholder={t("audit.apiKeyPlaceholder")}
              value={configApiKey}
              onChange={(e) => setConfigApiKey(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={handleSaveConfig}
            disabled={savingConfig}
            className={`${c.btnPrimary} px-4 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-2`}
          >
            {savingConfig ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {t("common.save")}
          </button>
          <button
            onClick={handleTestConfig}
            disabled={testingConfig}
            className={`${c.btnSecondary} px-4 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-2`}
          >
            {testingConfig ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            {t("audit.testConnection")}
          </button>
          {configMessage && (
            <span className={`text-sm ${configMessage.includes(t("audit.configSaved")) ? "text-emerald-600" : "text-red-600"}`}>
              {configMessage}
            </span>
          )}
          {testResult && (
            <span className={`text-sm ${testResult.ok ? "text-emerald-600" : "text-red-600"}`}>
              {testResult.message}
            </span>
          )}
        </div>

        {auditConfig?.connected && (
          <div className={`mt-3 text-xs ${c.muted} flex flex-wrap gap-4`}>
            <span>{t("audit.auditKey")}: {auditConfig.auditKeyFingerprint}</span>
            <span>{t("audit.writingKey")}: {auditConfig.writingKeyFingerprint}</span>
          </div>
        )}
      </div>

      {!selectedBookId && (
        <div className={`${c.cardStatic} border rounded-xl p-12 text-center`}>
          <BookOpen className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
          <p className={c.muted}>{t("audit.selectBookPrompt")}</p>
        </div>
      )}

      {selectedBookId && summaryLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      )}

      {selectedBookId && summaryError && (
        <div className={`${c.error} border rounded-xl p-6`}>
          <p>{t("audit.loadError")}: {summaryError}</p>
        </div>
      )}

      {selectedBookId && summary && (
        <>
          {/* Overview cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <OverviewCard
              label={t("audit.totalChapters")}
              value={String(summary.totalChapters)}
              icon={<BookOpen size={18} />}
            />
            <OverviewCard
              label={t("audit.audited")}
              value={`${summary.auditedChapters}/${summary.totalChapters}`}
              icon={<Eye size={18} />}
            />
            <OverviewCard
              label={t("audit.passRate")}
              value={`${passRate}%`}
              icon={<CheckCircle2 size={18} />}
              accent={passRate >= 80}
            />
            <OverviewCard
              label={t("audit.averageScore")}
              value={summary.averageScore !== undefined ? String(summary.averageScore) : "—"}
              icon={<BarChart3 size={18} />}
            />
            <OverviewCard
              label={t("audit.critical")}
              value={String(summary.criticalCount)}
              icon={<AlertTriangle size={18} />}
              danger={summary.criticalCount > 0}
            />
            <OverviewCard
              label={t("audit.issues")}
              value={`${summary.warningCount}W / ${summary.infoCount}I`}
              icon={<Info size={18} />}
            />
          </div>

          {/* Category distribution */}
          {categoryEntries.length > 0 && (
            <div className={`${c.cardStatic} border rounded-xl p-6`}>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <BarChart3 size={18} />
                {t("audit.categoryDistribution")}
              </h2>
              <div className="space-y-3">
                {categoryEntries.map(([category, count]) => (
                  <div key={category} className="flex items-center gap-3">
                    <div className="w-28 text-sm truncate" title={category}>
                      {category}
                    </div>
                    <div className="flex-1 h-6 bg-muted/50 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary/70 rounded-full transition-all duration-500"
                        style={{ width: `${Math.max(4, (count / maxCategoryCount) * 100)}%` }}
                      />
                    </div>
                    <div className="w-8 text-right text-sm font-medium">{count}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fix queue */}
          {fixQueueItems.length > 0 && (
            <div className={`${c.cardStatic} border rounded-xl overflow-hidden`}>
              <div className="px-6 py-4 border-b flex items-center justify-between">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <ListOrdered size={18} />
                  {t("audit.fixQueue")}
                </h2>
                <span className={`text-xs ${c.muted}`}>{fixQueueItems.length} items</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={c.tableHeader}>
                      <th className="px-4 py-3 text-left">{t("audit.chapter")}</th>
                      <th className="px-4 py-3 text-left">{t("audit.severity")}</th>
                      <th className="px-4 py-3 text-left">{t("audit.category")}</th>
                      <th className="px-4 py-3 text-left">{t("audit.description")}</th>
                      <th className="px-4 py-3 text-right">{t("audit.actions")}</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${c.tableDivide}`}>
                    {fixQueueItems.slice(0, 20).map((item, idx) => (
                      <tr key={`${item.chapterNumber}-${idx}`} className={c.tableHover}>
                        <td className="px-4 py-3 font-medium">#{item.chapterNumber} {item.title}</td>
                        <td className="px-4 py-3">
                          <SeverityBadge severity={item.severity} />
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                            {item.category}
                          </span>
                        </td>
                        <td className="px-4 py-3 max-w-md truncate" title={item.description}>
                          {item.description || "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => nav.toChapter(summary.bookId, item.chapterNumber)}
                            className={`${c.link} inline-flex items-center gap-1 text-xs`}
                          >
                            {t("audit.gotoChapter")}
                            <ChevronRight size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {fixQueueItems.length > 20 && (
                      <tr>
                        <td colSpan={5} className={`px-4 py-3 text-center text-xs ${c.muted}`}>
                          +{fixQueueItems.length - 20} more
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Chapter table */}
          <div className={`${c.cardStatic} border rounded-xl overflow-hidden`}>
            <div className="px-6 py-4 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h2 className="text-lg font-semibold">{t("audit.chapterTable")}</h2>
              <div className="flex items-center gap-3">
                {/* Severity filter */}
                <div className="flex items-center gap-1.5">
                  <Filter size={14} className={c.muted} />
                  <select
                    className={`${c.input} px-2 py-1.5 rounded-lg text-xs`}
                    value={severityFilter}
                    onChange={(e) => setSeverityFilter(e.target.value)}
                  >
                    <option value="all">{t("audit.allSeverities")}</option>
                    <option value="critical">{t("audit.critical")}</option>
                    <option value="warning">{t("audit.warning")}</option>
                    <option value="info">{t("audit.info")}</option>
                  </select>
                </div>
                {/* Category filter */}
                {allCategories.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Filter size={14} className={c.muted} />
                    <select
                      className={`${c.input} px-2 py-1.5 rounded-lg text-xs max-w-[140px]`}
                      value={categoryFilter}
                      onChange={(e) => setCategoryFilter(e.target.value)}
                    >
                      <option value="all">{t("audit.allCategories")}</option>
                      {allCategories.map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                )}
                <span className={`text-xs ${c.muted}`}>
                  {t("audit.lastAudited")}: {summary.lastAuditedAt
                    ? new Date(summary.lastAuditedAt).toLocaleString()
                    : "—"}
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={c.tableHeader}>
                    <th className="px-4 py-3 text-left">#</th>
                    <th className="px-4 py-3 text-left">{t("audit.title")}</th>
                    <th className="px-4 py-3 text-left">{t("audit.status")}</th>
                    <th className="px-4 py-3 text-right">{t("audit.score")}</th>
                    <th className="px-4 py-3 text-right">{t("audit.issues")}</th>
                    <th className="px-4 py-3 text-left">{t("audit.topCategories")}</th>
                    <th className="px-4 py-3 text-right">{t("audit.actions")}</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${c.tableDivide}`}>
                  {filteredRows.map((row) => (
                    <tr key={row.chapterNumber} className={c.tableHover}>
                      <td className="px-4 py-3 font-medium">{row.chapterNumber}</td>
                      <td className="px-4 py-3">{row.title}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium ${statusClass(row.status)}`}>
                          {statusLabel(row.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {row.lastScore !== undefined ? (
                          <span className={`font-mono font-medium ${row.lastScore >= 80 ? "text-emerald-600" : row.lastScore >= 60 ? "text-amber-600" : "text-red-600"}`}>
                            {row.lastScore}
                          </span>
                        ) : (
                          <span className={c.muted}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {row.issueCount > 0 ? (
                          <button
                            onClick={() => {
                              setDrawerChapter(row);
                              setDrawerOpen(true);
                            }}
                            className="font-mono hover:underline"
                          >
                            {row.criticalCount > 0 && (
                              <span className="text-red-600 font-medium">{row.criticalCount}C </span>
                            )}
                            {row.warningCount > 0 && (
                              <span className="text-amber-600">{row.warningCount}W </span>
                            )}
                            {row.infoCount > 0 && (
                              <span className="text-blue-600">{row.infoCount}I</span>
                            )}
                          </button>
                        ) : (
                          <span className={c.muted}>0</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {row.topCategories.map((cat) => (
                            <span
                              key={cat}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                            >
                              {cat}
                            </span>
                          ))}
                          {row.topCategories.length === 0 && (
                            <span className={c.muted}>—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => nav.toChapter(summary.bookId, row.chapterNumber)}
                          className={`${c.link} inline-flex items-center gap-1 text-xs`}
                        >
                          {t("audit.view")}
                          <ChevronRight size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className={`px-4 py-12 text-center ${c.muted}`}>
                        {t("audit.noChapters")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Issue detail drawer */}
      {drawerOpen && drawerChapter && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          onClick={() => setDrawerOpen(false)}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full max-w-lg h-full bg-card border-l shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold">
                {t("audit.chapterIssues")} #{drawerChapter.chapterNumber}
              </h3>
              <button
                onClick={() => setDrawerOpen(false)}
                className={`${c.btnSecondary} p-1.5 rounded-lg`}
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {drawerChapter.issues.length === 0 ? (
                <p className={`text-center ${c.muted} py-12`}>{t("audit.noIssues")}</p>
              ) : (
                drawerChapter.issues.map((issue, idx) => (
                  <div
                    key={idx}
                    className="border rounded-lg p-4 space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <SeverityBadge severity={issue.severity} />
                      {issue.category && (
                        <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                          {issue.category}
                        </span>
                      )}
                    </div>
                    <p className="text-sm">{issue.description || issue.category}</p>
                  </div>
                ))
              )}
            </div>
            <div className="px-6 py-4 border-t">
              <button
                onClick={() => {
                  setDrawerOpen(false);
                  nav.toChapter(selectedBookId, drawerChapter.chapterNumber);
                }}
                className={`${c.btnPrimary} w-full px-4 py-2 rounded-lg text-sm font-medium`}
              >
                {t("audit.gotoChapter")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  if (severity === "critical") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-medium">
        <AlertTriangle size={10} />
        {severity}
      </span>
    );
  }
  if (severity === "warning") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
        <AlertTriangle size={10} />
        {severity}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 font-medium">
      <Info size={10} />
      {severity}
    </span>
  );
}

function OverviewCard({
  label,
  value,
  icon,
  accent,
  danger,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="border border-border rounded-xl p-4 bg-card">
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div
        className={`text-2xl font-bold ${
          danger ? "text-red-600" : accent ? "text-emerald-600" : "text-foreground"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
