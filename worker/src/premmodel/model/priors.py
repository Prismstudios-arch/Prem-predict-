"""The early-season problem (CLAUDE.md §5.4).

On the opening weekend there are zero matches of current-season data and three
promoted sides with no top-flight form at all. A model fitted naively on that
outputs garbage in the one week most people are watching.

Four mechanisms, in the order §5.4 specifies:

1. Summer regression — carry prior-season ratings over, shrunk toward the
   league mean. Squads change, managers change, and last May's table is a
   biased estimate of this August's strength.

2. Promoted-side priors — fit the same Dixon-Coles machinery to the
   Championship, discount it to top-flight terms, then shrink hard.
   The discount is *measured from history*, not guessed: see
   `estimate_promotion_penalty`.

3. Blend weight — GW1 predictions are ~90% prior, decaying to ~0% by GW8 as
   current-season data accumulates.

4. Confidence — deliberately widened in GW1-6 and surfaced in the UI. §5.4:
   "honest uncertainty builds far more trust than false precision."
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

SUMMER_SHRINKAGE = 0.35
"""§5.4: ~35% regression toward the league mean over the close season."""

PROMOTED_EXTRA_SHRINKAGE = 0.50
"""Applied on top of the conversion factor. A promoted side's Championship
form is the weakest evidence in the dataset — it is measured against opponents
none of whom are in this league."""

PRIOR_WEIGHT_GW1 = 0.90
PRIOR_DECAY_ENDS_AT_GW = 8
"""§5.4: ~90% prior in GW1, ~0% by GW8."""


# ------------------------------------------------------------ summer carry-over


def regress_ratings(values: dict[str, float], shrinkage: float) -> dict[str, float]:
    """Shrink each rating toward the mean of the group."""
    if not values:
        return {}
    mean = float(np.mean(list(values.values())))
    return {k: v + shrinkage * (mean - v) for k, v in values.items()}


# ----------------------------------------------------------- promoted sides


@dataclass(frozen=True, slots=True)
class PromotionPenalty:
    attack_delta: float
    defence_delta: float
    conversion: float
    n_seasons: int
    n_clubs: int

    def describe(self) -> str:
        return (
            f"promoted sides: attack {self.attack_delta:+.3f}, "
            f"defence {self.defence_delta:+.3f} vs league mean "
            f"(conversion {self.conversion:.2f}, "
            f"{self.n_clubs} clubs over {self.n_seasons} seasons)"
        )


def identify_promoted(history: pd.DataFrame) -> dict[str, set[str]]:
    """Season -> clubs that were not in the previous season's top flight."""
    seasons = sorted(history["season"].unique())
    members = {
        s: set(history.loc[history["season"] == s, "home"].unique()) for s in seasons
    }
    return {
        season: members[season] - members[previous]
        for previous, season in zip(seasons[:-1], seasons[1:], strict=True)
    }


def estimate_promotion_penalty(
    history: pd.DataFrame, *, conversion: float = 0.70
) -> PromotionPenalty:
    """Measure how promoted sides actually perform, rather than assuming.

    §5.4 offers a 0.65-0.75 league-strength conversion factor as a starting
    point. That handles *relative* standing within the Championship, but not
    the level gap — the entire second tier sits below top-flight average. This
    fits Dixon-Coles per season and reads off where promoted clubs landed
    relative to the league mean, which is the level gap, measured.
    """
    from premmodel.model.dixon_coles import fit as fit_dc

    promoted_by_season = identify_promoted(history)
    attack_deltas: list[float] = []
    defence_deltas: list[float] = []
    club_count = 0

    for season, promoted in promoted_by_season.items():
        if not promoted:
            continue
        season_matches = history[history["season"] == season]
        if len(season_matches) < 200:
            continue
        fitted = fit_dc(season_matches)
        for club in promoted:
            if not fitted.knows(club):
                continue
            i = fitted.index[club]
            attack_deltas.append(float(fitted.attack[i]))
            defence_deltas.append(float(fitted.defence[i] - fitted.defence.mean()))
            club_count += 1

    if not attack_deltas:
        log.warning("no promoted-side history found; falling back to conversion only")
        return PromotionPenalty(0.0, 0.0, conversion, 0, 0)

    penalty = PromotionPenalty(
        attack_delta=float(np.mean(attack_deltas)),
        defence_delta=float(np.mean(defence_deltas)),
        conversion=conversion,
        n_seasons=len(promoted_by_season),
        n_clubs=club_count,
    )
    log.info("%s", penalty.describe())
    return penalty


