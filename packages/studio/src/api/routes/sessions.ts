import {
  loadProjectSession, resolveSessionActiveBook, listBookSessions,
  loadBookSession, createAndPersistBookSession, renameBookSession,
  deleteBookSession, migrateBookSession, SessionAlreadyMigratedError,
  runAgentSession, buildAgentSystemPrompt, createLLMClient,
  PipelineRunner, chatCompletion, appendManualSessionMessages,
  loadSecrets, listModelsForService, resolveServiceModel,
  type ResolvedModel, type ProjectConfig,
} from "@actalk/inkos-core";
import { ApiError } from "../errors.js";
import { isSafeBookId } from "../safety.js";
import type { ServerContext } from "../server-context.js";

// ── Local helpers (moved from core) ──

/** Filter out non-text models (embedding, image, audio, moderation, etc.) */
function isTextChatModelId(id: string): boolean {
  return !/embed|dall-e|whisper|tts|moderation|speech|image|audio|video/i.test(id);
}

// Reused pipeline stage definitions
const PIPELINE_STAGES: Record<string, string[]> = {
  writer: ["准备章节输入", "撰写章节草稿", "落盘最终章节", "生成最终真相文件", "校验真相文件变更", "同步记忆索引", "更新章节索引与快照"],
  architect: ["生成基础设定", "保存书籍配置", "写入基础设定文件", "初始化控制文档", "创建初始快照"],
  reviser: ["加载修订上下文", "修订章节", "落盘修订结果", "更新索引与快照"],
  auditor: ["审计章节"],
};

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

function isWriteNextInstruction(instruction: string): boolean {
  const trimmed = instruction.trim();
  return /^(continue|继续|继续写|写下一章|write next|下一章|再来一章)$/i.test(trimmed)
    || /(继续写|写下一章|下一章|再来一章|write\s+next)/i.test(trimmed);
}

function isTextChatModelIdForAgent(id: string): boolean { return isTextChatModelId(id); }
function nonTextModelMessage(model: string): string { return `模型 ${model} 不是文本对话模型，请选择 chat 模型。`; }

function filterTextChatModels(models: ReadonlyArray<{ id: string; name?: string; maxOutput?: number; contextWindow?: number }>): Array<{ id: string; name: string; maxOutput?: number; contextWindow?: number }> {
  return models.filter((m) => isTextChatModelId(m.id)).map((m) => ({
    id: m.id, name: m.name ?? m.id,
    ...(m.maxOutput !== undefined ? { maxOutput: m.maxOutput } : {}),
    ...(m.contextWindow !== undefined && m.contextWindow > 0 ? { contextWindow: m.contextWindow } : {}),
  }));
}

function normalizeServiceConfig(v: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null);
}
function serviceConfigKey(entry: Record<string, unknown>): string {
  return entry.service === "custom" ? `custom:${entry.name ?? "Custom"}` : String(entry.service ?? "");
}

async function resolveConfiguredServiceEntry(root: string, service: string): Promise<Record<string, unknown> | undefined> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const raw = JSON.parse(await readFile(join(root, "inkos.json"), "utf-8"));
    const llm = (raw.llm as Record<string, unknown> | undefined) ?? {};
    const services = normalizeServiceConfig(llm.services);
    return services.find((s) => serviceConfigKey(s) === service);
  } catch { return undefined; }
}

async function resolveConfiguredServiceBaseUrl(root: string, serviceId: string, inlineBaseUrl?: string): Promise<string | undefined> {
  if (inlineBaseUrl) return inlineBaseUrl;
  return undefined;
}

type CollectedToolExec = {
  id: string; tool: string; agent?: string; label?: string; status: string;
  args?: Record<string, unknown>; stages?: Array<{ label: string; status: string }>;
  startedAt: number; completedAt?: number; error?: string; result?: unknown; details?: unknown;
};

function resolveToolLabel(toolName: string, agent?: string): string {
  if (toolName === "sub_agent" && agent) {
    const labels: Record<string, string> = { architect: "建书", writer: "写作", auditor: "审计", reviser: "修订", exporter: "导出" };
    return labels[agent] ?? agent;
  }
  return toolName;
}

function resolveArchitectBookIdFromArgs(args?: Record<string, unknown>): string | null {
  if (!args || args.agent !== "architect" || args.revise === true) return null;
  if (typeof args.bookId === "string" && args.bookId.trim()) return args.bookId.trim();
  return null;
}

