/**
 * Pipeline Reentrancy Guard — prevents concurrent mutations on the same
 * resource (book chapter, truth file, hook, role card) using in-memory
 * per-resource locks.
 *
 * All write operations MUST acquire the lock before mutating and release
 * it in a finally block. The guard covers 12 critical mutation points:
 *
 *   1. writeNext (chapter generation)
 *   2. draftChapter (background draft)
 *   3. approveChapter
 *   4. rejectChapter
 *   5. rewriteChapter
 *   6. resyncChapter
 *   7. saveChapterContent (PUT /chapters/:num)
 *   8. saveTruthFile (PUT /truth/:file)
 *   9. saveHook (PUT/POST /hooks)
 *  10. saveRole (PUT/POST /roles)
 *  11. extractEventChain
 *  12. saveSceneTemplates
 *
 * @module
 */

type LockKey = string;

const locks = new Map<LockKey, Promise<void>>();

/**
 * Acquire an exclusive lock for the given resource key.
 * Returns a release function. Always release in a finally block.
 *
 * @example
 * const release = await acquireLock("book:demo:chapter:3");
 * try {
 *   // mutate
 * } finally {
 *   release();
 * }
 */
export async function acquireLock(key: LockKey): Promise<() => void> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  locks.set(key, previous.then(() => next));
  await previous;
  return () => {
     
    release!();
    if (locks.get(key) === next) locks.delete(key);
  };
}

/** Check if a lock is currently held without waiting. */
export function isLocked(key: LockKey): boolean {
  return locks.has(key);
}

/** Release all locks (for teardown). */
export function releaseAllLocks(): void {
  locks.clear();
}

/** Build a standard lock key for a book chapter. */
export function chapterKey(bookId: string, chapterNumber: number): LockKey {
  return `book:${bookId}:chapter:${chapterNumber}`;
}

/** Build a standard lock key for a truth file. */
export function truthKey(bookId: string, file: string): LockKey {
  return `book:${bookId}:truth:${file}`;
}

/** Build a standard lock key for a hook. */
export function hookKey(bookId: string, hookId: string): LockKey {
  return `book:${bookId}:hook:${hookId}`;
}

/** Build a standard lock key for a role card. */
export function roleKey(bookId: string, roleId: string): LockKey {
  return `book:${bookId}:role:${roleId}`;
}

/** Build a standard lock key for scene templates. */
export function sceneTemplatesKey(bookId: string): LockKey {
  return `book:${bookId}:scene-templates`;
}

/** Build a standard lock key for event chain extraction. */
export function eventChainKey(bookId: string, chapterNumber: number): LockKey {
  return `book:${bookId}:event-chain:${chapterNumber}`;
}
