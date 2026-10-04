/**
 * A snapshot of REAL rows of llm.f1_driver_seasons (DuckDB warehouse, F1DB, CC-BY-4.0) for ten drivers over the
 * seasons 2000-2024, so the fake-mode generate_video fixture is built from real figures without a warehouse at
 * test time. Each row's fact ref is `f1db:driver:<id>:season:<season>#points_current_system` (or `#wins`).
 * `fixture-rows.test.ts` re-checks every figure against the live warehouse when data/warehouse.duckdb exists.
 * Taken 2026-10-04 with a read-only connection; refresh only by re-running that query.
 */
// biome-ignore format: a data table reads one row per line
export const F1_SEASONS: number[] = [2000,2001,2002,2003,2004,2005,2006,2007,2008,2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024];
export type F1Driver = { id: string; name: string; points: (number | null)[]; wins: (number | null)[] };
// biome-ignore format: a data table reads one row per line
export const F1_DRIVERS: F1Driver[] = [
  {
    id: "michael-schumacher", name: "Michael Schumacher",
    points: [286, 327, 380, 236, 367, 153, 296, null, null, null, 72, 76, 49, null, null, null, null, null, null, null, null, null, null, null, null],
    wins: [9, 9, 11, 6, 13, 1, 7, null, null, null, 0, 0, 0, null, null, null, null, null, null, null, null, null, null, null, null]
  },
  {
    id: "mika-hakkinen", name: "Mika Häkkinen",
    points: [258, 129, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    wins: [4, 2, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null]
  },
  {
    id: "fernando-alonso", name: "Fernando Alonso",
    points: [null, 1, null, 137, 146, 322, 321, 266, 154, 73, 252, 257, 278, 242, 159, 11, 54, 17, 50, null, null, 81, 81, 197, 69],
    wins: [null, 0, null, 1, 0, 7, 7, 4, 2, 0, 5, 1, 3, 2, 0, 0, 0, 0, 0, null, null, 0, 0, 0, 0]
  },
  {
    id: "kimi-raikkonen", name: "Kimi Räikkönen",
    points: [null, 66, 87, 213, 112, 277, 158, 272, 189, 124, null, null, 207, 183, 54, 150, 186, 205, 251, 43, 4, 10, null, null, null],
    wins: [null, 0, 0, 1, 1, 7, 0, 6, 2, 1, null, null, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, null, null, null]
  },
  {
    id: "lewis-hamilton", name: "Lewis Hamilton",
    points: [null, null, null, null, null, null, null, 265, 243, 126, 240, 227, 190, 189, 359, 381, 380, 363, 408, 407, 341, 387, 231, 213, 205],
    wins: [null, null, null, null, null, null, null, 4, 5, 2, 3, 3, 4, 1, 11, 10, 10, 9, 11, 11, 11, 8, 0, 0, 2]
  },
  {
    id: "jenson-button", name: "Jenson Button",
    points: [67, 25, 80, 52, 206, 97, 142, 19, 11, 252, 214, 270, 188, 73, 116, 16, 21, 0, null, null, null, null, null, null, null],
    wins: [0, 0, 0, 0, 0, 0, 1, 0, 0, 6, 2, 3, 3, 0, 0, 0, 0, 0, null, null, null, null, null, null, null]
  },
  {
    id: "sebastian-vettel", name: "Sebastian Vettel",
    points: [null, null, null, null, null, null, null, 16, 93, 206, 256, 392, 281, 397, 163, 278, 212, 317, 320, 238, 33, 48, 37, null, null],
    wins: [null, null, null, null, null, null, null, 0, 1, 4, 5, 11, 5, 13, 0, 3, 0, 5, 5, 1, 0, 0, 0, null, null]
  },
  {
    id: "nico-rosberg", name: "Nico Rosberg",
    points: [null, null, null, null, null, null, 17, 58, 49, 96, 142, 89, 93, 171, 317, 322, 385, null, null, null, null, null, null, null, null],
    wins: [null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 1, 2, 5, 6, 9, null, null, null, null, null, null, null, null]
  },
  {
    id: "max-verstappen", name: "Max Verstappen",
    points: [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 49, 204, 168, 249, 275, 211, 396, 428, 521, 396],
    wins: [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 0, 1, 2, 2, 3, 2, 10, 15, 19, 9]
  },
  {
    id: "charles-leclerc", name: "Charles Leclerc",
    points: [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 39, 260, 98, 161, 288, 185, 324],
    wins: [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 0, 2, 0, 0, 3, 0, 3]
  }
];
export const seasonFactKey = (id: string, season: number): string => `f1db:driver:${id}:season:${season}`;
