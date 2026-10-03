/**
 * Reference staging (SPEC D.5): the rules a generation session must read are copied into
 * `work/refs/`, resolved through the registry index (never a hand-built path), and listed with their
 * sha256 in `refs/MANIFEST.json`. If the registry or a subject is missing the job fails in prepare:
 * a session never runs without its rules. The cwd confinement (`--restricted`) is why the files are
 * copied rather than read in place (no `--add-dir`).
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { GenerationError } from "./engine";
import type { JobPaths } from "./paths";

/** [slug, also copy techniques/ and applications/ siblings] */
export const REF_SUBJECTS: readonly (readonly [string, boolean])[] = [
  ["data-video-virality", true],
  ["data-video-art-direction", true],
  ["short-form-narrative-structure", false],
  ["evidence-bound-visuals", false],
  ["visual-style-locking", false],
];
const DOMAIN = "media-generation";

export type RefEntry = { path: string; role: string; source: string; sha256: string; bytes: number };
export type RefsManifest = { staged_at: string; registry: string; entries: RefEntry[]; golden_paths: string[]; pending: string[] };

const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const fail = (msg: string): never => {
  throw new GenerationError("validation", msg);
};

/** `.ai/manifest.yaml` -> registry.local, relative to the repo. */
export function resolveRegistryRoot(repoRoot: string): string {
  const manifest = path.join(repoRoot, ".ai", "manifest.yaml");
  if (!existsSync(manifest)) return fail(`cannot stage references: ${manifest} not found`);
  const local = (parseYaml(readFileSync(manifest, "utf8")) as { registry?: { local?: string } })?.registry?.local;
  if (!local) return fail(`cannot stage references: ${manifest} has no registry.local`);
  const root = path.resolve(repoRoot, local);
  if (!existsSync(root)) return fail(`cannot stage references: registry not found at ${root}`);
  return root;
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.join(e.parentPath, e.name));
}

export type StageRefsOptions = {
  paths: JobPaths;
  repoRoot: string;
  /** `data/` (for the reusable logo ledger) */
  dataRoot: string;
  registryRoot?: string;
  subjects?: readonly (readonly [string, boolean])[];
  /** JSON Schema of DataRaceProps once T9 provides it */
  propsJsonSchema?: () => unknown;
  now?: () => string;
};

export function stageRefs(o: StageRefsOptions): RefsManifest {
  const registry = o.registryRoot ?? resolveRegistryRoot(o.repoRoot);
  const indexFile = path.join(registry, "knowledge", DOMAIN, "index.json");
  if (!existsSync(indexFile)) return fail(`cannot stage references: ${indexFile} not found`);
  const index = JSON.parse(readFileSync(indexFile, "utf8")) as { subjects?: Record<string, { file?: string }> };
  const entries: RefEntry[] = [];
  const golden: string[] = [];
  mkdirSync(o.paths.refs, { recursive: true });
  const add = (from: string, rel: string, role: string, source: string) => {
    const dest = path.join(o.paths.refs, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(from, dest);
    entries.push({ path: rel.split(path.sep).join("/"), role, source, sha256: sha(dest), bytes: statSync(dest).size });
  };

  for (const [slug, withSiblings] of o.subjects ?? REF_SUBJECTS) {
    const rel = index.subjects?.[slug]?.file;
    if (!rel) return fail(`cannot stage references: subject "${slug}" is not in ${indexFile}`);
    const golden_abs = path.resolve(registry, rel);
    if (!golden_abs.startsWith(registry + path.sep)) return fail(`subject "${slug}" resolves outside the registry`);
    if (!existsSync(golden_abs)) return fail(`cannot stage references: ${golden_abs} (subject "${slug}") is missing`);
    const base = path.join(slug, path.basename(golden_abs));
    add(golden_abs, base, "golden-path", `registry:${DOMAIN}/${slug}`);
    golden.push(base.split(path.sep).join("/"));
    if (withSiblings) {
      const dir = path.dirname(golden_abs);
      for (const sub of ["techniques", "applications"]) {
        const d = path.join(dir, sub);
        if (!existsSync(d)) continue;
        for (const f of listFiles(d)) add(f, path.join(slug, sub, path.relative(d, f)), sub === "techniques" ? "technique" : "application", `registry:${DOMAIN}/${slug}`);
      }
    }
  }

  const art = path.join(o.repoRoot, "image-triage", "ART-DIRECTION.md");
  if (!existsSync(art)) return fail(`cannot stage references: ${art} is missing`);
  add(art, "ART-DIRECTION.md", "art-direction", "repo:image-triage/ART-DIRECTION.md");
  golden.push("ART-DIRECTION.md");
  const logo = path.join(o.repoRoot, "packages", "design-tokens", "src", "logo.ts");
  if (!existsSync(logo)) return fail(`cannot stage references: ${logo} is missing`);
  add(logo, "logo.ts", "brand-geometry", "repo:packages/design-tokens/src/logo.ts");
  const fonts = path.join(o.repoRoot, "fonts", "fonts.manifest.json");
  if (!existsSync(fonts)) return fail(`cannot stage references: ${fonts} is missing`);
  add(fonts, "fonts.manifest.json", "fonts", "repo:fonts/fonts.manifest.json");

  const pending: string[] = [];
  if (o.propsJsonSchema) {
    const f = path.join(o.paths.refs, "data-race-props.schema.json");
    writeFileSync(f, JSON.stringify(o.propsJsonSchema(), null, 2));
    entries.push({ path: "data-race-props.schema.json", role: "schema", source: "generated:DataRacePropsSchema", sha256: sha(f), bytes: statSync(f).size });
  } else pending.push("data-race-props.schema.json (DataRaceProps lands with T9; the session gets it from get_generation_context)");

  // logos already in the ledger can be reused instead of fetched again
  const ledger = path.join(o.dataRoot, "assets", "logos", "LEDGER.json");
  if (existsSync(ledger)) {
    add(ledger, path.join("logos", "LEDGER.json"), "logo-ledger", "data:assets/logos/LEDGER.json");
    const rows = JSON.parse(readFileSync(ledger, "utf8")) as { file?: string }[];
    for (const r of Array.isArray(rows) ? rows : []) {
      const f = r.file ? path.resolve(o.dataRoot, "assets", "logos", path.basename(r.file)) : "";
      if (f && existsSync(f)) add(f, path.join("logos", path.basename(f)), "logo", "data:assets/logos");
    }
  }

  const manifest: RefsManifest = { staged_at: (o.now ?? (() => new Date().toISOString()))(), registry, entries, golden_paths: golden, pending };
  writeFileSync(path.join(o.paths.refs, "MANIFEST.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}
