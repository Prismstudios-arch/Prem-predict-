"""Historical backfill — the Phase 1 training set (CLAUDE.md §4.1, §5).

Downloads N seasons of results and closing odds, caches to Parquet, and reports
coverage. Completed seasons never change, so this is safe to re-run.

Nothing here touches Postgres: the training set lives on disk and feeds the
model fit. Only fitted outputs (team_ratings, model.predictions) reach the DB.
"""

from __future__ import annotations

import argparse
import logging

import pandas as pd

from premmodel.config import settings
from premmodel.providers import get_history_provider

log = logging.getLogger(__name__)

def default_seasons() -> list[str]:
    """Every completed season, recomputed on each run.

    Previously a module-level list ending at 2026, which would have quietly
    stopped extending the training set the moment the 2026-27 season finished —
    the model would keep fitting on ever-staler data with no error anywhere.
    """
    from premmodel.season import completed_seasons

    return completed_seasons()

TRAINING_SET = "training_matches.parquet"


def run(seasons: list[str] | None = None) -> pd.DataFrame:
    seasons = seasons or default_seasons()
    provider = get_history_provider()
    matches = provider.fetch_seasons(seasons)

    frame = pd.DataFrame(
        [
            {
                "date": m.date,
                "season": m.season,
                "home": m.home_name,
                "away": m.away_name,
                "home_goals": m.home_goals,
                "away_goals": m.away_goals,
                "market_home": m.market_home,
                "market_draw": m.market_draw,
                "market_away": m.market_away,
            }
            for m in matches
        ]
    ).sort_values("date", ignore_index=True)

    out_path = settings().data_dir / TRAINING_SET
    frame.to_parquet(out_path, index=False)

    _report(frame, out_path)
    return frame


def _report(frame: pd.DataFrame, path: object) -> None:
    with_market = frame["market_home"].notna().sum()
    log.info("--- backfill summary ---")
    log.info("matches:        %d", len(frame))
    log.info("seasons:        %d (%s -> %s)", frame["season"].nunique(),
             frame["season"].min(), frame["season"].max())
    log.info("distinct clubs: %d", pd.concat([frame["home"], frame["away"]]).nunique())
    log.info("market odds:    %d (%.1f%%)", with_market, 100 * with_market / max(len(frame), 1))
    log.info("home win rate:  %.3f", (frame["home_goals"] > frame["away_goals"]).mean())
    log.info("draw rate:      %.3f", (frame["home_goals"] == frame["away_goals"]).mean())
    log.info("goals/match:    %.3f", (frame["home_goals"] + frame["away_goals"]).mean())
    log.info("written to:     %s", path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill the historical training set.")
    parser.add_argument("--seasons", nargs="*", help="e.g. 2023-24 2024-25")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    run(args.seasons or None)


if __name__ == "__main__":
    main()
