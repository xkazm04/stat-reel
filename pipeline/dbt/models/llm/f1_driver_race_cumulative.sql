-- Dense cumulative career series: the read model for "race" formats (career wins race, record handovers).
select
    'f1db:driver:' || c.player_id || ':race:' || c.race_id || ':cumulative' as fact_key,
    c.player_id, p.display_name, p.full_name,
    c.race_id, c.season, c.round, c.race_date, c.race_seq,
    c.entered, c.starts_cum, c.wins_cum, c.podiums_cum, c.points_cum,
    c.rank_wins_cum, c.tied,
    'Data: F1DB (CC BY 4.0)'                                                as attribution
from {{ ref('driver_race_cumulative') }} c
join {{ ref('players') }} p using (sport, player_id)
