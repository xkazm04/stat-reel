/**
 * Calendar (ADR 006): channel management and timing on top of successfully composed videos.
 * A video is schedulable once its latest render passed the gate. A scheduler tick publishes due
 * items through the existing publish job (private only); the schedule row follows that job.
 *
 * Slot states and the transitions the service allows:
 *   scheduled  -> publishing (tick claims it) | missed (overdue past the window) | cancelled | scheduled (reschedule)
 *   publishing -> published | failed (follows the publish job)
 *   missed     -> scheduled (reschedule) | cancelled
 * Missed-run policy: a slot overdue by more than the window (default 60 min, env STATREEL_CALENDAR_MISSED_MIN
 * or the constructor option) is NOT published late - a stale private upload after downtime is worse than none -
 * it becomes `missed` with `missed_at` and waits for the owner to reschedule or cancel it.
 * Drift (`SlotView.drift`): a slot whose render was superseded or whose gate no longer allows is never fired;
 * it stays `scheduled` (reason in `error`) until the owner reschedules, which re-points it at the latest
 * render if that one passes the gate.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { channels, type Db, now, projects, renders, schedule } from "./db";
import type { EventBus } from "./events";

export type Channel = typeof channels.$inferSelect;
export type Slot = typeof schedule.$inferSelect;
export type EnqueuePublish = (params: Record<string, unknown>, projectId: string) => string;
const ACTIVE = ["scheduled", "publishing", "published"];
/** A project is "on the calendar" while a slot can still fire or is in flight (a published slot does not block a re-render). */
const LIVE = ["scheduled", "publishing"];
export type SlotDrift = "superseded_render" | "gate_denied";
export type SlotView = Slot & { drift: SlotDrift | null };
const DRIFT_TEXT: Record<SlotDrift, string> = {
  superseded_render: "the project was re-rendered after this slot was scheduled",
  gate_denied: "the publish gate no longer allows this render",
};
const DEFAULT_MISSED_WINDOW_MS = 60 * 60_000;

function envWindowMs(): number {
  const m = Number(process.env.STATREEL_CALENDAR_MISSED_MIN);
  return Number.isFinite(m) && m > 0 ? m * 60_000 : DEFAULT_MISSED_WINDOW_MS;
}

export class CalendarService {
  private readonly missedWindowMs: number;
  constructor(private readonly db: Db, bus: EventBus, private readonly enqueuePublish: EnqueuePublish, publishMode: "dry" | "live", opts: { missedWindowMs?: number } = {}) {
    this.missedWindowMs = opts.missedWindowMs ?? envWindowMs();
    this.seed(publishMode);
    bus.subscribe((e) => {
      if (e.kind !== "publish" || typeof e.id !== "string") return;
      const slot = this.db.select().from(schedule).where(eq(schedule.job_id, e.id)).get();
      if (!slot) return;
      if (e.type === "job.succeeded") {
        const pub = (e.result as { publication_id?: string } | undefined)?.publication_id ?? null;
        this.db.update(schedule).set({ status: "published", publication_id: pub }).where(eq(schedule.id, slot.id)).run();
      } else if (e.type === "job.failed" || e.type === "job.refused" || e.type === "job.cancelled") {
        this.db.update(schedule).set({ status: "failed", error: String(e.error ?? e.type) }).where(eq(schedule.id, slot.id)).run();
      }
    });
  }

  private seed(mode: "dry" | "live") {
    const want = [
      { platform: "youtube", name: "YouTube", status: mode === "live" ? "live" : "dry",
        note: mode === "live" ? "private uploads; the owner flips visibility" : "dry run until the Google Cloud app exists (packages/publish/SETUP.md)" },
      { platform: "tiktok", name: "TikTok", status: "not_wired", note: "Content Posting API (drafts) - milestone M5" },
      { platform: "instagram", name: "Instagram", status: "not_wired", note: "Graph API with Facebook Login for Business - milestone M5" },
    ];
    for (const w of want) {
      const existing = this.db.select().from(channels).where(eq(channels.platform, w.platform)).get();
      if (existing) this.db.update(channels).set({ status: w.status, note: w.note }).where(eq(channels.id, existing.id)).run();
      else this.db.insert(channels).values({ id: `ch-${w.platform}`, ...w, created_at: now() }).run();
    }
  }

  channels(): Channel[] {
    const order = ["youtube", "tiktok", "instagram"];
    return this.db.select().from(channels).all().sort((a, b) => order.indexOf(a.platform) - order.indexOf(b.platform));
  }

  private latestRender(projectId: string) {
    return this.db.select().from(renders).where(eq(renders.project_id, projectId)).orderBy(desc(renders.created_at)).get();
  }

