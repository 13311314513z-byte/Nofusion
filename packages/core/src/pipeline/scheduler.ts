import { PipelineRunner } from "./runner.js";
import type { PipelineConfig } from "./runner.js";
import { StateManager } from "../state/manager.js";
import type { BookConfig } from "../models/book.js";
import type { QualityGates, DetectionConfig } from "../models/project.js";
import { dispatchWebhookEvent } from "../notify/dispatcher.js";
import { detectChapter, detectAndRewrite } from "./detection-runner.js";
import type { Logger } from "../utils/logger.js";

export interface SchedulerConfig extends PipelineConfig {
  readonly radarCron: string;
  readonly writeCron: string;
  readonly maxConcurrentBooks: number;
  readonly chaptersPerCycle: number;
  readonly retryDelayMs: number;
  readonly cooldownAfterChapterMs: number;
  readonly maxChaptersPerDay: number;
  readonly qualityGates?: QualityGates;
  readonly detection?: DetectionConfig;
  readonly onChapterComplete?: (bookId: string, chapter: number, status: string) => void;
  readonly onError?: (bookId: string, error: Error) => void;
  readonly onPause?: (bookId: string, reason: string) => void;
}

interface ScheduledTask {
  readonly name: string;
  readonly intervalMs: number;
  timer?: ReturnType<typeof setInterval>;
}

export class Scheduler {
  private readonly pipeline: PipelineRunner;
  private readonly state: StateManager;
  private readonly config: SchedulerConfig;
  private tasks: ScheduledTask[] = [];
  private running = false;
  private writeCycleInFlight: Promise<void> | null = null;
  private radarScanInFlight: Promise<void> | null = null;

  // Quality gate tracking (per book)
  private consecutiveFailures = new Map<string, number>();
  private pausedBooks = new Set<string>();
  // Failure clustering: bookId → (dimension → count)
  private failureDimensions = new Map<string, Map<string, number>>();
  // Daily chapter counter: "YYYY-MM-DD" → count
  private dailyChapterCount = new Map<string, number>();
  // Books currently being processed (prevent overlapping cycles for same book)
  private bookInFlight = new Set<string>();

  private readonly log?: Logger;

  constructor(config: SchedulerConfig) {
    this.config = config;
    this.pipeline = new PipelineRunner(config);
    this.state = new StateManager(config.projectRoot);
    this.log = config.logger?.child("scheduler");
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Run write cycle immediately on start, then schedule
    await this.triggerWriteCycle();

    // Schedule recurring write cycle
    const writeCycleMs = this.cronToMs(this.config.writeCron);
    const writeTask: ScheduledTask = {
      name: "write-cycle",
      intervalMs: writeCycleMs,
    };
    writeTask.timer = setInterval(() => {
      this.triggerWriteCycle().catch((e) => {
        this.config.onError?.("scheduler", e as Error);
      });
    }, writeCycleMs);
    this.tasks.push(writeTask);

    // Schedule radar scan
    const radarMs = this.cronToMs(this.config.radarCron);
    const radarTask: ScheduledTask = {
      name: "radar-scan",
      intervalMs: radarMs,
    };
    radarTask.timer = setInterval(() => {
      this.triggerRadarScan().catch((e) => {
        this.config.onError?.("radar", e as Error);
      });
    }, radarMs);
    this.tasks.push(radarTask);
  }

  stop(): void {
    this.running = false;
    for (const task of this.tasks) {
      if (task.timer) clearInterval(task.timer);
    }
    this.tasks = [];
    // Clean up in-memory tracking to prevent unbounded growth across restarts
    this.pausedBooks.clear();
    this.consecutiveFailures.clear();
    this.failureDimensions.clear();
    this.dailyChapterCount.clear();
    this.bookInFlight.clear();
    // Dispose cached LLM clients to prevent memory leaks
    this.pipeline.dispose();
  }

  get isRunning(): boolean {
    return this.running;
  }

  private async triggerWriteCycle(): Promise<void> {
    if (this.writeCycleInFlight) {
      this.log?.warn("Write cycle still running, skipping overlapping tick");
      return;
    }

    const cycle = this.runWriteCycle().finally(() => {
      if (this.writeCycleInFlight === cycle) {
        this.writeCycleInFlight = null;
      }
    });
    this.writeCycleInFlight = cycle;
    await cycle;
  }

  private async triggerRadarScan(): Promise<void> {
    if (this.radarScanInFlight) {
      this.log?.warn("Radar scan still running, skipping overlapping tick");
      return;
    }

    const scan = this.runRadarScan().finally(() => {
      if (this.radarScanInFlight === scan) {
        this.radarScanInFlight = null;
      }
    });
    this.radarScanInFlight = scan;
    await scan;
  }

