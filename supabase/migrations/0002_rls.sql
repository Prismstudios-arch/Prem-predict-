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
