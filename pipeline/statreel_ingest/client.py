"""EthicalClient - the only way data HTTP leaves this machine.

Every request, including every redirect hop, is checked against the source registry (verdict and
host), robots.txt (cached 24 h on disk, obeyed; a 5xx or unreachable robots.txt means disallow), and
spaced per host at <= 50 % of the published limit (or the robots Crawl-delay if stricter), with the
spacing shared across processes. A 429/503 stops the run and records when the host may be asked again. Responses are cached with their validators so unchanged
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
from .throttle import BackedOff, HostThrottle, atomic_write, file_lock, parse_retry_after, safe_key

ROBOTS_TTL_S = 24 * 3600
MAX_REDIRECTS = 5


class MissingContact(ValueError):
    """The User-Agent must carry an owner contact (DESIGN.md §5.2)."""


class RobotsDisallowed(PermissionError):
    pass


RateLimited = BackedOff  # raised on 429/503; carries .retry_at (wall-clock epoch seconds)


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
        state_dir: Path | None = None,
        monotonic: Callable[[], float] | None = None,
    ) -> None:
        if not contact or not contact.strip():
            raise MissingContact("set an owner contact (STATREEL_CONTACT or data/registry/ingest.yaml)")
        self.registry = registry
        self.source: Source = registry.require_fetchable(source_id)
        self.user_agent = f"StatReel/{__version__} (+{contact.strip()})"
        self.cache_dir = Path(cache_dir)
        self.log_path = Path(log_path)
        self._clock = clock
        # `clock` is the wall clock (persisted timestamps, robots TTL, log). In-process spacing needs a
        # monotonic one; tests that inject a fake wall clock get it for both.
        mono = monotonic or (time.monotonic if clock is time.time else clock)
        self.state_dir = Path(state_dir) if state_dir else self.cache_dir / "_state"
        self._throttle = HostThrottle(clock=mono, sleep=sleep, state_dir=self.state_dir, wall=clock)
        self._robots: dict[str, tuple[float, Protego | None]] = {}
        self._crawl_delay: dict[str, float] = {}
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
        origin = f"{urlsplit(url).scheme}://{urlsplit(url).netloc}"
        interval = max(self.source.min_interval_s(), self._crawl_delay.get(origin, 0.0))
        self._throttle.wait(host, interval)
        started = time.perf_counter()
        try:
            resp = self._http.get(url, headers=headers)
        except httpx.HTTPError as exc:  # a timeout or refused connection is a fetch too: log it, then fail
            self._log(url, None, 0, (time.perf_counter() - started) * 1000, error=type(exc).__name__)
            raise
        self._log(url, resp.status_code, len(resp.content), (time.perf_counter() - started) * 1000)
        self._stop_if_asked(host, resp)
        return resp

    def _stop_if_asked(self, host: str, resp: httpx.Response, *, robots: bool = False) -> None:
        """429/503: never hammer - persist the earliest next fetch and stop the run. A bare robots.txt
        503 (no Retry-After) keeps its documented meaning, disallow."""
        if resp.status_code == 429 or (resp.status_code == 503 and not (robots and "retry-after" not in resp.headers)):
            retry_at = parse_retry_after(resp.headers.get("retry-after"), self._clock())
            reason = f"HTTP {resp.status_code}"
            self._throttle.record_backoff(host, retry_at, reason)
            raise RateLimited(host, retry_at, reason)

    def _check_robots(self, url: str) -> None:
        parts = urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        entry = self._robots.get(origin)
        if entry is None or self._clock() - entry[0] > ROBOTS_TTL_S:
            entry = self._robots_from_disk(origin)
            if entry is None:
                fetched = self._fetch_robots(origin)
                entry = (self._clock(), fetched)
            self._robots[origin] = entry
            rules_now = entry[1]
            delay = rules_now.crawl_delay(self.user_agent) if rules_now is not None else None
            self._crawl_delay[origin] = float(delay) if delay else 0.0
        rules = entry[1]
        if rules is None:
            raise RobotsDisallowed(f"{origin}/robots.txt unavailable - treating as disallow")
        if not rules.can_fetch(url, self.user_agent):
            raise RobotsDisallowed(f"robots.txt disallows {url} for {self.user_agent}")

    def _robots_path(self, origin: str) -> Path:
        return self.state_dir / "robots" / f"{safe_key(origin)}.json"

    def _robots_from_disk(self, origin: str) -> tuple[float, Protego] | None:
        """A robots.txt fetched by an earlier run/client, if still within its TTL (usable results only)."""
        try:
            saved = json.loads(self._robots_path(origin).read_text(encoding="utf-8"))
            if 0 <= self._clock() - saved["fetched_at"] <= ROBOTS_TTL_S:
                return saved["fetched_at"], Protego.parse(saved["body"])
        except (OSError, ValueError, KeyError):
            pass
        return None

    def _robots_to_disk(self, origin: str, body: str) -> None:
        path = self._robots_path(origin)
        with file_lock(path.with_suffix(".lock")):
            atomic_write(path, json.dumps({"fetched_at": self._clock(), "body": body}))

    def _fetch_robots(self, origin: str) -> Protego | None:
        """2xx -> parse; 4xx -> no restrictions (RFC 9309 §2.3.1.3); 5xx / error -> None (disallow).
        Usable results are persisted so later runs within the TTL do not refetch."""
        robots_url = f"{origin}/robots.txt"
        host = urlsplit(robots_url).hostname or ""
        self._throttle.wait(host, self.source.min_interval_s())
        started = time.perf_counter()
        try:
            resp = self._http.get(robots_url)
        except httpx.HTTPError as exc:
            self._log(robots_url, None, 0, (time.perf_counter() - started) * 1000, error=type(exc).__name__)
            return None
        self._log(robots_url, resp.status_code, len(resp.content), (time.perf_counter() - started) * 1000)
        self._stop_if_asked(host, resp, robots=True)
        if 200 <= resp.status_code < 300:
            self._robots_to_disk(origin, resp.text)
            return Protego.parse(resp.text)
        if 400 <= resp.status_code < 500:
            self._robots_to_disk(origin, "")
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

    def _log(self, url: str, status: int | None, size: int, duration_ms: float, *, error: str | None = None) -> None:
        """One row per request attempt; a transport failure has status null and names the error class."""
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        # Signed redirect URLs carry short-lived credentials; log the path only.
        parts = urlsplit(url)
        logged = url if parts.hostname == "api.github.com" or not parts.query else f"{parts.scheme}://{parts.netloc}{parts.path}?…"
        row = {"ts": self._clock(), "source_id": self.source.id, "url": logged, "status": status,
               "bytes": size, "duration_ms": round(duration_ms, 1)}
        if error:
            row["error"] = error
        with self.log_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(row) + "\n")
