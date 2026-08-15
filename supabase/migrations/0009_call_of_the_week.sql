-- ============================================================================
-- 0009_call_of_the_week.sql — one double-points pick per gameweek
--
-- The retention mechanic these games live on: ten predictions is ten
-- independent coin-flips and nothing to agonise over. One pick that counts
-- double turns the whole card into a single decision the player has to defend
-- on Monday. It is the cheapest possible source of "I knew it" and "I should
-- have gone with my gut".
--
-- NAMING IS A [HARD] CONSTRAINT HERE. §2 forbids "banker", which is what this
-- mechanic is called everywhere else in football. It is a gambling term and it
-- would put the app in front of a 5.3 reviewer for no benefit. Throughout the
-- codebase this is "call of the week" and nothing else.
--
-- THREE THINGS THIS HAS TO GET RIGHT, all of which are exploits if it doesn't:
--
--   1. The model has to play the same rule. Give the user a doubler the model
--      doesn't get and the user wins every week by construction, which
--      destroys the only comparison the product is about. The model's call is
--      its highest-confidence fixture of that gameweek — chosen by the same
--      logic a player would use, and fixed before kick-off because confidence
--      is written at prediction time.
--
--   2. You cannot move it off a match that has already kicked off. Otherwise
--      you flag your safest pick, watch it finish 0-0, and slide the doubler
--      onto something still to play. That is a free re-roll and it is the
--      entire game.
--
--   3. The doubling happens in settlement, server-side, from a column the
--      client cannot forge. Same reasoning as points_awarded.
-- ============================================================================

alter table public.user_predictions
  add column if not exists is_call_of_the_week boolean not null default false;

comment on column public.user_predictions.is_call_of_the_week is
  'One per user per gameweek. Scores double. The name is deliberate: §2 '
  '[HARD] forbids gambling vocabulary anywhere in the product, and that '
  'includes column names and column comments, both of which are readable '
  'through schema introspection. See the header of 0009 for what this is not '
  'called and why.';

-- One per user per gameweek, enforced by moving rather than by erroring.
-- A unique index cannot express this: the gameweek lives on public.fixtures,
-- and an index cannot reach another table.
create or replace function public.enforce_single_call_of_the_week()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season   text;
  v_gameweek smallint;
begin
  if not new.is_call_of_the_week then
    return new;                 -- clearing, or an ordinary prediction
  end if;

  select f.season, f.gameweek into v_season, v_gameweek
  from public.fixtures f
  where f.id = new.fixture_id;

  -- Exploit 2. If the existing call is on a match that has kicked off, its
  -- result is either known or in progress, and moving the doubler off it is a
  -- free re-roll. Refuse rather than silently move.
  if exists (
    select 1
    from public.user_predictions up
    join public.fixtures f on f.id = up.fixture_id
    where up.user_id = new.user_id
      and f.season = v_season
      and f.gameweek = v_gameweek
      and up.fixture_id <> new.fixture_id
      and up.is_call_of_the_week
      and not public.fixture_is_open(up.fixture_id)
  ) then
    raise exception 'call of the week is locked for this gameweek'
      using errcode = '55000';
  end if;

  -- Otherwise move it. The recursive fire of this trigger returns immediately
  -- on the first line, because those rows are being set to false.
  update public.user_predictions up
  set is_call_of_the_week = false
  from public.fixtures f
  where up.fixture_id = f.id
    and up.user_id = new.user_id
    and f.season = v_season
    and f.gameweek = v_gameweek
    and up.fixture_id <> new.fixture_id
    and up.is_call_of_the_week;

  return new;
end;
$$;

drop trigger if exists trg_single_call_of_the_week on public.user_predictions;
create trigger trg_single_call_of_the_week
  before insert or update of is_call_of_the_week on public.user_predictions
  for each row execute function public.enforce_single_call_of_the_week();

-- The client may set the flag. It still may not set points_awarded, settled_at
-- or submitted_at_server — those grants are unchanged from 0002/0008.
grant insert (user_id, fixture_id, outcome, home_goals, away_goals, is_call_of_the_week)
  on public.user_predictions to authenticated;
grant update (user_id, fixture_id, outcome, home_goals, away_goals, is_call_of_the_week)
  on public.user_predictions to authenticated;

-- ------------------------------------------------------------- settlement
-- Doubling is applied here, not in score_prediction(). score_prediction stays
-- a pure function of two scorelines so it can keep being used to score the
-- model, backfills and tests without a user row in scope.

create or replace function public.settle_fixture(p_fixture_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_home    smallint;
  v_away    smallint;
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
        ) * (case when up.is_call_of_the_week then 2 else 1 end),
      settled_at = now()
  where up.fixture_id = p_fixture_id
    and up.settled_at is null;      -- idempotent: re-running settles nothing twice

  get diagnostics v_settled = row_count;
  return v_settled;
end;
$$;

revoke all on function public.settle_fixture(uuid) from public, anon, authenticated;

-- ---------------------------------------------------- the model's own call
-- Exploit 1. The model picks the fixture it is most confident about, which is
-- both the obvious strategy and the one a player is most likely to use, so the
-- comparison stays honest. confidence is written at prediction time, so this
-- cannot drift after kick-off.

create or replace function public.rollup_gameweek(p_season text, p_gameweek smallint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_model_points integer;
  v_model_call   uuid;
  v_rows         integer;
begin
  select p.fixture_id into v_model_call
  from model.predictions p
  join public.fixtures f on f.id = p.fixture_id
  join public.model_versions mv on mv.version = p.model_version and mv.is_active
  where f.season = p_season and f.gameweek = p_gameweek
  -- fixture_id breaks ties deterministically: two fixtures with identical
  -- confidence must not give a different answer on a re-run.
  order by p.confidence desc, p.fixture_id
  limit 1;

  select coalesce(sum(
           public.score_prediction(p.modal_home, p.modal_away, f.home_goals, f.away_goals)
           * (case when p.fixture_id = v_model_call then 2 else 1 end)
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
    -- An exact scoreline is worth 5, or 10 when it was the call of the week.
    -- Counting `= 5` alone silently stopped counting doubled exact scores.
    count(*) filter (where up.points_awarded in (5, 10)),
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

-- ------------------------------------------------- the model's call, exposed
-- Free, deliberately. It is the model committing itself in public before
-- kick-off, which is the whole personality of the product, and it is worth
-- more as a hook than it is as a paywalled field.

create or replace view public.model_call_of_the_week as
select distinct on (f.season, f.gameweek)
  f.season,
  f.gameweek,
  p.fixture_id,
  p.confidence
from model.predictions p
join public.fixtures f on f.id = p.fixture_id
join public.model_versions mv on mv.version = p.model_version and mv.is_active
order by f.season, f.gameweek, p.confidence desc, p.fixture_id;

grant select on public.model_call_of_the_week to anon, authenticated;
