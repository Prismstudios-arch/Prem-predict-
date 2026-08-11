/**
 * Club colours, read from the shared JSON (CLAUDE.md §7.4).
 *
 * The same file seeds public.teams via the Python worker. One list, so the
 * colours the accessibility suite checks are provably the colours the database
 * hands to the app.
 *
 * At runtime the app uses colours from the API, not this file — a club's
 * colours arrive with its row. This exists so the contrast tests can check
 * every club the seed can produce, including ones not in the current season.
 */

import teamColours from './team-colours.json';

export type ColourPair = readonly [primary: string, secondary: string];

export const TEAM_COLOURS: Record<string, ColourPair> = Object.fromEntries(
  Object.entries(teamColours.colours).map(([slug, pair]) => [
    slug,
    pair as unknown as ColourPair,
  ]),
);

export function coloursFor(slug: string): ColourPair | undefined {
  return TEAM_COLOURS[slug];
}
