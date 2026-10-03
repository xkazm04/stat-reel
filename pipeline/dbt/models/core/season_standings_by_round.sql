-- Read model behind llm.f1_season_standings_by_round: the Drivers' Championship after every round.
-- Unlike the career models this is the OFFICIAL-points view: points are as awarded (Grand Prix +
-- Sprint, that season's own scoring, fastest-lap point included where it existed) and the
-- Indianapolis 500 rounds of 1950-1960 DO count, because they counted for the championship.
-- Rows: every driver who started a Grand Prix or scored in the season, at EVERY round of that season
-- (0 points before their first race, totals carried forward after their last).
-- Ranking follows the sporting regulations' tie-break: points, then most wins, then most second
-- places, then thirds ... (Grand Prix results only, down to 8th place), then driver id as a stable
-- last resort. The regulation's final "earliest achieved" step is not implemented.
-- Seasons before 1991 counted only a driver's best N results: points_cum here is the TOTAL as
-- awarded, so it can exceed the official championship points (drops_apply = true).
with rounds as (
    select match_id as race_id, season, round, race_date
    from {{ ref('matches') }}
    where has_results
),
race_part as (
    select
        race_id, driver_id,
        sum(coalesce(points_awarded, 0))                                   as race_points,
        bool_or(started)                                                   as started,
        max(case when started and position_number = 1 then 1 else 0 end)   as p1,
        max(case when started and position_number = 2 then 1 else 0 end)   as p2,
        max(case when started and position_number = 3 then 1 else 0 end)   as p3,
        max(case when started and position_number = 4 then 1 else 0 end)   as p4,
        max(case when started and position_number = 5 then 1 else 0 end)   as p5,
        max(case when started and position_number = 6 then 1 else 0 end)   as p6,
        max(case when started and position_number = 7 then 1 else 0 end)   as p7,
        max(case when started and position_number = 8 then 1 else 0 end)   as p8
    from {{ ref('stg_f1db__race_results') }}
    group by all
),
sprint_part as (
    select race_id, driver_id, sum(points_awarded) as sprint_points
    from {{ ref('stg_f1db__sprint_race_results') }}
    group by all
),
per_round as (
    select
        coalesce(r.race_id, s.race_id) as race_id, coalesce(r.driver_id, s.driver_id) as driver_id,
        coalesce(r.race_points, 0) + coalesce(s.sprint_points, 0)          as points_round,
        coalesce(s.sprint_points, 0)                                       as sprint_points,
        coalesce(r.started, false)                                         as started,
        coalesce(r.p1, 0) as p1, coalesce(r.p2, 0) as p2, coalesce(r.p3, 0) as p3, coalesce(r.p4, 0) as p4,
        coalesce(r.p5, 0) as p5, coalesce(r.p6, 0) as p6, coalesce(r.p7, 0) as p7, coalesce(r.p8, 0) as p8
    from race_part r
    full join sprint_part s on s.race_id = r.race_id and s.driver_id = r.driver_id
),
season_drivers as (
    select rounds.season, p.driver_id
    from per_round p join rounds using (race_id)
    group by all
    having bool_or(p.started) or sum(p.points_round) > 0
),
grid as (
    select rounds.*, d.driver_id
    from rounds join season_drivers d using (season)
),
running as (
    select
        g.*,
        coalesce(p.points_round, 0)                                        as points_round,
        coalesce(p.sprint_points, 0)                                       as sprint_points_round,
        sum(coalesce(p.points_round, 0)) over w                            as points_cum,
        sum(coalesce(p.p1, 0)) over w                                      as wins_cum,
        sum(coalesce(p.p2, 0)) over w                                      as seconds_cum,
        sum(coalesce(p.p3, 0)) over w                                      as thirds_cum,
        sum(coalesce(p.p4, 0)) over w as p4_cum, sum(coalesce(p.p5, 0)) over w as p5_cum,
        sum(coalesce(p.p6, 0)) over w as p6_cum, sum(coalesce(p.p7, 0)) over w as p7_cum,
        sum(coalesce(p.p8, 0)) over w as p8_cum
    from grid g
    left join per_round p on p.race_id = g.race_id and p.driver_id = g.driver_id
    window w as (partition by g.season, g.driver_id order by g.round rows between unbounded preceding and current row)
),
ranked as (
    select
        *,
        row_number() over (partition by season, round
            order by points_cum desc, wins_cum desc, seconds_cum desc, thirds_cum desc,
                     p4_cum desc, p5_cum desc, p6_cum desc, p7_cum desc, p8_cum desc, driver_id) as rank
    from running
)
select
    'F1'                                                                   as sport,
    race_id, season, round, race_date,
    driver_id                                                              as player_id,
    points_round::double                                                   as points_round,
    sprint_points_round::double                                            as sprint_points_round,
    points_cum::double                                                     as points_cum,
    wins_cum::integer                                                      as wins_cum,
    seconds_cum::integer                                                   as seconds_cum,
    thirds_cum::integer                                                    as thirds_cum,
    rank::integer                                                          as rank,
    (max(points_cum) over (partition by season, round) - points_cum)::double as gap_to_leader,
    count(*) over (partition by season, round, points_cum) > 1             as tied_on_points,
    round = max(round) over (partition by season)                          as is_final_round,
    season < 1991                                                          as drops_apply
from ranked
