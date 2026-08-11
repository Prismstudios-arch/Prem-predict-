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
