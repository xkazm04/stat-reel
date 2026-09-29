from statreel_ingest.lineage import compute_lineage


def manifest():
    return {
        "sources": {
            "source.sr.f1db.races": {"unique_id": "source.sr.f1db.races", "meta": {"license_class": "legal", "source_id": "f1db"}},
            "source.sr.jolpica.laps": {"unique_id": "source.sr.jolpica.laps", "meta": {"license_class": "non_commercial", "source_id": "jolpica-f1"}},
        },
        "nodes": {
            "model.sr.stg_f1db__races": {"resource_type": "model", "name": "stg_f1db__races", "depends_on": {"nodes": ["source.sr.f1db.races"]}},
            "model.sr.stg_jolpica__laps": {"resource_type": "model", "name": "stg_jolpica__laps", "depends_on": {"nodes": ["source.sr.jolpica.laps"]}},
            "model.sr.mart_legal": {"resource_type": "model", "name": "mart_legal", "depends_on": {"nodes": ["model.sr.stg_f1db__races"]}},
            "model.sr.mart_mixed": {"resource_type": "model", "name": "mart_mixed", "depends_on": {"nodes": ["model.sr.mart_legal", "model.sr.stg_jolpica__laps"]}},
            "test.sr.not_null": {"resource_type": "test", "name": "not_null", "depends_on": {"nodes": ["model.sr.mart_legal"]}},
        },
    }


def test_legal_only_upstream_stays_legal():
    lin = compute_lineage(manifest())
    assert lin["mart_legal"] == ("legal", ["f1db"])


def test_most_restrictive_upstream_class_wins():
    lin = compute_lineage(manifest())
    assert lin["mart_mixed"] == ("non_commercial", ["f1db", "jolpica-f1"])


def test_tests_are_not_models():
    assert "not_null" not in compute_lineage(manifest())


def test_source_without_licence_meta_is_treated_as_unknown_and_most_restrictive():
    m = manifest()
    m["sources"]["source.sr.f1db.races"]["meta"] = {}
    lin = compute_lineage(m)
    assert lin["mart_legal"][0] == "unknown"


def test_source_level_meta_is_inherited_by_its_tables():
    # dbt puts `sources: - name: f1db, meta: {...}` on each table node as `source_meta`
    m = manifest()
    m["sources"]["source.sr.f1db.races"] = {"unique_id": "source.sr.f1db.races", "meta": {},
                                            "source_meta": {"license_class": "legal", "source_id": "f1db"}}
    assert compute_lineage(m)["mart_legal"] == ("legal", ["f1db"])
