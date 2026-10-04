"""The ethics layer: every data request goes through EthicalClient."""

import json

import httpx
import pytest

from statreel_ingest.client import EthicalClient, MissingContact, RobotsDisallowed
from statreel_ingest.registry import HostNotRegistered, SourceForbidden

CONTACT = "https://example.org/statreel-contact"
API = "https://api.github.com"
ASSETS = "https://release-assets.githubusercontent.com"


def make_client(registry, tmp_path, clock, handler, source="f1db", contact=CONTACT):
    return EthicalClient(
        registry,
        source,
        contact=contact,
        cache_dir=tmp_path / "cache",
        log_path=tmp_path / "fetch_log.jsonl",
        transport=httpx.MockTransport(handler),
        clock=clock,
        sleep=clock.sleep,
    )


class Server:
    """Records requests; routes by URL."""

    def __init__(self, routes):
        self.routes = routes
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        key = str(request.url)
        if key not in self.routes:
            return httpx.Response(404)
        route = self.routes[key]
        return route(request) if callable(route) else route

    def hits(self, url):
        return sum(1 for r in self.requests if str(r.url) == url)


def robots_allow_all():
    return httpx.Response(404)


def test_user_agent_carries_version_and_contact(registry, tmp_path, clock):
    srv = Server({f"{API}/robots.txt": robots_allow_all(), f"{API}/x": httpx.Response(200, content=b"ok")})
    make_client(registry, tmp_path, clock, srv).get(f"{API}/x")
    ua = srv.requests[-1].headers["user-agent"]
    assert ua.startswith("StatReel/") and f"(+{CONTACT})" in ua


def test_refuses_to_run_without_contact(registry, tmp_path, clock):
    with pytest.raises(MissingContact):
        make_client(registry, tmp_path, clock, Server({}), contact="")


def test_avoid_source_cannot_even_build_a_client(registry, tmp_path, clock):
    with pytest.raises(SourceForbidden):
        make_client(registry, tmp_path, clock, Server({}), source="transfermarkt")


def test_unregistered_host_never_reaches_the_network(registry, tmp_path, clock):
    srv = Server({})
    with pytest.raises(HostNotRegistered):
        make_client(registry, tmp_path, clock, srv).get("https://example.com/data.csv")
    assert srv.requests == []


def test_robots_disallow_is_obeyed(registry, tmp_path, clock):
    robots = httpx.Response(200, text="User-agent: *\nDisallow: /private\n")
    srv = Server({f"{API}/robots.txt": robots})
    client = make_client(registry, tmp_path, clock, srv)
    with pytest.raises(RobotsDisallowed):
        client.get(f"{API}/private/file")
    assert srv.hits(f"{API}/private/file") == 0


def test_robots_is_fetched_once_per_day(registry, tmp_path, clock):
    srv = Server({f"{API}/robots.txt": robots_allow_all(), f"{API}/a": httpx.Response(200), f"{API}/b": httpx.Response(200)})
    client = make_client(registry, tmp_path, clock, srv)
    client.get(f"{API}/a")
    client.get(f"{API}/b")
    assert srv.hits(f"{API}/robots.txt") == 1
    clock.now += 25 * 3600
    client.get(f"{API}/a")
    assert srv.hits(f"{API}/robots.txt") == 2


def test_robots_server_error_means_disallow(registry, tmp_path, clock):
    srv = Server({f"{API}/robots.txt": httpx.Response(503)})
    with pytest.raises(RobotsDisallowed):
        make_client(registry, tmp_path, clock, srv).get(f"{API}/a")


def test_requests_to_one_host_are_throttled(registry, tmp_path, clock):
    srv = Server({f"{API}/robots.txt": robots_allow_all(), f"{API}/a": httpx.Response(200)})
    client = make_client(registry, tmp_path, clock, srv)
    client.get(f"{API}/a")
    client.get(f"{API}/a")
    # f1db publishes 60/h -> client runs at 1 per 120 s; robots.txt counts as a request too
    assert clock.slept == [pytest.approx(120.0), pytest.approx(120.0)]


