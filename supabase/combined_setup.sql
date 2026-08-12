-- ============================================================================
-- COMBINED SETUP  --  paste this whole file into the Supabase SQL Editor once.
--
-- This is every migration in supabase/migrations/ concatenated in order.
-- It is generated, not hand-maintained: regenerate with the snippet in
-- docs/SETUP.md if the migrations change. The individual files remain the
-- source of truth (CI applies those, and the test suite parses those).
--
-- Wrapped in a single transaction: if any statement fails, NOTHING is applied.
-- That is what you want for a first run - a half-applied schema is far worse
-- to recover from than a clean error.
-- ============================================================================

begin;


-- ==========================================================================
-- FILE: 0001_init.sql
-- ==========================================================================

-- ============================================================================
-- 0001_init.sql — core schema
--
-- Design notes (departures from CLAUDE.md §4.3, all deliberate):
--   [1] model.predictions lives OUTSIDE the PostgREST-exposed `public` schema.
--       §9.2 requires premium data be ABSENT from the response, not hidden. If
--       the table sat in `public` with a read policy, any client could bypass
--       the gated view and select it directly. See 0003_views.sql.
--   [2] external_refs maps provider IDs -> internal UUIDs. §4.1 says "you will
--       change provider at some point". With provider IDs as PKs that swap is a
--       mid-season data migration; this makes it an INSERT.
--   [3] probs_sum_to_one is a CHECK, not just a pytest. A test catches it in CI;
--       a constraint stops a broken 02:15 UTC model run writing garbage to prod
--       while you are asleep.
--   [4] There is no user_predictions.locked column. A stored boolean needs a
--       cron job to flip it, and that job racing kickoff is a real exploit
--       window. Lock is DERIVED from fixtures.kickoff_utc inside RLS. See 0002.
--   [5] No users.apple_sub — Supabase already holds it in auth.users.
--       Duplicating it is needless PII surface against §9.3.
-- ============================================================================

create extension if not exists pgcrypto;

create schema if not exists model;

create type public.fixture_status   as enum ('scheduled','live','finished','postponed','cancelled');
create type public.match_outcome    as enum ('home','draw','away');
create type public.entitlement_tier as enum ('free','premium');
create type public.entity_kind      as enum ('team','fixture');

-- ---------------------------------------------------------------- reference

