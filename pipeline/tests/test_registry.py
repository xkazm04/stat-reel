import pytest

from statreel_ingest.registry import HostNotRegistered, Registry, SourceForbidden


def test_seed_registry_loads_all_sources(registry: Registry):
    assert len(registry.sources) == 31
    assert registry.get("f1db").license == "CC-BY-4.0"


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
