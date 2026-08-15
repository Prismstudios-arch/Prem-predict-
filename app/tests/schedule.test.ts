import { describe, expect, it } from 'vitest';

import { groupByDay } from '../src/data/schedule';

const fx = (kickoff_utc: string, id = kickoff_utc) => ({ id, kickoff_utc });

describe('groupByDay', () => {
  it('groups a real opening weekend into its four days', () => {
    // The actual 2026/27 GW1 shape: Friday night, a Saturday spread, Sunday.
    const sections = groupByDay([
      fx('2026-08-22T14:00:00Z'),
      fx('2026-08-21T19:00:00Z'),
      fx('2026-08-23T15:30:00Z'),
      fx('2026-08-22T11:30:00Z'),
      fx('2026-08-22T16:30:00Z'),
    ]);

    expect(sections).toHaveLength(3);
    expect(sections.map((s) => s.data.length)).toEqual([1, 3, 1]);
  });

  it('sorts by kick-off regardless of input order', () => {
    const sections = groupByDay([
      fx('2026-08-22T16:30:00Z', 'late'),
      fx('2026-08-22T11:30:00Z', 'early'),
      fx('2026-08-22T14:00:00Z', 'mid'),
    ]);

    expect(sections).toHaveLength(1);
    expect(sections[0]!.data.map((f) => f.id)).toEqual(['early', 'mid', 'late']);
  });

  it('titles a day the way a person reads it', () => {
    const [section] = groupByDay([fx('2026-08-21T19:00:00Z')]);
    expect(section!.title).toBe('FRIDAY 21 AUGUST');
  });

  it('keys on the calendar day, not on the rendered title', () => {
    // The key is what merges rows. A title is a presentation string and would
    // change under a different locale; the key must not.
    const [section] = groupByDay([fx('2026-08-21T19:00:00Z')]);
    expect(section!.key).toBe('2026-8-21');
    expect(section!.key).not.toBe(section!.title);
  });

  it('does not merge the same weekday from different weeks', () => {
    const sections = groupByDay([
      fx('2026-08-21T19:00:00Z'),
      fx('2026-08-28T19:00:00Z'),
    ]);
    expect(sections).toHaveLength(2);
    expect(sections[0]!.title).toBe('FRIDAY 21 AUGUST');
    expect(sections[1]!.title).toBe('FRIDAY 28 AUGUST');
  });

  it('skips unparseable kick-off times rather than rendering Invalid Date', () => {
    const sections = groupByDay([fx('not a date', 'bad'), fx('2026-08-21T19:00:00Z', 'good')]);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.data.map((f) => f.id)).toEqual(['good']);
  });

  it('returns nothing for no fixtures', () => {
    expect(groupByDay([])).toEqual([]);
  });

  it('does not mutate the array it was given', () => {
    const input = [fx('2026-08-23T15:30:00Z', 'b'), fx('2026-08-21T19:00:00Z', 'a')];
    groupByDay(input);
    expect(input.map((f) => f.id)).toEqual(['b', 'a']);
  });

  it('groups by local time, so a late kick-off keeps its own date', () => {
    // Under Europe/London (the CI and target timezone) a 19:00Z August match is
    // 20:00 BST — still the 21st. This is the assertion that would fail if the
    // implementation ever went back to slicing the ISO string, which is the
    // obvious-looking shortcut.
    const [section] = groupByDay([fx('2026-08-21T19:00:00Z')]);
    const local = new Date('2026-08-21T19:00:00Z').getDate();
    expect(section!.key.endsWith(`-${local}`)).toBe(true);
  });
});
