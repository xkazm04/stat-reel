-- Per driver per season. Starts, wins, podiums and current-system points EXCLUDE the Indianapolis
-- 500; points_awarded is the historical total as awarded (all rounds). A driver who took over a
-- team-mate's car appears twice in one race: that is one start, and both classified results score.
with results as (
    select r.*, m.is_indianapolis
    from {{ ref('player_match_results') }} r
    join {{ ref('matches') }} m using (sport, match_id)
),
agg as (
    select
        sport, player_id, season,
        count(distinct match_id) filter (where started and not is_indianapolis)             as starts,
        count(distinct match_id) filter (where started and not is_indianapolis and position_number = 1)  as wins,
        count(distinct match_id) filter (where started and not is_indianapolis and position_number <= 3) as podiums,
        sum(points_awarded)                                                                  as points_awarded,
        coalesce(sum(points_current_system) filter (where not is_indianapolis), 0)           as points_current_system
    from results
    group by all
)
select
    agg.*,
    st.championship_position,
    coalesce(st.championship_won, false)                                                     as championship_won,
    s.races_held_excl_indianapolis                                                           as season_races,
    agg.points_current_system / nullif(25.0 * s.races_held_excl_indianapolis, 0)             as season_share
from agg
join {{ ref('seasons') }} s using (sport, season)
left join {{ ref('stg_f1db__season_driver_standings') }} st
    on st.season = agg.season and st.driver_id = agg.player_id
