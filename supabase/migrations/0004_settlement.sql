-- ============================================================================
-- 0004_settlement.sql — scoring, settlement, streaks, push tokens
--
-- CLAUDE.md §6.1 requires "you vs model, points, streak" but never defines the
-- points system. It is defined here, and ONLY here.
--
-- Scoring would otherwise need to exist in three places — the Python settlement
-- job, SQL queries for the leaderboard, and TypeScript for display. Three
-- copies of a rule is three chances for them to disagree, and a scoring
-- disagreement in a competitive game is the bug users never forgive. So the
-- rule is a Postgres function: Python calls it, SQL uses it, TypeScript only
-- ever renders a number the server computed.
-- ============================================================================

-- The model's own scoreline pick, so it can be scored on exactly the same
-- terms as a user. Derived from the score matrix at prediction time.
alter table model.predictions
  add column if not exists modal_home smallint,
  add column if not exists modal_away smallint;

comment on column model.predictions.modal_home is
  'Most likely scoreline. Scoring the model on a single draw from its own '
  'distribution understates it — a 2-0 at 11.3%% is not a confident claim — '
  'but it is the only like-for-like comparison with a user, and the game '
  'depends on that comparison being obviously fair.';

-- ---------------------------------------------------------------- scoring

create or replace function public.score_prediction(
  pred_home   smallint,
  pred_away   smallint,
  actual_home smallint,
  actual_away smallint
) returns smallint
language sql
immutable
parallel safe
as $$
  select case
    -- Exact scoreline.
    when pred_home = actual_home and pred_away = actual_away then 5::smallint
    -- Right outcome, wrong score.
    when sign(pred_home - pred_away) = sign(actual_home - actual_away) then 2::smallint
    else 0::smallint
  end;
$$;

comment on function public.score_prediction is
  '5 for the exact scoreline, 2 for the right outcome, 0 otherwise. '
  'The gap between 5 and 2 is deliberately large: predicting 3-0 over 2-0 is '
  'a real call and should pay, but outcome must stay the dominant term or the '
  'game becomes a lottery and casual players stop competing.';

-- ------------------------------------------------------------- settlement

