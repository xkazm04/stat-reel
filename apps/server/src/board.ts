/**
 * Board (ADR 006): visual-only design outputs and use-case ideas behind a human gate. Items are
 * produced at skill level (.claude/skills/board) and reviewed by the owner: accept, reject_style,
 * reject_case, reject_both. The skill reads decisions back as feedback for its next loop.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { and, asc, desc, eq } from "drizzle-orm";
import { boardItems, caseIdeas, type Db, now } from "./db";

export const DECISIONS = ["accept", "reject_style", "reject_case", "reject_both"] as const;
export type Decision = (typeof DECISIONS)[number];
export type BoardStyle = { id: string; name: string; notes?: string };
export type ProposedCase = { name: string; pitch: string; requires?: string[] };
export type NewBoardItem = {
  image: string; video?: string | null; duration_s?: number | null; width?: number; height?: number; title: string; summary?: string;
  use_case_id?: string | null; proposed_case?: ProposedCase | null; style?: BoardStyle | null; source?: Record<string, unknown> | null;
  /** the case idea this design belongs to (generation output, ADR 010); must exist */
  case_idea_id?: string | null;
};
export type BoardItem = Omit<typeof boardItems.$inferSelect, "proposed_case_json" | "style_json" | "source_json"> & {
  proposed_case: ProposedCase | null; style: BoardStyle | null; source: Record<string, unknown> | null;
};

const parse = <T>(s: string | null): T | null => (s ? (JSON.parse(s) as T) : null);
const hydrate = (r: typeof boardItems.$inferSelect): BoardItem => {
  const { proposed_case_json, style_json, source_json, ...rest } = r;
  return { ...rest, proposed_case: parse(proposed_case_json), style: parse(style_json), source: parse(source_json) };
};

export class BoardService {
  /** `root` is data/board: images live under it and are served at /files/board/<image>. */
  constructor(private readonly db: Db, private readonly root: string) {}

  private inside(rel: string, what: string): string {
    const abs = path.resolve(this.root, rel);
    if (!abs.startsWith(path.resolve(this.root) + path.sep)) throw new Error(`${what} must live inside the board directory (${this.root})`);
    if (!existsSync(abs)) throw new Error(`${what} not found: ${rel}`);
    return rel.split(path.sep).join("/");
  }

  create(i: NewBoardItem): BoardItem {
    this.inside(i.image, "image");
    const video = i.video ? this.inside(i.video, "video") : null;
    if (!i.use_case_id && !i.proposed_case) throw new Error("an item needs a use_case_id or a proposed_case");
    if (i.case_idea_id && !this.db.select({ id: caseIdeas.id }).from(caseIdeas).where(eq(caseIdeas.id, i.case_idea_id)).get()) throw new Error(`unknown case idea ${i.case_idea_id}`);
    const row = {
      id: `bd-${randomUUID().slice(0, 8)}`, image: i.image.split(path.sep).join("/"), video, duration_s: video ? (i.duration_s ?? null) : null, width: i.width ?? null, height: i.height ?? null,
      title: i.title, summary: i.summary ?? null, use_case_id: i.use_case_id ?? null,
      proposed_case_json: i.proposed_case ? JSON.stringify(i.proposed_case) : null, style_json: i.style ? JSON.stringify(i.style) : null,
      source_json: i.source ? JSON.stringify(i.source) : null, status: "pending", decision: null, note: null, decided_at: null, created_at: now(), case_idea_id: i.case_idea_id ?? null,
    };
    this.db.insert(boardItems).values(row).run();
    return hydrate(row);
  }

  /** Default list hides archived items; pass status "archived" (or "all") to see them. */
  list(filter: { status?: string } = {}): BoardItem[] {
    const q = this.db.select().from(boardItems);
    const rows = (filter.status && filter.status !== "all" ? q.where(eq(boardItems.status, filter.status)) : q).orderBy(desc(boardItems.created_at)).all();
    return rows.filter((r) => filter.status === "archived" || filter.status === "all" || r.status !== "archived").map(hydrate);
  }

