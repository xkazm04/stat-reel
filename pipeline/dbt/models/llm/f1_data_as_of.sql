-- One row: how fresh the data behind every other llm view is, so narration and the co-pilot can say
-- "data as of round N of <season>" instead of implying the data is live. The latest race is the last one
-- WITH results (a scheduled future round does not move it).
with latest as (
    select season, round, match_id as race_id, name as race_name, race_date
    from {{ ref('matches') }}
    where has_results
    order by race_date desc, season desc, round desc
    limit 1
)
select
    'f1db:data-as-of'                                                    as fact_key,
    l.race_date                                                          as latest_race_date,
    l.season                                                             as latest_season,
    l.round                                                              as latest_round,
    l.race_id                                                            as latest_race_id,
    l.race_name                                                          as latest_race_name,
    s.races_held                                                         as latest_season_races_held,
    s.races_scheduled                                                    as latest_season_races_scheduled,
    d.release_tag,
    cast(d.release_published_at as date)                                 as release_published_date,
    cast(d.snapshot as varchar)                                          as snapshot_fetched_at,
    'Data: F1DB (CC BY 4.0)'                                             as attribution
from latest l
join {{ ref('seasons') }} s on s.season = l.season
cross join {{ ref('data_snapshot') }} d