create table public.teams (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  name            text not null,
  short_name      text not null check (char_length(short_name) between 2 and 3),
  primary_color   text not null check (primary_color   ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text not null check (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  founded         smallint,
  stadium         text
);

comment on column public.teams.primary_color is
  'Drives the §7.4 generated team mark. No crests, ever — see §2 [HARD].';

-- [2] provider-agnostic ID mapping
create table public.external_refs (
  provider    text               not null,
  entity_kind public.entity_kind not null,
  entity_id   uuid               not null,
  provider_id text               not null,
  primary key (provider, entity_kind, provider_id)
);
create index external_refs_entity_idx on public.external_refs (entity_kind, entity_id);

create table public.fixtures (
  id           uuid primary key default gen_random_uuid(),
  season       text not null,                                    -- '2026-27'
  gameweek     smallint not null check (gameweek between 1 and 38),
  home_team_id uuid not null references public.teams(id),
  away_team_id uuid not null references public.teams(id),
  kickoff_utc  timestamptz not null,
  status       public.fixture_status not null default 'scheduled',
  home_goals   smallint check (home_goals >= 0),
  away_goals   smallint check (away_goals >= 0),
  home_xg      numeric(5,3),
  away_xg      numeric(5,3),
  minute       smallint,
  updated_at   timestamptz not null default now(),
  constraint fixtures_teams_differ check (home_team_id <> away_team_id),
  unique (season, home_team_id, away_team_id)
);
create index fixtures_kickoff_idx on public.fixtures (kickoff_utc);
create index fixtures_gw_idx      on public.fixtures (season, gameweek, kickoff_utc);

create table public.team_ratings (
  team_id    uuid not null references public.teams(id) on delete cascade,
  as_of_date date not null,
  attack     numeric(6,4) not null,
  defence    numeric(6,4) not null,
  elo        numeric(7,2) not null,
  form_index numeric(6,4),
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  primary key (team_id, as_of_date)
);

-- ---------------------------------------------------------------- model

create table public.model_versions (
  version      text primary key,
  is_active    boolean not null default false,
  activated_at timestamptz,
  notes        text
);
create unique index model_versions_single_active
  on public.model_versions (is_active) where is_active;

create table model.predictions (
  fixture_id       uuid not null references public.fixtures(id) on delete cascade,
  model_version    text not null references public.model_versions(version),
  p_home           numeric(5,4) not null check (p_home between 0 and 1),
  p_draw           numeric(5,4) not null check (p_draw between 0 and 1),
  p_away           numeric(5,4) not null check (p_away between 0 and 1),
  exp_home_goals   numeric(5,3) not null,
  exp_away_goals   numeric(5,3) not null,
  scoreline_matrix jsonb        not null,     -- 8x8 row-major, §5.1
  p_btts           numeric(5,4) not null,
  p_over_25        numeric(5,4) not null,
  p_home_cs        numeric(5,4) not null,
  p_away_cs        numeric(5,4) not null,
  confidence       numeric(4,3) not null check (confidence between 0 and 1),
  -- drives the honest "early season, limited data" copy required by §5.4/§5.6
  data_regime      text not null check (data_regime in ('prior_heavy','blended','current')),
  generated_at     timestamptz  not null default now(),
  primary key (fixture_id, model_version),
  constraint probs_sum_to_one check (abs((p_home + p_draw + p_away) - 1) < 0.0005)  -- [3]
);

create table model.model_performance (
  model_version      text not null references public.model_versions(version),
  season             text not null,
  gameweek           smallint not null,
  brier_score        numeric(6,5) not null,
  log_loss           numeric(6,5) not null,
  accuracy           numeric(5,4) not null,
  n_matches          smallint not null,
  vs_market_baseline numeric(7,5),   -- §5.5 — server-side only, NEVER rendered
  computed_at        timestamptz not null default now(),
  primary key (model_version, season, gameweek)
);

comment on column model.model_performance.vs_market_baseline is
  '§2 [HARD]: derived from de-vigged closing odds. Must never reach a client.';

-- ---------------------------------------------------------------- users

create table public.users (
  id                     uuid primary key references auth.users(id) on delete cascade,
  display_name           text not null,
  favourite_team_id      uuid references public.teams(id),
  entitlement            public.entitlement_tier not null default 'free',
  entitlement_expires_at timestamptz,
  rc_app_user_id         text unique,
  streak_current         smallint not null default 0,
  streak_best            smallint not null default 0,
  total_points           integer  not null default 0,
  notification_prefs     jsonb    not null default
    '{"gw_open":true,"lock_soon":true,"weekly_wrap":true}'::jsonb,
  created_at             timestamptz not null default now()
);

create table public.user_predictions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id) on delete cascade,
  fixture_id          uuid not null references public.fixtures(id) on delete cascade,
  outcome             public.match_outcome not null,
  home_goals          smallint not null check (home_goals between 0 and 20),
  away_goals          smallint not null check (away_goals between 0 and 20),
  submitted_at_server timestamptz not null default now(),   -- §2 [HARD] server time
  points_awarded      smallint,
  settled_at          timestamptz,
  unique (user_id, fixture_id),
  constraint outcome_matches_scoreline check (
    (outcome = 'home' and home_goals >  away_goals) or
    (outcome = 'draw' and home_goals =  away_goals) or
    (outcome = 'away' and home_goals <  away_goals)
  )
);
create index user_predictions_user_idx on public.user_predictions (user_id, fixture_id);

-- §9.2 structured audit log. No RLS policies => service_role only.
create table public.entitlement_events (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.users(id) on delete set null,
  rc_event_id text unique,              -- idempotency for RevenueCat retries
  event_type  text not null,
  entitlement public.entitlement_tier,
  expires_at  timestamptz,
  raw         jsonb not null,
  received_at timestamptz not null default now()
);