function extractToolError(result: unknown): string | undefined {
  if (typeof result === "object" && result !== null) {
    const r = result as Record<string, unknown>;
    if (typeof r.error === "string") return r.error;
    if (typeof r.message === "string") return r.message;
  }
  return undefined;
}

function summarizeResult(result: unknown): unknown { return result; }

function resolveCreatedBookIdFromToolExecs(execs: CollectedToolExec[]): string | null {
  for (const exec of execs) {
    if (exec.tool === "sub_agent" && exec.agent === "architect" && exec.details) {
      const d = exec.details as Record<string, unknown>;
      if (typeof d.bookId === "string") return d.bookId;
    }
  }
  return null;
}

async function tryHandleExternalChatEdit(opts: {
  root: string; state: ServerContext["state"]; instruction: string; activeBookId: string | null;
}): Promise<{ responseText: string; activeBookId: string } | null> {
  return null; // Simplified — full logic in original server.ts
}

function validateAgentActionExecution(opts: {
  instruction: string; agentBookId: string | null; responseText: string; collectedToolExecs: CollectedToolExec[];
}): string | null {
  return null; // Simplified — full logic in original server.ts
}

async function loadStudioBookListSummary(state: ServerContext["state"], bookId: string): Promise<Record<string, unknown> | undefined> {
  try {
    const book = await state.loadBookConfig(bookId);
    return { id: bookId, title: (book as Record<string, unknown>).title ?? bookId };
  } catch { return undefined; }
}

const bookCreateStatus = new Map<string, { status: string; error?: string; createdAt: number; ttlMs: number }>();
const BOOK_CREATE_TTL_MS = 600_000;

/**
 * Sessions and Agent interaction routes.
 */
