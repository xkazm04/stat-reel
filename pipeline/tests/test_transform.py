"""run_transform hands dbt its environment without leaking it into the calling process."""

from __future__ import annotations

import os
from dataclasses import replace
from datetime import datetime, timezone

from statreel_ingest import transform
from statreel_ingest.config import Paths
from statreel_ingest.snapshot import Snapshot

KEYS = ("STATREEL_WAREHOUSE", "F1DB_SNAPSHOT")


def test_dbt_gets_the_snapshot_and_warehouse_but_the_process_env_is_untouched(tmp_path, registry, monkeypatch):
    snap = Snapshot.create(tmp_path / "raw", registry.get("f1db"), datetime(2026, 9, 29, tzinfo=timezone.utc),
                           tool_version="0.1.0")
    snap.finalize()
    for key in KEYS:
        monkeypatch.delenv(key, raising=False)
    seen: dict[str, str] = {}

    def fake_dbt(paths, args, env=None):
        seen.update(env if env is not None else os.environ)
        return False  # stop before the warehouse is opened

    monkeypatch.setattr(transform, "run_dbt", fake_dbt)
    paths = replace(Paths(), raw=tmp_path / "raw", warehouse=tmp_path / "w.duckdb")
    assert transform.run_transform(paths) == 1
    assert seen["F1DB_SNAPSHOT"] == snap.dir.as_posix()
    assert seen["STATREEL_WAREHOUSE"] == (tmp_path / "w.duckdb").as_posix()
    # a later Paths() in the same process must not inherit this run's warehouse
    assert {k: os.environ.get(k) for k in KEYS} == {k: None for k in KEYS}
    assert Paths().warehouse != tmp_path / "w.duckdb"
