import type { ServerContext } from "../server-context.js";
import { ApiError } from "../errors.js";
import {
  loadProjectSession,
  resolveSessionActiveBook,
  listBookSessions,
  loadBookSession,
  createAndPersistBookSession,
  renameBookSession,
  deleteBookSession,
} from "@actalk/inkos-core";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeApiBookId(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new ApiError(400, "INVALID_BOOK_ID", `${fieldName} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ApiError(400, "INVALID_BOOK_ID", `${fieldName} cannot be blank`);
  }
  if (!/^[a-z0-9\u4e00-\u9fff][a-z0-9\u4e00-\u9fff._-]*$/i.test(trimmed)) {
    throw new ApiError(400, "INVALID_BOOK_ID", `Invalid ${fieldName}: "${trimmed}"`);
  }
  return trimmed;
}

// ─── Route Registration ──────────────────────────────────────────────────────

export function registerSessionsRoutes(ctx: ServerContext): void {
  const { app, root } = ctx;

  // GET /api/v1/interaction/session
  app.get("/api/v1/interaction/session", async (c) => {
    const session = await loadProjectSession(root);
    const activeBookId = await resolveSessionActiveBook(root, session);
    return c.json({
      session: activeBookId && session.activeBookId !== activeBookId
        ? { ...session, activeBookId }
        : session,
      activeBookId,
    });
  });

  // GET /api/v1/sessions
  app.get("/api/v1/sessions", async (c) => {
    const bookId = c.req.query("bookId");
    const limit = Math.min(Math.max(Number(c.req.query("limit")) || 50, 1), 200);
    const offset = Math.max(Number(c.req.query("offset")) || 0, 0);
    const sessions = await listBookSessions(root, bookId === undefined ? null : bookId === "null" ? null : bookId);
    const page = sessions.slice(offset, offset + limit);
    return c.json({ sessions: page, total: sessions.length, offset, limit });
  });

  // GET /api/v1/sessions/:sessionId
  app.get("/api/v1/sessions/:sessionId", async (c) => {
    const session = await loadBookSession(root, c.req.param("sessionId"));
    if (!session) return c.json({ error: "Session not found" }, 404);
    return c.json({ session });
  });

  // POST /api/v1/sessions
  app.post("/api/v1/sessions", async (c) => {
    const body = await c.req.json<{ bookId?: string | null; sessionId?: string }>().catch(() => ({}));
    const bookId = normalizeApiBookId((body as { bookId?: unknown }).bookId, "bookId");
    const sessionId = (body as { sessionId?: string }).sessionId;
    const safeSessionId = sessionId && /^[0-9]+-[a-z0-9]+$/.test(sessionId) ? sessionId : undefined;
    const session = await createAndPersistBookSession(root, bookId, safeSessionId);
    return c.json({ session });
  });

  // PUT /api/v1/sessions/:sessionId
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

  // DELETE /api/v1/sessions/:sessionId
  app.delete("/api/v1/sessions/:sessionId", async (c) => {
    await deleteBookSession(root, c.req.param("sessionId"));
    return c.json({ ok: true });
  });
}
