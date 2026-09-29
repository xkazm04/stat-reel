"""Capability tests -> meta.capabilities (the heatmap's input, DESIGN.md §5.4 / §7).

A capability is (sport, kind, source) backed by a warehouse relation and a set of checks. Checks are
declared in pipeline/capabilities.yaml and evaluated here, rather than as dbt tests, so every result
lands in one row with coverage, row count and a human-readable reason (ADR 002).
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from pathlib import Path

import yaml

from .registry import Registry

COLUMNS = ("sport", "kind", "source_id", "license_class", "coverage_from", "coverage_to", "rows", "status",
           "detail", "evaluated_at")


def _check(con, spec: dict, registry: Registry, today: date) -> dict:
    src = registry.get(spec["source_id"])
    row = {"sport": spec["sport"], "kind": spec["kind"], "source_id": src.id, "license_class": src.license_class,
           "coverage_from": None, "coverage_to": None, "rows": 0}
    failures: list[str] = []
    if src.verdict == "avoid":
        return {**row, "status": "fail", "detail": f"source {src.id} has verdict avoid"}
    rel, checks = spec["relation"], spec.get("checks", {})
    try:
        row["rows"] = con.execute(f"select count(*) from {rel}").fetchone()[0]
    except Exception as exc:  # duckdb.CatalogException et al.
        return {**row, "status": "fail", "detail": f"relation {rel} unavailable: {type(exc).__name__}"}

    if "min_rows" in checks and row["rows"] < checks["min_rows"]:
        failures.append(f"rows {row['rows']} < {checks['min_rows']}")
    if col := spec.get("season_column"):
        lo, hi, n = con.execute(f"select min({col}), max({col}), count(distinct {col}) from {rel}").fetchone()
        row["coverage_from"], row["coverage_to"] = lo, hi
        if "coverage_from_max" in checks and (lo is None or lo > checks["coverage_from_max"]):
            failures.append(f"coverage starts {lo}, need <= {checks['coverage_from_max']}")
        if "min_seasons" in checks and n < checks["min_seasons"]:
            failures.append(f"{n} seasons < {checks['min_seasons']}")
    for column, limit in (checks.get("max_null_ratio") or {}).items():
        ratio = con.execute(f"select coalesce(avg(case when {column} is null then 1.0 else 0.0 end), 1.0) from {rel}").fetchone()[0]
        if ratio > limit:
            failures.append(f"null ratio {column} {ratio:.3f} > {limit}")
    if col := spec.get("date_column"):
        latest = con.execute(f"select max({col}) from {rel} where {col} <= ?", [today]).fetchone()[0]
        if row["coverage_from"] is None:
            first = con.execute(f"select min(year({col})), max(year({col})) from {rel}").fetchone()
            row["coverage_from"], row["coverage_to"] = first
        if "max_staleness_days" in checks:
            age = None if latest is None else (today - latest).days
            if age is None or age > checks["max_staleness_days"]:
                failures.append(f"stale: latest {latest} is {age} days old > {checks['max_staleness_days']}")
    status = "fail" if failures else "pass"
    return {**row, "status": status, "detail": "; ".join(failures) or "all checks passed"}


def evaluate_capabilities(con, spec_path: Path, registry: Registry, *, today: date | None = None) -> list[dict]:
    today = today or date.today()
    specs = yaml.safe_load(Path(spec_path).read_text(encoding="utf-8")) or []
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    results = [{**_check(con, s, registry, today), "evaluated_at": now} for s in specs]
    con.execute("create schema if not exists meta")
    con.execute("""create or replace table meta.capabilities (
        sport varchar, kind varchar, source_id varchar, license_class varchar,
        coverage_from integer, coverage_to integer, rows bigint, status varchar, detail varchar,
        evaluated_at timestamp)""")
    con.executemany(f"insert into meta.capabilities values ({', '.join('?' * len(COLUMNS))})",
                    [tuple(r[c] for c in COLUMNS) for r in results])
    return results
