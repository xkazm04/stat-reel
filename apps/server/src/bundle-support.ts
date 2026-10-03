/**
 * Render-cache helpers (ADR 004): the Remotion bundle key (content hash of the bundled sources, computed
 * async and memoized behind a cheap stat signature so it is not re-read per worker call), garbage
 * collection of old bundles, and the "same props + same source + same format" render-reuse check.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/** Source packages that go into the Remotion bundle. */
export const BUNDLE_PACKAGES = ["compositions", "viz", "captions", "design-tokens", "schemas"];

export type SourceHasher = { hash(): Promise<string>; /** file reads performed so far (observability for tests) */ reads: number };

/**
 * Bundle cache key. Every call stats the tree (cheap); file contents are only read and hashed again
 * when the (path, mtime, size) signature changed, so a long-lived server picks up edits without
 * re-reading five packages twice per render.
 */
export function createSourceHasher(repoRoot: string, packages = BUNDLE_PACKAGES): SourceHasher {
  let cached: { sig: string; hash: string } | undefined;
  const self: SourceHasher = {
    reads: 0,
    async hash() {
      const files: string[] = [];
      const walk = async (dir: string) => {
        for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) await walk(p);
          else if (!/\.test\./.test(e.name)) files.push(p);
        }
      };
      for (const pkg of packages) {
        const src = path.join(repoRoot, "packages", pkg, "src");
        if (existsSync(src)) await walk(src);
      }
      const sig = createHash("sha1");
      for (const f of files) {
        const s = await stat(f);
        sig.update(`${f}|${s.mtimeMs}|${s.size}\n`);
      }
      const signature = sig.digest("hex");
      if (cached?.sig === signature) return cached.hash;
      const h = createHash("sha256");
      for (const f of files) {
        h.update(path.relative(repoRoot, f)).update(await readFile(f));
        self.reads++;
      }
      cached = { sig: signature, hash: h.digest("hex").slice(0, 16) };
      return cached.hash;
    },
  };
  return self;
}

/**
 * Keeps the `keep` newest bundle directories (by mtime) plus `current`; removes the rest.
 * Only directories are touched. Returns the removed paths.
 */
export async function gcBundles(bundleRoot: string, keep: number, current: string): Promise<string[]> {
  if (!existsSync(bundleRoot)) return [];
  const dirs = (await readdir(bundleRoot, { withFileTypes: true })).filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, mtime: statSync(path.join(bundleRoot, e.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  const kept = new Set([current, ...dirs.slice(0, keep).map((d) => d.name)]);
  const removed: string[] = [];
  for (const d of dirs) {
    if (kept.has(d.name)) continue;
    rmSync(path.join(bundleRoot, d.name), { recursive: true, force: true });
    removed.push(path.join(bundleRoot, d.name));
  }
  return removed;
}

export const propsSha256 = (props: unknown): string => createHash("sha256").update(JSON.stringify(props)).digest("hex");

const sha256Stream = (f: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(f).on("data", (d) => h.update(d)).on("error", reject).on("end", () => resolve(h.digest("hex")));
  });

export type ReusableManifest = { build: { props_sha256: string; source_sha256?: string | null }; subject: { sha256: string }; captions: { sidecar: string[] } };

/**
 * The previous render's manifest when it is the same work: identical props hash, source hash and format,
 * and its deliverables (video matching the manifest's sha256, captions, thumbnail) still on disk.
 * Otherwise null (a render from before source hashes were recorded never matches).
 */
export async function findReusableRender(prev: { format: string; path: string; manifest_path: string } | undefined,
  want: { propsSha: string; sourceHash: string; format: string }): Promise<ReusableManifest | null> {
  if (!prev || prev.format !== want.format || !existsSync(prev.path) || !existsSync(prev.manifest_path)) return null;
  let m: ReusableManifest;
  try {
    m = JSON.parse(readFileSync(prev.manifest_path, "utf8")) as ReusableManifest;
  } catch {
    return null;
  }
  if (m.build?.props_sha256 !== want.propsSha || m.build.source_sha256 !== want.sourceHash) return null;
  const dir = path.dirname(prev.path);
  for (const f of [...(m.captions?.sidecar ?? []), "thumb.png"]) if (!existsSync(path.join(dir, f))) return null;
  return (await sha256Stream(prev.path)) === m.subject?.sha256 ? m : null;
}
