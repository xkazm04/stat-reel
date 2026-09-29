"""EthicalClient - the only way data HTTP leaves this machine.

Every request, including every redirect hop, is checked against the source registry (verdict and
host), robots.txt (cached 24 h, obeyed; a 5xx or unreachable robots.txt means disallow), and spaced
per host at <= 50 % of the published limit. Responses are cached with their validators so unchanged
resources are never re-downloaded, and every fetch is appended to a JSONL log.
"""

from __future__ import annotations

import hashlib
import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import httpx
from protego import Protego

from . import __version__
from .registry import Registry, Source
from .throttle import HostThrottle

ROBOTS_TTL_S = 24 * 3600
MAX_REDIRECTS = 5


class MissingContact(ValueError):
    """The User-Agent must carry an owner contact (DESIGN.md §5.2)."""


class RobotsDisallowed(PermissionError):
    pass


@dataclass
class FetchResult:
    url: str
    final_url: str
    status: int
    content: bytes
    headers: dict[str, str] = field(default_factory=dict)
    from_cache: bool = False

    def json(self):
        return json.loads(self.content)


class EthicalClient:
    def __init__(
        self,
        registry: Registry,
        source_id: str,
        *,
        contact: str,
        cache_dir: Path,
        log_path: Path,
        transport: httpx.BaseTransport | None = None,
        clock: Callable[[], float] = time.time,
        sleep: Callable[[float], None] = time.sleep,
        timeout_s: float = 60.0,
    ) -> None:
        if not contact or not contact.strip():
            raise MissingContact("set an owner contact (STATREEL_CONTACT or data/registry/ingest.yaml)")
        self.registry = registry
        self.source: Source = registry.require_fetchable(source_id)
        self.user_agent = f"StatReel/{__version__} (+{contact.strip()})"
        self.cache_dir = Path(cache_dir)
        self.log_path = Path(log_path)
        self._clock = clock
        self._throttle = HostThrottle(clock=clock, sleep=sleep)
        self._robots: dict[str, tuple[float, Protego | None]] = {}
        self._http = httpx.Client(
            transport=transport, follow_redirects=False, timeout=timeout_s, headers={"user-agent": self.user_agent}
        )

    # ------------------------------------------------------------------ public

    def get(self, url: str, headers: dict[str, str] | None = None) -> FetchResult:
        """GET with registry, robots, throttle and cache checks on every hop."""
        original = url
        for _ in range(MAX_REDIRECTS + 1):
            self.registry.authorize(self.source.id, url)
            self._check_robots(url)
            cached = self._cache_read(url)
            req_headers = dict(headers or {})
            if cached:
                if cached["meta"].get("etag"):
                    req_headers["if-none-match"] = cached["meta"]["etag"]
                if cached["meta"].get("last_modified"):
                    req_headers["if-modified-since"] = cached["meta"]["last_modified"]
            resp = self._send(url, req_headers)
            if resp.status_code in (301, 302, 303, 307, 308) and "location" in resp.headers:
                url = urljoin(url, resp.headers["location"])
                continue
            if resp.status_code == 304 and cached:
                return FetchResult(original, url, 200, cached["body"], cached["meta"].get("headers", {}), from_cache=True)
            resp.raise_for_status()
            if url == original:  # redirect targets are signed, single-use URLs: never cache them
                self._cache_write(url, resp)
            return FetchResult(original, url, resp.status_code, resp.content, dict(resp.headers), from_cache=False)
        raise httpx.TooManyRedirects(f"more than {MAX_REDIRECTS} redirects from {original}")

    def close(self) -> None:
        self._http.close()

    # ------------------------------------------------------------------ internals

    def _send(self, url: str, headers: dict[str, str]) -> httpx.Response:
        host = urlsplit(url).hostname or ""
        self._throttle.wait(host, self.source.min_interval_s())
        started = time.perf_counter()
        resp = self._http.get(url, headers=headers)
        self._log(url, resp.status_code, len(resp.content), (time.perf_counter() - started) * 1000)
        return resp

    def _check_robots(self, url: str) -> None:
        parts = urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        entry = self._robots.get(origin)
        if entry is None or self._clock() - entry[0] > ROBOTS_TTL_S:
            entry = (self._clock(), self._fetch_robots(origin))
            self._robots[origin] = entry
        rules = entry[1]
        if rules is None:
            raise RobotsDisallowed(f"{origin}/robots.txt unavailable - treating as disallow")
        if not rules.can_fetch(url, self.user_agent):
            raise RobotsDisallowed(f"robots.txt disallows {url} for {self.user_agent}")

    def _fetch_robots(self, origin: str) -> Protego | None:
        """2xx -> parse; 4xx -> no restrictions (RFC 9309 §2.3.1.3); 5xx / error -> None (disallow)."""
        robots_url = f"{origin}/robots.txt"
        host = urlsplit(robots_url).hostname or ""
        self._throttle.wait(host, self.source.min_interval_s())
        try:
            started = time.perf_counter()
            resp = self._http.get(robots_url)
            self._log(robots_url, resp.status_code, len(resp.content), (time.perf_counter() - started) * 1000)
        except httpx.HTTPError:
            return None
        if 200 <= resp.status_code < 300:
            return Protego.parse(resp.text)
        if 400 <= resp.status_code < 500:
            return Protego.parse("")
        return None

    def _cache_paths(self, url: str) -> tuple[Path, Path]:
        key = hashlib.sha256(url.encode()).hexdigest()
        base = self.cache_dir / self.source.id
        return base / f"{key}.body", base / f"{key}.json"

    def _cache_read(self, url: str) -> dict | None:
        body, meta = self._cache_paths(url)
        if body.exists() and meta.exists():
            return {"body": body.read_bytes(), "meta": json.loads(meta.read_text(encoding="utf-8"))}
        return None

    def _cache_write(self, url: str, resp: httpx.Response) -> None:
        etag, modified = resp.headers.get("etag"), resp.headers.get("last-modified")
        if not etag and not modified:
            return  # nothing to validate against; don't keep it
        body, meta = self._cache_paths(url)
        body.parent.mkdir(parents=True, exist_ok=True)
        body.write_bytes(resp.content)
        keep = {k: v for k, v in resp.headers.items() if k.lower() in ("content-type", "etag", "last-modified")}
        meta.write_text(json.dumps({"url": url, "etag": etag, "last_modified": modified, "headers": keep}), encoding="utf-8")

    def _log(self, url: str, status: int, size: int, duration_ms: float) -> None:
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        # Signed redirect URLs carry short-lived credentials; log the path only.
        parts = urlsplit(url)
        logged = url if parts.hostname == "api.github.com" or not parts.query else f"{parts.scheme}://{parts.netloc}{parts.path}?…"
        with self.log_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"ts": self._clock(), "source_id": self.source.id, "url": logged, "status": status,
                                 "bytes": size, "duration_ms": round(duration_ms, 1)}) + "\n")
