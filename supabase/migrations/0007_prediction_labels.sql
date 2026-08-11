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
