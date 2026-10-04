"""statreel-ingest refusals reach the operator as one labelled line and exit 3, never a traceback."""

from __future__ import annotations

from statreel_ingest import cli


def test_an_unknown_source_is_refused_by_name(capsys):
    assert cli.main(["ingest", "no-such-source"]) == 3
    err = capsys.readouterr().err
    assert err.startswith("refused: ") and "no-such-source" in err and "registry" in err


def test_a_missing_owner_contact_is_refused_before_any_request(capsys, monkeypatch):
    monkeypatch.setattr(cli, "owner_contact", lambda repo: "")  # the client refuses in its constructor
    assert cli.main(["ingest", "f1db"]) == 3
    err = capsys.readouterr().err
    assert err.startswith("refused: ") and "STATREEL_CONTACT" in err


def test_an_avoid_source_is_still_refused(capsys):
    assert cli.main(["ingest", "fbref"]) == 3
    assert "verdict avoid" in capsys.readouterr().err


def test_ingest_warns_when_the_sources_terms_were_checked_too_long_ago(capsys, monkeypatch, tmp_path):
    from dataclasses import replace

    from statreel_ingest.config import Paths

    text = (Paths().registry).read_text(encoding="utf-8").replace("terms_checked_at: 2026-09-29", "terms_checked_at: 2020-01-01", 1)
    (tmp_path / "sources.yaml").write_text(text, encoding="utf-8")
    monkeypatch.setattr(cli, "Paths", lambda: replace(Paths(), registry=tmp_path / "sources.yaml"))
    monkeypatch.setattr(cli, "owner_contact", lambda repo: "")  # stop at the client constructor: no request
    assert cli.main(["ingest", "f1db"]) == 3
    err = capsys.readouterr().err
    assert "warning: registry stale-terms: f1db: terms last checked" in err
    assert err.index("warning:") < err.index("refused:")  # said before anything else happens
