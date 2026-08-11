"""Club colours - the input to the §7.4 generated team mark.

CLAUDE.md §2 [HARD] forbids crests, badges, kit imagery and league branding.
Colours are none of those: §7.4 explicitly specifies deriving an abstract
geometric mark from a club's primary and secondary colours. Nothing here is
copied artwork.

The values live in app/src/data/team-colours.json, read by BOTH this module
(which seeds public.teams) and the app's accessibility suite (which checks every
pair for WCAG contrast). Keeping two lists would let the seeded database and the
contrast tests drift apart silently - the colours shipped to users would stop
being the colours anyone verified.

Keyed by the canonical slug from providers/fd_couk_csv.py, so the live provider
and the historical CSVs resolve to the same entry.

A club missing from this map fails ingest loudly (see db.upsert_teams). That is
deliberate: a grey fallback mark reaching production is worse than a red build.
"""

from __future__ import annotations

import json
from functools import lru_cache

from premmodel.config import REPO_ROOT

COLOURS_PATH = REPO_ROOT / "app" / "src" / "data" / "team-colours.json"


@lru_cache(maxsize=1)
def _load() -> dict[str, tuple[str, str]]:
    if not COLOURS_PATH.exists():
        raise FileNotFoundError(
            f"club colours not found at {COLOURS_PATH}. "
            "This file is shared with the app and must not be moved without "
            "updating app/src/data/teamColours.ts."
        )
    raw = json.loads(COLOURS_PATH.read_text(encoding="utf-8"))
    return {slug: (pair[0], pair[1]) for slug, pair in raw["colours"].items()}


# slug -> (primary, secondary)
TEAM_COLOURS: dict[str, tuple[str, str]] = _load()


def colours_for(slug: str) -> tuple[str, str]:
    try:
        return TEAM_COLOURS[slug]
    except KeyError as exc:
        raise KeyError(
            f"no colours for slug '{slug}'. Add it to {COLOURS_PATH.name}."
        ) from exc


def provisional_colours(slug: str) -> tuple[str, str]:
    """Deterministic stand-in colours for a club we have not catalogued.

    Three clubs are promoted every summer, and this app is meant to run for
    years unattended. The original design failed ingest loudly on an unknown
    club, which is the right instinct in general and exactly wrong here: it
    would take the fixture list down on the opening weekend of a new season,
    the highest-traffic day of the year, over a cosmetic detail.

    So an unknown club gets a stable, distinct colour pair derived from its
    slug, the row is flagged `colours_provisional`, and the job warns. The
    season opens; the real colours are a five-minute edit to
    team-colours.json whenever someone gets to it.

    Deterministic so the mark never changes between runs or devices, and drawn
    from a fixed palette so it always looks like a deliberate club identity
    rather than a rendering fault.
    """
    palette = [
        ("#2E5BFF", "#FFFFFF"), ("#1B7F5A", "#FFFFFF"), ("#8E44AD", "#F1C40F"),
        ("#C0392B", "#2C3E50"), ("#16A085", "#0A0B0D"), ("#D35400", "#FFFFFF"),
        ("#2C3E50", "#E67E22"), ("#7F1D45", "#9AD6EA"), ("#0E7490", "#FDE047"),
        ("#4A5568", "#F7FAFC"),
    ]
    # FNV-1a: small, stable, and identical across Python and the app's
    # TypeScript implementation in TeamMark.tsx.
    h = 0x811C9DC5
    for char in slug.encode("utf-8"):
        h ^= char
        h = (h * 0x01000193) & 0xFFFFFFFF
    return palette[h % len(palette)]


def colours_or_provisional(slug: str) -> tuple[tuple[str, str], bool]:
    """Returns ((primary, secondary), is_provisional)."""
    if slug in TEAM_COLOURS:
        return TEAM_COLOURS[slug], False
    return provisional_colours(slug), True
