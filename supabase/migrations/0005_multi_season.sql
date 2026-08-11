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
