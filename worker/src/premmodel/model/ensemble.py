"""Stacked blend of Dixon-Coles and Elo (CLAUDE.md §5.3).

§5.3 asks for "logistic regression stacking". This implements it in its
parameter-tied form — a log-opinion pool:

    log p  =  w * log p_dc  +  (1 - w) * log p_elo,   then temperature T,
    p      =  softmax(that)

which is a multinomial logistic regression on log-probability features with
coefficients tied across the three outcomes. That tying is deliberate, not a
shortcut. An untied stack has 18 free parameters fitted on ~1,100 validation
matches, and it reliably learns outcome-specific quirks of the validation
seasons — usually "draws were rarer than usual in 2022/23" — which is exactly
the overfitting the §5.5 calibration story cannot survive. The tied form has
two parameters, both interpretable:

    w  how much to trust the Poisson fit over the sequential ratings
    T  whether the blend is over- or under-confident (T > 1 softens)

The temperature is what makes this earn its place: blending two probability
sets almost always produces something under-confident, and T corrects that
directly against held-out log-loss.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
from scipy.optimize import minimize_scalar

log = logging.getLogger(__name__)

EPS = 1e-12


@dataclass(frozen=True, slots=True)
class EnsembleWeights:
    w_dixon_coles: float
    temperature: float
    val_log_loss: float
    n_validation: int

    def describe(self) -> str:
        return (
            f"w_dc={self.w_dixon_coles:.3f}  T={self.temperature:.3f}  "
            f"(fitted on {self.n_validation} matches, log-loss {self.val_log_loss:.4f})"
        )


def blend(
    dc_probs: np.ndarray,
    elo_probs: np.ndarray,
    weights: EnsembleWeights,
) -> np.ndarray:
    return _pool(dc_probs, elo_probs, weights.w_dixon_coles, weights.temperature)


def _pool(
    dc_probs: np.ndarray, elo_probs: np.ndarray, w: float, temperature: float
) -> np.ndarray:
    log_mix = w * np.log(np.clip(dc_probs, EPS, 1.0)) + (1.0 - w) * np.log(
        np.clip(elo_probs, EPS, 1.0)
    )
    log_mix /= max(temperature, 1e-6)
    # Subtract the row max before exponentiating — standard softmax guard
    # against overflow when a component probability is very small.
    log_mix -= log_mix.max(axis=1, keepdims=True)
    mixed = np.exp(log_mix)
    return mixed / mixed.sum(axis=1, keepdims=True)


def fit(
    dc_probs: np.ndarray,
    elo_probs: np.ndarray,
    outcomes: np.ndarray,
    *,
    temperature_bounds: tuple[float, float] = (0.5, 2.5),
) -> EnsembleWeights:
    """Fit w then T by coordinate descent on validation log-loss.

    Two passes are enough: the objective is smooth and near-convex in each
    coordinate, and w and T are close to orthogonal in effect (w moves *which*
    model is trusted, T moves *how strongly* the result is asserted).
    """
    if not (len(dc_probs) == len(elo_probs) == len(outcomes)):
        raise ValueError("dc_probs, elo_probs and outcomes must be the same length")
    if len(outcomes) == 0:
        raise ValueError("cannot fit an ensemble on zero matches")

    rows = np.arange(len(outcomes))

    def loss(w: float, temperature: float) -> float:
        probs = _pool(dc_probs, elo_probs, w, temperature)
        return float(-np.mean(np.log(np.clip(probs[rows, outcomes], EPS, 1.0))))

    w, temperature = 0.5, 1.0
    for _ in range(2):
        # Default-argument binding: each lambda captures the value from this
        # iteration, not whatever the name happens to hold when it is called.
        w = float(
            minimize_scalar(
                lambda x, t=temperature: loss(x, t), bounds=(0.0, 1.0), method="bounded"
            ).x
        )
        temperature = float(
            minimize_scalar(
                lambda t, x=w: loss(x, t), bounds=temperature_bounds, method="bounded"
            ).x
        )

    weights = EnsembleWeights(
        w_dixon_coles=w,
        temperature=temperature,
        val_log_loss=loss(w, temperature),
        n_validation=len(outcomes),
    )
    log.info("ensemble fitted: %s", weights.describe())
    return weights
