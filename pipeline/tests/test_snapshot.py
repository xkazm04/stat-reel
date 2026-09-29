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
