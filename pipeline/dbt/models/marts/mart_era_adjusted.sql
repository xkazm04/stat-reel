-- Era-adjusted F1 driver careers (M1). "Adjusted" = every race re-scored under the current points
-- system and divided by starts, so a 1950s eight-race season and a 24-race season compare per start.
-- Ranks are only given to drivers with at least var('min_starts') starts.
{% set min_starts = var('min_starts', 30) %}
with seasons as (select * from {{ ref('player_season_stats') }}),
career as (
    select
        sport, player_id,
        min(season) filter (where starts > 0)                          as first_season,
        max(season) filter (where starts > 0)                          as last_season,
        count(*) filter (where starts > 0)                             as seasons,
        sum(starts)                                                    as starts,
        sum(wins)                                                      as wins,
        sum(podiums)                                                   as podiums,
        count(*) filter (where championship_won)                       as titles,
        sum(points_awarded)                                            as points_awarded,
        sum(points_current_system)                                     as points_current_system,
        max(season_share) filter (where starts * 2 >= season_races)    as peak_season_share
    from seasons
    group by all
),
scored as (
    select
        c.*,
        p.full_name,
        p.display_name,
        c.points_current_system / c.starts                             as points_per_start_current_system,
        c.wins::double / c.starts                                      as win_rate,
        c.starts >= {{ min_starts }}                                   as eligible
    from career c
    join {{ ref('players') }} p using (sport, player_id)
    where c.starts > 0
)
select
    *,
    case when eligible then row_number() over (
        partition by eligible order by points_awarded desc, wins desc, player_id) end            as rank_raw,
    case when eligible then row_number() over (
        partition by eligible order by points_per_start_current_system desc, win_rate desc, player_id) end
                                                                                                as rank_adjusted,
    'current points system (25-18-15-12-10-8-6-4-2-1) per start; Indianapolis 500 excluded; shared cars split'
                                                                                                as method,
    {{ min_starts }}                                                                            as min_starts
from scored
