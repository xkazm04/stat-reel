import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ArchivedError, BoardService, NotArchivedError } from "./board";
import { openDb } from "./db";

const setup = () => {
  const root = mkdtempSync(path.join(tmpdir(), "board-"));
  mkdirSync(path.join(root, "items"), { recursive: true });
  writeFileSync(path.join(root, "items", "a.png"), "png");
  const db = openDb(":memory:");
  return { board: new BoardService(db, root), root, db };
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

describe("Board archive (off-brief items are hidden, never deleted)", () => {
  it("archives items: hidden from the default list, visible with status=archived, files kept", () => {
    const { board, root } = setup();
    const a = board.create(item);
    const b = board.create({ ...item, title: "keep" });
    expect(board.archive([a.id], "headline format, ADR 007")).toBe(1);
    expect(board.list().map((i) => i.id)).toEqual([b.id]);
    expect(board.list({ status: "archived" })[0]).toMatchObject({ id: a.id, status: "archived", note: null, archive_reason: "headline format, ADR 007" });
    expect(existsSync(path.join(root, "items", "a.png"))).toBe(true);
  });

  it("archived items never feed the skill's feedback", () => {
    const { board } = setup();
    const a = board.create(item);
    board.decide(a.id, "accept");
    board.archive([a.id], "off-brief");
    expect(board.feedback()).toEqual([]);
  });
});

describe("Board archive safety and restore (entity-lifecycle: archive-restore-semantics)", () => {
  it("archive never overwrites the owner's decision note", () => {
    const { board } = setup();
    const a = board.create(item);
    board.decide(a.id, "reject_style", "too many bars");
    board.archive([a.id], "off-brief");
    expect(board.get(a.id)).toMatchObject({ status: "archived", decision: "reject_style", note: "too many bars", archive_reason: "off-brief" });
  });

  it("re-archiving keeps the first reason", () => {
    const { board } = setup();
    const a = board.create(item);
    expect(board.archive([a.id], "first")).toBe(1);
    expect(board.archive([a.id], "second")).toBe(0);
    expect(board.get(a.id)?.archive_reason).toBe("first");
  });

  it("refuses to decide or undo an archived item with a named error and changes nothing", () => {
    const { board } = setup();
    const a = board.create(item);
    board.archive([a.id], "off");
    expect(() => board.decide(a.id, "accept")).toThrow(ArchivedError);
    expect(() => board.undo(a.id)).toThrow(ArchivedError);
    expect(board.get(a.id)).toMatchObject({ status: "archived", decision: null });
  });

  it.each([
    [null, "pending"],
    ["accept", "accepted"],
    ["reject_style", "rejected"],
    ["reject_case", "rejected"],
    ["reject_both", "rejected"],
  ] as const)("restores an archived item with decision %s to %s, keeping its note", (decision, status) => {
    const { board } = setup();
    const a = board.create(item);
    if (decision) board.decide(a.id, decision, "my note");
    board.archive([a.id], "off");
    expect(board.restore(a.id)).toMatchObject({ status, decision, archive_reason: null, note: decision ? "my note" : null });
    expect(board.list().map((i) => i.id)).toContain(a.id);
  });

  it("refuses to restore a live or unknown item", () => {
    const { board } = setup();
    const a = board.create(item);
    expect(() => board.restore(a.id)).toThrow(NotArchivedError);
    expect(() => board.restore("bd-nope")).toThrow(/unknown/);
  });

  it("a legacy row (reason stored in note, no archive_reason) restores with that note cleared", () => {
    const { board, db } = setup();
    const a = board.create(item);
    board.decide(a.id, "accept");
    board.archive([a.id], "x");
    // the old archive overwrote the note with the reason and wrote no archive_reason
    db.$client.prepare("update board_items set archive_reason = null, note = 'headline format' where id = ?").run(a.id);
    expect(board.restore(a.id)).toMatchObject({ status: "accepted", note: null, archive_reason: null });
  });

  it("a legacy superseded sibling (marker in note) is still found by restoreSiblings", () => {
    const { board, db } = setup();
    const a = board.create(item);
    db.$client.prepare("update board_items set status = 'archived', decision = 'superseded', note = 'superseded by bd-win', archive_reason = null where id = ?").run(a.id);
    expect(board.restoreSiblings("bd-win")).toEqual([a.id]);
    expect(board.get(a.id)).toMatchObject({ status: "pending", decision: null, note: null });
  });
});