  /** Resume a paused book. */
  resumeBook(bookId: string): void {
    this.pausedBooks.delete(bookId);
    this.consecutiveFailures.delete(bookId);
    this.failureDimensions.delete(bookId);
  }

  /** Check if a book is paused. */
  isBookPaused(bookId: string): boolean {
    return this.pausedBooks.has(bookId);
  }

  private get gates(): Required<QualityGates> {
    return {
      maxAuditRetries: 2,
      pauseAfterConsecutiveFailures: 3,
      retryTemperatureStep: 0.1,
      ...this.config.qualityGates,
    };
  }

  /**
   * Clean up stale pausedBooks entries: remove books that no longer exist.
   * Called at the start of each write cycle to prevent unbounded growth.
   */
  private async cleanupStalePausedBooks(): Promise<void> {
    const existingIds = new Set(await this.state.listBooks());
    for (const id of this.pausedBooks) {
      if (!existingIds.has(id)) {
        this.pausedBooks.delete(id);
        this.consecutiveFailures.delete(id);
        this.failureDimensions.delete(id);
      }
    }
  }

  /** Check if daily cap is reached across all books. */
  private isDailyCapReached(): boolean {
    const today = new Date().toISOString().slice(0, 10);
    const count = this.dailyChapterCount.get(today) ?? 0;
    return count >= this.config.maxChaptersPerDay;
  }

  /** Increment daily chapter counter. */
  private recordChapterWritten(): void {
    const today = new Date().toISOString().slice(0, 10);
    const count = this.dailyChapterCount.get(today) ?? 0;
    this.dailyChapterCount.set(today, count + 1);

    // Clean up old dates (keep only today)
    for (const key of this.dailyChapterCount.keys()) {
      if (key !== today) this.dailyChapterCount.delete(key);
    }
  }

  private async runWriteCycle(): Promise<void> {
    if (this.isDailyCapReached()) {
      this.log?.info(`Daily cap reached (${this.config.maxChaptersPerDay}), skipping cycle`);
      return;
    }

    // Clean up stale pausedBooks entries before selecting books
    await this.cleanupStalePausedBooks();

    const bookIds = await this.state.listBooks();

    const activeBooks: Array<{ readonly id: string; readonly config: BookConfig }> = [];
    for (const id of bookIds) {
      if (this.pausedBooks.has(id)) continue;
      const config = await this.state.loadBookConfig(id);
      if (config.status === "active" || config.status === "outlining") {
        activeBooks.push({ id, config });
      }
    }

    const booksToWrite = activeBooks.slice(0, this.config.maxConcurrentBooks);

    // Parallel book processing — each book gets its own lock, but
    // processBook also tracks in-flight state to avoid overlapping cycles.
    await Promise.all(
      booksToWrite.map((book) => this.processBook(book.id, book.config)),
    );
  }

  /** Process a single book: write chaptersPerCycle chapters with retry + cooldown. */
  private async processBook(bookId: string, bookConfig: BookConfig): Promise<void> {
    if (this.bookInFlight.has(bookId)) {
      this.log?.warn(`${bookId} already in flight, skipping overlapping cycle`);
      return;
    }
    this.bookInFlight.add(bookId);
    try {
      for (let i = 0; i < this.config.chaptersPerCycle; i++) {
      if (!this.running) return;
      if (this.isDailyCapReached()) return;
      if (this.pausedBooks.has(bookId)) return;

      // Cooldown between chapters (skip for the first one)
      if (i > 0 && this.config.cooldownAfterChapterMs > 0) {
        await this.sleep(this.config.cooldownAfterChapterMs);
      }

      const success = await this.writeOneChapter(bookId, bookConfig);
      if (!success) {
        // Immediate retry with delay (if within retry limit)
        const failures = this.consecutiveFailures.get(bookId) ?? 0;
        if (failures <= this.gates.maxAuditRetries && this.config.retryDelayMs > 0) {
          this.log?.warn(`${bookId} retrying in ${this.config.retryDelayMs}ms`);
          await this.sleep(this.config.retryDelayMs);
          const retrySuccess = await this.writeOneChapter(bookId, bookConfig);
          if (!retrySuccess) break; // Stop this book's cycle on second failure
        } else {
          break; // Stop this book's cycle
        }
      }
    }
    } finally {
      this.bookInFlight.delete(bookId);
    }
  }

