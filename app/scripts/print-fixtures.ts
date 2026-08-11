/**
 * PHASE 0 DELIVERABLE (CLAUDE.md §11):
 *   "a fixture list fetched from your own API and printed to console."
 *
 * Runs the real client code path against the real Supabase project, so it
 * proves the whole chain: client -> our API -> RLS -> data.
 *
 * It also asserts the §9.2 [HARD] premium boundary: an unentitled caller must
 * receive ZERO ROWS from predictions_premium, not masked fields. If that ever
 * regresses, this exits non-zero.
 *
 *   npm run fixtures
 */

import 'dotenv/config';

import {
  fetchFreePredictions,
  fetchGameweek,
  fetchPremiumPredictions,
  hasBackend,
  supabase,
} from '../src/api/client';
import { currentSeason } from '../src/data/season';

const SEASON = process.env.SEASON ?? currentSeason();
const GAMEWEEK = Number(process.env.GAMEWEEK ?? 1);

function fmtKickoff(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  });
}

async function assertPremiumIsGated(): Promise<boolean> {
  const { data, error } = await supabase()
    .from('predictions_premium')
    .select('*')
    .limit(1);

  if (error) {
    // A hard denial is also a pass - the row never leaves the database.
    console.log(`  premium gate: DENIED (${error.message})  [OK]`);
    return true;
  }
  const leaked = (data ?? []).length;
  if (leaked === 0) {
    console.log('  premium gate: 0 rows to unentitled caller  [OK]');
    return true;
  }
  console.error(`  premium gate: LEAKED ${leaked} row(s) - SS9.2 [HARD] VIOLATION`);
  return false;
}

async function main() {
  if (!hasBackend()) {
    console.error(
      '\nNo Supabase project configured.\n' +
        'Copy app/.env.example to app/.env and fill in the two EXPO_PUBLIC_ values.\n',
    );
    process.exit(2);
  }

  console.log(`\n${SEASON}  |  Gameweek ${GAMEWEEK}`);
  console.log('-'.repeat(58));

  const fixtures = await fetchGameweek(SEASON, GAMEWEEK);

  if (fixtures.length === 0) {
    console.log('  no fixtures - run `python -m premmodel ingest` in worker/ first');
  }

  // Exercise both tiers so the whole read path is proven, not just fixtures.
  const ids = fixtures.map((f) => f.id);
  const free = await fetchFreePredictions(ids);
  const premium = await fetchPremiumPredictions(ids);
  const freeById = new Map(free.map((p) => [p.fixture_id, p]));
  const premiumById = new Map(premium.map((p) => [p.fixture_id, p]));

  for (const f of fixtures) {
    const right =
      f.home_goals !== null && f.away_goals !== null
        ? `${f.home_goals}-${f.away_goals}`
        : fmtKickoff(f.kickoff_utc);

    const full = premiumById.get(f.id);
    const pick = freeById.get(f.id);
    const model = full
      ? `${Math.round(full.p_home * 100)}/${Math.round(full.p_draw * 100)}/${Math.round(full.p_away * 100)}`
      : pick
        ? `${pick.headline_pick.padEnd(4)} ${pick.confidence_band}`
        : 'no prediction';

    console.log(
      `  ${f.home_team.short_name.padStart(3)}  v  ${f.away_team.short_name.padEnd(3)}` +
        `   ${right.padStart(20)}   ${model}`,
    );
  }

  console.log('-'.repeat(58));
  console.log(`  ${fixtures.length} fixtures`);
  console.log(`  free picks: ${free.length}   premium rows: ${premium.length}\n`);

  const gated = await assertPremiumIsGated();
  console.log('');
  if (!gated) process.exit(1);
}

main().catch((err) => {
  console.error('\nfailed:', err instanceof Error ? err.message : err, '\n');
  process.exit(1);
});
