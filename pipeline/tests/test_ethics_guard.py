"""Structural guard: client.py is the only module allowed to reach the network."""

import ast
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[1] / "statreel_ingest"
NETWORK_MODULES = {"httpx", "requests", "urllib.request", "urllib3", "http.client", "socket", "aiohttp"}
ALLOWED = {"client.py"}  # package-relative path, so sources/client.py is not exempt


def network_imports(source: str) -> set[str]:
    """Network-capable modules a source file imports (static imports and literal dynamic imports)."""
    found: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        names: list[str] = []
        if isinstance(node, ast.Import):
            names = [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            names = [node.module] + [f"{node.module}.{a.name}" for a in node.names]
        elif isinstance(node, ast.Call):
            fn = node.func
            called = fn.id if isinstance(fn, ast.Name) else fn.attr if isinstance(fn, ast.Attribute) else ""
            if called in ("__import__", "import_module") and node.args and isinstance(node.args[0], ast.Constant):
                names = [str(node.args[0].value)]
        for name in names:
            if any(name == m or name.startswith(m + ".") for m in NETWORK_MODULES):
                found.add(name)
    return found


def offenders(files: dict[str, str]) -> dict[str, set[str]]:
    return {path: hits for path, src in files.items() if path not in ALLOWED and (hits := network_imports(src))}


def test_only_client_py_imports_network_libraries():
    files = {p.relative_to(PACKAGE).as_posix(): p.read_text(encoding="utf-8") for p in PACKAGE.rglob("*.py")}
    assert "client.py" in files and "sources/f1db.py" in files  # the scan really saw the package
    assert offenders(files) == {}


def test_guard_goes_red_for_each_forbidden_import_in_a_synthetic_module():
    for line in ("import urllib.request", "import requests", "from urllib import request as r", "import urllib3",
                 "from http.client import HTTPSConnection", "import socket", "import aiohttp", "import httpx",
                 "from urllib.request import urlopen", "__import__('requests')", "importlib.import_module('socket')"):
        assert offenders({"sources/new_source.py": f"{line}\n"}), line


def test_guard_ignores_unrelated_imports_and_the_client_itself():
    assert offenders({"sources/ok.py": "import json\nfrom urllib.parse import urljoin\nimport duckdb\n"}) == {}
    assert offenders({"client.py": "import httpx\nimport socket\n"}) == {}
