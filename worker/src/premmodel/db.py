"""Postgres access for the worker.

The worker connects directly with the service role, so it bypasses RLS by
design — it is the only component permitted to write fixtures, predictions and
settled points. Nothing here is ever reachable from a client.

CLAUDE.md §9.2: all timestamps come from Postgres `now()`. This module never
sends a client-generated timestamp for anything time-sensitive.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from typing import Any

import psycopg
from psycopg.rows import dict_row

from premmodel.config import settings
from premmodel.providers.base import ProviderFixture, ProviderTeam

log = logging.getLogger(__name__)


@contextmanager
def connection() -> Iterator[psycopg.Connection]:
    conn = psycopg.connect(settings().database_url, row_factory=dict_row)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def resolve_external_ids(
    conn: psycopg.Connection, provider: str, kind: str, provider_ids: Sequence[str]
) -> dict[str, str]:
    """provider_id -> internal uuid, for ids already mapped."""
    if not provider_ids:
        return {}
    rows = conn.execute(
        """
        select provider_id, entity_id
        from public.external_refs
        where provider = %s and entity_kind = %s::public.entity_kind
          and provider_id = any(%s)
        """,
        (provider, kind, list(provider_ids)),
    ).fetchall()
    return {r["provider_id"]: str(r["entity_id"]) for r in rows}


def upsert_teams(
    conn: psycopg.Connection,
    provider: str,
    teams: Sequence[ProviderTeam],
    colours: dict[str, tuple[str, str]],
) -> dict[str, str]:
    """Insert teams not seen before and map their provider ids.

    Unknown clubs — the three promoted every summer — are seeded with
    deterministic provisional colours and flagged, rather than failing the
    ingest. See seed.teams.provisional_colours for why that trade was made:
    hard-failing here would take the fixture list down on the opening weekend.
    """
    from premmodel.providers.fd_couk_csv import canonical_slug
    from premmodel.seed.teams import provisional_colours

    mapped = resolve_external_ids(conn, provider, "team", [t.provider_id for t in teams])
    result = dict(mapped)
    provisional: list[str] = []

    for team in teams:
        if team.provider_id in result:
            continue
        slug = canonical_slug(team.name)

        if slug in colours:
            primary, secondary = colours[slug]
            is_provisional = False
        else:
            primary, secondary = provisional_colours(slug)
            is_provisional = True
            provisional.append(f"{team.name} ({slug})")

        row = conn.execute(
            """
            insert into public.teams
                (slug, name, short_name, primary_color, secondary_color, colours_provisional)
            values (%s, %s, %s, %s, %s, %s)
            on conflict (slug) do update set name = excluded.name
            returning id
            """,
            (slug, team.name, team.short_name, primary, secondary, is_provisional),
        ).fetchone()
        team_id = str(row["id"])

        conn.execute(
            """
            insert into public.external_refs (provider, entity_kind, entity_id, provider_id)
            values (%s, 'team', %s, %s)
            on conflict do nothing
            """,
            (provider, team_id, team.provider_id),
        )
        result[team.provider_id] = team_id

    log.info("mapped %d teams for provider %s", len(result), provider)
    if provisional:
        # Loud, but not fatal. This is the annual "someone got promoted" signal.
        log.warning(
            "%d club(s) seeded with PROVISIONAL colours: %s. "
            "Add real colours to app/src/data/team-colours.json and re-run ingest.",
            len(provisional),
            ", ".join(provisional),
        )
    return result


def upsert_fixtures(
    conn: psycopg.Connection,
    provider: str,
    fixtures: Sequence[ProviderFixture],
    team_ids: dict[str, str],
) -> int:
    """Insert or update fixtures. Returns the number written."""
    written = 0
    for fx in fixtures:
        home_id = team_ids.get(fx.home_provider_id)
        away_id = team_ids.get(fx.away_provider_id)
        if not home_id or not away_id:
            log.warning("skipping fixture %s: unmapped team", fx.provider_id)
            continue

        row = conn.execute(
            """
            insert into public.fixtures
                (season, gameweek, home_team_id, away_team_id, kickoff_utc,
                 status, home_goals, away_goals, minute)
            values (%s, %s, %s, %s, %s, %s::public.fixture_status, %s, %s, %s)
            on conflict (season, home_team_id, away_team_id) do update set
                gameweek    = excluded.gameweek,
                kickoff_utc = excluded.kickoff_utc,
                status      = excluded.status,
                home_goals  = excluded.home_goals,
                away_goals  = excluded.away_goals,
                minute      = excluded.minute
            returning id
            """,
            (
                fx.season, fx.gameweek, home_id, away_id, fx.kickoff_utc,
                str(fx.status), fx.home_goals, fx.away_goals, fx.minute,
            ),
        ).fetchone()

        conn.execute(
            """
            insert into public.external_refs (provider, entity_kind, entity_id, provider_id)
            values (%s, 'fixture', %s, %s)
            on conflict do nothing
            """,
            (provider, str(row["id"]), fx.provider_id),
        )
        written += 1

    log.info("wrote %d fixtures", written)
    return written


def fetch_gameweek(conn: psycopg.Connection, season: str, gameweek: int) -> list[dict[str, Any]]:
    """Read a gameweek the way the client will see it. Used by the Phase 0 smoke test."""
    return conn.execute(
        """
        select f.id, f.gameweek, f.kickoff_utc, f.status,
               h.name as home_name, h.short_name as home_short,
               a.name as away_name, a.short_name as away_short,
               f.home_goals, f.away_goals
        from public.fixtures f
        join public.teams h on h.id = f.home_team_id
        join public.teams a on a.id = f.away_team_id
        where f.season = %s and f.gameweek = %s
        order by f.kickoff_utc
        """,
        (season, gameweek),
    ).fetchall()