def test_conditional_request_serves_cache_on_304(registry, tmp_path, clock):
    def resource(request):
        if request.headers.get("if-none-match") == '"v1"':
            return httpx.Response(304, headers={"etag": '"v1"'})
        return httpx.Response(200, content=b"payload", headers={"etag": '"v1"'})

    srv = Server({f"{API}/robots.txt": robots_allow_all(), f"{API}/r": resource})
    client = make_client(registry, tmp_path, clock, srv)
    first = client.get(f"{API}/r")
    second = client.get(f"{API}/r")
    assert (first.content, first.from_cache) == (b"payload", False)
    assert (second.content, second.from_cache) == (b"payload", True)
    assert srv.requests[-1].headers["if-none-match"] == '"v1"'


def test_redirect_to_registered_host_is_followed_with_checks(registry, tmp_path, clock):
    srv = Server({
        f"{API}/robots.txt": robots_allow_all(),
        f"{ASSETS}/robots.txt": robots_allow_all(),
        f"{API}/asset": httpx.Response(302, headers={"location": f"{ASSETS}/blob?sig=1"}),
        f"{ASSETS}/blob?sig=1": httpx.Response(200, content=b"zipbytes"),
    })
    res = make_client(registry, tmp_path, clock, srv).get(f"{API}/asset")
    assert res.content == b"zipbytes" and res.final_url == f"{ASSETS}/blob?sig=1"
    assert srv.hits(f"{ASSETS}/robots.txt") == 1


def test_redirect_to_unregistered_host_is_refused(registry, tmp_path, clock):
    srv = Server({
        f"{API}/robots.txt": robots_allow_all(),
        f"{API}/asset": httpx.Response(302, headers={"location": "https://evil.example/blob"}),
    })
    with pytest.raises(HostNotRegistered):
        make_client(registry, tmp_path, clock, srv).get(f"{API}/asset")
    assert not any(r.url.host == "evil.example" for r in srv.requests)


def test_every_fetch_is_logged(registry, tmp_path, clock):
    srv = Server({f"{API}/robots.txt": robots_allow_all(), f"{API}/a": httpx.Response(200, content=b"12345")})
    make_client(registry, tmp_path, clock, srv).get(f"{API}/a")
    lines = [json.loads(l) for l in (tmp_path / "fetch_log.jsonl").read_text().splitlines()]
    data = [l for l in lines if l["url"] == f"{API}/a"]
    assert data and data[0]["status"] == 200 and data[0]["bytes"] == 5 and "duration_ms" in data[0]
    assert data[0]["source_id"] == "f1db"


def test_signed_redirect_targets_are_never_cached(registry, tmp_path, clock):
    srv = Server({
        f"{API}/robots.txt": robots_allow_all(),
        f"{ASSETS}/robots.txt": robots_allow_all(),
        f"{API}/asset": httpx.Response(302, headers={"location": f"{ASSETS}/blob?sig=secret"}),
        f"{ASSETS}/blob?sig=secret": httpx.Response(200, content=b"zip", headers={"etag": '"e"'}),
    })
    make_client(registry, tmp_path, clock, srv).get(f"{API}/asset")
    cached = list((tmp_path / "cache").rglob("*")) if (tmp_path / "cache").exists() else []
    assert not any("sig=secret" in p.read_text(errors="ignore") for p in cached if p.is_file())


# ---- ethics-layer edge cases: robots status classes, scheme downgrade, redirect loops -------------

def test_robots_4xx_means_no_restrictions(registry, tmp_path, clock):
    srv = Server({f"{API}/robots.txt": httpx.Response(403), f"{API}/a": httpx.Response(200, content=b"ok")})
    assert make_client(registry, tmp_path, clock, srv).get(f"{API}/a").content == b"ok"


