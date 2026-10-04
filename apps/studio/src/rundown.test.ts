import { describe, expect, it } from "vitest";
import { byUpdated, GATE_POS, jobCell, lastUpdated, laneState, sayLine, sheetCounts } from "./rundown";

const job = (kind: string, status: string, created_at: string, error: string | null = null) => ({
  kind,
  status,
  created_at,
  finished_at: null,
  started_at: null,
  error,
});

describe("race sheet", () => {
  it("puts the marker at the centre of its gate", () => {
    expect(GATE_POS(0)).toBeCloseTo(100 / 12);
    expect(laneState({ id: "p", status: "published", created_at: "1" })).toMatchObject({ stage: 5, done: true, flagged: false });
  });
  it("flags failed / refused jobs in the owner's words (error verbatim) and a render the gate refused", () => {
    const r = laneState({ id: "p", status: "scripted", created_at: "1", jobs: [job("render", "failed", "2", "ffmpeg died")] });
    expect(r).toMatchObject({ stage: 2, flagged: true, flag: "Render failed: ffmpeg died" });
    expect(laneState({ id: "p", status: "rendered", created_at: "1" }).flagged).toBe(true);
    // a failed job on a published project does not flag it
    expect(laneState({ id: "p", status: "published", created_at: "1", jobs: [job("metrics", "failed", "2")] }).flagged).toBe(false);
  });
  it("sorts by the last movement", () => {
    const a = { id: "a", status: "idea", created_at: "2026-09-30T10:00:00Z" };
    const b = { id: "b", status: "idea", created_at: "2026-09-30T09:00:00Z", jobs: [job("llm", "succeeded", "2026-09-30T11:00:00Z")] };
    expect(lastUpdated(b)).toBe("2026-09-30T11:00:00Z");
    expect(byUpdated([a, b]).map((p) => p.id)).toEqual(["b", "a"]);
  });
  it("counts and says what needs the owner", () => {
    const ps = [
      { id: "p1", status: "gated", created_at: "1" },
      { id: "p2", status: "rendered", created_at: "1" },
      { id: "p3", status: "published", created_at: "1" },
    ];
    expect(sheetCounts(ps)).toEqual({ total: 3, open: 2, published: 1, flagged: 1 });
    const s = sayLine(ps);
    expect(s.parts[0]).toEqual({ id: "p1", text: "is one step from the line: publish private" });
    expect(s.parts[1]?.id).toBe("p2");
    expect(sayLine([]).lead).toBe("No project yet.");
  });
  it("names the running job in the owner's words in the list view, never the raw kind token", () => {
    expect(jobCell({ kind: "llm" }, 0.42)).toBe("Co-pilot draft 42 %");
    expect(jobCell({ kind: "gen_render" }, null)).toBe("Design render 0 %");
    // a kind the table does not know yet reads as a job, not as its token
    expect(jobCell({ kind: "mystery" }, 1)).toBe("A job 100 %");
  });
});
