/**
 * Grouping fixtures into the days a football weekend actually has.
 *
 * Ten cards in one flat list is a wall: the reader cannot tell Friday night
 * from Sunday afternoon without reading every timestamp, and a matchday is
 * something people already think about in days.
 *
 * This lives apart from the screen so it can be tested without a renderer.
 * The date handling has two traps in it and neither is visible by eye:
 *
 *   - Grouping must use the *local* calendar day, not the UTC one. A 20:00 UTC
 *     Sunday kick-off is still Sunday in Britain, but a late-evening match can
 *     fall on the wrong side of UTC midnight for a user further east, and they
 *     would see a Monday header on a Sunday game.
 *
 *   - The grouping key must not be the rendered title. Two different days can
 *     produce the same human string across a year boundary, and a key that is
 *     also a label is one i18n change away from merging them.
 */

export type Scheduled = { kickoff_utc: string };

export type DaySection<T> = {
  /** Stable grouping key — a local date, never the rendered label. */
  key: string;
  /** "FRIDAY 21 AUGUST", ready to render. */
  title: string;
  data: T[];
};

export function groupByDay<T extends Scheduled>(fixtures: T[]): DaySection<T>[] {
  const sorted = [...fixtures].sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc));
  const sections: DaySection<T>[] = [];

  for (const fixture of sorted) {
    const date = new Date(fixture.kickoff_utc);
    if (Number.isNaN(date.getTime())) continue; // never render an "Invalid Date" header

    // Local Y-M-D, built from the getters rather than a locale string: a
    // formatted date is a presentation concern and varies by locale, and using
    // it as an identity key means the grouping changes when the language does.
    const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

    const last = sections[sections.length - 1];
    if (last?.key === key) {
      last.data.push(fixture);
      continue;
    }

    sections.push({
      key,
      title: date
        .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
        .toUpperCase(),
      data: [fixture],
    });
  }

  return sections;
}