  /**
   * Composed videos: latest render allowed by the gate and not already on the calendar - exactly what
   * schedule() accepts: a project with a live slot (on any render) is not offered, a re-render of it is
   * re-pointed through that slot's reschedule.
   */
  ready() {
    const active = this.db.select().from(schedule).where(inArray(schedule.status, ACTIVE)).all();
    const taken = new Set(active.map((s) => s.render_id));
    const live = new Set(active.filter((s) => LIVE.includes(s.status)).map((s) => s.project_id));
    return this.db.select().from(projects).all().flatMap((p) => {
      const r = this.latestRender(p.id);
      const policy = r?.policy_json ? (JSON.parse(r.policy_json) as { allow?: boolean }) : null;
      if (!r || !policy?.allow || taken.has(r.id) || live.has(p.id)) return [];
      return [{ project_id: p.id, title: p.title, use_case_id: p.use_case_id, sport: p.sport, format: p.format, mode: p.mode, render_id: r.id, rendered_at: r.created_at }];
    });
  }

  /** Why a still-fireable slot must not fire: its render is no longer the project's latest, or its gate flipped. */
  private driftOf(s: Slot): SlotDrift | null {
    if (s.status !== "scheduled" && s.status !== "missed") return null;
    const latest = this.latestRender(s.project_id);
    if (latest && latest.id !== s.render_id) return "superseded_render";
    const own = this.db.select().from(renders).where(eq(renders.id, s.render_id)).get();
    const policy = own?.policy_json ? (JSON.parse(own.policy_json) as { allow?: boolean }) : null;
    return policy?.allow ? null : "gate_denied";
  }

  list(range?: { from?: string; to?: string }): SlotView[] {
    return this.db.select().from(schedule).all()
      .filter((s) => (!range?.from || s.publish_at >= range.from) && (!range?.to || s.publish_at < range.to))
      .sort((a, b) => a.publish_at.localeCompare(b.publish_at))
      .map((s) => ({ ...s, drift: this.driftOf(s) }));
  }

  get(id: string): Slot | undefined {
    return this.db.select().from(schedule).where(eq(schedule.id, id)).get();
  }

  private liveSlotOf(projectId: string, exceptId?: string) {
    return this.db.select().from(schedule).where(and(eq(schedule.project_id, projectId), inArray(schedule.status, LIVE))).all().find((s) => s.id !== exceptId);
  }

  /** The latest render of the project if the gate allows it, else the gate error (one door for schedule + reschedule). */
  private gatedRender(projectId: string) {
    const r = this.latestRender(projectId);
    const policy = r?.policy_json ? (JSON.parse(r.policy_json) as { allow?: boolean; deny?: string[] }) : null;
    if (!r || !policy?.allow) throw new Error(`the publish gate has not allowed this project's latest render${policy?.deny?.length ? `: ${policy.deny.join("; ")}` : ""}`);
    return r;
  }

  private static iso(at: string): string {
    return new Date(at).toISOString().replace(".000Z", "Z");
  }

  schedule(input: { project_id: string; channel_id: string; publish_at: string; title?: string; description?: string; tags?: string[] }): Slot {
    const channel = this.db.select().from(channels).where(eq(channels.id, input.channel_id)).get();
    if (!channel) throw new Error(`unknown channel ${input.channel_id}`);
    if (channel.status === "not_wired") throw new Error(`${channel.name} is not wired yet (${channel.note})`);
    if (Number.isNaN(Date.parse(input.publish_at))) throw new Error(`publish_at is not a date: ${input.publish_at}`);
    const r = this.gatedRender(input.project_id);
    // per project, not per render: a re-render must not let the same video be double-scheduled
    const existing = this.liveSlotOf(input.project_id);
    if (existing) throw new Error(`this project is already on the calendar (slot ${existing.id}, ${existing.status} for ${existing.publish_at})`);
    const clash = this.db.select().from(schedule).where(and(eq(schedule.render_id, r.id), inArray(schedule.status, ACTIVE))).get();
    if (clash) throw new Error(`this render is already on the calendar (slot ${clash.id}, ${clash.status})`);
    const slot = {
      id: `sl-${randomUUID().slice(0, 8)}`, project_id: input.project_id, render_id: r.id, channel_id: channel.id,
      publish_at: CalendarService.iso(input.publish_at), status: "scheduled",
      title: input.title ?? null, description: input.description ?? null, tags_json: input.tags ? JSON.stringify(input.tags) : null,
      job_id: null, publication_id: null, error: null, created_at: now(), missed_at: null,
    };
    this.db.insert(schedule).values(slot).run();
    return slot;
  }

