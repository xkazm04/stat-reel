select
    id              as race_id,
    year            as season,
    round,
    date            as race_date,
    grandPrixId     as grand_prix_id,
    officialName    as official_name,
    circuitId       as circuit_id
from {{ source('f1db', 'races') }}
