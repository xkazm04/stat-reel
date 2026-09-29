import type { HeatmapCell, Source } from "@statreel/schemas";
import { describe, expect, it } from "vitest";
import {
  busState,
  type Capability,
  checkRows,
  countStatuses,
  decisionAid,
  factGroup,
  failingKinds,
  fileUrl,
  needsYou,
  nextAction,
  stageIndex,
  summarizeToolInput,
  timecode,
  toolResultStatus,
  trendSeries,
} from "./logic";

type K = HeatmapCell["kinds"][number];
const kind = (k: string, best: K["best"], sources: K["sources"] = [], tested = true): K => ({
  kind: k as K["kind"],
  best,
  tested,
  sources,
});
const cell = (
  usecase: string,
  sport: HeatmapCell["sport"],
  mode: HeatmapCell["mode"],
  status: HeatmapCell["status"],
  kinds: K[],
  impl = false,
): HeatmapCell => ({
  usecase,
  sport,
  mode,
  status,
  reason: "r",
  kinds,
  composition_implemented: impl,
});

describe("decisionAid", () => {
  const cells: HeatmapCell[] = [
    // NBA: events is the sole blocker for two cells (one with a composition) -> +2
    cell(
      "a",
      "NBA",
      "monetized",
      "blocked",
      [
        kind("hist", "legal"),
        kind("events", null, [{ id: "nba-legal", license_class: "legal", status: "declared" }], false),
      ],
      true,
    ),
    cell("b", "NBA", "monetized", "ask", [
      kind("events", "non_commercial", [{ id: "nba-nc", license_class: "non_commercial", status: "pass" }]),
    ]),
    // two failing kinds: counts as "also helps", not a flip
    cell("c", "NBA", "monetized", "blocked", [kind("events", null), kind("track", null)]),
    // F1 hist sole blocker -> +1
    cell("d", "F1", "monetized", "ask", [kind("hist", "paid")]),
    // other mode and non-failing cells are ignored
    cell("e", "NBA", "non_commercial", "blocked", [kind("events", null)]),
    cell("f", "F1", "monetized", "go", [kind("hist", "legal")], true),
  ];

  it("ranks kind x sport by the number of cells it alone would flip", () => {
    const aid = decisionAid(cells, "monetized");
    expect(aid.map((a) => [a.kind, a.sport, a.flips.length])).toEqual([
      ["events", "NBA", 2],
      ["hist", "F1", 1],
    ]);
    expect(aid[0]?.alsoHelps).toBe(1);
    expect(aid[0]?.becomes).toEqual({ go: 1, "data-ready": 1, ask: 0, blocked: 0 });
    expect(aid[0]?.candidates).toEqual([{ id: "nba-legal", license_class: "legal", status: "declared" }]);
  });

  it("never lists a kind x sport that flips nothing on its own", () => {
    expect(decisionAid(cells, "monetized").some((a) => a.kind === "track")).toBe(false);
  });

  it("treats non-commercial as allowed in non-commercial mode", () => {
    const nc = [cell("b", "NBA", "non_commercial", "data-ready", [kind("events", "non_commercial")])];
    expect(failingKinds(nc[0]!)).toEqual([]);
    expect(decisionAid(nc, "non_commercial")).toEqual([]);
  });

  it("counts statuses per mode", () => {
    expect(countStatuses(cells, "monetized")).toEqual({ go: 1, "data-ready": 0, ask: 2, blocked: 2 });
  });
});

describe("busState", () => {
  const src = (id: string, sport: string, verdict: Source["verdict"], kinds: string[]): Source =>
    ({
      id,
      sport,
      url: "",
      access: "api",
      hosts: [],
      verdict,
      license: "x",
      attribution: null,
      kinds,
      partial_kinds: [],
    }) as unknown as Source;
  const cap = (source_id: string, license_class: string, status: string, sport = "F1", k = "hist"): Capability => ({
    sport,
    kind: k,
    source_id,
    license_class,
    status,
    coverage_from: null,
    coverage_to: null,
    rows: 1,
    detail: "",
  });
  const sources = [
    src("f1db", "F1", "legal", ["hist"]),
    src("openf1", "F1", "non_commercial", ["live"]),
    src("bad", "F1", "avoid", ["hist"]),
  ];

  it("is ok only from a passing, allowed, tested capability", () => {
    expect(busState([cap("f1db", "legal", "pass")], sources, "hist", "F1", "monetized")).toMatchObject({
      state: "ok",
      source: "f1db",
    });
    expect(busState([], sources, "hist", "F1", "monetized")).toEqual({
      state: "untested",
      declared: ["f1db"],
      best: "legal",
    });
  });
  it("caps a non-commercial source in monetized mode", () => {
    const caps = [cap("openf1", "non_commercial", "pass", "F1", "live")];
    expect(busState(caps, sources, "live", "F1", "monetized")).toMatchObject({
      state: "capped",
      best: "non_commercial",
    });
    expect(busState(caps, sources, "live", "F1", "non_commercial")).toMatchObject({ state: "ok" });
  });
  it("reports failing tests and missing sources", () => {
    expect(busState([cap("f1db", "legal", "fail")], sources, "hist", "F1", "monetized")).toEqual({
      state: "failing",
      failing: ["f1db"],
    });
    expect(busState([], sources, "money", "F1", "monetized")).toEqual({ state: "none" });
  });
});

