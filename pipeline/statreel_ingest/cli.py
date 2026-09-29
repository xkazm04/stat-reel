"""statreel-ingest ingest <source> | transform | capabilities"""

from __future__ import annotations

import argparse
import sys

from .client import EthicalClient
from .config import Paths, owner_contact
from .registry import Registry

INGESTERS = {"f1db": "statreel_ingest.sources.f1db"}


def cmd_ingest(args: argparse.Namespace, paths: Paths) -> int:
    registry = Registry.load(paths.registry)
    if args.source not in INGESTERS:
        registry.require_fetchable(args.source)  # a registered-but-unimplemented source still says why
        print(f"no ingester for {args.source} yet (implemented: {', '.join(INGESTERS)})", file=sys.stderr)
        return 2
    import importlib

    module = importlib.import_module(INGESTERS[args.source])
    client = EthicalClient(registry, args.source, contact=owner_contact(paths.repo), cache_dir=paths.http_cache,
                           log_path=paths.raw / args.source / "fetch_log.jsonl")
    try:
        res = module.ingest(client, paths.raw)
    finally:
        client.close()
    state = "new snapshot" if res.downloaded else "unchanged (no download)"
    print(f"{args.source} {res.release_tag}: {state} -> {res.snapshot_dir}")
    return 0


def cmd_transform(args: argparse.Namespace, paths: Paths) -> int:
    from .transform import run_transform

    return run_transform(paths, select=args.select)


def cmd_capabilities(args: argparse.Namespace, paths: Paths) -> int:
    import duckdb

    from .capabilities import evaluate_capabilities

    con = duckdb.connect(str(paths.warehouse))
    try:
        for row in evaluate_capabilities(con, paths.capabilities, Registry.load(paths.registry)):
            print(" ".join(str(v) for v in row))
    finally:
        con.close()
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="statreel-ingest")
    sub = p.add_subparsers(dest="cmd", required=True)
    ing = sub.add_parser("ingest", help="fetch a registry source into an immutable raw snapshot")
    ing.add_argument("source")
    tr = sub.add_parser("transform", help="dbt build + lineage + capabilities")
    tr.add_argument("--select", default=None)
    sub.add_parser("capabilities", help="re-evaluate meta.capabilities")
    args = p.parse_args(argv)
    paths = Paths()
    try:
        return {"ingest": cmd_ingest, "transform": cmd_transform, "capabilities": cmd_capabilities}[args.cmd](args, paths)
    except PermissionError as refused:  # ethics layer: avoid verdict, unregistered host, robots
        print(f"refused: {refused}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
