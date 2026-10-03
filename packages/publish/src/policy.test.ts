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
    expect(r.checks_run).toContain("evidence_missing");
    expect(r.checks_run).toContain("source_not_legal_on_monetized");
    expect(r.checks_run.length).toBe(27);
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
