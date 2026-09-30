/**
 * Board (ADR 006): visual-only design outputs and use-case ideas behind a human gate. Items are
 * produced at skill level (.claude/skills/board) and reviewed by the owner: accept, reject_style,
 * reject_case, reject_both. The skill reads decisions back as feedback for its next loop.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { asc, desc, eq } from "drizzle-orm";
import { boardItems, type Db, now } from "./db";

export const DECISIONS = ["accept", "reject_style", "reject_case", "reject_both"] as const;
export type Decision = (typeof DECISIONS)[number];
export type BoardStyle = { id: string; name: string; notes?: string };
export type ProposedCase = { name: string; pitch: string; requires?: string[] };
export type NewBoardItem = {
  image: string; video?: string | null; duration_s?: number | null; width?: number; height?: number; title: string; summary?: string;
  use_case_id?: string | null; proposed_case?: ProposedCase | null; style?: BoardStyle | null; source?: Record<string, unknown> | null;
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
    const row = {
      id: `bd-${randomUUID().slice(0, 8)}`, image: i.image.split(path.sep).join("/"), video, duration_s: video ? (i.duration_s ?? null) : null, width: i.width ?? null, height: i.height ?? null,
      title: i.title, summary: i.summary ?? null, use_case_id: i.use_case_id ?? null,
      proposed_case_json: i.proposed_case ? JSON.stringify(i.proposed_case) : null, style_json: i.style ? JSON.stringify(i.style) : null,
      source_json: i.source ? JSON.stringify(i.source) : null, status: "pending", decision: null, note: null, decided_at: null, created_at: now(),
    };
    this.db.insert(boardItems).values(row).run();
    return hydrate(row);
  }

  list(filter: { status?: string } = {}): BoardItem[] {
    const q = this.db.select().from(boardItems);
    return (filter.status ? q.where(eq(boardItems.status, filter.status)) : q).orderBy(desc(boardItems.created_at)).all().map(hydrate);
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

  /** Decided items since an ISO time (exclusive), oldest first: the design skill's feedback feed. */
  feedback(since?: string): BoardItem[] {
    return this.db.select().from(boardItems).orderBy(asc(boardItems.decided_at)).all().map(hydrate)
      .filter((i) => i.decided_at && (!since || i.decided_at > since));
  }
}