create or replace function public.settle_fixture(p_fixture_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_home smallint;
  v_away smallint;
  v_settled integer;
begin
  select home_goals, away_goals into v_home, v_away
  from public.fixtures
  where id = p_fixture_id and status = 'finished';

  if v_home is null or v_away is null then
    return 0;   -- not finished, or finished with no score. Never guess.
  end if;

  update public.user_predictions up
  set points_awarded = public.score_prediction(
        up.home_goals, up.away_goals, v_home, v_away
      ),
      settled_at = now()
  where up.fixture_id = p_fixture_id
    and up.settled_at is null;      -- idempotent: re-running settles nothing twice

  get diagnostics v_settled = row_count;
  return v_settled;
end;
$$;

revoke all on function public.settle_fixture(uuid) from public, anon, authenticated;

-- --------------------------------------------------- per-gameweek rollup

create table if not exists public.gameweek_scores (
  user_id          uuid not null references public.users(id) on delete cascade,
  season           text not null,
  gameweek         smallint not null,
  user_points      integer not null default 0,
  model_points     integer not null default 0,
  predictions_made smallint not null default 0,
  exact_scores     smallint not null default 0,
  correct_outcomes smallint not null default 0,
  settled_at       timestamptz not null default now(),
  primary key (user_id, season, gameweek)
);

alter table public.gameweek_scores enable row level security;

create policy gameweek_scores_select_own on public.gameweek_scores
  for select to authenticated using (user_id = auth.uid());

revoke all on public.gameweek_scores from anon, authenticated;
grant select on public.gameweek_scores to authenticated;
-- No write grant: server-owned, like points_awarded.

create or replace function public.rollup_gameweek(p_season text, p_gameweek smallint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_model_points integer;
  v_rows integer;
begin
  -- The model plays the same gameweek on the same rules.
  select coalesce(sum(
           public.score_prediction(p.modal_home, p.modal_away, f.home_goals, f.away_goals)
         ), 0)
  into v_model_points
  from model.predictions p
  join public.fixtures f on f.id = p.fixture_id
  join public.model_versions mv on mv.version = p.model_version and mv.is_active
  where f.season = p_season and f.gameweek = p_gameweek and f.status = 'finished';

  insert into public.gameweek_scores as gs
    (user_id, season, gameweek, user_points, model_points,
     predictions_made, exact_scores, correct_outcomes)
  select
    up.user_id,
    p_season,
    p_gameweek,
    coalesce(sum(up.points_awarded), 0),
    v_model_points,
    count(*),
    count(*) filter (where up.points_awarded = 5),
    count(*) filter (where up.points_awarded >= 2)
  from public.user_predictions up
  join public.fixtures f on f.id = up.fixture_id
  where f.season = p_season
    and f.gameweek = p_gameweek
    and up.settled_at is not null
  group by up.user_id
  on conflict (user_id, season, gameweek) do update set
    user_points      = excluded.user_points,
    model_points     = excluded.model_points,
    predictions_made = excluded.predictions_made,
    exact_scores     = excluded.exact_scores,
    correct_outcomes = excluded.correct_outcomes,
    settled_at       = now();

  get diagnostics v_rows = row_count;

  -- Season totals follow from the rollup, so they can never drift from it.
  update public.users u
  set total_points = coalesce((
        select sum(g.user_points) from public.gameweek_scores g where g.user_id = u.id
      ), 0)
  where u.id in (
    select user_id from public.gameweek_scores
    where season = p_season and gameweek = p_gameweek
  );

  return v_rows;
end;
$$;

revoke all on function public.rollup_gameweek(text, smallint) from public, anon, authenticated;

-- ------------------------------------------------------------- streaks
-- §8.4: "consecutive gameweeks with predictions submitted" — participation,
-- not accuracy. A streak you lose by being wrong punishes playing; a streak
-- you lose by not turning up is what actually drives the weekly return.

create or replace function public.recompute_streaks(p_season text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  with played as (
    select user_id, gameweek,
           gameweek - row_number() over (partition by user_id order by gameweek) as grp
    from public.gameweek_scores
    where season = p_season and predictions_made > 0
  ),
  runs as (
    select user_id, grp, count(*) as run_length, max(gameweek) as last_gameweek
    from played group by user_id, grp
  ),
  latest as (
    select user_id, max(gameweek) as max_gw from played group by user_id
  ),
  summary as (
    select r.user_id,
           max(r.run_length) as best_run,
           coalesce(max(r.run_length) filter (where r.last_gameweek = l.max_gw), 0) as current_run
    from runs r join latest l on l.user_id = r.user_id
    group by r.user_id
  )
  update public.users u
  set streak_current = s.current_run,
      streak_best    = greatest(u.streak_best, s.best_run)
  from summary s
  where u.id = s.user_id;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.recompute_streaks(text) from public, anon, authenticated;

-- --------------------------------------------------------- push tokens

create table if not exists public.push_tokens (
  user_id    uuid not null references public.users(id) on delete cascade,
  token      text not null,
  platform   text not null default 'ios',
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

alter table public.push_tokens enable row level security;

create policy push_tokens_own on public.push_tokens
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.push_tokens from anon, authenticated;
grant select, insert, update, delete on public.push_tokens to authenticated;

-- ----------------------------------------- account deletion (§9.3 [HARD])
-- Apple requires in-app account deletion wherever accounts can be created.
-- Deleting the auth.users row cascades through every table via the FKs
-- declared in 0001_init.sql, so there is no list of tables to keep in sync.

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

grant execute on function public.delete_own_account() to authenticated;

-- ------------------------------------------- results view for the client

create or replace view public.my_gameweek_results as
select
  gs.season,
  gs.gameweek,
  gs.user_points,
  gs.model_points,
  gs.predictions_made,
  gs.exact_scores,
  gs.correct_outcomes,
  (gs.user_points > gs.model_points) as beat_model,
  gs.settled_at
from public.gameweek_scores gs
where gs.user_id = auth.uid();

grant select on public.my_gameweek_results to authenticated;
