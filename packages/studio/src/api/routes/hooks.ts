import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ServerContext } from "../server-context.js";

interface HookRecord {
  readonly hookId: string;
  readonly startChapter: number;
  readonly type: string;
  readonly status: string;
  readonly lastAdvancedChapter: number;
  readonly expectedPayoff: string;
  readonly payoffTiming: string;
  readonly dependsOn: string;
  readonly paysOffInArc: string;
  readonly coreHook: string;
  readonly halfLife: string;
  readonly notes: string;
}

function normalizeHookHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "").replace(/[_-]/g, "");
}

function parseHookChapterNumber(value: string): number {
  const match = value.match(/\d+/);
  return match ? Number.parseInt(match[0], 10) || 0 : 0;
}

function normalizeHookStatus(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "open";
  if (/resolved|closed|已回收|已解决|完成/.test(normalized)) return "resolved";
  if (/deferred|推迟|延后|搁置/.test(normalized)) return "deferred";
  if (/progress|推进中|进行中/.test(normalized)) return "progressing";
  if (/open|待展开|未回收|开启|开放/.test(normalized)) return "open";
  return normalized;
}

function parseHooksMarkdown(content: string): HookRecord[] {
  const lines = content.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("|") && l.endsWith("|"));
  if (lines.length < 2) return [];

  const dataLines = lines.filter((l) => !/^[|\s\-:=]+$/.test(l));
  if (dataLines.length < 2) return [];

  const headers = dataLines[0]!.split("|").slice(1, -1).map(normalizeHookHeader);
  const records: HookRecord[] = [];

  for (let i = 1; i < dataLines.length; i++) {
    const cells = dataLines[i]!.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;

    const get = (...names: string[]): string => {
      const normalizedNames = names.map(normalizeHookHeader);
      const idx = headers.findIndex((header) => normalizedNames.some((name) => header.includes(name)));
      return idx >= 0 ? (cells[idx] ?? "").trim() : "";
    };

    const hookId = get("hookid", "hook_id", "id", "伏笔id", "钩子id", "伏笔编号");
    if (!hookId) continue;

    records.push({
      hookId,
      startChapter: parseHookChapterNumber(get("startchapter", "start_chapter", "起始章节", "起始章")),
      type: get("type", "类型"),
      status: normalizeHookStatus(get("status", "状态")),
      lastAdvancedChapter: parseHookChapterNumber(get("lastadvanced", "last_advanced_chapter", "last_advanced", "最近推进")),
      expectedPayoff: get("expectedpayoff", "expected_payoff", "预期回收"),
      payoffTiming: get("payofftiming", "payoff_timing", "回收节奏", "回收时机"),
      dependsOn: get("dependson", "depends_on", "上游依赖", "依赖"),
      paysOffInArc: get("paysoffinarc", "pays_off_in_arc", "回收卷"),
      coreHook: get("corehook", "core_hook", "核心", "核心伏笔"),
      halfLife: get("halflife", "half_life", "半衰期"),
      notes: get("notes", "备注"),
    });
  }
  return records;
}

function serializeHooksToMarkdown(hooks: HookRecord[]): string {
  const headers = ["HookId", "StartChapter", "Type", "Status", "LastAdvancedChapter", "ExpectedPayoff", "PayoffTiming", "DependsOn", "PaysOffInArc", "CoreHook", "HalfLife", "Notes"];
  const align = "|" + headers.map(() => "---").join("|") + "|";
  const rows = hooks.map((h) =>
    "|" + [
      h.hookId, h.startChapter || "", h.type, h.status,
      h.lastAdvancedChapter || "", h.expectedPayoff, h.payoffTiming,
      h.dependsOn, h.paysOffInArc, h.coreHook, h.halfLife, h.notes,
    ].join("|") + "|"
  );
  return `# Pending Hooks\n\n|${headers.join("|")}|\n${align}\n${rows.join("\n")}\n`;
}

async function syncHooksToJSON(bookDir: string, hooks: HookRecord[]): Promise<void> {
  const stateDir = join(bookDir, "story", "state");
  await mkdir(stateDir, { recursive: true });
  const hooksPath = join(stateDir, "hooks.json");

  const coreHooks = hooks.map((h) => ({
    hookId: h.hookId,
    startChapter: h.startChapter || 0,
    type: h.type || "",
    status: h.status || "open",
    lastAdvancedChapter: h.lastAdvancedChapter || 0,
    expectedPayoff: h.expectedPayoff || "",
    payoffTiming: h.payoffTiming || undefined,
    notes: h.notes || "",
    dependsOn: h.dependsOn ? h.dependsOn.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : undefined,
    paysOffInArc: h.paysOffInArc || undefined,
    coreHook: /是|true|yes|1/i.test(h.coreHook) ? true : undefined,
    halfLifeChapters: parseInt(h.halfLife, 10) || undefined,
  }));

  await writeFile(hooksPath, JSON.stringify({ hooks: coreHooks, updatedAt: new Date().toISOString() }, null, 2), "utf-8");
}

async function assertBookExists(state: ServerContext["state"], bookId: string): Promise<void> {
  const { ApiError } = await import("../errors.js");
  try {
    await state.loadBookConfig(bookId);
  } catch {
    throw new ApiError(404, "BOOK_NOT_FOUND", `Book "${bookId}" not found`);
  }
}

