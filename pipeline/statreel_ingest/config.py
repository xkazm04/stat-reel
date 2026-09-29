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
    warehouse: Path = field(default_factory=lambda: Path(os.environ.get("STATREEL_WAREHOUSE", REPO / "data" / "warehouse.duckdb")))
    dbt_project: Path = REPO / "pipeline" / "dbt"
    capabilities: Path = REPO / "pipeline" / "capabilities.yaml"


def owner_contact(repo: Path = REPO) -> str:
    if os.environ.get("STATREEL_CONTACT"):
        return os.environ["STATREEL_CONTACT"]
    cfg = repo / ".statreel" / "config.json"
    if cfg.exists():
        return json.loads(cfg.read_text(encoding="utf-8")).get("contact", "")
    return ""
