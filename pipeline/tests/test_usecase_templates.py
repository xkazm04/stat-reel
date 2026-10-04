"""Use-case query templates name only llm.* views and columns that the dbt contract documents.

The templates in data/registry/usecases/*.yaml are handed to the co-pilot as worked SQL; a view or
column renamed in dbt would otherwise leave them pointing at nothing, with no offline test noticing.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[2]
USECASES = sorted((REPO / "data" / "registry" / "usecases").glob("*.yaml"))
LLM_MODELS = yaml.safe_load((REPO / "pipeline" / "dbt" / "models" / "llm" / "_llm__models.yml").read_text(encoding="utf-8"))["models"]
VIEWS = {m["name"]: {c["name"] for c in m["columns"]} for m in LLM_MODELS}
SQL = re.compile(r"^\s*(\w+)\s*:\s*select\s+(.+?)\s+from\s+llm\.(\w+)(.*)$", re.S | re.I)
KEYWORDS = {"where", "and", "or", "not", "is", "null", "order", "by", "asc", "desc", "limit", "in", "between", "true", "false"}


def template_problems(template: str, views: dict[str, set[str]]) -> list[str]:
    """Unknown view, or select/where/order identifiers that are not columns of it. [] when clean."""
    m = SQL.match(template)
    if not m:
        return []  # a named template (no inline SQL), e.g. the legacy era-adjusted one
    name, select, view, rest = m.groups()
    if view not in views:
        return [f"{name}: llm.{view} is not a documented llm view"]
    rest = rest.split("--", 1)[0]
    rest = re.sub(r"'[^']*'", "''", rest)  # string literals are values, not columns
    used = [c.strip() for c in select.split(",")] + re.findall(r"\b([a-z_][a-z0-9_]*)\b", rest)
    return [f"{name}: llm.{view} has no column {c}" for c in dict.fromkeys(used) if c not in KEYWORDS and c not in views[view]]


def _templates() -> list[tuple[str, str]]:
    return [(p.name, t) for p in USECASES for t in (yaml.safe_load(p.read_text(encoding="utf-8")).get("query_templates") or [])]


def test_every_inline_template_matches_the_llm_contract():
    found = _templates()
    assert sum(1 for _, t in found if SQL.match(t)) >= 6  # the scan really saw the inline SQL templates
    problems = [f"{f}: {p}" for f, t in found for p in template_problems(t, VIEWS)]
    assert problems == []


def test_the_check_goes_red_for_a_renamed_column_and_an_unknown_view():
    ok = "x: select season, points_cum from llm.v where season = 2024 order by points_cum"
    views = {"v": {"season", "points_cum"}}
    assert template_problems(ok, views) == []
    assert template_problems(ok.replace("points_cum from", "points_total from"), views) == ["x: llm.v has no column points_total"]
    assert template_problems(ok.replace("order by points_cum", "order by rnk"), views) == ["x: llm.v has no column rnk"]
    assert template_problems(ok.replace("llm.v", "llm.w"), views) == ["x: llm.w is not a documented llm view"]
