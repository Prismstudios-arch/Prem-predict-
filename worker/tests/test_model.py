"""Model invariants (CLAUDE.md §10).

§10 makes three of these mandatory: probabilities sum to 1.0, the score matrix
is normalised, and calibration holds on a held-out season. The first two are
here; the third is `test_backtest.py`, which is slow and marked accordingly.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import numpy as np
import pandas as pd
import pytest

from premmodel.calibration.metrics import (
    accuracy,
    brier_score,
    check_gate,
    expected_calibration_error,
    log_loss,
    outcome_index,
    reliability_curve,
)
from premmodel.model import dixon_coles, elo, ensemble, priors

RNG = np.random.default_rng(20260821)


@pytest.fixture(scope="module")
def synthetic() -> pd.DataFrame:
    """A league with known strengths, so the fit has a right answer to find."""
    teams = [f"team-{i:02d}" for i in range(20)]
    true_attack = np.linspace(0.45, -0.45, 20)
    true_defence = np.linspace(0.35, -0.35, 20)
    home_adv = 0.26

    rows = []
    start = datetime(2022, 8, 1, tzinfo=UTC)
    for round_no in range(38):
        for i, home in enumerate(teams):
            away = teams[(i + round_no + 1) % 20]
            if home == away:
                continue
            lam = np.exp(true_attack[i] - true_defence[teams.index(away)] + home_adv)
            mu = np.exp(true_attack[teams.index(away)] - true_defence[i])
            rows.append(
                {
                    "date": start + timedelta(days=7 * round_no),
                    "season": "2022-23",
                    "home": home,
                    "away": away,
                    "home_goals": int(RNG.poisson(lam)),
                    "away_goals": int(RNG.poisson(mu)),
                }
            )
    return pd.DataFrame(rows)


# ------------------------------------------------------- score matrix (§10)


def test_score_matrix_is_normalised():
    matrix = dixon_coles.score_matrix_from_rates(1.6, 1.1, -0.05)
    assert matrix.sum() == pytest.approx(1.0)


def test_score_matrix_has_no_negative_cells():
    """The tau correction subtracts from four cells. With an extreme rho it
    could in principle drive one negative — that must never reach a user."""
    for rho in (-0.25, -0.1, 0.0, 0.1, 0.25):
        matrix = dixon_coles.score_matrix_from_rates(0.4, 0.35, rho)
        assert matrix.min() >= 0.0, f"negative cell at rho={rho}"


def test_outcome_probs_sum_to_one():
    matrix = dixon_coles.score_matrix_from_rates(2.1, 0.9, -0.08)
    assert dixon_coles.outcomes_from_matrix(matrix).sum() == pytest.approx(1.0)


def test_outcome_partition_is_exhaustive():
    """Home, draw and away must partition the matrix — no cell counted twice,
    none missed. A bug here silently misprices every match in the app."""
    matrix = dixon_coles.score_matrix_from_rates(1.4, 1.3, -0.03)
    home, draw, away = dixon_coles.outcomes_from_matrix(matrix)
    assert home + draw + away == pytest.approx(matrix.sum())


def test_stronger_home_side_is_favoured():
    strong = dixon_coles.outcomes_from_matrix(
        dixon_coles.score_matrix_from_rates(2.4, 0.7, -0.05)
    )
    weak = dixon_coles.outcomes_from_matrix(
        dixon_coles.score_matrix_from_rates(0.7, 2.4, -0.05)
    )
    assert strong[0] > strong[2]
    assert weak[2] > weak[0]


def test_tau_lifts_low_scoring_draws():
    """The entire point of Dixon-Coles (§5.1): independent Poisson underprices
    0-0 and 1-1. A negative rho must correct that upward."""
    independent = dixon_coles.score_matrix_from_rates(1.3, 1.1, 0.0)
    corrected = dixon_coles.score_matrix_from_rates(1.3, 1.1, -0.12)
    assert corrected[0, 0] > independent[0, 0]
    assert corrected[1, 1] > independent[1, 1]


def test_derived_markets_are_coherent():
    matrix = dixon_coles.score_matrix_from_rates(1.7, 1.2, -0.06)
    m = dixon_coles.derived_markets(matrix)
    for key in ("p_btts", "p_over_25", "p_home_cs", "p_away_cs"):
        assert 0.0 <= m[key] <= 1.0
    # Both teams scoring and either keeping a clean sheet are complementary.
    either_cs = m["p_home_cs"] + m["p_away_cs"] - float(matrix[0, 0])
    assert m["p_btts"] + either_cs == pytest.approx(1.0, abs=1e-9)
    assert m["exp_home_goals"] > m["exp_away_goals"]


def test_top_scorelines_are_ordered_and_sum_below_one():
    matrix = dixon_coles.score_matrix_from_rates(1.5, 1.2, -0.05)
    top = dixon_coles.top_scorelines(matrix, k=5)
    probs = [p for _, _, p in top]
    assert probs == sorted(probs, reverse=True)
    assert sum(probs) < 1.0


# --------------------------------------------------------------- DC fitting


def test_fit_recovers_known_strengths(synthetic):
    """The strongest synthetic side must come out strongest."""
    fitted = dixon_coles.fit(synthetic, xi=0.0)
    assert fitted.converged
    assert fitted.attack[fitted.index["team-00"]] > fitted.attack[fitted.index["team-19"]]
    assert fitted.home_adv > 0.0


def test_fit_attack_is_mean_centred(synthetic):
    """Identifiability guard — see the dixon_coles module docstring."""
    fitted = dixon_coles.fit(synthetic, xi=0.0)
    assert fitted.attack.mean() == pytest.approx(0.0, abs=1e-9)


def test_time_decay_reduces_effective_sample(synthetic):
    undecayed = dixon_coles.fit(synthetic, xi=0.0)
    decayed = dixon_coles.fit(synthetic, xi=0.004)
    assert decayed.effective_n < undecayed.effective_n
    assert undecayed.effective_n == pytest.approx(len(synthetic))


def test_every_fitted_pairing_produces_valid_probabilities(synthetic):
    """§10 mandatory: probabilities sum to 1.0 — checked across all 380
    orderings the fit can be asked about, not one sample."""
    fitted = dixon_coles.fit(synthetic, xi=0.0)
    for home in fitted.teams:
        for away in fitted.teams:
            if home == away:
                continue
            probs = fitted.outcome_probs(home, away)
            assert probs.sum() == pytest.approx(1.0)
            assert probs.min() >= 0.0


def test_analytic_gradient_matches_finite_differences(synthetic):
    """The fit supplies a closed-form gradient. If it is wrong the optimiser
    converges confidently to the wrong parameters and nothing downstream
    notices — so check it against numerical differentiation directly."""
    teams = sorted(set(synthetic["home"]) | set(synthetic["away"]))
    index = {t: i for i, t in enumerate(teams)}
    n = len(teams)

    args = (
        synthetic["home"].map(index).to_numpy(dtype=int),
        synthetic["away"].map(index).to_numpy(dtype=int),
        synthetic["home_goals"].to_numpy(dtype=float),
        synthetic["away_goals"].to_numpy(dtype=float),
        np.ones(len(synthetic)),
        n,
    )

    params = np.concatenate(
        [RNG.normal(0, 0.2, n), RNG.normal(0, 0.2, n), [0.25], [-0.06]]
    )
    _, analytic = dixon_coles._negative_log_likelihood(params, *args)

    step = 1e-6
    numeric = np.zeros_like(params)
    for i in range(len(params)):
        up, down = params.copy(), params.copy()
        up[i] += step
        down[i] -= step
        f_up, _ = dixon_coles._negative_log_likelihood(up, *args)
        f_down, _ = dixon_coles._negative_log_likelihood(down, *args)
        numeric[i] = (f_up - f_down) / (2 * step)

    # Mean-centring makes the attack gradient sum to zero by construction;
    # compare on relative scale to stay robust to the objective's magnitude.
    np.testing.assert_allclose(analytic, numeric, rtol=1e-4, atol=1e-3)


def test_fit_converges_on_a_full_league_season(synthetic):
    """Regression guard: 42 parameters with a numerical gradient exhausts
    L-BFGS-B's evaluation budget and returns unconverged."""
    fitted = dixon_coles.fit(synthetic, xi=dixon_coles.DEFAULT_XI)
    assert fitted.converged


