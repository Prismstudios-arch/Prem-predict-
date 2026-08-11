/**
 * Offline cache (CLAUDE.md §10, §3.1).
 *
 * §10: "every screen the user has visited must render from cache with a clear
 * 'last updated' state. No blank screens, no infinite spinners."
 *
 * §3.1 is explicit that this is a **disposable cache, never a source of
 * truth** — wipe and refill on schema change. That single decision removes the
 * entire class of migration bugs that would otherwise land mid-season: there is
 * no data here worth migrating, because every row can be re-fetched. When
 * SCHEMA_VERSION changes the table is dropped and rebuilt, and the worst case
 * is one network round trip.
 *
 * Freshness is stored alongside the payload rather than inferred, because
 * "when did this arrive" is information the user needs. A gameweek screen that
 * silently shows Tuesday's probabilities on Saturday afternoon is worse than
 * one that says it is stale.
 */

import * as SQLite from 'expo-sqlite';

import { isStale } from './freshness';

// Re-exported so callers have one import site for cache concerns, while the
// pure logic stays in a module that CI can load without a native runtime.
export { STALE_AFTER_MS, formatFreshness, isStale } from './freshness';

/** Bump to discard every cached row. Cheap, by design. */
const SCHEMA_VERSION = 1;

const DB_NAME = 'reckon-cache.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function open(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= (async () => {
    const db = await SQLite.openDatabaseAsync(DB_NAME);
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS cache_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    const row = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM cache_meta WHERE key = ?',
      'schema_version',
    );
    const stored = row ? Number(row.value) : 0;

    if (stored !== SCHEMA_VERSION) {
      // Disposable by design (§3.1): drop rather than migrate.
      await db.execAsync('DROP TABLE IF EXISTS cache_entries;');
      await db.execAsync(`
        CREATE TABLE cache_entries (
          key        TEXT PRIMARY KEY,
          payload    TEXT NOT NULL,
          fetched_at INTEGER NOT NULL
        );
      `);
      await db.runAsync(
        'INSERT OR REPLACE INTO cache_meta (key, value) VALUES (?, ?)',
        'schema_version',
        String(SCHEMA_VERSION),
      );
    }
    return db;
  })();

  return dbPromise;
}

export type Cached<T> = {
  value: T;
  fetchedAt: Date;
  /** True once the data is old enough that the UI should say so. */
  isStale: boolean;
};

export async function readCache<T>(key: string): Promise<Cached<T> | null> {
  try {
    const db = await open();
    const row = await db.getFirstAsync<{ payload: string; fetched_at: number }>(
      'SELECT payload, fetched_at FROM cache_entries WHERE key = ?',
      key,
    );
    if (!row) return null;

    const fetchedAt = new Date(row.fetched_at);
    return {
      value: JSON.parse(row.payload) as T,
      fetchedAt,
      isStale: isStale(fetchedAt),
    };
  } catch (error) {
    // A corrupt cache must never take the app down — it is, by construction,
    // data we can re-fetch.
    console.warn('cache read failed', key, error);
    return null;
  }
}

export async function writeCache<T>(key: string, value: T): Promise<void> {
  try {
    const db = await open();
    await db.runAsync(
      'INSERT OR REPLACE INTO cache_entries (key, payload, fetched_at) VALUES (?, ?, ?)',
      key,
      JSON.stringify(value),
      Date.now(),
    );
  } catch (error) {
    console.warn('cache write failed', key, error);
  }
}

export async function clearCache(): Promise<void> {
  const db = await open();
  await db.execAsync('DELETE FROM cache_entries;');
}

export type Fresh<T> = {
  value: T;
  fetchedAt: Date;
  isStale: boolean;
  /** True when the network failed and this came from disk. */
  fromCache: boolean;
};

/**
 * Fetch with cache fallback.
 *
 * Network first so the user sees current data when they can. On failure, fall
 * back to whatever is on disk rather than showing an error — §10 forbids a
 * blank screen, and a labelled stale gameweek is strictly more useful than a
 * retry button. Only when both fail does the caller get an error to render.
 */
export async function withCache<T>(key: string, fetcher: () => Promise<T>): Promise<Fresh<T>> {
  try {
    const value = await fetcher();
    await writeCache(key, value);
    return { value, fetchedAt: new Date(), isStale: false, fromCache: false };
  } catch (error) {
    const cached = await readCache<T>(key);
    if (cached) {
      console.warn('serving cached data after fetch failure', key, error);
      return { ...cached, fromCache: true };
    }
    throw error;
  }
}

// formatFreshness / isStale / STALE_AFTER_MS are re-exported from ./freshness
// at the top of this file, so callers still import them from here.
