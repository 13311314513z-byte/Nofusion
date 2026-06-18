import { streamSSE } from "hono/streaming";
import type { ServerContext, EventHandler } from "../server-context.js";

/**
 * SSE event stream route.
 * Clients connect here to receive real-time events (log, llm:progress, write:start, etc.).
 */
export function registerEventsRoutes(ctx: ServerContext): void {
  ctx.app.get("/api/v1/events", (c) => {
    return streamSSE(c, async (stream) => {
      const handler: EventHandler = (event, data) => {
        stream.writeSSE({ event, data: JSON.stringify(data) });
      };
      ctx.subscribers.add(handler);
      await stream.writeSSE({ event: "ping", data: "" });

      // Keep alive every 30 seconds
      const keepAlive = setInterval(() => {
        stream.writeSSE({ event: "ping", data: "" });
      }, 30000);

      stream.onAbort(() => {
        ctx.subscribers.delete(handler);
        clearInterval(keepAlive);
      });

      // Block until aborted
      await new Promise(() => {});
    });
  });
}
