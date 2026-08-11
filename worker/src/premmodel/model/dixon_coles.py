"""Dixon-Coles bivariate Poisson with exponential time decay (CLAUDE.md §5.1).

For a match between home team i and away team j:

    lambda = exp(attack_i - defence_j + home_adv)      expected home goals
    mu     = exp(attack_j - defence_i)                 expected away goals

    P(X=x, Y=y) = tau(x, y; lambda, mu, rho)
                  * Poisson(x; lambda) * Poisson(y; mu)

tau is the Dixon-Coles correction to the four low-scoring cells that
independent Poisson systematically misprices — 0-0, 1-0, 0-1 and 1-1 are
precisely the scorelines football produces more often than independence
implies, and they are ~30% of all Premier League results, so this is not a
rounding detail.

Each historical match is weighted exp(-xi * days_ago). xi = 0.0019 is roughly a
one-year half-life; §5.1 says to tune it by out-of-sample log-likelihood, which
`tune_xi` does.

Attack parameters are mean-centred inside the objective. Without that the model
is unidentifiable: adding a constant to every attack and every defence leaves
every prediction unchanged, and the optimiser drifts along that ridge forever.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.stats import poisson

log = logging.getLogger(__name__)

MAX_GOALS = 7
"""§5.1: score matrix runs 0-7 each side. The residual mass beyond 7-7 is
~1e-5 and is folded back in by normalisation."""

DEFAULT_XI = 0.0019
RHO_BOUNDS = (-0.25, 0.25)


@dataclass(frozen=True, slots=True)
class DixonColesFit:
    teams: tuple[str, ...]
    attack: np.ndarray
    defence: np.ndarray
    home_adv: float
    rho: float
    xi: float
    n_matches: int
    effective_n: float
    """Sum of time-decay weights — the sample size the fit actually saw."""
    converged: bool
    index: dict[str, int] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "index", {t: i for i, t in enumerate(self.teams)})

    def knows(self, team: str) -> bool:
        return team in self.index

    def rates(self, home: str, away: str) -> tuple[float, float]:
        i, j = self.index[home], self.index[away]
        lam = float(np.exp(self.attack[i] - self.defence[j] + self.home_adv))
        mu = float(np.exp(self.attack[j] - self.defence[i]))
        return lam, mu

    def score_matrix(self, home: str, away: str, max_goals: int = MAX_GOALS) -> np.ndarray:
        """Normalised (max_goals+1) x (max_goals+1) joint distribution."""
        lam, mu = self.rates(home, away)
        return score_matrix_from_rates(lam, mu, self.rho, max_goals)

    def outcome_probs(self, home: str, away: str) -> np.ndarray:
        return outcomes_from_matrix(self.score_matrix(home, away))


def score_matrix_from_rates(
    lam: float, mu: float, rho: float, max_goals: int = MAX_GOALS
) -> np.ndarray:
    goals = np.arange(max_goals + 1)
    home_pmf = poisson.pmf(goals, lam)
    away_pmf = poisson.pmf(goals, mu)
    matrix = np.outer(home_pmf, away_pmf)

    # tau: the low-score dependence correction.
    matrix[0, 0] *= 1.0 - lam * mu * rho
    matrix[0, 1] *= 1.0 + lam * rho
    matrix[1, 0] *= 1.0 + mu * rho
    matrix[1, 1] *= 1.0 - rho

    # rho is bounded during fitting so tau stays positive, but a caller may pass
    # arbitrary rates. Clip rather than emit a negative probability.
    np.clip(matrix, 0.0, None, out=matrix)

    total = matrix.sum()
    if total <= 0:
        raise ValueError(f"degenerate score matrix for lam={lam}, mu={mu}, rho={rho}")
    return matrix / total


def outcomes_from_matrix(matrix: np.ndarray) -> np.ndarray:
    """Marginalise a score matrix to [P(home), P(draw), P(away)]."""
    draw = float(np.trace(matrix))
    home = float(np.tril(matrix, -1).sum())
    away = float(np.triu(matrix, 1).sum())
    return np.array([home, draw, away])


def derived_markets(matrix: np.ndarray) -> dict[str, float]:
    """The §8.1 premium fields, all read off the same matrix."""
    n = matrix.shape[0]
    goals = np.arange(n)
    total = goals[:, None] + goals[None, :]
    return {
        "p_btts": float(matrix[1:, 1:].sum()),
        "p_over_25": float(matrix[total > 2].sum()),
        "p_home_cs": float(matrix[:, 0].sum()),
        "p_away_cs": float(matrix[0, :].sum()),
        "exp_home_goals": float((matrix.sum(axis=1) * goals).sum()),
        "exp_away_goals": float((matrix.sum(axis=0) * goals).sum()),
    }


def top_scorelines(matrix: np.ndarray, k: int = 5) -> list[tuple[int, int, float]]:
    flat = np.argsort(matrix, axis=None)[::-1][:k]
    rows, cols = np.unravel_index(flat, matrix.shape)
    return [(int(h), int(a), float(matrix[h, a])) for h, a in zip(rows, cols, strict=True)]


# --------------------------------------------------------------------- fitting


def _negative_log_likelihood(
    params: np.ndarray,
    home_idx: np.ndarray,
    away_idx: np.ndarray,
    home_goals: np.ndarray,
    away_goals: np.ndarray,
    weights: np.ndarray,
    n_teams: int,
) -> tuple[float, np.ndarray]:
    """Objective and analytic gradient.

    The gradient is supplied rather than finite-differenced. With 2n+2 = 42
    parameters, a numerical gradient costs 43 objective evaluations per step and
    L-BFGS-B hits its evaluation ceiling before converging — which showed up as
    silently unconverged fits. The closed form below is also ~40x faster, which
    matters because the walk-forward backtest refits ~80 times.
    """
    raw_attack = params[:n_teams]
    defence = params[n_teams : 2 * n_teams]
    home_adv = params[-2]
    rho = params[-1]

    # Mean-centring here, not as a constraint, keeps the problem identifiable
    # without giving the optimiser a flat ridge to wander along.
    attack = raw_attack - raw_attack.mean()

    lam = np.exp(attack[home_idx] - defence[away_idx] + home_adv)
    mu = np.exp(attack[away_idx] - defence[home_idx])

    m00 = (home_goals == 0) & (away_goals == 0)
    m01 = (home_goals == 0) & (away_goals == 1)
    m10 = (home_goals == 1) & (away_goals == 0)
    m11 = (home_goals == 1) & (away_goals == 1)

    tau = np.ones_like(lam)
    tau[m00] = 1.0 - lam[m00] * mu[m00] * rho
    tau[m01] = 1.0 + lam[m01] * rho
    tau[m10] = 1.0 + mu[m10] * rho
    tau[m11] = 1.0 - rho

    # A rho that drives tau non-positive is infeasible, not merely bad.
    if np.any(tau <= 1e-10):
        return 1e10, np.zeros_like(params)

    ll = weights * (
        np.log(tau)
        + home_goals * np.log(lam) - lam
        + away_goals * np.log(mu) - mu
    )
    total = ll.sum()
    if not np.isfinite(total):
        return 1e10, np.zeros_like(params)

    # ---- gradient of the log-likelihood ------------------------------------
    inv_tau = 1.0 / tau

    dtau_dlam = np.zeros_like(lam)
    dtau_dlam[m00] = -mu[m00] * rho
    dtau_dlam[m01] = rho

    dtau_dmu = np.zeros_like(mu)
    dtau_dmu[m00] = -lam[m00] * rho
    dtau_dmu[m10] = rho

    dtau_drho = np.zeros_like(lam)
    dtau_drho[m00] = -lam[m00] * mu[m00]
    dtau_drho[m01] = lam[m01]
    dtau_drho[m10] = mu[m10]
    dtau_drho[m11] = -1.0

    # lambda and mu are exponentials of the parameters, so d(lam)/d(param) is
    # +/- lam. Folding that factor in here keeps the scatter-adds below simple.
    a_term = weights * (inv_tau * dtau_dlam * lam + home_goals - lam)
    b_term = weights * (inv_tau * dtau_dmu * mu + away_goals - mu)

    grad_attack = np.zeros(n_teams)
    grad_defence = np.zeros(n_teams)
    np.add.at(grad_attack, home_idx, a_term)
    np.add.at(grad_attack, away_idx, b_term)
    np.add.at(grad_defence, away_idx, -a_term)
    np.add.at(grad_defence, home_idx, -b_term)

    # Chain through the mean-centring: attack = raw - mean(raw).
    grad_raw_attack = grad_attack - grad_attack.mean()

    grad = np.concatenate(
        [
            grad_raw_attack,
            grad_defence,
            [a_term.sum()],
            [(weights * inv_tau * dtau_drho).sum()],
        ]
    )
    return -total, -grad


def fit(
    matches: pd.DataFrame,
    *,
    xi: float = DEFAULT_XI,
    as_of: datetime | None = None,
    teams: list[str] | None = None,
) -> DixonColesFit:
    """Fit on a frame with columns: date, home, away, home_goals, away_goals.

    `as_of` anchors the time decay — pass the date you are predicting *for* so a
    backtest cannot see the future through its own weighting.
    """
    if matches.empty:
        raise ValueError("cannot fit on an empty match set")

    as_of = as_of or matches["date"].max()
    team_list = teams or sorted(set(matches["home"]) | set(matches["away"]))
    index = {t: i for i, t in enumerate(team_list)}
    n = len(team_list)

    home_idx = matches["home"].map(index).to_numpy(dtype=int)
    away_idx = matches["away"].map(index).to_numpy(dtype=int)
    hg = matches["home_goals"].to_numpy(dtype=float)
    ag = matches["away_goals"].to_numpy(dtype=float)

    days_ago = (as_of - matches["date"]).dt.total_seconds().to_numpy() / 86400.0
    weights = np.exp(-xi * np.clip(days_ago, 0.0, None))

    x0 = np.concatenate([np.zeros(n), np.zeros(n), [0.25], [-0.05]])
    bounds = [(-3.0, 3.0)] * n + [(-3.0, 3.0)] * n + [(-1.0, 1.5), RHO_BOUNDS]

    result = minimize(
        _negative_log_likelihood,
        x0,
        args=(home_idx, away_idx, hg, ag, weights, n),
        method="L-BFGS-B",
        jac=True,
        bounds=bounds,
        options={"maxiter": 2000, "maxfun": 20000, "ftol": 1e-11, "gtol": 1e-8},
    )

    if not result.success:
        log.warning("Dixon-Coles did not converge: %s", result.message)

    raw_attack = result.x[:n]
    return DixonColesFit(
        teams=tuple(team_list),
        attack=raw_attack - raw_attack.mean(),
        defence=result.x[n : 2 * n],
        home_adv=float(result.x[-2]),
        rho=float(result.x[-1]),
        xi=xi,
        n_matches=len(matches),
        effective_n=float(weights.sum()),
        converged=bool(result.success),
    )


def tune_xi(
    train: pd.DataFrame,
    validate: pd.DataFrame,
    *,
    candidates: tuple[float, ...] = (0.0, 0.0008, 0.0013, 0.0019, 0.0026, 0.0035, 0.005),
) -> tuple[float, dict[float, float]]:
    """§5.1: choose xi by out-of-sample log-likelihood, not by taste.

    Returns the best xi and the full {xi: log_loss} trace so a bad choice is
    visible rather than buried.
    """
    from premmodel.calibration.metrics import log_loss, outcome_index

    outcomes = outcome_index(
        validate["home_goals"].to_numpy(), validate["away_goals"].to_numpy()
    )
    trace: dict[float, float] = {}

    for candidate in candidates:
        fitted = fit(train, xi=candidate, as_of=validate["date"].min())
        rows = [
            fitted.outcome_probs(h, a)
            if fitted.knows(h) and fitted.knows(a)
            else np.array([0.45, 0.24, 0.31])
            for h, a in zip(validate["home"], validate["away"], strict=True)
        ]
        trace[candidate] = log_loss(np.vstack(rows), outcomes)

    best = min(trace, key=trace.__getitem__)
    log.info("xi tuned to %.4f (log-loss %.4f)", best, trace[best])
    return best, trace
