import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { desc } from "drizzle-orm";
import { parse } from "yaml";
import type { HeatmapCell, UseCase } from "@statreel/schemas";
import { type Db, heatmapSnapshots, now } from "./db";
import { paths } from "./config";
import { type Capability, computeHeatmap, evaluatedMs } from "./heatmap";
import { loadRegistry } from "./registry";
import type { Warehouse } from "./warehouse";

/** The pipeline's own freshness windows, keyed sport|kind|source - one number, read from where it is declared. */
function stalenessWindows(): Map<string, number> {
  const out = new Map<string, number>();
  try {
    const specs = (parse(readFileSync(path.join(paths.repo, "pipeline", "capabilities.yaml"), "utf8")) ?? []) as Array<{
      sport: string; kind: string; source_id: string; checks?: { max_staleness_days?: number };
    }>;
    for (const s of specs) if (typeof s.checks?.max_staleness_days === "number") out.set(`${s.sport}|${s.kind}|${s.source_id}`, s.checks.max_staleness_days);
  } catch { /* no spec file: no windows, evidence is judged only at evaluation time */ }
  return out;
}

const hashCells = (cells: HeatmapCell[]) => createHash("sha256").update(JSON.stringify(cells)).digest("hex");

export class HeatmapService {
  private cache?: HeatmapCell[];
  private cacheMs = 0;
  private registry = loadRegistry();

  constructor(private readonly db: Db, private readonly wh: Warehouse, private readonly implemented: Set<string>) {}

  usecases(): UseCase[] {
    return this.registry.usecases;
  }

  sources() {
    return this.registry.sources;
  }

  async capabilities(): Promise<Capability[]> {
    try {
      const windows = stalenessWindows();
      const rows = (await this.wh.rows("select * from meta.capabilities")) as unknown as Capability[];
      return rows.map((c) => ({ ...c, max_staleness_days: windows.get(`${c.sport}|${c.kind}|${c.source_id}`) ?? null }));
    } catch {
      return []; // no transform has run yet: every cell reports "not tested"
    }
  }

  /**
   * Cached cells, re-read when they can no longer be trusted: a capability was evaluated after the
   * cache was built, or the UTC day rolled over (staleness is a function of the clock).
   */
  async current(): Promise<HeatmapCell[]> {
    if (this.cache) {
      const caps = await this.capabilities();
      const newest = Math.max(0, ...caps.map((c) => evaluatedMs(c.evaluated_at) ?? 0));
      const sameDay = new Date(this.cacheMs).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
      if (newest <= this.cacheMs && sameDay) return this.cache;
    }
    return this.recompute();
  }

  /**
   * Recompute from the registry, tested capabilities and implemented compositions. A snapshot is
   * stored only when the cells differ from the latest one: no-op recomputes would otherwise crowd
   * real changes out of the 12-entry trend.
   */
  async recompute(): Promise<HeatmapCell[]> {
    this.registry = loadRegistry();
    const cells = computeHeatmap({ ...this.registry, capabilities: await this.capabilities(), implemented: this.implemented });
    const latest = this.db.select().from(heatmapSnapshots).orderBy(desc(heatmapSnapshots.at)).limit(1).get();
    if (!latest || hashCells(JSON.parse(latest.cells_json) as HeatmapCell[]) !== hashCells(cells)) {
      this.db.insert(heatmapSnapshots).values({ run_id: randomUUID(), at: now(), cells_json: JSON.stringify(cells) }).run();
    }
    this.cache = cells;
    this.cacheMs = Date.now();
    return cells;
  }

  /** Per use case x mode: how many sports were Go in each snapshot (oldest -> newest, last 12). */
  trend(): { at: string; go: Record<string, number> }[] {
    return this.db.select().from(heatmapSnapshots).orderBy(desc(heatmapSnapshots.at)).limit(12).all().reverse().map((s) => {
      const cells = JSON.parse(s.cells_json) as HeatmapCell[];
      const go: Record<string, number> = {};
      for (const c of cells) if (c.status === "go") go[`${c.usecase}|${c.mode}`] = (go[`${c.usecase}|${c.mode}`] ?? 0) + 1;
      return { at: s.at, go };
    });
  }
}
