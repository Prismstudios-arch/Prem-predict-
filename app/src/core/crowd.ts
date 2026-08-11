/**
 * Crowd vs model.
 *
 * The app knows two things at once that almost nothing else does: what a
 * calibrated model thinks, and what every user thinks. Where those disagree is
 * the most interesting sentence the app can produce, and it costs nothing to
 * generate.
 *
 * All the rules live in the database (0006_crowd.sql):
 *   - nothing is visible until kickoff, so the crowd cannot anchor predictions
 *   - a minimum sample applies, so no individual's pick is recoverable
 *   - `actual_outcome` stays null until a match finishes
 *
 * This module only reads and formats. If it ever starts computing crowd
 * percentages client-side, the lock and the privacy floor have been bypassed.
 */

import { z } from 'zod';

import { supabase } from '@/api/client';

const Outcome = z.enum(['home', 'draw', 'away']);
export type Outcome = z.infer<typeof Outcome>;

export const CrowdVsModelSchema = z.object({
  fixture_id: z.string(),
  season: z.string(),
  gameweek: z.number(),
  home_name: z.string(),
  home_short: z.string(),
  away_name: z.string(),
  away_short: z.string(),
  status: z.string(),
  home_goals: z.number().nullable(),
  away_goals: z.number().nullable(),
  n_predictions: z.number(),
  crowd_home: z.coerce.number(),
  crowd_draw: z.coerce.number(),
  crowd_away: z.coerce.number(),
  crowd_scoreline: z.string().nullable(),
  model_home: z.coerce.number(),
  model_draw: z.coerce.number(),
  model_away: z.coerce.number(),
  disagreement: z.coerce.number(),
  crowd_pick: Outcome,
  model_pick: Outcome,
  actual_outcome: Outcome.nullable(),
});

export type CrowdVsModel = z.infer<typeof CrowdVsModelSchema>;

export async function fetchTalkingPoint(
  season: string,
  gameweek: number,
): Promise<CrowdVsModel | null> {
  const { data, error } = await supabase()
    .from('gameweek_talking_point')
    .select('*')
    .eq('season', season)
    .eq('gameweek', gameweek)
    .maybeSingle();

  if (error) throw new Error(`fetchTalkingPoint failed: ${error.message}`);
  return data ? CrowdVsModelSchema.parse(data) : null;
}

export async function fetchCrowdForFixture(
  fixtureId: string,
): Promise<CrowdVsModel | null> {
  const { data, error } = await supabase()
    .from('crowd_vs_model')
    .select('*')
    .eq('fixture_id', fixtureId)
    .maybeSingle();

  if (error) throw new Error(`fetchCrowdForFixture failed: ${error.message}`);
  return data ? CrowdVsModelSchema.parse(data) : null;
}

/* ------------------------------------------------------------- formatting */

export function outcomeLabel(
  outcome: Outcome,
  homeShort: string,
  awayShort: string,
): string {
  if (outcome === 'home') return homeShort;
  if (outcome === 'away') return awayShort;
  return 'Draw';
}

export function crowdShare(row: CrowdVsModel, outcome: Outcome): number {
  return outcome === 'home'
    ? row.crowd_home
    : outcome === 'away'
      ? row.crowd_away
      : row.crowd_draw;
}

export function modelShare(row: CrowdVsModel, outcome: Outcome): number {
  return outcome === 'home'
    ? row.model_home
    : outcome === 'away'
      ? row.model_away
      : row.model_draw;
}

/**
 * The headline sentence.
 *
 * §5.6 governs the wording: probabilistic, never assertive, and never claiming
 * a winner before there is a result. The model "said 43%", it did not "know".
 */
export function talkingPointHeadline(row: CrowdVsModel): string {
  const crowdPct = Math.round(crowdShare(row, row.crowd_pick) * 100);
  const modelPct = Math.round(modelShare(row, row.crowd_pick) * 100);
  const pick = outcomeLabel(row.crowd_pick, row.home_short, row.away_short);
  const backed = row.crowd_pick === 'draw' ? 'backed a draw' : `backed ${pick}`;

  return `${crowdPct}% of players ${backed}. The model said ${modelPct}%.`;
}

/** Resolution line, only once a result exists. */
export function talkingPointOutcome(row: CrowdVsModel): string | null {
  if (!row.actual_outcome || row.home_goals === null || row.away_goals === null) {
    return null;
  }
  const score = `${row.home_goals}–${row.away_goals}`;
  const crowdRight = row.crowd_pick === row.actual_outcome;
  const modelRight = row.model_pick === row.actual_outcome;

  if (crowdRight && modelRight) return `It finished ${score}. Both had it.`;
  if (crowdRight) return `It finished ${score}. The crowd had it.`;
  if (modelRight) return `It finished ${score}. The model had it.`;
  return `It finished ${score}. Neither had it.`;
}

/** How divided the crowd was — used to decide whether "the crowd" is a view at all. */
export function crowdConviction(row: CrowdVsModel): 'split' | 'leaning' | 'convinced' {
  const top = Math.max(row.crowd_home, row.crowd_draw, row.crowd_away);
  if (top >= 0.7) return 'convinced';
  if (top >= 0.5) return 'leaning';
  return 'split';
}
