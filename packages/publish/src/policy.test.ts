/** Integration tests: run the real OPA binary against policy/publish.rego. */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProvenanceManifestSchema, PublishTargetSchema, sampleManifest } from "@statreel/schemas";
import { describe, expect, it } from "vitest";
import { defaultOpaBin, evaluatePolicy, opaArgs, PolicyEvaluationError, parseOpaOutput, repoRoot } from "./policy";

const target = PublishTargetSchema.parse({
  platform: "youtube",
  monetized: true,
  ai_disclosure: true,
  visibility: "private",
});
// The gate matches fonts against policy/fonts_allow.json (family + sha256), so the sample must carry a shipped font.
const shippedFont = (
  JSON.parse(readFileSync(join(repoRoot(), "fonts", "fonts.manifest.json"), "utf8")) as {
    fonts: { family: string; license: string; sha256: string }[];
  }
).fonts[0] as { family: string; license: string; sha256: string };
const realFontManifest = {
  ...sampleManifest,
  fonts: [{ family: shippedFont.family, license: shippedFont.license, sha256: shippedFont.sha256 }],
};
const manifest = ProvenanceManifestSchema.parse(realFontManifest);
const opaAvailable = process.env.OPA_BIN
  ? existsSync(process.env.OPA_BIN)
  : process.platform !== "win32" || existsSync(defaultOpaBin());

// A silent skip is how a gate rots: with OPA_REQUIRED=1 (CI / `just check`) a missing opa FAILS this suite.
describe("opa availability", () => {
  it("is present when OPA_REQUIRED=1", () => {
    if (process.env.OPA_REQUIRED === "1") expect(opaAvailable, "opa binary not found but OPA_REQUIRED=1").toBe(true);
  });
});

describe.skipIf(!opaAvailable)("evaluatePolicy (real opa)", () => {
  it("allows the sample manifest on a monetized private target", async () => {
    const r = await evaluatePolicy(manifest, target);
    expect(r.deny).toEqual([]);
    expect(r.allow).toBe(true);
    expect(r.warn).toEqual([]);
    expect([...r.checks_run].sort()).toEqual(regoRules().checksRun.sort());
  });

  it("denies a non-commercial source on a monetized channel (DESIGN §8 negative e2e)", async () => {
    const nc = structuredClone(manifest);
    nc.data.license_class = "non_commercial";
    nc.data.sources = [
      {
        id: "fbref",
        snapshot: "2026-09-29T00:00:00Z",
        license: "proprietary",
        license_class: "non_commercial",
        verdict: "non_commercial",
        attribution: "Data: FBref",
      },
    ];
    const r = await evaluatePolicy(nc, target);
    expect(r.allow).toBe(false);
    expect(r.deny).toContain("source fbref is non_commercial: not allowed on a monetized channel");
  });

  it("fails closed on a missing black_frames_s measurement (no schema default turns it into 0)", async () => {
    const m = structuredClone(realFontManifest) as Record<string, unknown>;
    delete (m.checks as Record<string, unknown>).black_frames_s;
    expect(ProvenanceManifestSchema.parse(m).checks.black_frames_s).toBeUndefined();
    const r = await evaluatePolicy(ProvenanceManifestSchema.parse(m), target);
    expect(r.allow).toBe(false);
    expect(r.deny).toContain("missing evidence: checks.black_frames_s");
  });

  it("denies a manifest whose font claims OFL but is not a shipped font", async () => {
    const lying = structuredClone(manifest);
    lying.fonts = [{ family: "Barlow Condensed", license: "OFL-1.1", sha256: "f".repeat(64) }];
    const r = await evaluatePolicy(lying, target);
    expect(r.allow).toBe(false);
    expect(r.deny.some((d) => d.includes("not in the shipped-font allow-list"))).toBe(true);
  });

  it("denies AI audio whose manifest says the disclosure is not on the frame", async () => {
    expect(manifest.audio.length).toBeGreaterThan(0);
    const m = structuredClone(manifest);
    m.disclosure.on_frame = false;
    const r = await evaluatePolicy(m, target);
    expect(r.allow).toBe(false);
    expect(r.deny).toContain("AI audio used but disclosure not placed on the frame");
  });

  it("denies a render that burned no captions", async () => {
    const m = structuredClone(manifest);
    m.captions.burned_in = false;
    const r = await evaluatePolicy(m, target);
    expect(r.allow).toBe(false);
    expect(r.deny).toContain("captions not burned in");
  });

  it("denies AI audio when the target carries no ai_disclosure", async () => {
    const r = await evaluatePolicy(manifest, { ...target, ai_disclosure: false });
    expect(r.deny).toContain("manifest declares AI audio but target.ai_disclosure is not set");
  });

  it("denies draft on YouTube (private only)", async () => {
    const r = await evaluatePolicy(manifest, { ...target, visibility: "draft" });
    expect(r.allow).toBe(false);
  });

  it("fails closed on missing evidence", async () => {
    const m = structuredClone(sampleManifest) as Record<string, unknown>;
    delete (m.checks as Record<string, unknown>).true_peak_dbtp;
    delete m.fonts;
    const r = await evaluatePolicy(m, target);
    expect(r.allow).toBe(false);
    expect(r.deny).toEqual(expect.arrayContaining(["missing evidence: checks.true_peak_dbtp", "no fonts recorded"]));
  });

  it("denies a public target and warns on a stripped attribution", async () => {
    const r = await evaluatePolicy(manifest, { ...target, visibility: "public", description: "no credits" });
    expect(r.allow).toBe(false);
    expect(r.deny.some((d) => d.startsWith("visibility public on youtube requires owner approval"))).toBe(true);
    expect(r.warn).toEqual(['description is missing attribution for source f1db: "Data: F1DB (CC BY 4.0)"']);
  });

  it("rejects when the opa binary is missing (never allows by accident)", async () => {
    await expect(evaluatePolicy(manifest, target, { opaBin: "definitely-not-opa-xyz" })).rejects.toBeInstanceOf(
      PolicyEvaluationError,
    );
  });

  it("rejects when the policy dir has no publish package", async () => {
    await expect(
      evaluatePolicy(manifest, target, { policyDir: dirname(fileURLToPath(import.meta.url)) }),
    ).rejects.toBeInstanceOf(PolicyEvaluationError);
  });
});

