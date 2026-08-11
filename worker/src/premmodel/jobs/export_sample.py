"""Export real model output as a dev fixture for the app (CLAUDE.md §11 Phase 2).

Phase 2 says "all against real data". The Supabase project does not exist yet,
so the alternative would be hand-invented placeholders — and UI built against
made-up numbers hides exactly the problems that matter: what a 34/33/33 bar
looks like, how an 8x8 heatmap reads when the mass is concentrated in one cell,
whether a 3-character club abbreviation overflows its mark.

This runs the actual fitted model over the most recent season's clubs and
writes its genuine output. When the database exists this file is deleted and
the app reads Supabase instead; the payload shape is identical.
"""

from __future__ import annotations

import argparse
import json
import logging
from datetime import UTC, datetime, timedelta

import numpy as np
import pandas as pd

from premmodel.config import settings
from premmodel.jobs.backfill import TRAINING_SET
from premmodel.model import dixon_coles, elo, ensemble, priors
from premmodel.season import current_season, season_start_year
from premmodel.seed.teams import TEAM_COLOURS

log = logging.getLogger(__name__)

OUTPUT = "sample_gameweek.json"


def _short_name(slug: str) -> str:
    """Three-letter abbreviation for the §7.4 mark, derived not hand-listed."""
    words = [w for w in slug.split("-") if w not in {"and", "city", "united", "afc", "fc"}]
    if not words:
        words = slug.split("-")
    if len(words) >= 3:
        return "".join(w[0] for w in words[:3]).upper()
    if len(words) == 2:
        return (words[0][:2] + words[1][0]).upper()
    return words[0][:3].upper()


def run(gameweek: int = 1) -> dict:
    path = settings().data_dir / TRAINING_SET
    history = pd.read_parquet(path).sort_values("date").reset_index(drop=True)
    seasons = sorted(history["season"].unique())

    validation = history[history["season"].isin(seasons[-3:])]
    train_pool = history[history["season"] < seasons[-3]]
    xi, _ = dixon_coles.tune_xi(train_pool, validation)

    dc = dixon_coles.fit(history, xi=xi, as_of=datetime.now(UTC))
    elo_model = elo.fit(history)

    from premmodel.calibration.metrics import outcome_index

    val_rows = [
        (dc.outcome_probs(h, a), elo_model.outcome_probs(h, a))
        for h, a in zip(validation["home"], validation["away"], strict=True)
        if dc.knows(h) and dc.knows(a)
    ]
    val_mask = [
        dc.knows(h) and dc.knows(a)
        for h, a in zip(validation["home"], validation["away"], strict=True)
    ]
    weights = ensemble.fit(
        np.vstack([r[0] for r in val_rows]),
        np.vstack([r[1] for r in val_rows]),
        outcome_index(
            validation.loc[val_mask, "home_goals"].to_numpy(),
            validation.loc[val_mask, "away_goals"].to_numpy(),
        ),
    )

    prior_elo = elo_model.copy()
    prior_elo.regress_to_mean(priors.SUMMER_SHRINKAGE)

    # Clubs from the most recent completed season. NOTE: the actual 2026/27
    # line-up is unverified (CLAUDE.md §15 #9) — this is a dev fixture, not a
    # claim about who is in the league.
    latest = history[history["season"] == seasons[-1]]
    clubs = sorted(set(latest["home"]) | set(latest["away"]))
    clubs = [c for c in clubs if c in TEAM_COLOURS][:20]

    # Anchored to the current season rather than a fixed date, so this dev
    # fixture stays plausible in later years instead of silently claiming
    # every gameweek kicks off in August 2026.
    start_year = season_start_year(current_season())
    kickoff = datetime(start_year, 8, 15, 19, 0, tzinfo=UTC)
    fixtures = []

    for i in range(0, len(clubs) - 1, 2):
        home, away = clubs[i], clubs[i + 1]
        matrix = dc.score_matrix(home, away)
        dc_probs = dixon_coles.outcomes_from_matrix(matrix)
        elo_probs = elo_model.outcome_probs(home, away)
        current = ensemble.blend(dc_probs[None, :], elo_probs[None, :], weights)[0]
        probs = priors.blend_probabilities(
            prior_elo.outcome_probs(home, away), current, gameweek
        )
        markets = dixon_coles.derived_markets(matrix)

        fixtures.append(
            {
                "id": f"sample-{i // 2:02d}",
                "gameweek": gameweek,
                "kickoff_utc": (kickoff + timedelta(hours=3 * (i // 2))).isoformat(),
                "status": "scheduled",
                "home_team": {
                    "slug": home,
                    "name": home.replace("-", " ").title(),
                    "short_name": _short_name(home),
                    "primary_color": TEAM_COLOURS[home][0],
                    "secondary_color": TEAM_COLOURS[home][1],
                },
                "away_team": {
                    "slug": away,
                    "name": away.replace("-", " ").title(),
                    "short_name": _short_name(away),
                    "primary_color": TEAM_COLOURS[away][0],
                    "secondary_color": TEAM_COLOURS[away][1],
                },
                "home_goals": None,
                "away_goals": None,
                "prediction": {
                    "p_home": round(float(probs[0]), 4),
                    "p_draw": round(float(probs[1]), 4),
                    "p_away": round(float(probs[2]), 4),
                    "exp_home_goals": round(markets["exp_home_goals"], 3),
                    "exp_away_goals": round(markets["exp_away_goals"], 3),
                    "p_btts": round(markets["p_btts"], 4),
                    "p_over_25": round(markets["p_over_25"], 4),
                    "p_home_cs": round(markets["p_home_cs"], 4),
                    "p_away_cs": round(markets["p_away_cs"], 4),
                    "confidence": round(priors.confidence(gameweek, probs), 3),
                    "confidence_band": priors.confidence_label(
                        gameweek, priors.confidence(gameweek, probs)
                    )[0],
                    "confidence_reason": priors.confidence_label(
                        gameweek, priors.confidence(gameweek, probs)
                    )[1],
                    "data_regime": priors.data_regime(gameweek),
                    "scoreline_matrix": np.round(matrix, 5).tolist(),
                    "top_scorelines": [
                        {"home": h, "away": a, "p": round(p, 4)}
                        for h, a, p in dixon_coles.top_scorelines(matrix, 5)
                    ],
                },
            }
        )

    payload = {
        "season": current_season(),
        "gameweek": gameweek,
        "generated_at": datetime.now(UTC).isoformat(),
        "model_version": "dc-elo-v1",
        "fixtures": fixtures,
    }

    out_path = settings().data_dir.parent.parent / "app" / "src" / "data" / OUTPUT
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    log.info("wrote %d fixtures to %s", len(fixtures), out_path)
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Export a sample gameweek for the app.")
    parser.add_argument("--gameweek", type=int, default=1)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    run(args.gameweek)


if __name__ == "__main__":
    main()
