/**
 * Season arithmetic, mirroring worker/src/premmodel/season.py.
 *
 * The app must not ship a hardcoded season. A build submitted in 2026 is still
 * on people's phones in 2028 — anyone who does not update would be looking at a
 * season that finished two years earlier, with no error to explain it.
 *
 * This is the one piece of logic deliberately duplicated across Python and
 * TypeScript. It cannot come from the API, because the client needs a season to
 * *make* its first request; and it cannot be a build-time constant, because the
 * build outlives the season. It is nine lines of pure date arithmetic with
 * tests on both sides, which is the cheapest of the available bad options.
 */

/** July. The top flight runs August-May; fixtures publish in June. */
export const SEASON_ROLLOVER_MONTH = 7;

export function seasonLabel(startYear: number): string {
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

export function seasonStartYear(label: string): number {
  return Number(label.split('-')[0]);
}

/**
 * The season we are in or about to enter.
 *
 * `getMonth()` is zero-based, hence the +1 — the classic off-by-one that would
 * shift the rollover by a month and file August fixtures under the wrong year.
 */
export function currentSeason(today: Date = new Date()): string {
  const month = today.getMonth() + 1;
  const startYear = month >= SEASON_ROLLOVER_MONTH ? today.getFullYear() : today.getFullYear() - 1;
  return seasonLabel(startYear);
}

export function previousSeason(label: string): string {
  return seasonLabel(seasonStartYear(label) - 1);
}
