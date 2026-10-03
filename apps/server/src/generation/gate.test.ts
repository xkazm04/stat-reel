import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Source, SourceSchema } from "@statreel/schemas";
import { type Db, openDb } from "../db";
import { evaluateGate, loadSources, makeGate, matchSource } from "./gate";
import { CASE_A, insertCase } from "./testing";

const src = (o: Partial<Source> & { id: string }): Source =>
  SourceSchema.parse({ sport: "F1", url: `https://${o.id}.example.org/data`, access: "api", hosts: [], verdict: "legal", license: "CC-BY-4.0", attribution: null, kinds: ["hist"], ...o });
const SOURCES = [src({ id: "f1db", url: "https://github.com/f1db/f1db", hosts: ["api.github.com"] }), src({ id: "formula1-com", verdict: "avoid" }), src({ id: "openf1", verdict: "non_commercial", hosts: ["api.openf1.org"] })];

let db: Db;
beforeEach(() => {
  db = openDb(":memory:");
});
afterEach(() => db.$client.close());

type Setup = { data_status?: string; sources?: object[]; item?: { status?: string; provenance?: string | null; case?: string | null } };
function setup(o: Setup = {}): string {
  insertCase(db, CASE_A, { data_status: o.data_status ?? "staged" });
  db.$client.prepare("update case_ideas set sources_json = ? where id = ?").run(JSON.stringify(o.sources ?? [{ name: "F1DB", url: "https://github.com/f1db/f1db", license: "CC-BY-4.0", registry_id: "f1db" }]), CASE_A);
  const it = o.item ?? {};
  db.$client
    .prepare("insert into board_items (id, image, title, status, created_at, case_idea_id, source_json) values ('bd-00000001', 'x.png', 't', ?, '2026-01-01', ?, ?)")
    .run(it.status ?? "accepted", it.case === undefined ? CASE_A : it.case, JSON.stringify({ skill: "generation", data_provenance: it.provenance === undefined ? "real" : it.provenance }));
  return "bd-00000001";
}
const gate = (item: string | undefined) => evaluateGate(db, { type: "generate_video", case_id: CASE_A, board_item_id: item }, SOURCES);

describe("the data gate (D.6)", () => {
  it("visual_options is always allowed, whatever the data", () => {
    insertCase(db, CASE_A, { data_status: "new-source" });
    expect(evaluateGate(db, { type: "visual_options", case_id: CASE_A }, SOURCES)).toEqual({ ok: true });
  });

  it("passes when the case is staged, its sources are approved and the visual is real", () => {
    expect(gate(setup())).toEqual({ ok: true });
  });

  it("also passes for a registry case", () => {
    expect(gate(setup({ data_status: "registry" }))).toEqual({ ok: true });
  });

  it.each(["new-source", "guess"])("fails for a %s case, naming the way out", (data_status) => {
    const r = gate(setup({ data_status }));
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? "" : r.reason).toMatch(/sources\.yaml.*statreel_ingest/);
  });

  it("fails when a source is not in the registry, naming it", () => {
    const r = gate(setup({ sources: [{ name: "F1DB", url: "https://github.com/f1db/f1db", registry_id: "f1db" }, { name: "U.S. EIA", url: "https://www.eia.gov/" }] }));
    expect(r).toEqual({ ok: false, reason: "Case ci-aaaaaaa1: source 'U.S. EIA' is not in the registry; approve it and ingest it through statreel_ingest first." });
  });

  it("fails for a source with verdict avoid, also when found by name", () => {
    const r = gate(setup({ sources: [{ name: "formula1-com" }] }));
    expect(r.ok ? "" : r.reason).toMatch(/verdict avoid/);
  });

  it("fails when the case names no source", () => {
    expect(gate(setup({ sources: [] }))).toMatchObject({ ok: false, reason: expect.stringMatching(/no data source/) });
  });

  it("fails when the accepted visual used sample data or recorded none", () => {
    expect(gate(setup({ item: { provenance: "sample" } }))).toMatchObject({ ok: false, reason: expect.stringMatching(/sample data/) });
  });

  it("fails without an accepted visual of this case", () => {
    setup({ item: { status: "pending" } });
    expect(gate(undefined)).toMatchObject({ ok: false, reason: expect.stringMatching(/accept one of the designs/) });
    expect(gate("bd-00000001")).toMatchObject({ ok: false, reason: expect.stringMatching(/not accepted/) });
  });

  it("fails for a design of another case", () => {
    expect(gate(setup({ item: { case: "ci-bbbbbbb2" } }))).toMatchObject({ ok: false, reason: expect.stringMatching(/does not belong/) });
  });

  it("matches a source by registry_id, name or host", () => {
    expect(matchSource({ registry_id: "openf1" }, SOURCES)?.id).toBe("openf1");
    expect(matchSource({ registry_id: "nope", name: "f1db" }, SOURCES)).toBeUndefined();
    expect(matchSource({ name: "F1 DB" }, SOURCES)?.id).toBe("f1db");
    expect(matchSource({ name: "x", url: "https://api.openf1.org/v1/laps" }, SOURCES)?.id).toBe("openf1");
    expect(matchSource({ name: "x", url: "https://example.com" }, SOURCES)).toBeUndefined();
  });

  it("reads the real registry and fails closed when it cannot be read", () => {
    expect(loadSources().map((s) => s.id)).toContain("f1db");
    const id = setup();
    expect(makeGate(db)({ type: "generate_video", case_id: CASE_A, board_item_id: id })).toEqual({ ok: true });
    const broken = makeGate(db, () => {
      throw new Error("boom");
    })({ type: "generate_video", case_id: CASE_A, board_item_id: id });
    expect(broken).toMatchObject({ ok: false, reason: expect.stringMatching(/could not be read/) });
  });
});
