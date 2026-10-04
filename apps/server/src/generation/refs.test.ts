import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GenerationError } from "./engine";
import { jobPaths } from "./paths";
import { REF_SUBJECTS, resolveRegistryRoot, stageRefs } from "./refs";

let root: string;
let repo: string;
let reg: string;
const put = (file: string, text: string) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "statreel-refs-"));
  repo = path.join(root, "repo");
  reg = path.join(root, "ai-registry");
  put(path.join(repo, ".ai", "manifest.yaml"), "registry:\n  remote: github:x/y\n  local: ../ai-registry\n");
  put(path.join(repo, "image-triage", "ART-DIRECTION.md"), "# art\n");
  put(path.join(repo, "packages", "design-tokens", "src", "logo.ts"), "export const x = 1;\n");
  put(path.join(repo, "fonts", "fonts.manifest.json"), "{}");
  const subjects: Record<string, { file: string }> = {};
  // nested at different depths: the index, not a slug, gives the address
  const where: Record<string, string> = {
    "data-video-virality": "narrative-craft/data-video-virality", "data-video-art-direction": "visual-generation/data-video-art-direction",
    "short-form-narrative-structure": "narrative-craft/sub/short-form-narrative-structure", "evidence-bound-visuals": "research-grounding/evidence-bound-visuals",
    "visual-style-locking": "visual-generation/visual-style-locking",
  };
  for (const [slug, dir] of Object.entries(where)) {
    const file = `knowledge/media-generation/${dir}/${slug}.md`;
    put(path.join(reg, file), `# ${slug}\n`);
    subjects[slug] = { file };
  }
  put(path.join(reg, "knowledge/media-generation/narrative-craft/data-video-virality/techniques/accelerator-events.md"), "# t\n");
  put(path.join(reg, "knowledge/media-generation/narrative-craft/data-video-virality/applications/process--x.md"), "# a\n");
  put(path.join(reg, "knowledge", "media-generation", "index.json"), JSON.stringify({ subjects }));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const stage = (extra: object = {}) => {
  const paths = jobPaths("gj-0123abcd", path.join(root, "data"));
  return { paths, manifest: stageRefs({ paths, repoRoot: repo, dataRoot: path.join(root, "data"), now: () => "T", ...extra }) };
};

describe("stageRefs", () => {
  it("resolves the registry through .ai/manifest.yaml and index.json and copies golden paths, techniques and applications", () => {
    expect(resolveRegistryRoot(repo)).toBe(reg);
    const { paths, manifest } = stage();
    const have = manifest.entries.map((e) => e.path);
    for (const [slug] of REF_SUBJECTS) expect(have).toContain(`${slug}/${slug}.md`);
    expect(have).toContain("data-video-virality/techniques/accelerator-events.md");
    expect(have).toContain("data-video-virality/applications/process--x.md");
    expect(have).toEqual(expect.arrayContaining(["ART-DIRECTION.md", "logo.ts", "fonts.manifest.json"]));
    expect(manifest.golden_paths).toContain("short-form-narrative-structure/short-form-narrative-structure.md");
    expect(manifest.pending.join(" ")).toMatch(/data-race-props/);
    const onDisk = JSON.parse(readFileSync(path.join(paths.refs, "MANIFEST.json"), "utf8"));
    expect(onDisk.entries).toHaveLength(manifest.entries.length);
  });

  it("MANIFEST sha256s match the staged files", () => {
    const { paths, manifest } = stage();
    for (const e of manifest.entries) {
      const h = createHash("sha256").update(readFileSync(path.join(paths.refs, e.path))).digest("hex");
      expect(e.sha256).toBe(h);
    }
  });

  it("a missing subject fails prepare with the validation kind and names the subject", () => {
    const idx = path.join(reg, "knowledge", "media-generation", "index.json");
    const j = JSON.parse(readFileSync(idx, "utf8"));
    delete j.subjects["evidence-bound-visuals"];
    writeFileSync(idx, JSON.stringify(j));
    try {
      stage();
      throw new Error("should have failed");
    } catch (e) {
      expect(e).toBeInstanceOf(GenerationError);
      expect((e as GenerationError).kind).toBe("validation");
      expect((e as Error).message).toMatch(/evidence-bound-visuals/);
    }
  });

  it("a missing golden path file, registry, ART-DIRECTION or fonts manifest fails", () => {
    rmSync(path.join(reg, "knowledge/media-generation/visual-generation/visual-style-locking/visual-style-locking.md"));
    expect(() => stage()).toThrow(/visual-style-locking/);
    rmSync(reg, { recursive: true, force: true });
    expect(() => stage()).toThrow(/registry not found/);
  });

  it("missing repo files fail", () => {
    rmSync(path.join(repo, "image-triage"), { recursive: true });
    expect(() => stage()).toThrow(/ART-DIRECTION/);
  });

  it("reuses ledgered logos and writes the props schema when given", () => {
    put(path.join(root, "data", "assets", "logos", "LEDGER.json"), JSON.stringify([{ file: "ferrari.svg" }]));
    put(path.join(root, "data", "assets", "logos", "ferrari.svg"), "<svg></svg>");
    const { manifest } = stage({ propsJsonSchema: () => ({ type: "object" }) });
    expect(manifest.entries.map((e) => e.path)).toEqual(expect.arrayContaining(["logos/LEDGER.json", "logos/ferrari.svg", "data-race-props.schema.json"]));
    expect(manifest.pending).toEqual([]);
  });

  it("stages each ledgered logo from its library_file, so two rows that shared a job file name stay distinct", () => {
    const logos = path.join(root, "data", "assets", "logos");
    put(path.join(logos, "LEDGER.json"), JSON.stringify([
      { file: "assets/logos/ferrari.png", library_file: "data/assets/logos/ferrari.png" },
      { file: "assets/logos/ferrari.png", library_file: "data/assets/logos/ferrari-0badc0de.png" },
    ]));
    put(path.join(logos, "ferrari.png"), "first");
    put(path.join(logos, "ferrari-0badc0de.png"), "second");
    const { paths, manifest } = stage();
    expect(manifest.entries.filter((e) => e.role === "logo").map((e) => e.path).sort()).toEqual(["logos/ferrari-0badc0de.png", "logos/ferrari.png"]);
    expect(readFileSync(path.join(paths.refs, "logos", "ferrari-0badc0de.png"), "utf8")).toBe("second");
  });
});
