"""Source registry (data/registry/sources.yaml): what may be fetched, from where, how fast."""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

import yaml
from pydantic import BaseModel, ConfigDict, model_validator

Verdict = Literal["legal", "non_commercial", "paid", "avoid"]
Kind = Literal["hist", "bio", "events", "track", "live", "money"]
DEFAULT_INTERVAL_S = 3.0  # one request / 3 s when no limit is published
SHARE_OF_PUBLISHED = 0.5  # run at <= 50 % of the published limit


class SourceForbidden(PermissionError):
    """The source's verdict forbids any automated access."""


class HostNotRegistered(PermissionError):
    """The URL's host is not registered for the source."""


class RateLimit(BaseModel):
    model_config = ConfigDict(extra="allow")
    requests: float
    per_s: float
    burst_per_s: float | None = None
    note: str | None = None


class Source(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    sport: str
    url: str
    access: Literal["bulk_download", "api", "html_scrape", "manual"]
    hosts: list[str] = []
    verdict: Verdict
    verdict_note: str | None = None
    license: str
    attribution: str | None
    kinds: list[Kind]
    partial_kinds: list[Kind] = []
    coverage: dict | None = None
    rate_limit: RateLimit | None
    terms_url: str
    terms_checked_at: date
    notes: str | None = None

    @model_validator(mode="after")
    def _avoid_has_no_hosts(self) -> Source:
        if self.verdict == "avoid" and self.hosts:
            raise ValueError(f"source {self.id}: verdict avoid must not list hosts")
        return self

    @property
    def license_class(self) -> str:
        return self.verdict

    def min_interval_s(self) -> float:
        """Seconds between requests to one host, at <= 50 % of every published limit."""
        rl = self.rate_limit
        if rl is None:
            return DEFAULT_INTERVAL_S
        intervals = [rl.per_s / rl.requests]
        if rl.burst_per_s:
            intervals.append(1.0 / rl.burst_per_s)
        return max(intervals) / SHARE_OF_PUBLISHED


class Registry:
    def __init__(self, sources: list[Source]) -> None:
        ids = [s.id for s in sources]
        dupes = {i for i in ids if ids.count(i) > 1}
        if dupes:
            raise ValueError(f"duplicate source ids: {sorted(dupes)}")
        self.sources = sources
        self._by_id = {s.id: s for s in sources}

    @classmethod
    def load(cls, path: Path) -> Registry:
        raw = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or []
        return cls([Source.model_validate(r) for r in raw])

    def get(self, source_id: str) -> Source:
        try:
            return self._by_id[source_id]
        except KeyError:
            raise KeyError(f"source {source_id!r} is not in the registry") from None

    def require_fetchable(self, source_id: str) -> Source:
        src = self.get(source_id)
        if src.verdict == "avoid":
            raise SourceForbidden(f"source {source_id} has verdict avoid: no automated access")
        return src

    def authorize(self, source_id: str, url: str) -> Source:
        """Raise unless `url` may be fetched on behalf of `source_id`."""
        src = self.require_fetchable(source_id)
        host = urlsplit(url).hostname or ""
        if urlsplit(url).scheme != "https" or host not in src.hosts:
            raise HostNotRegistered(f"{url} is not a registered https host for source {source_id} ({src.hosts})")
        return src
