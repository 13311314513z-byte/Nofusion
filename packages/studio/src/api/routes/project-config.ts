import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { ServerContext } from "../server-context.js";

/**
 * Model override configuration routes.
 */
export function registerModelOverridesRoutes(ctx: ServerContext): void {
  ctx.app.get("/api/v1/project/model-overrides", async (c) => {
    const configPath = join(ctx.root, "inkos.json");
    try {
      const raw = JSON.parse(await readFile(configPath, "utf-8"));
      return c.json({ modelOverrides: raw.modelOverrides ?? {} });
    } catch {
      return c.json({ modelOverrides: {} });
    }
  });

  ctx.app.put("/api/v1/project/model-overrides", async (c) => {
    const body = await c.req.json<{ modelOverrides?: Record<string, unknown> }>();
    const configPath = join(ctx.root, "inkos.json");
    try {
      const rawContent = await readFile(configPath, "utf-8");
      if (!rawContent.trim()) {
        return c.json({ error: "inkos.json is empty" }, 400);
      }
      const existing = JSON.parse(rawContent);
      existing.modelOverrides = body.modelOverrides ?? {};
      const tmpPath = configPath + ".tmp." + Date.now().toString(36);
      await writeFile(tmpPath, JSON.stringify(existing, null, 2), "utf-8");
      await rename(tmpPath, configPath);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });
}

/**
 * Notification channel configuration routes.
 */
export function registerNotifyRoutes(ctx: ServerContext): void {
  ctx.app.get("/api/v1/project/notify", async (c) => {
    const configPath = join(ctx.root, "inkos.json");
    try {
      const raw = JSON.parse(await readFile(configPath, "utf-8"));
      const channels = (raw.notify ?? []) as unknown[];
      return c.json({ channels });
    } catch {
      return c.json({ channels: [] });
    }
  });

  ctx.app.put("/api/v1/project/notify", async (c) => {
    const { channels } = await c.req.json<{ channels: unknown[] }>();
    const configPath = join(ctx.root, "inkos.json");
    let raw: Record<string, unknown>;
    try {
      const rawContent = await readFile(configPath, "utf-8");
      if (!rawContent.trim()) {
        return c.json({ error: "inkos.json is empty" }, 400);
      }
      raw = JSON.parse(rawContent);
    } catch (e) {
      return c.json({ error: `inkos.json parse error: ${e instanceof Error ? e.message : String(e)}` }, 400);
    }
    raw.notify = channels;
    const tmpPath = configPath + ".tmp." + Date.now().toString(36);
    await writeFile(tmpPath, JSON.stringify(raw, null, 2), "utf-8");
    await rename(tmpPath, configPath);
    return c.json({ ok: true });
  });

  ctx.app.post("/api/v1/project/notify/test", async (c) => {
    const body = await c.req.json<{ channel: Record<string, unknown> }>();
    const { channel } = body;
    const type = typeof channel?.type === "string" ? channel.type : "";
    const title = typeof channel?.title === "string" ? channel.title : "InkOS Test";
    const text = typeof channel?.text === "string" ? channel.text : "Notification test message.";

    try {
      switch (type) {
        case "telegram": {
          const { sendTelegram } = await import("@actalk/inkos-core");
          await sendTelegram(
            { botToken: String(channel.botToken ?? ""), chatId: String(channel.chatId ?? ""), events: [] },
            { event: "diagnostic-alert", bookId: "", timestamp: new Date().toISOString(), data: { title, body: text } },
          );
          break;
        }
        case "feishu": {
          const { sendFeishu } = await import("@actalk/inkos-core");
          await sendFeishu(
            { webhookUrl: String(channel.webhookUrl ?? ""), secret: String(channel.secret ?? ""), events: [] },
            { event: "diagnostic-alert", bookId: "", timestamp: new Date().toISOString(), data: { title, body: text } },
          );
          break;
        }
        case "wechatWork": {
          const { sendWechatWork } = await import("@actalk/inkos-core");
          await sendWechatWork(
            { webhookUrl: String(channel.webhookUrl ?? ""), events: [] },
            { event: "diagnostic-alert", bookId: "", timestamp: new Date().toISOString(), data: { title, body: text } },
          );
          break;
        }
        case "webhook": {
          const { sendWebhook } = await import("@actalk/inkos-core");
          await sendWebhook(
            { url: String(channel.url ?? ""), secret: String(channel.secret ?? ""), events: Array.isArray(channel.events) ? channel.events.map(String) : ["*"] },
            { event: "diagnostic-alert", bookId: "", timestamp: new Date().toISOString(), data: { title, body: text } },
          );
          break;
        }
        default:
          return c.json({ error: `Unsupported channel type: ${type}` }, 400);
      }
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });
}
