/**
 * Season rollover, client side.
 *
 * This logic is duplicated from worker/src/premmodel/season.py — the one place
 * in the codebase where that is deliberate (see the module docstring for why).
 * Duplication is only safe if both copies are pinned to the same cases, so
 * these mirror test_season.py exactly. If one is changed without the other,
 * one of the two suites fails.
 */

import { describe, expect, it } from 'vitest';

import {
  currentSeason,
  previousSeason,
  seasonLabel,
  seasonStartYear,
} from '../src/data/season';

describe('currentSeason tracks the calendar', () => {
  const cases: [string, string][] = [
    ['2026-08-21', '2026-27'], // opening weekend
    ['2026-12-26', '2026-27'], // Boxing Day
    ['2027-01-02', '2026-27'], // new calendar year, same season
    ['2027-05-24', '2026-27'], // final day
    ['2027-06-15', '2026-27'], // close season, not yet rolled
    ['2027-07-01', '2027-28'], // rollover
    ['2027-08-14', '2027-28'], // next opening weekend
    ['2030-03-03', '2029-30'], // four years on, still right
  ];

  for (const [iso, expected] of cases) {
    it(`${iso} -> ${expected}`, () => {
      // Parsed as local time so the test is not shifted by the runner's zone.
      const [y, m, d] = iso.split('-').map(Number);
      expect(currentSeason(new Date(y!, m! - 1, d!))).toBe(expected);
    });
  }
});

describe('season labels', () => {
  it('roundtrip for three decades', () => {
    for (let year = 2010; year < 2040; year++) {
      expect(seasonStartYear(seasonLabel(year))).toBe(year);
    }
  });

  it('handles the century edge', () => {
    expect(seasonLabel(2099)).toBe('2099-00');
    expect(seasonStartYear('2099-00')).toBe(2099);
  });

  it('previousSeason steps back one year', () => {
    expect(previousSeason('2026-27')).toBe('2025-26');
    expect(previousSeason('2000-01')).toBe('1999-00');
  });
});

describe('no frozen season ships in the bundle', () => {
  it('currentSeason is evaluated per call, not at module load', () => {
    // A build submitted in 2026 is still installed in 2028. If the season were
    // captured once at import, those users would silently see a season that
    // finished two years earlier.
    const a = currentSeason(new Date(2026, 8, 1));
    const b = currentSeason(new Date(2028, 8, 1));
    expect(a).not.toBe(b);
  });

  it('month arithmetic is not off by one', () => {
    // getMonth() is zero-based; a missing +1 shifts the rollover into June and
    // files August fixtures under the previous season.
    expect(currentSeason(new Date(2027, 5, 30))).toBe('2026-27'); // 30 June
    expect(currentSeason(new Date(2027, 6, 1))).toBe('2027-28'); // 1 July
  });
});
