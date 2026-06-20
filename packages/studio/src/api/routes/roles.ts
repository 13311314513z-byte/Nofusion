import type { ServerContext } from "../server-context.js";
import { ApiError } from "../errors.js";
import {
  listRoleCards,
  loadRoleCard,
  saveRoleCard,
  deleteRoleCard,
  createRoleCardTemplate,
  type RoleCard,
  type RoleTier,
} from "@actalk/inkos-core";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function assertBookExists(state: ServerContext["state"], id: string): Promise<void> {
  try {
    await state.loadBookConfig(id);
  } catch {
    throw new ApiError(404, "BOOK_NOT_FOUND", `Book not found: ${id}`);
  }
}

// ─── Route Registration ──────────────────────────────────────────────────────

export function registerRolesRoutes(ctx: ServerContext): void {
  const { app, state } = ctx;

  // GET /api/v1/books/:id/roles
  app.get("/api/v1/books/:id/roles", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    try {
      const bookDir = state.bookDir(id);
      const roles = await listRoleCards(bookDir);
      return c.json({ roles });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // GET /api/v1/books/:id/roles/:roleId
  app.get("/api/v1/books/:id/roles/:roleId", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    const roleId = c.req.param("roleId");
    try {
      const bookDir = state.bookDir(id);
      const card = await loadRoleCard(bookDir, roleId);
      if (!card) return c.json({ error: "Role not found" }, 404);
      return c.json({ card });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // POST /api/v1/books/:id/roles
  app.post("/api/v1/books/:id/roles", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    const body = await c.req.json<{ id: string; name: string; roleTier?: RoleTier }>();
    if (!body.id || !body.name) return c.json({ error: "id and name are required" }, 400);
    try {
      const bookDir = state.bookDir(id);
      const card = createRoleCardTemplate(body.id, body.name, body.roleTier ?? "major");
      await saveRoleCard(bookDir, card);
      return c.json({ ok: true, card });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // PUT /api/v1/books/:id/roles/:roleId
  app.put("/api/v1/books/:id/roles/:roleId", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    const roleId = c.req.param("roleId");
    const body = await c.req.json<Partial<RoleCard>>();
    try {
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

  // DELETE /api/v1/books/:id/roles/:roleId
  app.delete("/api/v1/books/:id/roles/:roleId", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(state, id);
    const roleId = c.req.param("roleId");
    try {
      const bookDir = state.bookDir(id);
      const ok = await deleteRoleCard(bookDir, roleId);
      if (!ok) return c.json({ error: "Role not found" }, 404);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });
}