-- v1.1 (§6.2). Defined now so there is no migration mid-season.
create table public.leagues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 40),
  invite_code text not null unique,
  owner_id    uuid not null references public.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);
create table public.league_members (
  league_id uuid references public.leagues(id) on delete cascade,
  user_id   uuid references public.users(id)   on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

-- ------------------------------------------------- signup: auto display name
-- Open decision #4: auto-generated names keep the global leaderboard out of
-- Guideline 1.2 UGC territory entirely (no filtering/reporting/blocking duty).
-- Custom names ship in v1.1 with real moderation.

create or replace function public.generate_display_name()
returns text language sql volatile as $$
  select (array['Quiet','Sharp','Late','Cold','Steady','Blunt','Wry','Lone',
                'Bold','Dry','Terse','Calm'])[1 + floor(random()*12)]
      || ' '
      || (array['Chevron','Hoop','Halves','Stripe','Diagonal','Crest','Pivot',
                'Wedge','Column','Arc','Band','Split'])[1 + floor(random()*12)]
      || ' '
      || lpad((floor(random()*100))::int::text, 2, '0');
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, display_name)
  values (new.id, public.generate_display_name())
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------- updated_at maintenance

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger fixtures_touch_updated_at
  before update on public.fixtures
  for each row execute function public.touch_updated_at();

-- ==========================================================================
-- FILE: 0002_rls.sql
-- ==========================================================================

-- ============================================================================
-- 0002_rls.sql — default deny, then explicit grants
--
-- §9.2 [HARD]: RLS on every table containing user data. Default deny.
-- §2  [HARD]: prediction lock uses server time, enforced in the DATABASE
--             policy — not application code. A user with a tampered device
--             clock cannot submit after kickoff because now() is Postgres's.
-- ============================================================================

alter table public.teams              enable row level security;
alter table public.fixtures           enable row level security;
alter table public.team_ratings       enable row level security;
alter table public.model_versions     enable row level security;
alter table public.external_refs      enable row level security;
alter table public.users              enable row level security;
alter table public.user_predictions   enable row level security;
alter table public.entitlement_events enable row level security;
alter table public.leagues            enable row level security;
alter table public.league_members     enable row level security;
alter table model.predictions         enable row level security;
alter table model.model_performance   enable row level security;

-- ---------------------------------------------------------------- helpers
-- SECURITY DEFINER so policies can read rows the calling user cannot.
-- search_path pinned to defeat search_path hijacking.

create or replace function public.fixture_is_open(f uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fixtures
    where id = f
      and status = 'scheduled'
      and now() < kickoff_utc          -- server time. never a client value.
  );
$$;

create or replace function public.is_entitled()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users
    where id = auth.uid()
      and entitlement = 'premium'
      and (entitlement_expires_at is null or entitlement_expires_at > now())
  );
$$;

create or replace function public.is_league_member(l uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.league_members
    where league_id = l and user_id = auth.uid()
  );
$$;

revoke all on function public.fixture_is_open(uuid)   from public;
revoke all on function public.is_entitled()           from public;
revoke all on function public.is_league_member(uuid)  from public;
grant execute on function public.fixture_is_open(uuid)  to authenticated;
grant execute on function public.is_entitled()          to authenticated;
grant execute on function public.is_league_member(uuid) to authenticated;

-- ------------------------------------------------------ public reference data

create policy teams_read    on public.teams          for select to anon, authenticated using (true);
create policy fixtures_read on public.fixtures       for select to anon, authenticated using (true);
create policy ratings_read  on public.team_ratings   for select to anon, authenticated using (true);
create policy versions_read on public.model_versions for select to anon, authenticated using (true);

-- external_refs / entitlement_events: intentionally NO policies.
-- model.predictions / model.model_performance: intentionally NO policies AND
-- the `model` schema is not exposed to PostgREST. Reachable only via the
-- gated views in 0003_views.sql.

-- ------------------------------------------------------------------- users
-- Own row only, and only three columns are ever client-writable.

create policy users_select_own on public.users for select to authenticated
  using (id = auth.uid());

create policy users_update_own on public.users for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

