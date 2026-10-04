"""dbt build over the current raw snapshots, then licence lineage and capability tests."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import duckdb

from .capabilities import evaluate_capabilities
from .config import Paths
from .lineage import write_lineage
from .registry import Registry
from .snapshot import current_snapshot, read_manifest

# source_id -> env var the dbt sources.yml reads for its external_location
SNAPSHOT_ENV = {"f1db": "F1DB_SNAPSHOT"}


def _snapshot_env(paths: Paths) -> dict[str, str]:
    env = {}
    for source_id, var in SNAPSHOT_ENV.items():
        snap = current_snapshot(paths.raw, source_id)
        if snap is None:
            raise FileNotFoundError(f"no current snapshot for {source_id}; run `just ingest {source_id}` first")
        env[var] = snap.as_posix()
    return env


def run_dbt(paths: Paths, args: list[str], env: dict[str, str] | None = None) -> bool:
    """dbt in a child process: dbt-duckdb keeps its in-process connection open after a run, which
    would block every later connection to the warehouse from this process."""
    dbt = shutil.which("dbt", path=str(Path(sys.executable).parent)) or "dbt"
    cmd = [dbt, *args, "--project-dir", str(paths.dbt_project), "--profiles-dir", str(paths.dbt_project)]
    proc = subprocess.run(cmd, env=env if env is not None else os.environ.copy(), capture_output=True, text=True)
    if proc.returncode != 0:
        print(proc.stdout[-6000:], proc.stderr[-2000:], sep="\n", file=sys.stderr)
    return proc.returncode == 0


def run_transform(paths: Paths, select: str | None = None) -> int:
    paths.warehouse.parent.mkdir(parents=True, exist_ok=True)
    # the child's env only: writing os.environ would make every later Paths() in this process
    # resolve this run's warehouse (STATREEL_WAREHOUSE is Paths.warehouse's default)
    env = {**os.environ, **_snapshot_env(paths), "STATREEL_WAREHOUSE": paths.warehouse.as_posix()}
    if not run_dbt(paths, ["build", *(["--select", select] if select else [])], env=env):
        print("dbt build failed", file=sys.stderr)
        return 1
    registry = Registry.load(paths.registry)
    con = duckdb.connect(str(paths.warehouse))
    try:
        lineage = write_lineage(con, paths.dbt_project / "target" / "manifest.json")
        _record_snapshots(con, paths)
        caps = evaluate_capabilities(con, paths.capabilities, registry)
    finally:
        con.close()
    for model, (cls, sources) in sorted(lineage.items()):
        print(f"lineage {model}: {cls} {sources}")
    for c in caps:
        print(f"capability {c['sport']}/{c['kind']}/{c['source_id']}: {c['status']} "
              f"({c['coverage_from']}-{c['coverage_to']}, {c['rows']} rows) {c['detail']}")
    return 0 if all(c["status"] == "pass" for c in caps) else 4


def _record_snapshots(con, paths: Paths) -> None:
    """meta.source_snapshots: which immutable snapshot each source was built from."""
    con.execute("create schema if not exists meta")
    con.execute("""create table if not exists meta.source_snapshots (
        source_id varchar, snapshot varchar, license varchar, license_class varchar, attribution varchar,
        release_tag varchar, built_at timestamp default current_timestamp)""")
    for source_id in SNAPSHOT_ENV:
        m = read_manifest(current_snapshot(paths.raw, source_id))
        con.execute("insert into meta.source_snapshots (source_id, snapshot, license, license_class, attribution, release_tag) "
                    "values (?, ?, ?, ?, ?, ?)",
                    [source_id, m["snapshot"], m["license"], m["license_class"], m["attribution"], m.get("release_tag")])