/**
 * Hooks (伏笔) management routes.
 * GET    /api/v1/books/:id/hooks            — list hooks
 * POST   /api/v1/books/:id/hooks            — create a hook
 * PUT    /api/v1/books/:id/hooks/:hookId    — update a hook
 * DELETE /api/v1/books/:id/hooks/:hookId    — delete a hook
 */
export function registerHooksRoutes(ctx: ServerContext): void {
  ctx.app.get("/api/v1/books/:id/hooks", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(ctx.state, id);
    const bookDir = ctx.state.bookDir(id);

    // Prefer Core's authoritative hooks.json; fall back to pending_hooks.md
    try {
      const hooksJsonPath = join(bookDir, "story", "state", "hooks.json");
      const raw = await readFile(hooksJsonPath, "utf-8");
      const parsed = JSON.parse(raw) as { hooks?: Array<Record<string, unknown>> };
      if (parsed.hooks?.length) {
        const hooks: HookRecord[] = parsed.hooks.map((h: Record<string, unknown>) => ({
          hookId: String(h.hookId ?? ""),
          startChapter: Number(h.startChapter) || 0,
          type: String(h.type ?? ""),
          status: String(h.status ?? "open"),
          lastAdvancedChapter: Number(h.lastAdvancedChapter) || 0,
          expectedPayoff: String(h.expectedPayoff ?? ""),
          payoffTiming: String(h.payoffTiming ?? ""),
          dependsOn: Array.isArray(h.dependsOn) ? (h.dependsOn as string[]).join(", ") : String(h.dependsOn ?? ""),
          paysOffInArc: String(h.paysOffInArc ?? ""),
          coreHook: h.coreHook === true ? "是" : "",
          halfLife: String(h.halfLifeChapters ?? ""),
          notes: String(h.notes ?? ""),
        }));
        return c.json({ hooks });
      }
    } catch {
      // Fall back to pending_hooks.md
    }

    const filePath = resolve(bookDir, "story", "pending_hooks.md");
    try {
      const content = await readFile(filePath, "utf-8");
      return c.json({ hooks: parseHooksMarkdown(content) });
    } catch {
      return c.json({ hooks: [] });
    }
  });

  ctx.app.post("/api/v1/books/:id/hooks", async (c) => {
    const id = c.req.param("id");
    await assertBookExists(ctx.state, id);
    const bookDir = ctx.state.bookDir(id);
    const filePath = resolve(bookDir, "story", "pending_hooks.md");
    const body = await c.req.json<Partial<HookRecord>>().catch((): Partial<HookRecord> => ({}));
    const hookId = body.hookId || `hook-${Date.now()}`;

    try {
      let content = "";
      try { content = await readFile(filePath, "utf-8"); } catch { content = ""; }
      const hooks = content ? parseHooksMarkdown(content) : [];
      if (hooks.some((h) => h.hookId === hookId)) {
        return c.json({ error: "Hook ID already exists" }, 409);
      }
      hooks.push({
        hookId, startChapter: body.startChapter ?? 0, type: body.type ?? "",
        status: body.status ?? "open", lastAdvancedChapter: body.lastAdvancedChapter ?? 0,
        expectedPayoff: body.expectedPayoff ?? "", payoffTiming: body.payoffTiming ?? "",
        dependsOn: body.dependsOn ?? "", paysOffInArc: body.paysOffInArc ?? "",
        coreHook: body.coreHook ?? "", halfLife: body.halfLife ?? "", notes: body.notes ?? "",
      });
      await writeFile(filePath, serializeHooksToMarkdown(hooks), "utf-8");
      await syncHooksToJSON(bookDir, hooks);
      return c.json({ ok: true, hookId });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  ctx.app.put("/api/v1/books/:id/hooks/:hookId", async (c) => {
    const id = c.req.param("id");
    const hookId = c.req.param("hookId");
    await assertBookExists(ctx.state, id);
    const bookDir = ctx.state.bookDir(id);
    const filePath = resolve(bookDir, "story", "pending_hooks.md");
    const body = await c.req.json<Partial<HookRecord>>().catch((): Partial<HookRecord> => ({}));

    try {
      const content = await readFile(filePath, "utf-8");
      const hooks = parseHooksMarkdown(content);
      const idx = hooks.findIndex((h) => h.hookId === hookId);
      if (idx === -1) return c.json({ error: "Hook not found" }, 404);
      hooks[idx] = { ...hooks[idx], ...body, hookId };
      await writeFile(filePath, serializeHooksToMarkdown(hooks), "utf-8");
      await syncHooksToJSON(bookDir, hooks);
      return c.json({ ok: true, hookId });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  ctx.app.delete("/api/v1/books/:id/hooks/:hookId", async (c) => {
    const id = c.req.param("id");
    const hookId = c.req.param("hookId");
    await assertBookExists(ctx.state, id);
    const bookDir = ctx.state.bookDir(id);
    const filePath = resolve(bookDir, "story", "pending_hooks.md");

    try {
      const content = await readFile(filePath, "utf-8");
      const hooks = parseHooksMarkdown(content);
      const filtered = hooks.filter((h) => h.hookId !== hookId);
      if (filtered.length === hooks.length) return c.json({ error: "Hook not found" }, 404);
      await writeFile(filePath, serializeHooksToMarkdown(filtered), "utf-8");
      await syncHooksToJSON(bookDir, filtered);
      return c.json({ ok: true, hookId });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });
}
