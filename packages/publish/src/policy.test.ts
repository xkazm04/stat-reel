/** Integration tests: run the real OPA binary against policy/publish.rego. */
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ProvenanceManifestSchema, PublishTargetSchema, sampleManifest } from "@statreel/schemas";
import { describe, expect, it } from "vitest";
import { defaultOpaBin, evaluatePolicy, opaArgs, PolicyEvaluationError, parseOpaOutput } from "./policy";

const target = PublishTargetSchema.parse({
  platform: "youtube",
  monetized: true,
  ai_disclosure: true,
  visibility: "private",
});
const manifest = ProvenanceManifestSchema.parse(sampleManifest);
const opaAvailable = process.env.OPA_BIN
  ? existsSync(process.env.OPA_BIN)
  : process.platform !== "win32" || existsSync(defaultOpaBin());

describe.skipIf(!opaAvailable)("evaluatePolicy (real opa)", () => {
  it("allows the sample manifest on a monetized private target", async () => {
    const r = await evaluatePolicy(manifest, target);
    expect(r.deny).toEqual([]);
    expect(r.allow).toBe(true);
    expect(r.warn).toEqual([]);
    expect(r.checks_run).toContain("evidence_missing");
    expect(r.checks_run).toContain("source_not_legal_on_monetized");
    expect(r.checks_run.length).toBe(24);
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
    expect(r.deny).toContain("visibility public requires owner approval: v1 publishes private/draft only");
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
