select
    'f1db:driver:' || player_id || ':bio'  as fact_key,
    player_id, display_name, full_name, date_of_birth, nationality,
    'Data: F1DB (CC BY 4.0)'               as attribution
from {{ ref('players') }}
