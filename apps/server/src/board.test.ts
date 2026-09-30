import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BoardService } from "./board";
import { openDb } from "./db";

const setup = () => {
  const root = mkdtempSync(path.join(tmpdir(), "board-"));
  mkdirSync(path.join(root, "items"), { recursive: true });
  writeFileSync(path.join(root, "items", "a.png"), "png");
  return { board: new BoardService(openDb(":memory:"), root), root };
};
const item = {
  image: "items/a.png", width: 1080, height: 1920, title: "Fangio 43 -> 1", summary: "Rank-led vertical opener",
  use_case_id: "era-adjusted-rankings", style: { id: "floodlit-slope", name: "Floodlit slope" },
  source: { skill: "board", run: "loop-001", seat: "opus", variant: 1 },
};

describe("Board (visual outputs + use-case backlog behind a human gate)", () => {
  it("stores an item pending review and serves it back", () => {
    const { board } = setup();
    const b = board.create(item);
    expect(b.status).toBe("pending");
    expect(board.list({ status: "pending" }).map((x) => x.id)).toEqual([b.id]);
  });

  it("refuses images outside the board directory", () => {
    const { board } = setup();
    expect(() => board.create({ ...item, image: "../../etc/passwd" })).toThrow(/board directory/);
    expect(() => board.create({ ...item, image: "items/missing.png" })).toThrow(/not found/);
  });

  it("accepts a proposed new use case instead of an existing one", () => {
    const { board } = setup();
    const b = board.create({ ...item, use_case_id: null, proposed_case: { name: "Pit-stop DNA", pitch: "Every stop as a fingerprint" } });
    expect(b.proposed_case?.name).toBe("Pit-stop DNA");
  });

  it.each(["accept", "reject_style", "reject_case", "reject_both"] as const)("records decision %s with a note", (decision) => {
    const { board } = setup();
    const b = board.create(item);
    const d = board.decide(b.id, decision, "too busy");
    expect(d).toMatchObject({ status: decision === "accept" ? "accepted" : "rejected", decision, note: "too busy" });
    expect(d.decided_at).toBeTruthy();
  });

  it("rejects an unknown decision", () => {
    const { board } = setup();
    expect(() => board.decide(board.create(item).id, "maybe" as never)).toThrow(/decision/);
  });

  it("exposes decided items as feedback for the design skill, oldest first, since a timestamp", () => {
    const { board } = setup();
    const a = board.create(item);
    const b = board.create({ ...item, title: "second" });
    board.decide(a.id, "reject_style", "palette too cold");
    board.decide(b.id, "accept");
    const fb = board.feedback();
    expect(fb.map((f) => [f.id, f.decision])).toEqual([[a.id, "reject_style"], [b.id, "accept"]]);
    expect(board.feedback(fb[1]!.decided_at!).length).toBeLessThanOrEqual(1);
  });
});

describe("Board clips (5-10 s motion, not just stills)", () => {
  it("stores a clip beside its poster, validated inside the board directory", () => {
    const { board, root } = setup();
    writeFileSync(path.join(root, "items", "a.mp4"), "mp4");
    const b = board.create({ ...item, video: "items/a.mp4", duration_s: 8 });
    expect(b).toMatchObject({ video: "items/a.mp4", duration_s: 8 });
    expect(() => board.create({ ...item, video: "../x.mp4", duration_s: 8 })).toThrow(/board directory/);
    expect(() => board.create({ ...item, video: "items/none.mp4", duration_s: 8 })).toThrow(/not found/);
  });

  it("an older database gains the clip columns on open (migration)", async () => {
    const { openDb } = await import("./db");
    const Database = (await import("better-sqlite3")).default;
    const dir = mkdtempSync(path.join(tmpdir(), "boarddb-"));
    const file = path.join(dir, "old.sqlite");
    const old = new Database(file);
    old.exec("create table board_items (id text primary key, image text not null, width integer, height integer, title text not null, summary text, use_case_id text, proposed_case_json text, style_json text, source_json text, status text not null, decision text, note text, decided_at text, created_at text not null)");
    old.close();
    const db = openDb(file);
    const cols = db.$client.prepare("pragma table_info(board_items)").all().map((c) => (c as { name: string }).name);
    expect(cols).toEqual(expect.arrayContaining(["video", "duration_s"]));
  });
});
