/**
 * User predictions: local state, optimistic writes, server reconciliation.
 *
 * The submit button previously called console.log. Everything else in the app
 * was real — the model, the fixtures, the paywall — and the one action the
 * product exists for went nowhere.
 *
 * Design constraints that shape this:
 *
 *   §2 [HARD] The lock is the database's, not ours. We never decide whether a
 *   prediction is allowed; we send it and interpret the refusal. A user with a
 *   tampered clock changes nothing.
 *
 *   §10 An optimistic write is essential on a phone: a tap that visibly does
 *   nothing for 400ms feels broken. So local state updates immediately and
 *   rolls back if the server disagrees — and the rollback is what makes it
 *   honest rather than a lie that happens to be true most of the time.
 *
 *   §8.4 Streaks depend on gameweeks *submitted*, so "how many of the ten have
 *   I done" is a first-class question, answered here rather than recomputed by
 *   each screen.
 */

import { create } from 'zustand';

import { hasBackend } from '@/api/client';
import { fetchMyPredictions, submitPrediction } from '@/core/predictions';

export type UserPick = {
  fixtureId: string;
  homeGoals: number;
  awayGoals: number;
  /** Present once the match has been settled by the worker. */
  pointsAwarded: number | null;
  /** True while a write is in flight, so the UI can show it is saving. */
  pending: boolean;
};

type State = {
  picks: Record<string, UserPick>;
  loaded: boolean;
  /** Set when a write was refused. Cleared on the next successful write. */
  lastError: string | null;

  load: (fixtureIds: string[]) => Promise<void>;
  submit: (
    fixtureId: string,
    homeGoals: number,
    awayGoals: number,
  ) => Promise<{ ok: boolean; message?: string }>;
  pickFor: (fixtureId: string) => UserPick | undefined;
  countSubmitted: (fixtureIds: string[]) => number;
  clearError: () => void;
};

export const usePredictionStore = create<State>((set, get) => ({
  picks: {},
  loaded: false,
  lastError: null,

  async load(fixtureIds) {
    if (!hasBackend() || fixtureIds.length === 0) {
      set({ loaded: true });
      return;
    }
    try {
      const rows = await fetchMyPredictions(fixtureIds);
      const picks: Record<string, UserPick> = {};
      for (const row of rows) {
        picks[row.fixture_id] = {
          fixtureId: row.fixture_id,
          homeGoals: row.home_goals,
          awayGoals: row.away_goals,
          pointsAwarded: row.points_awarded ?? null,
          pending: false,
        };
      }
      set({ picks, loaded: true });
    } catch (error) {
      // A failed load must not block predicting. Worst case the user re-enters
      // a scoreline they already submitted, and the upsert makes that harmless.
      console.warn('could not load existing predictions', error);
      set({ loaded: true });
    }
  },

  async submit(fixtureId, homeGoals, awayGoals) {
    const previous = get().picks[fixtureId];

    // Optimistic: the row appears before the round trip completes.
    set((s) => ({
      picks: {
        ...s.picks,
        [fixtureId]: {
          fixtureId,
          homeGoals,
          awayGoals,
          pointsAwarded: previous?.pointsAwarded ?? null,
          pending: true,
        },
      },
      lastError: null,
    }));

    const result = await submitPrediction({ fixtureId, homeGoals, awayGoals });

    if (result.ok) {
      set((s) => ({
        picks: {
          ...s.picks,
          [fixtureId]: { ...s.picks[fixtureId]!, pending: false },
        },
      }));
      return { ok: true };
    }

    // Roll back to exactly what was there before, including nothing at all.
    set((s) => {
      const picks = { ...s.picks };
      if (previous) picks[fixtureId] = previous;
      else delete picks[fixtureId];
      return { picks, lastError: result.message };
    });

    return { ok: false, message: result.message };
  },

  pickFor(fixtureId) {
    return get().picks[fixtureId];
  },

  countSubmitted(fixtureIds) {
    const { picks } = get();
    return fixtureIds.filter((id) => picks[id] && !picks[id]!.pending).length;
  },

  clearError() {
    set({ lastError: null });
  },
}));
