import { describe, expect, it } from "vitest";
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

  it("serves capabilities with the pipeline's staleness window attached (live only)", async () => {
    const svc = new HeatmapService(openDb(":memory:"), fakeWh(() => [cap("live", "2026-10-01T00:00:00"), cap("hist", "2026-10-01T00:00:00")]), new Set());
    const caps = (await svc.capabilities()) as Capability[];
    expect(caps.find((c) => c.kind === "live")!.max_staleness_days).toBe(35);
    expect(caps.find((c) => c.kind === "hist")!.max_staleness_days).toBeNull();
  });
});
