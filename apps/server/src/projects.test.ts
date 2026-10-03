import { existsSync } from "node:fs";
import { sampleEraProps, sampleScript } from "@statreel/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { paths } from "./config";
import { openDb } from "./db";
import { ProjectService, matchesDisplayed, parseDisplayed } from "./projects";
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
