/**
 * Authors routes — CRUD, sources, reanalyze, diagnostics, and apply-author.
 * Extracted from style.ts (B4).
 */
import type { ServerContext } from "../server-context.js";
import { join, resolve, sep } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  listAuthorProfiles,
  getAuthorProfile,
  createAuthorProfile,
  addStyleSource,
  reanalyzeAuthorProfile,
  deleteAuthorProfile,
  saveAuthorDiagnostics,
  listAuthorDiagnostics,
  getAuthorDiagnostics,
} from "@actalk/inkos-core";
import {
  isSafeStyleId,
  isTextStyleFileType,
  parseSafeStyleImportUrl,
  assertSafeStyleImportTarget,
} from "../shared/style-import-guards.js";

export function registerAuthorsRoutes(ctx: ServerContext): void {
  const { app, root, state: stateManager } = ctx;

  function assertSafeAuthorId(id: string): string {
    const clean = id.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!clean || clean !== id) throw new Error(`Invalid authorId: ${id}`);
    return clean;
  }

  function assertProjectRoot(input: string | undefined, serverRoot: string): string {
    const candidate = input ? resolve(input) : resolve(serverRoot);
    const allowed = resolve(serverRoot);
    const withSep = allowed.endsWith(sep) ? allowed : allowed + sep;
    if (candidate !== allowed && !candidate.startsWith(withSep)) throw new Error("Project root out of bounds");
    return candidate;
  }

  // ── Authors CRUD ──

  app.get("/api/v1/style/authors", async (c) => {
    try {
      const index = await listAuthorProfiles(root);
      return c.json(index);
    } catch (e) { return c.json({ error: String(e) }, 500); }
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
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.get("/api/v1/style/authors/:authorId", async (c) => {
    const authorId = c.req.param("authorId");
    if (!isSafeStyleId(authorId)) return c.json({ error: "invalid author id" }, 400);
    try {
      const result = await getAuthorProfile(root, authorId);
      if (!result) return c.json({ error: "Author not found" }, 404);
      return c.json(result);
    } catch (e) { return c.json({ error: String(e) }, 500); }
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
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.post("/api/v1/style/authors/:authorId/reanalyze", async (c) => {
    const authorId = c.req.param("authorId");
    if (!isSafeStyleId(authorId)) return c.json({ error: "invalid author id" }, 400);
    try {
      const profile = await reanalyzeAuthorProfile(root, authorId);
      return c.json(profile);
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.delete("/api/v1/style/authors/:authorId", async (c) => {
    const authorId = c.req.param("authorId");
    if (!isSafeStyleId(authorId)) return c.json({ error: "invalid author id" }, 400);
    try {
      await deleteAuthorProfile(root, authorId);
      return c.json({ ok: true });
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.post("/api/v1/style/authors/:authorId/diagnostics", async (c) => {
    const authorId = c.req.param("authorId");
    if (!isSafeStyleId(authorId)) return c.json({ error: "invalid author id" }, 400);
    const { data } = await c.req.json<{ data: unknown }>();
    if (!data) return c.json({ error: "data is required" }, 400);
    try {
      const id = randomUUID().slice(0, 8);
      const entry = await saveAuthorDiagnostics(root, authorId, id, data);
      return c.json(entry);
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.get("/api/v1/style/authors/:authorId/diagnostics", async (c) => {
    const authorId = c.req.param("authorId");
    if (!isSafeStyleId(authorId)) return c.json({ error: "invalid author id" }, 400);
    try {
      const entries = await listAuthorDiagnostics(root, authorId);
      return c.json({ entries });
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.get("/api/v1/style/authors/:authorId/diagnostics/:diagnosticsId", async (c) => {
    const authorId = c.req.param("authorId");
    const diagnosticsId = c.req.param("diagnosticsId");
    if (!isSafeStyleId(authorId)) return c.json({ error: "invalid author id" }, 400);
    try {
      const data = await getAuthorDiagnostics(root, authorId, diagnosticsId);
      if (!data) return c.json({ error: "not found" }, 404);
      return c.json(data);
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  // ── Apply Author to Book ──

  app.post("/api/v1/books/:id/style/apply-author", async (c) => {
    const bookId = c.req.param("id");
    const { authorId } = await c.req.json<{ authorId: string }>();
    if (!authorId?.trim()) return c.json({ error: "authorId is required" }, 400);
    if (!isSafeStyleId(authorId)) return c.json({ error: "invalid author id" }, 400);

    ctx.broadcast("style:start", { bookId, type: "apply-author", authorId });
    try {
      const result = await getAuthorProfile(root, authorId);
      if (!result) {
        ctx.broadcast("style:error", { bookId, type: "apply-author", authorId, error: "Author not found" });
        return c.json({ error: "Author not found" }, 404);
      }

      const bookDir = stateManager.bookDir(bookId);
      const storyDir = join(bookDir, "story");
      await mkdir(storyDir, { recursive: true });

      const profilePath = join(storyDir, "style_profile.json");
      await writeFile(profilePath, JSON.stringify(result.profile.aggregateProfile, null, 2), "utf-8");

      const book = await stateManager.loadBookConfig(bookId);
      const lang = book.language ?? "zh";
      const p = result.profile.aggregateProfile;
      const guide = lang === "en"
        ? `# Style Guide\n\n**Source**: Author profile "${result.profile.name}"\n\n## Statistical Fingerprint\n- Average sentence length: ${p.avgSentenceLength.toFixed(1)} chars\n- Sentence length std dev: ${p.sentenceLengthStdDev.toFixed(1)}\n- Average paragraph length: ${p.avgParagraphLength.toFixed(0)} chars\n- Paragraph length range: ${p.paragraphLengthRange.min} - ${p.paragraphLengthRange.max}\n- Vocabulary diversity (TTR): ${(p.vocabularyDiversity * 100).toFixed(1)}%\n${p.topPatterns.length > 0 ? `\n## Top Patterns\n${p.topPatterns.map((x: string) => `- ${x}`).join("\n")}` : ""}\n${p.rhetoricalFeatures.length > 0 ? `\n## Rhetorical Features\n${p.rhetoricalFeatures.map((x: string) => `- ${x}`).join("\n")}` : ""}\n`
        : `# 文风指南\n\n**来源**：作家档案「${result.profile.name}」\n\n## 统计指纹\n- 平均句长：${p.avgSentenceLength.toFixed(1)} 字\n- 句长标准差：${p.sentenceLengthStdDev.toFixed(1)}\n- 平均段落长度：${p.avgParagraphLength.toFixed(0)} 字\n- 段落长度范围：${p.paragraphLengthRange.min} - ${p.paragraphLengthRange.max}\n- 词汇多样性（TTR）：${(p.vocabularyDiversity * 100).toFixed(1)}%\n${p.topPatterns.length > 0 ? `\n## 高频句式\n${p.topPatterns.map((x: string) => `- ${x}`).join("\n")}` : ""}\n${p.rhetoricalFeatures.length > 0 ? `\n## 修辞特征\n${p.rhetoricalFeatures.map((x: string) => `- ${x}`).join("\n")}` : ""}\n`;

      const guidePath = join(storyDir, "style_guide.md");
      await writeFile(guidePath, guide, "utf-8");

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

      ctx.broadcast("style:complete", { bookId, type: "apply-author", authorId });
      return c.json({
        ok: true,
        bookId,
        authorId,
        authorName: result.profile.name,
        styleProfilePath: "story/style_profile.json",
        styleGuidePath: "story/style_guide.md",
      });
    } catch (e) {
      ctx.broadcast("style:error", { bookId, type: "apply-author", authorId, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // ── Author Search ──

  app.post("/api/v1/style/authors/search", async (c) => {
    const raw = await c.req.json<{ authorName: string; language?: string }>();
    if (!raw.authorName?.trim()) return c.json({ error: "authorName is required" }, 400);
    try {
      const { searchAuthorWorks } = await import("../author-search.js");
      const results = await searchAuthorWorks({
        authorName: raw.authorName.trim(),
        language: (raw.language ?? "zh") as "zh" | "en",
      });
      return c.json({ results });
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.post("/api/v1/style/authors/fetch", async (c) => {
    const raw = await c.req.json<{ url: string; maxChars?: number }>();
    if (!raw.url?.trim()) return c.json({ error: "url is required" }, 400);
    try {
      const url = parseSafeStyleImportUrl(raw.url);
      await assertSafeStyleImportTarget(url);
      const { fetchUrl } = await import("@actalk/inkos-core");
      const content = await fetchUrl(url.toString(), raw.maxChars ?? 8000);
      return c.json({ content });
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.post("/api/v1/style/authors/samples/write", async (c) => {
    const raw = await c.req.json<{
      authorId: string; authorName: string; sourceUrl: string;
      fetchedAt: string; content: string; charCount: number;
    }>();
    if (!raw.authorId || !raw.content) return c.json({ error: "authorId and content are required" }, 400);
    try {
      assertSafeAuthorId(raw.authorId);
      const prjRoot = assertProjectRoot(process.env.INKOS_PROJECT_ROOT || c.req.header("x-project-root") || undefined, root);
      const { writeAuthorSample } = await import("../author-sample-writer.js");
      const result = await writeAuthorSample(prjRoot, raw);
      return c.json(result);
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  // ── Author Distillation ──

  app.post("/api/v1/style/authors/:authorId/distillations", async (c) => {
    const authorId = assertSafeAuthorId(c.req.param("authorId"));
    const prjRoot = assertProjectRoot(process.env.INKOS_PROJECT_ROOT || c.req.header("x-project-root") || undefined, root);
    try {
      const { getAuthorProfile, generateDistillation, loadDistillationEvidence,
        loadDistillationOverrides, saveDistillationDraft, loadCurrentDistillation,
      } = await import("@actalk/inkos-core");
      const authorData = await getAuthorProfile(prjRoot, authorId);
      if (!authorData) return c.json({ error: "Author not found" }, 404);
      const evidence = await loadDistillationEvidence(prjRoot, authorId);
      const overrides = await loadDistillationOverrides(prjRoot, authorId);
      const previous = await loadCurrentDistillation(prjRoot, authorId);
      const mergedPrevious = previous
        ? { ...previous, rules: overrides.length > 0 ? overrides : previous.rules }
        : undefined;
      const result = generateDistillation({
        profile: authorData.profile, sources: authorData.sources,
        evidence: [...evidence], previous: mergedPrevious,
      });
      await saveDistillationDraft(prjRoot, authorId, result.distillation, result.markdown);
      return c.json(result.distillation, 201);
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

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
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.patch("/api/v1/style/authors/:authorId/distillations/current", async (c) => {
    const authorId = assertSafeAuthorId(c.req.param("authorId"));
    const prjRoot = assertProjectRoot(process.env.INKOS_PROJECT_ROOT || c.req.header("x-project-root") || undefined, root);
    try {
      const body = await c.req.json<{ overrides: unknown[] }>();
      const { saveDistillationOverrides, loadCurrentDistillation, saveDistillationDraft,
        generateDistillation, getAuthorProfile, loadDistillationEvidence,
      } = await import("@actalk/inkos-core");
      type DistillationRule = import("@actalk/inkos-core").DistillationRule;
      if (!body.overrides || !Array.isArray(body.overrides)) {
        return c.json({ error: "overrides array is required" }, 400);
      }
      const overrides = body.overrides.filter((override): override is DistillationRule =>
        typeof override === "object" && override !== null,
      );
      await saveDistillationOverrides(prjRoot, authorId, overrides);
      const authorData = await getAuthorProfile(prjRoot, authorId);
      if (!authorData) return c.json({ error: "Author not found" }, 404);
      const evidence = await loadDistillationEvidence(prjRoot, authorId);
      const previous = await loadCurrentDistillation(prjRoot, authorId);
      const result = generateDistillation({
        profile: authorData.profile, sources: authorData.sources,
        evidence: [...evidence], previous: previous ?? undefined,
      });
      await saveDistillationDraft(prjRoot, authorId, result.distillation, result.markdown);
      return c.json(result.distillation);
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.post("/api/v1/style/authors/:authorId/distillations/current/publish", async (c) => {
    const authorId = assertSafeAuthorId(c.req.param("authorId"));
    const prjRoot = assertProjectRoot(process.env.INKOS_PROJECT_ROOT || c.req.header("x-project-root") || undefined, root);
    try {
      const { loadCurrentDistillation, publishDistillation, getAuthorProfile,
      } = await import("@actalk/inkos-core");
      const distillation = await loadCurrentDistillation(prjRoot, authorId);
      if (!distillation) return c.json({ error: "No distillation to publish" }, 400);
      if (distillation.sampleAdequacy === "insufficient") {
        return c.json({ error: "Insufficient samples — cannot publish. Add more sources first." }, 400);
      }
      const authorData = await getAuthorProfile(prjRoot, authorId);
      const currentVersion = authorData?.profile.version ?? distillation.authorProfileVersion;
      if (distillation.authorProfileVersion !== currentVersion) {
        return c.json({ error: "Author profile has changed since this distillation was generated. Regenerate first.", stale: true }, 400);
      }
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      let markdown = "";
      try {
        markdown = await readFile(join(prjRoot, "style-library", "authors", authorId, "distillation", "current.md"), "utf-8");
      } catch { /* use empty */ }
      const published = await publishDistillation(prjRoot, authorId, distillation, markdown);
      return c.json(published);
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });

  app.get("/api/v1/style/authors/:authorId/distillations/versions", async (c) => {
    const authorId = assertSafeAuthorId(c.req.param("authorId"));
    const prjRoot = assertProjectRoot(process.env.INKOS_PROJECT_ROOT || c.req.header("x-project-root") || undefined, root);
    try {
      const { listDistillationVersions } = await import("@actalk/inkos-core");
      const versions = await listDistillationVersions(prjRoot, authorId);
      return c.json({ versions });
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });
}
