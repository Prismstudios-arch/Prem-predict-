"""Configuration. Every secret comes from the environment — never a literal.

CLAUDE.md §9.2: secrets live in the platform's secret manager. Locally that is
worker/.env (gitignored); in CI it is GitHub Actions secrets; in production it
is the host's secret store.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKER_ROOT = REPO_ROOT / "worker"
DATA_DIR = WORKER_ROOT / "data"

load_dotenv(WORKER_ROOT / ".env")

def CURRENT_SEASON() -> str:  # noqa: N802 - reads as a constant at call sites
    """The season we are in, derived from today's date.

    Deliberately a function, not a module-level string. A constant computed at
    import time would be wrong for any process that outlives the 1 July
    rollover — which is exactly what a long-running cron worker does. Making it
    a call also makes it impossible to accidentally bake a season into a
    default argument, which is how the previous hardcoded value spread.

    See premmodel/season.py for the rollover rule.
    """
    from premmodel.season import current_season

    return current_season()


class ConfigError(RuntimeError):
    """Raised when a required environment variable is missing."""


def _require(key: str) -> str:
    value = os.environ.get(key)
    if not value:
        raise ConfigError(
            f"{key} is not set. Copy worker/.env.example to worker/.env and fill it in."
        )
    return value


@dataclass(frozen=True, slots=True)
class Settings:
    database_url: str
    football_data_org_token: str
    log_level: str

    @property
    def data_dir(self) -> Path:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        return DATA_DIR


@lru_cache(maxsize=1)
def settings() -> Settings:
    return Settings(
        database_url=_require("DATABASE_URL"),
        football_data_org_token=_require("FOOTBALL_DATA_ORG_TOKEN"),
        log_level=os.environ.get("LOG_LEVEL", "INFO"),
    )
