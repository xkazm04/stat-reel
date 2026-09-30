-- Race by race: the series behind the time-evolution formats (ADR 007).
select
    'f1db:race:' || r.match_id || ':driver:' || r.player_id || ':entry:' || r.position_display_order as fact_key,
    r.match_id                                                as race_id,
    m.season, m.round, m.race_date, m.grand_prix_id, m.name   as race_name, m.is_indianapolis,
    r.player_id, p.display_name, r.team_id, t.display_name   as team_name, r.position_display_order as entry_order,
    r.grid_position, r.position_number, r.position_text, r.started, r.shared_car,
    r.points_awarded, r.points_current_system,
    'Data: F1DB (CC BY 4.0)'                                  as attribution
from {{ ref('player_match_results') }} r
join {{ ref('matches') }} m using (sport, match_id)
join {{ ref('players') }} p using (sport, player_id)
left join {{ ref('teams') }} t using (sport, team_id)
