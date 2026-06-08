import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { sendWebhookMock } = vi.hoisted(() => ({
  sendWebhookMock: vi.fn(),
}));

vi.mock("@actalk/inkos-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@actalk/inkos-core")>();
  return {
    ...actual,
    sendWebhook: sendWebhookMock,
    sendFeishu: vi.fn(),
    sendWechatWork: vi.fn(),
    sendTelegram: vi.fn(),
  };
});

const projectConfig = {
  name: "studio-notify-security-test",
  version: "0.1.0",
  language: "zh" as const,
  llm: {
    provider: "openai",
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    model: "gpt-5.4",
    temperature: 0.7,
    maxTokens: 4096,
    stream: false,
  },
  daemon: {
    schedule: { radarCron: "0 */6 * * *", writeCron: "*/15 * * * *" },
    maxConcurrentBooks: 1,
    chaptersPerCycle: 1,
    retryDelayMs: 30000,
    cooldownAfterChapterMs: 0,
    maxChaptersPerDay: 50,
  },
  modelOverrides: {},
  notify: [],
};

describe("notify test endpoint security", () => {
  let root: string;

  afterEach(async () => {
    sendWebhookMock.mockReset();
    if (root) {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects private webhook URLs before sending", async () => {
    root = await mkdtemp(join(tmpdir(), "studio-notify-security-"));
    await writeFile(join(root, "inkos.json"), JSON.stringify(projectConfig, null, 2), "utf-8");
    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(projectConfig as never, root);

    const response = await app.request("http://localhost/api/v1/project/notify/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: {
          type: "webhook",
          url: "http://127.0.0.1:12345/internal",
        },
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "INVALID_NOTIFY_WEBHOOK_URL",
      },
    });
    expect(sendWebhookMock).not.toHaveBeenCalled();
  }, 15_000);
});