revoke all on public.users from anon, authenticated;
grant select on public.users to authenticated;
grant update (display_name, favourite_team_id, notification_prefs)
  on public.users to authenticated;
-- No INSERT grant: rows are created by the on_auth_user_created trigger.
-- No grant on entitlement / total_points / streaks — server-owned. A client
-- cannot award itself premium or points even with a forged request.

-- --------------------------------------------------------- user_predictions
-- THE LOCK.

create policy up_select_own on public.user_predictions for select to authenticated
  using (user_id = auth.uid());

create policy up_insert_before_kickoff on public.user_predictions for insert to authenticated
  with check (user_id = auth.uid() and public.fixture_is_open(fixture_id));

create policy up_update_before_kickoff on public.user_predictions for update to authenticated
  using      (user_id = auth.uid() and public.fixture_is_open(fixture_id))
  with check (user_id = auth.uid() and public.fixture_is_open(fixture_id));

create policy up_delete_before_kickoff on public.user_predictions for delete to authenticated
  using (user_id = auth.uid() and public.fixture_is_open(fixture_id));

-- Column-level grants: the client PHYSICALLY CANNOT write server-owned fields.
-- submitted_at_server falls back to its default now(); points_awarded and
-- settled_at are writable only by the settlement job (service_role, which
-- bypasses RLS and column grants).
revoke all on public.user_predictions from anon, authenticated;
grant select on public.user_predictions to authenticated;
grant insert (user_id, fixture_id, outcome, home_goals, away_goals)
  on public.user_predictions to authenticated;
grant update (outcome, home_goals, away_goals)
  on public.user_predictions to authenticated;
grant delete on public.user_predictions to authenticated;

-- --------------------------------------------------------------- leagues
-- v1.1. Helper functions avoid the leagues <-> league_members policy recursion.

create policy leagues_read_member on public.leagues for select to authenticated
  using (owner_id = auth.uid() or public.is_league_member(id));

create policy members_read on public.league_members for select to authenticated
  using (public.is_league_member(league_id));

-- ==========================================================================
-- FILE: 0003_views.sql
-- ==========================================================================

-- ============================================================================
-- 0003_views.sql — the free/premium boundary
--
-- §9.2 [HARD]: "Premium data must be ABSENT from the response, not hidden in
-- the UI." These are SECURITY DEFINER views (the Postgres default for views)
-- over the unexposed `model` schema. An unentitled user querying
-- predictions_premium gets ZERO ROWS — not nulls, not masked fields, nothing.
-- There is no other door: `model` is not in PostgREST's exposed schemas.
-- ============================================================================

-- FREE (§8.1): headline pick + confidence. No probabilities in this payload.
create view public.predictions_free as
select
  p.fixture_id,
  p.model_version,
  (case
     when p.p_home >= greatest(p.p_draw, p.p_away) then 'home'
     when p.p_away >= greatest(p.p_home, p.p_draw) then 'away'
     else 'draw'
   end)::public.match_outcome as headline_pick,
  p.confidence,
  p.data_regime,
  p.generated_at
from model.predictions p
join public.model_versions mv
  on mv.version = p.model_version and mv.is_active;

-- PREMIUM (§8.1): the full §5.1 output. Zero rows if not entitled.
create view public.predictions_premium as
select
  p.fixture_id,       p.model_version,
  p.p_home,           p.p_draw,        p.p_away,
  p.exp_home_goals,   p.exp_away_goals,
  p.scoreline_matrix,
  p.p_btts,           p.p_over_25,
  p.p_home_cs,        p.p_away_cs,
  p.confidence,       p.data_regime,   p.generated_at
from model.predictions p
join public.model_versions mv
  on mv.version = p.model_version and mv.is_active
where public.is_entitled();

-- FREE: season headline only.
create view public.accuracy_summary as
select
  mp.season,
  sum(mp.n_matches)   as n_matches,
  avg(mp.brier_score) as brier_score,
  avg(mp.accuracy)    as accuracy
from model.model_performance mp
join public.model_versions mv
  on mv.version = mp.model_version and mv.is_active
group by mp.season;

