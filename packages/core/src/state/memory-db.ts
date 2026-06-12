/**
 * Temporal memory database for InkOS truth files.
 *
 * Uses Node.js built-in SQLite (node:sqlite, Node 22+).
 * Stores facts with temporal validity (valid_from/valid_until chapter numbers),
 * enabling precise queries like "what did character X know in chapter 5?"
 *
 * Backward compatible: existing markdown truth files are still the primary
 * persistence layer. MemoryDB is an acceleration index built alongside them.
 */

import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);

const FACT_SELECT_COLUMNS = `
  id,
  subject,
  predicate,
  object,
  valid_from_chapter AS validFromChapter,
  valid_until_chapter AS validUntilChapter,
  source_chapter AS sourceChapter
`;

export interface Fact {
  readonly id?: number;
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
  readonly validFromChapter: number;
  readonly validUntilChapter: number | null;
  readonly sourceChapter: number;
}

export interface StoredSummary {
  readonly chapter: number;
  readonly title: string;
  readonly characters: string;
  readonly events: string;
  readonly stateChanges: string;
  readonly hookActivity: string;
  readonly mood: string;
  readonly chapterType: string;
}

export interface StoredHook {
  readonly hookId: string;
  readonly startChapter: number;
  readonly type: string;
  readonly status: string;
  readonly lastAdvancedChapter: number;
  readonly expectedPayoff: string;
  readonly payoffTiming?: string;
  readonly notes: string;
  // Phase 7 — hook causality / promotion metadata.
  readonly dependsOn?: ReadonlyArray<string>;
  readonly paysOffInArc?: string;
  readonly coreHook?: boolean;
  readonly halfLifeChapters?: number;
  readonly advancedCount?: number;
  // Phase 7 hotfix 2 — whether the seed has been promoted into the live ledger
  // (architect-time structural rules + consolidator-time advanced_count rule).
  // Reviewer uses this to gate critical-severity escalation.
  readonly promoted?: boolean;
}

/**
 * An intent commitment records the author's answer to a pre-writing question.
 * At audit time the system checks whether the written chapter fulfills it.
 */
export interface IntentCommitment {
  readonly id?: number;
  readonly chapterNumber: number;
  readonly question: string;
  readonly answer: string;
  readonly category: "core" | "scene" | "character" | "constraint";
  readonly verified: boolean;
  readonly verificationResult?: string;
  readonly createdAt?: string;
}

export class MemoryDB {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any;
  private available = false;

  constructor(bookDir: string) {
    // node:sqlite requires Node 22+; require() via createRequire for ESM compat
    try {
      const { DatabaseSync } = require("node:sqlite");
      const dbPath = join(bookDir, "story", "memory.db");
      this.db = new DatabaseSync(dbPath);
      this.db.exec("PRAGMA journal_mode = WAL");
      this.migrate();
      this.available = true;
    } catch {
      // Graceful degradation: node:sqlite unavailable (Node < 22 or missing build).
      // All operations become no-ops so callers don't need to handle this.
      this.available = false;
    }
  }

  get isAvailable(): boolean {
    return this.available;
  }

