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
    .select(
      'fixture_id, outcome, home_goals, away_goals, points_awarded, settled_at, is_call_of_the_week',
    )
    .in('fixture_id', fixtureIds);

  if (error) throw new Error(`fetchMyPredictions failed: ${error.message}`);
  return data ?? [];
}

/**
 * Move the double-points pick (0009_call_of_the_week.sql).
 *
 * "One per gameweek" is enforced by a database trigger, not here — the client
 * sets the flag on one row and the trigger clears the others. Doing it in two
 * client writes would leave a window with two doublers, and a crash between
 * them would leave it there permanently.
 */
export async function setCallOfTheWeek(fixtureId: string): Promise<SubmitResult> {
  const client = supabase();
  const { data: session } = await client.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) {
    return { ok: false, reason: 'auth', message: 'Sign in to make predictions.' };
  }

  const { error } = await client
    .from('user_predictions')
    .update({ is_call_of_the_week: true })
    .eq('user_id', userId)
    .eq('fixture_id', fixtureId);

  if (!error) return { ok: true };

  // 55000 is raised by the trigger when the existing call is on a match that
  // has already kicked off. Moving it then would be a free re-roll, so it is
  // refused — and the user needs to be told why, not shown a retry button.
  if (error.code === '55000') {
    return {
      ok: false,
      reason: 'locked',
      message: 'Your call of the week has already kicked off. It stays where it is.',
    };
  }
  return { ok: false, ...interpret(error.code, error.message) };
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
