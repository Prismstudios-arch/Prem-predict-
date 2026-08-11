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
