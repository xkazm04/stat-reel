from __future__ import annotations

from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
REGISTRY_PATH = REPO / "data" / "registry" / "sources.yaml"


class FakeClock:
    """Monotonic + wall clock that only moves when told to (or when `sleep` is called)."""

    def __init__(self, start: float = 1_000_000.0) -> None:
        self.now = start
        self.slept: list[float] = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def registry():
    from statreel_ingest.registry import Registry

    return Registry.load(REGISTRY_PATH)
