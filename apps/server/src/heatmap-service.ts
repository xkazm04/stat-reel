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
  const file = path.join(paths.repo, "pipeline", "capabilities.yaml");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return out; // no spec file: no windows, evidence is judged only at evaluation time
    throw e;
  }
  // a spec that does not parse must not read as "no windows": every stale pass would count as fresh evidence
  let specs: unknown;
  try {
    specs = parse(text) ?? [];
  } catch (e) {
    throw new Error(`pipeline/capabilities.yaml does not parse: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(specs)) throw new Error("pipeline/capabilities.yaml must be a list of capability specs");
  for (const s of specs as Array<{ sport: string; kind: string; source_id: string; checks?: { max_staleness_days?: number } }>) {
    if (typeof s?.checks?.max_staleness_days === "number") out.set(`${s.sport}|${s.kind}|${s.source_id}`, s.checks.max_staleness_days);
  }
  return out;
}

/** DuckDB's message when meta.capabilities (or the meta schema) does not exist yet. */
const NO_CAPABILITIES_TABLE = /^Catalog Error: Table with name "?(meta\.)?capabilities"? does not exist/;

const hashCells =(cells: HeatmapCell[]) => createHash("sha256").update(JSON.stringify(cells)).digest("hex");

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
    let rows: Capability[];
    try {
      rows = (await this.wh.rows("select * from meta.capabilities")) as unknown as Capability[];
    } catch (e) {
      // no transform has run yet (the table or its schema is missing): every cell reports "not tested".
      // Any other failure is an error: read as "nothing tested" it would be snapshotted into the trend and cached.
      if (e instanceof Error && NO_CAPABILITIES_TABLE.test(e.message)) return [];
      throw e;
    }
    const windows = stalenessWindows();
    return rows.map((c) => ({ ...c, max_staleness_days: windows.get(`${c.sport}|${c.kind}|${c.source_id}`) ?? null }));
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
