select
    'f1db:driver:' || player_id || ':era-adjusted'  as fact_key,
    player_id, display_name, full_name, first_season, last_season, seasons, starts, wins, podiums, titles,
    points_awarded, points_current_system,
    round(points_per_start_current_system, 3)       as points_per_start_current_system,
    round(win_rate, 4)                              as win_rate,
    round(peak_season_share, 4)                     as peak_season_share,
    eligible, rank_raw, rank_adjusted, min_starts, method,
    'Data: F1DB (CC BY 4.0)'                        as attribution
from {{ ref('mart_era_adjusted') }}
