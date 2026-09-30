select
    'f1db:season:' || season                as fact_key,
    season, races_held, races_held_excl_indianapolis, races_scheduled,
    'Data: F1DB (CC BY 4.0)'                as attribution
from {{ ref('seasons') }}
