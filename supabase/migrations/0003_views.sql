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
