"""Walk-forward backtest against the market baseline (CLAUDE.md §5.5, §11).

The only honest way to test a football model is to replay time. For each
gameweek of the held-out season the model is refitted on *everything that had
happened by then and nothing else*, predicts that week's matches, and is scored.

Three leaks this design specifically avoids:

  - Fitting once on the whole history and scoring the test season with it.
    The fit would have seen the results it is being graded on.
  - Anchoring time decay at "today". Match weights would encode the future.
    `as_of` is set to each gameweek's own date.
  - Tuning xi or the ensemble weights on the test season. Both are fitted on a
    validation season that sits strictly before the test season.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from premmodel.calibration.metrics import GateResult, check_gate, evaluate, outcome_index
from premmodel.model import dixon_coles, elo, ensemble

log = logging.getLogger(__name__)

MIN_TRAIN_MATCHES = 500
FALLBACK_PROBS = np.array([0.447, 0.242, 0.311])
"""Long-run Premier League base rates. Used only when a club is genuinely
unknown to the fit — never as a silent default for a fixable gap."""


@dataclass
class BacktestResult:
    season: str
    model_probs: np.ndarray
    market_probs: np.ndarray | None
    outcomes: np.ndarray
    gate: GateResult
    weights: ensemble.EnsembleWeights
    xi: float
    per_gameweek: list[dict] = field(default_factory=list)

    def report(self) -> str:
        lines = [
            "",
            f"BACKTEST  {self.season}",
            "=" * 62,
            f"  xi={self.xi:.4f}   {self.weights.describe()}",
            "",
            self.gate.report(),
            "",
        ]
        return "\n".join(lines)


def _probs_for(
    dc: dixon_coles.DixonColesFit,
    elo_model: elo.EloModel,
    home: str,
    away: str,
) -> tuple[np.ndarray, np.ndarray]:
    if dc.knows(home) and dc.knows(away):
        dc_probs = dc.outcome_probs(home, away)
    else:
        dc_probs = FALLBACK_PROBS.copy()
    elo_probs = elo_model.outcome_probs(home, away)
    return dc_probs, elo_probs


def _assign_gameweeks(season_matches: pd.DataFrame, per_week: int = 10) -> pd.Series:
    """Group a season's matches into pseudo-gameweeks by date order.

    football-data.co.uk carries no matchday column, and real gameweeks are
    reordered by postponements anyway. Chronological blocks are what matters
    here: they preserve "predict only from the past", which is the property the
    backtest is protecting.
    """
    ordered = season_matches.sort_values("date")
    return pd.Series(
        (np.arange(len(ordered)) // per_week) + 1, index=ordered.index, name="gameweek"
    )


def run(
    history: pd.DataFrame,
    *,
    test_season: str,
    validation_season: str | None = None,
) -> BacktestResult:
    history = history.sort_values("date").reset_index(drop=True)
    seasons = sorted(history["season"].unique())

    if test_season not in seasons:
        raise ValueError(f"{test_season} not in history ({seasons[0]}..{seasons[-1]})")

    test_idx = seasons.index(test_season)
    if test_idx < 2:
        raise ValueError(f"need at least two prior seasons before {test_season}")

    # §5.3 specifies "weights fitted on the previous three seasons". Fitting on
    # one season is measurably unstable: xi flipped between 0.0000 and 0.0019
    # and the ensemble weight between 0.41 and 0.14 across adjacent test
    # seasons, which is sampling noise at n=380 rather than a real signal.
    n_validation_seasons = 1 if validation_season else min(3, test_idx - 1)
    validation_seasons = (
        [validation_season] if validation_season
        else seasons[test_idx - n_validation_seasons : test_idx]
    )

    train_pool = history[history["season"] < validation_seasons[0]]
    validation = history[history["season"].isin(validation_seasons)]
    test = history[history["season"] == test_season].copy()
    test["gameweek"] = _assign_gameweeks(test)

    # ---- hyperparameters, fitted strictly before the test season -----------
    log.info("tuning xi on %s (validation)", ", ".join(validation_seasons))
    xi, _ = dixon_coles.tune_xi(train_pool, validation)

    log.info("fitting ensemble weights on %d validation matches", len(validation))
    val_dc = dixon_coles.fit(train_pool, xi=xi, as_of=validation["date"].min())
    val_elo = elo.fit(train_pool)
    val_rows = [
        _probs_for(val_dc, val_elo, h, a)
        for h, a in zip(validation["home"], validation["away"], strict=True)
    ]
    weights = ensemble.fit(
        np.vstack([r[0] for r in val_rows]),
        np.vstack([r[1] for r in val_rows]),
        outcome_index(
            validation["home_goals"].to_numpy(), validation["away_goals"].to_numpy()
        ),
    )

    # ---- walk forward through the test season ------------------------------
    prior_history = history[history["season"] < test_season]
    model_rows: list[np.ndarray] = []
    market_rows: list[np.ndarray] = []
    outcome_rows: list[int] = []
    has_market = True
    per_gameweek: list[dict] = []

    for gameweek in sorted(test["gameweek"].unique()):
        week = test[test["gameweek"] == gameweek]
        seen = pd.concat([prior_history, test[test["gameweek"] < gameweek]])
        if len(seen) < MIN_TRAIN_MATCHES:
            continue

        as_of = week["date"].min()
        dc = dixon_coles.fit(seen, xi=xi, as_of=as_of)
        elo_model = elo.fit(seen)

        week_probs: list[np.ndarray] = []
        for row in week.itertuples(index=False):
            dc_probs, elo_probs = _probs_for(dc, elo_model, row.home, row.away)
            blended = ensemble.blend(
                dc_probs[None, :], elo_probs[None, :], weights
            )[0]
            week_probs.append(blended)
            model_rows.append(blended)

            market = np.array([row.market_home, row.market_draw, row.market_away])
            if np.any(pd.isna(market)):
                has_market = False
            else:
                market_rows.append(market)

        week_outcomes = outcome_index(
            week["home_goals"].to_numpy(), week["away_goals"].to_numpy()
        )
        outcome_rows.extend(week_outcomes.tolist())

        week_eval = evaluate(np.vstack(week_probs), week_outcomes)
        per_gameweek.append(
            {
                "gameweek": int(gameweek),
                "n": len(week),
                "brier": week_eval.brier,
                "log_loss": week_eval.log_loss,
                "accuracy": week_eval.accuracy,
            }
        )
        log.info("  gw %2d  n=%2d  %s", gameweek, len(week), week_eval.summary())

    model_probs = np.vstack(model_rows)
    outcomes = np.array(outcome_rows)
    market_probs = (
        np.vstack(market_rows)
        if has_market and len(market_rows) == len(outcomes)
        else None
    )

    return BacktestResult(
        season=test_season,
        model_probs=model_probs,
        market_probs=market_probs,
        outcomes=outcomes,
        gate=check_gate(model_probs, outcomes, market_probs),
        weights=weights,
        xi=xi,
        per_gameweek=per_gameweek,
    )
