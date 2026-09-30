"""Lane 1 end to end: ingest -> dbt (staging -> core -> marts -> llm) -> lineage -> capabilities.

Replay: the f1db-mini fixture served through the real EthicalClient over a mock transport.
Live (`-m live`): the real f1db release through the ethics layer into data/raw, real warehouse.
"""

from __future__ import annotations

import hashlib
import io
import zipfile
from collections import defaultdict
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import httpx
import pytest

from statreel_ingest.client import EthicalClient
from statreel_ingest.config import Paths, owner_contact
from statreel_ingest.registry import Registry
from statreel_ingest.snapshot import current_snapshot
from statreel_ingest.sources import f1db
from statreel_ingest.transform import run_transform

FIXTURE = Path(__file__).parent / "fixtures" / "f1db-mini"
CURRENT_POINTS = {1: 25, 2: 18, 3: 15, 4: 12, 5: 10, 6: 8, 7: 6, 8: 4, 9: 2, 10: 1}
NON_STARTS = {"DNQ", "DNPQ", "DNS", "DNP"}
MINI_CAPS = """
- sport: F1
  kind: hist
  source_id: f1db
  relation: core.player_season_stats
  season_column: season
  checks: {min_rows: 100, coverage_from_max: 1950, min_seasons: 8, max_null_ratio: {points_current_system: 0.0}}
- sport: F1
  kind: bio
  source_id: f1db
  relation: core.players
  checks: {min_rows: 100, max_null_ratio: {full_name: 0.0}}
"""


def fixture_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for csv in sorted(FIXTURE.glob("*.csv")):
            z.write(csv, csv.name)
    return buf.getvalue()


def replay_transport(blob: bytes) -> httpx.MockTransport:
    api, assets = "https://api.github.com", "https://release-assets.githubusercontent.com"

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url.endswith("/robots.txt"):
            return httpx.Response(404)
        if url == f1db.LATEST:
            return httpx.Response(200, json={"tag_name": "v-mini", "published_at": "2026-09-27T00:00:00Z", "assets": [
                {"name": "f1db-csv.zip", "url": f"{api}/repos/f1db/f1db/releases/assets/9",
                 "digest": "sha256:" + hashlib.sha256(blob).hexdigest()}]})
        if url == f"{api}/repos/f1db/f1db/releases/assets/9":
            return httpx.Response(302, headers={"location": f"{assets}/mini"})
        if url == f"{assets}/mini":
            return httpx.Response(200, content=blob)
        return httpx.Response(404)

    return httpx.MockTransport(handler)


def expected_from_raw(results_csv: Path, races_csv: Path) -> dict[str, dict]:
    """Independent oracle: starts and current-system points straight from the CSVs, in Python."""
    con = duckdb.connect()
    indy = {r[0] for r in con.execute(f"select id from read_csv('{races_csv.as_posix()}') where grandPrixId = 'indianapolis'").fetchall()}
    rows = con.execute(f"select raceId, driverId, positionNumber, positionText, sharedCar from read_csv('{results_csv.as_posix()}')").fetchall()
    sharers = defaultdict(int)
    for race, _, pos, _, shared in rows:
        if shared and pos:
            sharers[(race, pos)] += 1
    # a driver can appear twice in one race (took over a team-mate's car): one start, both results score
    races: dict[str, set] = defaultdict(set)
    points: dict[str, float] = defaultdict(float)
    for race, driver, pos, text, shared in rows:
        if race in indy or text in NON_STARTS:
            continue
        races[driver].add(race)
        pts = CURRENT_POINTS.get(pos, 0) if pos else 0
        points[driver] += pts / sharers[(race, pos)] if shared and pos else pts
    return {d: {"starts": len(races[d]), "points": points[d]} for d in races}


