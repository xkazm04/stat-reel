/** Where a generation job lives on disk (SPEC D.5). Every path is built from validated ids and confined. */
import path from "node:path";
import { BOARD_ITEM_ID_RE, CASE_ID_RE, GENERATION_JOB_ID_RE } from "@statreel/schemas";
import { paths } from "../config";

export const generationRoot = (dataRoot = paths.data) => path.join(dataRoot, "generation");

export type JobPaths = {
  /** data/generation/<id> */
  dir: string;
  /** cwd of the CLI: data/generation/<id>/work */
  work: string;
  refs: string;
  assets: string;
  out: string;
  prompt: string;
  runJsonl: string;
  runLog: string;
  stderrLog: string;
  caseJson: string;
  mcpJson: string;
};

/** Throws for any id that is not exactly what the server generated; paths must stay under data/generation/. */
export function jobPaths(jobId: string, dataRoot = paths.data): JobPaths {
  if (!GENERATION_JOB_ID_RE.test(jobId)) throw new Error(`invalid generation job id: ${jobId}`);
  const root = path.resolve(generationRoot(dataRoot));
  const dir = path.resolve(root, jobId);
  if (!dir.startsWith(root + path.sep)) throw new Error("job directory escapes data/generation");
  const work = path.join(dir, "work");
  return {
    dir, work, refs: path.join(work, "refs"), assets: path.join(work, "assets"), out: path.join(work, "out"),
    prompt: path.join(dir, "prompt.md"), runJsonl: path.join(dir, "run.jsonl"), runLog: path.join(dir, "run.log"),
    stderrLog: path.join(dir, "stderr.log"), caseJson: path.join(work, "case.json"), mcpJson: path.join(dir, "mcp.json"),
  };
}

export function assertIds(ids: { case_id: string; board_item_id?: string | null }): void {
  if (!CASE_ID_RE.test(ids.case_id)) throw new Error(`invalid case id: ${ids.case_id}`);
  if (ids.board_item_id && !BOARD_ITEM_ID_RE.test(ids.board_item_id)) throw new Error(`invalid board item id: ${ids.board_item_id}`);
}

/** `rel` (relative to a job's work directory) must resolve inside it. Returns the absolute path. */
export function insideWork(p: JobPaths, rel: string): string {
  const abs = path.resolve(p.work, rel);
  if (abs !== p.work && !abs.startsWith(p.work + path.sep)) throw new Error(`path leaves the job work directory: ${rel}`);
  return abs;
}

/** Stored paths are relative to data/ with forward slashes. */
export const relToData = (abs: string, dataRoot = paths.data) => path.relative(dataRoot, abs).split(path.sep).join("/");
