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
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import duckdb

from .. import __version__
from ..client import EthicalClient
from ..snapshot import Snapshot, current_snapshot, read_manifest

LATEST = "https://api.github.com/repos/f1db/f1db/releases/latest"
ASSET_NAME = "f1db-csv.zip"
API_HEADERS = {"accept": "application/vnd.github+json", "x-github-api-version": "2022-11-28"}


class IntegrityError(ValueError):
    pass


@dataclass
class IngestResult:
    snapshot_dir: Path
    downloaded: bool
    release_tag: str


def _table_name(member: str) -> str:
    stem = Path(member).stem
    return stem.removeprefix("f1db-").replace("-", "_")


def ingest(client: EthicalClient, raw_root: Path, *, now: datetime | None = None) -> IngestResult:
    now = now or datetime.now(timezone.utc)
    release = client.get(LATEST, headers=API_HEADERS).json()
    tag = release["tag_name"]

    existing = current_snapshot(raw_root, "f1db")
    if existing and read_manifest(existing).get("release_tag") == tag:
        return IngestResult(existing, downloaded=False, release_tag=tag)

    asset = next(a for a in release["assets"] if a["name"] == ASSET_NAME)
    blob = client.get(asset["url"], headers={"accept": "application/octet-stream"}).content
    digest = hashlib.sha256(blob).hexdigest()
    expected = (asset.get("digest") or "").removeprefix("sha256:")
    if expected != digest:
        raise IntegrityError(f"{ASSET_NAME} sha256 {digest} != API digest {expected or '<missing>'}")

    snap = Snapshot.create(raw_root, client.source, now, tool_version=__version__)
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as z, tempfile.TemporaryDirectory() as tmp:
            con = duckdb.connect()
            for member in sorted(n for n in z.namelist() if n.endswith(".csv")):
                src = Path(tmp) / Path(member).name
                src.write_bytes(z.read(member))
                out = f"{_table_name(member)}.parquet"
                con.execute(
                    f"copy (select * from read_csv('{src.as_posix()}', header=true, all_varchar=false, sample_size=-1)) "
                    f"to '{(snap.dir / out).as_posix()}' (format parquet)"
                )
                rows = con.execute(f"select count(*) from read_parquet('{(snap.dir / out).as_posix()}')").fetchone()[0]
                snap.add_file(out, rows=rows)
            con.close()
        if client.log_path.exists():
            shutil.copyfile(client.log_path, snap.dir / "fetch_log.jsonl")
        snap.finalize(extra={"release_tag": tag, "release_published_at": release.get("published_at"),
                             "asset": ASSET_NAME, "asset_sha256": digest})
    except BaseException:
        shutil.rmtree(snap.dir, ignore_errors=True)
        raise
    return IngestResult(snap.dir, downloaded=True, release_tag=tag)
