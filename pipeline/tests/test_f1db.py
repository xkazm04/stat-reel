"""f1db ingest in replay mode: the GitHub Releases API served from memory."""

import hashlib
import io
import json
import zipfile
from datetime import datetime, timezone

import duckdb
import httpx
import pytest

from statreel_ingest.client import EthicalClient
from statreel_ingest.snapshot import current_snapshot, read_manifest
from statreel_ingest.sources import f1db

API = "https://api.github.com"
ASSETS = "https://release-assets.githubusercontent.com"
LATEST = f"{API}/repos/f1db/f1db/releases/latest"


def build_zip(tables: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, text in tables.items():
            z.writestr(name, text)
    return buf.getvalue()


ZIP = build_zip({
    "f1db-drivers.csv": "id,name\nfangio,Juan Manuel Fangio\nclark,Jim Clark\n",
    "f1db-races.csv": "id,year,round\n1,1950,1\n2,1950,2\n3,1963,1\n",
})


class ReleaseServer:
    def __init__(self, tag="v2026.15.1", zip_bytes=ZIP, digest=None):
        self.tag, self.zip = tag, zip_bytes
        self.digest = digest or "sha256:" + hashlib.sha256(zip_bytes).hexdigest()
        self.asset_downloads = 0
        self.requests = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        url = str(request.url)
        if url.endswith("/robots.txt"):
            return httpx.Response(404)
        if url == LATEST:
            etag = f'"{self.tag}"'
            if request.headers.get("if-none-match") == etag:
                return httpx.Response(304, headers={"etag": etag})
            body = {"tag_name": self.tag, "published_at": "2026-09-27T09:57:43Z", "assets": [
                {"id": 1, "name": "f1db-json-single.zip", "url": f"{API}/repos/f1db/f1db/releases/assets/1", "digest": "sha256:00"},
                {"id": 2, "name": "f1db-csv.zip", "url": f"{API}/repos/f1db/f1db/releases/assets/2", "digest": self.digest},
            ]}
            return httpx.Response(200, json=body, headers={"etag": etag})
        if url == f"{API}/repos/f1db/f1db/releases/assets/2":
            assert request.headers["accept"] == "application/octet-stream"
            return httpx.Response(302, headers={"location": f"{ASSETS}/blob?sig=abc"})
        if url == f"{ASSETS}/blob?sig=abc":
            self.asset_downloads += 1
            return httpx.Response(200, content=self.zip)
        return httpx.Response(404)


def client_for(registry, tmp_path, clock, server):
    return EthicalClient(registry, "f1db", contact="https://example.org/c", cache_dir=tmp_path / "cache",
                         log_path=tmp_path / "log.jsonl", transport=httpx.MockTransport(server),
                         clock=clock, sleep=clock.sleep)


NOW = datetime(2026, 9, 29, 18, 0, tzinfo=timezone.utc)


def test_ingest_writes_parquet_snapshot_with_manifest(registry, tmp_path, clock):
    srv = ReleaseServer()
    result = f1db.ingest(client_for(registry, tmp_path, clock, srv), tmp_path / "raw", now=NOW)
    snap = current_snapshot(tmp_path / "raw", "f1db")
    assert result.snapshot_dir == snap and result.downloaded
    m = read_manifest(snap)
    assert m["release_tag"] == "v2026.15.1" and m["license"] == "CC-BY-4.0"
    assert {f["path"]: f["rows"] for f in m["files"]} == {"drivers.parquet": 2, "races.parquet": 3}
    assert m["asset_sha256"] == hashlib.sha256(ZIP).hexdigest()
    rows = duckdb.sql(f"select count(*) from read_parquet('{(snap / 'races.parquet').as_posix()}')").fetchone()[0]
    assert rows == 3
    # the fetch log travels with the snapshot
    assert (snap / "fetch_log.jsonl").exists()


def test_rerun_on_unchanged_release_downloads_nothing(registry, tmp_path, clock):
    srv = ReleaseServer()
    f1db.ingest(client_for(registry, tmp_path, clock, srv), tmp_path / "raw", now=NOW)
    again = f1db.ingest(client_for(registry, tmp_path, clock, srv), tmp_path / "raw", now=NOW.replace(hour=19))
    assert srv.asset_downloads == 1
    assert not again.downloaded
    assert len([p for p in (tmp_path / "raw" / "f1db").iterdir() if p.is_dir()]) == 1


def test_new_release_creates_a_new_snapshot(registry, tmp_path, clock):
    f1db.ingest(client_for(registry, tmp_path, clock, ReleaseServer("v1")), tmp_path / "raw", now=NOW)
    res = f1db.ingest(client_for(registry, tmp_path, clock, ReleaseServer("v2")), tmp_path / "raw", now=NOW.replace(hour=19))
    assert res.downloaded and read_manifest(current_snapshot(tmp_path / "raw", "f1db"))["release_tag"] == "v2"


def test_digest_mismatch_aborts_without_a_snapshot(registry, tmp_path, clock):
    srv = ReleaseServer(digest="sha256:" + "0" * 64)
    with pytest.raises(f1db.IntegrityError):
        f1db.ingest(client_for(registry, tmp_path, clock, srv), tmp_path / "raw", now=NOW)
    assert current_snapshot(tmp_path / "raw", "f1db") is None


def test_ingest_never_uses_the_robots_disallowed_download_url(registry, tmp_path, clock):
    srv = ReleaseServer()
    f1db.ingest(client_for(registry, tmp_path, clock, srv), tmp_path / "raw", now=NOW)
    assert not any("/releases/download/" in str(r.url) for r in srv.requests)
    assert all(r.url.host in ("api.github.com", "release-assets.githubusercontent.com") for r in srv.requests)
    json.loads((tmp_path / "log.jsonl").read_text().splitlines()[0])
