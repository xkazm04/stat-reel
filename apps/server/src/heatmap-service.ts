import { randomUUID } from "node:crypto";
import { desc } from "drizzle-orm";
import type { HeatmapCell, UseCase } from "@statreel/schemas";
import { type Db, heatmapSnapshots, now } from "./db";
import { type Capability, computeHeatmap } from "./heatmap";
import { loadRegistry } from "./registry";
import type { Warehouse } from "./warehouse";

export class HeatmapService {
  private cache?: HeatmapCell[];
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
      return (await this.wh.rows("select * from meta.capabilities")) as unknown as Capability[];
    } catch {
      return []; // no transform has run yet: every cell reports "not tested"
    }
  }

  async current(): Promise<HeatmapCell[]> {
    this.cache ??= await this.recompute();
    return this.cache;
  }

  /** Recompute from the registry, tested capabilities and implemented compositions; snapshot it. */
  async recompute(): Promise<HeatmapCell[]> {
    this.registry = loadRegistry();
    const cells = computeHeatmap({ ...this.registry, capabilities: await this.capabilities(), implemented: this.implemented });
    this.db.insert(heatmapSnapshots).values({ run_id: randomUUID(), at: now(), cells_json: JSON.stringify(cells) }).run();
    this.cache = cells;
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