-- PREMIUM: per-gameweek history + the §5.5 reliability data.
-- vs_market_baseline is deliberately NOT selected — §2 [HARD].
create view public.accuracy_history as
select
  mp.season, mp.gameweek, mp.brier_score, mp.log_loss,
  mp.accuracy, mp.n_matches
from model.model_performance mp
join public.model_versions mv
  on mv.version = mp.model_version and mv.is_active
where public.is_entitled();

-- Exposes only rank/name/points — never a whole users row.
create view public.leaderboard as
select
  rank() over (order by u.total_points desc, u.created_at asc) as rank,
  u.id,
  u.display_name,
  u.total_points,
  u.streak_current
from public.users u
where u.total_points > 0;

grant select on public.predictions_free    to anon, authenticated;
grant select on public.accuracy_summary    to anon, authenticated;
grant select on public.leaderboard         to anon, authenticated;
grant select on public.predictions_premium to authenticated;
grant select on public.accuracy_history    to authenticated;

-- ==========================================================================
-- FILE: 0004_settlement.sql
-- ==========================================================================

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

-- ==========================================================================
-- FILE: 0005_multi_season.sql
-- ==========================================================================

-- ============================================================================
-- 0005_multi_season.sql — make the app survive past its first season
--
-- The original schema handled one season correctly and would have degraded
-- quietly in August 2027: leaderboards accumulating forever, streaks broken by
-- the summer, and no way to tell a promoted club's placeholder colours from
-- real ones. This migration is what turns a season-long app into a yearly one.
-- ============================================================================

-- Set when a club was auto-seeded because it was not in team-colours.json.
-- Three clubs are promoted every summer; ingest now seeds them with stable
-- generated colours rather than failing on opening weekend. This column is how
-- you find them afterwards.
alter table public.teams
  add column if not exists colours_provisional boolean not null default false;

comment on column public.teams.colours_provisional is
  'True = colours were generated from the slug hash, not catalogued. Query '
  'this every August: select name from public.teams where colours_provisional;';

-- --------------------------------------------------------- season registry

create table if not exists public.seasons (
  label      text primary key,          -- '2026-27'
  start_year smallint not null,
  is_current boolean not null default false,
  started_at date,
  ended_at   date
);

-- Exactly one current season, enforced rather than assumed.
create unique index if not exists seasons_single_current
  on public.seasons (is_current) where is_current;

alter table public.seasons enable row level security;
create policy seasons_read on public.seasons
  for select to anon, authenticated using (true);

-- ------------------------------------------------- season-scoped standings
-- users.total_points is a CAREER total and stays that way — a multi-year app
-- wants "best ever" as well as "this season". But the competitive leaderboard
-- must be per-season, or someone who joined in year one is permanently ahead
-- of a better player who joined in year three, and the ladder stops meaning
-- anything to new users. That is how yearly games die.

create or replace view public.season_standings as
select
  gs.season,
  gs.user_id,
  u.display_name,
  sum(gs.user_points)                                as points,
  sum(gs.model_points)                               as model_points,
  sum(gs.predictions_made)                           as predictions_made,
  sum(gs.exact_scores)                               as exact_scores,
  count(*) filter (where gs.user_points > gs.model_points) as gameweeks_beating_model,
  count(*)                                           as gameweeks_played,
  rank() over (
    partition by gs.season
    order by sum(gs.user_points) desc, min(u.created_at) asc
  )                                                  as rank
from public.gameweek_scores gs
join public.users u on u.id = gs.user_id
group by gs.season, gs.user_id, u.display_name;

grant select on public.season_standings to anon, authenticated;

-- Career view: the long-run identity that makes year three worth playing.
create or replace view public.career_standings as
select
  gs.user_id,
  u.display_name,
  count(distinct gs.season)                          as seasons_played,
  sum(gs.user_points)                                as career_points,
  sum(gs.exact_scores)                               as career_exact_scores,
  count(*) filter (where gs.user_points > gs.model_points) as career_beats,
  count(*)                                           as career_gameweeks,
  max(gs.user_points)                                as best_gameweek,
  u.streak_best
