/**
 * Freshness formatting for the §10 "last updated" state.
 *
 * Pure function, so it is tested here rather than needing expo-sqlite. The
 * cache's storage behaviour needs a device; its user-visible output does not.
 */

import { describe, expect, it } from 'vitest';

// Imported from ./freshness, not ./cache: cache.ts pulls in expo-sqlite, a
// native module that cannot load in Node. That split is why this logic is
// testable at all.
import { formatFreshness, isStale, STALE_AFTER_MS } from '../src/data/freshness';

const at = (msAgo: number) => new Date(Date.now() - msAgo);
const NOW = new Date();
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('freshness labels (§10)', () => {
  it('reads as just now inside a minute', () => {
    expect(formatFreshness(ago(5_000), NOW)).toBe('Updated just now');
  });

  it('singularises one minute', () => {
    expect(formatFreshness(ago(60_000), NOW)).toBe('Updated 1 minute ago');
  });

  it('pluralises several minutes', () => {
    expect(formatFreshness(ago(4 * 60_000), NOW)).toBe('Updated 4 minutes ago');
  });

  it('rolls over to hours', () => {
    expect(formatFreshness(ago(2 * 3_600_000), NOW)).toBe('Updated 2 hours ago');
  });

  it('rolls over to days', () => {
    expect(formatFreshness(ago(3 * 86_400_000), NOW)).toBe('Updated 3 days ago');
  });

  it('never shows a negative age from clock skew', () => {
    // Device clocks drift, and a cache written "in the future" must not
    // render as "Updated -3 minutes ago".
    expect(formatFreshness(new Date(NOW.getTime() + 60_000), NOW)).toBe('Updated just now');
  });

  it('always produces a non-empty label', () => {
    for (const ms of [0, 1_000, 59_999, 60_000, 3_599_999, 86_400_000, 30 * 86_400_000]) {
      expect(formatFreshness(ago(ms), NOW)).toMatch(/^Updated /);
    }
  });
});

describe('staleness threshold', () => {
  it('is short enough to matter on a matchday', () => {
    // Scores move every few minutes during a 3pm slate. An hour-long window
    // would let the app present a finished match as still in play.
    expect(STALE_AFTER_MS).toBeLessThanOrEqual(15 * 60 * 1000);
    expect(STALE_AFTER_MS).toBeGreaterThan(60 * 1000);
  });

  it('marks data stale only after the threshold', () => {
    expect(isStale(at(STALE_AFTER_MS - 1000))).toBe(false);
    expect(isStale(at(STALE_AFTER_MS + 1000))).toBe(true);
  });

  it('treats freshly written data as current', () => {
    expect(isStale(new Date())).toBe(false);
  });
});
