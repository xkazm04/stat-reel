from datetime import date

import pytest

from statreel_ingest.registry import HostNotRegistered, LintFinding, Registry, SourceForbidden, lint_registry


def test_seed_registry_is_structurally_sound(registry: Registry):
    ids = [s.id for s in registry.sources]
    assert ids and len(ids) == len(set(ids))
    assert registry.get("f1db").license == "CC-BY-4.0"
    for s in registry.sources:  # what an ethics layer needs from every entry, whatever the count
        assert s.verdict in ("legal", "non_commercial", "paid", "avoid")
        assert s.terms_url.startswith("https://") and s.license
        assert all(h == h.lower() and "/" not in h and ":" not in h for h in s.hosts), s.id
        assert s.min_interval_s() >= 1.0, s.id
    assert not [f for f in lint_registry(registry.sources) if f.level == "error"]


API_URL = "https://api.github.com/repos/f1db/f1db/releases/latest"


@pytest.mark.parametrize("url, why", [
    ("http://api.github.com/x", "not https"),
    ("https://api.github.com:8443/x", "non-default port"),
    ("https://api.github.com:80/x", "non-default port"),
    ("https://user@api.github.com/x", "userinfo"),
    ("https://api.github.com:pw@evil.example/x", "userinfo"),
    ("https://evil.example@api.github.com/x", "userinfo"),
    ("https://api.github.com:notaport/x", "malformed"),
    ("ftp://api.github.com/x", "not https"),
    ("//api.github.com/x", "not https"),
    ("https://api.github.com.evil.example/x", "host not registered"),
])
def test_authorize_rejects_url_tricks(registry: Registry, url, why):
    with pytest.raises(HostNotRegistered, match=why):
        registry.authorize("f1db", url)


def test_authorize_accepts_plain_and_explicit_default_port(registry: Registry):
    registry.authorize("f1db", API_URL)
    registry.authorize("f1db", "https://API.github.com:443/x")


def _src(registry, source_id, **over):
    return registry.get(source_id).model_copy(update=over)


def test_lint_flags_host_shared_with_differing_verdicts(registry: Registry):
    a = _src(registry, "f1db", id="a", hosts=["h.example"], verdict="legal")
    b = _src(registry, "f1db", id="b", hosts=["h.example"], verdict="non_commercial")
    c = _src(registry, "f1db", id="c", hosts=["h.example"], verdict="legal")
    codes = [f.code for f in lint_registry([a, b], today=date(2026, 10, 3))]
    assert codes == ["host-verdict-conflict"]
    assert lint_registry([a, c], today=date(2026, 10, 3)) == []


def test_lint_warns_on_stale_terms_but_not_on_fresh(registry: Registry):
    old = _src(registry, "f1db", id="old", terms_checked_at=date(2026, 1, 1))
    new = _src(registry, "f1db", id="new", terms_checked_at=date(2026, 9, 1))
    findings = lint_registry([old, new], today=date(2026, 10, 3), max_age_days=180)
    assert [(f.level, f.code) for f in findings] == [("warn", "stale-terms")] and "old" in findings[0].message
    assert lint_registry([old], today=date(2026, 10, 3), max_age_days=365) == []


def test_lint_flags_avoid_source_with_hosts(registry: Registry):
    bad = _src(registry, "fbref", hosts=["fbref.com"])  # model_copy skips the validator on purpose
    assert LintFinding("error", "avoid-has-hosts", "fbref: verdict avoid but lists hosts ['fbref.com']") in lint_registry(
        [bad], today=date(2026, 10, 3), max_age_days=10_000)


def test_avoid_sources_have_no_hosts(registry: Registry):
    avoided = [s for s in registry.sources if s.verdict == "avoid"]
    assert avoided, "seed registry lists avoid sources"
    assert all(not s.hosts for s in avoided)


def test_avoid_verdict_is_unreachable(registry: Registry):
    with pytest.raises(SourceForbidden):
        registry.authorize("fbref", "https://fbref.com/en/")


def test_unregistered_host_is_refused(registry: Registry):
    with pytest.raises(HostNotRegistered):
        registry.authorize("f1db", "https://example.com/f1db.zip")


def test_host_must_belong_to_the_named_source(registry: Registry):
    # api.github.com is registered for f1db, but not for wikidata
    registry.authorize("f1db", "https://api.github.com/repos/f1db/f1db/releases/latest")
    with pytest.raises(HostNotRegistered):
        registry.authorize("wikidata", "https://api.github.com/repos/f1db/f1db/releases/latest")


def test_paid_source_without_hosts_is_unreachable(registry: Registry):
    with pytest.raises(HostNotRegistered):
        registry.authorize("sportradar-nba", "https://api.sportradar.com/nba/")


def test_rate_limit_runs_at_half_the_published_limit(registry: Registry):
    # published 60 / hour -> one per 60 s -> run at one per 120 s
    assert registry.get("f1db").min_interval_s() == pytest.approx(120.0)
    # published 5 / minute -> one per 12 s -> one per 24 s
    assert registry.get("balldontlie").min_interval_s() == pytest.approx(24.0)


def test_burst_limit_is_also_halved(registry: Registry):
    # jolpica: 500/h (7.2 s) and 4/s burst; the sustained limit dominates -> 14.4 s
    assert registry.get("jolpica-f1").min_interval_s() == pytest.approx(14.4)


def test_default_interval_when_none_published(registry: Registry):
    assert registry.get("wikidata").min_interval_s() == pytest.approx(3.0)


def test_duplicate_ids_are_rejected(tmp_path):
    p = tmp_path / "s.yaml"
    entry = (
        "- {id: a, sport: F1, url: 'https://a', access: api, hosts: [a], verdict: legal, license: x,"
        " attribution: x, kinds: [hist], rate_limit: null, terms_url: 'https://a', terms_checked_at: 2026-09-29}\n"
    )
    p.write_text(entry * 2)
    with pytest.raises(ValueError, match="duplicate"):
        Registry.load(p)


def test_avoid_source_with_hosts_is_rejected(tmp_path):
    p = tmp_path / "s.yaml"
    p.write_text(
        "- {id: a, sport: F1, url: 'https://a', access: api, hosts: [a.com], verdict: avoid, license: x,"
        " attribution: null, kinds: [], rate_limit: null, terms_url: 'https://a', terms_checked_at: 2026-09-29}\n"
    )
    with pytest.raises(ValueError, match="avoid"):
        Registry.load(p)


@pytest.mark.parametrize("rate_limit", [
    "{requests: 0, per_s: 60}",      # min_interval_s would divide by zero
    "{requests: -5, per_s: 60}",     # negative spacing = no throttle at all
    "{requests: 5, per_s: 0}",       # zero spacing
    "{requests: 5, per_s: 60, burst_per_s: 0}",
])
def test_a_rate_limit_that_cannot_space_requests_is_rejected(tmp_path, rate_limit):
    p = tmp_path / "s.yaml"
    p.write_text(
        "- {id: a, sport: F1, url: 'https://a', access: api, hosts: [a.example], verdict: legal, license: x,"
        f" attribution: x, kinds: [hist], rate_limit: {rate_limit}, terms_url: 'https://a', terms_checked_at: 2026-09-29}}\n"
    )
    with pytest.raises(ValueError, match="greater than 0"):
        Registry.load(p)
