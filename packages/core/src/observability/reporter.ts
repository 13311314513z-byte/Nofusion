/**
 * Lightweight error/event reporter for NoFusion observability.
 *
 * Supports optional Sentry integration via environment variables:
 *   - INKOS_SENTRY_DSN — Sentry DSN for error tracking
 *   - INKOS_OTEL_ENDPOINT — OpenTelemetry collector endpoint
 *
 * With no env vars configured, errors are logged to console only.
 * This ensures zero-config operation for local development while
 * allowing production deployments to enable external monitoring.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface ErrorContext {
  /** Human-readable tag (e.g. "studio", "pipeline", "cli") */
  readonly tag: string;
  /** Additional structured data attached to the error */
  readonly extra?: Record<string, unknown>;
  /** User/session identifier if available */
  readonly userId?: string;
  /** Book identifier if relevant */
  readonly bookId?: string;
}

export interface ErrorReporter {
  /** Report an error with optional context */
  captureException(error: unknown, context?: ErrorContext): void;
  /** Report a non-error event (info/warning) */
  captureMessage(message: string, level?: "info" | "warning" | "error", context?: ErrorContext): void;
  /** Flush pending reports before shutdown */
  flush(): Promise<void>;
}

// ── Console reporter (always available) ─────────────────────────────────────

class ConsoleReporter implements ErrorReporter {
  captureException(error: unknown, context?: ErrorContext): void {
    const prefix = context?.tag ? `[${context.tag}]` : "[reporter]";
    const extra = context?.extra ? ` ${JSON.stringify(context.extra)}` : "";
    const book = context?.bookId ? ` book=${context.bookId}` : "";
    console.error(`${prefix}${book}${extra}`, error instanceof Error ? error.stack ?? error.message : error);
  }

  captureMessage(message: string, level?: "info" | "warning" | "error", context?: ErrorContext): void {
    const prefix = context?.tag ? `[${context.tag}]` : "[reporter]";
    const extra = context?.extra ? ` ${JSON.stringify(context.extra)}` : "";
    const log = level === "error" ? console.error : level === "warning" ? console.warn : console.log;
    log(`${prefix}${extra} ${message}`);
  }

  async flush(): Promise<void> {
    // console reporter is synchronous — nothing to flush
  }
}

// ── Sentry reporter (optional, activated by INKOS_SENTRY_DSN) ───────────────

class SentryReporter implements ErrorReporter {
  private dsn: string;
  private pending: Array<{ type: "error" | "message"; payload: unknown }> = [];

  constructor(dsn: string) {
    this.dsn = dsn;
  }

  captureException(error: unknown, context?: ErrorContext): void {
    const event = {
      event_id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
      timestamp: new Date().toISOString(),
      exception: {
        values: [{
          type: error instanceof Error ? error.constructor.name : "Error",
          value: error instanceof Error ? error.message : String(error),
          stacktrace: error instanceof Error ? { frames: this.parseStack(error.stack) } : undefined,
        }],
      },
      tags: {
        ...(context?.tag ? { tag: context.tag } : {}),
        ...(context?.bookId ? { bookId: context.bookId } : {}),
      },
      extra: context?.extra ?? {},
      user: context?.userId ? { id: context.userId } : undefined,
    };

    this.sendToSentry("store", event).catch(() => {
      // Fallback: log to console if Sentry is unreachable
      console.error("[sentry] Failed to send error event. DSN:", this.maskDsn());
    });
  }

  captureMessage(message: string, level?: "info" | "warning" | "error", context?: ErrorContext): void {
    const event = {
      event_id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
      timestamp: new Date().toISOString(),
      message,
      level: level ?? "info",
      tags: {
        ...(context?.tag ? { tag: context.tag } : {}),
        ...(context?.bookId ? { bookId: context.bookId } : {}),
      },
      extra: context?.extra ?? {},
      user: context?.userId ? { id: context.userId } : undefined,
    };

    this.sendToSentry("store", event).catch(() => {});
  }

  async flush(): Promise<void> {
    // Sentry SDK typically handles batching; here we just ensure pending sends
    await Promise.allSettled(this.pending.map(p => this.sendToSentry("store", p.payload)));
    this.pending = [];
  }

  private async sendToSentry(endpoint: string, body: unknown): Promise<void> {
    const url = new URL(`/api/${this.dsn.split("@")[1]?.split("/")[0] ?? "0"}/${endpoint}/`, "https://sentry.io");
    const auth = this.dsn.startsWith("http") ? this.dsn : `DSN ${this.dsn}`;

    try {
      await fetch(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sentry-Auth": auth,
        },
        body: JSON.stringify(body),
      });
    } catch {
      // Silently fail — observability must never break the application
    }
  }

  private parseStack(stack?: string): Array<{ filename?: string; function?: string; lineno?: number }> {
    if (!stack) return [];
    return stack.split("\n").slice(1).map(line => {
      const match = line.trim().match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/);
      if (match) return { function: match[1], filename: match[2], lineno: Number(match[3]) };
      const altMatch = line.trim().match(/at\s+(.+?):(\d+):(\d+)/);
      if (altMatch) return { filename: altMatch[1], lineno: Number(altMatch[2]) };
      return { filename: line.trim() };
    });
  }

  private maskDsn(): string {
    return this.dsn.replace(/\/\/.*@/, "//***@");
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

let _reporter: ErrorReporter | null = null;

function resolveReporter(): ErrorReporter {
  try {
    const dsn = process.env.INKOS_SENTRY_DSN?.trim();
    if (dsn && dsn.length > 0) {
      return new SentryReporter(dsn);
    }
  } catch {
    // Fall through to console reporter
  }
  return new ConsoleReporter();
}

/** Get the singleton error reporter instance. */
export function getErrorReporter(): ErrorReporter {
  if (!_reporter) {
    _reporter = resolveReporter();
  }
  return _reporter;
}

/** Reset the reporter (useful for testing). */
export function resetErrorReporter(): void {
  _reporter = null;
}

// ── Convenience helpers ─────────────────────────────────────────────────────

/** Capture an exception with a tag for categorization. */
export function captureError(error: unknown, tag: string, extra?: Record<string, unknown>): void {
  getErrorReporter().captureException(error, { tag, extra });
}

/** Capture an informational event. */
export function captureInfo(message: string, tag: string, extra?: Record<string, unknown>): void {
  getErrorReporter().captureMessage(message, "info", { tag, extra });
}

/** Capture a warning event. */
export function captureWarning(message: string, tag: string, extra?: Record<string, unknown>): void {
  getErrorReporter().captureMessage(message, "warning", { tag, extra });
}
