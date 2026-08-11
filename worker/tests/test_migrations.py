"""Parse every migration with the real PostgreSQL grammar.

pglast wraps libpg_query — the actual parser from the PostgreSQL server — so a
file that passes here is genuinely syntactically valid, not merely
plausible-looking. Without this, a typo in an RLS policy is discovered when the
migration is applied to the live project, which is the worst possible moment.

This does not check semantics: it cannot know that a referenced table exists.
CI applies the migrations to a real Postgres service for that (.github/ci.yml).
What it does catch, in under a second and on Windows with no database, is the
class of error that actually happens when hand-writing 600 lines of SQL.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from pglast import parse_sql
from pglast.parser import ParseError

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "supabase" / "migrations"

MIGRATIONS = sorted(MIGRATIONS_DIR.glob("*.sql"))


def _normalised_sql() -> str:
    """All migrations, lowercased with runs of whitespace collapsed.

    The migrations align statements in columns for readability, so a literal
    substring search would depend on how many spaces happen to be between two
    keywords. Collapsing first makes these assertions about SQL rather than
    about formatting.
    """
    combined = "\n".join(p.read_text(encoding="utf-8") for p in MIGRATIONS)
    return re.sub(r"\s+", " ", combined.lower())


def test_migrations_directory_is_not_empty():
    assert MIGRATIONS, f"no migrations found in {MIGRATIONS_DIR}"


@pytest.mark.parametrize("path", MIGRATIONS, ids=lambda p: p.name)
def test_migration_parses(path: Path):
    sql = path.read_text(encoding="utf-8")
    try:
        statements = parse_sql(sql)
    except ParseError as exc:  # pragma: no cover - failure path
        pytest.fail(f"{path.name} failed to parse: {exc}")
    assert statements, f"{path.name} parsed to zero statements"


@pytest.mark.parametrize("path", MIGRATIONS, ids=lambda p: p.name)
def test_migration_is_ordered_and_named(path: Path):
    assert path.stem[:4].isdigit(), f"{path.name} must start with a 4-digit ordinal"


def test_rls_is_enabled_on_every_user_table():
    """§9.2 [HARD]: RLS on every table containing user data, default deny.

    Reads the migration text rather than a live catalogue, so it holds before
    anything is deployed. A new user table added without an ENABLE ROW LEVEL
    SECURITY line fails here rather than shipping wide open.
    """
    combined = _normalised_sql()

    user_tables = [
        "public.users",
        "public.user_predictions",
        "public.gameweek_scores",
        "public.push_tokens",
        "public.leagues",
        "public.league_members",
        "public.entitlement_events",
    ]
    for table in user_tables:
        assert f"alter table {table} enable row level security" in combined, (
            f"{table} has no RLS — §9.2 [HARD] requires it on every user table"
        )


def test_predictions_live_outside_the_exposed_schema():
    """§9.2 [HARD]: premium data must be ABSENT from an unentitled response.

    That guarantee rests entirely on model.predictions not being reachable via
    PostgREST. If it were ever moved to `public`, the gated views become
    decoration and any client could read the full payload directly.
    """
    combined = _normalised_sql()
    assert "create table model.predictions" in combined
    assert "create table public.predictions" not in combined


def test_prediction_lock_uses_server_time():
    """§2 [HARD]: the lock must be evaluated by the database clock."""
    rls = re.sub(
        r"\s+", " ", (MIGRATIONS_DIR / "0002_rls.sql").read_text(encoding="utf-8").lower()
    )
    assert "now() < kickoff_utc" in rls
    assert "public.fixture_is_open" in rls


def test_client_cannot_write_server_owned_columns():
    """Column-level grants are what make §9.2 real. A client that could write
    points_awarded or entitlement could award itself either one."""
    rls = re.sub(
        r"\s+", " ", (MIGRATIONS_DIR / "0002_rls.sql").read_text(encoding="utf-8").lower()
    )
    assert "grant insert (user_id, fixture_id, outcome, home_goals, away_goals)" in rls
    assert "grant update (outcome, home_goals, away_goals)" in rls
    # entitlement / total_points / streaks are absent from every grant list.
    assert "grant update (display_name, favourite_team_id, notification_prefs)" in rls