  /**
   * Move a scheduled or missed slot. It is also the owner's conscious answer to drift and to a miss:
   * the slot is re-pointed at the project's latest render, which must pass the gate; stale error/missed marks clear.
   */
  reschedule(id: string, publish_at: string): Slot {
    const s = this.get(id);
    if (!s || (s.status !== "scheduled" && s.status !== "missed")) throw new Error("only a scheduled or missed slot can move");
    if (Number.isNaN(Date.parse(publish_at))) throw new Error(`publish_at is not a date: ${publish_at}`);
    const r = this.gatedRender(s.project_id);
    const other = this.liveSlotOf(s.project_id, s.id);
    if (other) throw new Error(`this project is already on the calendar (slot ${other.id}, ${other.status} for ${other.publish_at})`);
    this.db.update(schedule).set({ publish_at: CalendarService.iso(publish_at), render_id: r.id, status: "scheduled", error: null, missed_at: null }).where(eq(schedule.id, id)).run();
    return this.get(id)!;
  }

  cancel(id: string): Slot {
    const s = this.get(id);
    if (!s || (s.status !== "scheduled" && s.status !== "missed")) throw new Error("only a scheduled or missed slot can be cancelled");
    this.db.update(schedule).set({ status: "cancelled" }).where(eq(schedule.id, id)).run();
    return this.get(id)!;
  }

  /**
   * Publish every due slot at most once; returns how many were handed to the publish job. Never throws:
   * called from a bare setInterval (main.ts) and after "publish now".
   *
   * Delivery guarantee: at-most-once dispatch. The slot is claimed (compare-and-set scheduled -> publishing)
   * BEFORE the job is enqueued, so a crash in between can never produce a second publish; the price is that
   * such a slot stays `publishing` with no job_id, which the next tick marks `failed` for the owner to see
   * (better-sqlite3 is synchronous, so in this process no tick can observe the gap). An enqueue that throws
   * is rolled back to `scheduled` with the error and retried by later ticks until the missed window closes.
   */
  tick(at: Date = new Date()): number {
    let dispatched = 0;
    let slots: Slot[];
    try {
      slots = this.db.select().from(schedule).where(inArray(schedule.status, ["scheduled", "publishing"])).all();
    } catch (e) {
      // the loop is alive but blind this tick: say so, or "why did my slot not fire?" has no answer
      console.error(`[calendar] tick could not read the schedule: ${e instanceof Error ? e.message : String(e)}`);
      return 0;
    }
    for (const s of slots) {
      try {
        if (s.status === "publishing") {
          if (!s.job_id) this.db.update(schedule).set({ status: "failed", error: "interrupted before the publish job was created" }).where(eq(schedule.id, s.id)).run();
          continue;
        }
        const overdue = at.getTime() - Date.parse(s.publish_at);
        if (!(overdue >= 0)) continue;
        if (overdue > this.missedWindowMs) {
          this.db.update(schedule).set({ status: "missed", missed_at: at.toISOString(), error: null }).where(and(eq(schedule.id, s.id), eq(schedule.status, "scheduled"))).run();
          continue;
        }
        const drift = this.driftOf(s);
        if (drift) {
          if (s.error !== DRIFT_TEXT[drift]) this.db.update(schedule).set({ error: DRIFT_TEXT[drift] }).where(eq(schedule.id, s.id)).run();
          continue;
        }
        const claim = this.db.update(schedule).set({ status: "publishing", error: null }).where(and(eq(schedule.id, s.id), eq(schedule.status, "scheduled"))).run();
        if (claim.changes !== 1) continue;
        try {
          const jobId = this.enqueuePublish({ projectId: s.project_id, title: s.title ?? undefined, description: s.description ?? undefined,
            tags: s.tags_json ? JSON.parse(s.tags_json) : undefined, scheduleId: s.id }, s.project_id);
          this.db.update(schedule).set({ job_id: jobId }).where(eq(schedule.id, s.id)).run();
          dispatched++;
        } catch (e) {
          this.db.update(schedule).set({ status: "scheduled", error: `publish could not be queued: ${e instanceof Error ? e.message : String(e)}` }).where(eq(schedule.id, s.id)).run();
        }
      } catch (e) {
        // one bad slot (a corrupt stored verdict, a locked db, ...) must not block the rest; it is retried next tick,
        // and its reason is put where the owner looks (the slot's error) and in the log
        const why = `the scheduler could not process this slot: ${e instanceof Error ? e.message : String(e)}`;
        console.error(`[calendar] slot ${s.id}: ${why}`);
        try {
          if (s.error !== why) this.db.update(schedule).set({ error: why }).where(eq(schedule.id, s.id)).run();
        } catch { /* the database itself is failing: the log line above is the trace */ }
      }
    }
    return dispatched;
  }
}
