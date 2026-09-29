import { describe, expect, it } from "vitest";
import {
  EraAdjustedPropsSchema,
  ProvenanceManifestSchema,
  ScriptSchema,
  sceneDisplayText,
  sceneSpokenText,
  untracedFigures,
  untracedScriptFigures,
} from "./index";
import { sampleEraProps, sampleManifest, sampleScript } from "./fixtures";

describe("EraAdjustedProps", () => {
  it("accepts the sample", () => {
    expect(EraAdjustedPropsSchema.parse(sampleEraProps).rows).toHaveLength(6);
  });

  it("requires a hook as the first scene and a close for vertical", () => {
    const bad = { ...sampleEraProps, scenes: sampleEraProps.scenes.slice(1) };
    expect(EraAdjustedPropsSchema.safeParse(bad).success).toBe(false);
    const noClose = { ...sampleEraProps, scenes: sampleEraProps.scenes.filter((s) => s.kind !== "close") };
    expect(EraAdjustedPropsSchema.safeParse(noClose).success).toBe(false);
  });

  it("rejects an end card in a vertical short", () => {
    const bad = { ...sampleEraProps, scenes: [...sampleEraProps.scenes, { id: "end", kind: "endcard", on_screen: "Follow" }] };
    expect(EraAdjustedPropsSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects 'did you know' as a hook shape", () => {
    expect(EraAdjustedPropsSchema.safeParse({ ...sampleEraProps, hook_shape: "did-you-know" }).success).toBe(false);
  });
});

describe("fact binding (ADR 003 #2)", () => {
  const facts = new Map<string, number | string>([
    ["f1db:driver:juan-manuel-fangio:era-adjusted#rank_raw", 43],
    ["f1db:driver:juan-manuel-fangio:era-adjusted#rank_adjusted", 1],
    ["f1db:driver:juan-manuel-fangio:era-adjusted#points_per_start_current_system", 17.118],
  ]);

  it("passes figures that match their fact", () => {
    const props = EraAdjustedPropsSchema.parse(sampleEraProps);
    const known = new Map(facts);
    for (const r of props.rows) {
      known.set(r.raw_fact_key, r.raw_value);
      known.set(r.adjusted_fact_key, r.adjusted_value);
      known.set(r.raw_rank_fact_key, r.raw_rank);
      known.set(r.adjusted_rank_fact_key, r.adjusted_rank);
    }
    expect(untracedFigures(props, known)).toEqual([]);
  });

  it("reports a figure with no fact and a figure that disagrees with its fact", () => {
    const props = EraAdjustedPropsSchema.parse(sampleEraProps);
    const problems = untracedFigures(props, new Map([[props.rows[0]!.raw_fact_key, 999]]));
    expect(problems.some((p) => p.includes("999"))).toBe(true);
    expect(problems.some((p) => p.includes("unknown fact"))).toBe(true);
  });
});

describe("script tokens (ADR 003 #7)", () => {
  it("aligns on spoken text and burns in display text", () => {
    const s = ScriptSchema.parse(sampleScript);
    const hook = s.scenes[0]!;
    expect(sceneSpokenText(hook)).toContain("twenty-four");
    expect(sceneDisplayText(hook)).toContain("24");
  });

  it("requires a fact_key on any token whose display shows a digit", () => {
    const s = ScriptSchema.parse(sampleScript);
    expect(untracedScriptFigures(s)).toEqual([]);
    const bad = structuredClone(sampleScript);
    bad.scenes[0]!.tokens.push({ display: "99", spoken: "ninety-nine" });
    expect(untracedScriptFigures(ScriptSchema.parse(bad))).toEqual(["hook: '99' has no fact_key"]);
  });

  it("allows a declared literal (a rule, not data)", () => {
    const ok = structuredClone(sampleScript);
    ok.scenes[0]!.tokens.push({ display: "25", spoken: "twenty-five", literal: "points for a win under the current system" });
    expect(untracedScriptFigures(ScriptSchema.parse(ok))).toEqual([]);
  });
});

describe("provenance manifest", () => {
  it("accepts the sample and records plan tier per audio asset", () => {
    const m = ProvenanceManifestSchema.parse(sampleManifest);
    expect(m.audio.every((a) => a.plan_tier)).toBe(true);
  });
});