def test_fit_rejects_empty_input():
    with pytest.raises(ValueError, match="empty"):
        dixon_coles.fit(pd.DataFrame(columns=["date", "home", "away", "home_goals", "away_goals"]))


# -------------------------------------------------------------------- Elo


def test_elo_is_zero_sum(synthetic):
    model = elo.EloModel()
    model.run(synthetic)
    assert sum(model.ratings.values()) == pytest.approx(
        elo.INITIAL_RATING * len(model.ratings), abs=1e-6
    )


def test_elo_ranks_the_stronger_side_higher(synthetic):
    model = elo.EloModel().run(synthetic)
    assert model.rating("team-00") > model.rating("team-19")


def test_elo_bigger_margin_moves_rating_more():
    narrow, wide = elo.EloModel(), elo.EloModel()
    narrow.update("a", "b", 1, 0)
    wide.update("a", "b", 5, 0)
    assert wide.rating("a") > narrow.rating("a")


def test_elo_link_produces_valid_probabilities(synthetic):
    model = elo.fit(synthetic)
    probs = model.outcome_probs("team-00", "team-19")
    assert probs.sum() == pytest.approx(1.0)
    assert probs[0] > probs[2]


def test_elo_draw_probability_peaks_for_even_matches(synthetic):
    model = elo.fit(synthetic)
    even = model.outcome_probs("team-09", "team-10")[1]
    lopsided = model.outcome_probs("team-00", "team-19")[1]
    assert even > lopsided


