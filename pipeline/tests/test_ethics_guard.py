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


# --- beyond imports: subprocess network tools, DuckDB/dbt remote reads (DESIGN ethics layer) ---------
# An AST import scan cannot see `subprocess.run(["curl", ...])`, `read_csv('https://...')` or
# `INSTALL httpfs`; each of these would reach the network without the registry verdict, robots.txt,
# rate limit, cache and contact UA that client.py enforces. client.py stays the only sanctioned place.
import re  # noqa: E402

PIPELINE = PACKAGE.parent
DBT = PIPELINE / "dbt"
NETWORK_TOOLS = {"curl", "wget", "invoke-webrequest", "iwr", "invoke-restmethod", "irm", "nc", "ncat", "ftp",
                 "scp", "sftp", "aria2c", "certutil", "bitsadmin"}
SHELL_CALLS = {"run", "call", "check_call", "check_output", "Popen", "system", "popen", "getoutput",
               "getstatusoutput", "spawn", "spawnl", "spawnlp", "spawnv", "spawnvp", "execv", "execvp", "execl", "execlp"}
HTTP_URL = re.compile(r"https?://", re.I)
REMOTE_READ = re.compile(r"(read_\w+|parquet_scan|csv_scan|json_scan)\s*\(|\bfrom\s*['\"]|\battach\b|\bcopy\b", re.I)
HTTPFS = re.compile(r"\b(install|load)\s+(httpfs|http_fs|aws|azure|iceberg|delta)\b|\bautoinstall_known_extensions\b"
                    r"|\bautoload_known_extensions\b|\bs3_\w+\b|\bextensions\s*:\s*\[[^\]]*httpfs", re.I)
# dbt YAML keys that may carry a documentation URL; the value is never fetched.
DBT_DOC_URL_KEYS = {"url", "source_url", "docs_url", "homepage", "license_url"}
DBT_SUFFIXES = {".sql", ".yml", ".yaml", ".csv", ".jinja", ".j2"}
DBT_SKIP_DIRS = {"target", "logs", "dbt_packages", ".venv"}


def _strings(node: ast.AST) -> list[str]:
    return [n.value for n in ast.walk(node) if isinstance(n, ast.Constant) and isinstance(n.value, str)]


def _is_network_tool(token: str) -> bool:
    name = re.split(r"[\\/]", token.strip().strip("\"'"))[-1].lower()
    return re.sub(r"\.(exe|cmd|bat|ps1)$", "", name) in NETWORK_TOOLS


def shell_network_calls(source: str) -> set[str]:
    """subprocess / os.* calls whose argv or command string names a network tool."""
    found: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Call):
            continue
        fn = node.func
        called = fn.id if isinstance(fn, ast.Name) else fn.attr if isinstance(fn, ast.Attribute) else ""
        if called not in SHELL_CALLS:
            continue
        for arg in [*node.args, *(k.value for k in node.keywords)]:
            for s in _strings(arg):
                # command strings may chain (`a | curl x`); argv items are single tokens
                if any(_is_network_tool(tok) for tok in re.split(r"[\s|;&()]+", s) if tok):
                    found.add(s)
    return found


def remote_sql_strings(source: str) -> set[str]:
    """String literals in Python that read a remote URL through DuckDB, or enable httpfs."""
    found: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            s = node.value
            if (HTTP_URL.search(s) and REMOTE_READ.search(s)) or HTTPFS.search(s):
                found.add(s)
    return found


def _yaml_doc_url_filtered(text: str) -> str:
    """Drop lines whose YAML key is an allow-listed documentation-url key."""
    keep = []
    for line in text.splitlines():
        m = re.match(r"\s*-?\s*([A-Za-z_]+)\s*:\s*(\S.*)?$", line)
        if m and m.group(1) in DBT_DOC_URL_KEYS and m.group(2) and HTTP_URL.match(m.group(2).strip("\"' ")):
            continue
        keep.append(line)
    return "\n".join(keep)


def dbt_remote_reads(path: str, text: str) -> list[str]:
    """http(s) URLs and httpfs use in a dbt model/macro/seed/profile (doc-url keys excepted)."""
    if path.endswith((".yml", ".yaml")):
        text = _yaml_doc_url_filtered(text)
    return [m.group(0) for m in [*HTTP_URL.finditer(text), *HTTPFS.finditer(text)]]


