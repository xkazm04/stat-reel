/**
 * The data gate of `generate_video` (SPEC D.6, the ethics layer of CLAUDE.md). A video is enqueued only
 * when all three hold:
 *   1. the case's `data_status` is `staged` or `registry`;
 *   2. every source the case relies on is in `data/registry/sources.yaml` with a verdict other than `avoid`;
 *   3. the accepted visual's props carry `data_provenance: "real"`.
 * `visual_options` is always allowed (it falls back to labelled SAMPLE DATA). The gate only reads: it never
 * adds a source and never touches the network.
 */
import { readFileSync } from "node:fs";
import { type Source, SourceSchema } from "@statreel/schemas";
import { parse } from "yaml";
import { paths } from "../config";
import type { Db } from "../db";
import type { GateVerdict } from "./flow";

export type GateRequest = { type: "visual_options" | "generate_video"; case_id: string; board_item_id?: string | null };

export function loadSources(file = paths.registry): Source[] {
  return (parse(readFileSync(file, "utf8")) as unknown[]).map((s) => SourceSchema.parse(s));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const hostOf = (u: string | undefined | null): string | null => {
  try { return u ? new URL(u).hostname.replace(/^www\./, "").toLowerCase() : null; } catch { return null; }
};

type CaseSourceRef = { name?: string; url?: string; registry_id?: string | null };

/** The registry entry a case source stands for: its registry_id, else its name, else its host. */
export function matchSource(ref: CaseSourceRef, sources: readonly Source[]): Source | undefined {
  if (ref.registry_id) return sources.find((s) => s.id === ref.registry_id);
  const name = norm(ref.name ?? "");
  const host = hostOf(ref.url);
  return sources.find(
    (s) => (name && (norm(s.id) === name || norm(s.url) === name)) || (host && ([hostOf(s.url), ...s.hosts.map((h) => h.toLowerCase().replace(/^www\./, ""))].includes(host))),
  );
}

export function evaluateGate(db: Db, req: GateRequest, sources: readonly Source[] = loadSources()): GateVerdict {
  if (req.type === "visual_options") return { ok: true };
  const c = db.$client;
  const idea = c.prepare("select title, data_status, sources_json from case_ideas where id = ?").get(req.case_id) as { title: string; data_status: string; sources_json: string } | undefined;
  if (!idea) return { ok: false, reason: `unknown case ${req.case_id}` };
  const who = `${idea.title}: `;

  if (idea.data_status !== "staged" && idea.data_status !== "registry") {
    return {
      ok: false,
      reason: `${who}its data is ${idea.data_status === "guess" ? "a guess, not verified" : "a new source"} (not staged or in the registry); approve the source in data/registry/sources.yaml and ingest it through statreel_ingest first.`,
    };
  }

  let refs: CaseSourceRef[] = [];
  try { refs = JSON.parse(idea.sources_json) as CaseSourceRef[]; } catch { /* handled below */ }
  if (!refs.length) return { ok: false, reason: `${who}the case names no data source; add one that is in the registry.` };
  for (const ref of refs) {
    const hit = matchSource(ref, sources);
    const label = ref.name ?? ref.registry_id ?? ref.url ?? "?";
    if (!hit) return { ok: false, reason: `${who}source '${label}' is not in the registry; approve it and ingest it through statreel_ingest first.` };
    if (hit.verdict === "avoid") return { ok: false, reason: `${who}source '${label}' (${hit.id}) has verdict avoid in the registry and cannot be used.` };
  }

  if (!req.board_item_id) return { ok: false, reason: `${who}a video is generated from an accepted visual; accept one of the designs first.` };
  const item = c.prepare("select status, case_idea_id, source_json from board_items where id = ?").get(req.board_item_id) as { status: string; case_idea_id: string | null; source_json: string | null } | undefined;
  if (!item || item.case_idea_id !== req.case_id) return { ok: false, reason: `${who}that design does not belong to this case.` };
  if (item.status !== "accepted") return { ok: false, reason: `${who}the design is not accepted yet.` };
  let prov: unknown = null;
  try { prov = (JSON.parse(item.source_json ?? "null") as { data_provenance?: unknown } | null)?.data_provenance; } catch { /* null */ }
  if (prov !== "real") {
    return { ok: false, reason: `${who}the accepted design was made with ${prov === "sample" ? "sample data" : "no recorded data provenance"}; a video needs real data. Generate visuals again once the data is staged.` };
  }
  return { ok: true };
}

/** The gate the server wires into the routes and the flow. */
export const makeGate = (db: Db, sources?: () => readonly Source[]) => (req: GateRequest): GateVerdict => {
  try {
    return evaluateGate(db, req, sources?.());
  } catch (e) {
    // the ethics layer fails closed
    return { ok: false, reason: `the source registry could not be read (${e instanceof Error ? e.message : String(e)}); no video job is created.` };
  }
};
