import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { paths } from "./config";
import { heatmapSnapshots, openDb } from "./db";
import type { Capability } from "./heatmap";
import { HeatmapService } from "./heatmap-service";
import type { Warehouse } from "./warehouse";

const cap = (kind: string, evaluated_at: string): Record<string, unknown> => ({
  sport: "F1", kind, source_id: "f1db", license_class: "legal", status: "pass", coverage_from: 1950, coverage_to: 2026, rows: 10, detail: "", evaluated_at,
});
const fakeWh = (rows: () => Record<string, unknown>[]) => ({ rows: async () => rows() }) as unknown as Warehouse;
const count = (db: ReturnType<typeof openDb>) => db.select().from(heatmapSnapshots).all().length;

describe("HeatmapService snapshots (freshness)", () => {
  it("an identical recompute inserts no snapshot and the trend is unchanged", async () => {
    const db = openDb(":memory:");
    const svc = new HeatmapService(db, fakeWh(() => [cap("hist", new Date().toISOString())]), new Set());
    await svc.recompute();
    const trend = svc.trend();
    await svc.recompute();
    await svc.recompute();
    expect(count(db)).toBe(1);
    expect(svc.trend()).toEqual(trend);
  });

  it("a changed result is snapshotted", async () => {
    const db = openDb(":memory:");
    let rows = [cap("hist", new Date().toISOString())];
    const svc = new HeatmapService(db, fakeWh(() => rows), new Set());
    await svc.recompute();
    rows = [cap("hist", new Date().toISOString()), cap("bio", new Date().toISOString())];
    await svc.recompute();
    expect(count(db)).toBe(2);
  });

  it("current() re-reads once a capability is evaluated after the cache was built", async () => {
    const db = openDb(":memory:");
    let rows = [cap("hist", "2020-01-01T00:00:00")];
    const svc = new HeatmapService(db, fakeWh(() => rows), new Set());
    const first = await svc.current();
    expect(await svc.current()).toBe(first); // nothing newer: cached
    rows = [cap("hist", "2020-01-01T00:00:00"), cap("bio", new Date(Date.now() + 60_000).toISOString())];
    expect(await svc.current()).not.toBe(first);
  });

  it("a warehouse that cannot be read is an error, never a snapshotted 'not tested' heatmap", async () => {
    const db = openDb(":memory:");
    let fail = true;
    const wh = { rows: async () => {
      if (fail) throw new Error("IO Error: Could not set lock on file \"warehouse.duckdb\"");
      return [cap("hist", "2020-01-01T00:00:00")];
    } } as unknown as Warehouse;
    const svc = new HeatmapService(db, wh, new Set());
    await expect(svc.current()).rejects.toThrow(/Could not set lock/);
    expect(count(db)).toBe(0); // nothing for the trend to remember
    fail = false;
    const cells = await svc.current(); // nothing was cached: the next read computes from the real capabilities
    expect(cells.some((c) => c.kinds.some((k) => k.tested))).toBe(true);
  });

  it("a warehouse with no meta.capabilities yet (no transform has run) reads as nothing tested", async () => {
    // DuckDB's two wordings: the meta schema is missing, or only the table is
    for (const message of ["Catalog Error: Table with name \"meta.capabilities\" does not exist because schema \"meta\" does not exist.",
      "Catalog Error: Table with name capabilities does not exist!\nDid you mean \"pg_catalog.pg_tables\"?"]) {
      const wh = { rows: async () => { throw new Error(message); } } as unknown as Warehouse;
      expect(await new HeatmapService(openDb(":memory:"), wh, new Set()).capabilities()).toEqual([]);
    }
  });

  it("serves capabilities with the pipeline's staleness window attached (live only)", async () => {
    const svc = new HeatmapService(openDb(":memory:"), fakeWh(() => [cap("live", "2026-10-01T00:00:00"), cap("hist", "2026-10-01T00:00:00")]), new Set());
    const caps = (await svc.capabilities()) as Capability[];
    expect(caps.find((c) => c.kind === "live")!.max_staleness_days).toBe(35);
    expect(caps.find((c) => c.kind === "hist")!.max_staleness_days).toBeNull();
  });

  it("a capabilities.yaml that does not parse is an error, not 'no freshness windows' (stale evidence would count as fresh)", async () => {
    const repo = paths.repo;
    const root = mkdtempSync(path.join(tmpdir(), "statreel-heatmap-"));
    try {
      Object.assign(paths, { repo: root });
      const svc = new HeatmapService(openDb(":memory:"), fakeWh(() => [cap("live", "2026-10-01T00:00:00")]), new Set());
      // no spec file at all: no windows, evidence is judged only at evaluation time
      expect((await svc.capabilities())[0]?.max_staleness_days).toBeNull();
      mkdirSync(path.join(root, "pipeline"));
      for (const bad of ["- sport: F1\n  checks: {max_staleness_days: 35\n", "sport: F1\n"]) {
        writeFileSync(path.join(root, "pipeline", "capabilities.yaml"), bad);
        await expect(svc.capabilities()).rejects.toThrow(/capabilities\.yaml/);
      }
    } finally {
      Object.assign(paths, { repo });
    }
  });
});
