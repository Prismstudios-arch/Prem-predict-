"""Season rollover (multi-year operation).

This app is intended to run for many seasons. Every one of these tests exists
because a hardcoded "2026-27" was found somewhere in the codebase — the failure
mode is not a crash, it is the app quietly serving last year's data in August.
"""

from __future__ import annotations

from datetime import date

import pytest

from premmodel.season import (
    FIRST_TRAINING_SEASON,
    completed_seasons,
    current_season,
    previous_season,
    season_label,
    season_start_year,
)


@pytest.mark.parametrize(
    ("today", "expected"),
    [
        (date(2026, 8, 21), "2026-27"),   # opening weekend
        (date(2026, 12, 26), "2026-27"),  # Boxing Day
        (date(2027, 1, 2), "2026-27"),    # new calendar year, same season
        (date(2027, 5, 24), "2026-27"),   # final day
        (date(2027, 6, 15), "2026-27"),   # close season, not yet rolled
        (date(2027, 7, 1), "2027-28"),    # rollover
        (date(2027, 8, 14), "2027-28"),   # next opening weekend
        (date(2030, 3, 3), "2029-30"),    # four years on, still right
    ],
)
def test_current_season_tracks_the_calendar(today, expected):
    assert current_season(today) == expected


def test_rollover_happens_before_fixtures_publish():
    """Fixtures for the new season appear in June/July. If the rollover were
    later, the ingest job would file them under the season that just ended."""
    assert current_season(date(2027, 6, 30)) == "2026-27"
    assert current_season(date(2027, 7, 1)) == "2027-28"


def test_season_label_roundtrips():
    for year in range(2010, 2040):
        assert season_start_year(season_label(year)) == year


def test_season_label_handles_the_century_edge():
    assert season_label(2099) == "2099-00"
    assert season_start_year("2099-00") == 2099


def test_previous_season():
    assert previous_season("2026-27") == "2025-26"
    assert previous_season("2000-01") == "1999-00"


def test_completed_seasons_excludes_the_one_in_progress():
    """Including a half-played season in the training set biases the fit
    toward whoever started well."""
    seasons = completed_seasons(date(2026, 12, 1))
    assert "2026-27" not in seasons
    assert seasons[-1] == "2025-26"


def test_completed_seasons_extends_automatically():
    """The original DEFAULT_SEASONS stopped at 2026 and would have silently
    frozen the training set."""
    in_2026 = completed_seasons(date(2026, 9, 1))
    in_2031 = completed_seasons(date(2031, 9, 1))
    assert len(in_2031) == len(in_2026) + 5
    assert "2030-31" in in_2031


def test_completed_seasons_starts_where_training_data_does():
    assert completed_seasons(date(2026, 9, 1))[0] == season_label(FIRST_TRAINING_SEASON)


def test_completed_seasons_is_ordered_and_unique():
    seasons = completed_seasons(date(2029, 1, 1))
    assert seasons == sorted(seasons)
    assert len(seasons) == len(set(seasons))


def test_no_module_imports_a_frozen_season():
    """Regression guard for the whole class of bug.

    A season baked into a default argument or module constant is evaluated once
    at import and never again — a cron worker that outlives 1 July would keep
    using the old one indefinitely.
    """
    import inspect

    from premmodel.jobs import ingest_fixtures, predict, settle

    for module in (ingest_fixtures, predict, settle):
        signature = inspect.signature(module.run)
        default = signature.parameters["season"].default
        assert default is None, (
            f"{module.__name__}.run has a baked-in season default ({default!r}); "
            "it must resolve current_season() at call time"
        )


def test_provisional_colours_are_deterministic_and_distinct():
    """Three clubs are promoted every summer. Their marks must be stable across
    runs and devices, and must not all look the same."""
    from premmodel.seed.teams import provisional_colours

    assert provisional_colours("some-new-club") == provisional_colours("some-new-club")

    generated = {provisional_colours(f"club-{i}") for i in range(10)}
    assert len(generated) > 1, "every unknown club would get an identical mark"

    for primary, secondary in generated:
        assert primary.startswith("#") and len(primary) == 7
        assert secondary.startswith("#") and len(secondary) == 7


def test_known_clubs_are_never_provisional():
    from premmodel.seed.teams import TEAM_COLOURS, colours_or_provisional

    for slug in list(TEAM_COLOURS)[:5]:
        colours, is_provisional = colours_or_provisional(slug)
        assert not is_provisional
        assert colours == TEAM_COLOURS[slug]


def test_unknown_club_is_flagged_not_rejected():
    """Hard-failing ingest on an uncatalogued club would take the fixture list
    down on the opening weekend of a new season."""
    from premmodel.seed.teams import colours_or_provisional

    colours, is_provisional = colours_or_provisional("newly-promoted-fc")
    assert is_provisional
    assert colours is not None