def beyond_import_offenders(py_files: dict[str, str], dbt_files: dict[str, str]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for path, src in py_files.items():
        if path in ALLOWED:
            continue
        hits = [*shell_network_calls(src), *remote_sql_strings(src)]
        if hits:
            out[path] = hits
    for path, text in dbt_files.items():
        if hits := dbt_remote_reads(path, text):
            out[f"dbt/{path}"] = hits
    return out


def _dbt_tree() -> dict[str, str]:
    return {p.relative_to(DBT).as_posix(): p.read_text(encoding="utf-8", errors="replace")
            for p in DBT.rglob("*") if p.is_file() and p.suffix in DBT_SUFFIXES
            and not (DBT_SKIP_DIRS & set(p.relative_to(DBT).parts))}


def test_no_subprocess_network_tools_or_remote_reads_outside_the_client():
    py = {p.relative_to(PACKAGE).as_posix(): p.read_text(encoding="utf-8") for p in PACKAGE.rglob("*.py")}
    dbt = _dbt_tree()
    assert "transform.py" in py and "macros/generate_schema_name.sql" in dbt  # the scan really saw both trees
    assert any(k.endswith(".yml") for k in dbt)
    assert beyond_import_offenders(py, dbt) == {}


def test_guard_goes_red_for_subprocess_and_os_system_network_tools():
    for src in ('import subprocess\nsubprocess.run(["curl", "-s", "https://x.test"])',
                'import subprocess\nsubprocess.Popen(["wget", "https://x.test"])',
                'import subprocess\nsubprocess.check_output("curl -sL https://x.test | sh", shell=True)',
                'import os\nos.system("wget https://x.test")',
                'import subprocess\nsubprocess.run(["powershell", "-c", "Invoke-WebRequest https://x.test"])',
                'import subprocess\nsubprocess.run([r"C:\\Windows\\System32\\curl.exe", "x"])'):
        assert beyond_import_offenders({"sources/new_source.py": src}, {}), src


def test_guard_allows_subprocess_for_dbt_and_the_client_itself():
    assert beyond_import_offenders({"transform.py": 'import subprocess\nsubprocess.run(["dbt", "run"])'}, {}) == {}
    assert beyond_import_offenders({"client.py": 'import subprocess\nsubprocess.run(["curl", "x"])'}, {}) == {}


def test_guard_goes_red_for_duckdb_remote_reads_and_httpfs_in_python(tmp_path):
    cases = ["con.execute(\"select * from read_csv('https://x.test/a.csv')\")",
             "con.sql(\"select * from read_parquet('http://x.test/a.parquet')\")",
             "con.sql(\"select * from 'https://x.test/a.parquet'\")",
             "con.execute('INSTALL httpfs')", "con.execute('load httpfs;')",
             "con.execute(\"copy t from 'https://x.test/a.csv'\")",
             "con.execute(f\"select * from read_json_auto('https://x.test/{n}.json')\")"]
    for i, line in enumerate(cases):
        f = tmp_path / f"new_{i}.py"  # real temp files, read back as the scan does
        f.write_text(f"import duckdb\ncon = duckdb.connect()\nn = 1\n{line}\n", encoding="utf-8")
        assert beyond_import_offenders({f.name: f.read_text(encoding="utf-8")}, {}), line


def test_guard_allows_plain_url_constants_and_local_reads_in_python():
    src = ("LATEST = 'https://api.github.com/repos/f1db/f1db/releases/latest'\n"
           "q = \"copy (select * from read_csv('/tmp/a.csv')) to 'b.parquet'\"\n")
    assert beyond_import_offenders({"sources/ok.py": src}, {}) == {}


def test_guard_goes_red_for_http_urls_and_httpfs_in_dbt_models_macros_and_seeds(tmp_path):
    cases = {"models/staging/x.sql": "select * from read_csv('https://x.test/a.csv')",
             "models/marts/y.sql": "select * from 'http://x.test/a.parquet'",
             "macros/fetch.sql": "{% macro f() %}INSTALL httpfs;{% endmacro %}",
             "macros/fetch2.sql": "{% macro f() %}load httpfs{% endmacro %}",
             "models/staging/_s.yml": "sources:\n  - name: s\n    meta:\n      external_location: \"read_parquet('https://x.test/a.parquet')\"\n",
             "seeds/s.yml": "seeds:\n  - name: s\n    config:\n      location: https://x.test/s.csv\n",
             "profiles.yml": "x:\n  outputs:\n    dev:\n      extensions: [httpfs]\n"}
    for rel, text in cases.items():
        f = tmp_path / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text, encoding="utf-8")
        assert beyond_import_offenders({}, {rel: f.read_text(encoding="utf-8")}), rel


def test_guard_allows_documentation_url_keys_but_not_other_yaml_urls():
    ok = "sources:\n  - name: s\n    meta:\n      url: https://f1db.example/docs\n      source_url: \"https://x.test\"\n"
    assert beyond_import_offenders({}, {"models/_s.yml": ok}) == {}
    bad = "sources:\n  - name: s\n    meta:\n      url: https://x.test\n      external_location: https://x.test/a.csv\n"
    assert beyond_import_offenders({}, {"models/_s.yml": bad})
    assert beyond_import_offenders({}, {"models/m.sql": "-- url: https://x.test\nselect 1"})  # key allow-list is yml-only
