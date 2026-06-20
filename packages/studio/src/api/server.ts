import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import {
  StateManager,
  PipelineRunner,
  createLLMClient,
  createLogger,
  createInteractionToolsFromDeps,
  computeAnalytics,
  loadProjectConfig,
  listFoundationSources,
  archiveFoundationSource,
  summarizePendingHookHealth,
  loadProjectSession,
  processProjectInteractionRequest,
  resolveSessionActiveBook,
  listBookSessions,
  loadBookSession,
  appendManualSessionMessages,
  createAndPersistBookSession,
  renameBookSession,
  deleteBookSession,
  migrateBookSession,
  SessionAlreadyMigratedError,
  runAgentSession,
  buildAgentSystemPrompt,
  resolveServicePreset,
  resolveServiceProviderFamily,
  resolveServiceModelsBaseUrl,
  resolveServiceModel,
  resolveWritingReviewRetries,
  loadSecrets,
  saveSecrets,
  setServiceApiKey,
  listModelsForService,
  isApiKeyOptionalForEndpoint,
  getAllEndpoints,
  probeModelsFromUpstream,
  fetchWithProxy,
  chatCompletion,
  buildExportArtifact,
  ChapterMetaSchema,
  GLOBAL_ENV_PATH,
  COVER_PROVIDER_PRESETS,
  Scheduler,
  coverSecretKey,
  resolveCoverProviderPreset,
  type ResolvedModel,
  type PipelineConfig,
  type ProjectConfig,
  type LogSink,
  type LogEntry,
  type ChapterMeta,
  listAuthorProfiles,
  getAuthorProfile,
  createAuthorProfile,
  addStyleSource,
  reanalyzeAuthorProfile,
  deleteAuthorProfile,
  deleteStyleSource,
  saveAuthorDiagnostics,
  listAuthorDiagnostics,
  getAuthorDiagnostics,
  compareWithAuthorProfile,
  generateAdjustmentPlan,
  rewriteWithAuthorProfile,
  extractDocumentFromText,
  extractDocumentChunked,
  MAX_CHARS,
  buildFoundationSourceBundle,
  isDocumentFileType,
  isFoundationSourcePurpose,
  persistFoundationSourceBundle,
  buildAuthorProfile,
  planChapterImport,
  loadChapterGoals,
  saveChapterGoals,
  getChapterGoal,
  upsertChapterGoal,
  removeChapterGoal,
  loadChapterIntents,
  saveChapterIntents,
  getChapterIntent,
  upsertChapterIntent,
  removeChapterIntent,
  AuthorChapterIntentSchema,
  buildAuthorIntentBlock,
  generateSuggestions,
  type AuthorChapterIntent,
  listRoleCards,
  loadRoleCard,
  saveRoleCard,
  deleteRoleCard,
  createRoleCardTemplate,
  appendAuditHistory,
  loadAuditHistory,
  type AuthorStyleProfile,
  type StyleSourceDocument,
  type StyleLibraryIndex,
  type ChapterImportPlan,
  type ChapterGoalCard,
  type RoleCard,
  type RoleTier,
  type AuditIssue,
  sendTelegram,
  sendFeishu,
  sendWechatWork,
  sendWebhook,
  analyzeStyleFingerprint,
  type StyleFingerprint,
  type ArchitectOutput,
  type FoundationSourceBundle,
  type FoundationSourceInput,
} from "@actalk/inkos-core";
import { randomUUID } from "node:crypto";
import { access, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { isIP } from "node:net";
import { isSafeBookId } from "./safety.js";
import { ApiError } from "./errors.js";
import { buildStudioBookConfig, type StudioCreateBookBody } from "./book-create.js";

// Route modules (extracted from this file to reduce file size)
import { registerEventsRoutes } from "./routes/events.js";
import { registerDaemonRoutes } from "./routes/daemon.js";
import { registerCoverRoutes } from "./routes/cover.js";
import { registerProjectRoutes } from "./routes/project.js";
import { registerLogsRoutes } from "./routes/logs.js";
import { registerGenresRoutes } from "./routes/genres.js";
import { registerAnalyticsRoutes } from "./routes/analytics.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerTruthBrowserRoutes } from "./routes/truth-browser.js";
import { registerLanguageRoutes } from "./routes/language.js";
import { registerModelOverridesRoutes, registerNotifyRoutes } from "./routes/project-config.js";
import { registerSourcesRoutes } from "./routes/sources.js";
import { registerHooksRoutes } from "./routes/hooks.js";
import { registerBooksRoutes } from "./routes/books.js";
import { registerChaptersRoutes } from "./routes/chapters.js";
import { registerServicesRoutes } from "./routes/services.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { registerStyleRoutes } from "./routes/style.js";
import { registerRuntimeTruthRoutes } from "./routes/runtime-truth.js";
import { registerVoicesSceneRoutes } from "./routes/voices-scene.js";
import { registerSessionsRoutes } from "./routes/sessions.js";
import { registerRolesRoutes } from "./routes/roles.js";
import { registerDetectRoutes } from "./routes/detect.js";
import { registerWritingRoutes } from "./routes/writing.js";
import { registerRevisionExportRoutes } from "./routes/revision-export.js";
import { registerFanficRadarDoctorRoutes } from "./routes/fanfic-radar-doctor.js";

// Shared helpers (extracted so route modules can import directly)
import { withPipeline } from "./shared/pipeline.js";
import {
  writeJobs,
  WRITE_JOB_TIMEOUT_MS,
  acquireWriteJob,
  completeWriteJob,
  failWriteJob,
  timeoutWriteJob,
  type WriteJobEntry,
} from "./shared/write-jobs.js";

import {
  PreprocessRequestSchema,
  RelayoutRequestSchema,
  InspectRequestSchema,
  MAX_PREPROCESS_TEXT_CHARS,
  DiagnosticsRequestSchema,
  CompareRequestSchema,
  AdjustmentPlanRequestSchema,
  RewritePreviewRequestSchema,
} from "./style-schemas.js";

// -- Pipeline stage definitions per agent type --

const PIPELINE_STAGES: Record<string, string[]> = {
  writer: [
    "准备章节输入", "撰写章节草稿", "落盘最终章节",
    "生成最终真相文件", "校验真相文件变更", "同步记忆索引",
    "更新章节索引与快照",
  ],
  architect: [
    "生成基础设定", "保存书籍配置", "写入基础设定文件",
    "初始化控制文档", "创建初始快照",
  ],
  reviser: [
    "加载修订上下文", "修订章节", "落盘修订结果",
    "更新索引与快照",
  ],
  auditor: ["审计章节"],
};

const AGENT_LABELS: Record<string, string> = {
  architect: "建书", writer: "写作", auditor: "审计",
  reviser: "修订", exporter: "导出",
};

const STYLE_ID_RE = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,127}$/u;
const WINDOWS_RESERVED_STYLE_ID_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function isSafeStyleId(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    STYLE_ID_RE.test(value.trim()) &&
    value.trim() !== "." &&
    value.trim() !== ".." &&
    !WINDOWS_RESERVED_STYLE_ID_RE.test(value.trim())
  );
}

function isTextStyleFileType(value: unknown): value is "md" | "txt" | "jsonl" | "json" | "ts" | "js" | "html" | "css" {
  return value === "md" || value === "txt" || value === "jsonl" || value === "json" || value === "ts" || value === "js" || value === "html" || value === "css";
}

function isBlockedStyleImportAddress(address: string): boolean {
  const host = address.toLowerCase().replace(/^\[|\]$/g, "");
  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const [a = 0, b = 0] = host.split(".").map((part) => Number(part));
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }

  if (ipVersion === 6) {
    if (host.startsWith("::ffff:")) {
      return isBlockedStyleImportAddress(host.slice("::ffff:".length));
    }
    return (
      host === "::" ||
      host === "::1" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe80:")
    );
  }

  return false;
}

function isBlockedStyleImportHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    isBlockedStyleImportAddress(host)
  );
}

function parseSafeStyleImportUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("url is required");
  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("only http and https URLs are supported");
  }
  if (url.username || url.password) {
    throw new Error("URL credentials are not allowed");
  }
  if (isBlockedStyleImportHostname(url.hostname)) {
    throw new Error("private or local URLs are not allowed");
  }
  return url;
}

async function assertSafeStyleImportTarget(url: URL): Promise<void> {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isBlockedStyleImportHostname(host)) {
    throw new Error("private or local URLs are not allowed");
  }
  if (isIP(host)) return;

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("URL hostname could not be resolved");
  }

  if (addresses.length === 0 || addresses.some((record) => isBlockedStyleImportAddress(record.address))) {
    throw new Error("private or local URLs are not allowed");
  }
}

async function normalizeSafeNotificationWebhookUrl(input: unknown): Promise<string> {
  if (typeof input !== "string" || !input.trim()) {
    throw new ApiError(400, "INVALID_NOTIFY_WEBHOOK_URL", "Notification webhook URL is required");
  }
  try {
    const url = parseSafeStyleImportUrl(input);
    await assertSafeStyleImportTarget(url);
    return url.toString();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new ApiError(400, "INVALID_NOTIFY_WEBHOOK_URL", `Invalid notification webhook URL: ${message}`);
  }
}

function extractHtmlTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  return match[1]
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || null;
}

async function readStyleImportBody(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error(`URL response is too large (max ${Math.floor(maxBytes / 1_000_000)}MB)`);
    }
    return text;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const remaining = maxBytes - bytesRead;
      if (remaining <= 0) {
        await reader.cancel();
        throw new Error(`URL response is too large (max ${Math.floor(maxBytes / 1_000_000)}MB)`);
      }

      if (value.byteLength > remaining) {
        await reader.cancel();
        throw new Error(`URL response is too large (max ${Math.floor(maxBytes / 1_000_000)}MB)`);
      }
      text += decoder.decode(value, { stream: true });
      bytesRead += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  return text + decoder.decode();
}
const TOOL_LABELS: Record<string, string> = {
  read: "读取文件", edit: "编辑文件", grep: "搜索", ls: "列目录",
  short_fiction_run: "短篇生产",
  generate_cover: "生成封面",
};

function resolveToolLabel(tool: string, agent?: string): string {
  if (tool === "sub_agent" && agent) return AGENT_LABELS[agent] ?? agent;
  return TOOL_LABELS[tool] ?? tool;
}

function summarizeResult(result: unknown): string {
  if (typeof result === "string") return result.slice(0, 200);
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.content === "string") return r.content.slice(0, 200);
    if (typeof r.text === "string") return r.text.slice(0, 200);
  }
  return String(result).slice(0, 200);
}

function compareServiceListItems(
  left: { readonly service: string },
  right: { readonly service: string },
): number {
  const priority = ["kkaiapi", "openrouter", "newapi", "siliconcloud"];
  const leftPriority = priority.indexOf(left.service);
  const rightPriority = priority.indexOf(right.service);
  if (leftPriority !== -1 || rightPriority !== -1) {
    return (leftPriority === -1 ? 999 : leftPriority) - (rightPriority === -1 ? 999 : rightPriority);
  }
  return 0;
}

function isHeaderSafeApiKey(value: string): boolean {
  if (!value) return true;
  return /^[\x21-\x7E]+$/.test(value);
}

const NON_TEXT_MODEL_ID_PARTS = [
  "image",
  "embedding",
  "embed",
  "rerank",
  "tts",
  "speech",
  "audio",
  "moderation",
  "whisper",
  "transcribe",
  "sora",
  "realtime",
  "computer-use",
] as const;

const SERVICE_MODELS_PROBE_TIMEOUT_MS = 4_000;
const SERVICE_CHAT_PROBE_TIMEOUT_MS = 8_000;
const MAX_DISCOVERED_MODELS_TO_PING = 2;
const MAX_GENERIC_FALLBACK_MODELS_TO_PING = 2;

function isTextChatModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized) return false;
  return !NON_TEXT_MODEL_ID_PARTS.some((part) => normalized.includes(part));
}

function filterTextChatModels<T extends { readonly id: string }>(models: ReadonlyArray<T>): T[] {
  return models.filter((model) => isTextChatModelId(model.id));
}

function normalizeApiBookId(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError(400, "INVALID_BOOK_ID", `${fieldName} must be a string`);
  }
  const bookId = value.trim();
  if (!bookId) {
    throw new ApiError(400, "INVALID_BOOK_ID", `${fieldName} cannot be blank`);
  }
  if (!isSafeBookId(bookId)) {
    throw new ApiError(400, "INVALID_BOOK_ID", `Invalid ${fieldName}: "${bookId}"`);
  }
  return bookId;
}

function nonTextModelMessage(modelId: string): string {
  return `模型 ${modelId} 不适合文本聊天/写作。请在模型选择器中改用文本模型，例如 gemini-2.5-flash、gemini-2.5-pro 或对应服务的 chat 模型。`;
}

function extractToolError(result: unknown): string {
  if (typeof result === "string") return result.slice(0, 500);
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.content === "string") return r.content.slice(0, 500);
    if (r.content && Array.isArray(r.content)) {
      const textPart = r.content.find((c: any) => c.type === "text");
      if (textPart) return (textPart as any).text?.slice(0, 500) ?? "";
    }
  }
  return String(result).slice(0, 500);
}

function resolveProjectImageFile(root: string, rawPath: string): { readonly resolved: string; readonly contentType: string } {
  let relPath: string;
  try {
    relPath = decodeURIComponent(rawPath).replace(/^\/+/u, "");
  } catch {
    throw new ApiError(400, "INVALID_PROJECT_FILE_PATH", "Invalid project file path");
  }

  if (
    !relPath
    || relPath.includes("\0")
    || isAbsolute(relPath)
    || relPath.split(/[\\/]+/u).includes("..")
  ) {
    throw new ApiError(400, "INVALID_PROJECT_FILE_PATH", "Invalid project file path");
  }
  if (!relPath.startsWith("shorts/") && !relPath.startsWith("covers/")) {
    throw new ApiError(400, "INVALID_PROJECT_FILE_PATH", "Only generated shorts/ and covers/ images can be previewed");
  }

  const ext = relPath.split(".").pop()?.toLowerCase() ?? "";
  const contentTypes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  };
  const contentType = contentTypes[ext];
  if (!contentType) {
    throw new ApiError(415, "UNSUPPORTED_PROJECT_FILE_TYPE", "Unsupported project file type");
  }

  const resolved = resolve(root, relPath);
  const rel = relative(root, resolved);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new ApiError(400, "INVALID_PROJECT_FILE_PATH", "Invalid project file path");
  }
  return { resolved, contentType };
}

function isLikelyFailedToolResult(exec: CollectedToolExec): boolean {
  if (exec.status === "error") return true;
  const text = `${exec.error ?? ""}\n${exec.result ?? ""}`.toLowerCase();
  return /\bfailed\b|\berror\b|失败|异常|出错/.test(text);
}

function hasSuccessfulSubAgentExec(
  execs: ReadonlyArray<CollectedToolExec>,
  agent: string,
): boolean {
  return execs.some((exec) =>
    exec.tool === "sub_agent"
    && exec.agent === agent
    && exec.status === "completed"
    && !isLikelyFailedToolResult(exec)
  );
}

function isWriteNextInstruction(instruction: string): boolean {
  const trimmed = instruction.trim();
  return /^(continue|继续|继续写|写下一章|write next|下一章|再来一章)$/i.test(trimmed)
    || /(继续写|写下一章|下一章|再来一章|write\s+next)/i.test(trimmed);
}

type ExternalChatEditResult = {
  readonly responseText: string;
  readonly activeBookId?: string;
};

const CHAT_EDIT_WARNING = "[warning] Chat external edit requires review before continuation.";
const CHAT_EDIT_TEXT_EXTENSIONS = /\.(md|txt|json|ya?ml)$/i;
const CHAT_EDIT_ALLOWED_ROOTS = new Set(["books", "shorts", "covers", "genres"]);

function parseReplacementInstruction(instruction: string): { oldText: string; newText: string } | null {
  const inFileQuoted = instruction.match(/(?:里|里的|中|中的|里面)\s*[「“"]([\s\S]+?)[」”"]\s*(?:改成|替换成|换成)\s*[「“"]([\s\S]+?)[」”"]/);
  if (inFileQuoted?.[1] && inFileQuoted[2] !== undefined) {
    return { oldText: inFileQuoted[1], newText: inFileQuoted[2] };
  }
  const quoted = instruction.match(/(?:把|将)\s*[「“"]([\s\S]+?)[」”"]\s*(?:改成|替换成|换成)\s*[「“"]([\s\S]+?)[」”"]/);
  if (quoted?.[1] && quoted[2] !== undefined) {
    return { oldText: quoted[1], newText: quoted[2] };
  }
  const plain = instruction.match(/(?:把|将)\s+([^\s，。；;]+)\s*(?:改成|替换成|换成)\s+([^\n，。；;]+)/);
  if (plain?.[1] && plain[2] !== undefined) {
    return { oldText: plain[1], newText: plain[2].trim() };
  }
  return null;
}

function parseChapterNumberForEdit(instruction: string): number | null {
  const match = instruction.match(/第\s*(\d{1,4})\s*章/);
  if (!match?.[1]) return null;
  const chapterNumber = Number.parseInt(match[1], 10);
  return Number.isInteger(chapterNumber) && chapterNumber > 0 ? chapterNumber : null;
}

