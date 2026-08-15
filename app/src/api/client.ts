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
/**
 * The team columns selected below and the fields required here must stay in
 * lockstep. They did not: the query originally fetched only name and
 * short_name while the consumer required slug and both colours, so every live
 * response failed validation and the gameweek screen showed its error state.
 * Zod caught it correctly — the select was simply wrong.
 */
const TeamRefSchema = z.object({
  slug: z.string(),
  name: z.string(),
  short_name: z.string(),
  primary_color: z.string(),
  secondary_color: z.string(),
});

/** Every column the schema above needs. Change one, change both. */
const TEAM_COLUMNS = 'slug, name, short_name, primary_color, secondary_color';

export const FixtureSchema = z.object({
  id: z.string().uuid(),
  gameweek: z.number().int().min(1).max(38),
  kickoff_utc: z.string(),
  status: FixtureStatus,
  home_team: TeamRefSchema,
  away_team: TeamRefSchema,
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
       home_team:teams!fixtures_home_team_id_fkey ( ${TEAM_COLUMNS} ),
       away_team:teams!fixtures_away_team_id_fkey ( ${TEAM_COLUMNS} )`,
    )
    .eq('season', season)
    .eq('gameweek', gameweek)
    .order('kickoff_utc', { ascending: true });

  if (error) throw new Error(`fetchGameweek failed: ${error.message}`);
  return z.array(FixtureSchema).parse(data);
}

/**
 * Free tier (§8.1): headline pick + confidence only. There are no probabilities
 * in this payload to leak — see 0003_views.sql / 0007_prediction_labels.sql.
 */
export const FreePickSchema = z.object({
  fixture_id: z.string(),
  headline_pick: z.enum(['home', 'draw', 'away']),
  confidence: z.coerce.number(),
  confidence_band: z.string(),
  confidence_reason: z.string(),
  data_regime: z.enum(['prior_heavy', 'blended', 'current']),
});
export type FreePick = z.infer<typeof FreePickSchema>;

export async function fetchFreePredictions(fixtureIds: string[]): Promise<FreePick[]> {
  if (fixtureIds.length === 0) return [];
  const { data, error } = await supabase()
    .from('predictions_free')
    .select(
      'fixture_id, headline_pick, confidence, confidence_band, confidence_reason, data_regime',
    )
    .in('fixture_id', fixtureIds);

  if (error) throw new Error(`fetchFreePredictions failed: ${error.message}`);
  return z.array(FreePickSchema).parse(data ?? []);
}

/**
 * Premium (§8.1, §9.2 [HARD]).
 *
 * Returns [] for unentitled users — not because of anything this function
 * does, but because predictions_premium filters on is_entitled() inside the
 * database. The rows never leave Postgres. Editing this file cannot unlock
 * them, which is the whole point of the design.
 */
export const PremiumPredictionSchema = z.object({
  fixture_id: z.string(),
  p_home: z.coerce.number(),
  p_draw: z.coerce.number(),
  p_away: z.coerce.number(),
  exp_home_goals: z.coerce.number(),
  exp_away_goals: z.coerce.number(),
  p_btts: z.coerce.number(),
  p_over_25: z.coerce.number(),
  p_home_cs: z.coerce.number(),
  p_away_cs: z.coerce.number(),
  confidence: z.coerce.number(),
  confidence_band: z.string(),
  confidence_reason: z.string(),
  data_regime: z.enum(['prior_heavy', 'blended', 'current']),
  scoreline_matrix: z.array(z.array(z.coerce.number())),
});
export type PremiumPrediction = z.infer<typeof PremiumPredictionSchema>;

export async function fetchPremiumPredictions(
  fixtureIds: string[],
): Promise<PremiumPrediction[]> {
  if (fixtureIds.length === 0) return [];
  const { data, error } = await supabase()
    .from('predictions_premium')
    .select('*')
    .in('fixture_id', fixtureIds);

  if (error) throw new Error(`fetchPremiumPredictions failed: ${error.message}`);
  return z.array(PremiumPredictionSchema).parse(data ?? []);
}

/** All clubs, alphabetical. Used by the onboarding club picker. */
export async function fetchTeams() {
  const { data, error } = await supabase()
    .from('teams')
    .select(TEAM_COLUMNS)
    .order('name', { ascending: true });

  if (error) throw new Error(`fetchTeams failed: ${error.message}`);
  return z.array(TeamRefSchema).parse(data ?? []);
}
