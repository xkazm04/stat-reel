import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { paths } from "./config";
import { FactKeyCollisionError, Warehouse, checkReadOnlyLlmSql, factRefFormatHint, queryTimeoutMessage } from "./warehouse";

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
    ["show all tables (metadata leak)", "select * from (show all tables)", /SHOW \/ DESCRIBE/],
    ["describe of non-llm", "select * from (describe core.players)", /SHOW \/ DESCRIBE|schema 'core'/],
    ["summarize of non-llm", "select * from (summarize core.players)", /SHOW \/ DESCRIBE|schema 'core'/],
    ["non-llm in a nested join", "select * from llm.f1_driver_era_adjusted a join (select * from (select * from core.players) p) q on true", /schema 'core'/],
    ["non-llm in a scalar subquery", "select (select count(*) from marts.mart_era_adjusted)", /schema 'marts'/],
    ["multiple statements", "select 1; select 2", /one statement/],
  ])("rejects %s", async (_name, sql, msg) => {
    await expect(checkReadOnlyLlmSql(wh, sql)).rejects.toThrow(msg);
  });

  it("accepts joins, subqueries and VALUES over llm", async () => {
    const sql = "select a.fact_key from llm.f1_driver_era_adjusted a join (select 1 as x) b on true, (values (1)) v";
    await expect(checkReadOnlyLlmSql(wh, sql)).resolves.toBeUndefined();
  });

  it("batches fact refs and keeps unknown ones out", async () => {
    const k = "f1db:driver:juan-manuel-fangio:era-adjusted";
    const m = await wh.facts([`${k}#rank_adjusted`, `${k}#rank_adjusted`, "f1db:driver:nobody:era-adjusted#rank_adjusted", "bad ref"]);
    expect([...m.keys()]).toEqual([`${k}#rank_adjusted`]);
    expect(m.get(`${k}#rank_adjusted`)).toBe(1);
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

describe("warehouse on a throwaway database (no repo warehouse needed)", () => {
  let wh: Warehouse;
  beforeAll(async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "wh-")), "t.duckdb");
    const seed = await DuckDBInstance.create(file);
    const c = await seed.connect();
    await c.run("create schema llm");
    await c.run("create schema meta");
    await c.run("create table meta.model_lineage as select 'big' as model, 'legal' as license_class, ['test'] as sources");
    await c.run("create view llm.big as select range as n from range(3000000)");
    await c.run("create view llm.facts as select 'k1' as fact_key, 7 as points_2024, 3 as rank_adjusted");
    c.closeSync();
    seed.closeSync();
    wh = await Warehouse.open(file);
  });
  afterAll(() => wh?.close());

  it("maps an interrupted query to an actionable message", async () => {
    await expect(wh.query("select count(*) from llm.big a, llm.big b", 100)).rejects.toThrow(/^query exceeded 0\.1 s - add a WHERE or aggregate$/);
    expect(queryTimeoutMessage()).toBe("query exceeded 10 s - add a WHERE or aggregate");
  });

  it("does not map an ordinary query error to a timeout", async () => {
    await expect(wh.query("select cast('abc' as integer) from llm.big limit 1")).rejects.not.toThrow(/exceeded/);
  });

  it("an interrupted query does not kill a concurrent facts() call", async () => {
    const slow = wh.query("select count(*) from llm.big a, llm.big b", 300).catch((e) => e as Error);
    const facts = await Promise.all(Array.from({ length: 5 }, () => wh.facts(["k1#rank_adjusted"])));
    for (const m of facts) expect(m.get("k1#rank_adjusted")).toBe(3);
    expect(((await slow) as Error).message).toMatch(/query exceeded/);
    await expect(wh.query("select n from llm.big where n < 3 order by n")).resolves.toMatchObject({ rows: [{ n: 0 }, { n: 1 }, { n: 2 }] });
  });

  it("resolves fact columns that contain digits", async () => {
    expect((await wh.facts(["k1#points_2024"])).get("k1#points_2024")).toBe(7);
  });
});

describe("fact_key contract: disjoint across views", () => {
  const seed = async (setup: (run: (sql: string) => Promise<unknown>) => Promise<void>): Promise<{ wh: Warehouse; file: string }> => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "wh-fk-")), "t.duckdb");
    const inst = await DuckDBInstance.create(file);
    const c = await inst.connect();
    await c.run("create schema llm");
    await setup((sql) => c.run(sql));
    c.closeSync();
    inst.closeSync();
    return { wh: await Warehouse.open(file), file };
  };

  it("raises a named error naming both views, in name order, whatever order they were created in", async () => {
    // zeta is created BEFORE alpha: the error must still list alpha first (deterministic factViews order)
    const { wh } = await seed(async (run) => {
      await run("create view llm.zeta as select 'dup' as fact_key, 1 as n");
      await run("create view llm.alpha as select 'dup' as fact_key, 2 as n");
    });
    try {
      const err = await wh.facts(["dup#n"]).catch((e) => e);
      expect(err).toBeInstanceOf(FactKeyCollisionError);
      expect(err.name).toBe("FactKeyCollisionError");
      expect(err.views).toEqual(["alpha", "zeta"]);
      expect(err.message).toMatch(/'dup'.*alpha, zeta.*disjoint/);
    } finally {
      wh.close();
    }
  });

  it("does not raise when the shared key is only asked for a column one view carries", async () => {
    const { wh } = await seed(async (run) => {
      await run("create view llm.alpha as select 'dup' as fact_key, 2 as only_a");
      await run("create view llm.zeta as select 'dup' as fact_key, 1 as only_z");
    });
    try {
      expect((await wh.facts(["dup#only_a"])).get("dup#only_a")).toBe(2);
    } finally {
      wh.close();
    }
  });

  it("resolves disjoint keys across views with the same column", async () => {
    const { wh } = await seed(async (run) => {
      await run("create view llm.b as select 'kb' as fact_key, 20 as n");
      await run("create view llm.a as select 'ka' as fact_key, 10 as n");
    });
    try {
      const m = await wh.facts(["ka#n", "kb#n"]);
      expect([m.get("ka#n"), m.get("kb#n")]).toEqual([10, 20]);
    } finally {
      wh.close();
    }
  });
});

describe("factRefFormatHint", () => {
  it("accepts well-formed refs, including digits in the column", () => {
    expect(factRefFormatHint("f1db:driver:x:era-adjusted#rank_adjusted")).toBeUndefined();
    expect(factRefFormatHint("k#points_2024")).toBeUndefined();
  });
  it("explains what is wrong with a bad ref", () => {
    expect(factRefFormatHint("no hash")).toMatch(/'<fact_key>#<column>'/);
    expect(factRefFormatHint("k#a#b")).toMatch(/one '#'/);
    expect(factRefFormatHint("k#Rank")).toMatch(/lowercase letters, digits and underscores/);
    expect(factRefFormatHint("k#2024_pts")).toMatch(/not starting with a digit/);
    expect(factRefFormatHint('k#a"b')).toMatch(/must match/);
  });
});
