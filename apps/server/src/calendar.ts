/**
 * Calendar (ADR 006): channel management and timing on top of successfully composed videos.
 * A video is schedulable once its latest render passed the gate. A scheduler tick publishes due
 * items through the existing publish job (private only); the schedule row follows that job.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { channels, type Db, now, projects, renders, schedule } from "./db";
import type { EventBus } from "./events";

export type Channel = typeof channels.$inferSelect;
export type Slot = typeof schedule.$inferSelect;
export type EnqueuePublish = (params: Record<string, unknown>, projectId: string) => string;
const ACTIVE = ["scheduled", "publishing", "published"];

export class CalendarService {
  constructor(private readonly db: Db, bus: EventBus, private readonly enqueuePublish: EnqueuePublish, publishMode: "dry" | "live") {
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

  /** Composed videos: latest render allowed by the gate and not already on the calendar. */
  ready() {
    const taken = new Set(this.db.select().from(schedule).where(inArray(schedule.status, ACTIVE)).all().map((s) => s.render_id));
    return this.db.select().from(projects).all().flatMap((p) => {
      const r = this.latestRender(p.id);
      const policy = r?.policy_json ? (JSON.parse(r.policy_json) as { allow?: boolean }) : null;
      if (!r || !policy?.allow || taken.has(r.id)) return [];
      return [{ project_id: p.id, title: p.title, use_case_id: p.use_case_id, sport: p.sport, format: p.format, mode: p.mode, render_id: r.id, rendered_at: r.created_at }];
    });
  }

  list(range?: { from?: string; to?: string }): Slot[] {
    return this.db.select().from(schedule).all()
      .filter((s) => (!range?.from || s.publish_at >= range.from) && (!range?.to || s.publish_at < range.to))
      .sort((a, b) => a.publish_at.localeCompare(b.publish_at));
  }

  get(id: string): Slot | undefined {
    return this.db.select().from(schedule).where(eq(schedule.id, id)).get();
  }

  schedule(input: { project_id: string; channel_id: string; publish_at: string; title?: string; description?: string; tags?: string[] }): Slot {
    const channel = this.db.select().from(channels).where(eq(channels.id, input.channel_id)).get();
    if (!channel) throw new Error(`unknown channel ${input.channel_id}`);
    if (channel.status === "not_wired") throw new Error(`${channel.name} is not wired yet (${channel.note})`);
    if (Number.isNaN(Date.parse(input.publish_at))) throw new Error(`publish_at is not a date: ${input.publish_at}`);
    const r = this.latestRender(input.project_id);
    const policy = r?.policy_json ? (JSON.parse(r.policy_json) as { allow?: boolean; deny?: string[] }) : null;
    if (!r || !policy?.allow) throw new Error(`the publish gate has not allowed this project's latest render${policy?.deny?.length ? `: ${policy.deny.join("; ")}` : ""}`);
    const clash = this.db.select().from(schedule).where(and(eq(schedule.render_id, r.id), inArray(schedule.status, ACTIVE))).get();
    if (clash) throw new Error("this render is already on the calendar");
    const slot = {
      id: `sl-${randomUUID().slice(0, 8)}`, project_id: input.project_id, render_id: r.id, channel_id: channel.id,
      publish_at: new Date(input.publish_at).toISOString().replace(".000Z", "Z"), status: "scheduled",
      title: input.title ?? null, description: input.description ?? null, tags_json: input.tags ? JSON.stringify(input.tags) : null,
      job_id: null, publication_id: null, error: null, created_at: now(),
    };
    this.db.insert(schedule).values(slot).run();
    return slot;
  }

  reschedule(id: string, publish_at: string): Slot {
    const s = this.get(id);
    if (!s || s.status !== "scheduled") throw new Error("only a scheduled slot can move");
    if (Number.isNaN(Date.parse(publish_at))) throw new Error(`publish_at is not a date: ${publish_at}`);
    this.db.update(schedule).set({ publish_at: new Date(publish_at).toISOString().replace(".000Z", "Z") }).where(eq(schedule.id, id)).run();
    return this.get(id)!;
  }

  cancel(id: string): Slot {
    const s = this.get(id);
    if (!s || s.status !== "scheduled") throw new Error("only a scheduled slot can be cancelled");
    this.db.update(schedule).set({ status: "cancelled" }).where(eq(schedule.id, id)).run();
    return this.get(id)!;
  }

  /** Publish every due slot once. Called by the server's interval and after scheduling "now". */
  tick(at: Date = new Date()): number {
    const due = this.db.select().from(schedule).where(eq(schedule.status, "scheduled")).all().filter((s) => Date.parse(s.publish_at) <= at.getTime());
    for (const s of due) {
      const jobId = this.enqueuePublish({ projectId: s.project_id, title: s.title ?? undefined, description: s.description ?? undefined,
        tags: s.tags_json ? JSON.parse(s.tags_json) : undefined, scheduleId: s.id }, s.project_id);
      this.db.update(schedule).set({ status: "publishing", job_id: jobId }).where(eq(schedule.id, s.id)).run();
    }
    return due.length;
  }
}
