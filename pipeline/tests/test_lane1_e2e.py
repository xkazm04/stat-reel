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
    # f1db flags sharedCar only on the drivers who took a car over, so a classified position is shared when ANY
    # entry at it is flagged, and its points split between every driver classified there
    at, shared_at = defaultdict(int), set()
    for race, _, pos, text, shared in rows:
        if pos and text not in NON_STARTS:
            at[(race, pos)] += 1
            if shared:
                shared_at.add((race, pos))
    # a driver can appear twice in one race (took over a team-mate's car): one start, both results score
    races: dict[str, set] = defaultdict(set)
    points: dict[str, float] = defaultdict(float)
    for race, driver, pos, text, shared in rows:
        if race in indy or text in NON_STARTS:
            continue
        races[driver].add(race)
        pts = CURRENT_POINTS.get(pos, 0) if pos else 0
        points[driver] += pts / at[(race, pos)] if (race, pos) in shared_at else pts
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
                "core.teams", "llm.f1_race_results", "llm.f1_driver_race_cumulative", "core.driver_race_cumulative", "llm.f1_constructor_seasons", "llm.f1_driver_bios", "llm.f1_seasons"):
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


def test_a_shared_car_scores_its_position_once_split_between_all_its_drivers(replay_run):
    """f1db flags sharedCar only on the drivers who took a car over; the driver who started it reads false. The car
    still finished in ONE position: its current-system points summed over every driver classified with it equal
    that position's points (f1db's own as-awarded points split the same way - 1951 French GP: Fagioli 4 + Fangio 5)."""
    con = replay_run["con"]
    raw = con.execute("""
        select count(*) from (select race_id, position_number from staging_f1db.stg_f1db__race_results
                              where started and position_number is not null
                              group by all having bool_or(shared_car) and not bool_and(shared_car))""").fetchone()[0]
    assert raw > 0, "fixture has a shared car whose starter is unflagged"
    groups = con.execute("""
        select match_id, position_number, sum(points_current_system), bool_and(shared_car)
        from core.player_match_results where started and position_number between 1 and 10
        group by all having bool_or(shared_car)""").fetchall()
    assert [(m, p, pts) for m, p, pts, _ in groups if abs(pts - CURRENT_POINTS[p]) > 1e-9] == []
    assert all(every for *_, every in groups), "shared_car marks every driver of a shared car"


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


def test_titles_count_championships_won_not_the_leader_of_a_season_in_progress(replay_run):
    """Far-side oracle: f1db's own championshipWon flag. The fixture's 2026 season is in progress, so its
    leader holds championship_position 1 and has won nothing yet."""
    con = replay_run["con"]
    standings = (FIXTURE / "f1db-seasons-driver-standings.csv").as_posix()
    won = dict(duckdb.connect().execute(
        f"select driverId, count(*) filter (where championshipWon) from read_csv('{standings}') group by 1").fetchall())
    got = dict(con.execute("select player_id, titles from marts.mart_era_adjusted").fetchall())
    assert {d: (t, won.get(d, 0)) for d, t in got.items() if t != won.get(d, 0)} == {}
    leader = con.execute("select player_id from core.player_season_stats where season = 2026 and championship_position = 1").fetchall()
    assert leader and not won.get(leader[0][0]), "fixture has a mid-season leader with no title"


def test_driver_season_points_plus_sprint_points_reconcile_with_official_championship_points(replay_run):
    """points_awarded is Grand Prix only; sprint_points carries the Sprint part (2021 on), so the two add up to
    f1db's championship points in every season without dropped scores (1991 on)."""
    con = replay_run["con"]
    rows = con.execute("""
        select d.season, d.player_id, d.points_awarded, d.sprint_points, o.championship_points
        from llm.f1_driver_seasons d
        join staging_f1db.stg_f1db__season_driver_standings o on o.season = d.season and o.driver_id = d.player_id
        where d.season >= 1991""").fetchall()
    assert {r[0] for r in rows} >= {2008, 2024, 2025, 2026}
    assert [r for r in rows if abs(r[2] + r[3] - r[4]) > 1e-9] == []
    assert any(r[3] > 0 for r in rows) and all(r[3] == 0 for r in rows if r[0] < 2021)


def test_lineage_marks_every_model_legal_from_f1db(replay_run):
    """EVERY model, not a sample: a model that reads a file outside a declared dbt source has no parent in the
    manifest, and lineage then reports it legal with no sources at all (core.data_snapshot did)."""
    con = replay_run["con"]
    rows = {m: (c, list(s)) for m, c, s in con.execute("select model, license_class, sources from meta.model_lineage").fetchall()}
    assert {"mart_era_adjusted", "f1_driver_era_adjusted", "data_snapshot", "f1_data_as_of"} <= set(rows)
    assert {m: v for m, v in rows.items() if v != ("legal", ["f1db"])} == {}


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


