/**
 * The §10 "last updated" state, as pure functions.
 *
 * Split out from cache.ts deliberately. cache.ts imports expo-sqlite, which is
 * a native module — anything importing it can only run on a device, so the
 * freshness logic would have been untestable purely by association. Keeping
 * the decisions (is this stale? how do I say so?) separate from the storage
 * means they run in CI in milliseconds.
 */

/** Anything older than this is labelled, not hidden. */
export const STALE_AFTER_MS = 15 * 60 * 1000;

export function isStale(fetchedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - fetchedAt.getTime() > STALE_AFTER_MS;
}

/** "Updated 4 minutes ago". */
export function formatFreshness(fetchedAt: Date, now: Date = new Date()): string {
  // Clamped at zero: device clocks drift, and a cache written "in the future"
  // must not render as "Updated -3 minutes ago".
  const seconds = Math.max(0, Math.round((now.getTime() - fetchedAt.getTime()) / 1000));

  if (seconds < 60) return 'Updated just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Updated ${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Updated ${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.round(hours / 24);
  return `Updated ${days} day${days === 1 ? '' : 's'} ago`;
}