function parseExplicitEditPath(instruction: string): string | null {
  const match = instruction.match(/(?:把|将)\s+([^「“"\s，。；;]+?\.[A-Za-z0-9]+)\s*(?:里|里的|中|中的|里面)/);
  return match?.[1]?.trim() ?? null;
}

function countContentUnits(content: string): number {
  const stripped = content
    .replace(/^#{1,6}\s+.*$/gm, "")
    .trim();
  if (!stripped) return 0;
  if (/[\u3400-\u9fff]/.test(stripped)) {
    return stripped.replace(/\s/g, "").length;
  }
  return stripped.split(/\s+/).filter(Boolean).length;
}

function resolveExternalChatEditPath(root: string, requestedPath: string): { path: string; rel: string } {
  if (isAbsolute(requestedPath)) {
    throw new ApiError(400, "UNSUPPORTED_CHAT_EDIT_TARGET", "Chat external edits only support project-relative content paths.");
  }
  const projectRoot = resolve(root);
  const resolved = resolve(projectRoot, requestedPath);
  const rel = relative(projectRoot, resolved).replace(/\\/g, "/");
  if (!rel || rel.startsWith("../") || rel === "..") {
    throw new ApiError(400, "UNSUPPORTED_CHAT_EDIT_TARGET", "Chat external edit path escapes the project root.");
  }
  const first = rel.split("/")[0] ?? "";
  if (!CHAT_EDIT_ALLOWED_ROOTS.has(first)) {
    throw new ApiError(400, "UNSUPPORTED_CHAT_EDIT_TARGET", "Chat external edits cannot modify source code, config, or arbitrary project files.");
  }
  if (rel.includes("/.inkos/") || rel.endsWith("/.inkos") || rel.includes("/secrets") || rel.endsWith(".env")) {
    throw new ApiError(400, "UNSUPPORTED_CHAT_EDIT_TARGET", "Chat external edits cannot modify secrets or runtime internals.");
  }
  if (!CHAT_EDIT_TEXT_EXTENSIONS.test(rel)) {
    throw new ApiError(400, "UNSUPPORTED_CHAT_EDIT_TARGET", "Chat external edits only support text content files.");
  }
  return { path: resolved, rel };
}

/**
 * Extract dialogue lines attributable to a specific character from chapter content.
 * Matches patterns like:
 * - "角色名：" (Chinese colon), "角色名：" (fullwidth colon), "角色名："
 * - 「对话内容」 preceded by character name mentions
 * - 角色名 followed by dialogue-like text
 */

// P1-12: Cache compiled regex patterns keyed by escaped name
const dialogueRegexCache = new Map<string, ReadonlyArray<RegExp>>();
function getCachedDialogueRegex(escaped: string): ReadonlyArray<RegExp> {
  const cached = dialogueRegexCache.get(escaped);
  if (cached) return cached;
  const patterns = [
    new RegExp(`${escaped}[：:"：]\\s*["「](.+?)["」]`, "g"),
    new RegExp(`["「]${escaped}(.+?)["」]`, "g"),
    new RegExp(`${escaped}[说问道喊叫嚷叹答]\\s*[：:"：]\\s*(.+?)(?:[。！？!?]|$)`, "g"),
  ];
  // Limit cache size
  if (dialogueRegexCache.size > 100) {
    dialogueRegexCache.delete(dialogueRegexCache.keys().next().value!);
  }
  dialogueRegexCache.set(escaped, patterns);
  return patterns;
}

function extractCharacterDialogue(content: string, characterId: string, characterName: string): string[] {
  const lines: string[] = [];
  const names = [characterName, characterId].filter(Boolean);
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const regex of getCachedDialogueRegex(escaped)) {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const dialogue = match[1]!.trim();
        if (dialogue.length > 1 && dialogue.length < 200) {
          lines.push(dialogue);
        }
      }
    }
  }
  return [...new Set(lines)].slice(0, 50); // Dedup, cap at 50
}

async function findChapterFile(root: string, bookId: string, chapterNumber: number): Promise<string | null> {
  const chaptersDir = join(root, "books", bookId, "chapters");
  const padded = String(chapterNumber).padStart(4, "0");
  const files = await readdir(chaptersDir).catch(() => []);
  const match = files.find((file) => file.startsWith(`${padded}_`) && file.endsWith(".md"));
  return match ? join(chaptersDir, match) : null;
}

function parseBookChapterFromRelativePath(rel: string): { bookId: string; chapterNumber: number } | null {
  const match = rel.match(/^books\/([^/]+)\/chapters\/(\d{4})_[^/]+\.md$/);
  if (!match?.[1] || !match[2]) return null;
  const chapterNumber = Number.parseInt(match[2], 10);
  return Number.isInteger(chapterNumber) ? { bookId: match[1], chapterNumber } : null;
}

async function syncExternalChapterEdit(params: {
  readonly state: StateManager;
  readonly root: string;
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly content: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const index = [...(await params.state.loadChapterIndex(params.bookId))];
  const updated = index.map((chapter) => chapter.number === params.chapterNumber
    ? {
        ...chapter,
        status: "audit-failed" as const,
        wordCount: countContentUnits(params.content),
        updatedAt: now,
        auditIssues: [
          ...chapter.auditIssues.filter((issue) => issue !== CHAT_EDIT_WARNING),
          CHAT_EDIT_WARNING,
        ],
      }
    : chapter);
  if (updated.length > 0) {
    await params.state.saveChapterIndex(params.bookId, updated);
  }

  const runtimeDir = join(params.root, "books", params.bookId, "story", "runtime");
  const padded = String(params.chapterNumber).padStart(4, "0");
  const runtimeFiles = await readdir(runtimeDir).catch(() => []);
  await Promise.all(
    runtimeFiles
      .filter((file) => file.startsWith(`chapter-${padded}.`))
      .map((file) => rm(join(runtimeDir, file), { force: true })),
  );
}

async function tryHandleExternalChatEdit(params: {
  readonly root: string;
  readonly state: StateManager;
  readonly instruction: string;
  readonly activeBookId: string | null;
}): Promise<ExternalChatEditResult | null> {
  const replacement = parseReplacementInstruction(params.instruction);
  if (!replacement) return null;

  const explicitPath = parseExplicitEditPath(params.instruction);
  if (explicitPath) {
    const target = resolveExternalChatEditPath(params.root, explicitPath);
    const content = await readFile(target.path, "utf-8").catch((error) => {
      throw new ApiError(404, "CHAT_EDIT_TARGET_NOT_FOUND", error instanceof Error ? error.message : String(error));
    });
    const first = content.indexOf(replacement.oldText);
    if (first === -1) {
      throw new ApiError(400, "EDIT_TARGET_NOT_FOUND", "要替换的原文没有在目标文件中找到。");
    }
    if (content.indexOf(replacement.oldText, first + replacement.oldText.length) !== -1) {
      throw new ApiError(400, "EDIT_TARGET_AMBIGUOUS", "要替换的原文出现多次，请给出更具体的一段。");
    }
    const updated = content.slice(0, first) + replacement.newText + content.slice(first + replacement.oldText.length);
    await writeFile(target.path, updated, "utf-8");

    const chapterTarget = parseBookChapterFromRelativePath(target.rel);
    if (chapterTarget) {
      await syncExternalChapterEdit({
        state: params.state,
        root: params.root,
        bookId: chapterTarget.bookId,
        chapterNumber: chapterTarget.chapterNumber,
        content: updated,
      });
    }

    return {
      activeBookId: chapterTarget?.bookId ?? params.activeBookId ?? undefined,
      responseText: `已直接编辑 ${target.rel}${chapterTarget ? "，并标记为需要复核" : ""}。`,
    };
  }

  if (!params.activeBookId) return null;
  const chapterNumber = parseChapterNumberForEdit(params.instruction);
  if (!replacement || !chapterNumber) return null;

  const chapterPath = await findChapterFile(params.root, params.activeBookId, chapterNumber);
  if (!chapterPath) {
    throw new ApiError(404, "CHAPTER_NOT_FOUND", `Chapter ${chapterNumber} not found in ${params.activeBookId}`);
  }
  if (!CHAT_EDIT_TEXT_EXTENSIONS.test(chapterPath)) {
    throw new ApiError(400, "UNSUPPORTED_EDIT_TARGET", "Chat external edits only support text files.");
  }

  const content = await readFile(chapterPath, "utf-8");
  const first = content.indexOf(replacement.oldText);
  if (first === -1) {
    throw new ApiError(400, "EDIT_TARGET_NOT_FOUND", "要替换的原文没有在目标章节中找到。");
  }
  if (content.indexOf(replacement.oldText, first + replacement.oldText.length) !== -1) {
    throw new ApiError(400, "EDIT_TARGET_AMBIGUOUS", "要替换的原文出现多次，请给出更具体的一段。");
  }

  const updated = content.slice(0, first) + replacement.newText + content.slice(first + replacement.oldText.length);
  await writeFile(chapterPath, updated, "utf-8");
  await syncExternalChapterEdit({
    state: params.state,
    root: params.root,
    bookId: params.activeBookId,
    chapterNumber,
    content: updated,
  });

  return {
    activeBookId: params.activeBookId,
    responseText: `已直接编辑 ${params.activeBookId} 第 ${chapterNumber} 章，并标记为需要复核。`,
  };
}

function looksLikeBookCreatedClaim(responseText: string): boolean {
  return /(?:已|已经|成功).{0,12}(?:创建|建书|初始化|保存).{0,12}(?:作品|书|书籍|文件夹)?/.test(responseText)
    || /\b(?:created|initiali[sz]ed|saved)\b.{0,40}\b(?:book|project|novel)\b/i.test(responseText);
}

function validateAgentActionExecution(args: {
  readonly instruction: string;
  readonly agentBookId: string | null | undefined;
  readonly responseText: string;
  readonly collectedToolExecs: ReadonlyArray<CollectedToolExec>;
}): string | undefined {
  const failedExec = args.collectedToolExecs.find(isLikelyFailedToolResult);
  if (failedExec) {
    return `${failedExec.label} 执行失败：${failedExec.error ?? failedExec.result ?? "未知错误"}`;
  }

  if (
    args.agentBookId
    && isWriteNextInstruction(args.instruction)
    && !hasSuccessfulSubAgentExec(args.collectedToolExecs, "writer")
  ) {
    return "模型声称已完成下一章，但没有实际调用写作工具。请重试；如果仍失败，请检查模型是否支持工具调用。";
  }

  if (
    !args.agentBookId
    && looksLikeBookCreatedClaim(args.responseText)
    && !resolveCreatedBookIdFromToolExecs(args.collectedToolExecs)
  ) {
    return "模型声称已创建作品，但没有实际调用建书工具，也没有生成作品文件。请补充书名/题材后重试，或换用支持工具调用的模型。";
  }

  return undefined;
}

interface CollectedToolExec {
  id: string;
  tool: string;
  agent?: string;
  label: string;
  status: "running" | "completed" | "error";
  args?: Record<string, unknown>;
  result?: string;
  details?: unknown;
  error?: string;
  stages?: Array<{ label: string; status: "pending" | "completed" }>;
  startedAt: number;
  completedAt?: number;
}

interface StudioBookListSummary {
  readonly id: string;
  readonly title: string;
  readonly genre: string;
  readonly status: string;
  readonly chaptersWritten: number;
  readonly [key: string]: unknown;
}

function normalizeStudioBookConfig(
  bookId: string,
  book: Record<string, unknown>,
): Record<string, unknown> & { id: string; title: string; genre: string; status: string } {
  const title =
    typeof book.title === "string" && book.title.trim()
      ? book.title
      : typeof book.name === "string" && book.name.trim()
        ? book.name
        : bookId;
  const name = title;
  const genre =
    typeof book.genre === "string" && book.genre.trim()
      ? book.genre
      : typeof book.genreProfileId === "string" && book.genreProfileId.trim()
        ? book.genreProfileId
        : "other";
  const genreProfileId = genre;

  return {
    ...book,
    id: bookId,
    title,
    name,
    genre,
    genreProfileId,
    status: typeof book.status === "string" && book.status.trim() ? book.status : "active",
  };
}

// --- withPipeline & Write job tracker ---
// (extracted to shared/pipeline.ts and shared/write-jobs.ts)

// --- Event bus for SSE ---

type EventHandler = (event: string, data: unknown) => void;
const subscribers = new Set<EventHandler>();
const bookCreateStatus = new Map<string, {
  status: "queued" | "creating" | "completed" | "failed";
  error?: string;
  phase?: string;
  createdAt: number;
  /** 完成/失败后保留状态的时长（ms） */
  ttlMs: number;
}>();
const BOOK_CREATE_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟超时
const BOOK_CREATE_TTL_MS = 60 * 1000; // 完成后保留 60 秒
const BOOK_CREATE_IN_PROGRESS_TTL_MS = BOOK_CREATE_TIMEOUT_MS + 60 * 1000; // queued/creating 状态保留到创建超时后再加 1 分钟缓冲

// 定期清理过期状态（保存 timer 引用以便进程退出时清理）
const bookCreateCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, st] of bookCreateStatus) {
    if (now - st.createdAt > st.ttlMs) {
      bookCreateStatus.delete(id);
    }
  }
}, 30_000);

// 进程退出时主动清理 timer
process.once("beforeExit", () => clearInterval(bookCreateCleanupTimer));

// 内存缓存：service -> 模型列表 + 更新时间戳；避免每次 sidebar 挂载时都打真实 LLM /models
const modelListCache = new Map<string, { models: Array<{ id: string; name: string }>; at: number }>();

interface ServiceConfigEntry {
  service: string;
  name?: string;
  baseUrl?: string;
  temperature?: number;
  apiFormat?: "chat" | "responses";
  stream?: boolean;
  /** 写作参数透传（top_p / presence_penalty / frequency_penalty / seed / repetition_penalty） */
  extra?: Record<string, unknown>;
}

type LLMConfigSource = "env" | "studio";

interface EnvConfigSummary {
  detected: boolean;
  provider: string | null;
  baseUrl: string | null;
  model: string | null;
  hasApiKey: boolean;
}

interface EnvConfigStatus {
  project: EnvConfigSummary;
  global: EnvConfigSummary;
  effectiveSource: "project" | "global" | null;
  runtimeUsesEnv: false;
}

interface ServiceProbeResult {
  ok: boolean;
  models: Array<{ id: string; name: string }>;
  selectedModel?: string;
  apiFormat?: "chat" | "responses";
  stream?: boolean;
  baseUrl?: string;
  modelsSource?: "api" | "fallback";
  error?: string;
}

function broadcast(event: string, data: unknown): void {
  for (const handler of subscribers) {
    handler(event, data);
  }
}

function deriveBookIdFromTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

function resolveArchitectBookIdFromArgs(args?: Record<string, unknown>): string | null {
  if (!args || args.agent !== "architect" || args.revise === true) return null;
  if (typeof args.bookId === "string" && args.bookId.trim()) return args.bookId.trim();
  if (typeof args.title === "string" && args.title.trim()) {
    return deriveBookIdFromTitle(args.title) || null;
  }
  return null;
}

function resolveCreatedBookIdFromToolExecs(execs: ReadonlyArray<CollectedToolExec>): string | null {
  for (let i = execs.length - 1; i >= 0; i -= 1) {
    const exec = execs[i];
    if (exec.tool !== "sub_agent" || exec.agent !== "architect" || exec.status !== "completed") continue;

    const details = exec.details as { kind?: unknown; bookId?: unknown } | undefined;
    if (details?.kind === "book_created" && typeof details.bookId === "string" && details.bookId.trim()) {
      return details.bookId.trim();
    }

    const fromArgs = resolveArchitectBookIdFromArgs(exec.args);
    if (fromArgs) return fromArgs;
  }
  return null;
}

async function loadStudioBookListSummary(
  state: StateManager,
  bookId: string,
): Promise<StudioBookListSummary> {
  const book = normalizeStudioBookConfig(bookId, await state.loadBookConfig(bookId) as Record<string, unknown>);
  const nextChapter = await state.getNextChapterNumber(bookId);
  return { ...book, chaptersWritten: nextChapter - 1 };
}

function isCustomServiceId(serviceId: string): boolean {
  return serviceId === "custom" || serviceId.startsWith("custom:");
}

function serviceConfigKey(entry: ServiceConfigEntry): string {
  return entry.service === "custom" ? `custom:${entry.name ?? "Custom"}` : entry.service;
}

function normalizeServiceEntry(serviceId: string, value: Record<string, unknown>): ServiceConfigEntry {
  // 通用 extra 提取：透传写作参数（top_p / presence_penalty / frequency_penalty / seed / repetition_penalty）
  const extra = value.extra && typeof value.extra === "object" && !Array.isArray(value.extra)
    ? (value.extra as Record<string, unknown>)
    : undefined;
  const extraSpread = extra && Object.keys(extra).length > 0 ? { extra } : {};

  if (serviceId.startsWith("custom:")) {
    return {
      service: "custom",
      name: decodeURIComponent(serviceId.slice("custom:".length)),
      ...(typeof value.baseUrl === "string" && value.baseUrl.length > 0 ? { baseUrl: value.baseUrl } : {}),
      ...(typeof value.temperature === "number" ? { temperature: value.temperature } : {}),
      ...(value.apiFormat === "chat" || value.apiFormat === "responses" ? { apiFormat: value.apiFormat } : {}),
      ...(typeof value.stream === "boolean" ? { stream: value.stream } : {}),
      ...extraSpread,
    };
  }

  if (serviceId === "custom") {
    return {
      service: "custom",
      ...(typeof value.name === "string" && value.name.length > 0 ? { name: value.name } : {}),
      ...(typeof value.baseUrl === "string" && value.baseUrl.length > 0 ? { baseUrl: value.baseUrl } : {}),
      ...(typeof value.temperature === "number" ? { temperature: value.temperature } : {}),
      ...(value.apiFormat === "chat" || value.apiFormat === "responses" ? { apiFormat: value.apiFormat } : {}),
      ...(typeof value.stream === "boolean" ? { stream: value.stream } : {}),
      ...extraSpread,
    };
  }

  return {
    service: serviceId,
    ...(typeof value.temperature === "number" ? { temperature: value.temperature } : {}),
    ...(value.apiFormat === "chat" || value.apiFormat === "responses" ? { apiFormat: value.apiFormat } : {}),
    ...(typeof value.stream === "boolean" ? { stream: value.stream } : {}),
    ...extraSpread,
  };
}

