select 'F1' as sport, constructor_id as team_id, display_name, full_name, country_id
from {{ ref('stg_f1db__constructors') }}
