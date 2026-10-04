select
    'f1db:driver:' || s.player_id || ':season:' || s.season   as fact_key,
    s.player_id, p.display_name, p.full_name, s.season, s.starts, s.wins, s.podiums, s.points_awarded,
    s.sprint_points, s.points_current_system, round(s.season_share, 4)         as season_share,
    s.season_races, s.championship_position,
    'Data: F1DB (CC BY 4.0)'                                  as attribution
from {{ ref('player_season_stats') }} s
join {{ ref('players') }} p using (sport, player_id)
