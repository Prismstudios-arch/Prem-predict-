"""Elo with margin-of-victory scaling, plus an ordered-logit 1X2 mapping.

CLAUDE.md §5.2. Elo earns its place in the ensemble not by being better than
Dixon-Coles but by being *wrong differently* — it is a sequential, recency-
weighted process where DC is a batch likelihood fit, so their errors are only
partly correlated and the blend beats either alone.

Two pieces:

1. Ratings. Standard Elo with a margin multiplier, so a 4-0 moves ratings more
   than a 1-0 — but sub-linearly, because the difference between winning by 3
   and by 4 says much less than the difference between drawing and winning.
   The multiplier is damped by rating difference to stop favourites farming
   rating from thrashings they were expected to deliver.

2. Probabilities. A raw Elo difference gives an expected *score*, not a
   three-way split — it cannot tell you a draw from an even game. So the
   rating difference is mapped to 1X2 through an ordered logit whose two
   thresholds are fitted by maximum likelihood on history. The draw
   probability then falls out of the gap between the thresholds, which is the
   honest way to get it rather than a hand-tuned constant.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.special import expit

log = logging.getLogger(__name__)

INITIAL_RATING = 1500.0
DEFAULT_K = 20.0
DEFAULT_HOME_ADVANTAGE = 60.0
"""Elo points. ~60 corresponds to the long-run Premier League home edge."""


@dataclass(frozen=True, slots=True)
class OrderedLogit:
    """Maps (rating difference / 400) to [P(home), P(draw), P(away)]."""

    scale: float
    threshold_away: float
    threshold_home: float

    def probabilities(self, z: np.ndarray) -> np.ndarray:
        z = np.atleast_1d(np.asarray(z, dtype=float))
        cum_away = expit(self.threshold_away - self.scale * z)
        cum_draw = expit(self.threshold_home - self.scale * z)
        p_away = cum_away
        p_draw = np.clip(cum_draw - cum_away, 1e-9, None)
        p_home = np.clip(1.0 - cum_draw, 1e-9, None)
        stacked = np.column_stack([p_home, p_draw, p_away])
        return stacked / stacked.sum(axis=1, keepdims=True)


@dataclass
class EloModel:
    k: float = DEFAULT_K
    home_advantage: float = DEFAULT_HOME_ADVANTAGE
    ratings: dict[str, float] = field(default_factory=dict)
    link: OrderedLogit | None = None

    def rating(self, team: str) -> float:
        return self.ratings.get(team, INITIAL_RATING)

    def diff(self, home: str, away: str) -> float:
        return self.rating(home) + self.home_advantage - self.rating(away)

    def outcome_probs(self, home: str, away: str) -> np.ndarray:
        if self.link is None:
            raise RuntimeError("call fit_link() before requesting probabilities")
        return self.link.probabilities(np.array([self.diff(home, away) / 400.0]))[0]

    # ------------------------------------------------------------- rating pass

    def update(self, home: str, away: str, home_goals: int, away_goals: int) -> None:
        rating_diff = self.diff(home, away)
        expected_home = 1.0 / (1.0 + 10.0 ** (-rating_diff / 400.0))

        if home_goals > away_goals:
            actual = 1.0
        elif home_goals == away_goals:
            actual = 0.5
        else:
            actual = 0.0

        margin = abs(home_goals - away_goals)
        # Damped by the favourite's edge: an expected thrashing is weak evidence.
        winner_edge = rating_diff if actual == 1.0 else -rating_diff
        multiplier = np.log1p(margin) * (2.2 / (winner_edge * 0.001 + 2.2))

        adjustment = self.k * float(multiplier) * (actual - expected_home)
        self.ratings[home] = self.rating(home) + adjustment
        self.ratings[away] = self.rating(away) - adjustment

    def run(self, matches: pd.DataFrame) -> EloModel:
        """Replay matches in date order. Mutates and returns self."""
        ordered = matches.sort_values("date")
        for row in ordered.itertuples(index=False):
            self.update(row.home, row.away, int(row.home_goals), int(row.away_goals))
        return self

    def copy(self) -> EloModel:
        return EloModel(
            k=self.k,
            home_advantage=self.home_advantage,
            ratings=dict(self.ratings),
            link=self.link,
        )

    def regress_to_mean(self, shrinkage: float) -> None:
        """§5.4 close-season regression toward the league mean."""
        if not self.ratings:
            return
        mean = float(np.mean(list(self.ratings.values())))
        for team, value in self.ratings.items():
            self.ratings[team] = value + shrinkage * (mean - value)

    # --------------------------------------------------------------- link fit

    def fit_link(self, matches: pd.DataFrame) -> OrderedLogit:
        """Fit the ordered logit by replaying history one match at a time.

        Each match is scored using only the ratings that existed *before* it,
        so the training signal is genuinely out-of-sample at every step.
        """
        from premmodel.calibration.metrics import outcome_index

        replay = self.copy()
        replay.ratings = {}

        diffs: list[float] = []
        outcomes: list[int] = []
        ordered = matches.sort_values("date")

        for row in ordered.itertuples(index=False):
            diffs.append(replay.diff(row.home, row.away) / 400.0)
            replay.update(row.home, row.away, int(row.home_goals), int(row.away_goals))

        z = np.array(diffs)
        outcomes = outcome_index(
            ordered["home_goals"].to_numpy(), ordered["away_goals"].to_numpy()
        )

        def negative_log_likelihood(params: np.ndarray) -> float:
            scale, t_away, t_home = params
            if t_home <= t_away or scale <= 0:
                return 1e10
            probs = OrderedLogit(scale, t_away, t_home).probabilities(z)
            picked = probs[np.arange(len(outcomes)), outcomes]
            return float(-np.sum(np.log(np.clip(picked, 1e-15, 1.0))))

        result = minimize(
            negative_log_likelihood,
            x0=np.array([2.0, -0.8, 0.4]),
            method="Nelder-Mead",
            options={"maxiter": 3000, "xatol": 1e-6, "fatol": 1e-6},
        )
        scale, t_away, t_home = result.x
        self.link = OrderedLogit(float(scale), float(t_away), float(t_home))
        log.info(
            "Elo link fitted: scale=%.3f thresholds=(%.3f, %.3f)", scale, t_away, t_home
        )
        return self.link


def fit(matches: pd.DataFrame, *, k: float = DEFAULT_K) -> EloModel:
    """Fit the link on history, then bring ratings up to date."""
    model = EloModel(k=k)
    model.fit_link(matches)
    model.ratings = {}
    model.run(matches)
    return model
