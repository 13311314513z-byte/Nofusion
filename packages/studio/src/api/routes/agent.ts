/**
 * Agent chat route — extracted from server.ts (C4).
 *
 * Handles POST /api/v1/agent: model resolution, pipeline creation,
 * write-next instruction shortcut, pi-agent session execution,
 * book creation finalization, and error recovery.
 */
import type { ServerContext } from "../server-context.js";
import { ApiError } from "../errors.js";
import {
  createLLMClient, loadBookSession, appendManualSessionMessages,
  resolveServiceModel, loadSecrets, listModelsForService,
  runAgentSession, SessionAlreadyMigratedError, migrateBookSession,
  PipelineRunner,
} from "@actalk/inkos-core";
import { withPipeline } from "../shared/pipeline.js";
import {
  isTextChatModelId, nonTextModelMessage, filterTextChatModels,
  isWriteNextInstruction, resolveArchitectBookIdFromArgs,
  resolveToolLabel, summarizeResult, extractToolError,
  tryHandleExternalChatEdit,
  PIPELINE_STAGES,
} from "../shared/agent-helpers.js";
import {
  validateAgentActionExecution, resolveCreatedBookIdFromToolExecs,
  type CollectedToolExec,
} from "../shared/agent-validation.js";
import { normalizeApiBookId } from "../shared/book-guards.js";
import { loadStudioBookListSummary } from "../shared/book-helpers.js";
import {
  normalizeServiceConfig, serviceConfigKey, resolveConfiguredServiceEntry,
} from "../shared/service-helpers.js";
import {
  bookCreateStatus, BOOK_CREATE_TTL_MS,
} from "../shared/book-create-state.js";

