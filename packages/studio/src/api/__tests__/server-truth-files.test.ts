/**
 * Split from server.test.ts.  Shared mocks: ./mocks/core.mocks.js  Shared fixtures: ./mocks/fixtures.js
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  schedulerStartMock, initBookMock, runRadarMock, reviseDraftMock,
  resyncChapterArtifactsMock, writeNextChapterMock, rollbackToChapterMock,
  saveChapterIndexMock, loadChapterIndexMock, loadBookConfigMock, listBooksMock,
  getNextChapterNumberMock, auditChapterMock, createLLMClientMock, chatCompletionMock,
  loadProjectConfigMock, processProjectInteractionRequestMock,
  createInteractionToolsFromDepsMock, loadProjectSessionMock,
  resolveSessionActiveBookMock, runAgentSessionMock,
  createAndPersistBookSessionMock, loadBookSessionMock,
  persistBookSessionMock, appendBookSessionMessageMock,
  appendManualSessionMessagesMock, renameBookSessionMock, deleteBookSessionMock,
  migrateBookSessionMock, resolveServiceModelMock, loadSecretsMock, saveSecretsMock,
  setServiceApiKeyMock, getServiceApiKeyMock,
  resolveServicePresetMock, resolveServiceProviderFamilyMock,
  resolveServiceModelsBaseUrlMock, listModelsForServiceMock,
  getAllEndpointsMock, probeModelsFromUpstreamMock, dnsLookupMock,
  pipelineConfigs, SERVICE_PRESETS_MOCK, endpointMocks,
} from "./mocks/core.mocks.js";
import { projectConfig, cloneProjectConfig, setupTestRoot, cleanupTestRoot } from "./mocks/fixtures.js";
import { createStudioServer } from "../server.js";

describe("createStudioServer truth files", () => {
  let root: string;

  beforeEach(async () => {
    root = await setupTestRoot();
  });

  afterEach(async () => {
    await cleanupTestRoot(root);
  });

  it("allows reading and updating fixed control truth files", async () => {
    const bookDir = join(root, "books", "demo-book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });
    await Promise.all([
      writeFile(join(storyDir, "author_intent.md"), "# Author Intent\n\nStay cold.\n", "utf-8"),
      writeFile(join(storyDir, "current_focus.md"), "# Current Focus\n\nReturn to the old case.\n", "utf-8"),
    ]);

    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const readAuthorIntent = await app.request("http://localhost/api/v1/books/demo-book/truth/author_intent.md");
    expect(readAuthorIntent.status).toBe(200);
    await expect(readAuthorIntent.json()).resolves.toMatchObject({
      file: "author_intent.md",
      content: "# Author Intent\n\nStay cold.\n",
    });

    const updateCurrentFocus = await app.request("http://localhost/api/v1/books/demo-book/truth/current_focus.md", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "# Current Focus\n\nPull focus back to the harbor trail.\n" }),
    });
    expect(updateCurrentFocus.status).toBe(200);

    await expect(readFile(join(storyDir, "current_focus.md"), "utf-8")).resolves.toBe(
      "# Current Focus\n\nPull focus back to the harbor trail.\n",
    );
  });

  it("allows manual edits for nested authoritative truth files", async () => {
    const bookDir = join(root, "books", "demo-book");
    const outlineDir = join(bookDir, "story", "outline");
    await mkdir(outlineDir, { recursive: true });
    await writeFile(join(outlineDir, "story_frame.md"), "# Old Frame\n", "utf-8");

    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const update = await app.request("http://localhost/api/v1/books/demo-book/truth/outline/story_frame.md", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "# Edited Frame\n\nManual canon update.\n" }),
    });

    expect(update.status).toBe(200);
    await expect(update.json()).resolves.toMatchObject({
      ok: true,
      file: "outline/story_frame.md",
    });
    await expect(readFile(join(outlineDir, "story_frame.md"), "utf-8")).resolves.toBe(
      "# Edited Frame\n\nManual canon update.\n",
    );
  });

  it("rejects manual edits for new-layout compatibility shims", async () => {
    const core = await import("@actalk/inkos-core");
    vi.mocked(core.isNewLayoutBook).mockResolvedValueOnce(true);
    const bookDir = join(root, "books", "demo-book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });
    await writeFile(join(storyDir, "story_bible.md"), "# Shim\n", "utf-8");

    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const update = await app.request("http://localhost/api/v1/books/demo-book/truth/story_bible.md", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "# Should Not Save\n" }),
    });

    expect(update.status).toBe(409);
    await expect(readFile(join(storyDir, "story_bible.md"), "utf-8")).resolves.toBe("# Shim\n");
  });

  it("rejects manual truth-file edits outside the allowlist", async () => {
    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/books/demo-book/truth/not_allowed.md", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "{}" }),
    });

    expect(response.status).toBe(400);
  });

  it("exposes a resync endpoint for rebuilding latest chapter truth artifacts", async () => {
    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/books/demo-book/resync/3", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief: "以师债线为准同步状态。" }),
    });

    expect(response.status).toBe(200);
    expect(pipelineConfigs.at(-1)).toMatchObject({ externalContext: "以师债线为准同步状态。" });
    expect(resyncChapterArtifactsMock).toHaveBeenCalledWith("demo-book", 3);
  });
});
