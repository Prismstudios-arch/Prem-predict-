"""The combined setup file must stay in sync with the migrations.

supabase/combined_setup.sql exists so first-time setup is one paste instead of
five. That convenience is a liability if it drifts: someone would apply a schema
that no longer matches what CI tests and what the code expects, and the
mismatch would only surface at runtime.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from pglast import parse_sql
from pglast.parser import ParseError

ROOT = Path(__file__).resolve().parents[2] / "supabase"
COMBINED = ROOT / "combined_setup.sql"
MIGRATIONS = sorted((ROOT / "migrations").glob("*.sql"))


def test_combined_file_exists():
    assert COMBINED.exists(), (
        "supabase/combined_setup.sql is missing. Regenerate it — see docs/SETUP.md."
    )


def test_combined_parses_as_valid_postgres():
    try:
        statements = parse_sql(COMBINED.read_text(encoding="utf-8"))
    except ParseError as exc:  # pragma: no cover - failure path
        pytest.fail(f"combined_setup.sql failed to parse: {exc}")
    assert statements


def test_combined_is_wrapped_in_a_transaction():
    """A half-applied schema is far harder to recover from than a clean error."""
    text = COMBINED.read_text(encoding="utf-8").lower()
    assert text.index("begin;") < text.index("-- file:")
    assert text.rstrip().endswith("commit;")


@pytest.mark.parametrize("migration", MIGRATIONS, ids=lambda p: p.name)
def test_every_migration_is_included(migration: Path):
    combined = COMBINED.read_text(encoding="utf-8")
    body = migration.read_text(encoding="utf-8")

    assert f"FILE: {migration.name}" in combined, f"{migration.name} is not in the combined file"

    # Compare on a distinctive slice rather than the whole body, so trailing
    # whitespace differences do not produce a confusing failure.
    signature = "\n".join(
        line for line in body.splitlines() if line.strip() and not line.strip().startswith("--")
    )[:400]
    normalised_combined = "\n".join(
        line for line in combined.splitlines() if line.strip() and not line.strip().startswith("--")
    )
    assert signature[:200] in normalised_combined, (
        f"{migration.name} has changed since combined_setup.sql was generated. "
        "Regenerate it — see docs/SETUP.md."
    )


def test_combined_has_no_extra_migrations():
    """Guards the other direction: a file deleted from migrations/ but left in
    the combined file would apply schema that no longer exists in CI."""
    combined = COMBINED.read_text(encoding="utf-8")
    referenced = [
        line.split("FILE: ")[1].strip()
        for line in combined.splitlines()
        if "FILE: " in line
    ]
    assert referenced == [m.name for m in MIGRATIONS]
