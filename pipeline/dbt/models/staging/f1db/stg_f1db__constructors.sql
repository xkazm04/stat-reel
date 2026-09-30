select
    id          as constructor_id,
    name        as display_name,
    fullName    as full_name,
    countryId   as country_id
from {{ source('f1db', 'constructors') }}
