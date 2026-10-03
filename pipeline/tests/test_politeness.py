"""Politeness state shared across clients/processes: budget, robots cache, Retry-After, Crawl-delay."""

import json
from email.utils import format_datetime
from datetime import datetime, timezone

import httpx
import pytest

from statreel_ingest.client import EthicalClient, RateLimited
from statreel_ingest.throttle import HostThrottle, parse_retry_after

API = "https://api.github.com"
CONTACT = "https://example.org/c"


def make(registry, tmp_path, clock, handler, source="f1db"):
    return EthicalClient(registry, source, contact=CONTACT, cache_dir=tmp_path / "cache",
                         log_path=tmp_path / "log.jsonl", transport=httpx.MockTransport(handler),
                         clock=clock, sleep=clock.sleep)


class Rec:
    def __init__(self, robots=httpx.Response(404), data=None):
        self.robots, self.data, self.times = robots, data or (lambda r: httpx.Response(200)), []


    def bind(self, clock):
        self.clock = clock
        return self

    def __call__(self, request):
        self.times.append((self.clock.now, request.url.path))
        return self.robots if request.url.path == "/robots.txt" else self.data(request)


def test_two_clients_share_one_budget(registry, tmp_path, clock):
    srv = Rec().bind(clock)
    a, b = make(registry, tmp_path, clock, srv), make(registry, tmp_path, clock, srv)
    for client in (a, b, a, b, a):
        client.get(f"{API}/x")
    stamps = [t for t, _ in srv.times]
    interval = registry.get("f1db").min_interval_s()
    assert len(stamps) == 6  # robots once (shared) + 5 data requests
    assert all(later - earlier >= interval - 1e-6 for earlier, later in zip(stamps, stamps[1:]))


def test_robots_cache_survives_a_new_client_within_ttl(registry, tmp_path, clock):
    srv = Rec().bind(clock)
    make(registry, tmp_path, clock, srv).get(f"{API}/x")
    make(registry, tmp_path, clock, srv).get(f"{API}/x")
    assert sum(1 for _, p in srv.times if p == "/robots.txt") == 1
    clock.now += 25 * 3600
    make(registry, tmp_path, clock, srv).get(f"{API}/x")
    assert sum(1 for _, p in srv.times if p == "/robots.txt") == 2


def test_429_with_retry_after_stops_and_persists_next_fetch(registry, tmp_path, clock):
    srv = Rec(data=lambda r: httpx.Response(429, headers={"retry-after": "7200"})).bind(clock)
    started = clock.now
    with pytest.raises(RateLimited) as err:
        make(registry, tmp_path, clock, srv).get(f"{API}/x")
    assert err.value.retry_at == pytest.approx(started + 120 + 7200)  # after the spaced robots+data slots
    assert "back off" in str(err.value) and "re-run" in str(err.value)
    n = len(srv.times)
    # a brand-new client (another process) refuses without touching the network
    with pytest.raises(RateLimited):
        make(registry, tmp_path, clock, srv).get(f"{API}/x")
    assert len(srv.times) == n
    saved = [json.loads(p.read_text()) for p in (tmp_path / "cache" / "_state" / "hosts").glob("*.json")]
    assert saved[0]["blocked_until"] == pytest.approx(err.value.retry_at)
    clock.now = err.value.retry_at + 1
    make(registry, tmp_path, clock, Rec().bind(clock)).get(f"{API}/x")  # allowed again


def test_503_on_a_data_request_is_also_a_stop(registry, tmp_path, clock):
    srv = Rec(data=lambda r: httpx.Response(503)).bind(clock)
    with pytest.raises(RateLimited):
        make(registry, tmp_path, clock, srv).get(f"{API}/x")


def test_retry_after_parses_seconds_and_http_dates():
    assert parse_retry_after("120", 1000.0) == 1120.0
    when = datetime(2026, 10, 3, 12, 0, tzinfo=timezone.utc)
    assert parse_retry_after(format_datetime(when, usegmt=True), 0.0) == when.timestamp()
    assert parse_retry_after("garbage", 10.0, default_s=5.0) == 15.0
    assert parse_retry_after(None, 10.0, default_s=5.0) == 15.0


def test_crawl_delay_stricter_than_registry_is_respected(registry, tmp_path, clock):
    robots = httpx.Response(200, text="User-agent: *\nCrawl-delay: 500\n")
    srv = Rec(robots=robots).bind(clock)
    client = make(registry, tmp_path, clock, srv)
    client.get(f"{API}/x")
    client.get(f"{API}/x")
    data = [t for t, p in srv.times if p == "/x"]
    assert data[1] - data[0] >= 500


def test_crawl_delay_looser_than_registry_does_not_relax_it(registry, tmp_path, clock):
    srv = Rec(robots=httpx.Response(200, text="User-agent: *\nCrawl-delay: 1\n")).bind(clock)
    client = make(registry, tmp_path, clock, srv)
    client.get(f"{API}/x")
    client.get(f"{API}/x")
    data = [t for t, p in srv.times if p == "/x"]
    assert data[1] - data[0] >= registry.get("f1db").min_interval_s() - 1e-6


def test_in_process_spacing_ignores_wall_clock_jumps(tmp_path):
    mono = [0.0]
    slept = []
    t = HostThrottle(clock=lambda: mono[0], sleep=lambda s: (slept.append(s), mono.__setitem__(0, mono[0] + s)))
    t.wait("h", 10.0)
    mono[0] += 4
    t.wait("h", 10.0)  # no state dir: pure monotonic, wall never consulted
    assert slept == [6.0]
