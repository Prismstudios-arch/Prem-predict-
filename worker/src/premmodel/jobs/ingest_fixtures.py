"""Fixture + team ingest (CLAUDE.md §4.2, the 02:00 UTC daily job).

Phase 0 scope: teams and fixtures only. Results settlement is Phase 3, model
fitting is Phase 1.
"""

from __future__ import annotations

import logging

from premmodel import db
from premmodel.providers import get_fixture_provider
from premmodel.season import current_season
from premmodel.seed.teams import TEAM_COLOURS

log = logging.getLogger(__name__)


def run(season: str | None = None) -> dict[str, int]:
    season = season or current_season()
    provider = get_fixture_provider()
    try:
        teams = provider.fetch_teams(season)
        fixtures = provider.fetch_fixtures(season)
    finally:
        close = getattr(provider, "close", None)
        if callable(close):
            close()

    with db.connection() as conn:
        team_ids = db.upsert_teams(conn, provider.name, teams, TEAM_COLOURS)
        written = db.upsert_fixtures(conn, provider.name, fixtures, team_ids)

    summary = {"teams": len(team_ids), "fixtures": written}
    log.info("ingest complete: %s", summary)
    return summary


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    run()
