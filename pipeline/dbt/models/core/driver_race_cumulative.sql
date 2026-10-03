-- Read model behind llm.f1_driver_race_cumulative (materialised: the dense driver x race grid with
-- running windows is the heaviest query the LLM would otherwise run). One row per (driver, race)
-- from the driver's first start to the latest race with results, so a bar-chart race never has to
-- fill gaps: totals carry forward over races the driver did not enter.
-- Grand Prix only: the Indianapolis 500 is not a row and counts for nothing (same rule as
-- player_season_stats). Wins/podiums count DISTINCT races per driver, so a driver who took over a
-- team-mate's car or shared a winning car is credited once per race. Points are the CURRENT system
-- as player_match_results defines it (25-18-15-12-10-8-6-4-2-1, no fastest-lap point, no sprints,
-- shared cars split).
with races as (
    select
        match_id as race_id, season, round, race_date,
        row_number() over (order by season, round) as race_seq
    from {{ ref('matches') }}
    where has_results and not is_indianapolis
),
per_race as (
    select
        r.player_id, r.match_id as race_id,
        bool_or(r.started)                                                    as entered,
        max(case when r.started and r.position_number = 1 then 1 else 0 end)  as win,
        max(case when r.started and r.position_number <= 3 then 1 else 0 end) as podium,
        sum(r.points_current_system)                                          as points
    from {{ ref('player_match_results') }} r
    join races on races.race_id = r.match_id
    group by all
),
debut as (
    select p.player_id, min(races.race_seq) as debut_seq
    from per_race p join races using (race_id)
    where p.entered
    group by 1
),
grid as (
    select d.player_id, races.*
    from debut d
    join races on races.race_seq >= d.debut_seq
),
running as (
    select
        g.*,
        coalesce(p.entered, false)                                                        as entered,
        sum(case when coalesce(p.entered, false) then 1 else 0 end)
            over w                                                                        as starts_cum,
        sum(coalesce(p.win, 0)) over w                                                    as wins_cum,
        sum(coalesce(p.podium, 0)) over w                                                 as podiums_cum,
        sum(coalesce(p.points, 0.0)) over w                                               as points_cum
    from grid g
    left join per_race p on p.player_id = g.player_id and p.race_id = g.race_id
    window w as (partition by g.player_id order by g.race_seq rows between unbounded preceding and current row)
)
select
    'F1'                                                       as sport,
    race_id, season, round, race_date, race_seq,
    player_id, entered,
    starts_cum::integer as starts_cum, wins_cum::integer as wins_cum,
    podiums_cum::integer as podiums_cum, points_cum,
    -- unique, stable ordering: wins, then podiums, then points, then id; ties are flagged, not hidden
    row_number() over (partition by race_id order by wins_cum desc, podiums_cum desc, points_cum desc, player_id) as rank_wins_cum,
    count(*) over (partition by race_id, wins_cum) > 1         as tied
from running
