"""Matchday polling and settlement (CLAUDE.md §4.2, §6.1).

Runs every 60 seconds on a matchday: poll results, update fixtures, settle any
match that has finished, roll up the gameweek, recompute streaks.

All scoring happens in Postgres (0004_settlement.sql). This module decides
*when* to settle; it never decides *what* a prediction is worth. That split is
why the leaderboard, the results screen and this job can never disagree.

Two properties this job must have, because it runs unattended every minute:

  Idempotent — settle_fixture only touches rows where settled_at is null, so a
  retry after a partial failure cannot double-award points.

  Never guesses — a fixture the provider reports as finished with no score is
  left alone. Settling a match on a missing scoreline is unrecoverable once
  users have seen their points move.
"""

from __future__ import annotations

import argparse
import logging
from datetime import UTC, datetime, timedelta

from premmodel import db
from premmodel.providers import FixtureStatus, get_fixture_provider
from premmodel.season import current_season

log = logging.getLogger(__name__)

LOOKBACK_HOURS = 6
"""How far back to re-poll. Wide enough to catch a match that finished while
the worker was down, narrow enough to stay well inside the rate limit."""


def run(season: str | None = None) -> dict[str, int]:
    season = season or current_season()
    provider = get_fixture_provider()
    try:
        since = datetime.now(UTC) - timedelta(hours=LOOKBACK_HOURS)
        results = provider.fetch_results_since(since)
    finally:
        close = getattr(provider, "close", None)
        if callable(close):
            close()

    finished = [r for r in results if r.status is FixtureStatus.FINISHED]
    live = [r for r in results if r.status is FixtureStatus.LIVE]
    log.info("polled %d fixtures (%d finished, %d live)", len(results), len(finished), len(live))

    settled_rows = 0
    touched_gameweeks: set[int] = set()

    with db.connection() as conn:
        team_ids = db.resolve_external_ids(
            conn,
            provider.name,
            "team",
            [r.home_provider_id for r in results] + [r.away_provider_id for r in results],
        )
        written = db.upsert_fixtures(conn, provider.name, results, team_ids)

        for fixture in finished:
            row = conn.execute(
                """
                select f.id, f.gameweek
                from public.external_refs er
                join public.fixtures f on f.id = er.entity_id
                where er.provider = %s and er.entity_kind = 'fixture'
                  and er.provider_id = %s
                """,
                (provider.name, fixture.provider_id),
            ).fetchone()
            if row is None:
                log.warning("finished fixture %s is not mapped; skipping", fixture.provider_id)
                continue

            count = conn.execute(
                "select public.settle_fixture(%s) as settled", (row["id"],)
            ).fetchone()
            settled = int(count["settled"]) if count else 0
            if settled:
                log.info("settled %d predictions for fixture %s", settled, row["id"])
            settled_rows += settled
            touched_gameweeks.add(int(row["gameweek"]))

        for gameweek in sorted(touched_gameweeks):
            users = conn.execute(
                "select public.rollup_gameweek(%s, %s) as n", (season, gameweek)
            ).fetchone()
            log.info("rolled up gw %d for %s users", gameweek, users["n"] if users else 0)

        if touched_gameweeks:
            conn.execute("select public.recompute_streaks(%s)", (season,))

    summary = {
        "polled": len(results),
        "fixtures_written": written,
        "predictions_settled": settled_rows,
        "gameweeks_rolled_up": len(touched_gameweeks),
    }
    log.info("settlement complete: %s", summary)
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Poll results and settle predictions.")
    parser.add_argument("--season", default=None)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    run(args.season)


if __name__ == "__main__":
    main()
