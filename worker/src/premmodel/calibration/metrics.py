"""Scoring rules and reliability (CLAUDE.md §5.5).

This module defines the Phase 1 gate. It is deliberately written before any
model, so the bar cannot be rationalised after seeing results.

The gate is *proximity to* the de-vigged market baseline, never beating it:
    multiclass Brier within +0.010, log-loss within +0.05, on a held-out season.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

EPS = 1e-15

# Outcome index convention used everywhere: 0 = home, 1 = draw, 2 = away.
HOME, DRAW, AWAY = 0, 1, 2

BRIER_TOLERANCE = 0.010
LOG_LOSS_TOLERANCE = 0.05


def outcome_index(home_goals: np.ndarray, away_goals: np.ndarray) -> np.ndarray:
    """Goals -> outcome index."""
    return np.where(home_goals > away_goals, HOME, np.where(home_goals == away_goals, DRAW, AWAY))


def one_hot(outcomes: np.ndarray) -> np.ndarray:
    out = np.zeros((len(outcomes), 3))
    out[np.arange(len(outcomes)), outcomes] = 1.0
    return out


def brier_score(probs: np.ndarray, outcomes: np.ndarray) -> float:
    """Multiclass Brier, averaged over matches AND over the three classes.

    Range [0, 2/3]. Lower is better. Uniform 1/3-1/3-1/3 scores 0.222;
    de-vigged Premier League closing odds land around 0.19-0.20, which is the
    band BRIER_TOLERANCE is calibrated against.

    Both conventions exist in the literature — Brier's original definition sums
    over classes (so every figure here would be 3x larger, uniform = 0.667).
    The mean-over-classes form is used because it is the one the widely quoted
    football reference values are stated on, and mixing the two silently makes
    a tolerance three times looser or tighter than intended.
    """
    _validate(probs)
    return float(np.mean(np.sum((probs - one_hot(outcomes)) ** 2, axis=1) / 3.0))


def log_loss(probs: np.ndarray, outcomes: np.ndarray) -> float:
    """Mean negative log-likelihood of the realised outcome.

    Punishes confident errors far harder than Brier does, which is precisely
    why §5.6 forbids assertive copy. Uniform scores ln(3) = 1.0986.
    """
    _validate(probs)
    picked = probs[np.arange(len(outcomes)), outcomes]
    return float(-np.mean(np.log(np.clip(picked, EPS, 1.0))))


def accuracy(probs: np.ndarray, outcomes: np.ndarray) -> float:
    """Share of matches where the argmax outcome was correct.

    Reported because users understand it. It is a poor scoring rule — it ignores
    confidence entirely — so it never drives a modelling decision.
    """
    _validate(probs)
    return float(np.mean(np.argmax(probs, axis=1) == outcomes))


@dataclass(frozen=True, slots=True)
class ReliabilityBin:
    lower: float
    upper: float
    n: int
    mean_predicted: float
    observed_rate: float

    @property
    def gap(self) -> float:
        return self.observed_rate - self.mean_predicted


def reliability_curve(
    probs: np.ndarray, outcomes: np.ndarray, *, n_bins: int = 10
) -> list[ReliabilityBin]:
    """The §5.5 chart: "when we said 60%, it happened 58% of the time".

    Pools all three outcome classes — every (match, outcome) pair is one
    forecast — which is the honest reading of a 1X2 model and gives 3x the
    sample of a home-only curve.
    """
    _validate(probs)
    flat_p = probs.ravel()
    flat_y = one_hot(outcomes).ravel()

    edges = np.linspace(0.0, 1.0, n_bins + 1)
    bins: list[ReliabilityBin] = []
    for lo, hi in zip(edges[:-1], edges[1:], strict=True):
        mask = (flat_p >= lo) & (flat_p < hi if hi < 1.0 else flat_p <= hi)
        if not mask.any():
            continue
        bins.append(
            ReliabilityBin(
                lower=float(lo),
                upper=float(hi),
                n=int(mask.sum()),
                mean_predicted=float(flat_p[mask].mean()),
                observed_rate=float(flat_y[mask].mean()),
            )
        )
    return bins


def expected_calibration_error(
    probs: np.ndarray, outcomes: np.ndarray, *, n_bins: int = 10
) -> float:
    """Sample-weighted mean |observed - predicted| across reliability bins."""
    bins = reliability_curve(probs, outcomes, n_bins=n_bins)
    total = sum(b.n for b in bins)
    if total == 0:
        return float("nan")
    return sum(b.n * abs(b.gap) for b in bins) / total


@dataclass(frozen=True, slots=True)
class Evaluation:
    n: int
    brier: float
    log_loss: float
    accuracy: float
    ece: float

    def summary(self) -> str:
        return (
            f"n={self.n:<5d} brier={self.brier:.4f}  "
            f"logloss={self.log_loss:.4f}  acc={self.accuracy:.3f}  ece={self.ece:.4f}"
        )


def evaluate(probs: np.ndarray, outcomes: np.ndarray) -> Evaluation:
    return Evaluation(
        n=len(outcomes),
        brier=brier_score(probs, outcomes),
        log_loss=log_loss(probs, outcomes),
        accuracy=accuracy(probs, outcomes),
        ece=expected_calibration_error(probs, outcomes),
    )


@dataclass(frozen=True, slots=True)
class GateResult:
    model: Evaluation
    market: Evaluation | None
    brier_gap: float | None
    log_loss_gap: float | None
    passed: bool
    reasons: list[str]

    def report(self) -> str:
        lines = [
            f"  model   {self.model.summary()}",
            f"  market  {self.market.summary()}" if self.market else "  market  (unavailable)",
        ]
        if self.brier_gap is not None:
            lines.append(
                f"  gap     brier {self.brier_gap:+.4f} "
                f"(tol +{BRIER_TOLERANCE:.3f})   "
                f"logloss {self.log_loss_gap:+.4f} (tol +{LOG_LOSS_TOLERANCE:.2f})"
            )
        lines.append(f"  GATE    {'PASS' if self.passed else 'FAIL'}")
        lines.extend(f"          - {r}" for r in self.reasons)
        return "\n".join(lines)


def check_gate(
    model_probs: np.ndarray,
    outcomes: np.ndarray,
    market_probs: np.ndarray | None,
) -> GateResult:
    """Apply the §5.5 Phase 1 gate.

    Beating the market is not required and not expected — the market aggregates
    far more information than this model has. Landing close to it means the
    model is honest, which is the entire product claim.
    """
    model_eval = evaluate(model_probs, outcomes)

    if market_probs is None or len(market_probs) == 0:
        return GateResult(
            model=model_eval, market=None, brier_gap=None, log_loss_gap=None,
            passed=False, reasons=["no market baseline available — gate cannot be evaluated"],
        )

    market_eval = evaluate(market_probs, outcomes)
    brier_gap = model_eval.brier - market_eval.brier
    ll_gap = model_eval.log_loss - market_eval.log_loss

    reasons: list[str] = []
    if brier_gap > BRIER_TOLERANCE:
        reasons.append(f"brier gap {brier_gap:+.4f} exceeds +{BRIER_TOLERANCE:.3f}")
    if ll_gap > LOG_LOSS_TOLERANCE:
        reasons.append(f"log-loss gap {ll_gap:+.4f} exceeds +{LOG_LOSS_TOLERANCE:.2f}")
    if not reasons:
        reasons.append("within tolerance of the de-vigged market baseline")

    return GateResult(
        model=model_eval, market=market_eval,
        brier_gap=brier_gap, log_loss_gap=ll_gap,
        passed=not (brier_gap > BRIER_TOLERANCE or ll_gap > LOG_LOSS_TOLERANCE),
        reasons=reasons,
    )


def _validate(probs: np.ndarray) -> None:
    if probs.ndim != 2 or probs.shape[1] != 3:
        raise ValueError(f"expected (n, 3) probability array, got {probs.shape}")
    if not np.all(np.isfinite(probs)):
        raise ValueError("probabilities contain NaN or inf")
    if probs.min() < -1e-9 or probs.max() > 1 + 1e-9:
        raise ValueError("probabilities outside [0, 1]")
    sums = probs.sum(axis=1)
    if not np.allclose(sums, 1.0, atol=1e-6):
        worst = float(np.abs(sums - 1.0).max())
        raise ValueError(f"probabilities do not sum to 1 (worst deviation {worst:.2e})")
