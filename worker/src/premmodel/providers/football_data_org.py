"""football-data.org v4 adapter — the live operational feed.

Free tier is 10 requests/minute, which covers daily ingest and 60-second
matchday polling (§4.2) with headroom. See CLAUDE.md §4.1.

OPEN (CLAUDE.md §15 #8): confirm the free tier's terms permit commercial use.
If they do not, `api_football.py` is the drop-in replacement — this module is
the only file that changes.
"""

from __future__ import annotations

import logging
import time
from datetime import UTC, datetime

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from premmodel.config import settings
from premmodel.providers.base import (
    FixtureStatus,
    ProviderFixture,
    ProviderTeam,
)

log = logging.getLogger(__name__)

BASE_URL = "https://api.football-data.org/v4"
COMPETITION = "PL"

# football-data.org status -> our enum. Anything unmapped is treated as
# scheduled rather than dropped, so an upstream vocabulary change degrades
# gracefully instead of losing fixtures (§13: provider outage).
_STATUS_MAP: dict[str, FixtureStatus] = {
    "SCHEDULED": FixtureStatus.SCHEDULED,
    "TIMED": FixtureStatus.SCHEDULED,
    "IN_PLAY": FixtureStatus.LIVE,
    "PAUSED": FixtureStatus.LIVE,
    "FINISHED": FixtureStatus.FINISHED,
    "AWARDED": FixtureStatus.FINISHED,
    "POSTPONED": FixtureStatus.POSTPONED,
    "SUSPENDED": FixtureStatus.POSTPONED,
    "CANCELLED": FixtureStatus.CANCELLED,
}


def _season_start_year(season: str) -> int:
    """'2026-27' -> 2026. football-data.org keys seasons by starting year."""
    return int(season.split("-")[0])


class FootballDataOrgProvider:
    name = "football-data.org"

    def __init__(self, token: str | None = None, *, min_interval_s: float = 0.4) -> None:
        # Throttling is driven by the response headers, as football-data.org
        # explicitly asks API clients to do. `min_interval_s` is only a floor to
        # avoid hammering the socket on cached/fast responses; the real budget
        # comes from X-Requests-Available-Minute. See _observe_quota.
        self._min_interval_s = min_interval_s
        self._last_request_at = 0.0
        self._requests_available: int | None = None
        self._reset_in_s: int = 60
        self._client = httpx.Client(
            base_url=BASE_URL,
            headers={"X-Auth-Token": token or settings().football_data_org_token},
            timeout=httpx.Timeout(20.0),
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> FootballDataOrgProvider:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    # ------------------------------------------------------------- transport

    def _throttle(self) -> None:
        """Wait based on the quota the server last reported.

        football-data.org asks clients to read its response headers rather than
        guessing a fixed delay, and the request is worth honouring: a blind
        sleep is simultaneously too slow when quota is free and too fast right
        after a burst. When the last response said no requests remain this
        minute, sleep until the counter resets; otherwise just respect a small
        socket-level floor.
        """
        if self._requests_available is not None and self._requests_available <= 0:
            wait = self._reset_in_s + 1
            log.info("quota exhausted; sleeping %ds until reset", wait)
            time.sleep(wait)
            self._requests_available = None
            self._last_request_at = time.monotonic()
            return

        elapsed = time.monotonic() - self._last_request_at
        if elapsed < self._min_interval_s:
            time.sleep(self._min_interval_s - elapsed)
        self._last_request_at = time.monotonic()

    def _observe_quota(self, response: httpx.Response) -> None:
        """Record the remaining budget the server just reported."""
        available = response.headers.get("X-Requests-Available-Minute")
        reset = response.headers.get("X-RequestCounter-Reset")
        if available is not None:
            try:
                self._requests_available = int(available)
            except ValueError:
                self._requests_available = None
        if reset is not None:
            try:
                self._reset_in_s = int(reset)
            except ValueError:
                self._reset_in_s = 60

    @retry(
        retry=retry_if_exception_type((httpx.TransportError, httpx.HTTPStatusError)),
        wait=wait_exponential(multiplier=2, min=2, max=60),
        stop=stop_after_attempt(4),
        reraise=True,
    )
    def _get(self, path: str, params: dict[str, object] | None = None) -> dict:
        self._throttle()
        response = self._client.get(path, params=params)
        self._observe_quota(response)

        if response.status_code == 429:
            # The server tells us exactly how long to wait; use it rather than
            # letting the exponential backoff guess.
            log.warning("rate limited; waiting %ds for the counter to reset", self._reset_in_s)
            time.sleep(self._reset_in_s + 1)
            self._requests_available = None
            response.raise_for_status()

        response.raise_for_status()
        return response.json()

    # -------------------------------------------------------- FixtureProvider

    def fetch_teams(self, season: str) -> list[ProviderTeam]:
        payload = self._get(
            f"/competitions/{COMPETITION}/teams",
            {"season": _season_start_year(season)},
        )
        teams = [
            ProviderTeam(
                provider_id=str(t["id"]),
                name=t["name"],
                short_name=(t.get("tla") or t["name"][:3]).upper(),
            )
            for t in payload.get("teams", [])
        ]
        log.info("fetched %d teams for %s", len(teams), season)
        return teams

    def fetch_fixtures(self, season: str) -> list[ProviderFixture]:
        payload = self._get(
            f"/competitions/{COMPETITION}/matches",
            {"season": _season_start_year(season)},
        )
        fixtures = [self._parse_match(m, season) for m in payload.get("matches", [])]
        log.info("fetched %d fixtures for %s", len(fixtures), season)
        return fixtures

    def fetch_results_since(self, since: datetime) -> list[ProviderFixture]:
        payload = self._get(
            f"/competitions/{COMPETITION}/matches",
            {"dateFrom": since.date().isoformat(), "dateTo": datetime.now(UTC).date().isoformat()},
        )
        matches = payload.get("matches", [])
        season = f"{_infer_season_year(matches)}-{str(_infer_season_year(matches) + 1)[-2:]}"
        return [self._parse_match(m, season) for m in matches]

    # ---------------------------------------------------------------- parsing

    @staticmethod
    def _parse_match(match: dict, season: str) -> ProviderFixture:
        full_time = (match.get("score") or {}).get("fullTime") or {}
        status = _STATUS_MAP.get(match.get("status", ""), FixtureStatus.SCHEDULED)

        home_goals = full_time.get("home")
        away_goals = full_time.get("away")

        # Guard the invariant ProviderFixture asserts: a fixture the provider
        # calls FINISHED but reports no score for is data we cannot settle on.
        if status is FixtureStatus.FINISHED and (home_goals is None or away_goals is None):
            log.warning(
                "match %s is FINISHED with no score; treating as scheduled", match.get("id")
            )
            status = FixtureStatus.SCHEDULED

        return ProviderFixture(
            provider_id=str(match["id"]),
            season=season,
            gameweek=int(match.get("matchday") or 0),
            home_provider_id=str(match["homeTeam"]["id"]),
            away_provider_id=str(match["awayTeam"]["id"]),
            kickoff_utc=datetime.fromisoformat(match["utcDate"].replace("Z", "+00:00")),
            status=status,
            home_goals=home_goals,
            away_goals=away_goals,
            minute=match.get("minute"),
        )


def _infer_season_year(matches: list[dict]) -> int:
    for match in matches:
        season = match.get("season") or {}
        start = season.get("startDate")
        if start:
            return int(start[:4])
    return datetime.now(UTC).year
