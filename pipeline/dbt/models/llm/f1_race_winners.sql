-- One row per (race, winning driver): the series behind winner-age and grid-to-victory formats.
-- Grand Prix only (the Indianapolis 500 rounds are excluded, as in every other win count). A shared
-- winning car yields one row per driver who classified first in it.
select
    'f1db:race:' || r.match_id || ':winner:' || r.player_id               as fact_key,
    r.match_id                                                            as race_id,
    m.season, m.round, m.race_date, m.grand_prix_id, m.name               as race_name,
    r.player_id, p.display_name, p.full_name,
    r.team_id, t.display_name                                             as team_name,
    p.date_of_birth,
    date_diff('day', p.date_of_birth, m.race_date) / 365.2425             as age_at_win,
    r.grid_position,
    r.shared_car                                                          as shared_drive,
    'Data: F1DB (CC BY 4.0)'                                              as attribution
from {{ ref('player_match_results') }} r
join {{ ref('matches') }} m using (sport, match_id)
join {{ ref('players') }} p using (sport, player_id)
left join {{ ref('teams') }} t using (sport, team_id)
where r.started and r.position_number = 1 and not m.is_indianapolis
