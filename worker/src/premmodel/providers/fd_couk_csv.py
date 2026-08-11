"""football-data.co.uk CSV adapter — the historical training set.

CLAUDE.md §4.1: 30+ seasons of results *and closing odds*. The odds are the
§5.5 market baseline and are the single highest-value free asset in the project.

§2 [HARD]: odds are used server-side only, as a calibration benchmark. They are
never written to a client-reachable table and never rendered. `HistoricalMatch`
carries de-vigged probabilities, not prices, so there is nothing to display even
by accident.

Downloads are cached to worker/data/ as Parquet. Completed seasons never change,
so re-running the backfill costs nothing.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

import httpx
import pandas as pd

from premmodel.config import settings
from premmodel.providers.base import HistoricalMatch, devig_1x2

log = logging.getLogger(__name__)

BASE_URL = "https://www.football-data.co.uk/mmz4281"

TOP_FLIGHT = "E0"
CHAMPIONSHIP = "E1"
"""§5.4 needs Championship form to initialise promoted sides. Same file layout,
one path segment different — so the second division costs us nothing."""

# Preference order for the closing 1X2 price. Closing average across the market
# is the best available estimate; Bet365 closing is the fallback; opening prices
# are last resort and materially worse as a benchmark.
_ODDS_COLUMN_SETS: tuple[tuple[str, str, str], ...] = (
    ("AvgCH", "AvgCD", "AvgCA"),
    ("BbAvCH", "BbAvCD", "BbAvCA"),
    ("B365CH", "B365CD", "B365CA"),
    ("AvgH", "AvgD", "AvgA"),
    ("B365H", "B365D", "B365A"),
)

# football-data.co.uk uses colloquial short names; football-data.org uses legal
# names. Both resolve to the same slug so team identity survives the join.
NAME_ALIASES: dict[str, str] = {
    "man united": "manchester-united",
    "man utd": "manchester-united",
    "manchester united fc": "manchester-united",
    "man city": "manchester-city",
    "manchester city fc": "manchester-city",
    "tottenham": "tottenham-hotspur",
    "tottenham hotspur fc": "tottenham-hotspur",
    "spurs": "tottenham-hotspur",
    "wolves": "wolverhampton-wanderers",
    "wolverhampton wanderers fc": "wolverhampton-wanderers",
    "newcastle": "newcastle-united",
    "newcastle united fc": "newcastle-united",
    "nott'm forest": "nottingham-forest",
    "nottingham forest fc": "nottingham-forest",
    "sheffield united": "sheffield-united",
    "sheffield weds": "sheffield-wednesday",
    "west ham": "west-ham-united",
    "west ham united fc": "west-ham-united",
    "west brom": "west-bromwich-albion",
    "brighton": "brighton-and-hove-albion",
    "brighton & hove albion fc": "brighton-and-hove-albion",
    "leeds": "leeds-united",
    "leeds united fc": "leeds-united",
    "leicester": "leicester-city",
    "leicester city fc": "leicester-city",
    "norwich": "norwich-city",
    "ipswich": "ipswich-town",
    "ipswich town fc": "ipswich-town",
    "hull": "hull-city",
    "hull city afc": "hull-city",
    "coventry": "coventry-city",
    "coventry city fc": "coventry-city",
    "stoke": "stoke-city",
    "cardiff": "cardiff-city",
    "swansea": "swansea-city",
    "birmingham": "birmingham-city",
    "blackburn": "blackburn-rovers",
    "bolton": "bolton-wanderers",
    "charlton": "charlton-athletic",
    "derby": "derby-county",
    "huddersfield": "huddersfield-town",
    "luton": "luton-town",
    "middlesbrough": "middlesbrough",
    "qpr": "queens-park-rangers",
    "wigan": "wigan-athletic",
    "bournemouth": "afc-bournemouth",
    "afc bournemouth": "afc-bournemouth",
    "crystal palace fc": "crystal-palace",
    "arsenal fc": "arsenal",
    "chelsea fc": "chelsea",
    "liverpool fc": "liverpool",
    "everton fc": "everton",
    "fulham fc": "fulham",
    "brentford fc": "brentford",
    "aston villa fc": "aston-villa",
    "southampton fc": "southampton",
    "sunderland afc": "sunderland",
    "burnley fc": "burnley",
}


def canonical_slug(name: str) -> str:
    """Map any provider's spelling of a club to one stable slug.

    >>> canonical_slug("Man City")
    'manchester-city'
    >>> canonical_slug("Manchester City FC")
    'manchester-city'
    """
    key = name.strip().lower()
    if key in NAME_ALIASES:
        return NAME_ALIASES[key]
    trimmed = key.removesuffix(" fc").removesuffix(" afc").strip()
    if trimmed in NAME_ALIASES:
        return NAME_ALIASES[trimmed]
    return trimmed.replace("&", "and").replace(" ", "-").replace("'", "")


def season_code(season: str) -> str:
    """'2024-25' -> '2425', the path segment football-data.co.uk uses."""
    start, end = season.split("-")
    return f"{start[-2:]}{end}"


class FootballDataCoUkProvider:
    name = "football-data.co.uk"

    def __init__(self, *, use_cache: bool = True, division: str = TOP_FLIGHT) -> None:
        self._use_cache = use_cache
        self._division = division

    def fetch_seasons(self, seasons: list[str]) -> list[HistoricalMatch]:
        matches: list[HistoricalMatch] = []
        for season in seasons:
            frame = self._load_season(season)
            matches.extend(self._parse_season(frame, season))
        log.info(
            "loaded %d historical matches across %d seasons (%d with market odds)",
            len(matches),
            len(seasons),
            sum(1 for m in matches if m.has_market),
        )
        return matches

    # ------------------------------------------------------------------ io

    def _load_season(self, season: str) -> pd.DataFrame:
        cache_path = (
            settings().data_dir / f"fd_couk_{self._division}_{season_code(season)}.parquet"
        )
        if self._use_cache and cache_path.exists():
            return pd.read_parquet(cache_path)

        url = f"{BASE_URL}/{season_code(season)}/{self._division}.csv"
        log.info("downloading %s", url)
        response = httpx.get(url, timeout=60.0, follow_redirects=True)
        response.raise_for_status()

        # The older files carry trailing blank columns and stray rows.
        frame = pd.read_csv(
            pd.io.common.BytesIO(response.content),
            encoding="latin-1",
            on_bad_lines="skip",
        )
        frame = frame.dropna(subset=["HomeTeam", "AwayTeam", "FTHG", "FTAG"])
        frame.to_parquet(cache_path, index=False)
        return frame

    # -------------------------------------------------------------- parsing

    def _parse_season(self, frame: pd.DataFrame, season: str) -> list[HistoricalMatch]:
        odds_cols = self._pick_odds_columns(frame)
        if odds_cols is None:
            log.warning("season %s has no usable closing odds; no market baseline", season)

        out: list[HistoricalMatch] = []
        for row in frame.itertuples(index=False):
            date = _parse_date(getattr(row, "Date", None))
            if date is None:
                continue

            market = (None, None, None)
            if odds_cols is not None:
                market = _safe_devig(*(getattr(row, c, None) for c in odds_cols))

            out.append(
                HistoricalMatch(
                    date=date,
                    season=season,
                    home_name=canonical_slug(str(row.HomeTeam)),
                    away_name=canonical_slug(str(row.AwayTeam)),
                    home_goals=int(row.FTHG),
                    away_goals=int(row.FTAG),
                    market_home=market[0],
                    market_draw=market[1],
                    market_away=market[2],
                )
            )
        return out

    @staticmethod
    def _pick_odds_columns(frame: pd.DataFrame) -> tuple[str, str, str] | None:
        for candidate in _ODDS_COLUMN_SETS:
            if all(col in frame.columns for col in candidate):
                return candidate
        return None


def _parse_date(raw: object) -> datetime | None:
    """football-data.co.uk mixes dd/mm/yy and dd/mm/yyyy across seasons."""
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None
    text = str(raw).strip()
    for fmt in ("%d/%m/%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=UTC)
        except ValueError:
            continue
    log.debug("unparseable date %r", text)
    return None


def _safe_devig(
    home: object, draw: object, away: object
) -> tuple[float | None, float | None, float | None]:
    try:
        values = [float(v) for v in (home, draw, away)]
    except (TypeError, ValueError):
        return (None, None, None)
    if any(pd.isna(v) or v <= 1.0 for v in values):
        return (None, None, None)
    return devig_1x2(*values)