  /** Write one chapter for a book. Returns true if approved. */
  private async writeOneChapter(bookId: string, bookConfig: BookConfig): Promise<boolean> {
    try {
      // Compute temperature override: base 0.7 + failures * step
      const failures = this.consecutiveFailures.get(bookId) ?? 0;
      const tempOverride = failures > 0
        ? Math.min(1.2, 0.7 + failures * this.gates.retryTemperatureStep)
        : undefined;

      // If temperature has reached its cap and we're still failing, pause
      // to prevent wasting resources on degenerate LLM output.
      if (failures > 0 && tempOverride !== undefined && tempOverride >= 1.2) {
        this.pausedBooks.add(bookId);
        const reason = `Temperature reached cap (1.2) after ${failures} consecutive failures`;
        this.log?.error(`${bookId} PAUSED: ${reason}`);
        this.config.onPause?.(bookId, reason);
        return false;
      }

      const result = await this.pipeline.writeNextChapter(bookId, undefined, tempOverride);

      if (result.status === "ready-for-review") {
        this.consecutiveFailures.delete(bookId);
        this.recordChapterWritten();

        // Auto-detection loop after successful audit
        if (this.config.detection?.enabled) {
          await this.runDetection(bookId, bookConfig, result.chapterNumber);
        }

        this.config.onChapterComplete?.(bookId, result.chapterNumber, result.status);
        return true;
      }

      // Audit failed — apply quality gates
      const issueCategories = result.auditResult.issues.map((i) => i.category);
      await this.handleAuditFailure(bookId, result.chapterNumber, issueCategories);
      this.config.onChapterComplete?.(bookId, result.chapterNumber, result.status);
      return false;
    } catch (e) {
      this.config.onError?.(bookId, e as Error);
      await this.handleAuditFailure(bookId, 0);
      return false;
    }
  }

  private async runDetection(
    bookId: string,
    bookConfig: BookConfig,
    chapterNumber: number,
  ): Promise<void> {
    if (!this.config.detection) return;
    try {
      const bookDir = this.state.bookDir(bookId);
      const chapterContent = await this.readChapterContent(bookDir, chapterNumber);
      const detResult = await detectChapter(
        this.config.detection,
        chapterContent,
        chapterNumber,
      );
      if (!detResult.passed && this.config.detection.autoRewrite) {
        await detectAndRewrite(
          this.config.detection,
          { client: this.config.client, model: this.config.model, projectRoot: this.config.projectRoot },
          bookDir,
          chapterContent,
          chapterNumber,
          bookConfig.genre,
        );
      }
    } catch (e) {
      this.config.onError?.(bookId, e as Error);
    }
  }

  private async handleAuditFailure(
    bookId: string,
    chapterNumber: number,
    issueCategories: ReadonlyArray<string> = [],
  ): Promise<void> {
    const failures = (this.consecutiveFailures.get(bookId) ?? 0) + 1;
    this.consecutiveFailures.set(bookId, failures);

    // Track failure dimensions for clustering
    if (issueCategories.length > 0) {
      const existing = this.failureDimensions.get(bookId);
      const dimMap = existing ? new Map(existing) : new Map<string, number>();
      for (const cat of issueCategories) {
        dimMap.set(cat, (dimMap.get(cat) ?? 0) + 1);
      }
      this.failureDimensions.set(bookId, dimMap);

      // Check for dimension clustering (any dimension with >=3 failures)
      for (const [dimension, count] of dimMap) {
        if (count >= 3) {
          await this.emitDiagnosticAlert(bookId, chapterNumber, dimension, count);
        }
      }
    }

    const gates = this.gates;

    if (failures <= gates.maxAuditRetries) {
      this.log?.warn(`${bookId} audit failed (${failures}/${gates.maxAuditRetries}), will retry`);
      return;
    }

    // Check if we should pause
    if (failures >= gates.pauseAfterConsecutiveFailures) {
      this.pausedBooks.add(bookId);
      const reason = `${failures} consecutive audit failures (threshold: ${gates.pauseAfterConsecutiveFailures})`;
      this.log?.error(`${bookId} PAUSED: ${reason}`);
      this.config.onPause?.(bookId, reason);

      if (this.config.notifyChannels && this.config.notifyChannels.length > 0) {
        await dispatchWebhookEvent(this.config.notifyChannels, {
          event: "pipeline-error",
          bookId,
          chapterNumber: chapterNumber > 0 ? chapterNumber : undefined,
          timestamp: new Date().toISOString(),
          data: { reason, consecutiveFailures: failures },
        });
      }
    }
  }

