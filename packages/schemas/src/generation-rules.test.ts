import { describe, expect, it } from "vitest";
import {
  DATA_RACE_LIMITS,
  DataRacePropsSchema,
  type DataRacePropsInput,
  dataRacePropsJsonSchema,
  eventSide,
  resolveDataRaceRenderProps,
} from "./data-race";
import { type AssetLedgerRow, checkGenerationRules, containsTerm, formatViolations } from "./generation-rules";
import { canonicalJson, sha256Hex } from "./sha256";
import { type TimingPlan, TimingPlanSchema, planSha256 } from "./timing-plan";

const NAMES = ["Alder", "Birch", "Cedar", "Dogwood", "Elm", "Fir", "Ginkgo", "Hazel", "Ivy", "Juniper"];
const COLORS = ["#4285f4", "#ea4335", "#fbbc05", "#34a853", "#8e44ad", "#16a085", "#d35400", "#2c3e50", "#7f8c8d", "#e84393"];
const P = 12;

/** A tiny hand-built plan (the real one comes from computeTimingPlan in @statreel/compositions). */
function makePlan(): TimingPlan {
  const ids = NAMES.map((n) => n.toLowerCase());
  const knots: [number, number][] = Array.from({ length: P }, (_, i) => [60 + i * 80, i]);
  const orders = Array.from({ length: P }, (_, i) => (i === P - 1 ? ['juniper', ...ids.slice(0, 9)] : ids));
  return {
    version: 1,
    fps: 30,
    sections: { hook_end: 60, timeline_end: 1000, spotlight_end: 1060, like_end: 1120, total: 1210 },
    strategy: {
      unit: "year",
      order: "raw",
      order_label: null,
      rank_smooth: 0,
      hysteresis: null,
      top_n: 10,
      axis_max: 100,
      min_frames: 1,
      max_frames: 10,
      sigma: 1.5,
      weights: { rank: 1, value: 1, base: 0.1, entry: 1.5 },
    },
    periods: Array.from({ length: P }, (_, i) => String(2010 + i)),
    entities: ids,
    knots,
    orders,
    events: [
      { id: "launch", period: 3, label: "Launch", dwell: 40, frame: 300 },
      { id: "merger", period: 6, label: "Merger", dwell: 40, frame: 540 },
      { id: "crash", period: 9, label: "Crash", dwell: 40, frame: 780 },
    ],
    frames_per_period: Array.from({ length: P }, () => 80),
    detail: Array.from({ length: P }, (_, i) => ({ period: String(2010 + i), rank: 0, value: 0, entries: 0 })),
    per_group: [],
    evenness: { cv_uniform: 0, cv_warped_ex_dwell: 0, cv_warped_incl_dwell: 0 },
  };
}

const sha = (s: string) => sha256Hex(s);
function makeLedger(): AssetLedgerRow[] {
  return [
    {
      path: "work/assets/logos/alder.svg",
      url: "https://commons.example/alder.svg",
      source_page: "https://commons.example/File:Alder.svg",
      licence: "CC0-1.0",
      author: "Example",
      trademark: true,
      sha256: sha("alder-file"),
    },
  ];
}

function makeProps(plan: TimingPlan): DataRacePropsInput {
  return {
    data_provenance: "sample",
    title: "Which tree grows fastest in the park?",
    hook: "Which tree will end up on top?",
    unit_label: "Trees per hectare",
    source_line: "Sample data, invented for the design preview",
    periods: plan.periods,
    entities: NAMES.map((n, i) => ({
      id: n.toLowerCase(),
      name: n,
      aliases: [],
      color: COLORS[i] as string,
      logo: i === 0 ? { kind: "file", path: "work/assets/logos/alder.svg" } : { kind: "wordmark" },
      // Juniper ends first
      values: Array.from({ length: P }, (_, t) => 10 + i + (i === 9 ? t * 5 : t)),
      value_ref: `sample:tree:${n.toLowerCase()}#density`,
    })),
    missing_logos: NAMES.slice(1).map((n) => n.toLowerCase()),
    events: [
      { id: "launch", title: "A new nursery opens", date_label: "2013", facts: [{ text: "40 saplings planted", ref: "sample:event:launch#count" }], start_frame: 300 },
      { id: "merger", title: "Two parks merge", date_label: "2016", facts: [{ text: "Area doubles", ref: "sample:event:merger#area" }], start_frame: 540, life_frames: 120 },
      { id: "crash", title: "A storm hits", date_label: "2019", facts: [{ text: "12 trees lost", ref: "sample:event:crash#count" }], start_frame: 780 },
    ],
    spotlight: { facts: [{ label: "Density", value_text: "65 / ha", ref: "sample:tree:juniper#density" }] },
    timing_plan_sha256: planSha256(plan),
  };
}

