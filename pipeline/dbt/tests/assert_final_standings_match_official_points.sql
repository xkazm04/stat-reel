-- Real-data twin of the python oracle in test_lane1_e2e.py (standings_by_round_reconcile_with_official_
-- championship_points): after the final round, points_cum equals f1db's official championship_points for every
-- season without dropped scores (before 1991 only a best-N subset counted, which the view does not apply).
-- Same predicate: restricted to the seasons the view covers, a missing row counts as 0 points on either side.
-- Returns the mismatching (season, driver) rows.
with mine as (
    select season, player_id, points_cum
    from {{ ref('f1_season_standings_by_round') }}
    where is_final_round and not drops_apply
),
official as (
    select season, driver_id as player_id, championship_points
    from {{ ref('stg_f1db__season_driver_standings') }}
)
select coalesce(m.season, o.season) as season, coalesce(m.player_id, o.player_id) as player_id,
       m.points_cum, o.championship_points
from mine m
full join official o on o.season = m.season and o.player_id = m.player_id
where coalesce(m.season, o.season) in (select season from mine)
  and coalesce(m.points_cum, 0) <> coalesce(o.championship_points, 0)