def test_constructor_podium_finishes_match_the_far_side_oracle(replay_run):
    """Podium finishes are CARS on the podium: two team cars count twice, a car shared between drivers once."""
    con = replay_run["con"]
    res, races = (FIXTURE / "f1db-races-race-results.csv").as_posix(), (FIXTURE / "f1db-races.csv").as_posix()
    rows = duckdb.connect().execute(f"""
        select r.constructorId, r.year, r.raceId, r.positionNumber, r.sharedCar from read_csv('{res}') r
        join read_csv('{races}') g on g.id = r.raceId
        where g.grandPrixId <> 'indianapolis' and r.positionNumber <= 3
          and r.positionText not in ('DNQ', 'DNPQ', 'DNS', 'DNP')""").fetchall()
    cars: dict[tuple, set] = defaultdict(set)
    for team, season, race, pos, _ in rows:
        cars[(team, season)].add((race, pos))
    assert any(shared for *_, shared in rows), "fixture has a shared car on the podium"
    got = {(t, s): n for t, s, n in con.execute("select team_id, season, podium_finishes from llm.f1_constructor_seasons").fetchall() if n}
    assert got == {k: len(v) for k, v in cars.items()}


# --------------------------------------------------------------------------- llm.f1_driver_race_cumulative


def cumulative_oracle(results_csv: Path, races_csv: Path) -> dict[tuple[str, int], dict]:
    """Far-side oracle in plain Python: cumulative starts/wins/podiums per (driver, race) from the CSVs,
    dense from each driver's first start to the last race with results; Indianapolis is not a race."""
    con = duckdb.connect()
    races = con.execute(f"""select id from read_csv('{races_csv.as_posix()}') where grandPrixId <> 'indianapolis'
                            order by year, round""").fetchall()
    rows = con.execute(f"select raceId, driverId, positionNumber, positionText from read_csv('{results_csv.as_posix()}')").fetchall()
    with_results = {r[0] for r in rows}
    order = [r[0] for r in races if r[0] in with_results]
    entered, won, podium = defaultdict(set), defaultdict(set), defaultdict(set)
    for race, driver, pos, text in rows:
        if text in NON_STARTS:
            continue
        entered[driver].add(race)
        if pos == 1:
            won[driver].add(race)
        if pos and pos <= 3:
            podium[driver].add(race)
    out = {}
    for driver, ents in entered.items():
        if not ents & set(order):
            continue
        debut = min(i for i, race in enumerate(order) if race in ents)
        for i in range(debut, len(order)):
            upto = set(order[: i + 1])
            out[(driver, order[i])] = {
                "entered": order[i] in ents, "starts": len(ents & upto), "wins": len(won[driver] & upto), "podiums": len(podium[driver] & upto)}
    return out


def test_driver_race_cumulative_matches_the_far_side_oracle(replay_run):
    con = replay_run["con"]
    oracle = cumulative_oracle(FIXTURE / "f1db-races-race-results.csv", FIXTURE / "f1db-races.csv")
    got = {(d, r): {"entered": e, "starts": s, "wins": w, "podiums": p} for d, r, e, s, w, p in con.execute(
        "select player_id, race_id, entered, starts_cum, wins_cum, podiums_cum from llm.f1_driver_race_cumulative").fetchall()}
    assert got == oracle
    assert any(v["wins"] > 1 for v in oracle.values())


def test_driver_race_cumulative_is_dense_after_debut_and_carries_totals_forward(replay_run):
    con = replay_run["con"]
    gaps = con.execute("""
        select count(*) from (
            select player_id, max(race_seq) - min(race_seq) + 1 - count(*) as missing
            from llm.f1_driver_race_cumulative group by 1) where missing <> 0""").fetchone()[0]
    assert gaps == 0
    latest = con.execute("select max(race_seq) from llm.f1_driver_race_cumulative").fetchone()[0]
    assert con.execute("select count(distinct player_id) from llm.f1_driver_race_cumulative where race_seq = ?", [latest]).fetchone()[0] == \
        con.execute("select count(distinct player_id) from llm.f1_driver_race_cumulative").fetchone()[0]
    # every driver's first row is a start; totals never decrease
    assert con.execute("""select count(*) from (select player_id, first(entered order by race_seq) f from llm.f1_driver_race_cumulative group by 1)
                          where not f""").fetchone()[0] == 0
    assert con.execute("""select count(*) from (select wins_cum - lag(wins_cum) over (partition by player_id order by race_seq) d
                          from llm.f1_driver_race_cumulative) where d < 0""").fetchone()[0] == 0


