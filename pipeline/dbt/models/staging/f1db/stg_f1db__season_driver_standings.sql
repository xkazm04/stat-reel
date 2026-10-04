select
    year            as season,
    driverId        as driver_id,
    positionNumber  as championship_position,
    points          as championship_points,
    -- false for the leader of a season still in progress: position 1 is not yet a title
    coalesce(championshipWon, false) as championship_won
from {{ source('f1db', 'seasons_driver_standings') }}