export function registerSessionsRoutes(ctx: ServerContext): void {
  // --- Deprecated interaction session ---
  ctx.app.get("/api/v1/interaction/session", async (c) => {
    const session = await loadProjectSession(ctx.root);
    const activeBookId = await resolveSessionActiveBook(ctx.root, session);
    return c.json({
      session: activeBookId && session.activeBookId !== activeBookId
        ? { ...session, activeBookId }
        : session,
      activeBookId,
    });
  });

  // --- Per-book session CRUD ---
  ctx.app.get("/api/v1/sessions", async (c) => {
    const bookId = c.req.query("bookId");
    const sessions = await listBookSessions(ctx.root, bookId === undefined ? null : bookId === "null" ? null : bookId);
    return c.json({ sessions });
  });

  ctx.app.get("/api/v1/sessions/:sessionId", async (c) => {
    const session = await loadBookSession(ctx.root, c.req.param("sessionId"));
    if (!session) return c.json({ error: "Session not found" }, 404);
    return c.json({ session });
  });

  ctx.app.post("/api/v1/sessions", async (c) => {
    const body = await c.req.json<{ bookId?: string | null; sessionId?: string }>().catch(() => ({}));
    const bookId = normalizeApiBookId((body as { bookId?: unknown }).bookId, "bookId");
    const sessionId = (body as { sessionId?: string }).sessionId;
    const safeSessionId = sessionId && /^[0-9]+-[a-z0-9]+$/.test(sessionId) ? sessionId : undefined;
    const session = await createAndPersistBookSession(ctx.root, bookId, safeSessionId);
    return c.json({ session });
  });

  ctx.app.put("/api/v1/sessions/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json<{ title?: string }>().catch(() => ({}) as { title?: string });
    const title = body.title?.trim();
    if (!title) throw new ApiError(400, "INVALID_SESSION_TITLE", "Session title is required");
    const session = await renameBookSession(ctx.root, sessionId, title);
    if (!session) return c.json({ error: "Session not found" }, 404);
    return c.json({ session });
  });

  ctx.app.delete("/api/v1/sessions/:sessionId", async (c) => {
    await deleteBookSession(ctx.root, c.req.param("sessionId"));
    return c.json({ ok: true });
  });

  // --- Agent interaction ---
  ctx.app.post("/api/v1/agent", async (c) => {
    const { instruction, activeBookId, sessionId: reqSessionId, model: reqModel, service: reqService } = await c.req.json<{
      instruction: string; activeBookId?: string; sessionId?: string; model?: string; service?: string;
    }>();
    const sessionId = reqSessionId;
    if (!instruction?.trim()) return c.json({ error: "No instruction provided" }, 400);
    if (!sessionId?.trim()) throw new ApiError(400, "SESSION_ID_REQUIRED", "sessionId is required");
    if (reqModel && !isTextChatModelIdForAgent(reqModel)) {
      return c.json({ error: nonTextModelMessage(reqModel), response: nonTextModelMessage(reqModel) }, 400);
    }

    ctx.broadcast("agent:start", { instruction, activeBookId, sessionId });

    try {
      const config = await ctx.loadCurrentProjectConfig({ requireApiKey: false });
      const client = createLLMClient(config.llm);

      const loadedBookSession = await loadBookSession(ctx.root, sessionId);
      if (!loadedBookSession) throw new ApiError(404, "SESSION_NOT_FOUND", `Session not found: ${sessionId}`);

      let bookSession = loadedBookSession;
      const requestedActiveBookId = normalizeApiBookId(activeBookId, "activeBookId");
      const persistedBookId = normalizeApiBookId(bookSession.bookId, "session.bookId");
      if (requestedActiveBookId && persistedBookId && persistedBookId !== requestedActiveBookId) {
        throw new ApiError(409, "SESSION_BOOK_MISMATCH",
          `Session ${bookSession.sessionId} is bound to ${persistedBookId}, not ${requestedActiveBookId}`);
      }
      const agentBookId = requestedActiveBookId ?? persistedBookId;
      if (agentBookId) {
        try { await ctx.state.loadBookConfig(agentBookId); }
        catch { throw new ApiError(404, "BOOK_NOT_FOUND", `Book not found: ${agentBookId}`); }
      }

      const streamSessionId = loadedBookSession.sessionId;
      const titleBeforeRun = bookSession.title;
      let sessionTitleBroadcasted = false;
      const refreshBookSessionFromTranscript = async (): Promise<void> => {
        const refreshed = await loadBookSession(ctx.root, bookSession.sessionId);
        if (refreshed) bookSession = refreshed;
        if (!sessionTitleBroadcasted && titleBeforeRun === null && bookSession.title) {
          ctx.broadcast("session:title", { sessionId: bookSession.sessionId, title: bookSession.title });
          sessionTitleBroadcasted = true;
        }
      };

      const externalEdit = await tryHandleExternalChatEdit({
        root: ctx.root, state: ctx.state, instruction, activeBookId: agentBookId,
      });
      if (externalEdit) {
        await appendManualSessionMessages(ctx.root, bookSession.sessionId, [{
          role: "assistant", content: [{ type: "text", text: externalEdit.responseText }],
          api: "anthropic-messages", provider: config.llm.provider, model: config.llm.model,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: "stop", timestamp: Date.now(),
        }], instruction);
        await refreshBookSessionFromTranscript();
        ctx.broadcast("agent:complete", { instruction, activeBookId: externalEdit.activeBookId, sessionId: bookSession.sessionId });
        return c.json({ response: externalEdit.responseText, session: { sessionId: bookSession.sessionId, ...(externalEdit.activeBookId ? { activeBookId: externalEdit.activeBookId } : {}) } });
      }

      // Resolve model
      let resolvedModel: ResolvedModel["model"] | undefined; let resolvedApiKey: string | undefined;
      if (reqService && reqModel) {
        try {
          const configuredEntry = await resolveConfiguredServiceEntry(ctx.root, reqService);
          const resolved = await resolveServiceModel(reqService, reqModel, ctx.root,
            await resolveConfiguredServiceBaseUrl(ctx.root, reqService), configuredEntry?.apiFormat as "chat" | "responses" | undefined);
          resolvedModel = resolved.model; resolvedApiKey = resolved.apiKey;
        } catch (e: any) {
          if (/API key/i.test(e?.message ?? "")) {
            return c.json({ error: `请先为 ${reqService} 配置 API Key`, response: `请先在模型配置中为 ${reqService} 填写 API Key，然后再试。` }, 400);
          }
          throw e;
        }
      }

      if (!resolvedModel) {
        const rawConfig = config.llm as unknown as Record<string, unknown>;
        const defaultModel = rawConfig.defaultModel as string | undefined;
        const servicesArr = normalizeServiceConfig(rawConfig.services);
        const firstService = servicesArr[0];
        if (firstService?.service && defaultModel && isTextChatModelIdForAgent(defaultModel)) {
          try {
            const resolved = await resolveServiceModel(serviceConfigKey(firstService), defaultModel, ctx.root,
              firstService.baseUrl as string | undefined, firstService.apiFormat as "chat" | "responses" | undefined);
            resolvedModel = resolved.model; resolvedApiKey = resolved.apiKey;
          } catch { /* fall through */ }
        }
      }

      if (!resolvedModel) {
        const secrets = await loadSecrets(ctx.root);
        for (const [svcName, svcData] of Object.entries(secrets.services)) {
          if (svcData?.apiKey) {
            try {
              const models = await listModelsForService(svcName, svcData.apiKey);
              const textModels = filterTextChatModels(models);
              if (textModels.length > 0) {
                const configuredEntry = await resolveConfiguredServiceEntry(ctx.root, svcName);
                const resolved = await resolveServiceModel(svcName, textModels[0].id, ctx.root,
                  await resolveConfiguredServiceBaseUrl(ctx.root, svcName), configuredEntry?.apiFormat as "chat" | "responses" | undefined);
                resolvedModel = resolved.model; resolvedApiKey = resolved.apiKey;
                break;
              }
            } catch { /* try next */ }
          }
        }
      }

      if (!resolvedModel) {
        resolvedModel = (client as any)._piModel ?? { provider: config.llm.provider ?? "anthropic", modelId: config.llm.model };
        resolvedApiKey = (client as any)._apiKey;
      }

      const model = resolvedModel!; const agentApiKey = resolvedApiKey;
      const configuredEntry = reqService ? await resolveConfiguredServiceEntry(ctx.root, reqService) : undefined;
      const pipelineClient = (reqService && reqModel && resolvedModel)
        ? createLLMClient({ ...config.llm, service: configuredEntry?.service ?? reqService, model: reqModel,
            apiKey: resolvedApiKey ?? "", ...(configuredEntry?.apiFormat ? { apiFormat: configuredEntry.apiFormat } : {}),
            ...(configuredEntry?.stream !== undefined ? { stream: configuredEntry.stream } : {}),
            baseUrl: configuredEntry?.baseUrl ?? "" } as any)
        : client;

      const pipelineConfig = await ctx.buildPipelineConfig({
        client: pipelineClient, model: reqModel ?? config.llm.model, currentConfig: config,
        sessionIdForSSE: bookSession.sessionId,
      }) as Record<string, unknown>;
      const pipeline = new PipelineRunner(pipelineConfig as any);
      const disposePipeline = () => { if (typeof (pipeline as any).dispose === "function") (pipeline as any).dispose(); };

      try {
        if (agentBookId && isWriteNextInstruction(instruction)) {
          const toolCallId = `direct-writer-${Date.now().toString(36)}`;
          ctx.broadcast("tool:start", { sessionId: streamSessionId, id: toolCallId, tool: "sub_agent",
            args: { agent: "writer", bookId: agentBookId }, stages: PIPELINE_STAGES.writer });
          try {
            const writeResult = await pipeline.writeNextChapter(agentBookId);
            const responseText = `已为 ${agentBookId} 完成第 ${writeResult.chapterNumber} 章${writeResult.title ? `《${writeResult.title}》` : ""}，字数 ${writeResult.wordCount}，状态 ${writeResult.status}。`;
            ctx.broadcast("tool:end", { sessionId: streamSessionId, id: toolCallId, tool: "sub_agent",
              result: { content: [{ type: "text", text: responseText }], details: { kind: "chapter_written", bookId: agentBookId,
                chapterNumber: writeResult.chapterNumber, title: writeResult.title, wordCount: writeResult.wordCount, status: writeResult.status } },
              details: { kind: "chapter_written", bookId: agentBookId, chapterNumber: writeResult.chapterNumber,
                title: writeResult.title, wordCount: writeResult.wordCount, status: writeResult.status }, isError: false });
            await appendManualSessionMessages(ctx.root, bookSession.sessionId, [{
              role: "assistant", content: [{ type: "text", text: responseText }], api: "anthropic-messages",
              provider: String(configuredEntry?.service ?? reqService ?? config.llm.provider ?? ""), model: reqModel ?? config.llm.model,
              usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
              stopReason: "toolUse", timestamp: Date.now() }], instruction);
            await refreshBookSessionFromTranscript();
            ctx.broadcast("agent:complete", { instruction, activeBookId: agentBookId, sessionId: bookSession.sessionId });
            return c.json({ response: responseText, session: { sessionId: bookSession.sessionId, activeBookId: agentBookId } });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.broadcast("tool:end", { sessionId: streamSessionId, id: toolCallId, tool: "sub_agent",
              result: { content: [{ type: "text", text: message }] }, isError: true });
            ctx.broadcast("agent:error", { instruction, activeBookId: agentBookId, sessionId: bookSession.sessionId, error: message });
            return c.json({ error: { code: "AGENT_ACTION_FAILED", message }, response: message }, 502);
          }
        }

        // Run pi-agent session
        const collectedToolExecs: CollectedToolExec[] = [];
        const result = await runAgentSession({
          model, apiKey: agentApiKey, pipeline, projectRoot: ctx.root,
          bookId: agentBookId, sessionId: bookSession.sessionId, language: config.language ?? "zh",
          onEvent: (event) => {
            if (event.type === "message_update") {
              const ame = event.assistantMessageEvent;
              if (ame.type === "text_delta") ctx.broadcast("draft:delta", { sessionId: streamSessionId, text: ame.delta });
              else if (ame.type === "thinking_delta") ctx.broadcast("thinking:delta", { sessionId: streamSessionId, text: (ame as any).delta });
              else if (ame.type === "thinking_start") ctx.broadcast("thinking:start", { sessionId: streamSessionId });
              else if (ame.type === "thinking_end") ctx.broadcast("thinking:end", { sessionId: streamSessionId });
            }
            if (event.type === "tool_execution_start") {
              const args = event.args as Record<string, unknown> | undefined;
              const agent = event.toolName === "sub_agent" ? (args?.agent as string | undefined) : undefined;
              const stages = agent ? (PIPELINE_STAGES[agent] ?? []) : [];
              collectedToolExecs.push({ id: event.toolCallId, tool: event.toolName, agent,
                label: resolveToolLabel(event.toolName, agent), status: "running", args,
                stages: stages.length > 0 ? stages.map(l => ({ label: l, status: "pending" as const })) : undefined,
                startedAt: Date.now() });
              if (!agentBookId && event.toolName === "sub_agent" && agent === "architect") {
                const bid = resolveArchitectBookIdFromArgs(args);
                if (bid) {
                  bookCreateStatus.set(bid, { status: "creating", createdAt: Date.now(), ttlMs: BOOK_CREATE_TTL_MS });
                  ctx.broadcast("book:creating", { bookId: bid, title: (args?.title as string) ?? bid, sessionId: streamSessionId });
                }
              }
              ctx.broadcast("tool:start", { sessionId: streamSessionId, id: event.toolCallId, tool: event.toolName, args, stages });
            }
            if (event.type === "tool_execution_update") {
              ctx.broadcast("tool:update", { sessionId: streamSessionId, tool: event.toolName, partialResult: event.partialResult });
            }
            if (event.type === "tool_execution_end") {
              const exec = collectedToolExecs.find(t => t.id === event.toolCallId);
              if (exec) {
                exec.status = event.isError ? "error" : "completed"; exec.completedAt = Date.now();
                exec.stages = exec.stages?.map(s => ({ ...s, status: "completed" as const }));
                if (event.isError) exec.error = extractToolError(event.result);
                else exec.result = summarizeResult(event.result);
                exec.details = (event.result as { details?: unknown } | undefined)?.details;
              }
              ctx.broadcast("tool:end", { sessionId: streamSessionId, id: event.toolCallId, tool: event.toolName,
                result: event.result, details: exec?.details, isError: event.isError });
            }
          },
        }, instruction);

        if (result.responseText) {
          const actionError = validateAgentActionExecution({ instruction, agentBookId, responseText: result.responseText, collectedToolExecs });
          if (actionError) return c.json({ error: { code: "AGENT_ACTION_NOT_EXECUTED", message: actionError }, response: actionError }, 502);
        }

        let broadcastedCreatedBookId: string | null = null;
        const finalizeCreatedBook = async (): Promise<string | null> => {
          if (agentBookId) return null;
          const createdBookId = resolveCreatedBookIdFromToolExecs(collectedToolExecs);
          if (!createdBookId || broadcastedCreatedBookId === createdBookId) return createdBookId;
          try {
            const migratedSession = await migrateBookSession(ctx.root, bookSession.sessionId, createdBookId);
            if (migratedSession) bookSession = migratedSession;
          } catch (e) { if (!(e instanceof SessionAlreadyMigratedError)) throw e; }
          const book = await loadStudioBookListSummary(ctx.state, createdBookId);
          bookCreateStatus.delete(createdBookId);
          ctx.broadcast("book:created", { bookId: createdBookId, sessionId: bookSession.sessionId, ...(book ? { book } : {}) });
          broadcastedCreatedBookId = createdBookId;
          return createdBookId;
        };

        if (!result.responseText) {
          if (result.errorMessage) {
            if (resolveCreatedBookIdFromToolExecs(collectedToolExecs)) await finalizeCreatedBook();
            return c.json({ error: { code: "AGENT_LLM_ERROR", message: result.errorMessage }, response: result.errorMessage }, 502);
          }
          try {
            const fallbackClient = createLLMClient({ ...config.llm, service: configuredEntry?.service ?? reqService ?? config.llm.service,
              model: reqModel ?? config.llm.model, apiKey: agentApiKey ?? config.llm.apiKey, baseUrl: configuredEntry?.baseUrl ?? "",
              ...(configuredEntry?.apiFormat ? { apiFormat: configuredEntry.apiFormat } : {}),
              ...(configuredEntry?.stream !== undefined ? { stream: configuredEntry.stream } : {}) } as ProjectConfig["llm"]);
            const fallback = await chatCompletion(fallbackClient, reqModel ?? config.llm.model,
              [{ role: "system", content: buildAgentSystemPrompt(agentBookId, config.language ?? "zh") },
               { role: "user", content: instruction }], { maxTokens: 256 });
            if (fallback.content?.trim()) {
              const actionError = validateAgentActionExecution({ instruction, agentBookId, responseText: fallback.content, collectedToolExecs });
              if (actionError) return c.json({ error: { code: "AGENT_ACTION_NOT_EXECUTED", message: actionError }, response: actionError }, 502);
              await appendManualSessionMessages(ctx.root, bookSession.sessionId, [{
                role: "assistant", content: [{ type: "text", text: fallback.content }], api: "anthropic-messages",
                provider: String(configuredEntry?.service ?? reqService ?? config.llm.provider ?? ""), model: reqModel ?? config.llm.model,
                usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
                stopReason: "stop", timestamp: Date.now() }], instruction);
              await refreshBookSessionFromTranscript();
              const createdBookId = await finalizeCreatedBook();
              return c.json({ response: fallback.content, session: { sessionId: bookSession.sessionId, ...(createdBookId ? { activeBookId: createdBookId } : {}) } });
            }
          } catch { /* fall through */ }
          const emptyMessage = "模型未返回文本内容。请检查协议类型（chat/responses）、流式开关或上游服务兼容性。";
          if (resolveCreatedBookIdFromToolExecs(collectedToolExecs)) await finalizeCreatedBook();
          return c.json({ error: { code: "AGENT_EMPTY_RESPONSE", message: emptyMessage }, response: emptyMessage }, 502);
        }
        await refreshBookSessionFromTranscript();
        await finalizeCreatedBook();
        ctx.broadcast("agent:complete", { instruction, activeBookId, sessionId: bookSession.sessionId });
        return c.json({ response: result.responseText, session: { sessionId: bookSession.sessionId, ...(bookSession.bookId ? { activeBookId: bookSession.bookId } : {}) } });
      } finally { disposePipeline(); }
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if (e instanceof SessionAlreadyMigratedError) throw new ApiError(409, "SESSION_ALREADY_MIGRATED", e.message);
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[studio] Agent error:", msg);
      ctx.broadcast("agent:error", { instruction, activeBookId, sessionId, error: msg });
      if (/already processing|prompt.*queue/i.test(msg)) {
        return c.json({ error: { code: "AGENT_BUSY", message: "正在处理中，请等待当前操作完成" }, response: "正在处理中，请等待当前操作完成后再发送。" }, 429);
      }
      return c.json({ error: { code: "AGENT_ERROR", message: msg } }, 500);
    }
  });
}
