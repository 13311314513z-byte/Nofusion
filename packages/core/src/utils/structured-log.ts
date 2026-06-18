/**
 * P2-9: Structured JSON logger for production use.
 *
 * Wraps console methods to emit newline-delimited JSON (NDJSON) logs.
 * In development, falls back to human-readable console output.
 * Set INKOS_STRUCTURED_LOGS=1 to enable JSON mode.
 *
 * Usage:
 *   import { structuredLog } from "./structured-log.js";
 *   structuredLog.info("book.created", { bookId: "demo", chapterCount: 5 });
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface StructuredLogEntry {
  readonly ts: string;
  readonly level: LogLevel;
  readonly event: string;
  readonly [key: string]: unknown;
}

const isStructured = process.env.INKOS_STRUCTURED_LOGS === "1";

function emit(level: LogLevel, event: string, data?: Record<string, unknown>): void {
  if (isStructured) {
    const entry: StructuredLogEntry = {
      ts: new Date().toISOString(),
      level,
      event,
      ...data,
    };
    const line = JSON.stringify(entry);
    if (level === "error") {
      process.stderr.write(line + "\n");
    } else {
      process.stdout.write(line + "\n");
    }
  } else {
    const extra = data ? " " + JSON.stringify(data) : "";
    const msg = `[${level}] ${event}${extra}`;
    switch (level) {
      case "debug": console.debug(msg); break;
      case "info": console.log(msg); break;
      case "warn": console.warn(msg); break;
      case "error": console.error(msg); break;
    }
  }
}

export const structuredLog = {
  debug(event: string, data?: Record<string, unknown>): void {
    emit("debug", event, data);
  },
  info(event: string, data?: Record<string, unknown>): void {
    emit("info", event, data);
  },
  warn(event: string, data?: Record<string, unknown>): void {
    emit("warn", event, data);
  },
  error(event: string, data?: Record<string, unknown>): void {
    emit("error", event, data);
  },
};
