-- ============================================================================
-- 0008_fix_upsert_grants.sql — make prediction submission actually possible
--
-- 0002_rls.sql granted UPDATE on only (outcome, home_goals, away_goals),
-- reasoning that user_id and fixture_id are identity and should never move.
-- Correct in principle, wrong in practice: PostgREST implements upsert as
--
--     INSERT ... ON CONFLICT (user_id, fixture_id)
--     DO UPDATE SET user_id = ..., fixture_id = ..., outcome = ..., ...
--
-- The conflict columns appear in the SET clause, so the write needed UPDATE
-- permission on them and got "permission denied for table user_predictions".
-- Every submission failed. The client had no way to tell that apart from any
-- other RLS refusal, so it reported the match as locked.
--
-- WHY WIDENING THE GRANT IS SAFE
--
-- The column grants were never the security boundary — the RLS policies are,
-- and they are unchanged:
--
--   user_id   the UPDATE policy's WITH CHECK requires user_id = auth.uid(),
--             so a user can only ever set it back to themselves.
--   fixture_id WITH CHECK requires fixture_is_open(fixture_id), so it can only
--             point at a match that has not kicked off — and moving a
--             prediction between two open fixtures is something a user could
--             already do with a delete and an insert.
--
-- What stays ungranted is what actually matters: points_awarded, settled_at
-- and submitted_at_server remain server-owned, so a client still cannot award
-- itself points or backdate a submission past kickoff (§2 [HARD]).
-- ============================================================================

grant update (user_id, fixture_id, outcome, home_goals, away_goals)
  on public.user_predictions to authenticated;

-- Restated so this file documents the full picture rather than a diff:
-- these three columns are deliberately absent from every grant.
comment on column public.user_predictions.points_awarded is
  'Server-owned. No client grant — written only by public.settle_fixture().';
comment on column public.user_predictions.submitted_at_server is
  'Server-owned. No client grant — defaults to now() so a tampered device '
  'clock cannot backdate a submission past kickoff (§2 [HARD]).';
comment on column public.user_predictions.settled_at is
  'Server-owned. No client grant — set by settlement, and its null-ness is '
  'what makes settle_fixture idempotent.';
