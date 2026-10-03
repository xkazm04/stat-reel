/**
 * Finalize of a running generation job (SPEC D.7, D.10): all domain writes stay in the server. The worker
 * has validated the outputs and requested the renders; this re-validates (the same function), copies the
 * rendered files into their homes and writes the rows. Idempotent: a finalize retried after a crash
 * creates no duplicates.
 *
 *   visual_options  3 stills -> data/board/items/gen/<case_id>/<job_id>-v{n}.png, 3 board items
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { GenerationJob } from "@statreel/schemas";
import type { BoardService } from "../board";
import type { Db } from "../db";
import { jobPaths, type JobPaths } from "./paths";
import { dataProvenanceOf, styleNameOf, validateDataRaceOutputs } from "./validate-data-race";

export class FinalizeError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
    this.name = "FinalizeError";
  }
}

export type FinalizeBody = { outputs: string[]; result?: Record<string, unknown> };
export type FinalizerDeps = { db: Db; board: BoardService; dataRoot: string; boardRoot: string };

/** A render result path must be a file inside the job's own folder (the body comes over HTTP). */
export function insideJob(p: JobPaths, file: unknown, what: string): string {
  if (typeof file !== "string" || !file) throw new FinalizeError(`${what}: no file given`);
  const abs = path.resolve(file);
  if (!abs.startsWith(p.dir + path.sep)) throw new FinalizeError(`${what} is outside the job folder`);
  if (!existsSync(abs)) throw new FinalizeError(`${what} does not exist`);
  return abs;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const isPng = (f: string) => readFileSync(f).subarray(0, 4).equals(PNG);

export class GenerationFinalizer {
  constructor(protected readonly d: FinalizerDeps) {}

  async finalize(job: GenerationJob, body: FinalizeBody): Promise<Record<string, unknown>> {
    const p = jobPaths(job.id, this.d.dataRoot);
    const v = validateDataRaceOutputs(job.type, p);
    if (!v.ok) throw new FinalizeError(`validation failed: ${v.errors.slice(0, 5).join("; ")}`);
    this.promoteLogos(p);
    if (job.type === "visual_options") return this.visualOptions(job, p, body);
    throw new FinalizeError(`finalize for ${job.type} is not available`, 501);
  }

  /**
   * Logos fetched and verified against the Commons API join the shared library (data/assets/logos/ + LEDGER.json,
   * deduped by sha256) so later jobs reuse them. Model-declared rows are not promoted: they wait for owner review.
   */
  private promoteLogos(p: JobPaths): void {
    const ledgerFile = path.join(p.dir, "fetched-assets.json");
    if (!existsSync(ledgerFile)) return;
    let rows: { file: string; sha256: string; verified_by: string }[] = [];
    try { rows = JSON.parse(readFileSync(ledgerFile, "utf8")); } catch { return; }
    const lib = path.join(this.d.dataRoot, "assets", "logos");
    const libFile = path.join(lib, "LEDGER.json");
    let merged: { sha256: string }[] = [];
    try { merged = JSON.parse(readFileSync(libFile, "utf8")); } catch { /* first logo */ }
    let changed = false;
    for (const r of rows) {
      if (r.verified_by !== "commons-api" || merged.some((m) => m.sha256 === r.sha256)) continue;
      const src = path.resolve(p.work, r.file);
      if (!src.startsWith(p.work + path.sep) || !existsSync(src)) continue;
      mkdirSync(lib, { recursive: true });
      copyFileSync(src, path.join(lib, path.basename(src)));
      merged.push({ ...r, library_file: `data/assets/logos/${path.basename(src)}` } as never);
      changed = true;
    }
    if (changed) writeFileSync(libFile, `${JSON.stringify(merged, null, 2)}
`);
  }

  private visualOptions(job: GenerationJob, p: JobPaths, body: FinalizeBody): Record<string, unknown> {
    const idea = this.d.db.$client.prepare("select title, pitch from case_ideas where id = ?").get(job.case_id) as { title: string; pitch: string } | undefined;
    if (!idea) throw new FinalizeError(`case ${job.case_id} no longer exists`, 404);
    const stills = ((body.result?.renders as { stills?: Record<string, string> } | undefined)?.stills) ?? {};
    const params = JSON.parse(job.params_json || "{}") as { model?: string; engine?: string };
    const cost = typeof body.result?.cost_usd === "number" ? body.result.cost_usd : null;
    const existing = new Map<number, string>();
    for (const i of this.d.board.list({ status: "all" })) {
      if (i.case_idea_id === job.case_id && i.source?.job_id === job.id) existing.set(Number(i.source.variant), i.id);
    }
    const ids: string[] = [];
    const tx = this.d.db.$client.transaction(() => {
      for (const n of [1, 2, 3]) {
        const have = existing.get(n);
        if (have) {
          ids.push(have);
          continue;
        }
        const still = insideJob(p, stills[String(n)], `the still of variant ${n}`);
        if (!isPng(still)) throw new FinalizeError(`the still of variant ${n} is not a PNG`);
        const rel = `items/gen/${job.case_id}/${job.id}-v${n}.png`;
        const dest = path.join(this.d.boardRoot, rel);
        mkdirSync(path.dirname(dest), { recursive: true });
        copyFileSync(still, dest);
        const props = JSON.parse(readFileSync(path.join(p.out, "variants", `v${n}.props.json`), "utf8"));
        const md = readFileSync(path.join(p.out, "variants", `v${n}.md`), "utf8");
        const item = this.d.board.create({
          image: rel, width: 1080, height: 1920, title: idea.title, summary: md.trim(),
          proposed_case: { name: idea.title, pitch: idea.pitch }, case_idea_id: job.case_id,
          style: { id: `gen-${job.id}-v${n}`, name: styleNameOf(md) },
          source: { skill: "generation", job_id: job.id, model: params.model ?? null, engine: params.engine ?? null, variant: n, data_provenance: dataProvenanceOf(props), cost_usd: cost },
        });
        ids.push(item.id);
      }
    });
    tx();
    return { board_item_ids: ids };
  }
}
