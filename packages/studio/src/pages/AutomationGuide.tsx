import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { Zap, Webhook, Terminal, CheckSquare } from "lucide-react";

interface Nav {
  toDashboard: () => void;
}

const WEBHOOK_PAYLOADS = [
  {
    event: "chapter-complete",
    payload: {
      event: "chapter-complete",
      bookId: "book-123",
      chapterNumber: 5,
      timestamp: "2026-06-04T01:23:28.620Z",
      data: {
        title: "风云再起",
        wordCount: 3200,
      },
    },
  },
  {
    event: "audit-passed",
    payload: {
      event: "audit-passed",
      bookId: "book-123",
      chapterNumber: 4,
      timestamp: "2026-06-04T01:20:15.120Z",
      data: {
        score: 88,
      },
    },
  },
  {
    event: "pipeline-error",
    payload: {
      event: "pipeline-error",
      bookId: "book-123",
      timestamp: "2026-06-04T01:18:42.330Z",
      data: {
        error: "LLM API rate limit exceeded",
      },
    },
  },
];

const CLI_COMMANDS = [
  {
    command: "inkos write next --json",
    desc: "输出下一章的写作结果，包含 chapterNumber、title、wordCount、status 等字段。",
  },
  {
    command: "inkos audit --json",
    desc: "输出审计结果，包含 score、issues、severity 等字段，可用于自动化质检。",
  },
  {
    command: "inkos export --json",
    desc: "输出导出元数据，包含 format、filePath、totalChapters、totalWords 等字段。",
  },
];

const CHECKLIST = [
  { platform: "n8n / Make / Zapier", steps: [
    "创建 Webhook 触发器（Trigger 节点）",
    "填入 InkOS Webhook URL：http://localhost:3000/api/v1/webhooks/{your-channel-id}",
    "配置 Secret（可选）：在 Headers 中添加 X-Inkos-Secret",
    "选择事件类型：chapter-complete / audit-passed / pipeline-error",
    "点击「测试连接」，触发一次测试事件验证连通性",
  ]},
];

export function AutomationGuide({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span>{t("nav.automation")}</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10 text-primary">
          <Zap size={20} />
        </div>
        <h1 className="font-serif text-3xl">{t("automation.title")}</h1>
      </div>

      <p className="text-sm text-muted-foreground">
        {t("automation.desc")}
      </p>

      {/* Webhook Payloads */}
      <div className={`border ${c.cardStatic} rounded-xl overflow-hidden`}>
        <div className="px-6 py-4 border-b border-border/40 bg-muted/30 flex items-center gap-2">
          <Webhook size={16} className="text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider">{t("automation.webhookPayloads")}</h2>
        </div>
        <div className="p-6 space-y-6">
          {WEBHOOK_PAYLOADS.map((item) => (
            <div key={item.event}>
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">
                {item.event}
              </div>
              <pre className="text-xs leading-relaxed font-mono text-foreground/80 bg-muted/40 p-4 rounded-lg border border-border/40 overflow-x-auto">
                {JSON.stringify(item.payload, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      </div>

      {/* CLI JSON Output */}
      <div className={`border ${c.cardStatic} rounded-xl overflow-hidden`}>
        <div className="px-6 py-4 border-b border-border/40 bg-muted/30 flex items-center gap-2">
          <Terminal size={16} className="text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider">{t("automation.cliJson")}</h2>
        </div>
        <div className="p-6 space-y-4">
          {CLI_COMMANDS.map((cmd) => (
            <div key={cmd.command} className="flex flex-col gap-1">
              <code className="text-xs font-mono bg-primary/5 text-primary px-2 py-1 rounded w-fit">
                {cmd.command}
              </code>
              <p className="text-sm text-muted-foreground">{cmd.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Integration Checklist */}
      <div className={`border ${c.cardStatic} rounded-xl overflow-hidden`}>
        <div className="px-6 py-4 border-b border-border/40 bg-muted/30 flex items-center gap-2">
          <CheckSquare size={16} className="text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider">{t("automation.checklist")}</h2>
        </div>
        <div className="p-6 space-y-6">
          {CHECKLIST.map((item) => (
            <div key={item.platform}>
              <div className="text-sm font-medium mb-3">{item.platform}</div>
              <ol className="space-y-2">
                {item.steps.map((step, idx) => (
                  <li key={idx} className="flex items-start gap-3 text-sm text-muted-foreground">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                      {idx + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
