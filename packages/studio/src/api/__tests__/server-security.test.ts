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

describe("createStudioServer security / import validation", () => {
  let root: string;

  beforeEach(async () => {
    root = await setupTestRoot();
  });

  afterEach(async () => {
    await cleanupTestRoot(root);
  });

  it("uses the real core bookId validator in the Studio safety mock", async () => {
    const { isSafeBookId } = await import("@actalk/inkos-core");

    expect(vi.isMockFunction(isSafeBookId)).toBe(false);
    expect(isSafeBookId("demo-book")).toBe(true);
    expect(isSafeBookId("demo/book")).toBe(false);
  }, 10_000);

  it("rejects foundation commits that are not bound to a server-side plan", async () => {
    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/books/demo-book/import/foundation/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposed: { storyBible: "client-controlled" } }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "planId is required" });
  });

  it("rejects foundation commits that are not bound to a server-side plan", async () => {
    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/books/demo-book/import/foundation/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposed: { storyBible: "client-controlled" } }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "planId is required" });
  });

  it("rejects book routes with path traversal ids", async () => {
    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/books/..%2Fetc%2Fpasswd", {
      method: "GET",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_BOOK_ID",
        message: 'Invalid book ID: "../etc/passwd"',
      },
    });
  });

  it("rejects style URL imports to private IP literals before fetching", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/style/import-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "http://127.0.0.1/private" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "private or local URLs are not allowed",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("rejects style URL imports when a public hostname resolves to a private address", async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }]);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { createStudioServer } = await import("../server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/style/import-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.test/article" }),
    });

    expect(response.status).toBe(400);
    expect(dnsLookupMock).toHaveBeenCalledWith("example.test", { all: true, verbatim: true });
    await expect(response.json()).resolves.toMatchObject({
      error: "private or local URLs are not allowed",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
