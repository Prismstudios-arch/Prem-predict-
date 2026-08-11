"""Provider selection — the one file you change to swap vendor (CLAUDE.md §4.1).

Nothing else in the codebase imports a concrete provider module.
"""

from __future__ import annotations

from premmodel.providers.base import (
    FixtureProvider,
    FixtureStatus,
    HistoricalMatch,
    HistoryProvider,
    ProviderFixture,
    ProviderTeam,
)
from premmodel.providers.fd_couk_csv import FootballDataCoUkProvider
from premmodel.providers.football_data_org import FootballDataOrgProvider

__all__ = [
    "FixtureProvider",
    "FixtureStatus",
    "HistoricalMatch",
    "HistoryProvider",
    "ProviderFixture",
    "ProviderTeam",
    "get_fixture_provider",
    "get_history_provider",
]


def get_fixture_provider() -> FixtureProvider:
    """The live operational feed.

    To swap vendor: implement the FixtureProvider protocol in a new module and
    return it here. Team identity is held in public.external_refs, so no primary
    key is rewritten and no downstream code changes.
    """
    return FootballDataOrgProvider()


def get_history_provider() -> HistoryProvider:
    """The bulk historical training set (§5, §5.5 market baseline)."""
    return FootballDataCoUkProvider()
