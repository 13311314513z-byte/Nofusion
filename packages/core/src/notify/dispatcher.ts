import type { NotifyChannel } from "../models/project.js";
import type { WebhookPayload } from "./webhook.js";

declare global {
  // Optional hook installed by the Studio runtime when it wants core
  // notification failures mirrored into the in-app log buffer.
  var __inkosLogBuffer: ((level: "error", message: string, timestamp: string) => void) | undefined;
}

export interface NotifyMessage {
  readonly title: string;
  readonly body: string;
}

export async function dispatchNotification(
  channels: ReadonlyArray<NotifyChannel>,
  message: NotifyMessage,
): Promise<void> {
  const fullText = `**${message.title}**\n\n${message.body}`;

  const tasks = channels.map(async (channel) => {
    try {
      switch (channel.type) {
        case "telegram":
          {
            const { sendTelegram } = await import("./telegram.js");
            await sendTelegram(
              { botToken: channel.botToken, chatId: channel.chatId },
              fullText,
            );
          }
          break;
        case "feishu":
          {
            const { sendFeishu } = await import("./feishu.js");
            await sendFeishu(
              { webhookUrl: channel.webhookUrl },
              message.title,
              message.body,
            );
          }
          break;
        case "wechat-work":
          {
            const { sendWechatWork } = await import("./wechat-work.js");
            await sendWechatWork(
              { webhookUrl: channel.webhookUrl },
              fullText,
            );
          }
          break;
        case "webhook":
          // Webhook channels are handled by dispatchWebhookEvent for structured events.
          // For generic text notifications, send as a pipeline-complete event.
          {
            const { sendWebhook } = await import("./webhook.js");
            await sendWebhook(
              { url: channel.url, secret: channel.secret, events: channel.events },
              {
                event: "pipeline-complete",
                bookId: "",
                timestamp: new Date().toISOString(),
                data: { title: message.title, body: message.body },
              },
            );
          }
          break;
      }
    } catch (e) {
      // Log but don't throw — notification failure shouldn't block pipeline
      const msg = `[notify] ${channel.type} failed: ${e instanceof Error ? e.message : String(e)}`;
      process.stderr.write(msg + "\n");
      // Route to application log buffer if available
      if (typeof globalThis !== "undefined" && globalThis.__inkosLogBuffer) {
        try {
          globalThis.__inkosLogBuffer("error", msg, new Date().toISOString());
        } catch {
          // fallback to stderr
        }
      }
    }
  });

  await Promise.all(tasks);
}

/** Dispatch a structured webhook event to all webhook channels. */
export async function dispatchWebhookEvent(
  channels: ReadonlyArray<NotifyChannel>,
  payload: WebhookPayload,
): Promise<void> {
  const webhookChannels = channels.filter((ch) => ch.type === "webhook");
  if (webhookChannels.length === 0) return;

  const tasks = webhookChannels.map(async (channel) => {
    if (channel.type !== "webhook") return;
    try {
      const { sendWebhook } = await import("./webhook.js");
      await sendWebhook(
        { url: channel.url, secret: channel.secret, events: channel.events },
        payload,
      );
    } catch (e) {
      process.stderr.write(`[webhook] ${channel.url} failed: ${e}\n`);
    }
  });

  await Promise.all(tasks);
}
