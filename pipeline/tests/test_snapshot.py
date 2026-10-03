import json
from datetime import datetime, timezone

import pytest

from statreel_ingest.snapshot import Snapshot, SnapshotExists, current_snapshot

NOW = datetime(2026, 9, 29, 18, 0, 0, tzinfo=timezone.utc)


def test_snapshot_writes_manifest_and_current_pointer(tmp_path, registry):
    src = registry.get("f1db")
    snap = Snapshot.create(tmp_path, src, NOW, tool_version="0.1.0")
    (snap.dir / "races.parquet").write_bytes(b"PAR1")
    snap.add_file("races.parquet", rows=3)
    snap.finalize(extra={"release_tag": "v2026.15.1"})

    m = json.loads((snap.dir / "manifest.json").read_text())
    assert m["source_id"] == "f1db" and m["license"] == "CC-BY-4.0" and m["verdict"] == "legal"
    assert m["snapshot"] == "2026-09-29T18:00:00Z"
    assert m["files"][0]["path"] == "races.parquet" and m["files"][0]["rows"] == 3
    assert len(m["files"][0]["sha256"]) == 64
    assert m["release_tag"] == "v2026.15.1" and m["tool_version"] == "0.1.0"
    assert current_snapshot(tmp_path, "f1db") == snap.dir


def test_snapshots_are_immutable(tmp_path, registry):
    src = registry.get("f1db")
    Snapshot.create(tmp_path, src, NOW, tool_version="0.1.0").finalize()
    with pytest.raises(SnapshotExists):
        Snapshot.create(tmp_path, src, NOW, tool_version="0.1.0")


def test_no_current_pointer_before_first_snapshot(tmp_path):
    assert current_snapshot(tmp_path, "f1db") is None


# ---- schema contract: comparing a snapshot's tables with the previous one ---------------------------

from statreel_ingest.snapshot import compare_tables, previous_tables  # noqa: E402


def tbl(rows, **cols):
    return {"columns": [{"name": n, "type": t} for n, t in cols.items()], "rows": rows}


PREV = {"races": tbl(100, id="BIGINT", year="BIGINT", name="VARCHAR"), "drivers": tbl(50, id="VARCHAR")}


def test_identical_schema_is_clean():
    rep = compare_tables(PREV, PREV)
    assert rep.errors == [] and rep.warnings == []


def test_renamed_column_is_an_error_with_a_rename_hint():
    cur = {**PREV, "races": tbl(100, id="BIGINT", season="BIGINT", name="VARCHAR")}
    rep = compare_tables(PREV, cur)
    assert rep.errors == ["races.year removed (renamed to season?)"]
    assert rep.warnings == ["races.season added (BIGINT)"]


def test_type_change_is_an_error():
    cur = {**PREV, "races": tbl(100, id="BIGINT", year="VARCHAR", name="VARCHAR")}
    assert compare_tables(PREV, cur).errors == ["races.year type changed BIGINT -> VARCHAR"]


def test_added_column_and_table_only_warn():
    cur = {**PREV, "races": tbl(100, id="BIGINT", year="BIGINT", name="VARCHAR", laps="BIGINT"), "sprints": tbl(3, id="BIGINT")}
    rep = compare_tables(PREV, cur)
    assert rep.errors == []
    assert sorted(rep.warnings) == ["new table sprints (1 columns)", "races.laps added (BIGINT)"]


def test_vanished_table_is_an_error():
    assert compare_tables(PREV, {"races": PREV["races"]}).errors == ["table drivers disappeared"]


def test_row_drop_threshold():
    ok = {**PREV, "races": tbl(95, id="BIGINT", year="BIGINT", name="VARCHAR")}  # exactly 5 % is tolerated
    bad = {**PREV, "races": tbl(94, id="BIGINT", year="BIGINT", name="VARCHAR")}
    assert compare_tables(PREV, ok).errors == []
    assert "races rows dropped 100 -> 94" in compare_tables(PREV, bad).errors[0]
    grew = {**PREV, "races": tbl(500, id="BIGINT", year="BIGINT", name="VARCHAR")}
    assert compare_tables(PREV, grew).errors == []


def test_manifest_records_per_table_schema_and_legacy_snapshots_are_derived(tmp_path, registry):
    import duckdb

    snap = Snapshot.create(tmp_path, registry.get("f1db"), NOW, tool_version="0.1.0")
    duckdb.sql(f"copy (select 1::bigint as id, 'x' as name) to '{(snap.dir / 'races.parquet').as_posix()}' (format parquet)")
    snap.add_file("races.parquet", rows=1)
    snap.add_table("races", [{"name": "id", "type": "BIGINT"}, {"name": "name", "type": "VARCHAR"}], 1)
    snap.finalize()
    assert json.loads((snap.dir / "manifest.json").read_text())["tables"]["races"]["rows"] == 1
    assert previous_tables(snap.dir)["races"]["columns"][1] == {"name": "name", "type": "VARCHAR"}
    # a manifest from before schemas were recorded: derive from the parquet itself
    m = json.loads((snap.dir / "manifest.json").read_text())
    del m["tables"]
    (snap.dir / "manifest.json").write_text(json.dumps(m))
    cols = [{"name": "id", "type": "BIGINT"}, {"name": "name", "type": "VARCHAR"}]
    assert previous_tables(snap.dir) == {"races": {"columns": cols, "rows": 1}}