def test_driver_race_cumulative_rank_is_unique_per_race_and_tied_flags_ties(replay_run):
    con = replay_run["con"]
    bad = con.execute("""select count(*) from (select race_id, count(*) n, count(distinct rank_wins_cum) r, max(rank_wins_cum) m
                         from llm.f1_driver_race_cumulative group by 1) where n <> r or n <> m""").fetchone()[0]
    assert bad == 0
    assert con.execute("select count(*) from llm.f1_driver_race_cumulative where tied and wins_cum > 0").fetchone()[0] > 0
    assert con.execute("""select count(*) from llm.f1_driver_race_cumulative a where tied and not exists (
        select 1 from llm.f1_driver_race_cumulative b where b.race_id = a.race_id and b.wins_cum = a.wins_cum and b.player_id <> a.player_id)""").fetchone()[0] == 0
    unique, total = con.execute("select count(distinct fact_key), count(*) from llm.f1_driver_race_cumulative").fetchone()
    assert unique == total


# --------------------------------------------------------------------------- llm.f1_season_standings_by_round


def test_standings_by_round_reconcile_with_official_championship_points(replay_run):
    """After the final round, points_cum equals f1db's championship_points - for every season without
    dropped scores (before 1991 only a best-N subset counted, which this view deliberately does not apply)."""
    con = replay_run["con"]
    seasons = [r[0] for r in con.execute("select distinct season from llm.f1_season_standings_by_round where not drops_apply order by 1").fetchall()]
    assert {2008, 2024, 2025, 2026} <= set(seasons)
    mismatches = con.execute("""
        with mine as (select season, player_id, points_cum from llm.f1_season_standings_by_round where is_final_round and not drops_apply),
             official as (select season, driver_id as player_id, championship_points from staging_f1db.stg_f1db__season_driver_standings)
        select coalesce(m.season, o.season), coalesce(m.player_id, o.player_id), m.points_cum, o.championship_points
        from mine m full join official o on o.season = m.season and o.player_id = m.player_id
        where coalesce(m.season, o.season) in (select season from mine)
          and coalesce(m.points_cum, 0) <> coalesce(o.championship_points, 0)""").fetchall()
    assert mismatches == []


def test_standings_by_round_final_rank_matches_official_position_and_includes_sprints(replay_run):
    """Compared where points are not tied: the documented tie-break stops at Grand Prix finishes down to 8th, so
    a points tie that f1db settles by Sprint results or "earliest achieved" (2026: three drivers on 7) may differ."""
    con = replay_run["con"]
    wrong = con.execute("""
        select s.season, s.player_id, s.rank, o.championship_position
        from llm.f1_season_standings_by_round s
        join staging_f1db.stg_f1db__season_driver_standings o on o.season = s.season and o.driver_id = s.player_id
        where s.is_final_round and not s.drops_apply and s.points_cum > 0 and not s.tied_on_points and s.rank <> o.championship_position""").fetchall()
    assert wrong == []
    sprint = dict(con.execute("""select season, sum(sprint_points_round) from llm.f1_season_standings_by_round group by 1""").fetchall())
    assert all(sprint[y] > 0 for y in (2024, 2025, 2026))
    assert sprint[2008] == 0
    # a round's points are the race plus the sprint, and the running total adds them up
    assert con.execute("""select count(*) from (select points_cum - lag(points_cum, 1, 0) over (partition by season, player_id order by round) d, points_round
                          from llm.f1_season_standings_by_round) where abs(d - points_round) > 1e-9""").fetchone()[0] == 0


def test_standings_by_round_shape_rank_gap_and_keys(replay_run):
    con = replay_run["con"]
    unique, total = con.execute("select count(distinct fact_key), count(*) from llm.f1_season_standings_by_round").fetchone()
    assert unique == total
    assert con.execute("select count(*) from (select season, round, count(*) n, count(distinct rank) r, max(rank) m "
                       "from llm.f1_season_standings_by_round group by 1, 2) where n <> r or n <> m").fetchone()[0] == 0
    assert con.execute("select count(*) from llm.f1_season_standings_by_round where (rank = 1) <> (gap_to_leader = 0) and not tied_on_points").fetchone()[0] == 0
    assert con.execute("select min(gap_to_leader) from llm.f1_season_standings_by_round").fetchone()[0] == 0
    # dense across rounds: every driver of a season has a row at every round of it
    assert con.execute("""select count(*) from (select season, player_id, count(*) n from llm.f1_season_standings_by_round group by 1, 2) a
                          join (select season, count(distinct round) k from llm.f1_season_standings_by_round group by 1) b using (season)
                          where a.n <> b.k""").fetchone()[0] == 0
    # Indianapolis counts for the championship in 1950-1960
    assert con.execute("select count(*) from llm.f1_season_standings_by_round s join core.matches m on m.match_id = s.race_id where m.is_indianapolis").fetchone()[0] > 0


