from datetime import date

import duckdb
import pytest

from statreel_ingest.capabilities import evaluate_capabilities

SPEC = """
- sport: F1
  kind: hist
  source_id: f1db
  relation: core.player_season_stats
  season_column: season
  checks:
    min_rows: 3
    coverage_from_max: 1950
    min_seasons: 2
    max_null_ratio: {points_current_system: 0.0}
- sport: F1
  kind: live
  source_id: f1db
  relation: core.matches
  date_column: race_date
  checks:
    max_staleness_days: 21
"""


@pytest.fixture
def con():
    c = duckdb.connect()
    c.execute("create schema core")
    c.execute("create table core.player_season_stats as select * from (values "
              "('fangio', 1950, 25.0), ('fangio', 1951, 30.0), ('clark', 1963, 40.0)) t(driver_id, season, points_current_system)")
    c.execute("create table core.matches as select * from (values (date '2026-09-21'), (date '1950-05-13')) t(race_date)")
    return c


def rows(con, tmp_path, registry, spec=SPEC, today=date(2026, 9, 29)):
    p = tmp_path / "caps.yaml"
    p.write_text(spec)
    out = evaluate_capabilities(con, p, registry, today=today)
    return {(r["sport"], r["kind"]): r for r in out}


def test_passing_capability_records_coverage_and_licence(con, tmp_path, registry):
    r = rows(con, tmp_path, registry)[("F1", "hist")]
    assert r["status"] == "pass" and r["license_class"] == "legal"
    assert (r["coverage_from"], r["coverage_to"], r["rows"]) == (1950, 1963, 3)


def test_capabilities_are_persisted(con, tmp_path, registry):
    rows(con, tmp_path, registry)
    got = con.execute("select sport, kind, source_id, status from meta.capabilities order by kind").fetchall()
    assert got == [("F1", "hist", "f1db", "pass"), ("F1", "live", "f1db", "pass")]


def test_null_ratio_breach_fails_with_a_reason(con, tmp_path, registry):
    con.execute("insert into core.player_season_stats values ('hill', 1996, null)")
    r = rows(con, tmp_path, registry)[("F1", "hist")]
    assert r["status"] == "fail" and "points_current_system" in r["detail"]


def test_stale_live_data_fails(con, tmp_path, registry):
    r = rows(con, tmp_path, registry, today=date(2026, 11, 30))[("F1", "live")]
    assert r["status"] == "fail" and "stale" in r["detail"]


def test_missing_relation_is_a_failure_not_a_crash(con, tmp_path, registry):
    spec = "- {sport: NBA, kind: hist, source_id: balldontlie, relation: core.nope, checks: {min_rows: 1}}\n"
    r = rows(con, tmp_path, registry, spec=spec)[("NBA", "hist")]
    assert r["status"] == "fail" and "core.nope" in r["detail"]


def test_avoid_source_can_never_pass(con, tmp_path, registry):
    spec = "- {sport: Soccer, kind: hist, source_id: fbref, relation: core.matches, checks: {min_rows: 1}}\n"
    r = rows(con, tmp_path, registry, spec=spec)[("Soccer", "hist")]
    assert r["status"] == "fail" and "avoid" in r["detail"]