describe("stage logic", () => {
  it("maps stages to the next action", () => {
    expect(stageIndex("idea")).toBe(0);
    expect(stageIndex("published")).toBe(5);
    expect(nextAction("idea").verb).toBe("Draft with Claude");
    expect(nextAction("scripted").verb).toBe("Produce");
    expect(nextAction("rendered").tone).toBe("blocked");
    expect(nextAction("gated").verb).toBe("Publish private");
    expect(nextAction("published").tone).toBe("done");
  });
  it("lets a running job win and surfaces failures verbatim", () => {
    expect(nextAction("scripted", { kind: "render", status: "running", progress: 0.42 })).toEqual({
      verb: "Rendering",
      hint: "running · 42 %",
      tone: "wait",
    });
    const f = nextAction("scripted", { kind: "audio", status: "refused", error: "refused by elevenlabs: x" });
    expect(f).toMatchObject({ verb: "Review refusal", tone: "blocked" });
    expect(f.hint).toContain("refused by elevenlabs: x");
    expect(needsYou("published")).toBe(false);
    expect(needsYou("scripted", { kind: "render", status: "queued" })).toBe(false);
  });
});

describe("formatting helpers", () => {
  it("maps server file references to proxied /files URLs", () => {
    expect(fileUrl("http://127.0.0.1:8787/files/renders/p-1/run/video.mp4")).toBe("/files/renders/p-1/run/video.mp4");
    expect(fileUrl("C:\\repo\\data\\renders\\p-1\\run\\video.mp4")).toBe("/files/renders/p-1/run/video.mp4");
    expect(fileUrl(null)).toBeNull();
  });
  it("formats timecodes on the frame grid", () => {
    expect(timecode(0, 30)).toBe("00:00:00");
    expect(timecode(30 * 61 + 7, 30)).toBe("01:01:07");
  });
  it("summarises tool inputs and results", () => {
    expect(summarizeToolInput("query", { sql: "select *\n  from llm.f1" })).toBe("select * from llm.f1");
    expect(
      summarizeToolInput("set_props", { project: "p-1", props: { title: "T", rows: [1, 2, 3], scenes: [1] } }),
    ).toBe('project p-1 · "T" · 3 rows · 1 scenes');
    expect(toolResultStatus('{"version":null,"errors":["rows: too few"]}')).toEqual({
      ok: false,
      summary: "rows: too few",
    });
    expect(toolResultStatus('{"version":2,"errors":[]}')).toEqual({ ok: true, summary: "stored v2" });
    expect(toolResultStatus("boom", true).ok).toBe(false);
  });
  it("groups fact refs sharing a row key", () => {
    expect(factGroup(["f1db:driver:x:era#rank_raw", "f1db:driver:x:era#rank_adjusted"])).toEqual({
      prefix: "f1db:driver:x:era",
      columns: ["rank_raw", "rank_adjusted"],
    });
    expect(factGroup(["a:b#c", "d:e#f"]).prefix).toBeNull();
  });
  it("extracts a trend series per use case and mode", () => {
    expect(
      trendSeries(
        [
          { at: "1", go: { "u|monetized": 1 } },
          { at: "2", go: {} },
        ],
        "u",
        "monetized",
      ),
    ).toEqual([1, 0]);
  });
});

describe("checkRows", () => {
  it("evaluates render checks against DESIGN targets and keeps unknown keys", () => {
    const rows = checkRows(
      {
        loudness_lufs: -14.3,
        true_peak_dbtp: -1.5,
        safe_zone_violations: 0,
        width: 1080,
        height: 1920,
        fps: 30,
        duration_s: 58,
        video_codec: "h264",
        audio_codec: "aac",
        extra: 1,
      },
      "vertical",
      { min: 45, max: 75 },
    );
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.loudness_lufs?.ok).toBe(true);
    expect(by.true_peak_dbtp?.ok).toBe(false);
    expect(by.resolution?.ok).toBe(true);
    expect(by.duration_s?.ok).toBe(true);
    expect(by.extra).toMatchObject({ value: "1", ok: null });
  });
});
