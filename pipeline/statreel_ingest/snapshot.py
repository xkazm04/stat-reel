"""Immutable raw snapshots: data/raw/<source_id>/<snapshot_utc>/ + manifest.json + a `current` pointer."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .registry import Source


ROW_DROP_FAIL = 0.05  # a table losing more than this share of its rows fails the ingest


class SnapshotExists(FileExistsError):
    pass


class SchemaDrift(ValueError):
    """The new snapshot's tables are not backward compatible with the previous one."""

    def __init__(self, errors: list[str], warnings: list[str]) -> None:
        self.errors, self.warnings = errors, warnings
        super().__init__("schema drift vs previous snapshot:\n  - " + "\n  - ".join(errors)
                         + "\n(re-run with --accept-drift once downstream models are checked)")


@dataclass
class DriftReport:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def describe_parquet(path: Path) -> dict:
    """{columns: [{name, type}], rows} of one parquet file (DuckDB's own typing, as dbt will see it)."""
    import duckdb

    con = duckdb.connect()
    try:
        src = f"read_parquet('{Path(path).as_posix()}')"
        cols = [{"name": r[0], "type": r[1]} for r in con.execute(f"describe select * from {src}").fetchall()]
        rows = con.execute(f"select count(*) from {src}").fetchone()[0]
    finally:
        con.close()
    return {"columns": cols, "rows": rows}


def previous_tables(snapshot_dir: Path) -> dict[str, dict]:
    """Per-table schema of a snapshot: from its manifest, or derived from its parquet files for
    snapshots written before the manifest recorded schemas."""
    manifest = read_manifest(snapshot_dir)
    if manifest.get("tables"):
        return manifest["tables"]
    return {Path(f["path"]).stem: describe_parquet(Path(snapshot_dir) / f["path"])
            for f in manifest.get("files", []) if f["path"].endswith(".parquet")}


def compare_tables(previous: dict[str, dict], current: dict[str, dict], *, row_drop: float = ROW_DROP_FAIL) -> DriftReport:
    """Breaking changes (removed/renamed columns, type changes, dropped tables, big row drops) are
    errors; additive ones (new columns, new tables) are warnings."""
    rep = DriftReport()
    for table in sorted(previous.keys() - current.keys()):
        rep.errors.append(f"table {table} disappeared")
    for table in sorted(current.keys() - previous.keys()):
        rep.warnings.append(f"new table {table} ({len(current[table]['columns'])} columns)")
    for table in sorted(previous.keys() & current.keys()):
        old, new = previous[table], current[table]
        old_cols = {c["name"]: c["type"] for c in old["columns"]}
        new_cols = {c["name"]: c["type"] for c in new["columns"]}
        added = [n for n in new_cols if n not in old_cols]
        for name in sorted(old_cols.keys() - new_cols.keys()):
            rename = [a for a in added if new_cols[a] == old_cols[name]]
            hint = f" (renamed to {', '.join(rename)}?)" if rename else ""
            rep.errors.append(f"{table}.{name} removed{hint}")
        for name in sorted(old_cols.keys() & new_cols.keys()):
            if old_cols[name] != new_cols[name]:
                rep.errors.append(f"{table}.{name} type changed {old_cols[name]} -> {new_cols[name]}")
        for name in added:
            rep.warnings.append(f"{table}.{name} added ({new_cols[name]})")
        if old["rows"] and (old["rows"] - new["rows"]) / old["rows"] > row_drop:
            rep.errors.append(f"{table} rows dropped {old['rows']} -> {new['rows']} (> {row_drop:.0%})")
    return rep


def _stamp(now: datetime) -> str:
    return now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def current_snapshot(raw_root: Path, source_id: str) -> Path | None:
    pointer = Path(raw_root) / source_id / "current"
    if not pointer.exists():
        return None
    target = Path(raw_root) / source_id / pointer.read_text(encoding="utf-8").strip()
    return target if (target / "manifest.json").exists() else None


def read_manifest(snapshot_dir: Path) -> dict:
    return json.loads((Path(snapshot_dir) / "manifest.json").read_text(encoding="utf-8"))


class Snapshot:
    def __init__(self, raw_root: Path, source: Source, stamp: str, tool_version: str) -> None:
        self.raw_root = Path(raw_root)
        self.source = source
        self.stamp = stamp
        self.tool_version = tool_version
        self.dir = self.raw_root / source.id / stamp.replace(":", "")
        self.files: list[dict] = []
        self.tables: dict[str, dict] = {}

    @classmethod
    def create(cls, raw_root: Path, source: Source, now: datetime, *, tool_version: str) -> Snapshot:
        snap = cls(raw_root, source, _stamp(now), tool_version)
        if snap.dir.exists():
            raise SnapshotExists(f"snapshot {snap.dir} already exists; raw snapshots are immutable")
        snap.dir.mkdir(parents=True)
        return snap

    def add_file(self, rel_path: str, rows: int | None = None) -> None:
        data = (self.dir / rel_path).read_bytes()
        self.files.append({"path": rel_path, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "rows": rows})

    def add_table(self, name: str, columns: list[dict], rows: int) -> None:
        self.tables[name] = {"columns": columns, "rows": rows}

    def finalize(self, extra: dict | None = None) -> Path:
        manifest = {
            "source_id": self.source.id,
            "snapshot": self.stamp,
            "license": self.source.license,
            "license_class": self.source.license_class,
            "verdict": self.source.verdict,
            "attribution": self.source.attribution,
            "files": self.files,
            "tables": self.tables,
            "fetch_log": "fetch_log.jsonl",
            "tool_version": self.tool_version,
            **(extra or {}),
        }
        (self.dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        (self.raw_root / self.source.id / "current").write_text(self.dir.name, encoding="utf-8")
        return self.dir
