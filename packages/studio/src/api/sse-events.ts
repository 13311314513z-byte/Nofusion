/**
 * SSE Event Definitions — canonical list of Server-Sent Events emitted by the
 * InkOS pipeline. This module defines the event type union and a type-safe
 * emitter that wraps Hono's stream API.
 *
 * @module
 */

// ─── Event type definitions ───────────────────────────────────────

/** All SSE event types dispatched by the pipeline. */
export type SSEEventType =
  // Pipeline lifecycle
  | "pipeline:started"
  | "pipeline:completed"
  | "pipeline:failed"
  // Agent stage transitions
  | "agent:planner:started"
  | "agent:planner:completed"
  | "agent:composer:started"
  | "agent:composer:completed"
  | "agent:writer:started"
  | "agent:writer:completed"
  | "agent:observer:started"
  | "agent:observer:completed"
  | "agent:settler:started"
  | "agent:settler:completed"
  | "agent:auditor:started"
  | "agent:auditor:completed"
  | "agent:reviser:started"
  | "agent:reviser:completed"
  // Resource mutations
  | "chapter:saved"
  | "chapter:approved"
  | "chapter:rejected"
  | "book:created"
  | "book:deleted"
  | "book:config:updated"
  | "truth:updated"
  | "hook:updated"
  | "role:updated"
  | "source:added"
  | "source:deleted"
  // Artifact events
  | "artifact:event-chain:updated"
  | "artifact:scene-template:updated"
  | "artifact:voice-profile:updated"
  | "artifact:plan:generated"
  | "artifact:context:generated"
  | "artifact:trace:generated"
  | "artifact:rule-stack:generated"
  // System
  | "daemon:started"
  | "daemon:stopped"
  | "daemon:heartbeat";

/** Payload for each SSE event type. */
export interface SSEEventPayloadMap {
  "pipeline:started": { bookId: string; chapterNumber: number };
  "pipeline:completed": { bookId: string; chapterNumber: number; durationMs: number };
  "pipeline:failed": { bookId: string; chapterNumber: number; error: string };
  "agent:planner:started": { bookId: string; chapterNumber: number };
  "agent:planner:completed": { bookId: string; chapterNumber: number; memoCount: number };
  "agent:composer:started": { bookId: string; chapterNumber: number };
  "agent:composer:completed": { bookId: string; chapterNumber: number; contextCount: number };
  "agent:writer:started": { bookId: string; chapterNumber: number };
  "agent:writer:completed": { bookId: string; chapterNumber: number; wordCount: number };
  "agent:observer:started": { bookId: string; chapterNumber: number };
  "agent:observer:completed": { bookId: string; chapterNumber: number };
  "agent:settler:started": { bookId: string; chapterNumber: number };
  "agent:settler:completed": { bookId: string; chapterNumber: number };
  "agent:auditor:started": { bookId: string; chapterNumber: number };
  "agent:auditor:completed": { bookId: string; chapterNumber: number; issuesCount: number };
  "agent:reviser:started": { bookId: string; chapterNumber: number };
  "agent:reviser:completed": { bookId: string; chapterNumber: number };
  "chapter:saved": { bookId: string; chapterNumber: number };
  "chapter:approved": { bookId: string; chapterNumber: number };
  "chapter:rejected": { bookId: string; chapterNumber: number; reason?: string };
  "book:created": { bookId: string };
  "book:deleted": { bookId: string };
  "book:config:updated": { bookId: string };
  "truth:updated": { bookId: string; file: string };
  "hook:updated": { bookId: string; hookId: string };
  "role:updated": { bookId: string; roleId: string };
  "source:added": { bookId: string; sourceId: string };
  "source:deleted": { bookId: string; sourceId: string };
  "artifact:event-chain:updated": { bookId: string; chapterNumber: number };
  "artifact:scene-template:updated": { bookId: string };
  "artifact:voice-profile:updated": { bookId: string; characterId: string };
  "artifact:plan:generated": { bookId: string; chapterNumber: number };
  "artifact:context:generated": { bookId: string; chapterNumber: number };
  "artifact:trace:generated": { bookId: string; chapterNumber: number };
  "artifact:rule-stack:generated": { bookId: string; chapterNumber: number };
  "daemon:started": Record<string, never>;
  "daemon:stopped": Record<string, never>;
  "daemon:heartbeat": { uptimeMs: number };
}

// ─── Event emitter ─────────────────────────────────────────────────

/** Type-safe SSE event emitter bound to a Hono stream. */
export interface TypedSSEEmitter {
  emit<T extends SSEEventType>(type: T, payload: SSEEventPayloadMap[T]): void;
  close(): void;
}

/**
 * Create a typed SSE emitter from a Hono SSE stream.
 *
 * @example
 * app.get("/api/v1/events", (c) => {
 *   return streamSSE(c, (stream) => {
 *     const emitter = createSSEEmitter(stream);
 *     emitter.emit("chapter:saved", { bookId: "demo", chapterNumber: 3 });
 *   });
 * });
 */
export function createSSEEmitter(write: (data: string) => void): TypedSSEEmitter {
  return {
    emit(type, payload) {
      write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
    },
    close() {
      write("event: close\ndata: {}\n\n");
    },
  };
}

/** All SSE event types as a readonly array for subscription filtering. */
export const SSE_EVENT_TYPES: ReadonlyArray<SSEEventType> = [
  "pipeline:started", "pipeline:completed", "pipeline:failed",
  "agent:planner:started", "agent:planner:completed",
  "agent:composer:started", "agent:composer:completed",
  "agent:writer:started", "agent:writer:completed",
  "agent:observer:started", "agent:observer:completed",
  "agent:settler:started", "agent:settler:completed",
  "agent:auditor:started", "agent:auditor:completed",
  "agent:reviser:started", "agent:reviser:completed",
  "chapter:saved", "chapter:approved", "chapter:rejected",
  "book:created", "book:deleted", "book:config:updated",
  "truth:updated", "hook:updated", "role:updated",
  "source:added", "source:deleted",
  "artifact:event-chain:updated", "artifact:scene-template:updated",
  "artifact:voice-profile:updated",
  "artifact:plan:generated", "artifact:context:generated",
  "artifact:trace:generated", "artifact:rule-stack:generated",
  "daemon:started", "daemon:stopped", "daemon:heartbeat",
];
