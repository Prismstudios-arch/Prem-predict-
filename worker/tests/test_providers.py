"""Phase 0 tests: the adapter contract and the market-baseline maths.

Model calibration tests arrive in Phase 1 (CLAUDE.md §10).
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from premmodel.providers.base import (
    FixtureStatus,
    HistoricalMatch,
    ProviderFixture,
    devig_1x2,
)
from premmodel.providers.fd_couk_csv import canonical_slug, season_code
from premmodel.providers.football_data_org import FootballDataOrgProvider

# ------------------------------------------------------------------ de-vigging


def test_devig_removes_overround_and_normalises():
    p = devig_1x2(2.10, 3.40, 3.80)
    assert sum(p) == pytest.approx(1.0)
    assert all(0 < x < 1 for x in p)


def test_devig_is_monotonic_in_price():
    """Shorter odds must yield a higher probability."""
    short, _, long_ = devig_1x2(1.50, 4.00, 7.00)
    assert short > long_


def test_devig_fair_book_is_unchanged():
    assert list(devig_1x2(2.0, 4.0, 4.0)) == pytest.approx([0.5, 0.25, 0.25])


@pytest.mark.parametrize("bad", [(1.0, 3.0, 3.0), (2.0, 0.5, 3.0), (2.0, 3.0, -1.0)])
def test_devig_rejects_impossible_prices(bad):
    with pytest.raises(ValueError):
        devig_1x2(*bad)


# ------------------------------------------------------- team name resolution


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Man City", "manchester-city"),
        ("Manchester City FC", "manchester-city"),
        ("Man United", "manchester-united"),
        ("Manchester United FC", "manchester-united"),
        ("Nott'm Forest", "nottingham-forest"),
        ("Nottingham Forest FC", "nottingham-forest"),
        ("Spurs", "tottenham-hotspur"),
        ("Tottenham Hotspur FC", "tottenham-hotspur"),
        ("Brighton", "brighton-and-hove-albion"),
        ("Brighton & Hove Albion FC", "brighton-and-hove-albion"),
        ("Arsenal", "arsenal"),
        ("Arsenal FC", "arsenal"),
        ("Bournemouth", "afc-bournemouth"),
    ],
)
def test_both_providers_resolve_to_one_slug(raw, expected):
    """The historical CSVs and the live feed must agree on team identity,
    or the model trains on one club and predicts for another."""
    assert canonical_slug(raw) == expected


def test_every_seeded_slug_is_stable_under_canonicalisation():
    from premmodel.seed.teams import TEAM_COLOURS

    for slug in TEAM_COLOURS:
        assert canonical_slug(slug) == slug, f"{slug} is not a fixed point"


def test_season_code():
    assert season_code("2024-25") == "2425"
    assert season_code("2009-10") == "0910"


# --------------------------------------------------------------- fixture types


def test_finished_fixture_without_score_is_rejected():
    with pytest.raises(ValueError, match="no score"):
        ProviderFixture(
            provider_id="1", season="2026-27", gameweek=1,
            home_provider_id="a", away_provider_id="b",
            kickoff_utc=datetime.now(UTC), status=FixtureStatus.FINISHED,
        )


def test_naive_kickoff_is_rejected():
    """§2 [HARD]: lock uses server time. A naive datetime is a silent
    timezone bug waiting to let someone submit after kickoff."""
    with pytest.raises(ValueError, match="timezone-aware"):
        ProviderFixture(
            provider_id="1", season="2026-27", gameweek=1,
            home_provider_id="a", away_provider_id="b",
            kickoff_utc=datetime(2026, 8, 21, 19, 0), status=FixtureStatus.SCHEDULED,
        )


# ------------------------------------------------------- football-data.org parse


def _match(**overrides) -> dict:
    base = {
        "id": 497001,
        "utcDate": "2026-08-21T19:00:00Z",
        "status": "SCHEDULED",
        "matchday": 1,
        "homeTeam": {"id": 57, "name": "Arsenal FC", "tla": "ARS"},
        "awayTeam": {"id": 1076, "name": "Coventry City FC", "tla": "COV"},
        "score": {"fullTime": {"home": None, "away": None}},
    }
    return base | overrides


def test_parse_scheduled_match():
    fx = FootballDataOrgProvider._parse_match(_match(), "2026-27")
    assert fx.provider_id == "497001"
    assert fx.status is FixtureStatus.SCHEDULED
    assert fx.kickoff_utc.tzinfo is not None
    assert fx.kickoff_utc == datetime(2026, 8, 21, 19, 0, tzinfo=UTC)
    assert fx.gameweek == 1


def test_parse_finished_match():
    fx = FootballDataOrgProvider._parse_match(
        _match(status="FINISHED", score={"fullTime": {"home": 2, "away": 0}}), "2026-27"
    )
    assert fx.status is FixtureStatus.FINISHED
    assert (fx.home_goals, fx.away_goals) == (2, 0)


def test_finished_without_score_degrades_to_scheduled_not_crash():
    """§13 provider-outage row: bad upstream data must degrade, not take
    the ingest job down."""
    fx = FootballDataOrgProvider._parse_match(
        _match(status="FINISHED", score={"fullTime": {"home": None, "away": None}}), "2026-27"
    )
    assert fx.status is FixtureStatus.SCHEDULED


def test_unknown_status_defaults_to_scheduled():
    fx = FootballDataOrgProvider._parse_match(_match(status="SOMETHING_NEW"), "2026-27")
    assert fx.status is FixtureStatus.SCHEDULED


def test_live_statuses_map_to_live():
    for raw in ("IN_PLAY", "PAUSED"):
        fx = FootballDataOrgProvider._parse_match(
            _match(status=raw, score={"fullTime": {"home": 1, "away": 1}}), "2026-27"
        )
        assert fx.status is FixtureStatus.LIVE


# --------------------------------------------------------------- odds handling


def test_historical_match_flags_missing_market():
    m = HistoricalMatch(
        date=datetime.now(UTC), season="2024-25", home_name="arsenal",
        away_name="chelsea", home_goals=1, away_goals=1,
    )
    assert not m.has_market

    priced = HistoricalMatch(
        date=datetime.now(UTC), season="2024-25", home_name="arsenal",
        away_name="chelsea", home_goals=1, away_goals=1,
        market_home=0.5, market_draw=0.25, market_away=0.25,
    )
    assert priced.has_market


def test_historical_match_carries_probabilities_not_prices():
    """§2 [HARD]: no odds may ever reach a client. The domain type holds
    de-vigged probabilities, so there is no price to leak by accident."""
    fields = HistoricalMatch.__dataclass_fields__
    assert not any("odds" in f or "price" in f for f in fields)
