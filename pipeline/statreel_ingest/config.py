"""Paths and owner settings. The contact for the User-Agent comes from STATREEL_CONTACT or the
gitignored `.statreel/config.json` ({"contact": "..."}); there is deliberately no default."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Paths:
    """Every location the data lane touches; tests override the writable ones."""

    repo: Path = REPO
    registry: Path = REPO / "data" / "registry" / "sources.yaml"
    raw: Path = REPO / "data" / "raw"
    http_cache: Path = REPO / "data" / "cache" / "http"
    # per-host throttle + robots.txt state shared by every client/process (ethics layer politeness)
    http_state: Path = REPO / "data" / "cache" / "http" / "_state"
    warehouse: Path = field(default_factory=lambda: Path(os.environ.get("STATREEL_WAREHOUSE", REPO / "data" / "warehouse.duckdb")))
    dbt_project: Path = REPO / "pipeline" / "dbt"
    capabilities: Path = REPO / "pipeline" / "capabilities.yaml"


TERMS_MAX_AGE_DAYS = 180  # registry lint warns when a source's terms were checked longer ago than this


def owner_contact(repo: Path = REPO) -> str:
    if os.environ.get("STATREEL_CONTACT"):
        return os.environ["STATREEL_CONTACT"]
    cfg = repo / ".statreel" / "config.json"
    if cfg.exists():
        return json.loads(cfg.read_text(encoding="utf-8")).get("contact", "")
    return ""
