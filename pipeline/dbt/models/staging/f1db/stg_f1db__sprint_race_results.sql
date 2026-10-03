-- One row per driver entry in a Sprint (2021 onwards). Sprint points count for the Drivers'
-- Championship but are NOT part of the race result: kept separate so per-race models stay GP-only.
select
    raceId                  as race_id,
    year                    as season,
    round,
    driverId                as driver_id,
    constructorId           as constructor_id,
    positionNumber          as position_number,
    positionText            as position_text,
    coalesce(points, 0)     as points_awarded
from {{ source('f1db', 'races_sprint_race_results') }}