def promoted_priors(
    championship_ratings: dict[str, tuple[float, float]],
    penalty: PromotionPenalty,
) -> dict[str, tuple[float, float]]:
    """Championship (attack, defence) -> top-flight prior.

    Two steps, both necessary:
      scale  — Championship spread is compressed to top-flight terms
      shift  — the measured level gap is applied
    then everything is shrunk again, because this is still the least
    trustworthy evidence in the model.
    """
    out: dict[str, tuple[float, float]] = {}
    keep = 1.0 - PROMOTED_EXTRA_SHRINKAGE
    for club, (attack, defence) in championship_ratings.items():
        scaled_attack = penalty.conversion * attack + penalty.attack_delta
        scaled_defence = penalty.conversion * defence + penalty.defence_delta
        out[club] = (keep * scaled_attack, keep * scaled_defence)
    return out


# ------------------------------------------------------------- blend schedule


def prior_weight(gameweek: int) -> float:
    """§5.4: ~0.90 at GW1, reaching 0 at GW8.

    Cosine rather than linear so the handover is gentle at both ends — a linear
    ramp produces a visible weekly lurch in published probabilities, which
    looks like the model changing its mind rather than learning.
    """
    if gameweek <= 1:
        return PRIOR_WEIGHT_GW1
    if gameweek >= PRIOR_DECAY_ENDS_AT_GW:
        return 0.0
    progress = (gameweek - 1) / (PRIOR_DECAY_ENDS_AT_GW - 1)
    return PRIOR_WEIGHT_GW1 * 0.5 * (1.0 + np.cos(np.pi * progress))


def data_regime(gameweek: int) -> str:
    """Drives the §5.6 honesty copy and the `data_regime` column."""
    weight = prior_weight(gameweek)
    if weight >= 0.6:
        return "prior_heavy"
    if weight > 0.0:
        return "blended"
    return "current"


def confidence(
    gameweek: int,
    probs: np.ndarray,
    *,
    promoted_involved: bool = False,
) -> float:
    """How much the model trusts its own estimate, on 0-1.

    This is *epistemic* — it answers "how good is our evidence", not "how
    lopsided is this match". Sharpness is already visible in the probability
    bar; repeating it here would double-count it and make a well-evidenced
    34/33/33 look like a failure of the model rather than an honest read of a
    genuinely even game.

    So it is driven mainly by how much current-season data exists (§5.4), with
    a small sharpness term because a near-uniform line does carry slightly less
    information, and a penalty when a promoted side is involved and the prior
    is at its weakest.
    """
    entropy = float(-np.sum(probs * np.log(np.clip(probs, 1e-12, 1.0))))
    sharpness = 1.0 - entropy / np.log(3.0)          # 0 = uniform, 1 = certain
    data_maturity = 1.0 - prior_weight(gameweek) / PRIOR_WEIGHT_GW1

    value = 0.30 + 0.55 * data_maturity + 0.15 * sharpness
    if promoted_involved and gameweek < PRIOR_DECAY_ENDS_AT_GW:
        value -= 0.08
    return float(np.clip(value, 0.05, 0.95))


CONFIDENCE_BANDS = ((0.66, "High"), (0.45, "Medium"), (0.0, "Low"))


def confidence_label(
    gameweek: int, value: float, *, promoted_involved: bool = False
) -> tuple[str, str]:
    """Band plus the reason, matching the §5.6 copy pattern exactly:

        ("Low", "first gameweek, limited data")

    A bare percentage invites the reading "the model is 16% sure Brighton win",
    which is not what it means. A band and a reason cannot be misread that way.
    """
    band = next(name for threshold, name in CONFIDENCE_BANDS if value >= threshold)

    if gameweek <= 1:
        reason = "first gameweek, limited data"
    elif promoted_involved and gameweek < PRIOR_DECAY_ENDS_AT_GW:
        reason = "promoted side, little top-flight form"
    elif gameweek < PRIOR_DECAY_ENDS_AT_GW:
        reason = f"early season, {gameweek - 1} week(s) of data"
    else:
        reason = "full season of data"
    return band, reason


def blend_probabilities(
    prior_probs: np.ndarray, current_probs: np.ndarray, gameweek: int
) -> np.ndarray:
    w = prior_weight(gameweek)
    mixed = w * prior_probs + (1.0 - w) * current_probs
    return mixed / mixed.sum(axis=-1, keepdims=True)
