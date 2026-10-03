"""Per-host politeness shared across clients and processes (the registry decides the interval).

In-process spacing uses the monotonic clock (immune to wall-clock jumps). What is shared between
processes is a small JSON file per host holding wall-clock timestamps - `next_allowed` (the slot the
next request may take) and `blocked_until` (a 429/503 Retry-After) - mutated under a lock file, so
two `just ingest` runs in the same hour split one budget instead of each assuming all of it.
"""

from __future__ import annotations

import json
import os
import re
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

LOCK_STALE_S = 30.0  # a lock older than this belongs to a crashed process
DEFAULT_BACKOFF_S = 3600.0  # 429/503 without a usable Retry-After


class BackedOff(RuntimeError):
    """The host asked us to stop (429/503) and the wait has not elapsed. Do not retry until `retry_at`."""

    def __init__(self, host: str, retry_at: float, reason: str = "") -> None:
        self.host, self.retry_at = host, retry_at
        when = datetime.fromtimestamp(retry_at, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        super().__init__(f"{host} asked us to back off{' (' + reason + ')' if reason else ''}; "
                         f"no request to it is allowed before {when} - re-run `just ingest` after that")


def parse_retry_after(value: str | None, now: float, default_s: float = DEFAULT_BACKOFF_S) -> float:
    """Retry-After is delta-seconds or an HTTP-date (RFC 9110 §10.2.3); returns the absolute wall time."""
    if value:
        value = value.strip()
        if re.fullmatch(r"\d+", value):
            return now + float(value)
        try:
            return parsedate_to_datetime(value).timestamp()
        except (TypeError, ValueError):
            pass
    return now + default_s


def safe_key(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", text)


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


@contextmanager
def file_lock(path: Path, timeout_s: float = 30.0) -> Iterator[None]:
    """Exclusive lock via O_EXCL create; real time on purpose (it is about other processes)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + timeout_s
    while True:
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.close(fd)
            break
        except FileExistsError:
            try:
                if time.time() - path.stat().st_mtime > LOCK_STALE_S:
                    path.unlink(missing_ok=True)
                    continue
            except OSError:
                continue
            if time.monotonic() > deadline:
                raise TimeoutError(f"could not lock {path}") from None
            time.sleep(0.01)
    try:
        yield
    finally:
        path.unlink(missing_ok=True)


class HostThrottle:
    def __init__(
        self,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
        *,
        state_dir: Path | None = None,
        wall: Callable[[], float] = time.time,
    ) -> None:
        self._clock = clock
        self._sleep = sleep
        self._wall = wall
        self._state_dir = Path(state_dir) if state_dir else None
        self._last: dict[str, float] = {}

    def _state_path(self, host: str) -> Path:
        assert self._state_dir is not None
        return self._state_dir / "hosts" / f"{safe_key(host)}.json"

    @staticmethod
    def _read(path: Path) -> dict:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def wait(self, host: str, interval_s: float) -> None:
        delay = 0.0
        last = self._last.get(host)
        if last is not None:
            delay = last + interval_s - self._clock()
        if self._state_dir is not None:
            path = self._state_path(host)
            with file_lock(path.with_suffix(".lock")):
                st = self._read(path)
                now = self._wall()
                if st.get("blocked_until", 0) > now:
                    raise BackedOff(host, st["blocked_until"], st.get("reason", ""))
                delay = max(delay, st.get("next_allowed", 0) - now)
                st["next_allowed"] = now + max(delay, 0.0) + interval_s
                atomic_write(path, json.dumps(st))
        if delay > 0:
            self._sleep(delay)
        self._last[host] = self._clock()

    def record_backoff(self, host: str, retry_at: float, reason: str = "") -> None:
        """Persist the earliest wall time the next request to `host` is allowed."""
        if self._state_dir is None:
            return
        path = self._state_path(host)
        with file_lock(path.with_suffix(".lock")):
            st = self._read(path)
            if retry_at > st.get("blocked_until", 0):
                st["blocked_until"], st["reason"] = retry_at, reason
            atomic_write(path, json.dumps(st))