def test_elo_regression_to_mean_compresses_spread(synthetic):
    model = elo.EloModel().run(synthetic)
    before = np.std(list(model.ratings.values()))
    model.regress_to_mean(priors.SUMMER_SHRINKAGE)
    assert np.std(list(model.ratings.values())) < before


# --------------------------------------------------------------- ensemble


def test_blend_returns_valid_distribution():
    dc = np.array([[0.55, 0.25, 0.20], [0.20, 0.30, 0.50]])
    el = np.array([[0.45, 0.30, 0.25], [0.25, 0.25, 0.50]])
    w = ensemble.EnsembleWeights(0.6, 1.0, 0.0, 100)
    out = ensemble.blend(dc, el, w)
    assert np.allclose(out.sum(axis=1), 1.0)


def test_blend_at_w_one_recovers_dixon_coles():
    dc = np.array([[0.55, 0.25, 0.20]])
    el = np.array([[0.10, 0.10, 0.80]])
    out = ensemble.blend(dc, el, ensemble.EnsembleWeights(1.0, 1.0, 0.0, 1))
    assert out[0] == pytest.approx(dc[0], abs=1e-9)


def test_temperature_above_one_softens():
    dc = el = np.array([[0.70, 0.20, 0.10]])
    soft = ensemble.blend(dc, el, ensemble.EnsembleWeights(1.0, 2.0, 0.0, 1))
    assert soft[0, 0] < 0.70
    assert soft.sum() == pytest.approx(1.0)


def test_ensemble_fit_prefers_the_better_component():
    """Given one informative model and one that is pure noise, the fitted
    weight must move toward the informative one."""
    n = 600
    outcomes = RNG.choice(3, size=n)
    good = np.full((n, 3), 0.2)
    good[np.arange(n), outcomes] = 0.6
    noise = np.full((n, 3), 1 / 3)
    weights = ensemble.fit(good, noise, outcomes)
    assert weights.w_dixon_coles > 0.8


def test_ensemble_rejects_empty_input():
    with pytest.raises(ValueError, match="zero matches"):
        ensemble.fit(np.empty((0, 3)), np.empty((0, 3)), np.array([], dtype=int))


# ------------------------------------------------------- priors / §5.4


def test_prior_weight_follows_the_spec_schedule():
    assert priors.prior_weight(1) == pytest.approx(priors.PRIOR_WEIGHT_GW1)
    assert priors.prior_weight(priors.PRIOR_DECAY_ENDS_AT_GW) == 0.0
    assert priors.prior_weight(38) == 0.0


def test_prior_weight_decays_monotonically():
    weights = [priors.prior_weight(gw) for gw in range(1, 10)]
    assert all(a >= b for a, b in zip(weights[:-1], weights[1:], strict=True))


def test_data_regime_transitions():
    assert priors.data_regime(1) == "prior_heavy"
    assert priors.data_regime(5) == "blended"
    assert priors.data_regime(10) == "current"


def test_confidence_is_lower_in_gameweek_one():
    sharp = np.array([0.64, 0.22, 0.14])
    assert priors.confidence(1, sharp) < priors.confidence(20, sharp)


def test_confidence_is_driven_mainly_by_data_not_sharpness():
    """Confidence is epistemic. A well-evidenced even game must outrank a
    lopsided one guessed from nothing, or the UI tells users the model is
    unsure about Brighton-Burnley when what it is unsure about is August."""
    coin_toss_late = priors.confidence(20, np.array([1 / 3, 1 / 3, 1 / 3]))
    lopsided_gw1 = priors.confidence(1, np.array([0.75, 0.15, 0.10]))
    assert coin_toss_late > lopsided_gw1


