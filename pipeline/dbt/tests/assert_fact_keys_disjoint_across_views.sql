-- Every `<fact_key>#<column>` ref resolves through Warehouse.facts against ALL llm views carrying a fact_key.
-- A key that exists in two views would resolve to whichever came first, so the keys must be disjoint across
-- views (per-view uniqueness is the unique test on each fact_key). Returns the offending keys.
-- dbt cannot ref() dynamically, so the view list is explicit; pipeline/tests/test_fact_key_contract.py fails
-- when an llm model with a fact_key is missing from it.
with keys as (
    select fact_key, 'f1_constructor_seasons' as view_name from {{ ref('f1_constructor_seasons') }}
    union all select fact_key, 'f1_driver_bios' from {{ ref('f1_driver_bios') }}
    union all select fact_key, 'f1_driver_era_adjusted' from {{ ref('f1_driver_era_adjusted') }}
    union all select fact_key, 'f1_driver_race_cumulative' from {{ ref('f1_driver_race_cumulative') }}
    union all select fact_key, 'f1_driver_seasons' from {{ ref('f1_driver_seasons') }}
    union all select fact_key, 'f1_race_results' from {{ ref('f1_race_results') }}
    union all select fact_key, 'f1_race_winners' from {{ ref('f1_race_winners') }}
    union all select fact_key, 'f1_season_standings_by_round' from {{ ref('f1_season_standings_by_round') }}
    union all select fact_key, 'f1_seasons' from {{ ref('f1_seasons') }}
)
select fact_key, count(distinct view_name) as views, list(distinct view_name) as view_names
from keys
group by fact_key
having count(distinct view_name) > 1
