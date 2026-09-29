-- A race weekend's Grand Prix. The Indianapolis 500 counted for the championship 1950-1960 but was
-- contested by a separate field; it is flagged so per-start metrics can exclude it.
with resulted as (select distinct race_id from {{ ref('stg_f1db__race_results') }})
select
    'F1'                                as sport,
    r.race_id                           as match_id,
    r.season,
    r.round,
    r.race_date,
    r.grand_prix_id,
    r.official_name                     as name,
    r.grand_prix_id = 'indianapolis'    as is_indianapolis,
    resulted.race_id is not null        as has_results
from {{ ref('stg_f1db__races') }} r
left join resulted using (race_id)
