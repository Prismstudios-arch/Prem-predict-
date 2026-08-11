/**
 * Supabase client + typed reads.
 *
 * CLAUDE.md §2 [HARD]: no secrets in the bundle. Only these two values are
 * permitted in EXPO_PUBLIC_*. The anon key is *designed* to be public — RLS is
 * what protects the data, which is why 0002_rls.sql is the security model and
 * not a formality. Anything else lives in EAS secrets, server-side only.
 *
 * §3: the client holds zero prediction business logic. It reads precomputed
 * rows from gated views and renders them.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

let cached: SupabaseClient | null = null;

/**
 * Created on first use, not at import time.
 *
 * Throwing at module scope would take down the whole bundle the moment
 * anything transitively imports this file — including the sample-data path in
 * Phase 2, which needs no backend at all. Failing at the call site instead
 * keeps the failure where it can be handled and reported.
 */
export function supabase(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Copy app/.env.example to app/.env and fill it in.',
    );
  }
  cached ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export function hasBackend(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/* ------------------------------------------------------------------ schemas */

export const FixtureStatus = z.enum([
  'scheduled',
  'live',
  'finished',
  'postponed',
  'cancelled',
]);

/**
 * Responses are validated, never trusted. A provider or migration change that
 * alters a shape must fail loudly here rather than render `undefined` into the
 * UI (§10: "never a raw error string", but also never silent corruption).
 */
export const FixtureSchema = z.object({
  id: z.string().uuid(),
  gameweek: z.number().int().min(1).max(38),
  kickoff_utc: z.string(),
  status: FixtureStatus,
  home_team: z.object({ name: z.string(), short_name: z.string() }),
  away_team: z.object({ name: z.string(), short_name: z.string() }),
  home_goals: z.number().int().nullable(),
  away_goals: z.number().int().nullable(),
});
export type ApiFixture = z.infer<typeof FixtureSchema>;

/* -------------------------------------------------------------------- reads */

export async function fetchGameweek(
  season: string,
  gameweek: number,
): Promise<ApiFixture[]> {
  const { data, error } = await supabase()
    .from('fixtures')
    .select(
      `id, gameweek, kickoff_utc, status, home_goals, away_goals,
       home_team:teams!fixtures_home_team_id_fkey ( name, short_name ),
       away_team:teams!fixtures_away_team_id_fkey ( name, short_name )`,
    )
    .eq('season', season)
    .eq('gameweek', gameweek)
    .order('kickoff_utc', { ascending: true });

  if (error) throw new Error(`fetchGameweek failed: ${error.message}`);
  return z.array(FixtureSchema).parse(data);
}

/**
 * Free tier (§8.1): headline pick + confidence only. There are no probabilities
 * in this payload to leak — see 0003_views.sql.
 */
export async function fetchFreePredictions(fixtureIds: string[]) {
  const { data, error } = await supabase()
    .from('predictions_free')
    .select('fixture_id, headline_pick, confidence, data_regime')
    .in('fixture_id', fixtureIds);

  if (error) throw new Error(`fetchFreePredictions failed: ${error.message}`);
  return data ?? [];
}

/**
 * Premium (§8.1, §9.2 [HARD]). Returns [] for unentitled users because the view
 * filters on is_entitled() server-side — the client gate is convenience, not
 * security.
 */
export async function fetchPremiumPredictions(fixtureIds: string[]) {
  const { data, error } = await supabase()
    .from('predictions_premium')
    .select('*')
    .in('fixture_id', fixtureIds);

  if (error) throw new Error(`fetchPremiumPredictions failed: ${error.message}`);
  return data ?? [];
}
