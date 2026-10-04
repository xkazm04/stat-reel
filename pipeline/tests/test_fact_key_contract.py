"""fact_key contract guards that need no warehouse: the dbt YAML and the singular disjointness test stay in step."""

from __future__ import annotations

import re
from pathlib import Path

import yaml

DBT = Path(__file__).parents[1] / "dbt"
LLM_MODELS = yaml.safe_load((DBT / "models" / "llm" / "_llm__models.yml").read_text(encoding="utf-8"))["models"]
DISJOINT_TEST = (DBT / "tests" / "assert_fact_keys_disjoint_across_views.sql").read_text(encoding="utf-8")


def _fact_key_models() -> set[str]:
    return {m["name"] for m in LLM_MODELS if any(c["name"] == "fact_key" for c in m["columns"])}


def test_every_fact_key_column_is_unique_and_not_null():
    for m in LLM_MODELS:
        for c in m["columns"]:
            if c["name"] == "fact_key":
                assert set(c.get("data_tests", [])) >= {"unique", "not_null"}, m["name"]


def test_disjointness_test_covers_every_llm_view_with_a_fact_key():
    listed = set(re.findall(r"ref\('([a-z0-9_]+)'\)", DISJOINT_TEST))
    assert listed == _fact_key_models()


def test_every_llm_sql_model_is_documented_in_the_yaml():
    sql = {p.stem for p in (DBT / "models" / "llm").glob("*.sql")}
    assert sql == {m["name"] for m in LLM_MODELS}