def test_confidence_still_rewards_sharpness_slightly():
    gw = 20
    assert priors.confidence(gw, np.array([1 / 3, 1 / 3, 1 / 3])) < priors.confidence(
        gw, np.array([0.75, 0.15, 0.10])
    )


def test_confidence_label_matches_the_spec_copy():
    """§5.6 example: "Low confidence - first gameweek, limited data"."""
    band, reason = priors.confidence_label(1, priors.confidence(1, np.array([0.6, 0.25, 0.15])))
    assert band == "Low"
    assert reason == "first gameweek, limited data"


def test_confidence_label_explains_promoted_sides():
    _, reason = priors.confidence_label(3, 0.5, promoted_involved=True)
    assert "promoted" in reason


def test_confidence_label_bands_are_ordered():
    assert priors.confidence_label(20, 0.90)[0] == "High"
    assert priors.confidence_label(20, 0.55)[0] == "Medium"
    assert priors.confidence_label(20, 0.20)[0] == "Low"


def test_confidence_penalises_promoted_sides_early():
    probs = np.array([0.6, 0.25, 0.15])
    assert priors.confidence(2, probs, promoted_involved=True) < priors.confidence(2, probs)


def test_confidence_stays_in_range():
    for gw in range(1, 39):
        for probs in (np.array([1 / 3, 1 / 3, 1 / 3]), np.array([0.97, 0.02, 0.01])):
            assert 0.0 < priors.confidence(gw, probs) < 1.0


def test_regress_ratings_moves_toward_the_mean():
    out = priors.regress_ratings({"a": 100.0, "b": 0.0}, 0.35)
    assert out["a"] == pytest.approx(100 - 0.35 * 50)
    assert out["b"] == pytest.approx(0.35 * 50)


def test_blend_probabilities_is_prior_dominated_in_gw1():
    prior = np.array([0.7, 0.2, 0.1])
    current = np.array([0.1, 0.2, 0.7])
    blended = priors.blend_probabilities(prior, current, 1)
    assert blended[0] > blended[2]
    assert blended.sum() == pytest.approx(1.0)


def test_blend_probabilities_ignores_prior_by_gw8():
    prior = np.array([0.7, 0.2, 0.1])
    current = np.array([0.1, 0.2, 0.7])
    blended = priors.blend_probabilities(prior, current, 8)
    assert blended == pytest.approx(current)


# ------------------------------------------- promoted sides in GW1 (§5.4)


def test_unknown_club_still_gets_a_prediction(synthetic):
    """The GW1 case that matters: a promoted side the fit has never seen.

    §5.4 requires a prediction with widened confidence, not a skipped fixture —
    a blank card on opening weekend is the worst possible first impression.
    """
    from premmodel.jobs.predict import _fallback_rates

    fitted = dixon_coles.fit(synthetic, xi=0.0)
    lam, mu = _fallback_rates(fitted, "team-00", "newly-promoted-side")

    assert lam > 0 and mu > 0
    probs = dixon_coles.outcomes_from_matrix(
        dixon_coles.score_matrix_from_rates(lam, mu, fitted.rho)
    )
    assert probs.sum() == pytest.approx(1.0)
    # An unknown club is treated as league-average, so a strong home side
    # should still be favoured against it.
    assert probs[0] > probs[2]


def test_two_unknown_clubs_produce_a_near_neutral_line(synthetic):
    from premmodel.jobs.predict import _fallback_rates

    fitted = dixon_coles.fit(synthetic, xi=0.0)
    lam, mu = _fallback_rates(fitted, "promoted-a", "promoted-b")
    probs = dixon_coles.outcomes_from_matrix(
        dixon_coles.score_matrix_from_rates(lam, mu, fitted.rho)
    )
    # Both average: the only asymmetry left should be home advantage.
    assert probs[0] > probs[2]
    assert probs[0] - probs[2] < 0.35


def test_gw1_output_is_prior_dominated_and_low_confidence(synthetic):
    """End-to-end §5.4 check on the shape of a GW1 prediction."""
    fitted = dixon_coles.fit(synthetic, xi=0.0)
    current = fitted.outcome_probs("team-00", "team-19")
    prior = np.array([0.40, 0.27, 0.33])

    gw1 = priors.blend_probabilities(prior, current, 1)
    gw10 = priors.blend_probabilities(prior, current, 10)

    # GW1 must sit closer to the prior than to the current-season fit.
    assert np.abs(gw1 - prior).sum() < np.abs(gw1 - current).sum()
    assert gw10 == pytest.approx(current)
    assert priors.confidence(1, gw1, promoted_involved=True) < 0.5


