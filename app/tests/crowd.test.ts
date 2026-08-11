/**
 * Crowd vs model copy and formatting.
 *
 * §5.6 is [HARD]-adjacent and the easiest rule in the spec to break by
 * accident: it is very tempting to write "the model knew" or "Arsenal were
 * always winning that". These tests pin the wording so a future edit cannot
 * quietly turn a probabilistic statement into an assertive one.
 */

import { describe, expect, it } from 'vitest';

import {
  crowdConviction,
  crowdShare,
  modelShare,
  outcomeLabel,
  talkingPointHeadline,
  talkingPointOutcome,
  type CrowdVsModel,
} from '../src/core/crowd';

function row(overrides: Partial<CrowdVsModel> = {}): CrowdVsModel {
  return {
    fixture_id: 'f1',
    season: '2026-27',
    gameweek: 1,
    home_name: 'Arsenal',
    home_short: 'ARS',
    away_name: 'Coventry City',
    away_short: 'COV',
    status: 'finished',
    home_goals: 1,
    away_goals: 1,
    n_predictions: 240,
    crowd_home: 0.81,
    crowd_draw: 0.13,
    crowd_away: 0.06,
    crowd_scoreline: '2-0',
    model_home: 0.43,
    model_draw: 0.31,
    model_away: 0.26,
    disagreement: 0.38,
    crowd_pick: 'home',
    model_pick: 'home',
    actual_outcome: 'draw',
    ...overrides,
  };
}

describe('headline', () => {
  it('states both figures without claiming either is right', () => {
    expect(talkingPointHeadline(row())).toBe(
      '81% of players backed ARS. The model said 43%.',
    );
  });

  it('reads naturally when the crowd backed a draw', () => {
    const r = row({ crowd_pick: 'draw', crowd_draw: 0.55, model_draw: 0.29 });
    expect(talkingPointHeadline(r)).toBe(
      '55% of players backed a draw. The model said 29%.',
    );
  });

  it('never uses assertive language (§5.6)', () => {
    const forbidden = /\b(will win|knew|nailed|certain|guaranteed|sure thing)\b/i;
    for (const pick of ['home', 'draw', 'away'] as const) {
      expect(talkingPointHeadline(row({ crowd_pick: pick }))).not.toMatch(forbidden);
    }
  });
});

describe('resolution line', () => {
  it('is withheld until the match has finished', () => {
    expect(
      talkingPointOutcome(row({ actual_outcome: null, home_goals: null, away_goals: null })),
    ).toBeNull();
  });

  it('credits the model when only the model was right', () => {
    const r = row({ crowd_pick: 'home', model_pick: 'draw', actual_outcome: 'draw' });
    expect(talkingPointOutcome(r)).toBe('It finished 1–1. The model had it.');
  });

  it('credits the crowd when only the crowd was right', () => {
    const r = row({ crowd_pick: 'draw', model_pick: 'home', actual_outcome: 'draw' });
    expect(talkingPointOutcome(r)).toBe('It finished 1–1. The crowd had it.');
  });

  it('says neither when neither was right', () => {
    const r = row({ crowd_pick: 'home', model_pick: 'home', actual_outcome: 'away' });
    expect(talkingPointOutcome(r)).toBe('It finished 1–1. Neither had it.');
  });

  it('says both when both were right', () => {
    const r = row({ crowd_pick: 'draw', model_pick: 'draw', actual_outcome: 'draw' });
    expect(talkingPointOutcome(r)).toBe('It finished 1–1. Both had it.');
  });

  it('does not gloat on the model’s behalf (§5.6)', () => {
    const forbidden = /\b(told you|obviously|as expected|easy|of course)\b/i;
    const r = row({ crowd_pick: 'home', model_pick: 'draw', actual_outcome: 'draw' });
    expect(talkingPointOutcome(r)).not.toMatch(forbidden);
  });
});

describe('share lookups', () => {
  it('reads the right column per outcome', () => {
    const r = row();
    expect(crowdShare(r, 'home')).toBe(0.81);
    expect(crowdShare(r, 'draw')).toBe(0.13);
    expect(crowdShare(r, 'away')).toBe(0.06);
    expect(modelShare(r, 'home')).toBe(0.43);
    expect(modelShare(r, 'away')).toBe(0.26);
  });

  it('labels outcomes with the right club', () => {
    expect(outcomeLabel('home', 'ARS', 'COV')).toBe('ARS');
    expect(outcomeLabel('away', 'ARS', 'COV')).toBe('COV');
    expect(outcomeLabel('draw', 'ARS', 'COV')).toBe('Draw');
  });
});

describe('crowd conviction', () => {
  it('classifies a near-unanimous crowd', () => {
    expect(crowdConviction(row({ crowd_home: 0.81 }))).toBe('convinced');
  });

  it('classifies a leaning crowd', () => {
    expect(
      crowdConviction(row({ crowd_home: 0.55, crowd_draw: 0.25, crowd_away: 0.2 })),
    ).toBe('leaning');
  });

  it('classifies a split crowd', () => {
    expect(
      crowdConviction(row({ crowd_home: 0.4, crowd_draw: 0.33, crowd_away: 0.27 })),
    ).toBe('split');
  });

  it('never calls a three-way split convinced', () => {
    const third = 1 / 3;
    expect(
      crowdConviction(row({ crowd_home: third, crowd_draw: third, crowd_away: third })),
    ).toBe('split');
  });
});
