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
import { registerSessionsRoutes } from "./routes/sessions.js";
import { registerAuditRoutes } from "./routes/audit.js";

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
function extractCharacterDialogue(content: string, characterId: string, characterName: string): string[] {
  const lines: string[] = [];
  const names = [characterName, characterId].filter(Boolean);
  // Build a regex that matches lines starting with or containing the character name + colon
  // Chinese dialogue patterns: 角色名："...", 角色名：「...」, "角色名...", 「角色名...」
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`${escaped}[：:"：]\\s*["「](.+?)["」]`, "g"),
      new RegExp(`["「]${escaped}(.+?)["」]`, "g"),
      new RegExp(`${escaped}[说问道喊叫嚷叹答]\\s*[：:"：]\\s*(.+?)(?:[。！？!?]|$)`, "g"),
    ];
    for (const regex of patterns) {
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

// --- withPipeline —— 自动管理 PipelineRunner 生命周期 ---

/**
 * 创建 PipelineRunner，在 promise 完成/失败后自动 dispose。
 * 兼容测试环境（MockPipelineRunner 可能无 dispose 或 globalRegistry 被 mock）。
 */
async function withPipeline<T>(
  label: string,
  config: PipelineConfig,
  fn: (pipeline: PipelineRunner) => Promise<T>,
  _ttlMs = 5 * 60_000,
): Promise<T> {
  const pipeline = new PipelineRunner(config);

  try {
    const result = await fn(pipeline);
    return result;
  } finally {
    if (typeof (pipeline as any).dispose === "function") {
      (pipeline as any).dispose();
    }
  }
}

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

async function loadRawConfig(root: string): Promise<Record<string, unknown>> {
  const configPath = join(root, "inkos.json");
  try {
    const raw = await readFile(configPath, "utf-8");
    if (!raw.trim()) {
      throw new SyntaxError("inkos.json is empty");
    }
    return JSON.parse(raw) as Record<string, unknown>;
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
    get config() { return cachedConfig; },
    loadCurrentProjectConfig,
    foundationPlans,
    get foundationPlansLoaded() { return foundationPlansLoaded; },
    schedulerInstance: { current: null as Scheduler | null },
    buildPipelineConfig,
    loadRawConfig,
    saveRawConfig,
    resolveConfiguredServiceBaseUrl,
  };

  // Register extracted route modules (Phase 2: logs, genres, analytics, health, truth-browser, language, project-config)
  registerEventsRoutes(routeContext);
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
  registerSessionsRoutes(routeContext);
  // daemon needs schedulerInstance ref — wire after declaration below

  // --- Books ---
  // (extracted to routes/books.ts, registered above)

  // --- Book Create ---
  // (extracted to routes/books.ts)

  // --- Chapters ---
  // (extracted to routes/chapters.ts, registered above)

  // --- Truth files ---

  // Flat-file whitelist — the pre-Phase-5 story root files plus dev's legacy
  // editor targets (author_intent / current_focus / volume_outline).
  //
  // Phase 5 cleanup #3 moved the authoritative YAML frontmatter + outline prose
  // into story/outline/ and character sheets into story/roles/. `story_bible.md`
  // and `book_rules.md` now exist only as compat pointer shims — we still allow
  // reading them so legacy books keep rendering, but the server-side writer
  // (write_truth_file) no longer accepts them as edit targets.
  const TRUTH_FLAT_FILES = [
    "author_intent.md", "current_focus.md",
    "story_bible.md", "book_rules.md", "volume_outline.md", "current_state.md",
    "particle_ledger.md", "pending_hooks.md", "chapter_summaries.md",
    "subplot_board.md", "emotional_arcs.md", "character_matrix.md",
    "style_guide.md", "parent_canon.md", "fanfic_canon.md",
  ];

  // Authoritative Phase 5 paths — prose outline + role sheets live under
  // dedicated subdirectories of story/. The full path (relative to story/) is
  // matched literally here. `节奏原则.md` / `rhythm_principles.md` is optional
  // after Phase 5 consolidation (rhythm lives in volume_map's closing paragraph);
  // the entries stay whitelisted for legacy books and manual overrides.
  const TRUTH_OUTLINE_FILES = [
    "outline/story_frame.md",
    "outline/volume_map.md",
    "outline/节奏原则.md",
    "outline/rhythm_principles.md",
  ];

  // Pointer shims that the runtime no longer treats as authoritative. The
  // GET handler tags them with `legacy: true` so the UI can surface that the
  // edits won't land where the user expects.
  const LEGACY_SHIM_FILES = new Set(["story_bible.md", "book_rules.md"]);

  /**
   * Validate a requested truth-file path:
   *   1. Must be one of the declared flat files, an outline/* allow-listed
   *      entry, or a roles/**\/*.md file under 主要角色/ | 次要角色/.
   *   2. Must resolve to a path inside bookDir/story/ (no `..`, no absolute
   *      paths, no traversal via the tier-name segment).
   */
  function resolveTruthFilePath(bookDir: string, file: string): string | null {
    // Reject absolute paths, traversal, null bytes outright.
    if (!file || file.includes("\0") || isAbsolute(file) || file.includes("..")) {
      return null;
    }

    // Phase hotfix 3: accept both Chinese and English locale role dirs so
    // English-layout books (roles/major, roles/minor) are reachable through
    // Studio. The runtime reader (utils/outline-paths.ts:75) already scans
    // both — Studio used to drop English books to read-only.
    const allowed =
      TRUTH_FLAT_FILES.includes(file)
      || TRUTH_OUTLINE_FILES.includes(file)
      || /^roles\/(核心角色|主要角色|重要角色|次要角色|功能角色|core|major|minor|functional)\/[^/]+\.md$/.test(file);

    if (!allowed) return null;

    const storyDir = resolve(bookDir, "story");
    const resolved = resolve(storyDir, file);
    const relativePath = relative(storyDir, resolved);
    if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      return null;
    }
    return resolved;
  }

  async function fileExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  // Use `:file{.+}` wildcard so nested paths (outline/..., roles/.../...) match.
  app.get("/api/v1/books/:id/truth/:file{.+}", async (c) => {
    const file = c.req.param("file");
    const id = c.req.param("id");
    await assertBookDirectoryExists(state, id);

    const bookDir = state.bookDir(id);
    const resolved = resolveTruthFilePath(bookDir, file);
    if (!resolved) {
      return c.json({ error: "Invalid truth file" }, 400);
    }

    // Phase 5: new-layout books keep the authoritative prose under outline/.
    // A legacy book may only have story_bible.md / book_rules.md on disk —
    // we still serve those for read-only display, but flag them so the UI
    // can warn users their edits won't reach the runtime.
    // Hotfix: only tag as legacy when the book actually HAS the new layout.
    // Pre-Phase-5 books use story_bible/book_rules as the authoritative source.
    const { isNewLayoutBook } = await import("@actalk/inkos-core");
    const legacy = LEGACY_SHIM_FILES.has(file) && await isNewLayoutBook(bookDir);

    try {
      const content = await readFile(resolved, "utf-8");
      return c.json({ file, content, ...(legacy ? { legacy: true } : {}) });
    } catch {
      return c.json({ file, content: null, ...(legacy ? { legacy: true } : {}) });
    }
  });

  // --- Runtime artifacts ---

  const MAX_RUNTIME_FILE_BYTES = 1024 * 1024;

  function resolveRuntimeFilePath(bookDir: string, file: string): string | null {
    if (!file || file.includes("\0") || isAbsolute(file) || file.includes("..")) {
      return null;
    }
    const runtimeDir = resolve(bookDir, "story", "runtime");
    const resolved = resolve(runtimeDir, file);
    const relativePath = relative(runtimeDir, resolved);
    if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      return null;
    }
    return resolved;
  }

  app.get("/api/v1/books/:id/runtime", async (c) => {
    const id = c.req.param("id");
    const bookDir = state.bookDir(id);
    const runtimeDir = resolve(bookDir, "story", "runtime");
    const files: Array<{ readonly name: string; readonly path: string; readonly size: number; readonly isDirectory: boolean }> = [];

    async function walk(dir: string, prefix = ""): Promise<void> {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        const fullPath = resolve(dir, entry.name);
        const relativePath = relative(runtimeDir, fullPath);
        if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
          continue;
        }
        const info = await lstat(fullPath).catch(() => null);
        if (info?.isSymbolicLink()) continue;
        files.push({
          name: entry.name,
          path: relPath,
          size: info?.size ?? 0,
          isDirectory: entry.isDirectory(),
        });
        if (entry.isDirectory()) {
          await walk(fullPath, relPath);
        }
      }
    }

    await walk(runtimeDir);
    return c.json({ files });
  });

  app.get("/api/v1/books/:id/runtime/:file{.+}", async (c) => {
    const id = c.req.param("id");
    const file = c.req.param("file");
    const bookDir = state.bookDir(id);
    const resolved = resolveRuntimeFilePath(bookDir, file);
    if (!resolved) {
      return c.json({ error: "Invalid runtime file" }, 400);
    }

    try {
      const info = await lstat(resolved);
      if (info.isSymbolicLink()) return c.json({ error: "Runtime symlinks are not supported" }, 400);
      if (info.isDirectory()) return c.json({ error: "Runtime path is a directory" }, 400);
      if (info.size > MAX_RUNTIME_FILE_BYTES) {
        return c.json({ error: "Runtime file is too large to preview" }, 413);
      }
      const content = await readFile(resolved, "utf-8");
      return c.json({ file, content });
    } catch {
      return c.json({ error: "Runtime file not found" }, 404);
    }
  });

  // --- Analytics ---

  app.get("/api/v1/books/:id/analytics", async (c) => {
    const id = c.req.param("id");
    try {
      const chapters = await state.loadChapterIndexStrict(id);
      return c.json(computeAnalytics(id, chapters));
    } catch {
      return c.json({ error: `Book "${id}" not found` }, 404);
    }
  });

  // --- Sources ---
  // (extracted to routes/sources.ts, registered above)

  // --- Hooks ---
  // (extracted to routes/hooks.ts, registered above)

  app.post("/api/v1/books/:id/chapters/:num/style-score", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    await assertBookExists(state, id);

    const chapterPath = await findChapterFile(root, id, num);
    if (!chapterPath) return c.json({ error: "Chapter not found" }, 404);

    try {
      const content = await readFile(chapterPath, "utf-8");
      const chapterFp = analyzeStyleFingerprint(content);

      const bookDir = state.bookDir(id);
      const profilePath = join(bookDir, "story", "style_profile.json");
      let profileFp: StyleFingerprint | undefined;
      try {
        const raw = await readFile(profilePath, "utf-8");
        const parsed = JSON.parse(raw) as { fingerprint?: StyleFingerprint };
        profileFp = parsed.fingerprint;
      } catch {
        // No style profile — score will be null
      }

      if (!profileFp) {
        return c.json({ score: null, chapterFingerprint: chapterFp, message: "No style profile found for this book" });
      }

      const dims = [
        Math.abs(chapterFp.dialogueRatio - profileFp.dialogueRatio),
        Math.abs(chapterFp.actionDensity - profileFp.actionDensity),
        Math.abs(chapterFp.psychologicalRatio - profileFp.psychologicalRatio),
        Math.abs(chapterFp.sensoryDensity - profileFp.sensoryDensity),
        Math.abs(chapterFp.colloquialismScore - profileFp.colloquialismScore),
        Math.abs(chapterFp.rhetoricDensity - profileFp.rhetoricDensity),
        Math.abs(chapterFp.aiTellRisk - profileFp.aiTellRisk),
      ];

      const sensoryDiffs = [
        Math.abs(chapterFp.sensoryBreakdown.visual - profileFp.sensoryBreakdown.visual),
        Math.abs(chapterFp.sensoryBreakdown.auditory - profileFp.sensoryBreakdown.auditory),
        Math.abs(chapterFp.sensoryBreakdown.tactile - profileFp.sensoryBreakdown.tactile),
        Math.abs(chapterFp.sensoryBreakdown.olfactory - profileFp.sensoryBreakdown.olfactory),
        Math.abs(chapterFp.sensoryBreakdown.gustatory - profileFp.sensoryBreakdown.gustatory),
      ];
      dims.push(sensoryDiffs.reduce((a, b) => a + b, 0) / sensoryDiffs.length);

      const punctDiffs = [
        Math.abs(chapterFp.punctuationRhythm.commaRatio - profileFp.punctuationRhythm.commaRatio),
        Math.abs(chapterFp.punctuationRhythm.periodRatio - profileFp.punctuationRhythm.periodRatio),
        Math.abs(chapterFp.punctuationRhythm.questionRatio - profileFp.punctuationRhythm.questionRatio),
        Math.abs(chapterFp.punctuationRhythm.exclamationRatio - profileFp.punctuationRhythm.exclamationRatio),
        Math.abs(chapterFp.punctuationRhythm.ellipsisRatio - profileFp.punctuationRhythm.ellipsisRatio),
        Math.abs(chapterFp.punctuationRhythm.semicolonRatio - profileFp.punctuationRhythm.semicolonRatio),
      ];
      dims.push(punctDiffs.reduce((a, b) => a + b, 0) / punctDiffs.length);

      const avgDiff = dims.reduce((a, b) => a + b, 0) / dims.length;
      const score = Math.round(Math.max(0, 1 - avgDiff) * 100);

      return c.json({ score, chapterFingerprint: chapterFp, profileFingerprint: profileFp });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "Failed to compute style score" }, 500);
    }
  });

  // --- Actions ---

  /** Preview what context the Planner will use before actually writing. */
  app.get("/api/v1/books/:id/write-preview", async (c) => {
    const id = c.req.param("id");
    const chapterNumber = Number(c.req.query("chapter"));
    await assertBookExists(state, id);
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }

    const bookDir = state.bookDir(id);

    try {
      const [chapterGoalsIndex, chapterIntentsIndex] = await Promise.all([
        loadChapterGoals(bookDir).catch(() => ({ goals: [] as ReadonlyArray<ChapterGoalCard> })),
        loadChapterIntents(bookDir).catch(() => ({ intents: [] as ReadonlyArray<AuthorChapterIntent> })),
      ]);

      const chapterGoal = getChapterGoal(chapterGoalsIndex.goals, chapterNumber);
      const chapterIntent = getChapterIntent(chapterIntentsIndex.intents, chapterNumber);

      // Check hooks state for overdue hooks
      let activeHooksCount = 0;
      let overdueHookIds: string[] = [];
      try {
        const { readFile } = await import("node:fs/promises");
        const { join } = await import("node:path");
        const hooksJsonPath = join(bookDir, "story", "state", "hooks.json");
        const raw = await readFile(hooksJsonPath, "utf-8");
        const parsed = JSON.parse(raw) as { hooks?: Array<{ hookId: string; status: string; halfLifeChapters?: number; lastAdvancedChapter: number }> };
        const hooks = parsed.hooks ?? [];
        activeHooksCount = hooks.filter((h) => h.status !== "resolved").length;
        overdueHookIds = hooks
          .filter((h) => h.status !== "resolved" && h.halfLifeChapters && (chapterNumber - h.lastAdvancedChapter) > h.halfLifeChapters)
          .map((h) => h.hookId);
      } catch {
        // hooks.json not found — skip hook stats
      }

      const contextSummary = {
        hasGoal: !!chapterGoal,
        goalMainConflict: chapterGoal?.mainConflict ?? null,
        hasIntent: !!(chapterIntent?.coreNarrative),
        intentCoreNarrative: chapterIntent?.coreNarrative ?? null,
        activeHooksCount,
        overdueHooksCount: overdueHookIds.length,
        overdueHookIds,
        hasPovCharacter: !!chapterGoal?.povCharacter,
        povCharacter: chapterGoal?.povCharacter ?? null,
        hasOpeningFrame: !!(chapterIntent as Record<string, unknown> | null)?.["openingFrame"],
        hasClosingFrame: !!(chapterIntent as Record<string, unknown> | null)?.["closingFrame"],
      };

      const warnings: string[] = [];
      if (!chapterGoal) warnings.push("未设定本章目标——建议先在「目标」面板填写");
      if (!chapterIntent?.coreNarrative) warnings.push("未完成创作访谈——建议先回答核心三问");
      if (overdueHookIds.length > 0) warnings.push(`${overdueHookIds.length} 条伏笔已逾期：${overdueHookIds.join("、")}`);

      // M3: Parse plan alternatives from the existing .plan.md (if Planner has already run)
      const { join: jn2 } = await import("node:path");
      const padded = String(chapterNumber).padStart(4, "0");
      const planPath = jn2(bookDir, "story", "runtime", `chapter-${padded}.plan.md`);
      const planAlternatives = await parsePlanAlternatives(planPath);

      return c.json({ chapterNumber, contextSummary, warnings, planAlternatives });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Plan Alternatives (M3/U6) ---
  // Returns previously generated plan alternatives for user selection.

  /**
   * Parse plan alternatives from a .plan.md file.
   * Extracted as shared helper so both /write-preview and /plan-alternatives
   * can return the same data.
   */
  async function parsePlanAlternatives(planPath: string): Promise<Array<{ id: string; label: string; description: string; goal: string }>> {
    const alternatives: Array<{ id: string; label: string; description: string; goal: string }> = [];
    try {
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(planPath, "utf-8");
      const altMatch = raw.match(/## Plan Alternatives[\s\S]*$/);
      if (altMatch) {
        const altBlocks = altMatch[0].split(/### Variant /).filter(Boolean);
        return altBlocks.map((block, i) => {
          const labelMatch = block.match(/^(\S[^\n]*)/);
          const goalMatch = block.match(/\*\*Goal\*\*:\s*(.+)/);
          const descMatch = block.match(/\*\*Description\*\*:\s*(.+)/);
          return {
            id: `variant-${String.fromCharCode(98 + i)}`,
            label: labelMatch?.[1]?.trim() || `方案 ${String.fromCharCode(65 + i)}`,
            description: descMatch?.[1]?.trim() || "",
            goal: goalMatch?.[1]?.trim() || "",
          };
        });
      }
    } catch { /* no plan file yet */ }
    return alternatives;
  }

  app.get("/api/v1/books/:id/plan-alternatives", async (c) => {
    const id = c.req.param("id");
    const chapterNumber = Number(c.req.query("chapter"));
    await assertBookExists(state, id);
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    try {
      const bookDir = new StateManager(root).bookDir(id);
      const { join } = await import("node:path");
      const padded = String(chapterNumber).padStart(4, "0");
      const planPath = join(bookDir, "story", "runtime", `chapter-${padded}.plan.md`);
      const alternatives = await parsePlanAlternatives(planPath);
      return c.json({ chapterNumber, alternatives });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/write-next", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    const body = await c.req.json<{ wordCount?: number }>().catch(() => ({ wordCount: undefined }));

    broadcast("write:start", { bookId: id });

    // Fire and forget — progress/completion/errors pushed via SSE
    withPipeline("write-next", await buildPipelineConfig(), async (pipeline) => {
      const result = await pipeline.writeNextChapter(id, body.wordCount);
      broadcast("write:complete", { bookId: id, chapterNumber: result.chapterNumber, status: result.status, title: result.title, wordCount: result.wordCount });
    }).catch((e) => {
      broadcast("write:error", { bookId: id, error: e instanceof Error ? e.message : String(e) });
    });

    return c.json({ status: "writing", bookId: id });
  });

  app.post("/api/v1/books/:id/draft", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    const body = await c.req.json<{ wordCount?: number; context?: string }>().catch(() => ({ wordCount: undefined, context: undefined }));

    broadcast("draft:start", { bookId: id });

    withPipeline("draft", await buildPipelineConfig(), async (pipeline) => {
      const result = await pipeline.writeDraft(id, body.context, body.wordCount);
      broadcast("draft:complete", { bookId: id, chapterNumber: result.chapterNumber, title: result.title, wordCount: result.wordCount });
    }).catch((e) => {
      broadcast("draft:error", { bookId: id, error: e instanceof Error ? e.message : String(e) });
    });

    return c.json({ status: "drafting", bookId: id });
  });

  // --- SSE ---
  // (extracted to routes/events.ts, registered above via registerEventsRoutes)

  // --- Model discovery ---
  // (extracted to routes/services.ts, registered above)

  // --- Project info ---


  // --- Language setup ---
  // (extracted to routes/language.ts, registered above)

  // --- Audit ---
    return c.json({
      services,
      service: typeof llm.service === "string" ? llm.service : null,
      defaultModel: llm.defaultModel ?? null,
      configSource: "studio" satisfies LLMConfigSource,
      storedConfigSource: normalizeConfigSource(llm.configSource),
      envConfig,
    });
  });

  // --- Project info ---
  // (basic routes extracted to routes/project.ts; language/model-overrides/notify remain below)

  // --- Truth files browser ---
  // (extracted to routes/truth-browser.ts, registered above)

  // --- Daemon control ---

  // Wire daemon routes with the shared scheduler ref
  registerDaemonRoutes(routeContext);

  // --- Logs ---
  // (extracted to routes/logs.ts, registered above)

  // --- Agent chat ---
  // (extracted to routes/sessions.ts, registered above)

  // --- Language setup ---
    const session = await loadProjectSession(root);
    const activeBookId = await resolveSessionActiveBook(root, session);
    return c.json({
      session: activeBookId && session.activeBookId !== activeBookId
        ? { ...session, activeBookId }
        : session,
      activeBookId,
    });
  });

  // -- Per-book session endpoints --

  app.get("/api/v1/sessions", async (c) => {
    const bookId = c.req.query("bookId");
    const sessions = await listBookSessions(root, bookId === undefined ? null : bookId === "null" ? null : bookId);
    return c.json({ sessions });
  });

  app.get("/api/v1/sessions/:sessionId", async (c) => {
    const session = await loadBookSession(root, c.req.param("sessionId"));
    if (!session) return c.json({ error: "Session not found" }, 404);
    return c.json({ session });
  });

  app.post("/api/v1/sessions", async (c) => {
    const body = await c.req.json<{ bookId?: string | null; sessionId?: string }>().catch(() => ({}));
    const bookId = normalizeApiBookId((body as { bookId?: unknown }).bookId, "bookId");
    const sessionId = (body as { sessionId?: string }).sessionId;
    // sessionId 只允许 timestamp-random 格式；防止注入任意文件名
    const safeSessionId = sessionId && /^[0-9]+-[a-z0-9]+$/.test(sessionId) ? sessionId : undefined;
    const session = await createAndPersistBookSession(root, bookId, safeSessionId);
    return c.json({ session });
  });

  app.put("/api/v1/sessions/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json<{ title?: string }>().catch(() => ({}) as { title?: string });
    const title = body.title?.trim();
    if (!title) {
      throw new ApiError(400, "INVALID_SESSION_TITLE", "Session title is required");
    }

    const session = await renameBookSession(root, sessionId, title);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }
    return c.json({ session });
  });

  app.delete("/api/v1/sessions/:sessionId", async (c) => {
    await deleteBookSession(root, c.req.param("sessionId"));
    return c.json({ ok: true });
  });

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

  // --- Revise ---

  app.post("/api/v1/books/:id/revise/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const bookDir = state.bookDir(id);
    const body = await c.req
      .json<{ mode?: string; brief?: string }>()
      .catch(() => ({ mode: "spot-fix", brief: undefined }));

    broadcast("revise:start", { bookId: id, chapter: chapterNum });
    try {
      const book = await state.loadBookConfig(id);
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const paddedNum = String(chapterNum).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);

      const pipelineConfig = await buildPipelineConfig({ externalContext: body.brief });
      const normalizedMode = body.mode ?? "spot-fix";
      const result = await withPipeline("revise-draft", pipelineConfig, async (pipeline) => {
        return pipeline.reviseDraft(
          id,
          chapterNum,
          normalizedMode as "polish" | "rewrite" | "rework" | "spot-fix" | "anti-detect",
        );
      });
      broadcast("revise:complete", { bookId: id, chapter: chapterNum });
      return c.json(result);
    } catch (e) {
      broadcast("revise:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Export ---

  app.get("/api/v1/books/:id/export", async (c) => {
    const id = c.req.param("id");
    const format = (c.req.query("format") ?? "txt") as string;
    const approvedOnly = c.req.query("approvedOnly") === "true";

    try {
      const artifact = await buildExportArtifact(state, id, {
        format: format as "txt" | "md" | "epub" | "html",
        approvedOnly,
      });
      const responseBody = typeof artifact.payload === "string"
        ? artifact.payload
        : new Uint8Array(artifact.payload);
      return new Response(responseBody, {
        headers: {
          "Content-Type": artifact.contentType,
          "Content-Disposition": `attachment; filename="${artifact.fileName}"`,
        },
      });
    } catch {
      return c.json({ error: "Export failed" }, 500);
    }
  });

  // --- Export to file (save to project dir) ---

  app.post("/api/v1/books/:id/export-save", async (c) => {
    const id = c.req.param("id");
    const { format, approvedOnly } = await c.req.json<{ format?: string; approvedOnly?: boolean }>().catch(() => ({ format: "txt", approvedOnly: false }));
    // Runtime whitelist — prevent arbitrary file extension injection
    const ALLOWED_EXPORT_FORMATS = new Set(["txt", "md", "html", "epub"]);
    const fmt = format ?? "txt";
    if (!ALLOWED_EXPORT_FORMATS.has(fmt)) {
      return c.json({ error: `不支持的导出格式 "${fmt}"，仅支持 txt/md/html/epub` }, 400);
    }

    try {
      const result = await withPipeline("export-save", await buildPipelineConfig(), async (pipeline) => {
        const tools = createInteractionToolsFromDeps(pipeline, state);
        const bookDir = state.bookDir(id);
        const outputPath = join(bookDir, `${id}.${fmt === "epub" ? "epub" : fmt}`);
        const r = await processProjectInteractionRequest({
          projectRoot: root,
          request: {
            intent: "export_book",
            bookId: id,
            format: fmt as "txt" | "md" | "epub" | "html",
            approvedOnly,
            outputPath,
          },
          tools,
          activeBookId: id,
        });
        return {
          ok: true,
          path: (r.details?.outputPath as string | undefined) ?? outputPath,
          format: fmt,
          chapters: (r.details?.chaptersExported as number | undefined) ?? 0,
        };
      });
      return c.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Provide a more specific error for empty books
      if (msg.includes("no chapters") || msg.includes("No chapters") || msg.includes("empty")) {
        return c.json({ error: "当前书籍没有可导出的章节，请先创作章节内容。" }, 400);
      }
      return c.json({ error: `导出失败：${msg}` }, 500);
    }
  });

  // --- Genre detail + copy ---

  app.get("/api/v1/genres/:id", async (c) => {
    const genreId = c.req.param("id");
    try {
      const { readGenreProfile } = await import("@actalk/inkos-core");
      const { profile, body } = await readGenreProfile(root, genreId);
      return c.json({ profile, body });
    } catch (e) {
      return c.json({ error: String(e) }, 404);
    }
  });

  app.post("/api/v1/genres/:id/copy", async (c) => {
    const genreId = c.req.param("id");
    if (/[/\\\0]/.test(genreId) || genreId.includes("..")) {
      throw new ApiError(400, "INVALID_GENRE_ID", `Invalid genre ID: "${genreId}"`);
    }
    try {
      const { getBuiltinGenresDir } = await import("@actalk/inkos-core");
      const { mkdir: mkdirFs, copyFile } = await import("node:fs/promises");
      const builtinDir = getBuiltinGenresDir();
      const projectGenresDir = join(root, "genres");
      await mkdirFs(projectGenresDir, { recursive: true });
      await copyFile(join(builtinDir, `${genreId}.md`), join(projectGenresDir, `${genreId}.md`));
      return c.json({ ok: true, path: `genres/${genreId}.md` });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Model overrides ---
  // (extracted to routes/project-config.ts, registered above)

  // --- Notify channels ---
  // (extracted to routes/project-config.ts, registered above)

  // --- Voice Profiles ---

  // --- AIGC Detection ---

  app.post("/api/v1/books/:id/detect/:chapter", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const bookDir = state.bookDir(id);

    try {
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const paddedNum = String(chapterNum).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);

      const content = await readFile(join(chaptersDir, match), "utf-8");
      const { analyzeAITells } = await import("@actalk/inkos-core");
      const result = analyzeAITells(content);
      return c.json({ chapterNumber: chapterNum, ...result });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Truth file edit ---

  app.put("/api/v1/books/:id/truth/:file{.+}", async (c) => {
    const id = c.req.param("id");
    await assertBookDirectoryExists(state, id);
    const file = c.req.param("file");
    const body: { content?: unknown } = await c.req.json<{ content?: unknown }>().catch(() => ({}));
    if (typeof body.content !== "string") {
      return c.json({ error: "content must be a string" }, 400);
    }

    const bookDir = state.bookDir(id);
    const resolved = resolveTruthFilePath(bookDir, file);
    if (!resolved) {
      return c.json({ error: "Invalid truth file" }, 400);
    }
    // Legacy pointer shims are read-only in new-layout books: writing
    // story_bible.md or book_rules.md does nothing at runtime (the pipeline
    // reads outline/ instead). For pre-Phase-5 books these ARE authoritative.
    if (LEGACY_SHIM_FILES.has(file)) {
      const { isNewLayoutBook } = await import("@actalk/inkos-core");
      if (await isNewLayoutBook(bookDir)) {
        return c.json(
          { error: "Read-only compatibility shim", authoritativePath: "outline/story_frame.md" },
          409,
        );
      }
    }
    const { writeFile: writeFileFs, mkdir: mkdirFs } = await import("node:fs/promises");
    const { dirname: dirnameFs } = await import("node:path");
    await mkdirFs(dirnameFs(resolved), { recursive: true });
    await writeFileFs(resolved, body.content, "utf-8");
    return c.json({ ok: true, file, size: body.content.length });
  });

  // =============================================
  // NEW ENDPOINTS — CLI parity
  // =============================================

  // --- Book Delete ---
  // (extracted to routes/books.ts, registered above)

  // --- Book Update ---
  // (extracted to routes/books.ts, registered above)

  // --- Write Rewrite (specific chapter) ---

  app.post("/api/v1/books/:id/rewrite/:chapter", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const body: { brief?: string } = await c.req
      .json<{ brief?: string }>()
      .catch(() => ({}));

    broadcast("rewrite:start", { bookId: id, chapter: chapterNum });
    try {
      const rollbackTarget = chapterNum - 1;
      const discarded = await state.rollbackToChapter(id, rollbackTarget);
      const pipelineConfig = await buildPipelineConfig({ externalContext: body.brief });
      withPipeline("rewrite-next", pipelineConfig, async (pipeline) => {
        const result = await pipeline.writeNextChapter(id);
        broadcast("rewrite:complete", { bookId: id, chapterNumber: result.chapterNumber, title: result.title, wordCount: result.wordCount });
      }).catch(
        (e) => broadcast("rewrite:error", { bookId: id, error: e instanceof Error ? e.message : String(e) }),
      );
      return c.json({ status: "rewriting", bookId: id, chapter: chapterNum, rolledBackTo: rollbackTarget, discarded });
    } catch (e) {
      broadcast("rewrite:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/resync/:chapter", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const body: { brief?: string } = await c.req
      .json<{ brief?: string }>()
      .catch(() => ({}));

    try {
      const result = await withPipeline("resync-chapter", await buildPipelineConfig({ externalContext: body.brief }), async (pipeline) => {
        return pipeline.resyncChapterArtifacts(id, chapterNum);
      });
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Detect All chapters ---

  app.post("/api/v1/books/:id/detect-all", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    const bookDir = state.bookDir(id);

    try {
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const mdFiles = files.filter((f) => f.endsWith(".md") && /^\d{4}/.test(f)).sort();
      const { analyzeAITells } = await import("@actalk/inkos-core");

      const results = await Promise.all(
        mdFiles.map(async (f) => {
          const num = parseInt(f.slice(0, 4), 10);
          const content = await readFile(join(chaptersDir, f), "utf-8");
          const result = analyzeAITells(content);
          return { chapterNumber: num, filename: f, ...result };
        }),
      );
      return c.json({ bookId: id, results });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Detect Stats ---

  app.get("/api/v1/books/:id/detect/stats", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    try {
      const { loadDetectionHistory, analyzeDetectionInsights } = await import("@actalk/inkos-core");
      const bookDir = state.bookDir(id);
      const history = await loadDetectionHistory(bookDir);
      const insights = analyzeDetectionInsights(history);
      return c.json(insights);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Genre Create ---

  app.post("/api/v1/genres/create", async (c) => {
    const body = await c.req.json<{
      id: string; name: string; language?: string;
      chapterTypes?: string[]; fatigueWords?: string[];
      numericalSystem?: boolean; powerScaling?: boolean; eraResearch?: boolean;
      pacingRule?: string; satisfactionTypes?: string[]; auditDimensions?: number[];
      body?: string;
    }>();

    if (!body.id || !body.name) {
      return c.json({ error: "id and name are required" }, 400);
    }
    if (/[/\\\0]/.test(body.id) || body.id.includes("..")) {
      throw new ApiError(400, "INVALID_GENRE_ID", `Invalid genre ID: "${body.id}"`);
    }

    const { writeFile: writeFileFs, mkdir: mkdirFs } = await import("node:fs/promises");
    const genresDir = join(root, "genres");
    await mkdirFs(genresDir, { recursive: true });

    const frontmatter = [
      "---",
      `name: ${yamlScalar(body.name)}`,
      `id: ${yamlScalar(body.id)}`,
      `language: ${yamlScalar(body.language ?? "zh")}`,
      `chapterTypes: ${JSON.stringify(body.chapterTypes ?? [])}`,
      `fatigueWords: ${JSON.stringify(body.fatigueWords ?? [])}`,
      `numericalSystem: ${body.numericalSystem ?? false}`,
      `powerScaling: ${body.powerScaling ?? false}`,
      `eraResearch: ${body.eraResearch ?? false}`,
      `pacingRule: ${yamlScalar(body.pacingRule ?? "")}`,
      `satisfactionTypes: ${JSON.stringify(body.satisfactionTypes ?? [])}`,
      `auditDimensions: ${JSON.stringify(body.auditDimensions ?? [])}`,
      "---",
      "",
      body.body ?? "",
    ].join("\n");

    await writeFileFs(join(genresDir, `${body.id}.md`), frontmatter, "utf-8");
    return c.json({ ok: true, id: body.id });
  });

  // --- Genre Edit ---

  app.put("/api/v1/genres/:id", async (c) => {
    const genreId = c.req.param("id");
    if (/[/\\\0]/.test(genreId) || genreId.includes("..")) {
      throw new ApiError(400, "INVALID_GENRE_ID", `Invalid genre ID: "${genreId}"`);
    }

    const body = await c.req.json<{ profile: Record<string, unknown>; body: string }>();
    const { writeFile: writeFileFs, mkdir: mkdirFs } = await import("node:fs/promises");
    const genresDir = join(root, "genres");
    await mkdirFs(genresDir, { recursive: true });

    const p = body.profile;
    const frontmatter = [
      "---",
      `name: ${yamlScalar(p.name ?? genreId)}`,
      `id: ${yamlScalar(p.id ?? genreId)}`,
      `language: ${yamlScalar(p.language ?? "zh")}`,
      `chapterTypes: ${JSON.stringify(p.chapterTypes ?? [])}`,
      `fatigueWords: ${JSON.stringify(p.fatigueWords ?? [])}`,
      `numericalSystem: ${p.numericalSystem ?? false}`,
      `powerScaling: ${p.powerScaling ?? false}`,
      `eraResearch: ${p.eraResearch ?? false}`,
      `pacingRule: ${yamlScalar(p.pacingRule ?? "")}`,
      `satisfactionTypes: ${JSON.stringify(p.satisfactionTypes ?? [])}`,
      `auditDimensions: ${JSON.stringify(p.auditDimensions ?? [])}`,
      "---",
      "",
      body.body ?? "",
    ].join("\n");

    await writeFileFs(join(genresDir, `${genreId}.md`), frontmatter, "utf-8");
    return c.json({ ok: true, id: genreId });
  });

  // --- Genre Delete (project-level only) ---

  app.delete("/api/v1/genres/:id", async (c) => {
    const genreId = c.req.param("id");
    if (/[/\\\0]/.test(genreId) || genreId.includes("..")) {
      throw new ApiError(400, "INVALID_GENRE_ID", `Invalid genre ID: "${genreId}"`);
    }

    const filePath = join(root, "genres", `${genreId}.md`);
    try {
      const { rm } = await import("node:fs/promises");
      await rm(filePath);
      return c.json({ ok: true, id: genreId });
    } catch (e) {
      return c.json({ error: `Genre "${genreId}" not found in project` }, 404);
    }
  });

  // --- Style Analyze ---

  app.post("/api/v1/style/analyze", async (c) => {
    const { text, sourceName } = await c.req.json<{ text: string; sourceName: string }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);

    try {
      const { analyzeStyle } = await import("@actalk/inkos-core");
      const profile = analyzeStyle(text, sourceName ?? "unknown");
      return c.json(profile);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Pre-flight: check that @actalk/inkos-core is built before any style endpoint ---
  async function ensureCoreBuilt(): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await import("@actalk/inkos-core");
      return { ok: true };
    } catch {
      return { ok: false, error: "@actalk/inkos-core is not built. Run `pnpm --filter @actalk/inkos-core exec tsc` first." };
    }
  }

  app.post("/api/v1/style/diagnostics", async (c) => {
    const coreBuilt = await ensureCoreBuilt();
    if (!coreBuilt.ok) return c.json({ error: coreBuilt.error }, 503);

    const raw = await c.req.json().catch(() => null);
    const parsed = DiagnosticsRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    const { text, language } = parsed.data;
    if (!text.trim()) return c.json({ error: "text is required" }, 400);

    try {
      const { runFullDiagnostics } = await import("@actalk/inkos-core");
      const diagnostics = runFullDiagnostics(text, language ?? "zh");
      return c.json(diagnostics);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- AI-Tells analysis for arbitrary text (standalone, not chapter-bound) ---

  app.post("/api/v1/style/ai-tells", async (c) => {
    const raw = await c.req.json().catch(() => null);
    if (!raw || typeof raw.text !== "string" || !raw.text.trim()) {
      return c.json({ error: "text is required" }, 400);
    }
    const { text, language } = raw as { text: string; language?: string };
    try {
      const { analyzeAITells } = await import("@actalk/inkos-core");
      const result = analyzeAITells(text, language === "en" ? "en" : "zh");
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Style Comparison & Adjustment Plan ---

  app.post("/api/v1/style/compare", async (c) => {
    const coreBuilt = await ensureCoreBuilt();
    if (!coreBuilt.ok) return c.json({ error: coreBuilt.error }, 503);

    const raw = await c.req.json().catch(() => null);
    const parsed = CompareRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    const { text, targetAuthorId, language } = parsed.data;
    if (!text.trim()) return c.json({ error: "text is required" }, 400);

    try {
      const authorData = await getAuthorProfile(root, targetAuthorId);
      if (!authorData) {
        return c.json({ error: `Author "${targetAuthorId}" not found` }, 404);
      }
      if (language && authorData.profile.language !== language) {
        return c.json({ error: `Author language is "${authorData.profile.language}", not "${language}"` }, 400);
      }
      const result = compareWithAuthorProfile(text, authorData.profile);
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/style/adjustments/plan", async (c) => {
    const coreBuilt = await ensureCoreBuilt();
    if (!coreBuilt.ok) return c.json({ error: coreBuilt.error }, 503);

    const raw = await c.req.json().catch(() => null);
    const parsed = AdjustmentPlanRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    const { text, targetAuthorId, maxSuggestions } = parsed.data;
    if (!text.trim()) return c.json({ error: "text is required" }, 400);

    try {
      const { runFullDiagnostics } = await import("@actalk/inkos-core");
      const diagnostics = runFullDiagnostics(text);

      let comparison: ReturnType<typeof compareWithAuthorProfile> | undefined;
      let authorProfile: AuthorStyleProfile | undefined;

      if (targetAuthorId) {
        const authorData = await getAuthorProfile(root, targetAuthorId);
        if (!authorData) {
          return c.json({ error: `Author "${targetAuthorId}" not found` }, 404);
        }
        authorProfile = authorData.profile;
        comparison = compareWithAuthorProfile(text, authorProfile);
      }

      const plan = generateAdjustmentPlan(text, diagnostics, {
        targetAuthorProfile: authorProfile,
        comparison,
        maxSuggestions,
      });
      return c.json(plan);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Style Rewrite Preview ---

  app.post("/api/v1/style/adjustments/preview", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = RewritePreviewRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    const { text, sourceHash, targetAuthorId, authorProfileVersion, selectedSuggestionIds } = parsed.data;
    if (!text.trim()) return c.json({ error: "text is required" }, 400);

    try {
      // 1. Load author profile
      const authorData = await getAuthorProfile(root, targetAuthorId);
      if (!authorData) {
        return c.json({ error: `Author "${targetAuthorId}" not found` }, 404);
      }
      if (authorData.profile.version !== authorProfileVersion) {
        return c.json({ error: "Author profile version has changed; regenerate plan" }, 409);
      }

      // 2. Regenerate diagnostics and plan from current text
      const { runFullDiagnostics } = await import("@actalk/inkos-core");
      const diagnostics = runFullDiagnostics(text);
      const plan = generateAdjustmentPlan(text, diagnostics, {
        targetAuthorProfile: authorData.profile,
        comparison: compareWithAuthorProfile(text, authorData.profile),
      });

      // 3. Validate sourceHash
      if (plan.sourceHash !== sourceHash) {
        return c.json({ error: "Source text has changed; regenerate plan" }, 409);
      }

      const validSuggestionIds = new Set(plan.suggestions.map((suggestion) => suggestion.id));
      const missingSuggestionIds = selectedSuggestionIds.filter((id) => !validSuggestionIds.has(id));
      if (missingSuggestionIds.length > 0) {
        return c.json({ error: "Selected suggestions are stale; regenerate plan" }, 409);
      }

      // 4. Create LLM client and rewrite
      const freshConfig = await loadProjectConfig(root, { consumer: "studio" });
      if (!freshConfig.llm?.provider) {
        return c.json({ error: "LLM provider not configured; please check your API settings" }, 503);
      }
      const client = createLLMClient(freshConfig.llm);
      if (!client._apiKey) {
        return c.json({ error: "API key not configured; please set INKOS_LLM_API_KEY in project .env or global ~/.inkos/.env" }, 503);
      }
      const model = freshConfig.llm.model ?? "deepseek-v4-flash";

      const result = await rewriteWithAuthorProfile({
        text,
        authorProfile: authorData.profile,
        plan,
        selectedSuggestionIds,
        preserveContent: true,
      }, { client, model });

      return c.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Distinguish LLM errors from validation errors
      if (msg.includes("LLM rewrite failed") || msg.includes("API returned")) {
        return c.json({ error: msg }, 503);
      }
      return c.json({ error: msg }, 500);
    }
  });

  // --- Style Import to Book ---

  app.post("/api/v1/books/:id/style/import", async (c) => {
    const id = c.req.param("id");
    const { text, sourceName } = await c.req.json<{ text: string; sourceName: string }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);

    broadcast("style:start", { bookId: id });
    try {
      const result = await withPipeline("style-guide", await buildPipelineConfig(), async (pipeline) => {
        return pipeline.generateStyleGuide(id, text, sourceName ?? "unknown");
      });
      broadcast("style:complete", { bookId: id });
      return c.json({ ok: true, result });
    } catch (e) {
      broadcast("style:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Style Library (Plus) ---

  app.post("/api/v1/style/extract-text", async (c) => {
    const { text, sourceName, fileType, maxChars, chunk } = await c.req.json<{
      text: string;
      sourceName: string;
      fileType?: "md" | "txt" | "jsonl" | "json" | "ts" | "js" | "html" | "css";
      maxChars?: number;
      chunk?: number;
    }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);
    if (fileType !== undefined && !isTextStyleFileType(fileType)) {
      return c.json({ error: "fileType must be md, txt, jsonl, json, ts, js, html or css" }, 400);
    }

    const effectiveMaxChars = typeof maxChars === "number" && Number.isFinite(maxChars)
      ? Math.min(Math.max(maxChars, 1000), MAX_CHARS)
      : MAX_CHARS;

    try {
      // 如果请求了指定分片，使用分片提取器
      if (typeof chunk === "number" && chunk >= 0) {
        const gen = extractDocumentChunked(text, sourceName ?? "sample", fileType ?? "txt", {
          maxChars: effectiveMaxChars,
        });
        let index = 0;
        for (const doc of gen) {
          if (index === chunk) return c.json(doc);
          index++;
        }
        return c.json({ error: `chunk ${chunk} out of range (total ${index})` }, 404);
      }

      const extracted = extractDocumentFromText(text, sourceName ?? "sample", fileType ?? "txt", {
        maxChars: effectiveMaxChars,
      });
      return c.json(extracted);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/style/import-url", async (c) => {
    const { url: rawUrl, maxChars } = await c.req.json<{ url: string; maxChars?: number }>();
    let url: URL;
    try {
      url = parseSafeStyleImportUrl(rawUrl ?? "");
      await assertSafeStyleImportTarget(url);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }

    try {
      let currentUrl = url;
      let response: Response | null = null;
      for (let redirectCount = 0; redirectCount < 4; redirectCount++) {
        response = await fetch(currentUrl, {
          headers: {
            "User-Agent": "NoFusion-Studio/1.0 (+style-import)",
            "Accept": "text/html, text/plain, text/markdown, application/json;q=0.8, */*;q=0.2",
          },
          redirect: "manual",
          signal: AbortSignal.timeout(60000),
        });

        if (![301, 302, 303, 307, 308].includes(response.status)) {
          break;
        }

        const location = response.headers.get("location");
        if (!location) break;
        try {
          currentUrl = parseSafeStyleImportUrl(new URL(location, currentUrl).toString());
          await assertSafeStyleImportTarget(currentUrl);
        } catch (e) {
          return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
        }
      }

      if (!response) {
        return c.json({ error: "Fetch failed" }, 502);
      }
      if (!response.ok) {
        return c.json({ error: `Fetch failed: ${response.status} ${response.statusText}` }, 502);
      }

      const contentLength = Number(response.headers.get("content-length") ?? "0");
      if (contentLength > 50_000_000) {
        return c.json({ error: "URL response is too large (max 50MB)" }, 413);
      }

      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      const raw = await readStyleImportBody(response, 50_000_000);
      const fileType =
        contentType.includes("html")
          ? "html"
          : contentType.includes("json")
            ? "json"
            : contentType.includes("markdown")
              ? "md"
              : "txt";
      const title = fileType === "html" ? extractHtmlTitle(raw) : null;
      const sourceName = title ? `${title} - ${currentUrl.hostname}` : currentUrl.toString();
      const extracted = extractDocumentFromText(raw, sourceName, fileType, {
        maxChars: typeof maxChars === "number" && Number.isFinite(maxChars)
          ? Math.min(Math.max(maxChars, 1000), MAX_CHARS)
          : MAX_CHARS,
      });

      return c.json({
        ...extracted,
        url: currentUrl.toString(),
        contentType,
        sourceName,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ error: message }, message.includes("too large") ? 413 : 502);
    }
  });

  app.get("/api/v1/style/authors", async (c) => {
    try {
      const index = await listAuthorProfiles(root);
      return c.json(index);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/style/authors", async (c) => {
    const { id, name, language, tags } = await c.req.json<{ id: string; name: string; language?: "zh" | "en"; tags?: string[] }>();
    if (!id?.trim() || !name?.trim()) return c.json({ error: "id and name are required" }, 400);
    if (!isSafeStyleId(id)) return c.json({ error: "invalid author id" }, 400);
    if (language !== undefined && language !== "zh" && language !== "en") {
      return c.json({ error: "language must be zh or en" }, 400);
    }
    if (tags !== undefined && !Array.isArray(tags)) {
      return c.json({ error: "tags must be an array" }, 400);
    }
    try {
      const cleanTags = tags?.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean);
      const profile = await createAuthorProfile(root, { id: id.trim(), name: name.trim(), language, tags: cleanTags });
      return c.json(profile);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.get("/api/v1/style/authors/:authorId", async (c) => {
    const authorId = c.req.param("authorId");
    if (!isSafeStyleId(authorId)) return c.json({ error: "invalid author id" }, 400);
    try {
      const result = await getAuthorProfile(root, authorId);
      if (!result) return c.json({ error: "Author not found" }, 404);
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/style/authors/:authorId/sources", async (c) => {
    const authorId = c.req.param("authorId");
    const { sourceId, fileName, fileType, text } = await c.req.json<{ sourceId: string; fileName: string; fileType: "md" | "txt" | "jsonl" | "json" | "ts" | "js" | "html" | "css"; text: string }>();
    if (!sourceId?.trim() || !text?.trim()) return c.json({ error: "sourceId and text are required" }, 400);
    if (!isSafeStyleId(authorId)) return c.json({ error: "invalid author id" }, 400);
    if (!isSafeStyleId(sourceId)) return c.json({ error: "invalid source id" }, 400);
    if (!isTextStyleFileType(fileType)) return c.json({ error: "fileType must be md, txt, jsonl, json, ts, js, html or css" }, 400);
    try {
      const source = await addStyleSource(root, {
        authorId,
        sourceId: sourceId.trim(),
        fileName: fileName ?? sourceId,
        fileType,
        text,
      });
      return c.json(source);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/style/authors/:authorId/reanalyze", async (c) => {
    const authorId = c.req.param("authorId");
    if (!isSafeStyleId(authorId)) return c.json({ error: "invalid author id" }, 400);
    try {
      const profile = await reanalyzeAuthorProfile(root, authorId);
      return c.json(profile);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.delete("/api/v1/style/authors/:authorId", async (c) => {
    const authorId = c.req.param("authorId");
    if (!isSafeStyleId(authorId)) return c.json({ error: "invalid author id" }, 400);
    try {
      await deleteAuthorProfile(root, authorId);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/style/authors/:authorId/diagnostics", async (c) => {
    const authorId = c.req.param("authorId");
    if (!isSafeStyleId(authorId)) return c.json({ error: "invalid author id" }, 400);
    const { data } = await c.req.json<{ data: unknown }>();
    if (!data) return c.json({ error: "data is required" }, 400);
    try {
      const id = crypto.randomUUID().slice(0, 8);
      const entry = await saveAuthorDiagnostics(root, authorId, id, data);
      return c.json(entry);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.get("/api/v1/style/authors/:authorId/diagnostics", async (c) => {
    const authorId = c.req.param("authorId");
    if (!isSafeStyleId(authorId)) return c.json({ error: "invalid author id" }, 400);
    try {
      const entries = await listAuthorDiagnostics(root, authorId);
      return c.json({ entries });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.get("/api/v1/style/authors/:authorId/diagnostics/:diagnosticsId", async (c) => {
    const authorId = c.req.param("authorId");
    const diagnosticsId = c.req.param("diagnosticsId");
    if (!isSafeStyleId(authorId)) return c.json({ error: "invalid author id" }, 400);
    try {
      const data = await getAuthorDiagnostics(root, authorId, diagnosticsId);
      if (!data) return c.json({ error: "not found" }, 404);
      return c.json(data);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/style/apply-author", async (c) => {
    const bookId = c.req.param("id");
    const { authorId } = await c.req.json<{ authorId: string }>();
    if (!authorId?.trim()) return c.json({ error: "authorId is required" }, 400);
    if (!isSafeStyleId(authorId)) return c.json({ error: "invalid author id" }, 400);

    broadcast("style:start", { bookId, type: "apply-author", authorId });
    try {
      const result = await getAuthorProfile(root, authorId);
      if (!result) {
        broadcast("style:error", { bookId, type: "apply-author", authorId, error: "Author not found" });
        return c.json({ error: "Author not found" }, 404);
      }

      const bookDir = state.bookDir(bookId);
      const storyDir = join(bookDir, "story");
      await mkdir(storyDir, { recursive: true });

      // Write aggregated style_profile.json
      const profilePath = join(storyDir, "style_profile.json");
      await writeFile(profilePath, JSON.stringify(result.profile.aggregateProfile, null, 2), "utf-8");

      // Build deterministic style guide from aggregate profile
      const book = await state.loadBookConfig(bookId);
      const lang = book.language ?? "zh";
      const p = result.profile.aggregateProfile;
      const guide = lang === "en"
        ? `# Style Guide\n\n**Source**: Author profile "${result.profile.name}"\n\n## Statistical Fingerprint\n- Average sentence length: ${p.avgSentenceLength.toFixed(1)} chars\n- Sentence length std dev: ${p.sentenceLengthStdDev.toFixed(1)}\n- Average paragraph length: ${p.avgParagraphLength.toFixed(0)} chars\n- Paragraph length range: ${p.paragraphLengthRange.min} - ${p.paragraphLengthRange.max}\n- Vocabulary diversity (TTR): ${(p.vocabularyDiversity * 100).toFixed(1)}%\n${p.topPatterns.length > 0 ? `\n## Top Patterns\n${p.topPatterns.map((x: string) => `- ${x}`).join("\n")}` : ""}\n${p.rhetoricalFeatures.length > 0 ? `\n## Rhetorical Features\n${p.rhetoricalFeatures.map((x: string) => `- ${x}`).join("\n")}` : ""}\n`
        : `# 文风指南\n\n**来源**：作家档案「${result.profile.name}」\n\n## 统计指纹\n- 平均句长：${p.avgSentenceLength.toFixed(1)} 字\n- 句长标准差：${p.sentenceLengthStdDev.toFixed(1)}\n- 平均段落长度：${p.avgParagraphLength.toFixed(0)} 字\n- 段落长度范围：${p.paragraphLengthRange.min} - ${p.paragraphLengthRange.max}\n- 词汇多样性（TTR）：${(p.vocabularyDiversity * 100).toFixed(1)}%\n${p.topPatterns.length > 0 ? `\n## 高频句式\n${p.topPatterns.map((x: string) => `- ${x}`).join("\n")}` : ""}\n${p.rhetoricalFeatures.length > 0 ? `\n## 修辞特征\n${p.rhetoricalFeatures.map((x: string) => `- ${x}`).join("\n")}` : ""}\n`;

      const guidePath = join(storyDir, "style_guide.md");
      await writeFile(guidePath, guide, "utf-8");

      // Write style source tracking
      const styleSourcePath = join(storyDir, "style_source.json");
      await writeFile(
        styleSourcePath,
        JSON.stringify(
          {
            styleProfileId: authorId,
            styleProfileName: result.profile.name,
            styleAppliedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        "utf-8",
      );

      broadcast("style:complete", { bookId, type: "apply-author", authorId });
      return c.json({
        ok: true,
        bookId,
        authorId,
        authorName: result.profile.name,
        styleProfilePath: "story/style_profile.json",
        styleGuidePath: "story/style_guide.md",
      });
    } catch (e) {
      broadcast("style:error", { bookId, type: "apply-author", authorId, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/style/preprocess", async (c) => {
    const raw = await c.req.json();
    const parse = PreprocessRequestSchema.safeParse(raw);
    if (!parse.success) {
      const first = parse.error.issues[0];
      if (first?.code === "too_big") {
        return c.json({ error: "PAYLOAD_TOO_LARGE", message: `Text exceeds ${MAX_PREPROCESS_TEXT_CHARS} characters`, maxChars: MAX_PREPROCESS_TEXT_CHARS }, 413);
      }
      return c.json({ error: "VALIDATION_ERROR", message: parse.error.message }, 400);
    }
    const { text, options } = parse.data;
    if (!text.trim()) return c.json({ error: "text is required" }, 400);
    try {
      const { preprocessText } = await import("@actalk/inkos-core");
      const result = preprocessText(text, options);
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/style/relayout", async (c) => {
    const raw = await c.req.json();
    const parse = RelayoutRequestSchema.safeParse(raw);
    if (!parse.success) {
      const first = parse.error.issues[0];
      if (first?.code === "too_big") {
        return c.json({ error: "PAYLOAD_TOO_LARGE", message: `Text exceeds ${MAX_PREPROCESS_TEXT_CHARS} characters`, maxChars: MAX_PREPROCESS_TEXT_CHARS }, 413);
      }
      return c.json({ error: "VALIDATION_ERROR", message: parse.error.message }, 400);
    }
    const { text, options } = parse.data;
    if (!text.trim()) return c.json({ error: "text is required" }, 400);
    try {
      const { relayoutText } = await import("@actalk/inkos-core");
      const result = relayoutText(text, options);
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Style Input Inspection ---

  app.post("/api/v1/style/preprocess/inspect", async (c) => {
    const raw = await c.req.json();
    const parse = InspectRequestSchema.safeParse(raw);
    if (!parse.success) {
      const first = parse.error.issues[0];
      if (first?.code === "too_big") {
        return c.json({ error: "PAYLOAD_TOO_LARGE", message: `Text exceeds ${MAX_PREPROCESS_TEXT_CHARS} characters`, maxChars: MAX_PREPROCESS_TEXT_CHARS }, 413);
      }
      return c.json({ error: "VALIDATION_ERROR", message: parse.error.message }, 400);
    }
    const { text, checks } = parse.data;
    if (!text.trim()) return c.json({ error: "text is required" }, 400);
    try {
      const { inspectText: runInspect } = await import("./style-preprocess-adapter.js");
      const result = runInspect(text, checks);
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Style Rhetoric Deduplication ---

  /**
   * POST /api/v1/style/rhetoric/rewrite
   * Build a deduplication prompt for the given findings.
   * The caller sends the prompt to the LLM provider separately.
   */
  app.post("/api/v1/style/rhetoric/rewrite", async (c) => {
    const raw = await c.req.json<{
      text: string;
      findings?: unknown[];
      categories?: string[];
      mode?: string;
    }>();
    if (!raw.text?.trim()) return c.json({ error: "text is required" }, 400);
    try {
      const { buildDedupePrompt, detectDuplicateRhetoric } = await import("@actalk/inkos-core");
      // Support both `findings` (pre-computed) and `categories` (frontend shorthand)
      let findings: unknown[] | undefined;
      if (Array.isArray(raw.findings)) {
        findings = raw.findings;
      } else if (Array.isArray(raw.categories) && raw.categories.length) {
        findings = raw.categories.map((cat) => ({
          category: cat,
          label: cat,
          count: 0,
          perThousandChars: 0,
          severity: "low" as const,
          examples: [] as Array<{ text: string }>,
        }));
      } else {
        const detected = detectDuplicateRhetoric(raw.text, "zh");
        findings = detected?.findings as unknown[] | undefined;
      }
      if (!Array.isArray(findings)) {
        return c.json({ error: "findings must be an array" }, 400);
      }
      const prompt = buildDedupePrompt(raw.text, findings as any[], (raw.mode ?? "replace") as any);
      return c.json({ prompt });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  /**
   * POST /api/v1/style/rhetoric/detect
   * Detect duplicated rhetoric patterns — returns findings only, no prompt.
   * Separate endpoint from /rewrite to avoid frontend reading {prompt} as {findings}.
   */
  app.post("/api/v1/style/rhetoric/detect", async (c) => {
    const raw = await c.req.json<{ text: string; language?: string }>();
    if (!raw.text?.trim()) return c.json({ error: "text is required" }, 400);
    try {
      const { detectDuplicateRhetoric } = await import("@actalk/inkos-core");
      const language = raw.language === "en" ? "en" as const : "zh" as const;
      const result = detectDuplicateRhetoric(raw.text, language);
      const findings = Array.isArray(result?.findings) ? result.findings : [];
      return c.json({ findings });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  /**
   * POST /api/v1/style/rhetoric/aware-prompt
   * Build a rhetoric-aware system prompt for Pipeline writer.
   */
  app.post("/api/v1/style/rhetoric/aware-prompt", async (c) => {
    const raw = await c.req.json<{
      basePrompt: string;
      contextText: string;
      maxPerThousandChars?: Record<string, number>;
    }>();
    if (!raw.basePrompt || !raw.contextText) return c.json({ error: "basePrompt and contextText are required" }, 400);
    try {
      const { buildRhetoricAwarePrompt } = await import("@actalk/inkos-core");
      const prompt = buildRhetoricAwarePrompt(raw.basePrompt, raw.contextText, raw.maxPerThousandChars);
      return c.json({ prompt });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Style Paragraph Deduplication ---

  /**
   * POST /api/v1/style/paragraph/dedup
   * Detect duplicate and similar paragraphs in text.
   */
  app.post("/api/v1/style/paragraph/dedup", async (c) => {
    const raw = await c.req.json<{ text: string; threshold?: number; minLength?: number }>();
    if (!raw.text?.trim()) return c.json({ error: "text is required" }, 400);
    // Sanitise numeric inputs
    const threshold = typeof raw.threshold === "number" && raw.threshold >= 0 && raw.threshold <= 1
      ? raw.threshold : 0.8;
    const minLength = typeof raw.minLength === "number" && Number.isFinite(raw.minLength) && raw.minLength >= 1
      ? Math.floor(raw.minLength) : 20;
    try {
      const { detectDuplicateParagraphs } = await import("@actalk/inkos-core");
      const result = detectDuplicateParagraphs(raw.text, {
        similarityThreshold: threshold,
        minParagraphLength: minLength,
      });
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Style Readability Score ---

  /**
   * POST /api/v1/style/readability/score
   * Compute readability score for the given text. Uses POST to avoid long text in URL.
   */
  app.post("/api/v1/style/readability/score", async (c) => {
    const raw = await c.req.json<{ text: string; language?: string }>();
    if (!raw.text?.trim()) return c.json({ error: "text is required" }, 400);
    try {
      const { computeReadabilityScore } = await import("@actalk/inkos-core");
      const score = computeReadabilityScore(raw.text);
      return c.json(score);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Author Search ---

  /**
   * POST /api/v1/style/authors/search
   * Search the internet for author works.
   */
  app.post("/api/v1/style/authors/search", async (c) => {
    const raw = await c.req.json<{ authorName: string; language?: string }>();
    if (!raw.authorName?.trim()) return c.json({ error: "authorName is required" }, 400);
    try {
      const { searchAuthorWorks } = await import("./author-search.js");
      const results = await searchAuthorWorks({
        authorName: raw.authorName.trim(),
        language: (raw.language ?? "zh") as "zh" | "en",
      });
      return c.json({ results });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  /**
   * POST /api/v1/style/authors/fetch
   * Fetch content from a URL for author analysis.
   */
  app.post("/api/v1/style/authors/fetch", async (c) => {
    const raw = await c.req.json<{ url: string; maxChars?: number }>();
    if (!raw.url?.trim()) return c.json({ error: "url is required" }, 400);
    try {
      // Reuse existing SSRF-safe URL parser
      const url = parseSafeStyleImportUrl(raw.url);
      await assertSafeStyleImportTarget(url);
      const { fetchUrl } = await import("@actalk/inkos-core");
      const content = await fetchUrl(url.toString(), raw.maxChars ?? 8000);
      return c.json({ content });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  /**
   * POST /api/v1/style/authors/samples/write
   * Write a fetched author sample to local MD file.
   */
  app.post("/api/v1/style/authors/samples/write", async (c) => {
    const raw = await c.req.json<{
      authorId: string;
      authorName: string;
      sourceUrl: string;
      fetchedAt: string;
      content: string;
      charCount: number;
    }>();
    if (!raw.authorId || !raw.content) return c.json({ error: "authorId and content are required" }, 400);
    try {
      assertSafeAuthorId(raw.authorId);
      const prjRoot = assertProjectRoot(process.env.INKOS_PROJECT_ROOT || c.req.header("x-project-root") || undefined, root);
      const { writeAuthorSample } = await import("./author-sample-writer.js");
      const result = await writeAuthorSample(prjRoot, raw);
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Author Distillation ---

  /**
   * POST /api/v1/style/authors/:authorId/distillations
   * Generate a new distillation draft from the current author profile.
   */
  app.post("/api/v1/style/authors/:authorId/distillations", async (c) => {
    const authorId = assertSafeAuthorId(c.req.param("authorId"));
    const prjRoot = assertProjectRoot(process.env.INKOS_PROJECT_ROOT || c.req.header("x-project-root") || undefined, root);
    try {
      const {
        getAuthorProfile,
        generateDistillation,
        loadDistillationEvidence,
        loadDistillationOverrides,
        saveDistillationDraft,
        loadCurrentDistillation,
      } = await import("@actalk/inkos-core");
      const authorData = await getAuthorProfile(prjRoot, authorId);
      if (!authorData) return c.json({ error: "Author not found" }, 404);
      // Load existing overrides as previous distillation context
      const evidence = await loadDistillationEvidence(prjRoot, authorId);
      const overrides = await loadDistillationOverrides(prjRoot, authorId);
      const previous = await loadCurrentDistillation(prjRoot, authorId);
      // Merge overrides into previous
      const mergedPrevious = previous
        ? { ...previous, rules: overrides.length > 0 ? overrides : previous.rules }
        : undefined;
      const result = generateDistillation({
        profile: authorData.profile,
        sources: authorData.sources,
        evidence: [...evidence],
        previous: mergedPrevious,
      });
      await saveDistillationDraft(prjRoot, authorId, result.distillation, result.markdown);
      return c.json(result.distillation, 201);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  /**
   * GET /api/v1/style/authors/:authorId/distillations/current
   * Get the current distillation (draft or published).
   */
  app.get("/api/v1/style/authors/:authorId/distillations/current", async (c) => {
    const authorId = assertSafeAuthorId(c.req.param("authorId"));
    const prjRoot = assertProjectRoot(process.env.INKOS_PROJECT_ROOT || c.req.header("x-project-root") || undefined, root);
    try {
      const { loadCurrentDistillation, getAuthorProfile } = await import("@actalk/inkos-core");
      const distillation = await loadCurrentDistillation(prjRoot, authorId);
      if (!distillation) return c.json({ error: "No distillation found. Generate one first." }, 404);
      const authorData = await getAuthorProfile(prjRoot, authorId);
      const currentProfileVersion = authorData?.profile.version ?? distillation.authorProfileVersion;
      return c.json({
        ...distillation,
        isStale: distillation.authorProfileVersion !== currentProfileVersion,
        currentAuthorProfileVersion: currentProfileVersion,
      });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  /**
   * PATCH /api/v1/style/authors/:authorId/distillations/current
   * Update distillation overrides (enable/disable rules, manual edits).
   */
  app.patch("/api/v1/style/authors/:authorId/distillations/current", async (c) => {
    const authorId = assertSafeAuthorId(c.req.param("authorId"));
    const prjRoot = assertProjectRoot(process.env.INKOS_PROJECT_ROOT || c.req.header("x-project-root") || undefined, root);
    try {
      const body = await c.req.json<{ overrides: unknown[] }>();
      const {
        saveDistillationOverrides,
        loadCurrentDistillation,
        saveDistillationDraft,
        generateDistillation,
        getAuthorProfile,
        loadDistillationEvidence,
      } = await import("@actalk/inkos-core");
      if (!body.overrides || !Array.isArray(body.overrides)) {
        return c.json({ error: "overrides array is required" }, 400);
      }
      await saveDistillationOverrides(prjRoot, authorId, body.overrides as any);
      // Regenerate draft with overrides
      const authorData = await getAuthorProfile(prjRoot, authorId);
      if (!authorData) return c.json({ error: "Author not found" }, 404);
      const evidence = await loadDistillationEvidence(prjRoot, authorId);
      const previous = await loadCurrentDistillation(prjRoot, authorId);
      const result = generateDistillation({
        profile: authorData.profile,
        sources: authorData.sources,
        evidence: [...evidence],
        previous: previous ?? undefined,
      });
      await saveDistillationDraft(prjRoot, authorId, result.distillation, result.markdown);
      return c.json(result.distillation);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  /**
   * POST /api/v1/style/authors/:authorId/distillations/current/publish
   * Publish the current distillation as an immutable version.
   */
  app.post("/api/v1/style/authors/:authorId/distillations/current/publish", async (c) => {
    const authorId = assertSafeAuthorId(c.req.param("authorId"));
    const prjRoot = assertProjectRoot(process.env.INKOS_PROJECT_ROOT || c.req.header("x-project-root") || undefined, root);
    try {
      const {
        loadCurrentDistillation,
        publishDistillation,
        getAuthorProfile,
      } = await import("@actalk/inkos-core");
      const distillation = await loadCurrentDistillation(prjRoot, authorId);
      if (!distillation) return c.json({ error: "No distillation to publish" }, 400);
      if (distillation.sampleAdequacy === "insufficient") {
        return c.json({ error: "Insufficient samples — cannot publish. Add more sources first." }, 400);
      }
      const authorData = await getAuthorProfile(prjRoot, authorId);
      const currentVersion = authorData?.profile.version ?? distillation.authorProfileVersion;
      if (distillation.authorProfileVersion !== currentVersion) {
        return c.json({
          error: "Author profile has changed since this distillation was generated. Regenerate first.",
          stale: true,
        }, 400);
      }
      // Load markdown from current.md
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      let markdown = "";
      try {
        markdown = await readFile(
          join(prjRoot, "style-library", "authors", authorId, "distillation", "current.md"),
          "utf-8",
        );
      } catch { /* use empty */ }
      const published = await publishDistillation(prjRoot, authorId, distillation, markdown);
      return c.json(published);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  /**
   * GET /api/v1/style/authors/:authorId/distillations/versions
   * List published distillation versions.
   */
  app.get("/api/v1/style/authors/:authorId/distillations/versions", async (c) => {
    const authorId = assertSafeAuthorId(c.req.param("authorId"));
    const prjRoot = assertProjectRoot(process.env.INKOS_PROJECT_ROOT || c.req.header("x-project-root") || undefined, root);
    try {
      const { listDistillationVersions } = await import("@actalk/inkos-core");
      const versions = await listDistillationVersions(prjRoot, authorId);
      return c.json({ versions });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Import Chapters ---

  // Step 1: Preview / plan import (no filesystem changes)
  app.post("/api/v1/books/:id/import/chapters/plan", async (c) => {
    const id = c.req.param("id");
    const { text, splitRegex, startNumber } = await c.req.json<{
      text: string;
      splitRegex?: string;
      startNumber?: number;
    }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);

    try {
      const plan = planChapterImport(text, { splitRegex, startNumber });
      return c.json({ plan });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // Step 2: Commit planned import (writes to filesystem)
  app.post("/api/v1/books/:id/import/chapters/commit", async (c) => {
    const id = c.req.param("id");
    const { plan } = await c.req.json<{ plan: ChapterImportPlan }>();
    if (!plan?.chapters?.length) return c.json({ error: "plan is required" }, 400);

    broadcast("import:start", { bookId: id, type: "chapters" });
    try {
      const chapters = plan.chapters.map((ch) => ({
        title: ch.title,
        content: ch.content,
        targetNumber: ch.targetNumber,
      }));
      // Determine resumeFrom: the minimum targetNumber tells the pipeline whether
      // this is a fresh import (1) or an append to an existing book (>1).
      // When resumeFrom > 1, the pipeline skips foundation generation and index clearing.
      const resumeFrom = Math.min(...chapters.map((ch) => ch.targetNumber ?? 0));
      const validResumeFrom = Number.isFinite(resumeFrom) && resumeFrom > 0 ? resumeFrom : 1;

      const result = await withPipeline("import-chapters", await buildPipelineConfig(), async (pipeline) => {
        return pipeline.importChapters({ bookId: id, chapters, resumeFrom: validResumeFrom });
      });
      broadcast("import:complete", { bookId: id, type: "chapters", count: result.importedCount });
      return c.json(result);
    } catch (e) {
      broadcast("import:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // Legacy direct import (kept for backward compatibility)
  /** @deprecated Use POST /api/v1/books/:id/import/chapters/plan + /commit instead. */
  app.post("/api/v1/books/:id/import/chapters", async (c) => {
    const id = c.req.param("id");
    const { text, splitRegex } = await c.req.json<{ text: string; splitRegex?: string }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);

    broadcast("import:start", { bookId: id, type: "chapters" });
    try {
      const { splitChapters } = await import("@actalk/inkos-core");
      const chapters = [...splitChapters(text, splitRegex)];

      const result = await withPipeline("import-chapters-legacy", await buildPipelineConfig(), async (pipeline) => {
        return pipeline.importChapters({ bookId: id, chapters });
      });
      broadcast("import:complete", { bookId: id, type: "chapters", count: result.importedCount });
      return c.json(result);
    } catch (e) {
      broadcast("import:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Import Canon ---

  app.post("/api/v1/books/:id/import/canon", async (c) => {
    const id = c.req.param("id");
    const { fromBookId } = await c.req.json<{ fromBookId: string }>();
    if (!fromBookId) return c.json({ error: "fromBookId is required" }, 400);

    broadcast("import:start", { bookId: id, type: "canon" });
    try {
      await withPipeline("import-canon", await buildPipelineConfig(), async (pipeline) => {
        await pipeline.importCanon(id, fromBookId);
      });
      broadcast("import:complete", { bookId: id, type: "canon" });
      return c.json({ ok: true });
    } catch (e) {
      broadcast("import:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Foundation Import (plan / commit) ---

  app.post("/api/v1/books/:id/import/foundation/plan", async (c) => {
    const id = c.req.param("id");
    const { sources, mode, instruction } = await c.req.json<{
      sources: Array<{ sourceName: string; fileType: string; text: string; purpose?: string }>;
      mode?: "supplement" | "rebuild";
      instruction?: string;
    }>();
    if (!sources?.length) return c.json({ error: "sources is required" }, 400);
    if (mode !== undefined && mode !== "supplement" && mode !== "rebuild") {
      return c.json({ error: "mode must be supplement or rebuild" }, 400);
    }

    try {
      const inputs: FoundationSourceInput[] = [];
      for (const source of sources) {
        if (
          !source
          || typeof source.sourceName !== "string"
          || typeof source.text !== "string"
          || !isDocumentFileType(source.fileType)
          || (source.purpose !== undefined && !isFoundationSourcePurpose(source.purpose))
        ) {
          return c.json({ error: "invalid foundation source" }, 400);
        }
        inputs.push({
          sourceName: source.sourceName,
          fileType: source.fileType,
          text: source.text,
          purpose: source.purpose,
        });
      }
      const result = await withPipeline("plan-foundation", await buildPipelineConfig(), async (pipeline) => {
        return pipeline.planFoundationImport(id, inputs, { mode, instruction });
      });

      if (result.proposed && result.roleChanges && result.foundationRevision) {
        const sourceBundle = buildFoundationSourceBundle(
          result.bundle.sources
            .filter((source) => source.purpose !== "chapter" && source.purpose !== "style")
            .map((source) => ({
              sourceName: source.sourceName,
              fileType: source.fileType,
              text: source.text,
              purpose: source.purpose,
              normalized: true,
            })),
        );
        const planId = randomUUID();
        foundationPlans.set(planId, {
          bookId: id,
          mode: mode ?? "supplement",
          proposed: result.proposed,
          foundationRevision: result.foundationRevision,
          sourceBundle,
          expiresAt: Date.now() + 30 * 60 * 1000,
        });
        // Persist to disk so plans survive server restart
        persistFoundationPlan(root, planId, foundationPlans.get(planId)!).catch((e) => {
          console.error("[studio] Failed to persist foundation plan:", e);
        });
        return c.json({
          planId,
          bundle: result.bundle,
          proposed: result.proposed,
          warnings: result.warnings,
          roleChanges: result.roleChanges,
        });
      }

      return c.json({
        planId: null,
        bundle: result.bundle,
        warnings: result.warnings,
        proposed: null,
        roleChanges: null,
      });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/import/foundation/commit", async (c) => {
    const id = c.req.param("id");
    const { planId } = await c.req.json<{ planId?: string }>();
    if (!planId) return c.json({ error: "planId is required" }, 400);
    await foundationPlansPromise;
    const plan = foundationPlans.get(planId);
    if (!plan || plan.bookId !== id || plan.expiresAt < Date.now()) {
      foundationPlans.delete(planId);
      removePersistedFoundationPlan(root, planId).catch((e) => {
        console.error("[studio] Failed to remove expired foundation plan:", e);
      });
      return c.json({ error: "foundation plan is missing or expired; generate a new preview" }, 409);
    }

    broadcast("import:start", { bookId: id, type: "foundation" });
    try {
      await withPipeline("commit-foundation-plan", await buildPipelineConfig(), async (pipeline) => {
        await pipeline.commitFoundationImport(id, plan.proposed, {
          mode: plan.mode,
          expectedRevision: plan.foundationRevision,
          sourceBundle: plan.sourceBundle,
        });
        foundationPlans.delete(planId);
        removePersistedFoundationPlan(root, planId).catch((e) => {
          console.error("[studio] Failed to remove committed foundation plan:", e);
        });
      });
      broadcast("import:complete", { bookId: id, type: "foundation" });
      return c.json({ ok: true });
    } catch (e) {
      broadcast("import:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Chapter Goals ---

  app.get("/api/v1/books/:id/chapter-goals", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    try {
      const state = new StateManager(root);
      const bookDir = state.bookDir(id);
      const index = await loadChapterGoals(bookDir);
      return c.json(index);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.put("/api/v1/books/:id/chapter-goals/:chapterNumber", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    const chapterNumber = Number(c.req.param("chapterNumber"));
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    const body = await c.req.json<Partial<ChapterGoalCard>>();
    try {
      const state = new StateManager(root);
      const bookDir = state.bookDir(id);
      const index = await loadChapterGoals(bookDir);
      const goal: ChapterGoalCard = {
        chapterNumber,
        ...getChapterGoal(index.goals, chapterNumber),
        ...body,
      };
      const next = upsertChapterGoal(index.goals, goal);
      await saveChapterGoals(bookDir, next);
      return c.json({ ok: true, goal });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.delete("/api/v1/books/:id/chapter-goals/:chapterNumber", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    const chapterNumber = Number(c.req.param("chapterNumber"));
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    try {
      const state = new StateManager(root);
      const bookDir = state.bookDir(id);
      const index = await loadChapterGoals(bookDir);
      const next = removeChapterGoal(index.goals, chapterNumber);
      await saveChapterGoals(bookDir, next);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Chapter Intents (author interview) ---

  app.get("/api/v1/books/:id/chapter-intents", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    try {
      const state = new StateManager(root);
      const bookDir = state.bookDir(id);
      const index = await loadChapterIntents(bookDir);
      return c.json(index);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.put("/api/v1/books/:id/chapter-intents/:chapterNumber", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    const chapterNumber = Number(c.req.param("chapterNumber"));
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    const body = await c.req.json<Partial<AuthorChapterIntent>>();
    try {
      const state = new StateManager(root);
      const bookDir = state.bookDir(id);
      const index = await loadChapterIntents(bookDir);
      const existing = getChapterIntent(index.intents, chapterNumber);
      const parsedIntent = AuthorChapterIntentSchema.safeParse({
        chapterNumber,
        coreNarrative: body.coreNarrative ?? existing?.coreNarrative ?? "",
        readerTakeaway: body.readerTakeaway ?? existing?.readerTakeaway ?? "",
        keyMoment: body.keyMoment ?? existing?.keyMoment ?? "",
        scenes: body.scenes ?? existing?.scenes ?? [],
        characterStates: body.characterStates ?? existing?.characterStates ?? [],
        requiredBeats: body.requiredBeats ?? existing?.requiredBeats ?? [],
        forbiddenMoves: body.forbiddenMoves ?? existing?.forbiddenMoves ?? [],
        pendingHookIds: body.pendingHookIds ?? existing?.pendingHookIds ?? [],
        narrativePosition: body.narrativePosition ?? existing?.narrativePosition ?? "rising",
        plotLine: body.plotLine ?? existing?.plotLine,
        interviewCompletedAt: body.interviewCompletedAt ?? existing?.interviewCompletedAt,
      });
      if (!parsedIntent.success) {
        return c.json({
          error: "Invalid chapter intent",
          issues: parsedIntent.error.issues,
        }, 400);
      }
      const intent: AuthorChapterIntent = parsedIntent.data;
      const next = upsertChapterIntent(index.intents, intent);
      await saveChapterIntents(bookDir, next);
      return c.json({ ok: true, intent: getChapterIntent(next, chapterNumber) });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.delete("/api/v1/books/:id/chapter-intents/:chapterNumber", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    const chapterNumber = Number(c.req.param("chapterNumber"));
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    try {
      const state = new StateManager(root);
      const bookDir = state.bookDir(id);
      const index = await loadChapterIntents(bookDir);
      const next = removeChapterIntent(index.intents, chapterNumber);
      await saveChapterIntents(bookDir, next);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Chapter Intent Suggestions (rule-based, no LLM) ---

  app.get("/api/v1/books/:id/chapter-intents/:chapterNumber/suggestions", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    const chapterNumber = Number(c.req.param("chapterNumber"));
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    try {
      const state = new StateManager(root);
      const bookDir = state.bookDir(id);
      const suggestions = await generateSuggestions(bookDir, chapterNumber);
      return c.json({ suggestions });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Endpoint Lock Check (M2/U8) ---
  // Reads the author's chapter intent (openingFrame/closingFrame/requiredBeats/forbiddenMoves)
  // and checks whether the written chapter content satisfies those constraints.

  app.get("/api/v1/books/:id/chapters/:chapterNumber/endpoint-check", async (c) => {
    const id = c.req.param("id");
    const chapterNumber = Number(c.req.param("chapterNumber"));
    await assertBookExists(state, id);
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    try {
      const bookDir = new StateManager(root).bookDir(id);
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");

      // Load chapter intent
      const intentsIdx = await loadChapterIntents(bookDir).catch(() => ({ intents: [] as ReadonlyArray<AuthorChapterIntent> }));
      const intent = getChapterIntent(intentsIdx.intents, chapterNumber);

      // Load chapter content
      const chaptersDir = join(bookDir, "chapters");
      let chapterContent = "";
      try {
        const { readdir: rd } = await import("node:fs/promises");
        const files = await rd(chaptersDir);
        const padded = String(chapterNumber).padStart(4, "0");
        const match = files.find((f) => f.startsWith(padded) && f.endsWith(".md"));
        if (match) {
          chapterContent = await readFile(join(chaptersDir, match), "utf-8");
        }
      } catch { /* no chapters yet */ }

      // Build checks array
      const checks: Array<{ name: string; passed: boolean; detail: string }> = [];
      const lang = "zh"; // could be derived from book config

      if (intent?.openingFrame) {
        const frame = intent.openingFrame.scene;
        const opening = chapterContent.slice(0, 200).toLowerCase();
        const hasOpening = opening.includes(frame.toLowerCase()) ||
          frame.toLowerCase().split(/\s+/).filter((w: string) => w.length > 1).every((w: string) => opening.includes(w));
        checks.push({
          name: "开篇框架",
          passed: hasOpening,
          detail: hasOpening ? "开篇与声明框架一致" : `预期开篇应包含："${frame}"`,
        });
        if (intent.openingFrame.forbiddenOpenings?.length) {
          for (const fb of intent.openingFrame.forbiddenOpenings) {
            const found = opening.includes(fb.toLowerCase());
            checks.push({
              name: `开篇禁止：${fb}`,
              passed: !found,
              detail: found ? "发现禁止的开篇模式" : "未发现禁止模式",
            });
          }
        }
      }

      if (intent?.closingFrame) {
        const frame = intent.closingFrame.scene;
        const closing = chapterContent.slice(-500).toLowerCase();
        const hasClosing = closing.includes(frame.toLowerCase()) ||
          frame.toLowerCase().split(/\s+/).filter((w: string) => w.length > 1).every((w: string) => closing.includes(w));
        checks.push({
          name: "收尾框架",
          passed: hasClosing,
          detail: hasClosing ? "收尾与声明框架一致" : `预期收尾应包含："${frame}"`,
        });
      }

      if (intent?.requiredBeats?.length) {
        for (const beat of intent.requiredBeats) {
          const found = chapterContent.toLowerCase().includes(beat.toLowerCase());
          checks.push({
            name: `必达事件：${beat}`,
            passed: found,
            detail: found ? "事件已达成" : "章节中未发现此事件",
          });
        }
      }

      if (intent?.forbiddenMoves?.length) {
        for (const move of intent.forbiddenMoves) {
          const found = chapterContent.toLowerCase().includes(move.toLowerCase());
          checks.push({
            name: `禁用动作：${move}`,
            passed: !found,
            detail: found ? "章节中发现禁用动作！" : "未发现禁用动作",
          });
        }
      }

      return c.json({
        chapterNumber,
        passed: checks.length > 0 ? checks.every((ch) => ch.passed) : true,
        checks,
        hasIntent: !!intent,
      });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Chapter Intent Interview (rule-based + quantitative triggers) ---

  app.get("/api/v1/books/:id/interview", async (c) => {
    const id = c.req.param("id");
    const chapterNumber = Number(c.req.query("chapter"));
    await assertBookExists(state, id);
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    try {
      const bookDir = new StateManager(root).bookDir(id);

      // Load existing intent to skip already-answered questions
      const intentsIdx = await loadChapterIntents(bookDir).catch(() => ({ intents: [] as ReadonlyArray<AuthorChapterIntent> }));
      const existingIntent = getChapterIntent(intentsIdx.intents, chapterNumber);

      // Load goals
      const goalsIdx = await loadChapterGoals(bookDir).catch(() => ({ goals: [] as ReadonlyArray<ChapterGoalCard> }));
      const chapterGoal = getChapterGoal(goalsIdx.goals, chapterNumber);

      // Build interview questions
      const questions: Array<{ id: string; question: string; context: string; level: number; prefill?: string }> = [];

      // Level 1: Core (always ask if unanswered)
      if (!existingIntent?.coreNarrative) {
        questions.push({
          id: "core_narrative",
          question: "用一句话说清：这一章在讲什么？",
          context: chapterGoal?.mainConflict
            ? `已设定核心矛盾：「${chapterGoal.mainConflict}」`
            : "还没有设定章节目标",
          level: 1,
        });
      }
      if (!existingIntent?.readerTakeaway) {
        questions.push({
          id: "reader_takeaway",
          question: "读者读完这一章后，你最希望他们感受到什么？",
          context: "思考读者的情感体验——紧张、释然、好奇、愤怒、温暖？",
          level: 1,
        });
      }
      if (!existingIntent?.keyMoment) {
        questions.push({
          id: "key_moment",
          question: "这一章最重要的一个画面或瞬间是什么？",
          context: "如果这一章只能让读者记住一个画面，那是什么？",
          level: 1,
        });
      }

      // Level 2: Scene planning
      if (!existingIntent?.scenes || existingIntent.scenes.length === 0) {
        questions.push({
          id: "scene_count",
          question: "这一章大概有几个场景？主要的场景切换是什么？",
          context: chapterGoal?.location
            ? `目标地点为「${chapterGoal.location}」`
            : "可以用地点切换来划分场景",
          level: 2,
          prefill: chapterGoal?.location ?? undefined,
        });
      }

      // Level 3: Character states
      questions.push({
        id: "character_emotion",
        question: "这一章出场的角色中，谁的情绪变化最大？从什么变为什么？",
        context: "角色的情绪变化是推动故事的情感引擎",
        level: 3,
      });

      // Level 4: Constraints
      questions.push({
        id: "must_avoid",
        question: "这一章绝对不能出现什么？",
        context: "比如：主角不能示弱、秘密不能暴露、某角色不能出场",
        level: 4,
      });

      // Quantitative creative triggers
      const triggers: Array<{ type: string; message: string; severity: "info" | "warning" | "critical" }> = [];

      // Trigger: overdue hooks
      try {
        const { readFile } = await import("node:fs/promises");
        const { join } = await import("node:path");
        const hooksPath = join(bookDir, "story", "state", "hooks.json");
        const raw = await readFile(hooksPath, "utf-8");
        const hooks = (JSON.parse(raw) as { hooks?: Array<{ hookId: string; status: string; halfLifeChapters?: number; lastAdvancedChapter: number }> }).hooks ?? [];
        const overdue = hooks.filter((h) =>
          h.status !== "resolved" && h.halfLifeChapters &&
          (chapterNumber - h.lastAdvancedChapter) > h.halfLifeChapters
        );
        if (overdue.length > 0) {
          triggers.push({
            type: "hooks_overdue",
            message: `${overdue.length} 条伏笔已逾期：${overdue.map((h) => h.hookId).join("、")}`,
            severity: overdue.length >= 3 ? "critical" : "warning",
          });
        }
        const activeCount = hooks.filter((h) => h.status !== "resolved").length;
        if (activeCount === 0) {
          triggers.push({
            type: "hooks_empty",
            message: "尚无活跃伏笔——建议在本章埋下至少一条新伏笔",
            severity: "info",
          });
        }
      } catch { /* hooks.json not found */ }

      // Trigger: chapter goal status
      if (!chapterGoal) {
        triggers.push({
          type: "goal_missing",
          message: "未设定本章目标——建议先在「目标」面板填写核心矛盾和必达事件",
          severity: "warning",
        });
      }

      // Trigger: first chapter guidance
      if (chapterNumber === 1) {
        triggers.push({
          type: "first_chapter",
          message: "这是第一章——建议在此章建立世界观基调、引入主角、埋下至少一条伏笔",
          severity: "info",
        });
      }

      // Trigger: chapter interval — check for consecutive same-type chapters
      try {
        const { readFile } = await import("node:fs/promises");
        const { join } = await import("node:path");
        const summariesPath = join(bookDir, "story", "chapter_summaries.md");
        const raw = await readFile(summariesPath, "utf-8");
        // Count how many consecutive "过渡" or "transition" chapters precede this one
        const lines = raw.split("\n");
        let consecutiveTransition = 0;
        for (const line of lines.reverse()) {
          if (line.includes("过渡") || line.includes("transition")) consecutiveTransition++;
          else break;
        }
        if (consecutiveTransition >= 3) {
          triggers.push({
            type: "rhythm_monotony",
            message: `连续 ${consecutiveTransition} 章为过渡型——建议本章安排「高潮」或「转折」打破节奏单调`,
            severity: "warning",
          });
        }
      } catch { /* no summaries yet */ }

      return c.json({ chapterNumber, questions, triggers });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Event Chain ---

  app.get("/api/v1/books/:id/event-chain", async (c) => {
    const id = c.req.param("id");
    const chapterNumber = Number(c.req.query("chapter"));
    await assertBookExists(state, id);
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    try {
      const bookDir = new StateManager(root).bookDir(id);
      const { readArtifactIndex, readLatestArtifact } = await import("@actalk/inkos-core");
      const artifactDir = join(bookDir, "story", "runtime", `chapter-${String(chapterNumber).padStart(4, "0")}`);
      const latest = await readLatestArtifact(artifactDir, "event-chain");
      if (!latest) {
        return c.json({ chain: null, message: "No event chain generated yet. Use POST to extract." });
      }
      const chain = JSON.parse(latest.content);
      return c.json({ chain });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/event-chain/extract", async (c) => {
    const id = c.req.param("id");
    const chapterNumber = Number(c.req.query("chapter"));
    await assertBookExists(state, id);
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    try {
      const bookDir = new StateManager(root).bookDir(id);
      const { readFile, readdir } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const { saveArtifactAutoVersion, EventChainExtractor } = await import("@actalk/inkos-core");

      // Gather source files
      const sourcesDir = join(bookDir, "story", "sources");
      const sourceFiles: Array<{ path: string; content: string; frontmatter: Record<string, unknown> }> = [];
      try {
        const files = await readdir(sourcesDir);
        for (const file of files) {
          if (!file.endsWith(".md")) continue;
          const raw = await readFile(join(sourcesDir, file), "utf-8");
          const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
          const frontmatter: Record<string, unknown> = {};
          if (fmMatch) {
            for (const line of fmMatch[1].split("\n")) {
              const [k, ...v] = line.split(":");
              if (k && v.length > 0) frontmatter[k.trim()] = v.join(":").trim();
            }
          }
          const body = fmMatch ? raw.slice(fmMatch[0].length) : raw;
          sourceFiles.push({ path: file, content: body, frontmatter });
        }
      } catch { /* no sources dir */ }

      // Read known characters
      const characterDir = join(bookDir, "story", "characters");
      const characters: Array<{ id: string; name: string; traits?: string[] }> = [];
      try {
        const charFiles = await readdir(characterDir);
        for (const file of charFiles) {
          if (!file.endsWith(".json")) continue;
          const charRaw = await readFile(join(characterDir, file), "utf-8");
          const charData = JSON.parse(charRaw) as { id?: string; name?: string; traits?: string[] };
          if (charData.id && charData.name) {
            characters.push({ id: charData.id, name: charData.name, traits: charData.traits });
          }
        }
      } catch { /* no characters dir */ }

      // M4: Use the real EventChainExtractor Agent (frontmatter mode, zero LLM cost)
      const extractor = new EventChainExtractor({} as never);
      const result = await extractor.execute({
        sources: sourceFiles.map((src) => ({
          path: src.path,
          content: src.content,
          frontmatter: src.frontmatter,
        })),
        chapterNumber,
        characters,
        useLlm: false,
      });

      const chain = {
        bookId: id,
        chapterNumber,
        events: result.events,
        generatedAt: new Date().toISOString(),
        confidence: result.confidence,
        warnings: result.warnings,
      };
      const artifactDir = join(bookDir, "story", "runtime", `chapter-${String(chapterNumber).padStart(4, "0")}`);
      await saveArtifactAutoVersion(artifactDir, "event-chain", JSON.stringify(chain, null, 2));

      return c.json({ chain });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Scene Templates ---

  app.get("/api/v1/books/:id/scene-templates", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    try {
      const bookDir = new StateManager(root).bookDir(id);
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const path = join(bookDir, "story", "sources", "scene_templates.json");
      const raw = await readFile(path, "utf-8").catch(() => '{"templates":[]}');
      return c.json(JSON.parse(raw));
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.put("/api/v1/books/:id/scene-templates", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    try {
      const bookDir = new StateManager(root).bookDir(id);
      const { writeFile, mkdir } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const { SceneTemplateIndexSchema } = await import("@actalk/inkos-core");
      const body = await c.req.json();
      // Validate structure before persisting
      const validated = SceneTemplateIndexSchema.parse(body);
      const dir = join(bookDir, "story", "sources");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "scene_templates.json"), JSON.stringify(validated, null, 2), "utf-8");
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: String(e) }, e instanceof SyntaxError || (e as Record<string, unknown>).issues ? 400 : 500);
    }
  });

  // --- Voice Profiles ---

  app.get("/api/v1/books/:id/voice-profiles", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    try {
      const bookDir = new StateManager(root).bookDir(id);
      const { readFile, readdir } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const profilesDir = join(bookDir, "story", "voice_profiles");
      // Scan directory for individual <characterId>.json files (M6 fix)
      const profiles: unknown[] = [];
      try {
        const files = await readdir(profilesDir);
        for (const file of files) {
          if (!file.endsWith(".json") || file === "index.json") continue;
          try {
            const raw = await readFile(join(profilesDir, file), "utf-8");
            profiles.push(JSON.parse(raw));
          } catch { /* skip unreadable files */ }
        }
      } catch { /* directory doesn't exist yet */ }

      // P1-5: When profiles list is empty, return available characters from role cards
      // so the frontend can offer "Analyze Voice" buttons for each character.
      const availableCharacters: Array<{ id: string; name: string }> = [];
      if (profiles.length === 0) {
        try {
          const rolesDir = join(bookDir, "story", "roles");
          const roleFiles = (await readdir(rolesDir)).filter(f => f.endsWith(".md"));
          for (const file of roleFiles) {
            try {
              const raw = await readFile(join(rolesDir, file), "utf-8");
              const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
              if (fmMatch) {
                const fm = fmMatch[1];
                const nameMatch = fm.match(/^name:\s*(.+)/m);
                const idMatch = fm.match(/^id:\s*(.+)/m) || [undefined, file.replace(/\.md$/, "")];
                if (nameMatch) {
                  availableCharacters.push({ id: idMatch[1], name: nameMatch[1] });
                }
              }
            } catch { /* skip unreadable role card */ }
          }
        } catch { /* roles dir doesn't exist */ }
      }

      return c.json({ profiles, availableCharacters });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/voice-profiles/analyze", async (c) => {
    const id = c.req.param("id");
    const characterId = c.req.query("character");
    await assertBookExists(state, id);
    if (!characterId) {
      return c.json({ error: "Missing character parameter" }, 400);
    }
    try {
      // Load the role card for character name
      const { loadRoleCard } = await import("@actalk/inkos-core");
      const bookDir = new StateManager(root).bookDir(id);
      let characterName = characterId;

      try {
        const card = await loadRoleCard(bookDir, characterId);
        if (card) characterName = card.frontmatter.name;
      } catch {
        // Role card not found — continue with characterId as fallback name
      }

      // Collect dialogue lines from recent chapters
      const { readFile, readdir, mkdir } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const chaptersDir = join(bookDir, "chapters");
      const dialogueLines: string[] = [];
      const sourceChapters: number[] = [];
      const MAX_CHAPTERS = 5;

      try {
        const entries = (await readdir(chaptersDir))
          .filter(f => /^\d{4}_/.test(f) && f.endsWith(".md"))
          .sort()
          .slice(-MAX_CHAPTERS);

        for (const entry of entries) {
          const chapterNum = parseInt(entry.slice(0, 4), 10);
          const content = await readFile(join(chaptersDir, entry), "utf-8");
          const lines = extractCharacterDialogue(content, characterId, characterName);
          if (lines.length > 0) {
            dialogueLines.push(...lines);
            sourceChapters.push(chapterNum);
          }
        }
      } catch {
        // No chapters yet — proceed with empty dialogue
      }

      // Use VoiceProfileAnalyzer for rule-based analysis (no LLM needed for baseline)
      const { VoiceProfileAnalyzer } = await import("@actalk/inkos-core");
      // Create a minimal AgentContext — LLM client is only needed when useLlm=true
      const profile = await new VoiceProfileAnalyzer({
        client: undefined as never, // not used when useLlm=false
        model: "none",
        projectRoot: root,
        bookId: id,
      }).analyze({
        characterId,
        characterName,
        dialogueLines,
        sourceChapters,
        useLlm: false,
      });

      // Persist to story/voice_profiles/<characterId>.json
      const profilesDir = join(bookDir, "story", "voice_profiles");
      await mkdir(profilesDir, { recursive: true });
      await writeFile(
        join(profilesDir, `${characterId}.json`),
        JSON.stringify(profile, null, 2),
        "utf-8",
      );

      return c.json({ profile });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- State Changelog (M10/P2-1) ---

  app.get("/api/v1/books/:id/state-changelog", async (c) => {
    const id = c.req.param("id");
    const limit = Math.min(Math.max(Number(c.req.query("limit")) || 50, 1), 200);
    await assertBookExists(state, id);
    try {
      const bookDir = new StateManager(root).bookDir(id);
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const changelogPath = join(bookDir, "story", "state", "state_changelog.jsonl");
      let entries: unknown[] = [];
      try {
        const raw = await readFile(changelogPath, "utf-8");
        entries = raw.trim().split("\n").slice(-limit).map(line => {
          try { return JSON.parse(line); } catch { return { raw: line }; }
        });
      } catch { /* no changelog yet */ }
      return c.json({ bookId: id, entries, totalEntries: entries.length });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Role Cards ---

  app.get("/api/v1/books/:id/roles", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    try {
      const state = new StateManager(root);
      const bookDir = state.bookDir(id);
      const roles = await listRoleCards(bookDir);
      return c.json({ roles });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.get("/api/v1/books/:id/roles/:roleId", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    const roleId = c.req.param("roleId");
    try {
      const state = new StateManager(root);
      const bookDir = state.bookDir(id);
      const card = await loadRoleCard(bookDir, roleId);
      if (!card) return c.json({ error: "Role not found" }, 404);
      return c.json({ card });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/roles", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    const body = await c.req.json<{ id: string; name: string; roleTier?: RoleTier }>();
    if (!body.id || !body.name) return c.json({ error: "id and name are required" }, 400);
    try {
      const state = new StateManager(root);
      const bookDir = state.bookDir(id);
      const card = createRoleCardTemplate(body.id, body.name, body.roleTier ?? "major");
      await saveRoleCard(bookDir, card);
      return c.json({ ok: true, card });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.put("/api/v1/books/:id/roles/:roleId", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    const roleId = c.req.param("roleId");
    const body = await c.req.json<Partial<RoleCard>>();
    try {
      const state = new StateManager(root);
      const bookDir = state.bookDir(id);
      const existing = await loadRoleCard(bookDir, roleId);
      if (!existing) return c.json({ error: "Role not found" }, 404);
      const updated: RoleCard = {
        id: existing.id,
        frontmatter: { ...existing.frontmatter, ...body.frontmatter },
        body: body.body ?? existing.body,
      };
      await saveRoleCard(bookDir, updated);
      return c.json({ ok: true, card: updated });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.delete("/api/v1/books/:id/roles/:roleId", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    const roleId = c.req.param("roleId");
    try {
      const state = new StateManager(root);
      const bookDir = state.bookDir(id);
      const ok = await deleteRoleCard(bookDir, roleId);
      if (!ok) return c.json({ error: "Role not found" }, 404);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Fanfic Init ---

  app.post("/api/v1/fanfic/init", async (c) => {
    const body = await c.req.json<{
      title: string; sourceText: string; sourceName?: string;
      mode?: string; genre?: string; platform?: string;
      targetChapters?: number; chapterWordCount?: number; language?: string;
    }>();
    if (!body.title || !body.sourceText) {
      return c.json({ error: "title and sourceText are required" }, 400);
    }

    const now = new Date().toISOString();
    const bookId = body.title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "-").replace(/-+/g, "-").slice(0, 30);

    const bookConfig = {
      id: bookId,
      title: body.title,
      platform: (body.platform ?? "other") as "other",
      genre: (body.genre ?? "other") as "xuanhuan",
      status: "outlining" as const,
      targetChapters: body.targetChapters ?? 100,
      chapterWordCount: body.chapterWordCount ?? 3000,
      fanficMode: (body.mode ?? "canon") as "canon",
      ...(body.language ? { language: body.language as "zh" | "en" } : {}),
      createdAt: now,
      updatedAt: now,
    };

    broadcast("fanfic:start", { bookId, title: body.title });
    try {
      await withPipeline("fanfic-init", await buildPipelineConfig(), async (pipeline) => {
        await pipeline.initFanficBook(bookConfig, body.sourceText, body.sourceName ?? "source", (body.mode ?? "canon") as "canon");
      });
      broadcast("fanfic:complete", { bookId });
      return c.json({ ok: true, bookId });
    } catch (e) {
      broadcast("fanfic:error", { bookId, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Fanfic Show (read canon) ---

  app.get("/api/v1/books/:id/fanfic", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    const bookDir = state.bookDir(id);
    try {
      const content = await readFile(join(bookDir, "story", "fanfic_canon.md"), "utf-8");
      return c.json({ bookId: id, content });
    } catch {
      return c.json({ bookId: id, content: null });
    }
  });

  // --- Fanfic Refresh ---

  app.post("/api/v1/books/:id/fanfic/refresh", async (c) => {
    const id = c.req.param("id");
    const { sourceText, sourceName } = await c.req.json<{ sourceText: string; sourceName?: string }>();
    if (!sourceText?.trim()) return c.json({ error: "sourceText is required" }, 400);

    broadcast("fanfic:refresh:start", { bookId: id });
    try {
      const book = await state.loadBookConfig(id);
      await withPipeline("fanfic-import-canon", await buildPipelineConfig(), async (pipeline) => {
        await pipeline.importFanficCanon(id, sourceText, sourceName ?? "source", (book.fanficMode ?? "canon") as "canon");
      });
      broadcast("fanfic:refresh:complete", { bookId: id });
      return c.json({ ok: true });
    } catch (e) {
      broadcast("fanfic:refresh:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Radar Scan ---

  app.post("/api/v1/radar/scan", async (c) => {
    broadcast("radar:start", {});
    try {
      const result = await withPipeline("radar-scan", await buildPipelineConfig(), async (pipeline) => {
        const r = await pipeline.runRadar();
        await saveRadarScan(root, r);
        return r;
      });
      broadcast("radar:complete", { result });
      return c.json(result);
    } catch (e) {
      broadcast("radar:error", { error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  app.get("/api/v1/radar/history", async (c) => {
    try {
      const items = await loadRadarHistory(root);
      return c.json({ items });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Doctor (environment health check) ---

  app.get("/api/v1/doctor", async (c) => {
    const { existsSync } = await import("node:fs");
    const { GLOBAL_ENV_PATH } = await import("@actalk/inkos-core");

    const checks = {
      inkosJson: existsSync(join(root, "inkos.json")),
      projectEnv: existsSync(join(root, ".env")),
      globalEnv: existsSync(GLOBAL_ENV_PATH),
      booksDir: existsSync(join(root, "books")),
      llmConnected: false,
      bookCount: 0,
    };

    try {
      const books = await state.listBooks();
      checks.bookCount = books.length;
    } catch { /* ignore */ }

    try {
      const currentConfig = await loadCurrentProjectConfig({ requireApiKey: false });
      const service = currentConfig.llm.service ?? currentConfig.llm.provider;
      const probe = await probeServiceCapabilities({
        root,
        service,
        apiKey: currentConfig.llm.apiKey,
        baseUrl: currentConfig.llm.baseUrl,
        preferredApiFormat: currentConfig.llm.apiFormat,
        preferredStream: currentConfig.llm.stream,
        preferredModel: currentConfig.llm.model,
        proxyUrl: currentConfig.llm.proxyUrl,
      });
      checks.llmConnected = probe.ok;
    } catch { /* ignore */ }

    return c.json(checks);
  });

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
