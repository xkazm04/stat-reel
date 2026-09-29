"""Licence lineage: for every dbt model, the most restrictive upstream licence class and its sources."""

from __future__ import annotations

import json
from pathlib import Path

# Most permissive first. Anything unrecognised is `unknown`, which outranks everything: a model
# whose lineage cannot be proven must never pass a monetized publish gate.
ORDER = ["legal", "non_commercial", "paid", "unknown"]


def _rank(cls: str) -> int:
    return ORDER.index(cls) if cls in ORDER else ORDER.index("unknown")


def compute_lineage(manifest: dict) -> dict[str, tuple[str, list[str]]]:
    sources = manifest.get("sources", {})
    nodes = manifest.get("nodes", {})
    memo: dict[str, tuple[str, frozenset[str]]] = {}

    def walk(uid: str) -> tuple[str, frozenset[str]]:
        if uid in memo:
            return memo[uid]
        if uid in sources:
            meta = {**(sources[uid].get("source_meta") or {}), **(sources[uid].get("meta") or {})}
            cls = meta.get("license_class") or "unknown"
            sid = meta.get("source_id")
            result = (cls if cls in ORDER else "unknown", frozenset([sid]) if sid else frozenset())
        else:
            node = nodes.get(uid, {})
            cls, ids = "legal", frozenset()
            for parent in node.get("depends_on", {}).get("nodes", []):
                pcls, pids = walk(parent)
                if _rank(pcls) > _rank(cls):
                    cls = pcls
                ids |= pids
            result = (cls, ids)
        memo[uid] = result
        return result

    out = {}
    for uid, node in nodes.items():
        if node.get("resource_type") != "model":
            continue
        cls, ids = walk(uid)
        out[node["name"]] = (cls, sorted(ids))
    return out


def write_lineage(con, manifest_path: Path) -> dict[str, tuple[str, list[str]]]:
    """Persist lineage into DuckDB `meta.model_lineage`."""
    lineage = compute_lineage(json.loads(Path(manifest_path).read_text(encoding="utf-8")))
    con.execute("create schema if not exists meta")
    con.execute("create or replace table meta.model_lineage (model varchar primary key, license_class varchar, sources varchar[])")
    con.executemany("insert into meta.model_lineage values (?, ?, ?)", [(m, c, s) for m, (c, s) in sorted(lineage.items())])
    return lineage
