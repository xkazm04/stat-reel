"""Immutable raw snapshots: data/raw/<source_id>/<snapshot_utc>/ + manifest.json + a `current` pointer."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from .registry import Source


class SnapshotExists(FileExistsError):
    pass


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

    def finalize(self, extra: dict | None = None) -> Path:
        manifest = {
            "source_id": self.source.id,
            "snapshot": self.stamp,
            "license": self.source.license,
            "license_class": self.source.license_class,
            "verdict": self.source.verdict,
            "attribution": self.source.attribution,
            "files": self.files,
            "fetch_log": "fetch_log.jsonl",
            "tool_version": self.tool_version,
            **(extra or {}),
        }
        (self.dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        (self.raw_root / self.source.id / "current").write_text(self.dir.name, encoding="utf-8")
        return self.dir
