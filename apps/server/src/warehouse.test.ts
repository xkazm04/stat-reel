import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { paths } from "./config";
import { Warehouse, checkReadOnlyLlmSql } from "./warehouse";

const hasWarehouse = existsSync(paths.warehouse);

describe.skipIf(!hasWarehouse)("warehouse (llm schema only, read-only)", () => {
  let wh: Warehouse;
  beforeAll(async () => {
    wh = await Warehouse.open(paths.warehouse);
  });
  afterAll(() => wh?.close());

  it("accepts a select over llm views", async () => {
    await expect(checkReadOnlyLlmSql(wh, "select display_name from llm.f1_driver_era_adjusted where rank_adjusted <= 3")).resolves.toBeUndefined();
  });

  it("accepts CTEs that only read llm", async () => {
    const sql = "with top as (select * from llm.f1_driver_era_adjusted where eligible) select count(*) from top";
    await expect(checkReadOnlyLlmSql(wh, sql)).resolves.toBeUndefined();
  });

  it.each([
    ["other schema", "select * from core.players", /schema 'core'/],
    ["join to core", "select * from llm.f1_driver_era_adjusted a join marts.mart_era_adjusted m using (player_id)", /schema 'marts'/],
    ["unqualified table", "select * from f1_driver_era_adjusted", /must be qualified/],
    ["table function", "select * from read_csv('C:/x.csv')", /table function/],
    ["write", "insert into llm.x values (1)", /only SELECT/i],
    ["ddl", "drop view llm.f1_driver_era_adjusted", /only SELECT/i],
    ["multiple statements", "select 1; select 2", /one statement/],
  ])("rejects %s", async (_name, sql, msg) => {
    await expect(checkReadOnlyLlmSql(wh, sql)).rejects.toThrow(msg);
  });

  it("caps rows and reports lineage licence class", async () => {
    const res = await wh.query("select a.fact_key from llm.f1_driver_seasons a, llm.f1_driver_seasons b where b.season = 2024");
    expect(res.rows.length).toBeLessThanOrEqual(5000);
    expect(res.truncated).toBe(true);
    expect(res.license_class).toBe("legal");
    expect(res.sources).toEqual(["f1db"]);
  });

  it("resolves a fact ref to its value", async () => {
    const f = await wh.fact("f1db:driver:juan-manuel-fangio:era-adjusted#rank_adjusted");
    expect(f).toBe(1);
    await expect(wh.fact("f1db:driver:nobody:era-adjusted#rank_adjusted")).resolves.toBeUndefined();
  });

  it("describes views with column comments", async () => {
    const views = await wh.describeViews();
    const era = views.find((v) => v.name === "llm.f1_driver_era_adjusted");
    expect(era?.comment).toContain("F1DB");
    expect(era?.columns.find((c) => c.name === "rank_adjusted")?.comment).toMatch(/Rank/);
    expect(era?.sample.length).toBeGreaterThan(0);
  });
});
