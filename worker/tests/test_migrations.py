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
    points_awarded or entitlement could award itself either one.

    Checked across EVERY migration, not just 0002. A later migration that adds
    a column and re-issues the grant is exactly how a server-owned field gets
    handed to the client by accident — 0009 re-grants user_predictions to add
    is_call_of_the_week, and nothing but this test stops the next one from
    sweeping points_awarded in with it.
    """
    server_owned = (
        "points_awarded",
        "settled_at",
        "submitted_at_server",
        "entitlement",
        "entitlement_expires_at",
        "total_points",
        "streak_current",
        "streak_best",
    )
    # Every column list attached to a GRANT INSERT/UPDATE, anywhere.
    grant_lists = re.findall(
        r"grant\s+(?:insert|update)\s*\(([^)]*)\)",
        "\n".join(p.read_text(encoding="utf-8") for p in MIGRATIONS).lower(),
    )
    assert grant_lists, "no column-level grants found at all"

    for columns in grant_lists:
        granted = {c.strip() for c in columns.split(",")}
        leaked = granted.intersection(server_owned)
        assert not leaked, f"server-owned column(s) granted to a client role: {leaked}"


def test_no_gambling_vocabulary_in_schema():
    """§2 [HARD]. Identifiers leak into API responses and error messages, so a
    column called `banker` puts gambling vocabulary in front of a reviewer even
    though no screen ever renders it. The double-points pick is deliberately
    named call_of_the_week for this reason.

    Comments are stripped first. 0009 explains at length why it is *not* called
    a banker, and a check that cannot tell the identifier from the reasoning
    would forbid documenting the rule.
    """
    combined = "\n".join(p.read_text(encoding="utf-8") for p in MIGRATIONS)
    without_block = re.sub(r"/\*.*?\*/", " ", combined, flags=re.DOTALL)
    code_only = re.sub(r"--[^\n]*", " ", without_block).lower()

    for word in ("banker", "accumulator", "acca", "wager", "punt"):
        assert word not in code_only, f"gambling vocabulary in schema: {word!r}"


def test_call_of_the_week_doubles_in_settlement():
    """The double has to be applied server-side, from a column the client
    cannot forge — same reasoning as points_awarded itself."""
    sql = re.sub(
        r"\s+",
        " ",
        (MIGRATIONS_DIR / "0009_call_of_the_week.sql").read_text(encoding="utf-8").lower(),
    )
    assert "case when up.is_call_of_the_week then 2 else 1 end" in sql
    assert "public.score_prediction(" in sql


def test_model_also_gets_a_call_of_the_week():
    """Give the user a doubler the model does not get and the user wins every
    week by construction, which destroys the comparison the product is about."""
    sql = re.sub(
        r"\s+",
        " ",
        (MIGRATIONS_DIR / "0009_call_of_the_week.sql").read_text(encoding="utf-8").lower(),
    )
    assert "v_model_call" in sql
    assert "case when p.fixture_id = v_model_call then 2 else 1 end" in sql
    # Deterministic tie-break, or a re-run can produce a different total.
    assert "order by p.confidence desc, p.fixture_id" in sql


def test_call_of_the_week_cannot_move_off_a_kicked_off_match():
    """Otherwise: flag your safest pick, watch it finish 0-0, slide the doubler
    onto something still to play. A free re-roll every week."""
    sql = re.sub(
        r"\s+",
        " ",
        (MIGRATIONS_DIR / "0009_call_of_the_week.sql").read_text(encoding="utf-8").lower(),
    )
    assert "not public.fixture_is_open(up.fixture_id)" in sql
    assert "call of the week is locked for this gameweek" in sql


def test_exact_score_count_survives_doubling():
    """A doubled exact scoreline is worth 10, not 5. Counting `= 5` alone would
    silently stop counting the most impressive result in the game."""
    sql = re.sub(
        r"\s+",
        " ",
        (MIGRATIONS_DIR / "0009_call_of_the_week.sql").read_text(encoding="utf-8").lower(),
    )
    assert "filter (where up.points_awarded in (5, 10))" in sql
