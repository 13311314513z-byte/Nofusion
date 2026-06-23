/**
 * Import routes — Chapter Import + Canon Import + Foundation Import.
 * Extracted from style.ts (B4).
 */
import {
buildFoundationSourceBundle,
isDocumentFileType,
isFoundationSourcePurpose,
planChapterImport,
type ArchitectOutput,
type ChapterImportPlan,
type FoundationSourceBundle,
type FoundationSourceInput,
} from "@actalk/inkos-core";
import { randomUUID } from "node:crypto";
import { withPipeline } from "../../shared/pipeline-utils.js";
import type { ServerContext } from "../server-context.js";

interface FoundationImportPlan {
  readonly bookId: string;
  readonly mode: "supplement" | "rebuild";
  readonly proposed: ArchitectOutput;
  readonly foundationRevision: string;
  readonly sourceBundle?: FoundationSourceBundle;
  readonly expiresAt: number;
}

function isFoundationImportPlan(value: unknown): value is FoundationImportPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return typeof plan.bookId === "string"
    && (plan.mode === "supplement" || plan.mode === "rebuild")
    && typeof plan.proposed === "object"
    && plan.proposed !== null
    && typeof plan.foundationRevision === "string"
    && typeof plan.expiresAt === "number";
}

export function registerImportRoutes(ctx: ServerContext): void {
  const { app, root, state: _stateManager, broadcast, buildPipelineConfig } = ctx;

  async function _assertBookExists(state: ServerContext["state"], bookId: string): Promise<void> {
    try { await state.loadBookConfig(bookId); }
    catch { throw new Error(`Book not found: ${bookId}`); }
  }

  // --- Import Chapters ---

  // Step 1: Preview / plan import (no filesystem changes)
  app.post("/api/v1/books/:id/import/chapters/plan", async (c) => {
    const _id = c.req.param("id");
    const { text, splitRegex, startNumber } = await c.req.json<{
      text: string; splitRegex?: string; startNumber?: number;
    }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);
    try {
      const plan = planChapterImport(text, { splitRegex, startNumber });
      return c.json({ plan });
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  // Step 2: Commit planned import (writes to filesystem)
  app.post("/api/v1/books/:id/import/chapters/commit", async (c) => {
    const id = c.req.param("id");
    const { plan } = await c.req.json<{ plan: ChapterImportPlan }>();
    if (!plan?.chapters?.length) return c.json({ error: "plan is required" }, 400);
    broadcast("import:start", { bookId: id, type: "chapters" });
    try {
      const chapters = plan.chapters.map((ch) => ({
        title: ch.title, content: ch.content, targetNumber: ch.targetNumber,
      }));
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
        ctx.foundationPlans.set(planId, {
          bookId: id,
          mode: mode ?? "supplement",
          proposed: result.proposed,
          foundationRevision: result.foundationRevision,
          sourceBundle,
          expiresAt: Date.now() + 30 * 60 * 1000,
        });
        ctx.persistFoundationPlan(root, planId, ctx.foundationPlans.get(planId)! as Record<string, unknown>).catch((e: unknown) => {
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
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.post("/api/v1/books/:id/import/foundation/commit", async (c) => {
    const id = c.req.param("id");
    const { planId } = await c.req.json<{ planId?: string }>();
    if (!planId) return c.json({ error: "planId is required" }, 400);
    await ctx.foundationPlansPromise;
    const plan = ctx.foundationPlans.get(planId);
    if (!isFoundationImportPlan(plan) || plan.bookId !== id || plan.expiresAt < Date.now()) {
      ctx.foundationPlans.delete(planId);
      ctx.removePersistedFoundationPlan(root, planId).catch((e) => {
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
        ctx.foundationPlans.delete(planId);
        ctx.removePersistedFoundationPlan(root, planId).catch((e) => {
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
}