from public.gameweek_scores gs
join public.users u on u.id = gs.user_id
group by gs.user_id, u.display_name, u.streak_best;

grant select on public.career_standings to anon, authenticated;

create or replace view public.my_career as
select * from public.career_standings where user_id = auth.uid();

grant select on public.my_career to authenticated;

-- ------------------------------------------------------------- rollover
-- Streaks are WITHIN a season. A streak that survived the summer would be
-- meaningless (nobody predicted anything for ten weeks), and one that broke on
-- 1 July would punish players for the fixture calendar. Best-ever is career.

create or replace function public.begin_season(p_label text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.seasons set is_current = false, ended_at = coalesce(ended_at, current_date)
  where is_current and label <> p_label;

  insert into public.seasons (label, start_year, is_current, started_at)
  values (p_label, split_part(p_label, '-', 1)::smallint, true, current_date)
  on conflict (label) do update set is_current = true, started_at = current_date;

  -- Reset the in-season streak; leave streak_best (career) untouched.
  update public.users set streak_current = 0 where streak_current <> 0;
end;
$$;

revoke all on function public.begin_season(text) from public, anon, authenticated;

-- Replaces the career-total leaderboard from 0003 with the season-scoped one.
drop view if exists public.leaderboard;

create or replace view public.leaderboard as
select s.rank, s.user_id as id, s.display_name, s.points as total_points,
       u.streak_current, s.season
from public.season_standings s
join public.users u on u.id = s.user_id
join public.seasons se on se.label = s.season and se.is_current;

grant select on public.leaderboard to anon, authenticated;

-- ==========================================================================
-- FILE: 0006_crowd.sql
-- ==========================================================================

-- ============================================================================
-- 0006_crowd.sql — crowd vs model
--
-- The app has two things almost nobody else has at once: a calibrated model,
-- and every user's prediction. Comparing them is content that costs nothing to
-- produce, is genuinely interesting, and cannot be copied by a competitor
-- without both a model and a userbase.
--
--   "81% of players backed Arsenal. The model said 43%. It finished 1-1."
--
-- TWO DESIGN RULES, both load-bearing:
--
-- 1. CROWD DATA IS INVISIBLE UNTIL KICKOFF.
--    Showing the crowd's split while predictions are open would anchor people
--    onto the majority and homogenise the whole game — and a game where
--    everyone predicts the same thing has no story on Monday. It would also
--    hand a real edge to whoever checks last. So the crowd view applies the
--    same lock as predictions: now() >= kickoff_utc. This is enforced in the
--    view, not the UI.
--
-- 2. AGGREGATES ONLY, ABOVE A MINIMUM SAMPLE.
--    These views run as SECURITY DEFINER over user_predictions, so they can
--    see rows RLS would otherwise hide. That is necessary for a count and
--    dangerous for anything else: with two participants, "50% backed Arsenal"
--    reveals an individual's pick. MIN_CROWD_SAMPLE below is the guard, and no
--    view here selects a user_id.
-- ============================================================================

-- Below this many predictions, a percentage is both meaningless and
-- potentially deanonymising. 10 is low enough to work in week one of a small
-- launch and high enough that no single person's pick is recoverable.
create or replace function public.min_crowd_sample()
returns integer language sql immutable parallel safe as $$ select 10 $$;

-- ------------------------------------------------------- crowd aggregate

create or replace view public.crowd_predictions as
select
  up.fixture_id,
  count(*)                                                              as n_predictions,
  round((count(*) filter (where up.outcome = 'home'))::numeric / count(*), 4) as crowd_home,
  round((count(*) filter (where up.outcome = 'draw'))::numeric / count(*), 4) as crowd_draw,
  round((count(*) filter (where up.outcome = 'away'))::numeric / count(*), 4) as crowd_away,
  mode() within group (order by up.home_goals || '-' || up.away_goals)   as crowd_scoreline
from public.user_predictions up
join public.fixtures f on f.id = up.fixture_id
where now() >= f.kickoff_utc                        -- rule 1: locked only
group by up.fixture_id
having count(*) >= public.min_crowd_sample();       -- rule 2: sample floor

grant select on public.crowd_predictions to anon, authenticated;

-- ---------------------------------------------------- disagreement metric

/*
  Total variation distance between the crowd's distribution and the model's:

      TVD = 0.5 * ( |c_h - m_h| + |c_d - m_d| + |c_a - m_a| )

  Chosen over KL divergence for three reasons: it is symmetric (neither side
  is privileged as "truth"), it is bounded 0..1 so it can be rendered as a
  percentage without explanation, and it does not explode when one side puts
  near-zero probability on something the other likes — which is exactly the
  case we most want to surface.
*/
create or replace function public.distribution_distance(
  a_home numeric, a_draw numeric, a_away numeric,
  b_home numeric, b_draw numeric, b_away numeric
) returns numeric
language sql immutable parallel safe as $$
  select round(
    (abs(a_home - b_home) + abs(a_draw - b_draw) + abs(a_away - b_away)) / 2,
    4
  );
$$;

create or replace view public.crowd_vs_model as
select
  f.id                       as fixture_id,
  f.season,
  f.gameweek,
  h.name                     as home_name,
  h.short_name               as home_short,
  a.name                     as away_name,
  a.short_name               as away_short,
  f.status,
  f.home_goals,
  f.away_goals,

  c.n_predictions,
  c.crowd_home, c.crowd_draw, c.crowd_away,
  c.crowd_scoreline,

  p.p_home                   as model_home,
  p.p_draw                   as model_draw,
  p.p_away                   as model_away,

  public.distribution_distance(
    c.crowd_home, c.crowd_draw, c.crowd_away,
    p.p_home,     p.p_draw,     p.p_away
  )                          as disagreement,

  -- Whose favourite was it? Rendered as the headline on both sides.
  (case
     when c.crowd_home >= greatest(c.crowd_draw, c.crowd_away) then 'home'
     when c.crowd_away >= greatest(c.crowd_home, c.crowd_draw) then 'away'
     else 'draw'
   end)::public.match_outcome as crowd_pick,

  (case
     when p.p_home >= greatest(p.p_draw, p.p_away) then 'home'
     when p.p_away >= greatest(p.p_home, p.p_draw) then 'away'
     else 'draw'
   end)::public.match_outcome as model_pick,

  -- Null until the match finishes. §5.6: never claim a result before there is
  -- one; a "the model was right" badge on an unfinished match is a lie.
  (case
     when f.status <> 'finished' or f.home_goals is null then null
     when f.home_goals > f.away_goals then 'home'
     when f.home_goals < f.away_goals then 'away'
     else 'draw'
   end)::public.match_outcome as actual_outcome

from public.crowd_predictions c
join public.fixtures f       on f.id = c.fixture_id
join public.teams h          on h.id = f.home_team_id
join public.teams a          on a.id = f.away_team_id
join model.predictions p     on p.fixture_id = f.id
join public.model_versions mv on mv.version = p.model_version and mv.is_active;

grant select on public.crowd_vs_model to anon, authenticated;

comment on view public.crowd_vs_model is
  'The weekly talking point: where the crowd and the model disagreed most. '
  'Post-kickoff only. Free to all users — this is marketing, not premium.';

-- ------------------------------------------------------- the headline pick

/*
  The single most interesting match of a gameweek.

  Ranked by disagreement weighted by crowd conviction: a match where the crowd
  is 80/15/5 against the model matters more than one where they are 40/35/25,
  even at equal TVD, because a confident crowd being wrong is the story. Ties
  break toward the larger sample.
*/
create or replace view public.gameweek_talking_point as
select distinct on (season, gameweek)
  *,
  disagreement * greatest(crowd_home, crowd_draw, crowd_away) as story_score
from public.crowd_vs_model
order by season, gameweek,
         disagreement * greatest(crowd_home, crowd_draw, crowd_away) desc,
         n_predictions desc;

grant select on public.gameweek_talking_point to anon, authenticated;

-- ------------------------------------------------------ personal comparison

/*
  Three-way: you, the crowd, the model. This is the shareable one — it says
  something about the user, not just about the data.
*/
create or replace view public.my_vs_crowd as
select
  cvm.fixture_id,
  cvm.season,
  cvm.gameweek,
  cvm.home_short,
  cvm.away_short,
  cvm.n_predictions,
  cvm.crowd_pick,
  cvm.model_pick,
  cvm.actual_outcome,
  up.outcome                                    as my_pick,
  up.home_goals                                 as my_home_goals,
  up.away_goals                                 as my_away_goals,
  up.points_awarded,
  (up.outcome <> cvm.crowd_pick)                as went_against_crowd,
  (up.outcome <> cvm.model_pick)                as went_against_model,
  -- The brag: you were right when most people were not.
  (cvm.actual_outcome is not null
     and up.outcome = cvm.actual_outcome
     and cvm.crowd_pick <> cvm.actual_outcome)  as beat_the_crowd
from public.crowd_vs_model cvm
join public.user_predictions up
  on up.fixture_id = cvm.fixture_id and up.user_id = auth.uid();

grant select on public.my_vs_crowd to authenticated;

-- ==========================================================================
-- FILE: 0007_prediction_labels.sql
-- ==========================================================================

-- ============================================================================
-- 0007_prediction_labels.sql — confidence band and reason, computed in SQL
--
-- §5.6 requires confidence to be shown as a band plus a reason ("Low
-- confidence — first gameweek, limited data"), never as a bare percentage.
-- That mapping already exists in Python (model/priors.py) for the offline
-- export, and the client needs the same strings.
--
-- Putting it in the view rather than reimplementing it in TypeScript keeps the
-- rule in one place. The alternative is three copies — Python, SQL, TS — of a
-- rule that is pure presentation, and the first time one drifts the app tells
-- a user "High confidence" about a match the model is guessing at.
-- ============================================================================

create or replace function public.confidence_band(p_confidence numeric)
returns text language sql immutable parallel safe as $$
  select case
    when p_confidence >= 0.66 then 'High'
    when p_confidence >= 0.45 then 'Medium'
    else 'Low'
  end;
$$;

create or replace function public.confidence_reason(p_gameweek smallint)
returns text language sql immutable parallel safe as $$
  select case
    when p_gameweek <= 1 then 'first gameweek, limited data'
    when p_gameweek < 8  then 'early season, ' || (p_gameweek - 1) || ' week(s) of data'
    else 'full season of data'
  end;
$$;

-- ---------------------------------------------------------------- free view

drop view if exists public.predictions_free;

create view public.predictions_free as
select
  p.fixture_id,
  p.model_version,
  (case
     when p.p_home >= greatest(p.p_draw, p.p_away) then 'home'
     when p.p_away >= greatest(p.p_home, p.p_draw) then 'away'
     else 'draw'
   end)::public.match_outcome     as headline_pick,
  p.confidence,
  public.confidence_band(p.confidence)   as confidence_band,
  public.confidence_reason(f.gameweek)   as confidence_reason,
  p.data_regime,
  p.generated_at
from model.predictions p
join public.fixtures f        on f.id = p.fixture_id
join public.model_versions mv on mv.version = p.model_version and mv.is_active;

grant select on public.predictions_free to anon, authenticated;

-- ------------------------------------------------------------- premium view

drop view if exists public.predictions_premium;

create view public.predictions_premium as
select
  p.fixture_id,       p.model_version,
  p.p_home,           p.p_draw,        p.p_away,
  p.exp_home_goals,   p.exp_away_goals,
  p.scoreline_matrix,
  p.p_btts,           p.p_over_25,
  p.p_home_cs,        p.p_away_cs,
  p.confidence,
  public.confidence_band(p.confidence) as confidence_band,
  public.confidence_reason(f.gameweek) as confidence_reason,
  p.data_regime,      p.generated_at
from model.predictions p
join public.fixtures f        on f.id = p.fixture_id
join public.model_versions mv on mv.version = p.model_version and mv.is_active
where public.is_entitled();

grant select on public.predictions_premium to authenticated;

-- ==========================================================================
-- FILE: 0008_fix_upsert_grants.sql
-- ==========================================================================

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


commit;
