"""Live tests never run unless asked for, whatever config pytest happened to load."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from conftest import live_selected

SYNTHETIC = '''
from pathlib import Path

import pytest

SENTINEL = Path(__file__).with_name("live-ran.txt")


@pytest.mark.live
def test_reaches_the_network():
    SENTINEL.write_text("ran", encoding="utf-8")


def test_offline():
    assert True
'''


@pytest.mark.parametrize("expr, selected", [
    ("", False), ("not live", False), ("not live and slow", False), ("slow", False), ("lively", False),
    ("live", True), ("live and slow", True), ("slow or live", True),
])
def test_live_is_selected_only_when_named(expr, selected):
    assert live_selected(expr) is selected


def _run(tmp_path: Path, *args: str) -> subprocess.CompletedProcess:
    # an empty pytest.ini makes tmp_path the rootdir with NO addopts - exactly the repo-root run
    (tmp_path / "pytest.ini").write_text("", encoding="utf-8")
    shutil.copyfile(Path(__file__).with_name("conftest.py"), tmp_path / "conftest.py")
    (tmp_path / "test_synthetic.py").write_text(SYNTHETIC, encoding="utf-8")
    return subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", *args],
                          cwd=tmp_path, capture_output=True, text=True, timeout=120)


def test_a_run_without_any_marker_expression_deselects_live_tests(tmp_path):
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert not (tmp_path / "live-ran.txt").exists(), "a live test ran without -m live"
    assert "1 passed, 1 deselected" in proc.stdout
    assert "PytestUnknownMarkWarning" not in proc.stdout + proc.stderr


def test_dash_m_live_still_runs_them(tmp_path):
    proc = _run(tmp_path, "-m", "live")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert (tmp_path / "live-ran.txt").read_text(encoding="utf-8") == "ran"