/**
 * checks_run is a hand-written list in publish.rego; the rule bodies are the ground truth. A deny/warn
 * head (comments stripped) is owned by the `# rule: <name>` annotation in the comment block directly
 * above it, or - for a second body of one rule - repeats the previous head line verbatim.
 */
function regoRules() {
  const src = readFileSync(join(repoRoot(), "policy", "publish.rego"), "utf8");
  const list = /^checks_run := \[([^\]]*)\]/m.exec(src)?.[1] ?? "";
  const checksRun = [...list.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1] as string);
  const annotations: string[] = [];
  const owners: string[] = [];
  let pending: string | null = null;
  let prevHead = "";
  for (const line of src.split(/\r?\n/)) {
    const ann = /^#\s*rule:\s*([a-z0-9_]+)\s*$/.exec(line);
    if (ann) {
      pending = ann[1] as string;
      annotations.push(pending);
      continue;
    }
    const code = line.replace(/#.*$/, "").trimEnd();
    if (!code) continue;
    if (/^(deny|warn) contains\b/.test(code)) {
      const owner = pending ?? (code === prevHead ? (owners.at(-1) ?? "<unannotated>") : "<unannotated>");
      owners.push(owner);
      prevHead = code;
    }
    pending = null;
  }
  const tests = readFileSync(join(repoRoot(), "policy", "publish_test.rego"), "utf8");
  const sections = [...tests.matchAll(/^# -{3,}\s+(?:warn:\s+)?([a-z0-9_]+)/gm)].map((m) => m[1] as string);
  return { checksRun, annotations, owners, sections };
}

describe("policy/publish.rego checks_run", () => {
  const { checksRun, annotations, owners, sections } = regoRules();

  it("lists every rule exactly once, and only rules that exist", () => {
    expect(checksRun.length).toBeGreaterThan(20);
    expect(new Set(checksRun).size).toBe(checksRun.length);
    expect(new Set(annotations).size).toBe(annotations.length);
    expect([...annotations].sort()).toEqual([...checksRun].sort());
  });

  it("every deny/warn head is annotated, and every annotated rule has a head", () => {
    expect(owners).not.toContain("<unannotated>");
    expect([...new Set(owners)].sort()).toEqual([...checksRun].sort());
  });

  it("every rule has its own section in publish_test.rego", () => {
    expect(checksRun.filter((r) => !sections.includes(r))).toEqual([]);
  });
});

describe("policy/fonts_allow.json", () => {
  it("matches fonts/fonts.manifest.json (OFL-1.1 entries, family + sha256)", () => {
    const root = repoRoot();
    const fm = JSON.parse(readFileSync(join(root, "fonts", "fonts.manifest.json"), "utf8")) as {
      fonts: { family: string; license: string; sha256: string }[];
    };
    const allow = JSON.parse(readFileSync(join(root, "policy", "fonts_allow.json"), "utf8")) as {
      statreel: { fonts_allow: { family: string; sha256: string }[] };
    };
    const key = (f: { family: string; sha256: string }) => `${f.family}|${f.sha256}`;
    const want = [...new Set(fm.fonts.filter((f) => f.license === "OFL-1.1").map(key))].sort();
    expect(allow.statreel.fonts_allow.map(key).sort()).toEqual(want);
  });
});

describe("opa plumbing", () => {
  it("builds argv with stdin input and ignores test files", () => {
    const args = opaArgs("/repo/policy");
    expect(args.slice(0, 7)).toEqual([
      "eval",
      "--format",
      "json",
      "--stdin-input",
      "--data",
      "/repo/policy",
      "--ignore",
    ]);
    expect(args).toContain("*_test.rego");
  });

  it("parses and sorts opa json output", () => {
    const out = JSON.stringify({
      result: [{ bindings: { result: { allow: false, deny: ["b", "a"], warn: [], checks_run: ["x"] } } }],
    });
    expect(parseOpaOutput(out)).toEqual({ allow: false, deny: ["a", "b"], warn: [], checks_run: ["x"] });
  });

  it("treats an undefined result as an error", () => {
    expect(() => parseOpaOutput("{}")).toThrow(PolicyEvaluationError);
  });
});