function normalizeConfigSource(value: unknown): LLMConfigSource {
  return value === "studio" ? "studio" : "env";
}

function normalizeServiceConfig(raw: unknown): ServiceConfigEntry[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry) => ({
        service: typeof entry.service === "string" && entry.service.length > 0 ? entry.service : "custom",
        ...(typeof entry.name === "string" && entry.name.length > 0 ? { name: entry.name } : {}),
        ...(typeof entry.baseUrl === "string" && entry.baseUrl.length > 0 ? { baseUrl: entry.baseUrl } : {}),
        ...(typeof entry.temperature === "number" ? { temperature: entry.temperature } : {}),
        ...(entry.apiFormat === "chat" || entry.apiFormat === "responses" ? { apiFormat: entry.apiFormat } : {}),
        ...(typeof entry.stream === "boolean" ? { stream: entry.stream } : {}),
        // ✅ 写作参数透传（top_p / presence_penalty / frequency_penalty / seed / repetition_penalty）
        ...(entry.extra && typeof entry.extra === "object" && !Array.isArray(entry.extra)
          ? { extra: entry.extra as Record<string, unknown> }
          : {}),
      }));
  }

  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([, value]) => value && typeof value === "object")
      .map(([serviceId, value]) => normalizeServiceEntry(serviceId, value as Record<string, unknown>));
  }

  return [];
}

function mergeServiceConfig(existing: ServiceConfigEntry[], updates: ServiceConfigEntry[]): ServiceConfigEntry[] {
  const merged = new Map(existing.map((entry) => [serviceConfigKey(entry), entry]));
  for (const update of updates) {
    merged.set(serviceConfigKey(update), update);
  }
  return [...merged.values()];
}

function normalizeCoverConfig(raw: unknown): { service: string; model: string } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const service = typeof record.service === "string" ? record.service : "";
  const preset = resolveCoverProviderPreset(service);
  if (!preset) return undefined;
  const requestedModel = typeof record.model === "string" ? record.model.trim() : "";
  const model = requestedModel && preset.models.includes(requestedModel)
    ? requestedModel
    : preset.defaultModel;
  return { service: preset.service, model };
}

function syncTopLevelLlmMirror(llm: Record<string, unknown>): void {
  const selectedService = typeof llm.service === "string" ? llm.service : undefined;
  if (!selectedService) return;

  const services = normalizeServiceConfig(llm.services);
  const selectedEntry = services.find((entry) => serviceConfigKey(entry) === selectedService)
    ?? (!isCustomServiceId(selectedService) ? { service: selectedService } : undefined);
  if (!selectedEntry) return;

  const preset = resolveServicePreset(selectedEntry.service);
  llm.provider = resolveServiceProviderFamily(selectedEntry.service) ?? "openai";
  llm.baseUrl = selectedEntry.baseUrl ?? preset?.baseUrl ?? "";

  const defaultModel = typeof llm.defaultModel === "string" ? llm.defaultModel.trim() : "";
  if (defaultModel) llm.model = defaultModel;
  if (selectedEntry.temperature !== undefined) llm.temperature = selectedEntry.temperature;
  if (selectedEntry.apiFormat !== undefined) llm.apiFormat = selectedEntry.apiFormat;
  if (selectedEntry.stream !== undefined) llm.stream = selectedEntry.stream;
  // ✅ 同步写作参数到顶层（top_p / presence_penalty / frequency_penalty / seed / repetition_penalty）
  if (selectedEntry.extra !== undefined && typeof selectedEntry.extra === "object") {
    const existingExtra = llm.extra && typeof llm.extra === "object" && !Array.isArray(llm.extra)
      ? (llm.extra as Record<string, unknown>)
      : {};
    llm.extra = { ...existingExtra, ...selectedEntry.extra };
  }
}

// P1-2: mtime-based config cache — avoids re-reading inkos.json on every service probe
const rawConfigCache = new Map<string, { mtimeMs: number; config: Record<string, unknown> }>();
const RAW_CONFIG_CACHE_MAX = 10;

async function loadRawConfig(root: string): Promise<Record<string, unknown>> {
  const configPath = join(root, "inkos.json");
  try {
    const fileStat = await stat(configPath);
    const cached = rawConfigCache.get(root);
    if (cached && cached.mtimeMs === fileStat.mtimeMs) {
      return cached.config;
    }

    const raw = await readFile(configPath, "utf-8");
    if (!raw.trim()) {
      throw new SyntaxError("inkos.json is empty");
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (rawConfigCache.size >= RAW_CONFIG_CACHE_MAX && !rawConfigCache.has(root)) {
      rawConfigCache.delete(rawConfigCache.keys().next().value!);
    }
    rawConfigCache.set(root, { mtimeMs: fileStat.mtimeMs, config: parsed });
    return parsed;
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new ApiError(400, "INVALID_CONFIG", `inkos.json parse error: ${e.message}. Check the file at ${configPath} for syntax issues.`);
    }
    throw e;
  }
}

async function assertBookExists(state: StateManager, id: string): Promise<void> {
  try {
    await state.loadBookConfig(id);
  } catch {
    throw new ApiError(404, "BOOK_NOT_FOUND", `Book not found: ${id}`);
  }
}

async function assertBookDirectoryExists(state: StateManager, id: string): Promise<void> {
  try {
    const info = await lstat(state.bookDir(id));
    if (!info.isDirectory()) {
      throw new Error("not a directory");
    }
  } catch {
    throw new ApiError(404, "BOOK_NOT_FOUND", `Book not found: ${id}`);
  }
}

async function saveRawConfig(root: string, config: Record<string, unknown>): Promise<void> {
  const configPath = join(root, "inkos.json");
  const tmpPath = configPath + ".tmp." + Date.now().toString(36);
  const { rename: renameFile } = await import("node:fs/promises");
  await writeFile(tmpPath, JSON.stringify(config, null, 2), "utf-8");
  await renameFile(tmpPath, configPath);
}

async function readEnvConfigSummary(path: string): Promise<EnvConfigSummary> {
  try {
    const raw = await readFile(path, "utf-8");
    const values = new Map<string, string>();

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, value] = match;
      values.set(key, value.trim());
    }

    const provider = values.get("INKOS_LLM_PROVIDER") ?? null;
    const baseUrl = values.get("INKOS_LLM_BASE_URL") ?? null;
    const model = values.get("INKOS_LLM_MODEL") ?? null;
    const apiKey = values.get("INKOS_LLM_API_KEY") ?? "";
    const detected = Boolean(provider || baseUrl || model || apiKey);

    return {
      detected,
      provider,
      baseUrl,
      model,
      hasApiKey: apiKey.length > 0,
    };
  } catch {
    return {
      detected: false,
      provider: null,
      baseUrl: null,
      model: null,
      hasApiKey: false,
    };
  }
}

async function readEnvConfigStatus(root: string): Promise<EnvConfigStatus> {
  const project = await readEnvConfigSummary(join(root, ".env"));
  const global = await readEnvConfigSummary(GLOBAL_ENV_PATH);
  return {
    project,
    global,
    effectiveSource: project.detected ? "project" : global.detected ? "global" : null,
    runtimeUsesEnv: false,
  };
}

async function resolveConfiguredServiceBaseUrl(root: string, serviceId: string, inlineBaseUrl?: string): Promise<string | undefined> {
  if (inlineBaseUrl?.trim()) return inlineBaseUrl.trim();

  if (!isCustomServiceId(serviceId)) {
    return resolveServicePreset(serviceId)?.baseUrl;
  }

  try {
    const config = await loadRawConfig(root);
    const services = normalizeServiceConfig((config.llm as Record<string, unknown> | undefined)?.services);
    const matched = services.find((entry) => serviceConfigKey(entry) === serviceId);
    return matched?.baseUrl;
  } catch {
    return undefined;
  }
}

async function resolveConfiguredServiceEntry(root: string, serviceId: string): Promise<ServiceConfigEntry | undefined> {
  try {
    const config = await loadRawConfig(root);
    const services = normalizeServiceConfig((config.llm as Record<string, unknown> | undefined)?.services);
    return services.find((entry) => serviceConfigKey(entry) === serviceId);
  } catch {
    return undefined;
  }
}

