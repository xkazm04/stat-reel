import { describe, expect, it } from "vitest";
import { CalendarService } from "./calendar";
import { eq } from "drizzle-orm";
import { openDb, projects, renders, schedule } from "./db";
import { EventBus } from "./events";

function setup(opts: { allow?: boolean; failFor?: (n: number) => boolean } = {}) {
  const db = openDb(":memory:");
  const bus = new EventBus();
  const enqueued: { params: Record<string, unknown>; id: string }[] = [];
  let calls = 0;
  const publish = (params: Record<string, unknown>) => {
    calls++;
    if (opts.failFor?.(calls)) throw new Error("queue is full");
    const id = `job-${enqueued.length + 1}`;
    enqueued.push({ params, id });
    return id;
  };
  db.insert(projects).values({ id: "p1", title: "Most points", use_case_id: "era-adjusted-rankings", sport: "F1", format: "vertical", mode: "monetized", status: "gated", created_at: "2026-09-30" }).run();
  db.insert(renders).values({ id: "r1", project_id: "p1", job_id: "j", format: "vertical", path: "v.mp4", manifest_path: "m.json", checks_json: "{}",
    policy_json: JSON.stringify({ allow: opts.allow ?? true, deny: opts.allow === false ? ["safe-zone violations"] : [] }), created_at: "2026-09-30T10:00:00Z" }).run();
  const cal = new CalendarService(db, bus, publish, "dry");
  return { db, bus, cal, enqueued };
}

