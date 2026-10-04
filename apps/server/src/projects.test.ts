import { existsSync } from "node:fs";
import { sampleEraProps, sampleScript } from "@statreel/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { paths } from "./config";
import { openDb, projectProps } from "./db";
import { ProjectService, SCHEMA_VERSION, matchesDisplayed, parseDisplayed } from "./projects";
import { Warehouse } from "./warehouse";

describe.skipIf(!existsSync(paths.warehouse))("ProjectService", () => {
  let wh: Warehouse;
  let svc: ProjectService;
  beforeAll(async () => {
    wh = await Warehouse.open(paths.warehouse);
    svc = new ProjectService(openDb(":memory:"), wh);
  });
  afterAll(() => wh.close());

  const create = () => svc.create({ title: "Most points ≠ most dominant", use_case_id: "era-adjusted-rankings", sport: "F1", format: "vertical", mode: "monetized" });

  it("creates a project in the idea stage", () => {
    const p = create();
    expect(p.status).toBe("idea");
    expect(svc.get(p.id)?.title).toContain("dominant");
  });

  it("stores props whose every figure matches the warehouse, versioned", async () => {
    const p = create();
    const r = await svc.setProps(p.id, sampleEraProps, "llm");
    expect(r.errors).toEqual([]);
    expect(r.version).toBe(1);
    expect((await svc.setProps(p.id, sampleEraProps, "user")).version).toBe(2);
    expect(svc.get(p.id)?.status).toBe("data-ready");
  });

  it("rejects props with a figure that does not match its fact, verbatim", async () => {
    const p = create();
    const bad = structuredClone(sampleEraProps);
    bad.rows[0]!.adjusted_value = 19.5;
    const r = await svc.setProps(p.id, bad, "llm");
    expect(r.version).toBeNull();
    expect(r.errors.join("\n")).toMatch(/19\.5 != fact/);
  });

  it("rejects schema-invalid props with the zod message", async () => {
    const p = create();
    const r = await svc.setProps(p.id, { ...sampleEraProps, hook_shape: "did-you-know" }, "llm");
    expect(r.errors.join("\n")).toMatch(/hook_shape/);
  });

  const fullLength = () => {
    const s = structuredClone(sampleScript);
    s.scenes[0]!.tokens.push(...Array.from({ length: 110 }, () => ({ display: "word", spoken: "word" })));
    return s;
  };

  it("rejects a fragment as too short for the use case", async () => {
    const r = await svc.writeScript(create().id, sampleScript);
    expect(r.errors.join("\n")).toMatch(/too short/);
  });

  it("writes a script: checks figures against facts and reports CPS/length", async () => {
    const p = create();
    const r = await svc.writeScript(p.id, fullLength());
    expect(r.errors).toEqual([]);
    expect(r.words).toBeGreaterThan(0);
    expect(r.est_duration_s.min).toBeLessThanOrEqual(r.est_duration_s.max);
  });

  it("rejects a script figure whose fact disagrees", async () => {
    const p = create();
    const bad = structuredClone(sampleScript);
    bad.scenes[0]!.tokens[5] = { display: "25", spoken: "twenty-five", fact_key: "f1db:driver:juan-manuel-fangio:era-adjusted#wins" };
    const r = await svc.writeScript(p.id, bad);
    expect(r.errors.join("\n")).toMatch(/25.*24/);
  });

  it("rejects a script that cannot fit the use case's duration band at the narrator's measured rate", async () => {
    const p = create();
    const long = structuredClone(sampleScript);
    const filler = Array.from({ length: 200 }, (_, i) => ({ display: `word${"abcdefghij"[i % 10]}`, spoken: "word" }));
    long.scenes[0]!.tokens.push(...filler);
    const r = await svc.writeScript(p.id, long);
    expect(r.version).toBeNull();
    expect(r.errors.join("\n")).toMatch(/too long.*measured/);
  });
});

describe("displayed-figure matching (pure)", () => {
  const ok = (fact: number, display: string) => matchesDisplayed(fact, parseDisplayed(display), display);
  it("keeps the sign: a U+2212 minus is a minus", () => {
    expect(ok(3, "−3")).toBe(false);
    expect(ok(-3, "−3")).toBe(true);
    expect(ok(-3, "-3")).toBe(true);
  });
  it("accepts x100 only for fractions", () => {
    expect(ok(0.42, "42%")).toBe(true);
    expect(ok(0.4706, "47%")).toBe(true);
    expect(ok(1, "100")).toBe(false);
    expect(ok(1, "100%")).toBe(true);
    expect(ok(2, "200")).toBe(false);
  });
  it("still allows rounding", () => {
    expect(ok(17.118, "17.1")).toBe(true);
    expect(ok(17.118, "18")).toBe(false);
  });
});

