"""Per-host spacing of requests (the registry decides the interval)."""

from __future__ import annotations

import time
from collections.abc import Callable


class HostThrottle:
    def __init__(self, clock: Callable[[], float] = time.monotonic, sleep: Callable[[float], None] = time.sleep) -> None:
        self._clock = clock
        self._sleep = sleep
        self._last: dict[str, float] = {}

    def wait(self, host: str, interval_s: float) -> None:
        last = self._last.get(host)
        if last is not None:
            remaining = last + interval_s - self._clock()
            if remaining > 0:
                self._sleep(remaining)
        self._last[host] = self._clock()