export function registerAgentRoutes(ctx: ServerContext): void {
  const {
    app, state: stateManager, root, broadcast,
    loadCurrentProjectConfig, buildPipelineConfig,
    resolveConfiguredServiceBaseUrl, loadRawConfig,
  } = ctx;

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
      const config = await loadCurrentProjectConfig({ requireApiKey: false });
      const client = createLLMClient(config.llm);

      const loadedBookSession = await loadBookSession(root, sessionId);
      if (!loadedBookSession) {
        throw new ApiError(404, "SESSION_NOT_FOUND", `Session not found: ${sessionId}`);
      }
      let bookSession = loadedBookSession;
      const requestedActiveBookId = normalizeApiBookId(activeBookId, "activeBookId");
      const persistedBookId = normalizeApiBookId(bookSession.bookId, "session.bookId");
      if (requestedActiveBookId && persistedBookId && persistedBookId !== requestedActiveBookId) {
        throw new ApiError(409, "SESSION_BOOK_MISMATCH",
          `Session ${bookSession.sessionId} is bound to ${persistedBookId}, not ${requestedActiveBookId}`);
      }
      const agentBookId = requestedActiveBookId ?? persistedBookId;
      if (agentBookId) {
        try { await stateManager.loadBookConfig(agentBookId); }
        catch { throw new ApiError(404, "BOOK_NOT_FOUND", `Book not found: ${agentBookId}`); }
      }
      const streamSessionId = loadedBookSession.sessionId;
      const titleBeforeRun = bookSession.title;
      let sessionTitleBroadcasted = false;
      const refreshBookSessionFromTranscript = async (): Promise<void> => {
        const refreshed = await loadBookSession(root, bookSession.sessionId);
        if (refreshed) bookSession = refreshed;
        if (!sessionTitleBroadcasted && titleBeforeRun === null && bookSession.title) {
          broadcast("session:title", { sessionId: bookSession.sessionId, title: bookSession.title });
          sessionTitleBroadcasted = true;
        }
      };

      const externalEdit = await tryHandleExternalChatEdit({
        root, state: stateManager, instruction, activeBookId: agentBookId,
      });
      if (externalEdit) {
        await appendManualSessionMessages(root, bookSession.sessionId, [{
          role: "assistant",
          content: [{ type: "text", text: externalEdit.responseText }],
          api: "anthropic-messages", provider: config.llm.provider, model: config.llm.model,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: "stop", timestamp: Date.now(),
        }], instruction);
        await refreshBookSessionFromTranscript();
        broadcast("agent:complete", { instruction, activeBookId: externalEdit.activeBookId, sessionId: bookSession.sessionId });
        return c.json({ response: externalEdit.responseText, session: { sessionId: bookSession.sessionId, ...(externalEdit.activeBookId ? { activeBookId: externalEdit.activeBookId } : {}) } });
      }

      // Resolve model
      let resolvedModel: Parameters<typeof runAgentSession>[0]["model"] | undefined;
      let resolvedApiKey: string | undefined;
      let configuredEntry: Awaited<ReturnType<typeof resolveConfiguredServiceEntry>>;

      if (reqService && reqModel) {
        try {
          configuredEntry = await resolveConfiguredServiceEntry(loadRawConfig, root, reqService);
          const resolved = await resolveServiceModel(reqService, reqModel, root,
            await resolveConfiguredServiceBaseUrl(root, reqService), configuredEntry?.apiFormat);
          resolvedModel = resolved.model;
          resolvedApiKey = resolved.apiKey;
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          if (/API key/i.test(message)) {
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
        if (firstService?.service && defaultModel && isTextChatModelId(defaultModel)) {
          try {
            const resolved = await resolveServiceModel(serviceConfigKey(firstService), defaultModel, root, firstService.baseUrl, firstService.apiFormat);
            resolvedModel = resolved.model; resolvedApiKey = resolved.apiKey;
          } catch { /* fall through */ }
        }
      }

      if (!resolvedModel) {
        const secrets = await loadSecrets(root);
        for (const [svcName, svcData] of Object.entries(secrets.services)) {
          if (svcData?.apiKey) {
            try {
              const models = await listModelsForService(svcName, svcData.apiKey);
              const textModels = filterTextChatModels(models);
              if (textModels.length > 0) {
                configuredEntry = await resolveConfiguredServiceEntry(loadRawConfig, root, svcName);
                const resolved = await resolveServiceModel(svcName, textModels[0].id, root,
                  await resolveConfiguredServiceBaseUrl(root, svcName), configuredEntry?.apiFormat);
                resolvedModel = resolved.model; resolvedApiKey = resolved.apiKey;
                break;
              }
            } catch { /* try next */ }
          }
        }
      }

      if (!resolvedModel) {
        resolvedModel = client._piModel ?? { provider: config.llm.provider ?? "anthropic", modelId: config.llm.model };
        resolvedApiKey = client._apiKey;
      }

      const model = resolvedModel!;
      const agentApiKey = resolvedApiKey;
      configuredEntry = reqService ? await resolveConfiguredServiceEntry(loadRawConfig, root, reqService) : undefined;

      const pipelineClient = (reqService && reqModel && resolvedModel)
        ? createLLMClient({
            ...config.llm, service: configuredEntry?.service ?? reqService, model: reqModel,
            apiKey: resolvedApiKey ?? "",
            ...(configuredEntry?.apiFormat ? { apiFormat: configuredEntry.apiFormat } : {}),
            ...(configuredEntry?.stream !== undefined ? { stream: configuredEntry.stream } : {}),
            baseUrl: configuredEntry?.baseUrl ?? "",
          })
        : client;

      const pipeline = new PipelineRunner(await buildPipelineConfig({
        client: pipelineClient, model: reqModel ?? config.llm.model,
        currentConfig: config, sessionIdForSSE: bookSession.sessionId,
      }));
      const disposePipeline = () => { pipeline.dispose(); };

      try {
        // Direct write-next shortcut
        if (agentBookId && isWriteNextInstruction(instruction)) {
          const toolCallId = `direct-writer-${Date.now().toString(36)}`;
          broadcast("tool:start", { sessionId: streamSessionId, id: toolCallId, tool: "sub_agent", args: { agent: "writer", bookId: agentBookId }, stages: PIPELINE_STAGES.writer });
          try {
            const writeResult = await pipeline.writeNextChapter(agentBookId);
            const responseText = `已为 ${agentBookId} 完成第 ${writeResult.chapterNumber} 章${writeResult.title ? `《${writeResult.title}》` : ""}，字数 ${writeResult.wordCount}，状态 ${writeResult.status}。`;
            broadcast("tool:end", { sessionId: streamSessionId, id: toolCallId, tool: "sub_agent", result: { content: [{ type: "text", text: responseText }], details: { kind: "chapter_written", bookId: agentBookId, chapterNumber: writeResult.chapterNumber, title: writeResult.title, wordCount: writeResult.wordCount, status: writeResult.status } }, details: { kind: "chapter_written", bookId: agentBookId, chapterNumber: writeResult.chapterNumber }, isError: false });
            await appendManualSessionMessages(root, bookSession.sessionId, [{
              role: "assistant", content: [{ type: "text", text: responseText }],
              api: "anthropic-messages", provider: configuredEntry?.service ?? reqService ?? config.llm.provider, model: reqModel ?? config.llm.model,
              usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
              stopReason: "toolUse", timestamp: Date.now(),
            }], instruction);
            await refreshBookSessionFromTranscript();
            broadcast("agent:complete", { instruction, activeBookId: agentBookId, sessionId: bookSession.sessionId });
            return c.json({ response: responseText, session: { sessionId: bookSession.sessionId, activeBookId: agentBookId } });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            broadcast("tool:end", { sessionId: streamSessionId, id: toolCallId, tool: "sub_agent", result: { content: [{ type: "text", text: message }] }, isError: true });
            broadcast("agent:error", { instruction, activeBookId: agentBookId, sessionId: bookSession.sessionId, error: message });
            return c.json({ error: { code: "AGENT_ACTION_FAILED", message }, response: message }, 502);
          }
        }

        // Run pi-agent session
        const collectedToolExecs: CollectedToolExec[] = [];
        const result = await runAgentSession({
          model, apiKey: agentApiKey, pipeline, projectRoot: root,
          bookId: agentBookId, sessionId: bookSession.sessionId,
          language: config.language ?? "zh",
          onEvent: (event) => {
            if (event.type === "message_update") {
              const ame = event.assistantMessageEvent;
              if (ame.type === "text_delta") broadcast("draft:delta", { sessionId: streamSessionId, text: ame.delta });
              else if (ame.type === "thinking_delta") broadcast("thinking:delta", { sessionId: streamSessionId, text: ame.delta });
              else if (ame.type === "thinking_start") broadcast("thinking:start", { sessionId: streamSessionId });
              else if (ame.type === "thinking_end") broadcast("thinking:end", { sessionId: streamSessionId });
            }
            if (event.type === "tool_execution_start") {
              const args = event.args as Record<string, unknown> | undefined;
              const agent = event.toolName === "sub_agent" ? (args?.agent as string | undefined) : undefined;
              const stages = agent ? (PIPELINE_STAGES[agent] ?? []) : [];
              collectedToolExecs.push({ id: event.toolCallId, tool: event.toolName, agent, label: resolveToolLabel(event.toolName, agent), status: "running", args, stages: stages.length > 0 ? stages.map(l => ({ label: l, status: "pending" as const })) : undefined, startedAt: Date.now() });
              if (!agentBookId && event.toolName === "sub_agent" && agent === "architect") {
                const bid = resolveArchitectBookIdFromArgs(args);
                if (bid) {
                  const title = typeof args?.title === "string" && args.title.trim() ? args.title.trim() : bid;
                  bookCreateStatus.set(bid, { status: "creating", createdAt: Date.now(), ttlMs: BOOK_CREATE_TTL_MS });
                  broadcast("book:creating", { bookId: bid, title, sessionId: streamSessionId });
                }
              }
              broadcast("tool:start", { sessionId: streamSessionId, id: event.toolCallId, tool: event.toolName, args, stages });
            }
            if (event.type === "tool_execution_update") broadcast("tool:update", { sessionId: streamSessionId, tool: event.toolName, partialResult: event.partialResult });
            if (event.type === "tool_execution_end") {
              const exec = collectedToolExecs.find(t => t.id === event.toolCallId);
              if (exec) {
                exec.status = event.isError ? "error" : "completed"; exec.completedAt = Date.now();
                exec.stages = exec.stages?.map(s => ({ ...s, status: "completed" as const }));
                if (event.isError) exec.error = extractToolError(event.result);
                else exec.result = summarizeResult(event.result);
                exec.details = (event.result as { details?: unknown } | undefined)?.details;
                if (event.isError && !agentBookId && exec.tool === "sub_agent" && exec.agent === "architect") {
                  const bid = resolveArchitectBookIdFromArgs(exec.args);
                  if (bid) { bookCreateStatus.set(bid, { status: "failed", error: exec.error ?? "Book creation failed", createdAt: Date.now(), ttlMs: BOOK_CREATE_TTL_MS }); broadcast("book:error", { bookId: bid, sessionId: streamSessionId, error: exec.error }); }
                }
              }
              broadcast("tool:end", { sessionId: streamSessionId, id: event.toolCallId, tool: event.toolName, result: event.result, details: exec?.details, isError: event.isError });
            }
          },
        }, instruction);

        if (result.responseText) {
          const actionError = validateAgentActionExecution({ instruction, agentBookId, responseText: result.responseText, collectedToolExecs });
          if (actionError) return c.json({ error: { code: "AGENT_ACTION_NOT_EXECUTED", message: actionError }, response: actionError }, 502);
        }

        // Finalize created book
        let broadcastedCreatedBookId: string | null = null;
        const finalizeCreatedBook = async (): Promise<string | null> => {
          if (agentBookId) return null;
          const createdBookId = resolveCreatedBookIdFromToolExecs(collectedToolExecs);
          if (!createdBookId || broadcastedCreatedBookId === createdBookId) return createdBookId;
          try { const migrated = await migrateBookSession(root, bookSession.sessionId, createdBookId); if (migrated) bookSession = migrated; }
          catch (e) { if (!(e instanceof SessionAlreadyMigratedError)) throw e; }
          const book = await loadStudioBookListSummary(stateManager, createdBookId).catch(() => undefined);
          bookCreateStatus.delete(createdBookId);
          broadcast("book:created", { bookId: createdBookId, sessionId: bookSession.sessionId, ...(book ? { book } : {}) });
          broadcastedCreatedBookId = createdBookId;
          return createdBookId;
        };

        if (!result.responseText) {
          if (result.errorMessage) {
            if (resolveCreatedBookIdFromToolExecs(collectedToolExecs)) await finalizeCreatedBook();
            return c.json({ error: { code: "AGENT_LLM_ERROR", message: result.errorMessage }, response: result.errorMessage }, 502);
          }

          // Fallback: try chat completion directly
          const fallbackClient = createLLMClient({
            ...config.llm, service: configuredEntry?.service ?? reqService ?? config.llm.service,
            model: reqModel ?? config.llm.model, apiKey: agentApiKey ?? config.llm.apiKey,
            baseUrl: configuredEntry?.baseUrl ?? "",
            ...(configuredEntry?.apiFormat ? { apiFormat: configuredEntry.apiFormat } : {}),
            ...(configuredEntry?.stream !== undefined ? { stream: configuredEntry.stream } : {}),
          });
          const { chatCompletion: fallbackChat } = await import("@actalk/inkos-core");
          const { buildAgentSystemPrompt: fallbackPrompt } = await import("@actalk/inkos-core");

          let fallbackContent = "";
          try {
            const fallback = await fallbackChat(fallbackClient, reqModel ?? config.llm.model,
              [{ role: "system", content: fallbackPrompt(agentBookId, config.language ?? "zh") }, { role: "user", content: instruction }],
              { maxTokens: 256 });
            fallbackContent = fallback.content?.trim() ?? "";
          } catch (probeError) {
            const probeMsg = probeError instanceof Error ? probeError.message : String(probeError);
            return c.json({
              error: { code: "AGENT_EMPTY_RESPONSE", message: probeMsg },
              response: probeMsg,
            }, 502);
          }

          if (fallbackContent) {
            const actionError = validateAgentActionExecution({ instruction, agentBookId, responseText: fallbackContent, collectedToolExecs });
            if (actionError) return c.json({ error: { code: "AGENT_ACTION_NOT_EXECUTED", message: actionError }, response: actionError }, 502);
            await appendManualSessionMessages(root, bookSession.sessionId, [{
              role: "assistant", content: [{ type: "text", text: fallbackContent }],
              api: "anthropic-messages", provider: configuredEntry?.service ?? reqService ?? config.llm.provider, model: reqModel ?? config.llm.model,
              usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
              stopReason: "stop", timestamp: Date.now(),
            }], instruction);
            await refreshBookSessionFromTranscript();
            const createdBookId = await finalizeCreatedBook();
            return c.json({ response: fallbackContent, session: { sessionId: bookSession.sessionId, ...(createdBookId ? { activeBookId: createdBookId } : {}) } });
          }
        }

        await refreshBookSessionFromTranscript();
        await finalizeCreatedBook();
        broadcast("agent:complete", { instruction, activeBookId, sessionId: bookSession.sessionId });
        return c.json({ response: result.responseText, session: { sessionId: bookSession.sessionId, ...(bookSession.bookId ? { activeBookId: bookSession.bookId } : {}) } });
      } finally {
        disposePipeline();
      }
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if (e instanceof SessionAlreadyMigratedError) throw new ApiError(409, "SESSION_ALREADY_MIGRATED", e.message);
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[studio] Agent error:", msg);
      broadcast("agent:error", { instruction, activeBookId, sessionId, error: msg });
      if (/already processing|prompt.*queue/i.test(msg)) {
        return c.json({ error: { code: "AGENT_BUSY", message: "正在处理中，请等待当前操作完成" }, response: "正在处理中，请等待当前操作完成后再发送。" }, 429);
      }
      return c.json({ error: { code: "AGENT_ERROR", message: msg } }, 500);
    }
  });
}
