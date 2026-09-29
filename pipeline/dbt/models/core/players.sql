select
    'F1'                    as sport,
    driver_id               as player_id,
    full_name,
    display_name,
    date_of_birth,
    nationality_country_id  as nationality
from {{ ref('stg_f1db__drivers') }}
