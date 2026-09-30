select
    'f1db:team:' || r.team_id || ':season:' || m.season                                     as fact_key,
    r.team_id, t.display_name                                                               as team_name, m.season,
    count(distinct r.match_id) filter (where r.started and not m.is_indianapolis)          as races_started,
    count(distinct r.match_id) filter (where r.started and not m.is_indianapolis and r.position_number = 1) as wins,
    count(*) filter (where r.started and not m.is_indianapolis and r.position_number <= 3) as podium_finishes,
    sum(r.points_awarded)                                                                   as points_awarded,
    'Data: F1DB (CC BY 4.0)'                                                                as attribution
from {{ ref('player_match_results') }} r
join {{ ref('matches') }} m using (sport, match_id)
left join {{ ref('teams') }} t using (sport, team_id)
group by r.team_id, t.display_name, m.season
