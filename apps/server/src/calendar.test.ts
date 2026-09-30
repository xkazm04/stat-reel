import { describe, expect, it } from "vitest";
import { CalendarService } from "./calendar";
import { openDb, projects, renders } from "./db";
import { EventBus } from "./events";

function setup(opts: { allow?: boolean } = {}) {
  const db = openDb(":memory:");
  const bus = new EventBus();
  const enqueued: { params: Record<string, unknown>; id: string }[] = [];
  const publish = (params: Record<string, unknown>) => {
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
});