@pytest.fixture(scope="module")
def replay_run(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("lane1")
    caps = tmp / "caps.yaml"
    caps.write_text(MINI_CAPS)
    paths = replace(Paths(), raw=tmp / "raw", http_cache=tmp / "cache", warehouse=tmp / "warehouse.duckdb", capabilities=caps)
    client = EthicalClient(Registry.load(paths.registry), "f1db", contact="https://example.org/c", cache_dir=paths.http_cache, log_path=tmp / "log.jsonl",
                           transport=replay_transport(fixture_zip()), sleep=lambda s: None)
    f1db.ingest(client, paths.raw, now=datetime(2026, 9, 29, tzinfo=timezone.utc))
    code = run_transform(paths)
    con = duckdb.connect(str(paths.warehouse), read_only=True)
    yield {"code": code, "con": con, "paths": paths}
    con.close()


def test_transform_succeeds_and_all_capabilities_pass(replay_run):
    assert replay_run["code"] == 0


def test_conformed_core_and_mart_exist(replay_run):
    con = replay_run["con"]
    tables = {f"{s}.{t}" for s, t in con.execute("select table_schema, table_name from information_schema.tables").fetchall()}
    for rel in ("core.players", "core.seasons", "core.matches", "core.player_match_results", "core.player_season_stats",
                "marts.mart_era_adjusted", "llm.f1_driver_era_adjusted", "llm.f1_driver_seasons",
                "core.teams", "llm.f1_race_results", "llm.f1_constructor_seasons", "llm.f1_driver_bios", "llm.f1_seasons"):
        assert rel in tables, rel


def test_mart_matches_the_independent_oracle(replay_run):
    con = replay_run["con"]
    oracle = expected_from_raw(FIXTURE / "f1db-races-race-results.csv", FIXTURE / "f1db-races.csv")
    got = {pid: (starts, pts) for pid, starts, pts in
           con.execute("select player_id, starts, points_current_system from marts.mart_era_adjusted").fetchall()}
    assert set(got) == {d for d, v in oracle.items() if v["starts"] > 0}
    for driver, v in oracle.items():
        if v["starts"]:
            assert got[driver][0] == v["starts"], driver
            assert got[driver][1] == pytest.approx(v["points"]), driver


def test_indianapolis_only_drivers_are_not_in_the_mart(replay_run):
    con = replay_run["con"]
    indy_only = con.execute("""
        select r.player_id from core.player_match_results r join core.matches m using (sport, match_id)
        group by 1 having bool_and(m.is_indianapolis)""").fetchall()
    assert indy_only, "fixture contains Indianapolis-only drivers"
    names = {r[0] for r in con.execute("select player_id from marts.mart_era_adjusted").fetchall()}
    assert not names & {r[0] for r in indy_only}


def test_adjusted_rank_only_ranks_eligible_drivers(replay_run):
    con = replay_run["con"]
    bad = con.execute("select count(*) from marts.mart_era_adjusted where rank_adjusted is not null and not eligible").fetchone()[0]
    assert bad == 0
    ranks = [r[0] for r in con.execute("select rank_adjusted from marts.mart_era_adjusted where eligible order by rank_adjusted").fetchall()]
    assert ranks == list(range(1, len(ranks) + 1))


def test_lineage_marks_every_model_legal_from_f1db(replay_run):
    con = replay_run["con"]
    rows = dict(con.execute("select model, license_class from meta.model_lineage").fetchall())
    assert rows["mart_era_adjusted"] == "legal" and rows["f1_driver_era_adjusted"] == "legal"
    srcs = con.execute("select sources from meta.model_lineage where model = 'mart_era_adjusted'").fetchone()[0]
    assert srcs == ["f1db"]


def test_llm_views_are_documented_for_the_model(replay_run):
    con = replay_run["con"]
    undocumented = con.execute("""select table_name || '.' || column_name from duckdb_columns()
        where schema_name = 'llm' and (comment is null or comment = '')""").fetchall()
    assert undocumented == []
    view_comment = con.execute("select comment from duckdb_views() where schema_name = 'llm' and view_name = 'f1_driver_era_adjusted'").fetchone()[0]
    assert view_comment and "F1DB" in view_comment


def test_llm_rows_carry_fact_keys_and_attribution(replay_run):
    con = replay_run["con"]
    keys, attributions = con.execute("select count(distinct fact_key) = count(*), any_value(attribution) from llm.f1_driver_era_adjusted").fetchone()
    assert keys and attributions == "Data: F1DB (CC BY 4.0)"


def test_capabilities_and_snapshots_recorded(replay_run):
    con = replay_run["con"]
    caps = con.execute("select sport, kind, source_id, license_class, status from meta.capabilities order by kind").fetchall()
    assert caps == [("F1", "bio", "f1db", "legal", "pass"), ("F1", "hist", "f1db", "legal", "pass")]
    snap = con.execute("select source_id, release_tag from meta.source_snapshots").fetchall()
    assert ("f1db", "v-mini") in snap


# --------------------------------------------------------------------------- live


@pytest.mark.live
def test_live_lane1_end_to_end():
    paths = Paths()
    registry = Registry.load(paths.registry)
    client = EthicalClient(registry, "f1db", contact=owner_contact(paths.repo), cache_dir=paths.http_cache,
                           log_path=paths.raw / "f1db" / "fetch_log.jsonl")
    res = f1db.ingest(client, paths.raw)
    assert current_snapshot(paths.raw, "f1db") == res.snapshot_dir
    assert run_transform(paths) == 0, "dbt build or a capability failed"
    con = duckdb.connect(str(paths.warehouse), read_only=True)
    try:
        # our `starts` agree with f1db's own totals for drivers who never raced the Indy 500
        mismatches = con.execute("""
            select m.player_id, m.starts, d.total_race_starts
            from marts.mart_era_adjusted m join staging_f1db.stg_f1db__drivers d on d.driver_id = m.player_id
            where m.player_id in ('lewis-hamilton', 'michael-schumacher', 'ayrton-senna', 'jim-clark', 'max-verstappen')
              and m.starts <> d.total_race_starts""").fetchall()
        assert mismatches == []
        n_seasons = con.execute("select count(distinct season) from core.player_season_stats").fetchone()[0]
        assert n_seasons >= 76
    finally:
        con.close()


def test_race_results_series_matches_the_mart_and_carries_fact_keys(replay_run):
    """The time-evolution formats replay race by race: the series must add up to the mart."""
    con = replay_run["con"]
    diff = con.execute("""
        with s as (select player_id, sum(points_current_system) filter (where not is_indianapolis) pts
                   from llm.f1_race_results group by 1)
        select count(*) from s join marts.mart_era_adjusted m using (player_id)
        where abs(s.pts - m.points_current_system) > 1e-6""").fetchone()[0]
    assert diff == 0
    unique, total = con.execute("select count(distinct fact_key), count(*) from llm.f1_race_results").fetchone()
    assert unique == total
    assert con.execute("select count(*) from llm.f1_race_results where team_name is null").fetchone()[0] == 0


def test_constructor_seasons_and_bios(replay_run):
    con = replay_run["con"]
    assert con.execute("select sum(wins) from llm.f1_constructor_seasons").fetchone()[0] ==         con.execute("select count(distinct race_id) from llm.f1_race_results where position_number = 1 and not is_indianapolis").fetchone()[0]
    assert con.execute("select count(*) from llm.f1_driver_bios where date_of_birth is not null").fetchone()[0] > 100