describe("Calendar (channels + scheduling on top of composed videos)", () => {
  it("seeds channels: YouTube dry until the Google app exists; TikTok and Instagram not wired", () => {
    const { cal } = setup();
    const ch = cal.channels();
    expect(ch.map((c) => [c.platform, c.status])).toEqual([["youtube", "dry"], ["tiktok", "not_wired"], ["instagram", "not_wired"]]);
  });

  it("lists only gated (allowed) renders that are not scheduled yet as ready to schedule", () => {
    const { cal } = setup();
    expect(cal.ready().map((r) => r.project_id)).toEqual(["p1"]);
    expect(setup({ allow: false }).cal.ready()).toEqual([]);
  });

  it("schedules a ready video on a wired channel and refuses unwired channels and ungated renders", () => {
    const { cal } = setup();
    const yt = cal.channels().find((c) => c.platform === "youtube")!;
    const tk = cal.channels().find((c) => c.platform === "tiktok")!;
    expect(() => cal.schedule({ project_id: "p1", channel_id: tk.id, publish_at: "2026-10-01T09:00:00Z" })).toThrow(/not wired/);
    const s = cal.schedule({ project_id: "p1", channel_id: yt.id, publish_at: "2026-10-01T09:00:00Z", title: "T" });
    expect(s.status).toBe("scheduled");
    expect(cal.ready()).toEqual([]);
    const denied = setup({ allow: false }).cal;
    const ytd = denied.channels().find((c) => c.platform === "youtube")!;
    expect(() => denied.schedule({ project_id: "p1", channel_id: ytd.id, publish_at: "2026-10-01T09:00:00Z" })).toThrow(/gate/);
  });

  it("the scheduler tick publishes due items (private) and leaves future ones", () => {
    const { cal, enqueued } = setup();
    const yt = cal.channels()[0]!;
    const due = cal.schedule({ project_id: "p1", channel_id: yt.id, publish_at: "2026-09-30T08:00:00Z" });
    cal.tick(new Date("2026-09-30T07:59:00Z"));
    expect(enqueued).toHaveLength(0);
    cal.tick(new Date("2026-09-30T08:00:30Z"));
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.params).toMatchObject({ projectId: "p1" });
    expect(cal.get(due.id)!.status).toBe("publishing");
    cal.tick(new Date("2026-09-30T08:05:00Z"));
    expect(enqueued).toHaveLength(1); // never twice
  });

  it("follows the publish job to published / failed", () => {
    const { cal, bus } = setup();
    const yt = cal.channels()[0]!;
    const s = cal.schedule({ project_id: "p1", channel_id: yt.id, publish_at: "2026-09-30T08:00:00Z" });
    cal.tick(new Date("2026-09-30T08:01:00Z"));
    bus.emit({ type: "job.succeeded", id: "job-1", kind: "publish", result: { publication_id: "pub-1" } });
    expect(cal.get(s.id)).toMatchObject({ status: "published", publication_id: "pub-1" });
  });

  it("reschedules and cancels only while scheduled", () => {
    const { cal } = setup();
    const yt = cal.channels()[0]!;
    const s = cal.schedule({ project_id: "p1", channel_id: yt.id, publish_at: "2026-10-01T09:00:00Z" });
    expect(cal.reschedule(s.id, "2026-10-02T09:00:00Z").publish_at).toBe("2026-10-02T09:00:00Z");
    cal.cancel(s.id);
    expect(cal.get(s.id)!.status).toBe("cancelled");
    expect(cal.ready().map((r) => r.project_id)).toEqual(["p1"]); // back to ready
  });

  describe("missed-run policy and claim-before-dispatch", () => {
    function twoProjects(opts: Parameters<typeof setup>[0] = {}) {
      const t = setup(opts);
      t.db.insert(projects).values({ id: "p2", title: "Other", use_case_id: "x", sport: "F1", format: "vertical", mode: "monetized", status: "gated", created_at: "2026-09-30" }).run();
      t.db.insert(renders).values({ id: "r2", project_id: "p2", job_id: "j", format: "vertical", path: "v.mp4", manifest_path: "m.json", checks_json: "{}",
        policy_json: JSON.stringify({ allow: true, deny: [] }), created_at: "2026-09-30T10:00:00Z" }).run();
      return t;
    }

    it("a slot overdue by a day becomes missed (with missed_at) and is never enqueued", () => {
      const { cal, enqueued } = setup();
      const s = cal.schedule({ project_id: "p1", channel_id: cal.channels()[0]!.id, publish_at: "2026-09-30T08:00:00Z" });
      expect(cal.tick(new Date("2026-10-01T08:00:00Z"))).toBe(0);
      expect(enqueued).toHaveLength(0);
      expect(cal.get(s.id)).toMatchObject({ status: "missed", missed_at: "2026-10-01T08:00:00.000Z" });
    });

    it("a slot overdue by 5 minutes still publishes; the window is configurable", () => {
      const { cal, enqueued } = setup();
      cal.schedule({ project_id: "p1", channel_id: cal.channels()[0]!.id, publish_at: "2026-09-30T08:00:00Z" });
      expect(cal.tick(new Date("2026-09-30T08:05:00Z"))).toBe(1);
      expect(enqueued).toHaveLength(1);
      const t = setup();
      const tight = new CalendarService(t.db, new EventBus(), () => "j", "dry", { missedWindowMs: 60_000 });
      const s2 = tight.schedule({ project_id: "p1", channel_id: tight.channels()[0]!.id, publish_at: "2026-09-30T09:00:00Z" });
      tight.tick(new Date("2026-09-30T09:02:00Z"));
      expect(tight.get(s2.id)!.status).toBe("missed");
    });

    it("an enqueue that throws rolls the slot back to scheduled with the error; other due slots still run; tick never throws", () => {
      const { cal, enqueued } = twoProjects({ failFor: (n) => n === 1 });
      const yt = cal.channels()[0]!;
      const a = cal.schedule({ project_id: "p1", channel_id: yt.id, publish_at: "2026-09-30T08:00:00Z" });
      const b = cal.schedule({ project_id: "p2", channel_id: yt.id, publish_at: "2026-09-30T08:01:00Z" });
      let n = 0;
      expect(() => { n = cal.tick(new Date("2026-09-30T08:02:00Z")); }).not.toThrow();
      expect(n).toBe(1);
      expect(cal.get(a.id)).toMatchObject({ status: "scheduled", job_id: null });
      expect(cal.get(a.id)!.error).toMatch(/queue is full/);
      expect(cal.get(b.id)).toMatchObject({ status: "publishing", job_id: "job-1" });
      expect(enqueued).toHaveLength(1);
      expect(cal.tick(new Date("2026-09-30T08:03:00Z"))).toBe(1); // next tick retries the rolled-back slot
      expect(cal.get(a.id)).toMatchObject({ status: "publishing", error: null });
    });

    it("a claim without a job (crash between claim and enqueue) is failed visibly, never published twice", () => {
      const { cal, db, enqueued } = setup();
      const s = cal.schedule({ project_id: "p1", channel_id: cal.channels()[0]!.id, publish_at: "2026-09-30T08:00:00Z" });
      db.update(schedule).set({ status: "publishing" }).where(eq(schedule.id, s.id)).run();
      cal.tick(new Date("2026-09-30T08:01:00Z"));
      expect(enqueued).toHaveLength(0);
      expect(cal.get(s.id)).toMatchObject({ status: "failed" });
    });

    it("a missed slot can be rescheduled (back to scheduled, marks cleared) or cancelled", () => {
      const { cal } = setup();
      const s = cal.schedule({ project_id: "p1", channel_id: cal.channels()[0]!.id, publish_at: "2026-09-30T08:00:00Z" });
      cal.tick(new Date("2026-10-01T08:00:00Z"));
      expect(cal.get(s.id)!.status).toBe("missed");
      expect(cal.reschedule(s.id, "2026-10-02T09:00:00Z")).toMatchObject({ status: "scheduled", publish_at: "2026-10-02T09:00:00Z", missed_at: null });
      cal.tick(new Date("2026-10-03T08:00:00Z"));
      expect(cal.cancel(s.id).status).toBe("cancelled");
    });
  });

  describe("gate drift and double-schedule", () => {
    const reRender = (db: ReturnType<typeof setup>["db"], allow = true) =>
      db.insert(renders).values({ id: "r2", project_id: "p1", job_id: "j2", format: "vertical", path: "v2.mp4", manifest_path: "m.json", checks_json: "{}",
        policy_json: JSON.stringify({ allow, deny: [] }), created_at: "2026-09-30T12:00:00Z" }).run();

    it("flags superseded_render when the project was re-rendered, and the tick does not fire it", () => {
      const { cal, db, enqueued } = setup();
      const s = cal.schedule({ project_id: "p1", channel_id: cal.channels()[0]!.id, publish_at: "2026-09-30T13:00:00Z" });
      expect(cal.list()[0]!.drift).toBeNull();
      reRender(db);
      expect(cal.list()[0]!.drift).toBe("superseded_render");
      expect(cal.tick(new Date("2026-09-30T13:01:00Z"))).toBe(0);
      expect(enqueued).toHaveLength(0);
      expect(cal.get(s.id)).toMatchObject({ status: "scheduled" });
      expect(cal.get(s.id)!.error).toMatch(/re-rendered/);
      // the owner's conscious answer: reschedule re-points the slot at the latest render
      const moved = cal.reschedule(s.id, "2026-09-30T14:00:00Z");
      expect(moved).toMatchObject({ render_id: "r2", error: null });
      expect(cal.list()[0]!.drift).toBeNull();
    });

    it("flags gate_denied when the slot's own render no longer passes the gate, and refuses to fire it", () => {
      const { cal, db, enqueued } = setup();
      cal.schedule({ project_id: "p1", channel_id: cal.channels()[0]!.id, publish_at: "2026-09-30T13:00:00Z" });
      db.update(renders).set({ policy_json: JSON.stringify({ allow: false, deny: ["safe-zone violations"] }) }).where(eq(renders.id, "r1")).run();
      expect(cal.list()[0]!.drift).toBe("gate_denied");
      expect(cal.tick(new Date("2026-09-30T13:01:00Z"))).toBe(0);
      expect(enqueued).toHaveLength(0);
      expect(() => cal.reschedule(cal.list()[0]!.id, "2026-09-30T14:00:00Z")).toThrow(/gate/);
    });

    it("refuses to schedule a project that already has an active slot on any render, naming that slot", () => {
      const { cal, db } = setup();
      const yt = cal.channels()[0]!;
      const first = cal.schedule({ project_id: "p1", channel_id: yt.id, publish_at: "2026-09-30T13:00:00Z" });
      reRender(db);
      expect(cal.ready().map((r) => r.render_id)).toEqual(["r2"]); // the re-render reappears as ready
      expect(() => cal.schedule({ project_id: "p1", channel_id: yt.id, publish_at: "2026-09-30T15:00:00Z" })).toThrow(new RegExp(`already on the calendar.*${first.id}`));
      cal.cancel(first.id);
      expect(cal.schedule({ project_id: "p1", channel_id: yt.id, publish_at: "2026-09-30T15:00:00Z" }).render_id).toBe("r2");
    });
  });
});
