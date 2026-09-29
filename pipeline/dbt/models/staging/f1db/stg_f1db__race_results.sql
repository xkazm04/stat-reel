-- One row per driver entry in a race. Entries that never took the start (did not qualify,
-- did not pre-qualify, did not start, did not practise) are flagged, not dropped.
select
    raceId                  as race_id,
    year                    as season,
    round,
    driverId                as driver_id,
    constructorId           as constructor_id,
    positionDisplayOrder    as position_display_order,
    positionNumber          as position_number,
    positionText            as position_text,
    coalesce(sharedCar, false) as shared_car,
    points                  as points_awarded,
    gridPositionNumber      as grid_position,
    positionText not in ('DNQ', 'DNPQ', 'DNS', 'DNP') as started
from {{ source('f1db', 'races_race_results') }}
