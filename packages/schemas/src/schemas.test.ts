import { describe, expect, it } from "vitest";
import {
  ERA_TEXT_LIMITS,
  EraAdjustedPropsSchema,
  ProvenanceManifestSchema,
  type Script,
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

describe("EraAdjusted text caps (derived from the frame geometry)", () => {
  const L = ERA_TEXT_LIMITS;
  const messageAt = (props: unknown, path: string) =>
    EraAdjustedPropsSchema.safeParse(props).error?.issues.filter((i) => i.path.join(".") === path).map((i) => i.message).join("|") ?? "";
  const withRow0Name = (name: string) => ({ ...sampleEraProps, rows: sampleEraProps.rows.map((r, i) => (i === 0 ? { ...r, name } : r)) });

  it("the sample is inside every cap", () => {
    expect(EraAdjustedPropsSchema.safeParse(sampleEraProps).success).toBe(true);
  });
  it.each([
    ["metric_raw_label", L.metricLabelMaxChars],
    ["metric_adjusted_label", L.metricLabelMaxChars],
  ])("%s: %i characters fit, one more says how many", (key, n) => {
    expect(EraAdjustedPropsSchema.safeParse({ ...sampleEraProps, [key]: "m".repeat(n) }).success).toBe(true);
    expect(messageAt({ ...sampleEraProps, [key]: "m".repeat(n + 1) }, key)).toMatch(new RegExp(`shorten it - ${n} characters fit`));
  });
  it("row names", () => {
    expect(EraAdjustedPropsSchema.safeParse(withRow0Name("n".repeat(L.rowNameMaxChars))).success).toBe(true);
    expect(messageAt(withRow0Name("n".repeat(L.rowNameMaxChars + 1)), "rows.0.name")).toMatch(/shorten it - 32 characters fit/);
  });
  it("attribution: 27 in a vertical short, 76 in landscape", () => {
    expect(EraAdjustedPropsSchema.safeParse({ ...sampleEraProps, attribution: "a".repeat(27) }).success).toBe(true);
    expect(messageAt({ ...sampleEraProps, attribution: "a".repeat(28) }, "attribution")).toMatch(/shorten it - 27 characters fit/);
    const landscape = {
      ...sampleEraProps,
      format: "landscape" as const,
      scenes: sampleEraProps.scenes.filter((s) => s.kind !== "close"),
    };
    expect(EraAdjustedPropsSchema.safeParse({ ...landscape, attribution: "a".repeat(76) }).success).toBe(true);
    expect(messageAt({ ...landscape, attribution: "a".repeat(77) }, "attribution")).toMatch(/shorten it - 76 characters fit/);
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

  it("refuses a figure citing a fact that is not a number (text column, null, empty)", () => {
    const props = EraAdjustedPropsSchema.parse(sampleEraProps);
    const r0 = props.rows[0] as (typeof props.rows)[number];
    const known = new Map<string, number | string>();
    for (const r of props.rows) {
      known.set(r.raw_fact_key, r.raw_value);
      known.set(r.adjusted_fact_key, r.adjusted_value);
      known.set(r.raw_rank_fact_key, r.raw_rank);
      known.set(r.adjusted_rank_fact_key, r.adjusted_rank);
    }
    for (const bad of ["Juan Manuel Fangio", null, ""] as unknown as (number | string)[]) {
      const facts = new Map(known).set(r0.raw_fact_key, bad);
      expect(untracedFigures(props, facts), String(bad)).toEqual([`${r0.name}: ${r0.raw_value} cites ${r0.raw_fact_key}, which is not a number (${JSON.stringify(bad)})`]);
    }
    // a numeric string (a DECIMAL the driver hands back as text) is still a number
    expect(untracedFigures(props, new Map(known).set(r0.raw_fact_key, String(r0.raw_value)))).toEqual([]);
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
    const ok: Script = ScriptSchema.parse(structuredClone(sampleScript));
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
