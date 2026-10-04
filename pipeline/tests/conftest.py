from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
REGISTRY_PATH = REPO / "data" / "registry" / "sources.yaml"
LIVE_MARKER = "live: hits the network through the ethics layer (pnpm e2e:live / just e2e-live)"


def live_selected(markexpr: str) -> bool:
    """True only when the -m expression names `live` positively (`-m live`, `-m "live and x"`)."""
    tokens = re.findall(r"\w+", markexpr or "")
    return any(tok == "live" and (i == 0 or tokens[i - 1] != "not") for i, tok in enumerate(tokens))


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", LIVE_MARKER)


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Live tests (a real ingest into data/raw) are opt-in here, not only via pyproject's addopts: pytest
    reads pipeline/pyproject.toml only when it is the rootdir's config, so `uv run --project pipeline
    pytest` from the repo root used to run them with no `-m` at all."""
    if live_selected(config.getoption("markexpr")):
        return
    live = [item for item in items if item.get_closest_marker("live")]
    if live:
        config.hook.pytest_deselected(items=live)
        items[:] = [item for item in items if not item.get_closest_marker("live")]


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
