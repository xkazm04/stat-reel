/**
 * The finalize validation (SPEC D.7), synchronous and render-free. The worker, `finalize` and the MCP tool
 * `validate_generation_output` all call exactly this, so what the session is told is what finalize enforces.
 *
 * - the contracted files exist and parse;
 * - every props file passes DataRacePropsSchema + checkGenerationRules against `out/timing-plan.json` and
 *   the asset ledger (`out/assets.json`);
 * - the data gate's provenance rule (D.6): a new-source or guessed case may only carry SAMPLE data (the
 *   composition burns the badge); a video needs real data;
 * - visual_options: three distinct looks, each with a style note of at most 80 words.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  type AssetLedgerRow,
  checkGenerationRules,
  formatViolations,
  type GenerationJobType,
  type TimingPlan,
  TimingPlanSchema,
} from "@statreel/schemas";
import { insideWork, type JobPaths } from "./paths";
import type { GenerationValidator, ValidationResult } from "./validator";

type Parsed = { ok: true; value: unknown } | { ok: false; error: string };
const readJson = (file: string): Parsed => {
  try {
    return { ok: true, value: JSON.parse(readFileSync(file, "utf8")) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

/** `data/` of a job's folder (data/generation/<id>): the generation root's parent. */
export const dataRootOf = (p: JobPaths): string => path.resolve(p.dir, "..", "..");

/**
 * Where a logo `path` of the props lives: under the job's `work/` (saved with fetch_asset) or in the shared
 * library `data/assets/logos/`. Anything else, or a path that escapes, resolves to null (= missing).
 */
export function resolveLogoPath(p: JobPaths, rel: string): string | null {
  const clean = rel.replace(/\\/g, "/");
  try {
    if (clean.startsWith("assets/")) return insideWork(p, clean);
    if (clean.startsWith("data/assets/logos/")) {
      const lib = path.join(dataRootOf(p), "assets", "logos");
      const abs = path.resolve(lib, clean.slice("data/assets/logos/".length));
      return abs.startsWith(lib + path.sep) ? abs : null;
    }
  } catch {
    return null;
  }
  return null;
}

const sha256Of = (file: string): string | null => {
  try {
    return createHash("sha256").update(readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
};

/** fetch_asset writes `file`, the rules want `path`; an empty author falls back to the Commons credit. */
export function ledgerRows(raw: unknown): AssetLedgerRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .map((r) => ({
      path: String(r.path ?? r.file ?? ""),
      url: String(r.url ?? ""),
      source_page: String(r.source_page ?? ""),
      licence: String(r.licence ?? ""),
      author: String(r.author ?? r.credit ?? ""),
      trademark: (r.trademark as boolean | string | undefined) ?? "",
      sha256: String(r.sha256 ?? ""),
    }));
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** First heading or line of `v{n}.md`: the style name. */
export function styleNameOf(md: string): string {
  const line = md.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  return line.replace(/^#+\s*/, "").replace(/^\*+|\*+$/g, "").replace(/^style\s*[:-]\s*/i, "").trim().slice(0, 60);
}

export const dataProvenanceOf = (props: unknown): "real" | "sample" | null => {
  const v = (props as { data_provenance?: unknown } | null)?.data_provenance;
  return v === "real" || v === "sample" ? v : null;
};

export function validateDataRaceOutputs(type: GenerationJobType, paths: JobPaths): ValidationResult {
  const errors: string[] = [];
  const outputs: string[] = [];
  const out = (rel: string) => path.join(paths.out, rel);
  const need = (rel: string): boolean => {
    if (!existsSync(out(rel))) {
      errors.push(`missing output: out/${rel}`);
      return false;
    }
    outputs.push(`out/${rel}`);
    return true;
  };

  // the timing plan comes first: every props file is checked against it
  let plan: TimingPlan | undefined;
  if (need("timing-plan.json")) {
    const r = readJson(out("timing-plan.json"));
    if (!r.ok) errors.push(`out/timing-plan.json is not valid JSON: ${r.error}`);
    else {
      const parsed = TimingPlanSchema.safeParse(r.value);
      if (!parsed.success) errors.push(`out/timing-plan.json: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      else plan = parsed.data;
    }
  } else errors.push("call compute_timing_plan first: it writes out/timing-plan.json");

  let ledger: AssetLedgerRow[] = [];
  if (need("assets.json")) {
    const r = readJson(out("assets.json"));
    if (!r.ok) errors.push(`out/assets.json is not valid JSON: ${r.error}`);
    else ledger = ledgerRows(r.value);
  }

  const caseJson = existsSync(paths.caseJson) ? readJson(paths.caseJson) : null;
  const dataStatus = caseJson?.ok ? String((caseJson.value as { data_status?: unknown }).data_status ?? "") : "";
  const synthetic = dataStatus === "new-source" || dataStatus === "guess";
  const ctx = {
    ledger,
    fileSha256: (rel: string) => {
      const abs = resolveLogoPath(paths, rel);
      return abs ? sha256Of(abs) : null;
    },
  };

  const checkProps = (rel: string, wantReal = false): unknown => {
    if (!need(rel)) return undefined;
    const r = readJson(out(rel));
    if (!r.ok) {
      errors.push(`out/${rel} is not valid JSON: ${r.error}`);
      return undefined;
    }
    const res = checkGenerationRules(r.value, plan, ctx);
    for (const line of formatViolations(res.violations)) errors.push(`out/${rel}: ${line}`);
    const prov = dataProvenanceOf(r.value);
    if (wantReal && prov !== "real")
      errors.push(`out/${rel}: a video needs data_provenance "real" (values through mcp__statreel__query with fact refs); sample data is for design previews only`);
    if (type === "visual_options" && synthetic && prov !== "sample")
      errors.push(`out/${rel}: this case's data is ${dataStatus} (not staged): set data_provenance "sample" so the preview is labelled SAMPLE DATA`);
    return r.value;
  };

  if (type === "visual_options") {
    const palettes: string[] = [];
    for (const n of [1, 2, 3]) {
      const props = checkProps(`variants/v${n}.props.json`) as { entities?: { color?: string }[] } | undefined;
      if (props) palettes.push((props.entities ?? []).map((e) => String(e.color ?? "").toLowerCase()).join("|"));
      if (need(`variants/v${n}.md`)) {
        const md = readFileSync(out(`variants/v${n}.md`), "utf8");
        if (!styleNameOf(md)) errors.push(`out/variants/v${n}.md: start with the style name on the first line`);
        if (wordCount(md) > 80) errors.push(`out/variants/v${n}.md: ${wordCount(md)} words; style name and rationale are at most 80 words`);
      }
    }
    if (palettes.length === 3 && new Set(palettes).size < 3) errors.push("the three variants must be three distinct looks: two of them use the same entity colours");
  } else {
    checkProps("props.json", true);
  }

  if (existsSync(paths.assets)) {
    for (const f of readdirSync(paths.assets, { recursive: true, withFileTypes: true })) {
      if (f.isFile()) outputs.push(`assets/${path.relative(paths.assets, path.join(f.parentPath, f.name)).split(path.sep).join("/")}`);
    }
  }
  return { ok: errors.length === 0, errors, outputs };
}

export const dataRaceValidator: GenerationValidator = {
  async validate({ type, paths }) {
    return validateDataRaceOutputs(type, paths);
  },
};

/** The plan and props of a validated job, for the render and finalize steps. */
export function readPlan(paths: JobPaths): TimingPlan {
  return TimingPlanSchema.parse(JSON.parse(readFileSync(path.join(paths.out, "timing-plan.json"), "utf8")));
}