def test_robots_network_error_means_disallow(registry, tmp_path, clock):
    def boom(request):
        raise httpx.ConnectError("unreachable", request=request)

    srv = Server({f"{API}/robots.txt": boom})
    with pytest.raises(RobotsDisallowed):
        make_client(registry, tmp_path, clock, srv).get(f"{API}/a")
    assert srv.hits(f"{API}/a") == 0


def test_redirect_downgrade_to_http_is_refused(registry, tmp_path, clock):
    srv = Server({
        f"{API}/robots.txt": robots_allow_all(),
        f"{API}/asset": httpx.Response(302, headers={"location": "http://api.github.com/blob"}),
    })
    with pytest.raises(HostNotRegistered, match="not https"):
        make_client(registry, tmp_path, clock, srv).get(f"{API}/asset")
    assert srv.hits("http://api.github.com/blob") == 0


def test_redirect_to_a_non_default_port_is_refused(registry, tmp_path, clock):
    srv = Server({
        f"{API}/robots.txt": robots_allow_all(),
        f"{API}/asset": httpx.Response(302, headers={"location": f"{API}:8443/blob"}),
    })
    with pytest.raises(HostNotRegistered, match="port"):
        make_client(registry, tmp_path, clock, srv).get(f"{API}/asset")


def test_redirect_loop_stops_at_max_redirects(registry, tmp_path, clock):
    from statreel_ingest.client import MAX_REDIRECTS

    srv = Server({f"{API}/robots.txt": robots_allow_all(), f"{API}/loop": httpx.Response(302, headers={"location": f"{API}/loop"})})
    with pytest.raises(httpx.TooManyRedirects):
        make_client(registry, tmp_path, clock, srv).get(f"{API}/loop")
    assert srv.hits(f"{API}/loop") == MAX_REDIRECTS + 1


def test_relative_redirect_is_resolved_and_rechecked(registry, tmp_path, clock):
    srv = Server({
        f"{API}/robots.txt": robots_allow_all(),
        f"{API}/a": httpx.Response(301, headers={"location": "/b"}),
        f"{API}/b": httpx.Response(200, content=b"b"),
    })
    res = make_client(registry, tmp_path, clock, srv).get(f"{API}/a")
    assert res.final_url == f"{API}/b" and res.content == b"b"


# ---- the fetch log records failures too, not only responses -----------------------------------------

def _log_rows(tmp_path):
    return [json.loads(l) for l in (tmp_path / "fetch_log.jsonl").read_text().splitlines()]


def test_a_transport_failure_on_a_data_request_is_logged(registry, tmp_path, clock):
    def timeout(request):
        raise httpx.ReadTimeout("slow", request=request)

    srv = Server({f"{API}/robots.txt": robots_allow_all(), f"{API}/a": timeout})
    with pytest.raises(httpx.ReadTimeout):
        make_client(registry, tmp_path, clock, srv).get(f"{API}/a")
    row = [r for r in _log_rows(tmp_path) if r["url"] == f"{API}/a"]
    assert row and row[0]["status"] is None and row[0]["error"] == "ReadTimeout" and row[0]["source_id"] == "f1db"


def test_an_unreachable_robots_txt_is_logged_before_the_run_is_refused(registry, tmp_path, clock):
    def boom(request):
        raise httpx.ConnectError("unreachable", request=request)

    srv = Server({f"{API}/robots.txt": boom})
    with pytest.raises(RobotsDisallowed):
        make_client(registry, tmp_path, clock, srv).get(f"{API}/a")
    assert [(r["url"], r["status"], r["error"]) for r in _log_rows(tmp_path)] == [(f"{API}/robots.txt", None, "ConnectError")]


def test_missing_contact_names_the_places_the_contact_is_actually_read_from(registry, tmp_path, clock):
    with pytest.raises(MissingContact) as err:
        make_client(registry, tmp_path, clock, Server({}), contact=" ")
    assert "STATREEL_CONTACT" in str(err.value) and ".statreel/config.json" in str(err.value)
    assert "ingest.yaml" not in str(err.value)  # never existed; config.owner_contact reads the two above
