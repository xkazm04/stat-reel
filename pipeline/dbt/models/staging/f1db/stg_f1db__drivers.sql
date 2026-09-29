select
    id                        as driver_id,
    name                      as display_name,
    fullName                  as full_name,
    abbreviation,
    dateOfBirth               as date_of_birth,
    dateOfDeath               as date_of_death,
    nationalityCountryId      as nationality_country_id,
    totalRaceStarts           as total_race_starts,
    totalRaceWins             as total_race_wins,
    totalChampionshipWins     as total_championship_wins
from {{ source('f1db', 'drivers') }}
