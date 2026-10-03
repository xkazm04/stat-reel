-- The Drivers' Championship after every round: the read model for points-fight and season-so-far formats.
select
    'f1db:season:' || c.season || ':round:' || c.round || ':driver:' || c.player_id || ':standing' as fact_key,
    c.season, c.round, c.race_id, c.race_date,
    c.player_id, p.display_name, p.full_name,
    c.points_round, c.sprint_points_round, c.points_cum, c.wins_cum, c.seconds_cum, c.thirds_cum,
    c.rank, c.gap_to_leader, c.tied_on_points, c.is_final_round, c.drops_apply,
    'Data: F1DB (CC BY 4.0)'                                                                      as attribution
from {{ ref('season_standings_by_round') }} c
join {{ ref('players') }} p using (sport, player_id)
