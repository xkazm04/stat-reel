"""f1db (CC BY 4.0) - the latest CSV release, via the GitHub Releases API (ADR 001).

github.com/robots.txt disallows `/*/download` for generic agents, so the browser download URL is
never used: the asset is requested from api.github.com with `Accept: application/octet-stream`,
which redirects to release-assets.githubusercontent.com. The API's per-asset sha256 digest is
verified before anything is written.
"""

from __future__ import annotations

import hashlib
import io
import shutil
import tempfile
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import duckdb

from .. import __version__
from ..client import EthicalClient
from ..snapshot import (SchemaDrift, Snapshot, compare_tables, current_snapshot, describe_parquet, previous_tables,
                        read_manifest)

LATEST = "https://api.github.com/repos/f1db/f1db/releases/latest"
ASSET_NAME = "f1db-csv.zip"
API_HEADERS = {"accept": "application/vnd.github+json", "x-github-api-version": "2022-11-28"}


class IntegrityError(ValueError):
    pass


class MissingAsset(LookupError):
    pass


@dataclass
class IngestResult:
    snapshot_dir: Path
    downloaded: bool
    release_tag: str
    warnings: list[str] = field(default_factory=list)  # additive drift, skipped zip members


def _table_name(member: str) -> str:
    stem = Path(member).stem
    return stem.removeprefix("f1db-").replace("-", "_")


def ingest(client: EthicalClient, raw_root: Path, *, now: datetime | None = None,
           accept_drift: bool = False) -> IngestResult:
    now = now or datetime.now(timezone.utc)
    # the client's log is cumulative across runs; the snapshot keeps only the rows this run appends
    log_start = client.log_path.stat().st_size if client.log_path.exists() else 0
    release = client.get(LATEST, headers=API_HEADERS).json()
    tag = release["tag_name"]

    existing = current_snapshot(raw_root, "f1db")
    if existing and read_manifest(existing).get("release_tag") == tag:
        return IngestResult(existing, downloaded=False, release_tag=tag)

    asset = next((a for a in release["assets"] if a["name"] == ASSET_NAME), None)
    if asset is None:
        have = ", ".join(sorted(a["name"] for a in release["assets"])) or "none"
        raise MissingAsset(f"release {tag} has no asset named {ASSET_NAME} (assets: {have}); "
                           "f1db may have renamed it - check https://github.com/f1db/f1db/releases")
    blob = client.get(asset["url"], headers={"accept": "application/octet-stream"}).content
    digest = hashlib.sha256(blob).hexdigest()
    expected = (asset.get("digest") or "").removeprefix("sha256:")
    if expected != digest:
        raise IntegrityError(f"{ASSET_NAME} sha256 {digest} != API digest {expected or '<missing>'}")

    snap = Snapshot.create(raw_root, client.source, now, tool_version=__version__)
    try:
        warnings: list[str] = []
        with zipfile.ZipFile(io.BytesIO(blob)) as z, tempfile.TemporaryDirectory() as tmp:
            con = duckdb.connect()
            skipped = sorted(n for n in z.namelist() if not n.endswith(".csv") and not n.endswith("/"))
            if skipped:
                warnings.append(f"skipped non-CSV zip members: {', '.join(skipped)}")
            for member in sorted(n for n in z.namelist() if n.endswith(".csv")):
                src = Path(tmp) / Path(member).name
                src.write_bytes(z.read(member))
                out = f"{_table_name(member)}.parquet"
                con.execute(
                    f"copy (select * from read_csv('{src.as_posix()}', header=true, all_varchar=false, sample_size=-1)) "
                    f"to '{(snap.dir / out).as_posix()}' (format parquet)"
                )
                info = describe_parquet(snap.dir / out)
                snap.add_file(out, rows=info["rows"])
                snap.add_table(_table_name(member), info["columns"], info["rows"])
            con.close()
        drift_accepted: list[str] = []
        if existing:
            report = compare_tables(previous_tables(existing), snap.tables)
            warnings += report.warnings
            if report.errors:
                if not accept_drift:
                    raise SchemaDrift(report.errors, warnings)
                drift_accepted = report.errors
                warnings += [f"ACCEPTED drift: {e}" for e in report.errors]
        if client.log_path.exists():
            with client.log_path.open("rb") as log:
                log.seek(log_start)
                (snap.dir / "fetch_log.jsonl").write_bytes(log.read())
        snap.finalize(extra={"release_tag": tag, "release_published_at": release.get("published_at"),
                             "asset": ASSET_NAME, "asset_sha256": digest,
                             "skipped_members": skipped, "accepted_drift": drift_accepted})
    except BaseException:
        shutil.rmtree(snap.dir, ignore_errors=True)
        raise
    return IngestResult(snap.dir, downloaded=True, release_tag=tag, warnings=warnings)