# ---------------------------------------------------------------- metrics


def test_perfect_forecast_scores_zero():
    probs = np.array([[1.0, 0.0, 0.0], [0.0, 0.0, 1.0]])
    outcomes = np.array([0, 2])
    assert brier_score(probs, outcomes) == pytest.approx(0.0)
    assert accuracy(probs, outcomes) == 1.0


def test_uniform_forecast_matches_analytic_values():
    probs = np.full((100, 3), 1 / 3)
    outcomes = RNG.choice(3, size=100)
    assert brier_score(probs, outcomes) == pytest.approx(2 / 9, abs=1e-9)
    assert log_loss(probs, outcomes) == pytest.approx(np.log(3), abs=1e-9)


def test_brier_uses_the_mean_over_classes_convention():
    """Locks the scale BRIER_TOLERANCE is calibrated against.

    Both conventions exist: Brier's original sums over classes (uniform =
    0.667), the mean-over-classes form divides by three (uniform = 0.222). The
    published football reference band of ~0.19-0.20 for de-vigged closing odds
    is stated on the latter. Silently switching makes the Phase 1 gate three
    times looser or tighter than intended — which is how this was caught.
    """
    probs = np.full((10, 3), 1 / 3)
    outcomes = np.zeros(10, dtype=int)
    assert brier_score(probs, outcomes) == pytest.approx(2 / 9)
    # A perfectly confident correct forecast is 0 on either convention;
    # a perfectly confident wrong one separates them: 2/3 here, 2 if summed.
    assert brier_score(np.array([[0.0, 0.0, 1.0]]), np.array([0])) == pytest.approx(2 / 3)


def test_confident_and_wrong_is_punished_hardest():
    outcomes = np.array([0])
    assert log_loss(np.array([[0.01, 0.01, 0.98]]), outcomes) > log_loss(
        np.array([[1 / 3, 1 / 3, 1 / 3]]), outcomes
    )


def test_outcome_index_mapping():
    got = outcome_index(np.array([2, 1, 0]), np.array([0, 1, 2]))
    assert list(got) == [0, 1, 2]


def test_metrics_reject_unnormalised_probabilities():
    with pytest.raises(ValueError, match="sum to 1"):
        brier_score(np.array([[0.5, 0.3, 0.1]]), np.array([0]))


def test_metrics_reject_nan():
    with pytest.raises(ValueError, match="NaN"):
        brier_score(np.array([[np.nan, 0.5, 0.5]]), np.array([0]))


def test_reliability_curve_is_well_calibrated_for_honest_forecasts():
    n = 20000
    p_home = RNG.uniform(0.1, 0.8, size=n)
    remainder = 1 - p_home
    probs = np.column_stack([p_home, remainder * 0.4, remainder * 0.6])
    outcomes = np.array([RNG.choice(3, p=row) for row in probs])

    for bin_ in reliability_curve(probs, outcomes, n_bins=10):
        if bin_.n > 200:
            assert abs(bin_.gap) < 0.05, f"bin {bin_.lower:.1f} off by {bin_.gap:+.3f}"
    assert expected_calibration_error(probs, outcomes) < 0.03


def test_gate_fails_without_a_market_baseline():
    """§5.5: the gate is defined relative to the market. With no baseline it
    must fail rather than quietly pass."""
    probs = np.full((10, 3), 1 / 3)
    result = check_gate(probs, RNG.choice(3, size=10), None)
    assert not result.passed
    assert "no market baseline" in result.reasons[0]


def test_gate_passes_when_model_matches_market():
    n = 400
    outcomes = RNG.choice(3, size=n)
    probs = np.full((n, 3), 0.2)
    probs[np.arange(n), outcomes] = 0.6
    result = check_gate(probs, outcomes, probs.copy())
    assert result.passed
    assert result.brier_gap == pytest.approx(0.0)


def test_gate_fails_a_materially_worse_model():
    n = 400
    outcomes = RNG.choice(3, size=n)
    market = np.full((n, 3), 0.15)
    market[np.arange(n), outcomes] = 0.70
    result = check_gate(np.full((n, 3), 1 / 3), outcomes, market)
    assert not result.passed