const set = (p: Record<string, unknown>, k: string, v: unknown): undefined => {
  p[k] = v;
  return undefined;
};
const ev = (p: Record<string, unknown>, i: number): Record<string, unknown> =>
  (p.events as Record<string, unknown>[])[i] as Record<string, unknown>;

const run = (mutate?: (p: Record<string, unknown>, plan: TimingPlan) => TimingPlan | undefined) => {
  let plan = makePlan();
  const props = JSON.parse(JSON.stringify(makeProps(plan))) as Record<string, unknown>;
  const replaced = mutate?.(props, plan);
  if (replaced) plan = replaced;
  return checkGenerationRules(props, plan, { ledger: makeLedger() });
};
const rules = (r: ReturnType<typeof run>) => [...new Set(r.violations.map((v) => v.rule))];
const codes = (r: ReturnType<typeof run>) => r.violations.map((v) => v.code);

describe("fixture sanity", () => {
  it("the base props pass every rule and the schema", () => {
    const r = run();
    expect(formatViolations(r.violations)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(TimingPlanSchema.safeParse(makePlan()).success).toBe(true);
    expect(DataRacePropsSchema.safeParse(makeProps(makePlan())).success).toBe(true);
  });
});

describe("rule 1: side reveals only", () => {
  it("accepts props without any transition vocabulary; the side comes from the index", () => {
    expect(rules(run())).toEqual([]);
    expect([0, 1, 2, 3].map(eventSide)).toEqual(["left", "right", "left", "right"]);
  });
  it.each(["transition", "enter", "exit", "enter_transition"])("rejects a '%s' key on an event", (key) => {
    const r = run((p) => {
      ((p.events as Record<string, unknown>[])[0] as Record<string, unknown>)[key] = "flash";
      return undefined;
    });
    expect(codes(r)).toContain("transition-key");
    expect(rules(r)).toContain(1);
  });
  it("rejects a top-level transition key", () => {
    expect(codes(run((p) => set(p, "transition", "wipe")))).toContain("transition-key");
  });
});

describe("rule 2: timing plan first", () => {
  it("accepts a matching sha and plan-derived start frames", () => {
    expect(rules(run())).toEqual([]);
  });
  it("rejects a sha mismatch", () => {
    const r = run((p) => set(p, "timing_plan_sha256", "0".repeat(64)));
    expect(codes(r)).toContain("sha-mismatch");
  });
  it("rejects a changed plan (sha no longer matches)", () => {
    const r = run((_p, plan) => ({ ...plan, events: plan.events.map((e) => ({ ...e, frame: e.frame + 1 })) }));
    expect(codes(r)).toContain("sha-mismatch");
  });
  it("rejects a start_frame that is not the plan's", () => {
    const r2 = run((p) => {
      ((p.events as Record<string, unknown>[])[1] as Record<string, unknown>).start_frame = 541;
      return undefined;
    });
    expect(codes(r2)).toContain("start-frame");
  });
  it("rejects non-monotone knots", () => {
    const r = run((p, plan) => {
      const bad = { ...plan, knots: plan.knots.map((k, i) => (i === 5 ? ([plan.knots[4]?.[0] ?? 0, 5] as [number, number]) : k)) };
      p.timing_plan_sha256 = planSha256(bad);
      return bad;
    });
    expect(codes(r)).toContain("knots-not-monotone");
  });
  it("rejects an event the plan does not know", () => {
    const r = run((p) => {
      ((p.events as Record<string, unknown>[])[0] as Record<string, unknown>).id = "ghost";
      return undefined;
    });
    expect(codes(r)).toContain("event-not-in-plan");
  });
});

describe("rule 3: top-10 entities with logos", () => {
  it("accepts 10 entities, a ledger-backed file logo and wordmark fallbacks listed in missing_logos", () => {
    expect(rules(run())).toEqual([]);
  });
  it("rejects 11 entities", () => {
    const r = run((p) => {
      const es = p.entities as Record<string, unknown>[];
      es.push({ ...(es[0] as Record<string, unknown>), id: "kapok", name: "Kapok", color: "#123456" });
      return undefined;
    });
    expect(codes(r)).toContain("too-many-entities");
  });
  it("requires entity_count_reason below 10", () => {
    const r = run((p) => {
      p.entities = (p.entities as unknown[]).slice(0, 9);
      p.missing_logos = (p.missing_logos as string[]).slice(0, 8);
      return undefined;
    });
    expect(codes(r)).toContain("count-reason");
    const ok = run((p) => {
      p.entities = (p.entities as unknown[]).slice(0, 9);
      p.missing_logos = (p.missing_logos as string[]).slice(0, 8);
      p.entity_count_reason = "only nine species were measured";
      return undefined;
    });
    expect(codes(ok)).not.toContain("count-reason");
  });
  it("rejects a logo file without a ledger row", () => {
    const plan = makePlan();
    const props = JSON.parse(JSON.stringify(makeProps(plan)));
    const r = checkGenerationRules(props, plan, { ledger: [] });
    expect(r.violations.map((v) => v.code)).toContain("logo-no-ledger-row");
    expect(checkGenerationRules(props, plan).violations.map((v) => v.code)).toContain("logo-no-ledger-row");
  });
  it("rejects a logo file whose bytes differ from the ledger sha256", () => {
    const plan = makePlan();
    const props = JSON.parse(JSON.stringify(makeProps(plan)));
    const r = checkGenerationRules(props, plan, { ledger: makeLedger(), fileSha256: () => sha("other") });
    expect(r.violations.map((v) => v.code)).toContain("logo-sha-mismatch");
  });
  it("rejects a wordmark that is not listed in missing_logos, and any other fallback", () => {
    expect(codes(run((p) => set(p, "missing_logos", [])))).toContain("wordmark-not-listed");
    const bad = run((p) => {
      ((p.entities as Record<string, unknown>[])[2] as Record<string, unknown>).logo = { kind: "emoji" };
      return undefined;
    });
    expect(codes(bad)).toContain("logo-kind");
  });
  it("rejects two entities sharing a colour", () => {
    const r = run((p) => {
      ((p.entities as Record<string, unknown>[])[3] as Record<string, unknown>).color = COLORS[0]?.toUpperCase();
      return undefined;
    });
    expect(codes(r)).toContain("duplicate-colour");
  });
});

describe("rule 4: non-revealing titles", () => {
  const withTitle = (title: string) => run((p) => set(p, "title", title));
  const withHook = (hook: string) => run((p) => set(p, "hook", hook));
  it("accepts a plain one-line title and a question hook", () => {
    expect(rules(run())).toEqual([]);
  });
  it("rejects a title naming the final #1 (also by alias)", () => {
    expect(codes(withTitle("Why Juniper keeps growing"))).toContain("reveals-winner");
    const r = run((p) => {
      ((p.entities as Record<string, unknown>[])[9] as Record<string, unknown>).aliases = ["Old Spiky"];
      p.title = "Is old spiky really tall?";
      return undefined;
    });
    expect(codes(r)).toContain("reveals-winner");
    expect(codes(withHook("Will Juniper take the lead?"))).toContain("reveals-winner");
  });
  it.each(["wins", "dominates", "takes over", "#1", "number one", "first place", "champion", "record"])(
    "rejects the reveal word '%s'",
    (w) => {
      expect(codes(withTitle(`Who ${w} the park`))).toContain("reveal-word");
    },
  );
  it("does not trip on substrings (word boundaries)", () => {
    expect(containsTerm("Winston Churchill", "wins")).toBe(false);
    expect(containsTerm("Who WINS?", "wins")).toBe(true);
    expect(codes(withTitle("Which tree fits the winning shape?"))).not.toContain("reveal-word");
  });
  it("rejects a two-line title and a title over 42 characters", () => {
    expect(codes(withTitle("Which tree\ngrows fastest?"))).toContain("title-multiline");
    const long = "A".repeat(DATA_RACE_LIMITS.titleMaxChars + 1);
    expect(codes(withTitle(long))).toContain("title-length");
    expect(withTitle("A".repeat(DATA_RACE_LIMITS.titleMaxChars)).violations.some((v) => v.code === "title-length")).toBe(false);
  });
  it("rejects a hook that does not end with '?'", () => {
    expect(codes(withHook("Watch the trees grow."))).toContain("hook-question");
    expect(codes(withHook("Which tree ends first? "))).not.toContain("hook-question");
  });
  it("limits event titles to one line of 42 characters", () => {
    const r = run((p) => {
      ((p.events as Record<string, unknown>[])[0] as Record<string, unknown>).title = "x".repeat(43);
      return undefined;
    });
    expect(codes(r)).toContain("event-title-length");
  });
});

describe("rule 5: the ending is fixed", () => {
  it("accepts spotlight.facts only", () => {
    expect(rules(run())).toEqual([]);
  });
  it.each([
    ["ending", ["like", "spotlight", "powered"]],
    ["ending_order", ["powered", "like", "spotlight"]],
    ["subscribe_frames", 30],
    ["powered_by", false],
  ])("rejects a props key '%s' that overrides or reorders the ending", (key, value) => {
    const r = run((p) => set(p, key, value));
    expect(codes(r)).toContain("ending-override");
    expect(rules(r)).toContain(5);
  });
  it("rejects extra spotlight fields and a missing spotlight", () => {
    expect(codes(run((p) => set(p.spotlight as Record<string, unknown>, "frames", 90)))).toContain("ending-override");
    expect(codes(run((p) => set(p, "spotlight", undefined)))).toContain("spotlight-missing");
  });
  it("rejects a plan whose ending frames are not 60 / 60 / 90", () => {
    const r = run((p, plan) => {
      const bad = { ...plan, sections: { ...plan.sections, like_end: 1100 } };
      p.timing_plan_sha256 = planSha256(bad);
      return bad;
    });
    expect(codes(r)).toContain("ending-frames");
  });
});

describe("rule 6: card lifespan", () => {
  it("accepts 105 and 135 and the default", () => {
    for (const life of [105, 120, 135])
      expect(
        run((p) => set(ev(p, 0), "life_frames", life)).ok,
      ).toBe(true);
  });
  it.each([104, 136, 200])("rejects life_frames %i", (life) => {
    const r = run((p) => set(ev(p, 0), "life_frames", life));
    expect(codes(r)).toContain("life-frames");
    expect(rules(r)).toContain(6);
  });
});

describe("render props and schema export", () => {
  it("embeds the plan only when its sha256 matches", () => {
    const plan = makePlan();
    const props = DataRacePropsSchema.parse(makeProps(plan));
    expect(resolveDataRaceRenderProps(props, plan).timing_plan?.sections.total).toBe(1210);
    expect(() => resolveDataRaceRenderProps(props, { ...plan, fps: 30, periods: [...plan.periods].reverse() })).toThrow(/mismatch/);
  });
  it("exports a JSON schema without the render-only field", () => {
    const s = JSON.stringify(dataRacePropsJsonSchema());
    expect(s).toContain("timing_plan_sha256");
    expect(s).not.toContain('"timing_plan"');
    expect(s).not.toMatch(/transition/);
  });
  it("sha256 and canonical JSON are correct and key-order independent", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("a".repeat(1000))).toBe("41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });
});