# --------------------------------------------------------------------------- llm.f1_race_winners


def winners_oracle(results_csv: Path, races_csv: Path, drivers_csv: Path) -> dict[tuple[int, str], dict]:
    """Far-side oracle: winners per Grand Prix straight from the CSVs, age from date of birth in Python."""
    from datetime import date

    con = duckdb.connect()
    races = {r[0]: r[1] for r in con.execute(
        f"select id, date from read_csv('{races_csv.as_posix()}') where grandPrixId <> 'indianapolis'").fetchall()}
    born = dict(con.execute(f"select id, dateOfBirth from read_csv('{drivers_csv.as_posix()}')").fetchall())
    rows = con.execute(f"select raceId, driverId, positionNumber, positionText, sharedCar, gridPositionNumber from read_csv('{results_csv.as_posix()}')").fetchall()
    # a winning car is shared when ANY of its drivers is flagged (f1db leaves the driver who started it unflagged)
    shared_win = {race for race, _, pos, text, shared, _ in rows if pos == 1 and text not in NON_STARTS and shared}
    out = {}
    for race, driver, pos, text, _, grid in rows:
        if race in races and pos == 1 and text not in NON_STARTS:
            d, b = races[race], born[driver]
            d = d if isinstance(d, date) else date.fromisoformat(str(d))
            out[(race, driver)] = {"age": (d - b).days / 365.2425, "grid": grid, "shared": race in shared_win}
    return out


def test_race_winners_match_the_far_side_oracle(replay_run):
    con = replay_run["con"]
    oracle = winners_oracle(FIXTURE / "f1db-races-race-results.csv", FIXTURE / "f1db-races.csv", FIXTURE / "f1db-drivers.csv")
    got = {(race, driver): {"age": age, "grid": grid, "shared": shared} for race, driver, age, grid, shared in con.execute(
        "select race_id, player_id, age_at_win, grid_position, shared_drive from llm.f1_race_winners").fetchall()}
    assert set(got) == set(oracle)
    for key, want in oracle.items():
        assert got[key]["age"] == pytest.approx(want["age"], abs=1e-9), key
        assert got[key]["grid"] == want["grid"], key
        assert got[key]["shared"] == want["shared"], key
    assert any(v["shared"] for v in oracle.values()), "fixture contains a shared winning drive"
    assert any(v["grid"] is None for v in oracle.values()), "fixture contains a winner with no recorded grid"


def test_race_winners_one_winner_per_race_except_shared_drives(replay_run):
    con = replay_run["con"]
    unique, total = con.execute("select count(distinct (race_id, player_id)), count(*) from llm.f1_race_winners").fetchone()
    assert unique == total
    # every row of a shared winning car says so - including the driver who started it, whom f1db leaves unflagged
    assert con.execute("select count(*) from (select race_id, count(*) n, bool_and(shared_drive) s from llm.f1_race_winners group by 1) where n > 1 and not s").fetchone()[0] == 0
    # every Grand Prix with results has a winner; the Indianapolis 500 is not one
    assert con.execute("""select count(*) from core.matches m where m.has_results and not m.is_indianapolis
                          and m.match_id not in (select race_id from llm.f1_race_winners)""").fetchone()[0] == 0
    assert con.execute("select count(*) from llm.f1_race_winners w join core.matches m on m.match_id = w.race_id where m.is_indianapolis").fetchone()[0] == 0
    assert con.execute("select min(age_at_win) from llm.f1_race_winners").fetchone()[0] > 18


# --------------------------------------------------------------------------- llm.f1_data_as_of


def test_data_as_of_names_the_latest_resulted_race_and_the_release(replay_run):
    """One row, offline: the latest race WITH results (not the calendar's last) and the release the replay served."""
    con = replay_run["con"]
    rows = con.execute("select * from llm.f1_data_as_of").fetchall()
    assert len(rows) == 1
    row = dict(zip([d[0] for d in con.description], rows[0]))
    last = con.execute("select race_date, season, round from core.matches where has_results order by race_date desc, season desc, round desc limit 1").fetchone()
    assert (row["latest_race_date"], row["latest_season"], row["latest_round"]) == last
    assert row["latest_race_date"] == con.execute("select max(race_date) from llm.f1_race_results").fetchone()[0]
    assert row["latest_season_races_held"] <= row["latest_season_races_scheduled"]
    assert row["release_tag"] == "v-mini"
    assert str(row["release_published_date"]) == "2026-09-27"
    assert row["snapshot_fetched_at"].startswith("2026-09-29")
    assert row["fact_key"] == "f1db:data-as-of"
    lineage = con.execute("select license_class, sources from meta.model_lineage where model = 'f1_data_as_of'").fetchone()
    assert lineage == ("legal", ["f1db"])
