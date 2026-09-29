select
    year            as season,
    driverId        as driver_id,
    positionNumber  as championship_position,
    points          as championship_points
from {{ source('f1db', 'seasons_driver_standings') }}
