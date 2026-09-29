select
    'F1'                                                        as sport,
    season,
    count(*) filter (where has_results)                         as races_held,
    count(*) filter (where has_results and not is_indianapolis) as races_held_excl_indianapolis,
    count(*)                                                    as races_scheduled
from {{ ref('matches') }}
group by season
