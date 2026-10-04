"""dbt project guards that need no warehouse."""

from __future__ import annotations

from pathlib import Path

import yaml

DBT = Path(__file__).parents[1] / "dbt"


def _generic_tests_with_top_level_arguments(doc: dict) -> list[str]:
    """dbt 1.10+ deprecates `- relationships: {to: ..., field: ...}`: a generic test's arguments belong under
    `arguments:` (MissingArgumentsPropertyInGenericTestDeprecation, slated to become an error)."""
    out = []
    for model in doc.get("models") or []:
        holders = [(model["name"], model)] + [(f"{model['name']}.{c['name']}", c) for c in model.get("columns") or []]
        for where, holder in holders:
            for test in holder.get("data_tests") or holder.get("tests") or []:
                if isinstance(test, dict):
                    (name, args), = test.items()
                    if isinstance(args, dict) and set(args) - {"arguments", "config", "name", "description"}:
                        out.append(f"{where}: {name}")
    return out


def test_generic_test_arguments_are_nested_under_arguments():
    offenders = {p.relative_to(DBT).as_posix(): bad for p in sorted(DBT.glob("models/**/*.yml"))
                 if (bad := _generic_tests_with_top_level_arguments(yaml.safe_load(p.read_text(encoding="utf-8")) or {}))}
    assert offenders == {}


def test_the_guard_sees_a_top_level_argument():
    doc = {"models": [{"name": "m", "data_tests": [{"unique_combination": {"columns": ["a"]}}],
                       "columns": [{"name": "c", "data_tests": ["not_null", {"relationships": {"arguments": {"to": "x", "field": "y"}}},
                                                               {"relationships": {"to": "x", "field": "y"}}]}]}]}
    assert _generic_tests_with_top_level_arguments(doc) == ["m: unique_combination", "m.c: relationships"]
