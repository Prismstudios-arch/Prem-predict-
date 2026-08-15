"""Regenerate supabase/combined_setup.sql from supabase/migrations/.

The combined file exists so first-time setup is one paste into the Supabase SQL
editor instead of nine. That convenience is a liability the moment it drifts
from the migrations, because it would apply a schema that no longer matches
what CI tests and what the app expects.

test_combined_setup.py asserts the two agree, and its failure message used to
say "regenerate it — see docs/SETUP.md", which described no way to do so. This
is that way.

    worker/.venv/Scripts/python.exe supabase/build_combined.py

Deliberately not run automatically: the file is committed, and a generator that
runs on import is a generator nobody notices producing a diff.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent
MIGRATIONS = ROOT / "migrations"
OUT = ROOT / "combined_setup.sql"

RULE = "=" * 74

HEADER = f"""-- {"=" * 76}
-- COMBINED SETUP  --  paste this whole file into the Supabase SQL Editor once.
--
-- This is every migration in supabase/migrations/ concatenated in order.
-- It is generated, not hand-maintained: regenerate with
-- `python supabase/build_combined.py` if the migrations change. The individual
-- files remain the source of truth (CI applies those, and the test suite
-- parses those).
--
-- Wrapped in a single transaction: if any statement fails, NOTHING is applied.
-- That is what you want for a first run - a half-applied schema is far worse
-- to recover from than a clean error.
-- {"=" * 76}

begin;
"""


def build() -> str:
    parts = [HEADER]
    for path in sorted(MIGRATIONS.glob("*.sql")):
        parts.append(
            f"\n\n-- {RULE}\n-- FILE: {path.name}\n-- {RULE}\n\n"
            + path.read_text(encoding="utf-8").rstrip("\n")
        )
    parts.append("\n\n\ncommit;\n")
    return "".join(parts)


if __name__ == "__main__":
    OUT.write_text(build(), encoding="utf-8")
    n = len(list(MIGRATIONS.glob("*.sql")))
    print(f"wrote {OUT.relative_to(ROOT.parent)} from {n} migrations")