/** Validated reads need no warehouse: rows are written straight into project_props, the way an older build left them. */
describe("validated props reads", () => {
  const setup = () => {
    const db = openDb(":memory:");
    const svc = new ProjectService(db, {} as Warehouse, []);
    const p = svc.create({ title: "t", use_case_id: "era-adjusted-rankings", sport: "F1", format: "vertical", mode: "monetized" });
    const put = (version: number, props: unknown, schema_version = SCHEMA_VERSION) =>
      db.insert(projectProps).values({ project_id: p.id, version, props_json: typeof props === "string" ? props : JSON.stringify(props), schema_version, created_by: "llm", created_at: "2026-10-01T00:00:00Z" }).run();
    return { svc, p, put };
  };

  it("a valid row reads back parsed, with no invalid marker", () => {
    const { svc, p, put } = setup();
    put(1, sampleEraProps);
    const r = svc.latestProps(p.id);
    expect(r?.invalid).toBeUndefined();
    expect(r?.props.rows).toHaveLength(6);
    expect(r?.props.show_safe_zone).toBe(false);
  });

  it("a row that no longer validates reads back with invalid issues instead of a cast", () => {
    const { svc, p, put } = setup();
    put(1, { ...sampleEraProps, attribution: "a".repeat(200), rows: undefined });
    const r = svc.latestProps(p.id);
    expect(r?.version).toBe(1);
    expect(r?.invalid?.issues.some((i) => /^rows:/.test(i))).toBe(true);
    expect(r?.invalid?.issues.some((i) => /^attribution: .*shorten it - 76 characters fit/.test(i))).toBe(true);
    // asking an invalid row for its props is the clear error, naming the version and the first issue
    expect(() => r?.props).toThrow(/props v1 are not usable: .*(rows|attribution)/);
    // and it is not serialised as if it were props
    expect(Object.keys(JSON.parse(JSON.stringify(r)))).not.toContain("props");
  });

  it("malformed JSON is invalid, not a throw", () => {
    const { svc, p, put } = setup();
    put(1, "{not json");
    expect(svc.latestProps(p.id)?.invalid?.issues[0]).toMatch(/props_json is not valid JSON/);
  });

  it("says which build wrote an old row that fails today's schema", () => {
    const { svc, p, put } = setup();
    put(1, { ...sampleEraProps, hook_shape: "did-you-know" }, "era-adjusted@0");
    const inv = svc.latestProps(p.id)?.invalid;
    expect(inv?.issues[0]).toBe("props written by era-adjusted@0, this build reads era-adjusted@1");
    expect(inv?.written_by).toBe("era-adjusted@0");
    expect(inv?.issues.some((i) => /hook_shape/.test(i))).toBe(true);
  });

  it("propsHistory validates every row and lists invalid ones without throwing", () => {
    const { svc, p, put } = setup();
    put(1, { nope: true });
    put(2, sampleEraProps);
    const h = svc.propsHistory(p.id);
    expect(h.map((r) => [r.version, Boolean(r.invalid)])).toEqual([[2, false], [1, true]]);
    expect(h.map(({ version, created_by, created_at }) => ({ version, created_by, created_at }))).toHaveLength(2);
  });

  it("attachTiming refuses an invalid latest row with the version and first issue, and stores nothing", () => {
    const { svc, p, put } = setup();
    put(1, { nope: true });
    expect(() => svc.attachTiming(p.id, undefined)).toThrow(/props v1 are not usable/);
    expect(svc.propsHistory(p.id)).toHaveLength(1);
  });

  it("attachTiming stores validated props as a new system version", () => {
    const { svc, p, put } = setup();
    put(1, sampleEraProps);
    expect(svc.attachTiming(p.id, undefined)).toBe(2);
    expect(svc.latestProps(p.id)?.created_by).toBe("system");
  });

  it("attachTiming refuses timing measured on an older props version than the latest, and stores nothing", () => {
    const { svc, p, put } = setup();
    put(1, sampleEraProps);
    put(2, sampleEraProps); // a new author version stored while the audio job ran on v1
    expect(() => svc.attachTiming(p.id, undefined, 1)).toThrow(/props changed while the audio was made \(v1 -> v2\)/);
    expect(svc.propsHistory(p.id)).toHaveLength(2);
    expect(svc.attachTiming(p.id, undefined, 2)).toBe(3); // the version it was measured on is still the latest
  });

  it("setProps refuses a timing block that times other scenes than the props carry (a JSON edit round-tripping it)", async () => {
    const db = openDb(":memory:");
    const svc = new ProjectService(db, { facts: async () => new Map() } as unknown as Warehouse, []);
    const p = svc.create({ title: "t", use_case_id: "era-adjusted-rankings", sport: "F1", format: "vertical", mode: "monetized" });
    const ids = sampleEraProps.scenes.map((s) => s.id);
    const timingFor = (sceneIds: string[]) => ({ duration_s: 10, words: [], cues: [], music: [], voice_lead_s: 0.5,
      scenes: sceneIds.map((scene_id, i) => ({ scene_id, start_s: i, end_s: i + 1 })) });
    const stale = await svc.setProps(p.id, { ...sampleEraProps, timing: timingFor([...ids].reverse()) }, "user");
    expect(stale.version).toBeNull();
    expect(stale.errors[0]).toMatch(/^timing: it times scenes .* but the props have .*remove the timing block/);
    const dropped = await svc.setProps(p.id, { ...sampleEraProps, timing: timingFor(ids.slice(1)) }, "user");
    expect(dropped.errors[0]).toMatch(/^timing: /);
    // a timing that still times exactly these scenes is not refused for its timing
    const same = await svc.setProps(p.id, { ...sampleEraProps, timing: timingFor(ids) }, "user");
    expect(same.errors.some((e) => e.startsWith("timing:"))).toBe(false);
  });

  it("attachTiming rejects a malformed timing block instead of storing it", () => {
    const { svc, p, put } = setup();
    put(1, sampleEraProps);
    expect(() => svc.attachTiming(p.id, { duration_s: -1 } as never)).toThrow(/timing for props v1 is not valid/);
    expect(svc.propsHistory(p.id)).toHaveLength(1);
  });
});
