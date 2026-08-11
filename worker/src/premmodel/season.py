"""Season arithmetic.

This app is intended to run for years, not for one season. Every hardcoded
"2026-27" is a time bomb that detonates the following August, in the week the
app is under most load and getting most attention. So the current season is
*derived* from the date, and every job defaults to whatever that is today.

Season identifiers are "YYYY-YY" (e.g. "2026-27") because that is what
football-data.co.uk and the fixtures table use. football-data.org keys seasons
by the starting year alone, which is why both conversions live here rather than
being reimplemented per provider.

The rollover boundary is 1 July. The English top flight runs August to May;
fixtures publish mid-June and pre-season starts in July. Rolling over on 1 July
means the new season's fixtures can be ingested as soon as they are published,
and there is never a window where "current season" points at one that finished.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

SEASON_ROLLOVER_MONTH = 7
"""July. See the module docstring for why."""

FIRST_TRAINING_SEASON = 2010
"""How far back the training set reaches. Earlier data exists but the game has
changed enough that it adds noise faster than signal, and the time-decay weight
at 15+ years is negligible anyway."""


def season_label(start_year: int) -> str:
    """2026 -> '2026-27'."""
    return f"{start_year}-{str(start_year + 1)[-2:]}"


def season_start_year(label: str) -> int:
    """'2026-27' -> 2026."""
    return int(label.split("-")[0])


def current_season(today: date | None = None) -> str:
    """The season we are in or about to enter.

    >>> current_season(date(2026, 8, 21))
    '2026-27'
    >>> current_season(date(2027, 5, 20))    # end of the same season
    '2026-27'
    >>> current_season(date(2027, 7, 1))     # rollover
    '2027-28'
    """
    today = today or datetime.now(UTC).date()
    start_year = today.year if today.month >= SEASON_ROLLOVER_MONTH else today.year - 1
    return season_label(start_year)


def previous_season(label: str) -> str:
    return season_label(season_start_year(label) - 1)


def completed_seasons(today: date | None = None) -> list[str]:
    """Every season with a full set of results, oldest first.

    The current season is excluded: it is partially played, and including it in
    the training set as though complete would bias the fit toward whoever
    started well.
    """
    today = today or datetime.now(UTC).date()
    last_complete = season_start_year(current_season(today)) - 1
    return [season_label(y) for y in range(FIRST_TRAINING_SEASON, last_complete + 1)]


def is_preseason(today: date | None = None) -> bool:
    """True between rollover and the first match of the new season.

    Used to decide whether to expect fixtures to exist yet, so a July cron run
    reports "fixtures not published" rather than "ingest failed".
    """
    today = today or datetime.now(UTC).date()
    return today.month in (SEASON_ROLLOVER_MONTH, 8) and today.month == SEASON_ROLLOVER_MONTH
