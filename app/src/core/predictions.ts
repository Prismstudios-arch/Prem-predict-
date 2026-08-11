/**
 * Prediction submission (CLAUDE.md §2 [HARD], §9.2).
 *
 * The lock is NOT enforced here. It is enforced by the RLS policy in
 * 0002_rls.sql, which compares Postgres's own now() against kickoff_utc. This
 * module cannot be the guard, because a user who changes their device clock
 * controls everything this file could possibly check.
 *
 * What this module does is translate the database's refusal into something a
 * person can read. A user whose submission lands two seconds after kickoff
 * should see "this match has kicked off", not a Postgres policy violation.
 *
 * Note also what is absent: no submitted_at, no points_awarded, no user_id
 * spoofing. Those columns carry no INSERT grant at all (0002_rls.sql), so
 * there is nothing to send even if someone tampered with the payload.
 */

import { supabase } from '@/api/client';

export type Outcome = 'home' | 'draw' | 'away';

export type PredictionInput = {
  fixtureId: string;
  homeGoals: number;
  awayGoals: number;
};

export type SubmitResult =
  | { ok: true }
  | { ok: false; reason: 'locked' | 'auth' | 'invalid' | 'network'; message: string };

/** Derived, never supplied — the DB enforces the same rule as a CHECK. */
export function deriveOutcome(homeGoals: number, awayGoals: number): Outcome {
  if (homeGoals > awayGoals) return 'home';
  if (homeGoals < awayGoals) return 'away';
  return 'draw';
}

export async function submitPrediction(input: PredictionInput): Promise<SubmitResult> {
  const { fixtureId, homeGoals, awayGoals } = input;

  if (!Number.isInteger(homeGoals) || !Number.isInteger(awayGoals)) {
    return { ok: false, reason: 'invalid', message: 'Scores must be whole numbers.' };
  }
  if (homeGoals < 0 || awayGoals < 0 || homeGoals > 20 || awayGoals > 20) {
    return { ok: false, reason: 'invalid', message: 'That scoreline looks wrong.' };
  }

  const client = supabase();
  const { data: session } = await client.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) {
    return { ok: false, reason: 'auth', message: 'Sign in to make predictions.' };
  }

  const { error } = await client.from('user_predictions').upsert(
    {
      user_id: userId,
      fixture_id: fixtureId,
      outcome: deriveOutcome(homeGoals, awayGoals),
      home_goals: homeGoals,
      away_goals: awayGoals,
    },
    { onConflict: 'user_id,fixture_id' },
  );

  if (!error) return { ok: true };
  return { ok: false, ...interpret(error.code, error.message) };
}

/**
 * Map Postgres errors to human copy (§10: never a raw error string).
 *
 * 42501 is an RLS denial. For this table that means one of exactly two things:
 * the row is not yours, or the match has kicked off. Only the second is
 * reachable through the UI, so it is the message worth showing.
 */
type Failure = { reason: 'locked' | 'auth' | 'invalid' | 'network'; message: string };

function interpret(code: string | undefined, message: string): Failure {
  switch (code) {
    case '42501':
      return {
        reason: 'locked',
        message: 'This match has kicked off. Predictions are closed.',
      };
    case '23514':
      return { reason: 'invalid', message: 'That scoreline looks wrong.' };
    case '23503':
      return { reason: 'invalid', message: "That match isn't available." };
    default:
      console.error('submitPrediction failed', code, message);
      return { reason: 'network', message: "Couldn't save your prediction. Try again." };
  }
}

export async function fetchMyPredictions(fixtureIds: string[]) {
  const { data, error } = await supabase()
    .from('user_predictions')
    .select('fixture_id, outcome, home_goals, away_goals, points_awarded, settled_at')
    .in('fixture_id', fixtureIds);

  if (error) throw new Error(`fetchMyPredictions failed: ${error.message}`);
  return data ?? [];
}

export type GameweekResult = {
  season: string;
  gameweek: number;
  user_points: number;
  model_points: number;
  predictions_made: number;
  exact_scores: number;
  correct_outcomes: number;
  beat_model: boolean;
  settled_at: string;
};

export async function fetchMyResults(): Promise<GameweekResult[]> {
  const { data, error } = await supabase()
    .from('my_gameweek_results')
    .select('*')
    .order('gameweek', { ascending: false });

  if (error) throw new Error(`fetchMyResults failed: ${error.message}`);
  return (data ?? []) as GameweekResult[];
}