  private ensureDb(): void {
    if (!this.available) {
      throw new Error(
        "MemoryDB is unavailable because node:sqlite could not be opened (requires Node 22+). " +
          "Core functionality works without it, but some acceleration features are disabled.",
      );
    }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        valid_from_chapter INTEGER NOT NULL,
        valid_until_chapter INTEGER,
        source_chapter INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS chapter_summaries (
        chapter INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        characters TEXT NOT NULL DEFAULT '',
        events TEXT NOT NULL DEFAULT '',
        state_changes TEXT NOT NULL DEFAULT '',
        hook_activity TEXT NOT NULL DEFAULT '',
        mood TEXT NOT NULL DEFAULT '',
        chapter_type TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS hooks (
        hook_id TEXT PRIMARY KEY,
        start_chapter INTEGER NOT NULL DEFAULT 0,
        type TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        last_advanced_chapter INTEGER NOT NULL DEFAULT 0,
        expected_payoff TEXT NOT NULL DEFAULT '',
        payoff_timing TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject);
      CREATE INDEX IF NOT EXISTS idx_facts_valid ON facts(valid_from_chapter, valid_until_chapter);
      CREATE INDEX IF NOT EXISTS idx_facts_source ON facts(source_chapter);
      CREATE INDEX IF NOT EXISTS idx_hooks_status ON hooks(status);
      CREATE INDEX IF NOT EXISTS idx_hooks_last_advanced ON hooks(last_advanced_chapter);

      CREATE TABLE IF NOT EXISTS intent_commitments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chapter_number INTEGER NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'core',
        verified INTEGER NOT NULL DEFAULT 0,
        verification_result TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_intent_commitments_chapter ON intent_commitments(chapter_number);
    `);

    this.ensureColumn("hooks", "payoff_timing", "TEXT NOT NULL DEFAULT ''");
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    try {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch {
      // Column already exists on existing databases.
    }
  }

  // ---------------------------------------------------------------------------
  // Facts (temporal)
  // ---------------------------------------------------------------------------

  /** Add a new fact. */
  addFact(fact: Omit<Fact, "id">): number {
    if (!this.available) return 0;
    this.ensureDb();
    const stmt = this.db.prepare(
      `INSERT INTO facts (subject, predicate, object, valid_from_chapter, valid_until_chapter, source_chapter)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const result = stmt.run(
      fact.subject, fact.predicate, fact.object,
      fact.validFromChapter, fact.validUntilChapter ?? null, fact.sourceChapter,
    );
    return Number(result.lastInsertRowid);
  }

  /** Invalidate a fact (set valid_until). */
  invalidateFact(id: number, untilChapter: number): void {
    if (!this.available) return;
    this.ensureDb();
    this.db.prepare(
      "UPDATE facts SET valid_until_chapter = ? WHERE id = ?",
    ).run(untilChapter, id);
  }

  /** Get all currently valid facts (valid_until is null). */
  getCurrentFacts(): ReadonlyArray<Fact> {
    if (!this.available) return [];
    this.ensureDb();
    return this.db.prepare(
      `SELECT ${FACT_SELECT_COLUMNS}
       FROM facts
       WHERE valid_until_chapter IS NULL
       ORDER BY subject, predicate`,
    ).all() as unknown as Fact[];
  }

  /** Get facts about a specific subject that are valid at a given chapter. */
  getFactsAt(subject: string, chapter: number): ReadonlyArray<Fact> {
    if (!this.available) return [];
    this.ensureDb();
    return this.db.prepare(
      `SELECT ${FACT_SELECT_COLUMNS}
       FROM facts
       WHERE subject = ? AND valid_from_chapter <= ?
       AND (valid_until_chapter IS NULL OR valid_until_chapter > ?)
       ORDER BY predicate`,
    ).all(subject, chapter, chapter) as unknown as Fact[];
  }

  /** Get all facts about a subject (including historical). */
  getFactHistory(subject: string): ReadonlyArray<Fact> {
    if (!this.available) return [];
    this.ensureDb();
    return this.db.prepare(
      `SELECT ${FACT_SELECT_COLUMNS}
       FROM facts
       WHERE subject = ?
       ORDER BY valid_from_chapter`,
    ).all(subject) as unknown as Fact[];
  }

  /** Search facts by predicate (e.g., all "location" facts). */
  getFactsByPredicate(predicate: string): ReadonlyArray<Fact> {
    if (!this.available) return [];
    this.ensureDb();
    return this.db.prepare(
      `SELECT ${FACT_SELECT_COLUMNS}
       FROM facts
       WHERE predicate = ? AND valid_until_chapter IS NULL
       ORDER BY subject`,
    ).all(predicate) as unknown as Fact[];
  }

  /** Get facts relevant to a set of character names. */
  getFactsForCharacters(names: ReadonlyArray<string>): ReadonlyArray<Fact> {
    if (names.length === 0) return [];
    if (!this.available) return [];
    this.ensureDb();
    const placeholders = names.map(() => "?").join(",");
    return this.db.prepare(
      `SELECT ${FACT_SELECT_COLUMNS}
       FROM facts
       WHERE subject IN (${placeholders}) AND valid_until_chapter IS NULL
       ORDER BY subject, predicate`,
    ).all(...names) as unknown as Fact[];
  }

  replaceCurrentFacts(facts: ReadonlyArray<Omit<Fact, "id">>): void {
    if (!this.available) return;
    this.ensureDb();
    // Transaction: atomic replace so partial failure doesn't lose data
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec("DELETE FROM facts WHERE valid_until_chapter IS NULL");
      for (const fact of facts) {
        this.addFact(fact);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  resetFacts(): void {
    if (!this.available) return;
    this.ensureDb();
    this.db.exec("DELETE FROM facts");
  }

  // ---------------------------------------------------------------------------
  // Chapter summaries
  // ---------------------------------------------------------------------------

  /** Upsert a chapter summary. */
  upsertSummary(summary: StoredSummary): void {
    if (!this.available) return;
    this.ensureDb();
    this.db.prepare(
      `INSERT OR REPLACE INTO chapter_summaries (chapter, title, characters, events, state_changes, hook_activity, mood, chapter_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      summary.chapter, summary.title, summary.characters, summary.events,
      summary.stateChanges, summary.hookActivity, summary.mood, summary.chapterType,
    );
  }

  replaceSummaries(summaries: ReadonlyArray<StoredSummary>): void {
    if (!this.available) return;
    this.ensureDb();
    // Transaction: atomic replace so partial failure doesn't lose data
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec("DELETE FROM chapter_summaries");
      for (const summary of summaries) {
        this.upsertSummary(summary);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** Get summaries for a range of chapters. */
  getSummaries(fromChapter: number, toChapter: number): ReadonlyArray<StoredSummary> {
    if (!this.available) return [];
    this.ensureDb();
    return this.db.prepare(
      `SELECT
         chapter,
         title,
         characters,
         events,
         state_changes AS stateChanges,
         hook_activity AS hookActivity,
         mood,
         chapter_type AS chapterType
       FROM chapter_summaries
       WHERE chapter >= ? AND chapter <= ?
       ORDER BY chapter`,
    ).all(fromChapter, toChapter) as unknown as StoredSummary[];
  }

  /** Get summaries matching any of the given character names. */
  getSummariesByCharacters(names: ReadonlyArray<string>): ReadonlyArray<StoredSummary> {
    if (names.length === 0) return [];
    if (!this.available) return [];
    this.ensureDb();
    const conditions = names.map(() => "characters LIKE ?").join(" OR ");
    const params = names.map((n) => `%${n}%`);
    return this.db.prepare(
      `SELECT
         chapter,
         title,
         characters,
         events,
         state_changes AS stateChanges,
         hook_activity AS hookActivity,
         mood,
         chapter_type AS chapterType
       FROM chapter_summaries
       WHERE ${conditions}
       ORDER BY chapter`,
    ).all(...params) as unknown as StoredSummary[];
  }

  /** Get total chapter count. */
  getChapterCount(): number {
    if (!this.available) return 0;
    this.ensureDb();
    const row = this.db.prepare("SELECT COUNT(*) as count FROM chapter_summaries").get() as unknown as { count: number };
    return row.count;
  }

  /** Get the most recent N summaries. */
  getRecentSummaries(count: number): ReadonlyArray<StoredSummary> {
    if (!this.available) return [];
    this.ensureDb();
    return this.db.prepare(
      `SELECT
         chapter,
         title,
         characters,
         events,
         state_changes AS stateChanges,
         hook_activity AS hookActivity,
         mood,
         chapter_type AS chapterType
       FROM chapter_summaries
       ORDER BY chapter DESC
       LIMIT ?`,
    ).all(count) as unknown as ReadonlyArray<StoredSummary>;
  }

  // ---------------------------------------------------------------------------
  // Hooks
  // ---------------------------------------------------------------------------

  upsertHook(hook: StoredHook): void {
    if (!this.available) return;
    this.ensureDb();
    this.db.prepare(
      `INSERT OR REPLACE INTO hooks (hook_id, start_chapter, type, status, last_advanced_chapter, expected_payoff, payoff_timing, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      hook.hookId,
      hook.startChapter,
      hook.type,
      hook.status,
      hook.lastAdvancedChapter,
      hook.expectedPayoff,
      hook.payoffTiming ?? "",
      hook.notes,
    );
  }

  replaceHooks(hooks: ReadonlyArray<StoredHook>): void {
    if (!this.available) return;
    this.ensureDb();
    // Transaction: atomic replace so partial failure doesn't lose data
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec("DELETE FROM hooks");
      for (const hook of hooks) {
        this.upsertHook(hook);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  getActiveHooks(): ReadonlyArray<StoredHook> {
    if (!this.available) return [];
    this.ensureDb();
    return this.db.prepare(
      `SELECT
         hook_id AS hookId,
         start_chapter AS startChapter,
         type,
         status,
         last_advanced_chapter AS lastAdvancedChapter,
         expected_payoff AS expectedPayoff,
         payoff_timing AS payoffTiming,
         notes
       FROM hooks
       WHERE lower(status) NOT IN ('resolved', 'closed', '已回收', '已解决')
       ORDER BY last_advanced_chapter DESC, start_chapter DESC, hook_id ASC`,
    ).all() as unknown as ReadonlyArray<StoredHook>;
  }

  // ---------------------------------------------------------------------------
  // Intent commitments (author interview answers)
  // ---------------------------------------------------------------------------

  /** Record an intent commitment — the author's answer to a pre-writing question. */
  addIntentCommitment(commitment: Omit<IntentCommitment, "id" | "createdAt">): number {
    if (!this.available) return 0;
    this.ensureDb();
    const stmt = this.db.prepare(
      `INSERT INTO intent_commitments (chapter_number, question, answer, category, verified, verification_result)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const result = stmt.run(
      commitment.chapterNumber,
      commitment.question,
      commitment.answer,
      commitment.category,
      commitment.verified ? 1 : 0,
      commitment.verificationResult ?? "",
    );
    return Number(result.lastInsertRowid);
  }

  /** Mark an intent commitment as verified (or not) after the chapter is written. */
  verifyIntentCommitment(
    id: number,
    verified: boolean,
    result: string,
  ): void {
    if (!this.available) return;
    this.ensureDb();
    this.db.prepare(
      `UPDATE intent_commitments SET verified = ?, verification_result = ? WHERE id = ?`,
    ).run(verified ? 1 : 0, result, id);
  }

  /** Get all intent commitments for a specific chapter. */
  getIntentCommitments(chapterNumber: number): ReadonlyArray<IntentCommitment> {
    if (!this.available) return [];
    this.ensureDb();
    return this.db.prepare(
      `SELECT
         id,
         chapter_number AS chapterNumber,
         question,
         answer,
         category,
         verified,
         verification_result AS verificationResult,
         created_at AS createdAt
       FROM intent_commitments
       WHERE chapter_number = ?
       ORDER BY id ASC`,
    ).all(chapterNumber) as unknown as ReadonlyArray<IntentCommitment>;
  }

  /** Get all unverified intent commitments across all chapters. */
  getUnverifiedIntentCommitments(): ReadonlyArray<IntentCommitment> {
    if (!this.available) return [];
    this.ensureDb();
    return this.db.prepare(
      `SELECT
         id,
         chapter_number AS chapterNumber,
         question,
         answer,
         category,
         verified,
         verification_result AS verificationResult,
         created_at AS createdAt
       FROM intent_commitments
       WHERE verified = 0
       ORDER BY chapter_number ASC, id ASC`,
    ).all() as unknown as ReadonlyArray<IntentCommitment>;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  close(): void {
    if (!this.available || !this.db) return;
    this.db.close();
  }
}

/** Factory that returns a MemoryDB instance or null if sqlite is unavailable. */
export function tryCreateMemoryDB(bookDir: string): MemoryDB | null {
  const db = new MemoryDB(bookDir);
  return db.isAvailable ? db : null;
}
