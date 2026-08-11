"""The provider adapter interface.

CLAUDE.md §4.1: "Build an adapter interface so the provider can be swapped in
one file. You will change provider at some point."

Everything downstream of this module speaks in the domain types below and knows
nothing about any vendor's JSON. Swapping provider = writing one new module that
satisfies `FixtureProvider` and changing one line in `providers/__init__.py`.

Team identity is resolved through `public.external_refs`, so a provider swap
never rewrites team or fixture primary keys.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Protocol, runtime_checkable


class FixtureStatus(StrEnum):
    """Mirrors the `public.fixture_status` Postgres enum."""

    SCHEDULED = "scheduled"
    LIVE = "live"
    FINISHED = "finished"
    POSTPONED = "postponed"
    CANCELLED = "cancelled"


@dataclass(frozen=True, slots=True)
class ProviderTeam:
    provider_id: str
    name: str
    short_name: str
    """Two or three characters, e.g. 'ARS'. Used by the §7.4 generated mark."""


@dataclass(frozen=True, slots=True)
class ProviderFixture:
    provider_id: str
    season: str
    gameweek: int
    home_provider_id: str
    away_provider_id: str
    kickoff_utc: datetime
    status: FixtureStatus
    home_goals: int | None = None
    away_goals: int | None = None
    minute: int | None = None

    def __post_init__(self) -> None:
        if self.kickoff_utc.tzinfo is None:
            raise ValueError("kickoff_utc must be timezone-aware")
        if self.status is FixtureStatus.FINISHED and (
            self.home_goals is None or self.away_goals is None
        ):
            raise ValueError(f"finished fixture {self.provider_id} has no score")


@dataclass(frozen=True, slots=True)
class HistoricalMatch:
    """One completed match from the training set.

    `market_*` are de-vigged closing implied probabilities. CLAUDE.md §2 [HARD]:
    these exist only as the §5.5 calibration benchmark. They are never written
    to a client-reachable table and never rendered.
    """

    date: datetime
    season: str
    home_name: str
    away_name: str
    home_goals: int
    away_goals: int
    market_home: float | None = None
    market_draw: float | None = None
    market_away: float | None = None

    @property
    def has_market(self) -> bool:
        return None not in (self.market_home, self.market_draw, self.market_away)


@runtime_checkable
class FixtureProvider(Protocol):
    """Live operational feed: fixtures, results, in-play scores."""

    name: str

    def fetch_teams(self, season: str) -> list[ProviderTeam]: ...

    def fetch_fixtures(self, season: str) -> list[ProviderFixture]: ...

    def fetch_results_since(self, since: datetime) -> list[ProviderFixture]: ...


@runtime_checkable
class HistoryProvider(Protocol):
    """Bulk historical training data. Read once, cached to Parquet."""

    name: str

    def fetch_seasons(self, seasons: list[str]) -> list[HistoricalMatch]: ...


def devig_1x2(
    odds_home: float, odds_draw: float, odds_away: float
) -> tuple[float, float, float]:
    """Convert decimal odds to de-vigged probabilities (multiplicative method).

    The raw reciprocals sum to >1 — the excess is the bookmaker's margin.
    Normalising removes it, yielding the market's honest probability estimate.
    This is the §5.5 baseline the model is measured against.

    >>> [round(p, 4) for p in devig_1x2(2.0, 4.0, 4.0)]
    [0.5, 0.25, 0.25]
    """
    if min(odds_home, odds_draw, odds_away) <= 1.0:
        raise ValueError("decimal odds must exceed 1.0")
    raw = (1 / odds_home, 1 / odds_draw, 1 / odds_away)
    overround = sum(raw)
    return (raw[0] / overround, raw[1] / overround, raw[2] / overround)


def utc_now() -> datetime:
    return datetime.now(UTC)