  /** Hide off-brief items (ADR 007): status archived, reason in the note; files and history are kept. */
  archive(ids: string[], reason: string): number {
    let n = 0;
    for (const id of ids) {
      if (!this.get(id)) continue;
      this.db.update(boardItems).set({ status: "archived", note: reason }).where(eq(boardItems.id, id)).run();
      n++;
    }
    return n;
  }

  get(id: string): BoardItem | undefined {
    const r = this.db.select().from(boardItems).where(eq(boardItems.id, id)).get();
    return r ? hydrate(r) : undefined;
  }

  decide(id: string, decision: Decision, note?: string): BoardItem {
    if (!DECISIONS.includes(decision)) throw new Error(`decision must be one of ${DECISIONS.join(", ")}`);
    if (!this.get(id)) throw new Error(`unknown board item ${id}`);
    this.db.update(boardItems).set({ status: decision === "accept" ? "accepted" : "rejected", decision, note: note?.trim() || null, decided_at: now() })
      .where(eq(boardItems.id, id)).run();
    return this.get(id)!;
  }

  /** Undo a decision (D.1): back to pending, decision, note and decided_at cleared. Archived items cannot be undone. */
  undo(id: string): BoardItem {
    return this.undoDecision(id).item;
  }

  /** `undo`, plus the siblings that accepting this item archived (D.2 transition 5), which come back to pending. */
  undoDecision(id: string): { item: BoardItem; restored_ids: string[] } {
    const cur = this.get(id);
    if (!cur) throw new Error(`unknown board item ${id}`);
    if (cur.status === "archived") throw new Error(`board item ${id} is archived`);
    this.db.update(boardItems).set({ status: "pending", decision: null, note: null, decided_at: null }).where(eq(boardItems.id, id)).run();
    return { item: this.get(id)!, restored_ids: this.restoreSiblings(id) };
  }

  /**
   * Accepting one generated variant archives its pending siblings (same case, same generation job) as
   * `superseded by <id>` (owner decision Q4). Returns the archived ids.
   */
  supersedeSiblings(acceptedId: string): string[] {
    const acc = this.get(acceptedId);
    const jobId = acc?.source?.job_id;
    if (!acc?.case_idea_id || typeof jobId !== "string") return [];
    const ids: string[] = [];
    for (const r of this.db.select().from(boardItems).where(eq(boardItems.case_idea_id, acc.case_idea_id)).all()) {
      if (r.id === acceptedId || r.status !== "pending") continue;
      if (hydrate(r).source?.job_id !== jobId) continue;
      this.db.update(boardItems).set({ status: "archived", decision: "superseded", note: `superseded by ${acceptedId}` }).where(eq(boardItems.id, r.id)).run();
      ids.push(r.id);
    }
    return ids;
  }

  /** The inverse of `supersedeSiblings`, matched by the note: back to pending with decision and note cleared. */
  restoreSiblings(acceptedId: string): string[] {
    const note = `superseded by ${acceptedId}`;
    const rows = this.db.select({ id: boardItems.id }).from(boardItems).where(and(eq(boardItems.status, "archived"), eq(boardItems.decision, "superseded"), eq(boardItems.note, note))).all();
    for (const r of rows) this.db.update(boardItems).set({ status: "pending", decision: null, note: null, decided_at: null }).where(eq(boardItems.id, r.id)).run();
    return rows.map((r) => r.id);
  }

  /** Decided items since an ISO time (exclusive), oldest first: the design skill's feedback feed. */
  feedback(since?: string): BoardItem[] {
    return this.db.select().from(boardItems).orderBy(asc(boardItems.decided_at)).all().map(hydrate)
      .filter((i) => i.status !== "archived" && i.decided_at && (!since || i.decided_at > since));
  }
}
