"""Write predictions for upcoming fixtures (CLAUDE.md §4.2, the 02:15 UTC job).

Phase 1 deliverable (§11): the predictions table populated for GW1.

§3: predictions are computed on a schedule, never on request. This job is the
only writer; the API is a dumb cacheable read layer over what it produces. That
is what survives a traffic spike at 2:59pm on a Saturday.

§5.4 is applied here, not in the model: the fitted current-season model is
blended against a prior-season model by gameweek, so GW1 output is ~90% prior.
"""

from __future__ import annotations

import argparse
import json
import logging
from datetime import UTC, datetime, timedelta

import numpy as np
import pandas as pd

from premmodel import db
from premmodel.config import settings
from premmodel.jobs.backfill import TRAINING_SET
from premmodel.model import dixon_coles, elo, ensemble, priors
from premmodel.season import current_season

log = logging.getLogger(__name__)

MODEL_VERSION = "dc-elo-v1"
HORIZON_DAYS = 14
"""§4.2: write predictions for the next 14 days."""


def _load_history() -> pd.DataFrame:
    path = settings().data_dir / TRAINING_SET
    if not path.exists():
        raise FileNotFoundError(f"no training set at {path} — run `premmodel backfill`")
    return pd.read_parquet(path).sort_values("date").reset_index(drop=True)


def _fallback_rates(dc: dixon_coles.DixonColesFit, home: str, away: str) -> tuple[float, float]:
    """Rates for a club the fit has never seen (a promoted side in GW1).

    Uses the league-average attack and defence rather than skipping the
    fixture — §5.4 requires a prediction with widened confidence, not silence.
    """
    mean_attack = float(dc.attack.mean())
    mean_defence = float(dc.defence.mean())
    attack_h = float(dc.attack[dc.index[home]]) if dc.knows(home) else mean_attack
    attack_a = float(dc.attack[dc.index[away]]) if dc.knows(away) else mean_attack
    defence_h = float(dc.defence[dc.index[home]]) if dc.knows(home) else mean_defence
    defence_a = float(dc.defence[dc.index[away]]) if dc.knows(away) else mean_defence
    lam = float(np.exp(attack_h - defence_a + dc.home_adv))
    mu = float(np.exp(attack_a - defence_h))
    return lam, mu


def run(season: str | None = None, *, horizon_days: int = HORIZON_DAYS) -> int:
    season = season or current_season()
    history = _load_history()
    seasons = sorted(history["season"].unique())

    # Hyperparameters fitted on the three most recent completed seasons (§5.3).
    validation = history[history["season"].isin(seasons[-3:])]
    train_pool = history[history["season"] < seasons[-3]]
    xi, _ = dixon_coles.tune_xi(train_pool, validation)

    dc = dixon_coles.fit(history, xi=xi, as_of=datetime.now(UTC))
    elo_model = elo.fit(history)

    val_rows = [
        (
            dc.outcome_probs(h, a) if dc.knows(h) and dc.knows(a)
            else np.array([0.447, 0.242, 0.311]),
            elo_model.outcome_probs(h, a),
        )
        for h, a in zip(validation["home"], validation["away"], strict=True)
    ]
    from premmodel.calibration.metrics import outcome_index

    weights = ensemble.fit(
        np.vstack([r[0] for r in val_rows]),
        np.vstack([r[1] for r in val_rows]),
        outcome_index(
            validation["home_goals"].to_numpy(), validation["away_goals"].to_numpy()
        ),
    )

    # §5.4 prior: last season's strengths, regressed toward the league mean.
    prior_elo = elo_model.copy()
    prior_elo.regress_to_mean(priors.SUMMER_SHRINKAGE)

    horizon = datetime.now(UTC) + timedelta(days=horizon_days)
    written = 0

    with db.connection() as conn:
        conn.execute(
            """
            insert into public.model_versions (version, is_active, activated_at, notes)
            values (%s, true, now(), %s)
            on conflict (version) do update set activated_at = now(), notes = excluded.notes
            """,
            (MODEL_VERSION, f"Dixon-Coles(xi={xi:.4f}) + Elo, {weights.describe()}"),
        )

        fixtures = conn.execute(
            """
            select f.id, f.gameweek,
                   h.slug as home_slug, a.slug as away_slug
            from public.fixtures f
            join public.teams h on h.id = f.home_team_id
            join public.teams a on a.id = f.away_team_id
            where f.season = %s and f.status = 'scheduled'
              and f.kickoff_utc between now() and %s
            order by f.kickoff_utc
            """,
            (season, horizon),
        ).fetchall()

        for fx in fixtures:
            home, away, gameweek = fx["home_slug"], fx["away_slug"], fx["gameweek"]
            promoted = not (dc.knows(home) and dc.knows(away))

            lam, mu = _fallback_rates(dc, home, away)
            matrix = dixon_coles.score_matrix_from_rates(lam, mu, dc.rho)
            dc_probs = dixon_coles.outcomes_from_matrix(matrix)
            elo_probs = elo_model.outcome_probs(home, away)

            current = ensemble.blend(dc_probs[None, :], elo_probs[None, :], weights)[0]
            prior = prior_elo.outcome_probs(home, away)
            probs = priors.blend_probabilities(prior, current, gameweek)

            markets = dixon_coles.derived_markets(matrix)
            conf = priors.confidence(gameweek, probs, promoted_involved=promoted)

            # The DB enforces sum-to-1 with a CHECK constraint; round so a
            # float artefact cannot fail the write at 02:15 UTC.
            p = np.round(probs, 4)
            p[0] += 1.0 - p.sum()

            conn.execute(
                """
                insert into model.predictions
                    (fixture_id, model_version, p_home, p_draw, p_away,
                     exp_home_goals, exp_away_goals, scoreline_matrix,
                     p_btts, p_over_25, p_home_cs, p_away_cs,
                     confidence, data_regime)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (fixture_id, model_version) do update set
                    p_home = excluded.p_home, p_draw = excluded.p_draw,
                    p_away = excluded.p_away,
                    exp_home_goals = excluded.exp_home_goals,
                    exp_away_goals = excluded.exp_away_goals,
                    scoreline_matrix = excluded.scoreline_matrix,
                    p_btts = excluded.p_btts, p_over_25 = excluded.p_over_25,
                    p_home_cs = excluded.p_home_cs, p_away_cs = excluded.p_away_cs,
                    confidence = excluded.confidence,
                    data_regime = excluded.data_regime,
                    generated_at = now()
                """,
                (
                    fx["id"], MODEL_VERSION,
                    float(p[0]), float(p[1]), float(p[2]),
                    markets["exp_home_goals"], markets["exp_away_goals"],
                    json.dumps(np.round(matrix, 6).tolist()),
                    markets["p_btts"], markets["p_over_25"],
                    markets["p_home_cs"], markets["p_away_cs"],
                    conf, priors.data_regime(gameweek),
                ),
            )
            written += 1
            log.info(
                "  %-28s %.3f / %.3f / %.3f  conf=%.2f  %s",
                f"{home} v {away}", p[0], p[1], p[2], conf,
                priors.data_regime(gameweek),
            )

    log.info("wrote %d predictions (model %s)", written, MODEL_VERSION)
    return written


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate and store predictions.")
    parser.add_argument("--season", default=None)
    parser.add_argument("--horizon-days", type=int, default=HORIZON_DAYS)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    run(args.season, horizon_days=args.horizon_days)


if __name__ == "__main__":
    main()
