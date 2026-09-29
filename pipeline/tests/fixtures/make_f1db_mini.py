"""Cut the replay fixture `f1db-mini/` from a real f1db snapshot.

    uv run --project pipeline python pipeline/tests/fixtures/make_f1db_mini.py data/raw/f1db/<snapshot>

Keeps a handful of seasons across eras (with the Indianapolis 500 and shared cars in 1950s rounds)
and every driver appearing in them. Data: F1DB (CC BY 4.0) - see f1db-mini/README.md.
"""

import sys
from pathlib import Path

import duckdb

SEASONS = (1950, 1951, 1955, 1963, 1988, 2008, 2024, 2025, 2026)
OUT = Path(__file__).parent / "f1db-mini"


def main() -> None:
    snap = Path(sys.argv[1])
    OUT.mkdir(exist_ok=True)
    con = duckdb.connect()
    seasons = ", ".join(map(str, SEASONS))
    for name in ("races", "races_race_results", "seasons_driver_standings"):
        con.execute(f"create view {name} as select * from read_parquet('{(snap / f'{name}.parquet').as_posix()}') where year in ({seasons})")
    con.execute(f"create view seasons as select * from read_parquet('{(snap / 'seasons.parquet').as_posix()}') where year in ({seasons})")
    con.execute(f"""create view drivers as select * from read_parquet('{(snap / 'drivers.parquet').as_posix()}')
                    where id in (select driverId from races_race_results)""")
    for name in ("races", "races_race_results", "seasons_driver_standings", "seasons", "drivers"):
        target = OUT / f"f1db-{name.replace('_', '-')}.csv"
        con.execute(f"copy (select * from {name}) to '{target.as_posix()}' (header, delimiter ',')")
        print(target.name, con.execute(f"select count(*) from {name}").fetchone()[0])


if __name__ == "__main__":
    main()
