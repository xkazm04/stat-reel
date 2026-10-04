-- Every entry with its result re-scored under the CURRENT points system (25-18-15-12-10-8-6-4-2-1,
-- no fastest-lap point, sprints excluded). A shared car's points are split between ALL its drivers:
-- f1db flags sharedCar only on the drivers who took the car over (the driver who started it reads
-- false), so a classified position is shared when ANY entry at it is flagged.
{% set current_points = {1: 25, 2: 18, 3: 15, 4: 12, 5: 10, 6: 8, 7: 6, 8: 4, 9: 2, 10: 1} %}
with results as (select * from {{ ref('stg_f1db__race_results') }}),
sharers as (
    select race_id, position_number, count(*) as n
    from results
    where started and position_number is not null
    group by all
    having bool_or(shared_car)
)
select
    'F1'                    as sport,
    r.race_id               as match_id,
    r.season,
    r.driver_id             as player_id,
    r.constructor_id        as team_id,
    r.position_number,
    r.position_text,
    r.grid_position,
    r.position_display_order,
    r.started,
    -- the whole car: also true for the driver who started it (f1db leaves that row unflagged)
    r.shared_car or s.n is not null as shared_car,
    coalesce(r.points_awarded, 0) as points_awarded,
    case when not r.started or r.position_number is null then 0.0
         else (case r.position_number
               {% for pos, pts in current_points.items() %}when {{ pos }} then {{ pts }} {% endfor %}
               else 0 end)::double / coalesce(s.n, 1)
    end                     as points_current_system
from results r
left join sharers s on s.race_id = r.race_id and s.position_number = r.position_number