  private async runRadarScan(): Promise<void> {
    try {
      await this.pipeline.runRadar();
    } catch (e) {
      this.config.onError?.("radar", e as Error);
    }
  }

  private async emitDiagnosticAlert(
    bookId: string,
    chapterNumber: number,
    dimension: string,
    count: number,
  ): Promise<void> {
    this.log?.warn(`DIAGNOSTIC: ${bookId} has ${count} failures in dimension "${dimension}"`);

    if (this.config.notifyChannels && this.config.notifyChannels.length > 0) {
      await dispatchWebhookEvent(this.config.notifyChannels, {
        event: "diagnostic-alert",
        bookId,
        chapterNumber: chapterNumber > 0 ? chapterNumber : undefined,
        timestamp: new Date().toISOString(),
        data: { dimension, failureCount: count },
      });
    }
  }

  private async readChapterContent(bookDir: string, chapterNumber: number): Promise<string> {
    const { readFile, readdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const chaptersDir = join(bookDir, "chapters");
    const files = await readdir(chaptersDir);
    const paddedNum = String(chapterNumber).padStart(4, "0");
    const chapterFile = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
    if (!chapterFile) {
      throw new Error(`Chapter ${chapterNumber} file not found in ${chaptersDir}`);
    }
    const raw = await readFile(join(chaptersDir, chapterFile), "utf-8");
    const lines = raw.split("\n");
    const contentStart = lines.findIndex((l, i) => i > 0 && l.trim().length > 0);
    return contentStart >= 0 ? lines.slice(contentStart).join("\n") : raw;
  }

  /**
   * Convert a cron expression to a millisecond interval.
   *
   * Supports:
   *   - "`*`/N * * * *"       → every N minutes
   *   - "0 `*`/N * * *"       → every N hours
   *   - "M * * * *"           → every hour at minute M (≈ 1h)
   *   - "M H * * *"           → daily at H:M (≈ 24h)
   *   - "`*`/M `*`/H * * *"   → every H hours and M minutes (≈ min resolution)
   *   - All other patterns    → fallback 24h with warning
   *
   * For precise scheduling (e.g. weekdays only), callers should use a proper
   * cron scheduler. This simplified converter is intended for setInterval
   * approximations only.
   */
  private cronToMs(cron: string): number {
    const parts = cron.trim().split(/\s+/);
    if (parts.length < 5) {
      this.log?.warn(`Invalid cron format "${cron}" (expected 5 fields), falling back to 24h`);
      return 24 * 60 * 60 * 1000;
    }

    const minute = parts[0]!;
    const hour = parts[1]!;

    // "*/N * * * *" → every N minutes
    if (minute.startsWith("*/")) {
      const interval = parseInt(minute.slice(2), 10);
      if (!Number.isFinite(interval) || interval <= 0) {
        this.log?.warn(`Invalid cron minute interval "${minute}", falling back to 60min`);
        return 60 * 60 * 1000;
      }
      const ms = interval * 60 * 1000;
      return Math.max(60_000, ms);
    }

    // "*/M */H * * *" → both minute and hour use step notation
    if (hour.startsWith("*/")) {
      const hourInterval = parseInt(hour.slice(2), 10);
      if (!Number.isFinite(hourInterval) || hourInterval <= 0) {
        this.log?.warn(`Invalid cron hour interval "${hour}", falling back to 1h`);
        return 60 * 60 * 1000;
      }
      // Check for minute step within the hour step
      if (minute.startsWith("*/")) {
        const minInterval = parseInt(minute.slice(2), 10);
        if (Number.isFinite(minInterval) && minInterval > 0) {
          // Use the finer granularity (minutes) as the interval
          const ms = minInterval * 60 * 1000;
          return Math.max(60_000, ms);
        }
      }
      const ms = hourInterval * 60 * 60 * 1000;
      return Math.max(60_000, ms);
    }

    // "M * * * *" — fixed minute every hour → treat as 1h interval
    if (hour === "*" && minute !== "*" && !minute.startsWith("*/") && !minute.includes(",")) {
      return 60 * 60 * 1000;
    }

    // "M H * * *" — fixed daily time → treat as 24h
    if (hour !== "*" && minute !== "*" && !hour.startsWith("*/") && !minute.startsWith("*/")) {
      return 24 * 60 * 60 * 1000;
    }

    // Fallback for other patterns (e.g. * * * * *, day-of-week constraints)
    this.log?.warn(`Unsupported cron format "${cron}", falling back to 24h. ` +
      `For precise scheduling use a dedicated cron daemon.`);
    return 24 * 60 * 60 * 1000;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