function buildProbePlans(
  preferredApiFormat: "chat" | "responses" | undefined,
  preferredStream: boolean | undefined,
): Array<{ apiFormat: "chat" | "responses"; stream: boolean }> {
  const candidates: Array<{ apiFormat: "chat" | "responses"; stream: boolean }> = [];
  const seen = new Set<string>();
  const push = (apiFormat: "chat" | "responses", stream: boolean) => {
    const key = `${apiFormat}:${stream ? "1" : "0"}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ apiFormat, stream });
  };

  if (preferredApiFormat) {
    push(preferredApiFormat, preferredStream ?? false);
    if (preferredStream) push(preferredApiFormat, false);
    return candidates;
  }

  push("chat", false);
  push("responses", false);
  return candidates;
}

function buildModelCandidates(args: {
  preferredModel?: string;
  configModel?: string;
  envModel?: string | null;
  discoveredModels: Array<{ id: string; name: string }>;
  includeGenericFallbacks?: boolean;
}): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  const push = (value: string | null | undefined) => {
    if (!value || value.trim().length === 0) return;
    const id = value.trim();
    if (seen.has(id)) return;
    seen.add(id);
    candidates.push(id);
  };

  push(args.preferredModel);
  push(args.configModel);
  push(args.envModel ?? undefined);
  for (const model of args.discoveredModels.slice(0, MAX_DISCOVERED_MODELS_TO_PING)) push(model.id);
  if (args.includeGenericFallbacks === false) return candidates;
  for (const fallback of [
    "gpt-5.4",
    "gpt-4o",
    "claude-sonnet-4-6",
    "MiniMax-M2.7",
    "kimi-k2.5",
  ].slice(0, MAX_GENERIC_FALLBACK_MODELS_TO_PING)) {
    push(fallback);
  }
  return candidates;
}

function yamlScalar(value: unknown): string {
  return JSON.stringify(String(value ?? ""));
}

function radarTimestampForFilename(value: string | undefined): string {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return safeDate.toISOString().replace(/[:.]/g, "-");
}

async function saveRadarScan(root: string, result: unknown): Promise<string> {
  const radarDir = join(root, "radar");
  await mkdir(radarDir, { recursive: true });
  const timestamp = typeof result === "object" && result !== null && "timestamp" in result
    ? String((result as { timestamp?: unknown }).timestamp ?? "")
    : "";
  const fileName = `scan-${radarTimestampForFilename(timestamp)}.json`;
  const filePath = join(radarDir, fileName);
  await writeFile(filePath, JSON.stringify(result, null, 2), "utf-8");
  return filePath;
}

async function loadRadarHistory(root: string): Promise<Array<{
  readonly file: string;
  readonly timestamp: string;
  readonly marketSummary: string;
  readonly summaryPreview: string;
  readonly result: unknown;
}>> {
  const radarDir = join(root, "radar");
  let files: string[] = [];
  try {
    files = await readdir(radarDir);
  } catch {
    return [];
  }

  const scans = await Promise.all(
    files
      .filter((file) => /^scan-.+\.json$/.test(file))
      .map(async (file) => {
        try {
          const raw = await readFile(join(radarDir, file), "utf-8");
          const result = JSON.parse(raw) as { timestamp?: unknown; marketSummary?: unknown };
          const timestamp = typeof result.timestamp === "string"
            ? result.timestamp
            : file.replace(/^scan-/, "").replace(/\.json$/, "");
          const marketSummary = typeof result.marketSummary === "string" ? result.marketSummary : "";
          return {
            file,
            timestamp,
            marketSummary,
            summaryPreview: marketSummary.slice(0, 100),
            result,
          };
        } catch {
          return null;
        }
      }),
  );

  return scans
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.file.localeCompare(a.file));
}

function fallbackTextModelsForEndpoint(
  endpoint: ReturnType<typeof getAllEndpoints>[number] | undefined,
  preset: ReturnType<typeof resolveServicePreset> | undefined,
): Array<{ id: string; name: string }> {
  const endpointModels = endpoint?.models
    .filter((model) => model.enabled !== false)
    .filter((model) => isTextChatModelId(model.id))
    .map((model) => ({ id: model.id, name: model.id }))
    ?? [];
  if (endpointModels.length > 0) return endpointModels;
  return preset?.knownModels?.map((id) => ({ id, name: id })) ?? [];
}

function shouldTrustStaticModelsWhenLiveListUnavailable(endpoint: ReturnType<typeof getAllEndpoints>[number] | undefined): boolean {
  return endpoint?.group === "aggregator";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} 超时（${timeoutMs}ms）`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function formatServiceProbeError(args: {
  readonly service: string;
  readonly label?: string;
  readonly baseUrl: string;
  readonly model?: string;
  readonly apiFormat?: "chat" | "responses";
  readonly stream?: boolean;
  readonly error: string;
}): string {
  const rawDetail = args.error
    .replace(/\n\s*\(baseUrl:[\s\S]*?\)$/m, "")
    .trim();
  const upstreamDetail = rawDetail.includes("上游详情：")
    ? rawDetail
    : "";
  const context = [
    `服务商：${args.label ?? args.service}`,
    `测试模型：${args.model ?? "未确定"}`,
    `协议：${args.apiFormat === "responses" ? "Responses" : "Chat / Completions"}${typeof args.stream === "boolean" ? `，${args.stream ? "流式" : "非流式"}` : ""}`,
    `Base URL：${args.baseUrl}`,
  ].join("\n");

  if (args.service === "google") {
    return [
      "Google Gemini 测试连接失败。",
      context,
      "",
      "请优先检查：",
      "1. API Key 是否来自 Google AI Studio 的 Gemini API key，而不是 OAuth、Vertex AI 或其它 Google 服务凭据。",
      "2. 该 key 所属项目是否已启用 Gemini API，并且没有被限制到其它 API、来源或服务。",
      "3. 当前地区/账号是否允许访问 Gemini API。",
      "4. 如果 key 曾经泄露，请在 AI Studio 重新生成后再保存。",
      upstreamDetail ? `\n上游返回：${upstreamDetail}` : "",
    ].filter(Boolean).join("\n");
  }

  if (args.service === "moonshot" || args.service === "kimiCodingPlan" || args.service === "kimicode") {
    return [
      `${args.label ?? args.service} 测试连接失败。`,
      context,
      "",
      "请优先检查模型是否可用，以及 kimi-k2.x 这类模型是否需要 temperature=1。",
      rawDetail ? `\n上游返回：${rawDetail}` : "",
    ].filter(Boolean).join("\n");
  }

  return [
    `${args.label ?? args.service} 测试连接失败。`,
    context,
    "",
    "请检查 API Key、模型可用性、账号额度，以及协议类型是否匹配该服务商。",
    rawDetail ? `\n上游返回：${rawDetail}` : "",
  ].filter(Boolean).join("\n");
}

async function fetchModelsFromServiceBaseUrl(
  serviceId: string,
  baseUrl: string,
  apiKey: string,
  proxyUrl?: string,
): Promise<{ models: Array<{ id: string; name: string }>; error?: string; authFailed?: boolean }> {
  const endpoint = isCustomServiceId(serviceId)
    ? undefined
    : getAllEndpoints().find((ep) => ep.id === serviceId);
  const modelsBaseUrl = isCustomServiceId(serviceId)
    ? baseUrl
    : endpoint?.modelsBaseUrl ?? (endpoint ? baseUrl : resolveServiceModelsBaseUrl(serviceId) ?? baseUrl);
  const modelsUrl = modelsBaseUrl.replace(/\/$/, "") + "/models";
  try {
    const res = await fetchWithProxy(modelsUrl, {
      headers: buildBearerAuthHeaders(apiKey),
      signal: AbortSignal.timeout(SERVICE_MODELS_PROBE_TIMEOUT_MS),
    }, proxyUrl);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (serviceId === "moonshot") {
        return {
          models: [],
          error: formatMoonshotAuthenticationError(res.status, body),
          authFailed: res.status === 401 || res.status === 403,
        };
      }
      return {
        models: [],
        error: `服务商返回 ${res.status}: ${body.slice(0, 200)}`,
        authFailed: res.status === 401 || res.status === 403,
      };
    }
    const json = await res.json() as { data?: Array<{ id: string }> };
    return {
      models: (json.data ?? []).map((m) => ({ id: m.id, name: m.id })),
    };
  } catch (error) {
    return {
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function formatMoonshotAuthenticationError(status: number, body: string): string {
  const detail = body.trim().slice(0, 500);
  return [
    `Moonshot/Kimi 认证失败（HTTP ${status}）。`,
    "请使用 Moonshot 开放平台生成的 API Key，不要使用 kimi.com 网页登录 token、Cookie 或会员兑换码。",
    "请打开 https://platform.moonshot.cn/console/api-keys，登录后创建或复制有效的 API Key，并且只粘贴原始密钥。",
    "项目预设 Base URL：https://api.moonshot.cn/v1",
    detail ? `服务商原始返回：${detail}` : "",
  ].filter(Boolean).join("\n");
}

function buildBearerAuthHeaders(apiKey: string | undefined): Record<string, string> {
  const trimmed = apiKey?.trim() ?? "";
  if (!trimmed) return {};
  if (!/^[\x20-\x7e]+$/.test(trimmed)) {
    throw new Error("API Key 只能包含英文、数字和常见 ASCII 符号，请检查是否误粘贴了中文说明。");
  }
  return { Authorization: `Bearer ${trimmed}` };
}

async function probeServiceCapabilities(args: {
  root: string;
  service: string;
  apiKey: string;
  baseUrl: string;
  preferredApiFormat?: "chat" | "responses";
  preferredStream?: boolean;
  preferredModel?: string;
  proxyUrl?: string;
}): Promise<ServiceProbeResult> {
  const rawConfig = await loadRawConfig(args.root).catch(() => ({} as Record<string, unknown>));
  const llm = (rawConfig.llm as Record<string, unknown> | undefined) ?? {};
  const envConfig = await readEnvConfigStatus(args.root);
  const envModel = envConfig.effectiveSource === "project"
    ? envConfig.project.model
    : envConfig.effectiveSource === "global"
      ? envConfig.global.model
      : null;

  const baseService = isCustomServiceId(args.service) ? "custom" : args.service;
  const modelsResponse = await fetchModelsFromServiceBaseUrl(baseService, args.baseUrl, args.apiKey, args.proxyUrl);
  if (modelsResponse.authFailed) {
    return {
      ok: false,
      models: [],
      error: modelsResponse.error ?? "API Key 无效或无权访问模型列表。",
    };
  }
  const discoveredModels = filterTextChatModels(modelsResponse.models);
  const endpoint = getAllEndpoints().find((ep) => ep.id === baseService);
  const preset = resolveServicePreset(baseService);
  const discoveredFirstModel =
    discoveredModels.find((model) => isTextChatModelId(model.id))?.id
    ?? discoveredModels[0]?.id;
  if (modelsResponse.models.length > 0) {
    if (!discoveredFirstModel || !isTextChatModelId(discoveredFirstModel)) {
      return {
        ok: false,
        models: [],
        error: "模型列表可访问，但没有发现可用于文本对话的模型。",
      };
    }
    return {
      ok: true,
      models: discoveredModels,
      selectedModel: discoveredFirstModel,
      apiFormat: args.preferredApiFormat ?? "chat",
      stream: args.preferredStream ?? false,
      baseUrl: args.baseUrl,
      modelsSource: "api",
    };
  }
  if (shouldTrustStaticModelsWhenLiveListUnavailable(endpoint)) {
    const models = fallbackTextModelsForEndpoint(endpoint, preset);
    const selectedModel =
      endpoint?.checkModel && models.some((model) => model.id === endpoint.checkModel)
        ? endpoint.checkModel
        : models[0]?.id;
    if (selectedModel) {
      return {
        ok: true,
        models,
        selectedModel,
        apiFormat: args.preferredApiFormat ?? "chat",
        stream: args.preferredStream ?? false,
        baseUrl: args.baseUrl,
        modelsSource: "fallback",
      };
    }
  }
  // Prefer live /models results; if unavailable, probe with the service's own check model before global defaults.
  const serviceFirstModel =
    endpoint?.checkModel
    ?? preset?.knownModels?.[0]
    ?? endpoint?.models.find((model) => model.enabled !== false)?.id;
  const useDynamicLocalModels = baseService === "ollama";
  const useEndpointCheckModel = !useDynamicLocalModels
    && !isCustomServiceId(args.service)
    && discoveredModels.length === 0
    && Boolean(endpoint?.checkModel);
  const configService = typeof llm.service === "string" ? llm.service : undefined;
  const configModel = !useEndpointCheckModel && configService === args.service
    ? typeof llm.defaultModel === "string"
      ? llm.defaultModel
      : typeof llm.model === "string"
        ? llm.model
        : undefined
    : undefined;
  const useCustomFallbacks = false;
  const modelCandidates = buildModelCandidates({
    preferredModel: args.preferredModel ?? serviceFirstModel,
    configModel,
    envModel: useCustomFallbacks ? envModel : undefined,
    discoveredModels: useEndpointCheckModel ? [] : discoveredModels,
    includeGenericFallbacks: useCustomFallbacks,
  });

  if (modelCandidates.length === 0) {
    return {
      ok: false,
      models: [],
      error: "无法自动确定模型，请先填写可用模型或提供支持 /models 的服务端点。",
    };
  }

  let lastError = modelsResponse.error ?? "自动探测失败";

  for (const model of modelCandidates) {
    for (const plan of buildProbePlans(args.preferredApiFormat, args.preferredStream)) {
      const client = createLLMClient({
        provider: resolveServiceProviderFamily(baseService) ?? "openai",
        service: baseService,
        configSource: "studio",
        baseUrl: args.baseUrl,
        apiKey: args.apiKey.trim(),
        model,
        temperature: 0.7,
        maxTokens: 16,
        thinkingBudget: 0,
        proxyUrl: args.proxyUrl,
        apiFormat: plan.apiFormat,
        stream: plan.stream,
      } as ProjectConfig["llm"]);

      try {
        await withTimeout(
          chatCompletion(client, model, [{ role: "user", content: "Reply with OK only." }], { maxTokens: 16 }),
          SERVICE_CHAT_PROBE_TIMEOUT_MS,
          "service connection test",
        );
        const models = discoveredModels.length > 0
          ? discoveredModels
          : fallbackTextModelsForEndpoint(endpoint, preset);
        return {
          ok: true,
          models: models.length > 0 ? models : [{ id: model, name: model }],
          selectedModel: model,
          apiFormat: plan.apiFormat,
          stream: plan.stream,
          baseUrl: args.baseUrl,
          modelsSource: discoveredModels.length > 0 ? "api" : "fallback",
        };
      } catch (error) {
        lastError = formatServiceProbeError({
          service: baseService,
          label: endpoint?.label ?? preset?.label,
          baseUrl: args.baseUrl,
          model,
          apiFormat: plan.apiFormat,
          stream: plan.stream,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    ok: false,
    models: discoveredModels,
    error: lastError,
  };
}

// --- Server factory ---

// Foundation plan persistence directory
const PLANS_DIR = ".inkos/plans";

async function loadPersistedFoundationPlans(root: string): Promise<Map<string, FoundationPlanEntry>> {
  const plans = new Map<string, FoundationPlanEntry>();
  const plansDir = join(root, PLANS_DIR);
  try {
    const files = await readdir(plansDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(plansDir, file), "utf-8");
        const entry = JSON.parse(raw) as FoundationPlanEntry;
        if (entry.expiresAt > Date.now()) {
          plans.set(file.replace(/\.json$/, ""), entry);
        }
      } catch {
        // Skip corrupted files
      }
    }
  } catch {
    // Directory doesn't exist yet
  }
  return plans;
}

async function persistFoundationPlan(root: string, planId: string, entry: FoundationPlanEntry): Promise<void> {
  const plansDir = join(root, PLANS_DIR);
  await mkdir(plansDir, { recursive: true }).catch(() => {});
  await writeFile(join(plansDir, `${planId}.json`), JSON.stringify(entry), "utf-8");
}

async function removePersistedFoundationPlan(root: string, planId: string): Promise<void> {
  await rm(join(root, PLANS_DIR, `${planId}.json`), { force: true }).catch(() => {});
}

interface FoundationPlanEntry {
  readonly bookId: string;
  readonly mode: "supplement" | "rebuild";
  readonly proposed: ArchitectOutput;
  readonly foundationRevision: string;
  readonly sourceBundle: FoundationSourceBundle;
  readonly expiresAt: number;
}

export function createStudioServer(initialConfig: ProjectConfig, root: string) {
  const app = new Hono();
  // Load persisted plans on startup; expired ones are filtered out automatically
  const foundationPlans = new Map<string, FoundationPlanEntry>();
  let foundationPlansLoaded = false;
  const foundationPlansPromise = loadPersistedFoundationPlans(root)
    .then((loaded) => {
      for (const [id, entry] of loaded) foundationPlans.set(id, entry);
      foundationPlansLoaded = true;
    })
    .catch((e) => {
      foundationPlansLoaded = true;
      console.error("[studio] Failed to load persisted foundation plans:", e);
    });
  const state = new StateManager(root);
  let cachedConfig = initialConfig;

  // CORS: only allow the Studio's own origin. When behind a proxy, set STUDIO_ORIGIN.
  const allowedOrigin = process.env.STUDIO_ORIGIN || "http://localhost:4577";
  app.use("/*", cors({ origin: allowedOrigin, credentials: true }));

  // P2-6: Request body size limit — prevent malicious large JSON payloads from OOM
  const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB
  app.use("/*", async (c, next) => {
    const contentLength = c.req.header("content-length");
    if (contentLength) {
      const len = Number(contentLength);
      if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
        return c.json({ error: { code: "PAYLOAD_TOO_LARGE", message: `Request body exceeds ${MAX_BODY_BYTES / 1024 / 1024}MB limit` } }, 413);
      }
    }
    await next();
  });

  // P2-10: API response time monitoring — logs requests exceeding threshold
  const SLOW_REQUEST_THRESHOLD_MS = 2000;
  app.use("/*", async (c, next) => {
    const start = Date.now();
    await next();
    const elapsed = Date.now() - start;
    if (elapsed > SLOW_REQUEST_THRESHOLD_MS) {
      console.warn(`[perf] ${c.req.method} ${c.req.path} took ${elapsed}ms`);
    }
  });

  // Structured error handler — ApiError returns typed JSON, others return 500
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status as 400);
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("LLM API key not set") || message.includes("INKOS_LLM_API_KEY not set")) {
      return c.json({ error: { code: "LLM_CONFIG_ERROR", message } }, 400);
    }
    console.error("[studio] Unexpected server error", error);
    return c.json(
      { error: { code: "INTERNAL_ERROR", message: "Unexpected server error." } },
      500,
    );
  });

  // BookId validation middleware — blocks path traversal on all book routes
  app.use("/api/v1/books/:id/*", async (c, next) => {
    const bookId = c.req.param("id");
    if (!isSafeBookId(bookId)) {
      throw new ApiError(400, "INVALID_BOOK_ID", `Invalid book ID: "${bookId}"`);
    }
    await next();
  });
  app.use("/api/v1/books/:id", async (c, next) => {
    const bookId = c.req.param("id");
    if (!isSafeBookId(bookId)) {
      throw new ApiError(400, "INVALID_BOOK_ID", `Invalid book ID: "${bookId}"`);
    }
    await next();
  });

  // Logger sink that broadcasts to SSE
  const sseSink: LogSink = {
    write(entry: LogEntry): void {
      broadcast("log", { level: entry.level, tag: entry.tag, message: entry.message });
    },
  };

  // Logger sink that prints to server terminal
  const consoleSink: LogSink = {
    write(entry: LogEntry): void {
      const prefix = `[${entry.tag}]`;
      if (entry.level === "warn") console.warn(prefix, entry.message);
      else if (entry.level === "error") console.error(prefix, entry.message);
      else console.log(prefix, entry.message);
    },
  };

  async function loadCurrentProjectConfig(
    options?: { readonly requireApiKey?: boolean },
  ): Promise<ProjectConfig> {
    const freshConfig = await loadProjectConfig(root, { ...options, consumer: "studio" });
    cachedConfig = freshConfig;
    return freshConfig;
  }

  async function buildPipelineConfig(
    overrides?: Partial<Pick<PipelineConfig, "externalContext" | "client" | "model">> & {
      readonly currentConfig?: ProjectConfig;
      readonly sessionIdForSSE?: string;
    },
  ): Promise<PipelineConfig> {
    const currentConfig = overrides?.currentConfig ?? await loadCurrentProjectConfig();
    const scopedSseSink: LogSink = overrides?.sessionIdForSSE
      ? {
          write(entry) {
            broadcast("log", {
              sessionId: overrides.sessionIdForSSE,
              level: entry.level,
              tag: entry.tag,
              message: entry.message,
            });
          },
        }
      : sseSink;
    const logger = createLogger({ tag: "studio", sinks: [scopedSseSink, consoleSink] });
    return {
      client: overrides?.client ?? createLLMClient(currentConfig.llm),
      model: overrides?.model ?? currentConfig.llm.model,
      projectRoot: root,
      defaultLLMConfig: currentConfig.llm,
      foundationReviewRetries: currentConfig.foundation?.reviewRetries ?? 2,
      writingReviewRetries: resolveWritingReviewRetries(
        currentConfig.writing?.reviewRetries ?? 1,
        currentConfig.writing?.qualityBudget ?? "economy",
      ),
      qualityBudget: currentConfig.writing?.qualityBudget ?? "economy",
      strictInterview: currentConfig.writing?.strictInterview ?? false,
      betaReaderMode: currentConfig.writing?.betaReaderMode ?? "off",
      betaReaderModelFamily: currentConfig.writing?.betaReaderModelFamily,
      modelOverrides: currentConfig.modelOverrides,
      notifyChannels: currentConfig.notify,
      logger,
      onStreamProgress: (progress) => {
        broadcast("llm:progress", {
          ...(overrides?.sessionIdForSSE ? { sessionId: overrides.sessionIdForSSE } : {}),
          status: progress.status,
          elapsedMs: progress.elapsedMs,
          totalChars: progress.totalChars,
          chineseChars: progress.chineseChars,
        });
      },
      externalContext: overrides?.externalContext,
    };
  }

  // ---------------------------------------------------------------------------
  // Security helpers
  // ---------------------------------------------------------------------------

  function assertProjectRoot(input: string | undefined, serverRoot: string): string {
    const candidate = input ? resolve(input) : resolve(serverRoot);
    const allowed = resolve(serverRoot);
    // Must be either the exact root, or directly within it (with separator)
    const withSep = allowed.endsWith(sep) ? allowed : allowed + sep;
    if (candidate !== allowed && !candidate.startsWith(withSep)) {
      throw new Error("Project root out of bounds");
    }
    return candidate;
  }

  function assertSafeAuthorId(id: string): string {
    const clean = id.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!clean || clean !== id) throw new Error(`Invalid authorId: ${id}`);
    return clean;
  }

  // ---- Route module context ----
  // Shared state injected into extracted route modules.
  // More routes will be extracted in subsequent phases.
  const routeContext = {
    app,
    root,
    state,
    broadcast,
    subscribers,
    getConfig: () => cachedConfig,
    loadCurrentProjectConfig,
    foundationPlans,
    foundationPlansPromise,
    persistFoundationPlan: (root: string, planId: string, entry: Record<string, unknown>) => persistFoundationPlan(root, planId, entry as unknown as FoundationPlanEntry),
    removePersistedFoundationPlan,
    get foundationPlansLoaded() { return foundationPlansLoaded; },
    schedulerInstance: { current: null as Scheduler | null },
    buildPipelineConfig,
    loadRawConfig,
    saveRawConfig,
    resolveConfiguredServiceBaseUrl,
    probeServiceCapabilities: (args: Record<string, unknown>) => probeServiceCapabilities(args as Parameters<typeof probeServiceCapabilities>[0]),
  };

  // Register extracted route modules (Phase 2: logs, genres, analytics, health, truth-browser, language, project-config)
  registerEventsRoutes(routeContext);
  registerDaemonRoutes(routeContext);
  registerCoverRoutes(routeContext);
  registerProjectRoutes(routeContext);
  registerLogsRoutes(routeContext);
  registerGenresRoutes(routeContext);
  registerAnalyticsRoutes(routeContext);
  registerHealthRoutes(routeContext);
  registerTruthBrowserRoutes(routeContext);
  registerLanguageRoutes(routeContext);
  registerModelOverridesRoutes(routeContext);
  registerNotifyRoutes(routeContext);
  registerSourcesRoutes(routeContext);
  registerHooksRoutes(routeContext);
  registerBooksRoutes(routeContext);
  registerServicesRoutes(routeContext);
  registerChaptersRoutes(routeContext);
  registerAuditRoutes(routeContext);
  registerStyleRoutes(routeContext);
  registerRuntimeTruthRoutes(routeContext);
  registerVoicesSceneRoutes(routeContext);
  registerSessionsRoutes(routeContext);
  registerRolesRoutes(routeContext);
  registerDetectRoutes(routeContext);
  registerWritingRoutes(routeContext);
  registerRevisionExportRoutes(routeContext);
  registerFanficRadarDoctorRoutes(routeContext);

  // All extracted routes registered; agent endpoint remains inline for C1-ext phase 2

  // --- Books ---
  // (extracted to routes/books.ts, registered above)

  // --- Book Create ---
  // (extracted to routes/books.ts)

  // --- Chapters ---
  // (extracted to routes/chapters.ts, registered above)

  // --- Truth files & Runtime artifacts ---
  // (extracted to routes/runtime-truth.ts, registered above)

  // --- Style score & AIGC Detection ---
  // (extracted to routes/detect.ts, registered above)

  // --- Write preview & planning ---
  // (extracted to routes/writing.ts, registered above)

  // --- Write actions (write-next, draft, write-status) ---
  // (extracted to routes/writing.ts, registered above)

  // --- Agent chat ---
  // (kept inline — complex dependencies, planned for C1-ext phase 2)

  app.post("/api/v1/agent", async (c) => {
    const { instruction, activeBookId, sessionId: reqSessionId, model: reqModel, service: reqService } = await c.req.json<{
      instruction: string;
      activeBookId?: string;
      sessionId?: string;
      model?: string;
      service?: string;
    }>();
    const sessionId = reqSessionId;
    if (!instruction?.trim()) {
      return c.json({ error: "No instruction provided" }, 400);
    }
    if (!sessionId?.trim()) {
      throw new ApiError(400, "SESSION_ID_REQUIRED", "sessionId is required");
    }
    if (reqModel && !isTextChatModelId(reqModel)) {
      const message = nonTextModelMessage(reqModel);
      return c.json({ error: message, response: message }, 400);
    }

    broadcast("agent:start", { instruction, activeBookId, sessionId });

    try {
      // Load config + create LLM client (pipeline created after model resolution)
      const config = await loadCurrentProjectConfig({ requireApiKey: false });
      const client = createLLMClient(config.llm);

      const loadedBookSession = await loadBookSession(root, sessionId);
      if (!loadedBookSession) {
        throw new ApiError(404, "SESSION_NOT_FOUND", `Session not found: ${sessionId}`);
      }
      let bookSession = loadedBookSession;
      const requestedActiveBookId = normalizeApiBookId(activeBookId, "activeBookId");
      const persistedBookId = normalizeApiBookId(bookSession.bookId, "session.bookId");
      if (
        requestedActiveBookId
        && persistedBookId
        && persistedBookId !== requestedActiveBookId
      ) {
        throw new ApiError(
          409,
          "SESSION_BOOK_MISMATCH",
          `Session ${bookSession.sessionId} is bound to ${persistedBookId}, not ${requestedActiveBookId}`,
        );
      }
      const agentBookId = requestedActiveBookId ?? persistedBookId;
      if (agentBookId) {
        try {
          await state.loadBookConfig(agentBookId);
        } catch {
          throw new ApiError(404, "BOOK_NOT_FOUND", `Book not found: ${agentBookId}`);
        }
      }
      const streamSessionId = loadedBookSession.sessionId;
      const titleBeforeRun = bookSession.title;
      let sessionTitleBroadcasted = false;
      const refreshBookSessionFromTranscript = async (): Promise<void> => {
        const refreshed = await loadBookSession(root, bookSession.sessionId);
        if (refreshed) {
          bookSession = refreshed;
        }
        if (!sessionTitleBroadcasted && titleBeforeRun === null && bookSession.title) {
          broadcast("session:title", { sessionId: bookSession.sessionId, title: bookSession.title });
          sessionTitleBroadcasted = true;
        }
      };

      const externalEdit = await tryHandleExternalChatEdit({
        root,
        state,
        instruction,
        activeBookId: agentBookId,
      });
      if (externalEdit) {
        await appendManualSessionMessages(root, bookSession.sessionId, [{
          role: "assistant",
          content: [{ type: "text", text: externalEdit.responseText }],
          api: "anthropic-messages",
          provider: config.llm.provider,
          model: config.llm.model,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: Date.now(),
        }], instruction);
        await refreshBookSessionFromTranscript();
        broadcast("agent:complete", { instruction, activeBookId: externalEdit.activeBookId, sessionId: bookSession.sessionId });
        return c.json({
          response: externalEdit.responseText,
          session: {
            sessionId: bookSession.sessionId,
            ...(externalEdit.activeBookId ? { activeBookId: externalEdit.activeBookId } : {}),
          },
        });
      }

      // Resolve model — multi-service resolution
      let resolvedModel: ResolvedModel["model"] | undefined;
      let resolvedApiKey: string | undefined;

      if (reqService && reqModel) {
        // 1. Frontend explicitly selected a service+model — fail loudly if no key
        try {
          const configuredEntry = await resolveConfiguredServiceEntry(root, reqService);
          const resolved = await resolveServiceModel(
            reqService,
            reqModel,
            root,
            await resolveConfiguredServiceBaseUrl(root, reqService),
            configuredEntry?.apiFormat,
          );
          resolvedModel = resolved.model;
          resolvedApiKey = resolved.apiKey;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          if (/API key/i.test(msg)) {
            return c.json({
              error: `请先为 ${reqService} 配置 API Key`,
              response: `请先在模型配置中为 ${reqService} 填写 API Key，然后再试。`,
            }, 400);
          }
          throw e;
        }
      }

      if (!resolvedModel) {
        // 2. Try defaultModel from new config format
        const rawConfig = config.llm as unknown as Record<string, unknown>;
        const defaultModel = rawConfig.defaultModel as string | undefined;
        const servicesArr = normalizeServiceConfig(rawConfig.services);
        const firstService = servicesArr[0];
        if (firstService?.service && defaultModel && isTextChatModelId(defaultModel)) {
          try {
            const resolved = await resolveServiceModel(
              serviceConfigKey(firstService),
              defaultModel,
              root,
              firstService.baseUrl,
              firstService.apiFormat,
            );
            resolvedModel = resolved.model;
            resolvedApiKey = resolved.apiKey;
          } catch { /* fall through */ }
        }
      }

      if (!resolvedModel) {
        // 3. Try first connected service from secrets
        const secrets = await loadSecrets(root);
        for (const [svcName, svcData] of Object.entries(secrets.services)) {
          if (svcData?.apiKey) {
            try {
              const models = await listModelsForService(svcName, svcData.apiKey);
              const textModels = filterTextChatModels(models);
              if (textModels.length > 0) {
                const configuredEntry = await resolveConfiguredServiceEntry(root, svcName);
                const resolved = await resolveServiceModel(
                  svcName,
                  textModels[0].id,
                  root,
                  await resolveConfiguredServiceBaseUrl(root, svcName),
                  configuredEntry?.apiFormat,
                );
                resolvedModel = resolved.model;
                resolvedApiKey = resolved.apiKey;
                break;
              }
            } catch { /* try next */ }
          }
        }
      }

      if (!resolvedModel) {
        // 4. Legacy fallback: use createLLMClient
        resolvedModel = client._piModel
          ? client._piModel
          : { provider: config.llm.provider ?? "anthropic", modelId: config.llm.model } as any;
        resolvedApiKey = client._apiKey;
      }

      const model = resolvedModel!;
      const agentApiKey = resolvedApiKey;
      const configuredEntry = reqService ? await resolveConfiguredServiceEntry(root, reqService) : undefined;

      // Create pipeline with resolved model (so sub_agent tools use the frontend-selected model)
      // Don't spread config.llm — its baseUrl/provider belong to the old service.
      // Let createLLMClient resolve baseUrl from the service preset.
      const pipelineClient = (reqService && reqModel && resolvedModel)
        ? createLLMClient({
            ...config.llm,
            service: configuredEntry?.service ?? reqService,
            model: reqModel,
            apiKey: resolvedApiKey ?? "",
            ...(configuredEntry?.apiFormat ? { apiFormat: configuredEntry.apiFormat } : {}),
            ...(configuredEntry?.stream !== undefined ? { stream: configuredEntry.stream } : {}),
            baseUrl: configuredEntry?.baseUrl ?? "",
          } as any)
        : client;
      const pipeline = new PipelineRunner(await buildPipelineConfig({
        client: pipelineClient,
        model: reqModel ?? config.llm.model,
        currentConfig: config,
        sessionIdForSSE: bookSession.sessionId,
      }));
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- ensure dispose in all paths
      const disposePipeline = () => {
        if (typeof (pipeline as any).dispose === "function") {
          (pipeline as any).dispose();
        }
      };

      try {
        if (agentBookId && isWriteNextInstruction(instruction)) {
        const toolCallId = `direct-writer-${Date.now().toString(36)}`;
        const toolArgs = { agent: "writer", bookId: agentBookId };
        broadcast("tool:start", {
          sessionId: streamSessionId,
          id: toolCallId,
          tool: "sub_agent",
          args: toolArgs,
          stages: PIPELINE_STAGES.writer,
        });

        try {
          const writeResult = await pipeline.writeNextChapter(agentBookId);
          const responseText = [
            `已为 ${agentBookId} 完成第 ${writeResult.chapterNumber} 章`,
            writeResult.title ? `《${writeResult.title}》` : "",
            `，字数 ${writeResult.wordCount}，状态 ${writeResult.status}。`,
          ].join("");
          const toolResult = {
            content: [{ type: "text", text: responseText }],
            details: {
              kind: "chapter_written",
              bookId: agentBookId,
              chapterNumber: writeResult.chapterNumber,
              title: writeResult.title,
              wordCount: writeResult.wordCount,
              status: writeResult.status,
            },
          };
          broadcast("tool:end", {
            sessionId: streamSessionId,
            id: toolCallId,
            tool: "sub_agent",
            result: toolResult,
            details: toolResult.details,
            isError: false,
          });
          await appendManualSessionMessages(root, bookSession.sessionId, [{
            role: "assistant",
            content: [{ type: "text", text: responseText }],
            api: "anthropic-messages",
            provider: configuredEntry?.service ?? reqService ?? config.llm.provider,
            model: reqModel ?? config.llm.model,
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "toolUse",
            timestamp: Date.now(),
          }], instruction);
          await refreshBookSessionFromTranscript();
          broadcast("agent:complete", { instruction, activeBookId: agentBookId, sessionId: bookSession.sessionId });
          return c.json({
            response: responseText,
            session: {
              sessionId: bookSession.sessionId,
              activeBookId: agentBookId,
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const toolResult = { content: [{ type: "text", text: message }] };
          broadcast("tool:end", {
            sessionId: streamSessionId,
            id: toolCallId,
            tool: "sub_agent",
            result: toolResult,
            isError: true,
          });
          broadcast("agent:error", { instruction, activeBookId: agentBookId, sessionId: bookSession.sessionId, error: message });
          return c.json({
            error: { code: "AGENT_ACTION_FAILED", message },
            response: message,
          }, 502);
        }
      }

      // Run pi-agent session
      const collectedToolExecs: CollectedToolExec[] = [];
      const result = await runAgentSession(
        {
          model,
          apiKey: agentApiKey,
          pipeline,
          projectRoot: root,
          bookId: agentBookId,
          sessionId: bookSession.sessionId,
          language: config.language ?? "zh",
          onEvent: (event) => {
            if (event.type === "message_update") {
              const ame = event.assistantMessageEvent;
              if (ame.type === "text_delta") {
                broadcast("draft:delta", { sessionId: streamSessionId, text: ame.delta });
              } else if (ame.type === "thinking_delta") {
                broadcast("thinking:delta", { sessionId: streamSessionId, text: (ame as any).delta });
              } else if (ame.type === "thinking_start") {
                broadcast("thinking:start", { sessionId: streamSessionId });
              } else if (ame.type === "thinking_end") {
                broadcast("thinking:end", { sessionId: streamSessionId });
              }
            }
            if (event.type === "tool_execution_start") {
              const args = event.args as Record<string, unknown> | undefined;
              const agent = event.toolName === "sub_agent" ? (args?.agent as string | undefined) : undefined;
              const stages = agent ? (PIPELINE_STAGES[agent] ?? []) : [];

              collectedToolExecs.push({
                id: event.toolCallId,
                tool: event.toolName,
                agent,
                label: resolveToolLabel(event.toolName, agent),
                status: "running",
                args,
                stages: stages.length > 0
                  ? stages.map(l => ({ label: l, status: "pending" as const }))
                  : undefined,
                startedAt: Date.now(),
              });

              if (!agentBookId && event.toolName === "sub_agent" && agent === "architect") {
                const bookId = resolveArchitectBookIdFromArgs(args);
                if (bookId) {
                  const title = typeof args?.title === "string" && args.title.trim()
                    ? args.title.trim()
                    : bookId;
                  bookCreateStatus.set(bookId, { status: "creating", createdAt: Date.now(), ttlMs: BOOK_CREATE_TTL_MS });
                  broadcast("book:creating", { bookId, title, sessionId: streamSessionId });
                }
              }

              broadcast("tool:start", {
                sessionId: streamSessionId,
                id: event.toolCallId,
                tool: event.toolName,
                args,
                stages,
              });
            }
            if (event.type === "tool_execution_update") {
              broadcast("tool:update", {
                sessionId: streamSessionId,
                tool: event.toolName,
                partialResult: event.partialResult,
              });
            }
            if (event.type === "tool_execution_end") {
              const exec = collectedToolExecs.find(t => t.id === event.toolCallId);
              if (exec) {
                exec.status = event.isError ? "error" : "completed";
                exec.completedAt = Date.now();
                exec.stages = exec.stages?.map(s => ({ ...s, status: "completed" as const }));
                if (event.isError) exec.error = extractToolError(event.result);
                else exec.result = summarizeResult(event.result);
                exec.details = (event.result as { details?: unknown } | undefined)?.details;
                if (
                  event.isError &&
                  !agentBookId &&
                  exec.tool === "sub_agent" &&
                  exec.agent === "architect"
                ) {
                  const bookId = resolveArchitectBookIdFromArgs(exec.args);
                  if (bookId) {
                    const error = exec.error ?? "Book creation failed";
                    bookCreateStatus.set(bookId, { status: "failed", error, createdAt: Date.now(), ttlMs: BOOK_CREATE_TTL_MS });
                    broadcast("book:error", { bookId, sessionId: streamSessionId, error });
                  }
                }
              }
              broadcast("tool:end", {
                sessionId: streamSessionId,
                id: event.toolCallId,
                tool: event.toolName,
                result: event.result,
                details: exec?.details,
                isError: event.isError,
              });
            }
          },
        },
        instruction,
      );

      if (result.responseText) {
        const actionExecutionError = validateAgentActionExecution({
          instruction,
          agentBookId,
          responseText: result.responseText,
          collectedToolExecs,
        });
        if (actionExecutionError) {
          return c.json({
            error: { code: "AGENT_ACTION_NOT_EXECUTED", message: actionExecutionError },
            response: actionExecutionError,
          }, 502);
        }
      }

      let broadcastedCreatedBookId: string | null = null;
      const finalizeCreatedBook = async (): Promise<string | null> => {
        if (agentBookId) return null;
        const createdBookId = resolveCreatedBookIdFromToolExecs(collectedToolExecs);
        if (!createdBookId) return null;
        if (broadcastedCreatedBookId === createdBookId) return createdBookId;

        try {
          const migratedSession = await migrateBookSession(root, bookSession.sessionId, createdBookId);
          if (migratedSession) {
            bookSession = migratedSession;
          }
        } catch (e) {
          if (!(e instanceof SessionAlreadyMigratedError)) {
            throw e;
          }
        }

        const book = await loadStudioBookListSummary(state, createdBookId).catch(() => undefined);
        bookCreateStatus.delete(createdBookId);
        broadcast("book:created", {
          bookId: createdBookId,
          sessionId: bookSession.sessionId,
          ...(book ? { book } : {}),
        });
        broadcastedCreatedBookId = createdBookId;
        return createdBookId;
      };

      if (!result.responseText) {
        if (result.errorMessage) {
          if (resolveCreatedBookIdFromToolExecs(collectedToolExecs)) {
            await finalizeCreatedBook();
          }
          return c.json({
            error: { code: "AGENT_LLM_ERROR", message: result.errorMessage },
            response: result.errorMessage,
          }, 502);
        }

        try {
          const fallbackClient = createLLMClient({
            ...config.llm,
            service: configuredEntry?.service ?? reqService ?? config.llm.service,
            model: reqModel ?? config.llm.model,
            apiKey: agentApiKey ?? config.llm.apiKey,
            baseUrl: configuredEntry?.baseUrl ?? "",
            ...(configuredEntry?.apiFormat ? { apiFormat: configuredEntry.apiFormat } : {}),
            ...(configuredEntry?.stream !== undefined ? { stream: configuredEntry.stream } : {}),
          } as ProjectConfig["llm"]);
          const fallback = await chatCompletion(
            fallbackClient,
            reqModel ?? config.llm.model,
            [
              { role: "system", content: buildAgentSystemPrompt(agentBookId, config.language ?? "zh") },
              { role: "user", content: instruction },
            ],
            { maxTokens: 256 },
          );
          if (fallback.content?.trim()) {
            const actionExecutionError = validateAgentActionExecution({
              instruction,
              agentBookId,
              responseText: fallback.content,
              collectedToolExecs,
            });
            if (actionExecutionError) {
              return c.json({
                error: { code: "AGENT_ACTION_NOT_EXECUTED", message: actionExecutionError },
                response: actionExecutionError,
              }, 502);
            }
            await appendManualSessionMessages(root, bookSession.sessionId, [{
              role: "assistant",
              content: [{ type: "text", text: fallback.content }],
              api: "anthropic-messages",
              provider: configuredEntry?.service ?? reqService ?? config.llm.provider,
              model: reqModel ?? config.llm.model,
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
              stopReason: "stop",
              timestamp: Date.now(),
            }], instruction);
            await refreshBookSessionFromTranscript();
            const createdBookId = await finalizeCreatedBook();
            return c.json({
              response: fallback.content,
              session: {
                sessionId: bookSession.sessionId,
                ...(createdBookId ? { activeBookId: createdBookId } : {}),
              },
            });
          }
        } catch {
          // fall through to probe-based diagnosis below
        }

        try {
          const probeClient = createLLMClient({
            ...config.llm,
            service: configuredEntry?.service ?? reqService ?? config.llm.service,
            model: reqModel ?? config.llm.model,
            apiKey: agentApiKey ?? config.llm.apiKey,
            baseUrl: configuredEntry?.baseUrl ?? "",
            ...(configuredEntry?.apiFormat ? { apiFormat: configuredEntry.apiFormat } : {}),
            ...(configuredEntry?.stream !== undefined ? { stream: configuredEntry.stream } : {}),
          } as ProjectConfig["llm"]);
          await chatCompletion(
            probeClient,
            reqModel ?? config.llm.model,
            [{ role: "user", content: "ping" }],
            { maxTokens: 5 },
          );
        } catch (probeError) {
          const probeMessage = probeError instanceof Error ? probeError.message : String(probeError);
          if (resolveCreatedBookIdFromToolExecs(collectedToolExecs)) {
            await finalizeCreatedBook();
          }
          return c.json({
            error: { code: "AGENT_EMPTY_RESPONSE", message: probeMessage },
            response: probeMessage,
          }, 502);
        }

        const emptyMessage = "模型未返回文本内容。请检查协议类型（chat/responses）、流式开关或上游服务兼容性。";
        if (resolveCreatedBookIdFromToolExecs(collectedToolExecs)) {
          await finalizeCreatedBook();
        }
        return c.json({
          error: { code: "AGENT_EMPTY_RESPONSE", message: emptyMessage },
          response: emptyMessage,
        }, 502);
      }
      await refreshBookSessionFromTranscript();
      await finalizeCreatedBook();

      broadcast("agent:complete", { instruction, activeBookId, sessionId: bookSession.sessionId });

      return c.json({
        response: result.responseText,
        session: {
          sessionId: bookSession.sessionId,
          ...(bookSession.bookId ? { activeBookId: bookSession.bookId } : {}),
        },
      });
      } finally {
        disposePipeline();
      }
    } catch (e) {
      if (e instanceof ApiError) {
        throw e;
      }
      if (e instanceof SessionAlreadyMigratedError) {
        const migratedMessage = e instanceof Error ? e.message : String(e);
        throw new ApiError(409, "SESSION_ALREADY_MIGRATED", migratedMessage);
      }
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[studio] Agent error:", msg);
      broadcast("agent:error", { instruction, activeBookId, sessionId, error: msg });

      // Agent busy — return 429 with user-friendly message
      if (/already processing|prompt.*queue/i.test(msg)) {
        return c.json({
          error: { code: "AGENT_BUSY", message: "正在处理中，请等待当前操作完成" },
          response: "正在处理中，请等待当前操作完成后再发送。",
        }, 429);
      }

      return c.json(
        { error: { code: "AGENT_ERROR", message: msg } },
        500,
      );
    }
  });

  // --- Language setup ---
  // (extracted to routes/language.ts, registered above)

  // --- Audit ---
  // (extracted to routes/audit.ts, registered above)

  // --- Revise / Export / Rewrite / Resync ---
  // (extracted to routes/revision-export.ts, registered above)

  // --- Detect routes ---
  // (extracted to routes/detect.ts, registered above)

  // --- Genre Create / Edit / Delete ---
  // (extracted to routes/genres.ts, registered above)

  // --- Style routes ---
  // (extracted to routes/style.ts, registered above)

  // --- Scene Templates & Voice Profiles ---
  // (extracted to routes/voices-scene.ts, registered above)

  // --- State Changelog (M10/P2-1) ---
  // (extracted to routes/runtime-truth.ts, registered above)

  // --- Role Cards ---
  // (extracted to routes/roles.ts, registered above)

  // --- Fanfic / Radar / Doctor ---
  // (extracted to routes/fanfic-radar-doctor.ts, registered above)

  return app;
}

// --- Standalone runner ---

export async function startStudioServer(
  root: string,
  port = 4577,
  options?: { readonly staticDir?: string },
): Promise<void> {
  const config = await loadProjectConfig(root, { consumer: "studio", requireApiKey: false });

  const app = createStudioServer(config, root);

  // Serve frontend static files — single process for API + frontend
  if (options?.staticDir) {
    const { readFile: readFileFs } = await import("node:fs/promises");
    const { join: joinPath } = await import("node:path");
    const { existsSync } = await import("node:fs");

    // Serve static assets (js, css, etc.)
    app.get("/assets/*", async (c) => {
      const rawPath = c.req.path;
      // Prevent path traversal: resolve + relative check
      const resolved = resolve(options.staticDir!, "." + rawPath);
      const rel = relative(options.staticDir!, resolved);
      if (rel.startsWith("..") || rel.startsWith("/") || isAbsolute(rel)) {
        return c.notFound();
      }
      const filePath = joinPath(options.staticDir!, rawPath);
      try {
        const content = await readFileFs(filePath);
        const ext = filePath.split(".").pop() ?? "";
        const contentTypes: Record<string, string> = {
          js: "application/javascript",
          css: "text/css",
          svg: "image/svg+xml",
          png: "image/png",
          ico: "image/x-icon",
          json: "application/json",
        };
        return new Response(content, {
          headers: { "Content-Type": contentTypes[ext] ?? "application/octet-stream" },
        });
      } catch {
        return c.notFound();
      }
    });

    // SPA fallback — serve index.html for all non-API routes
    const indexPath = joinPath(options.staticDir!, "index.html");
    if (existsSync(indexPath)) {
      const indexHtml = await readFileFs(indexPath, "utf-8");
      app.get("*", (c) => {
        if (c.req.path.startsWith("/api/v1/")) return c.notFound();
        return c.html(indexHtml);
      });
    }
  }

  const host = process.env.STUDIO_HOST || "127.0.0.1";
  console.log(`InkOS Studio running on http://${host}:${port}`);
  serve({ fetch: app.fetch, hostname: host, port });
}
