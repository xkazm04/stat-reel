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
