"""Worker CLI.

    python -m premmodel backfill [--seasons 2023-24 2024-25]
    python -m premmodel ingest
    python -m premmodel gameweek --week 1
"""

from __future__ import annotations

import argparse
import logging
import sys

from premmodel.config import ConfigError
from premmodel.season import current_season


def main() -> int:
    parser = argparse.ArgumentParser(prog="premmodel")
    sub = parser.add_subparsers(dest="command", required=True)

    p_backfill = sub.add_parser("backfill", help="download the historical training set")
    p_backfill.add_argument("--seasons", nargs="*")

    sub.add_parser("ingest", help="pull teams + fixtures into Postgres")

    p_predict = sub.add_parser("predict", help="generate and store predictions")
    p_predict.add_argument("--season", default=None)
    p_predict.add_argument("--horizon-days", type=int, default=14)

    p_settle = sub.add_parser("settle", help="poll results and settle predictions")
    p_settle.add_argument("--season", default=None)

    p_gw = sub.add_parser("gameweek", help="print a gameweek from our own database")
    p_gw.add_argument("--week", type=int, default=1)
    p_gw.add_argument("--season", default=None)

    p_bt = sub.add_parser("backtest", help="walk-forward backtest vs the market baseline")
    p_bt.add_argument("--seasons", nargs="+", default=["2023-24", "2024-25"])
    p_bt.add_argument("--reliability", action="store_true", help="print the §5.5 curve")

    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    try:
        if args.command == "backfill":
            from premmodel.jobs.backfill import run

            run(args.seasons or None)
        elif args.command == "ingest":
            from premmodel.jobs.ingest_fixtures import run

            run()
        elif args.command == "predict":
            from premmodel.jobs.predict import run

            run(args.season, horizon_days=args.horizon_days)
        elif args.command == "settle":
            from premmodel.jobs.settle import run

            run(args.season)
        elif args.command == "gameweek":
            _print_gameweek(args.season or current_season(), args.week)
        elif args.command == "backtest":
            return _run_backtest(args.seasons, args.reliability)
    except ConfigError as exc:
        print(f"config error: {exc}", file=sys.stderr)
        return 2
    return 0


def _run_backtest(seasons: list[str], show_reliability: bool) -> int:
    """Phase 1 gate (§5.5, §11). Exit code is the gate verdict, so CI can
    refuse to promote a model that has regressed."""
    import pandas as pd

    from premmodel.calibration import backtest
    from premmodel.calibration.metrics import reliability_curve
    from premmodel.config import settings
    from premmodel.jobs.backfill import TRAINING_SET

    path = settings().data_dir / TRAINING_SET
    if not path.exists():
        print(f"no training set at {path} — run `premmodel backfill` first", file=sys.stderr)
        return 2

    history = pd.read_parquet(path)
    all_passed = True

    for season in seasons:
        result = backtest.run(history, test_season=season)
        print(result.report())
        all_passed &= result.gate.passed

        if show_reliability:
            print("  reliability (§5.5 chart data)")
            print("  predicted  observed      n")
            for b in reliability_curve(result.model_probs, result.outcomes):
                print(
                    f"    {b.mean_predicted:6.3f}    {b.observed_rate:6.3f}   {b.n:5d}"
                    f"   {'+' if b.gap >= 0 else '-'}{abs(b.gap):.3f}"
                )
            print("")

    print("=" * 62)
    print(f"PHASE 1 GATE: {'PASS' if all_passed else 'FAIL'}\n")
    return 0 if all_passed else 1


def _print_gameweek(season: str, week: int) -> None:
    from premmodel import db

    with db.connection() as conn:
        rows = db.fetch_gameweek(conn, season, week)

    if not rows:
        print(f"no fixtures for {season} gameweek {week} — run `premmodel ingest` first")
        return

    print(f"\n{season}  ·  Gameweek {week}\n" + "-" * 52)
    for r in rows:
        score = (
            f"{r['home_goals']}-{r['away_goals']}"
            if r["home_goals"] is not None
            else r["kickoff_utc"].strftime("%a %d %b %H:%M")
        )
        print(f"  {r['home_short']:>3}  v  {r['away_short']:<3}   {score:>16}   {r['status']}")
    print("-" * 52 + f"\n  {len(rows)} fixtures\n")


if __name__ == "__main__":
    raise SystemExit(main())
