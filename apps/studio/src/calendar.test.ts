import { describe, expect, it } from "vitest";
import {
  bucketByDay,
  channelLabel,
  dayKey,
  fromLocalInput,
  latestSlotPerProject,
  milestoneOf,
  nextFullHour,
  relWhen,
  slotStatus,
  splitTags,
  toLocalInput,
  weekDays,
  weekStart,
  wiredChannels,
} from "./calendar";

const slot = (id: string, project_id: string, publish_at: string, created_at: string, status = "scheduled") => ({
  id,
  project_id,
  publish_at,
  status,
  created_at,
});

describe("weeks", () => {
  it("starts on the local Monday, at midnight, with offsets", () => {
    const wed = new Date(2026, 8, 30, 15, 20); // Wed 30 Sep 2026
    const s = weekStart(wed);
    expect([s.getFullYear(), s.getMonth(), s.getDate(), s.getHours()]).toEqual([2026, 8, 28, 0]);
    expect(weekStart(wed, 1).getDate()).toBe(5);
    expect(weekStart(new Date(2026, 9, 4, 23)).getDate()).toBe(28); // Sunday belongs to the week before
    expect(weekDays(s).map(dayKey)).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
  });

  it("buckets slots by local day, time-ordered, and drops other weeks", () => {
    const start = weekStart(new Date(2026, 8, 30));
    const a = slot("a", "p1", new Date(2026, 8, 30, 18).toISOString(), "1");
    const b = slot("b", "p2", new Date(2026, 8, 30, 9).toISOString(), "1");
    const c = slot("c", "p3", new Date(2026, 9, 9, 9).toISOString(), "1");
    const m = bucketByDay([a, b, c], start);
    expect(m.get("2026-09-30")?.map((s) => s.id)).toEqual(["b", "a"]);
    expect([...m.values()].flat().length).toBe(2);
  });
});

describe("datetime-local", () => {
  it("round-trips local time and rejects junk", () => {
    const d = new Date(2026, 9, 1, 7, 5);
    expect(toLocalInput(d)).toBe("2026-10-01T07:05");
    expect(fromLocalInput("2026-10-01T07:05")).toBe(d.toISOString());
    expect(fromLocalInput("")).toBeNull();
    expect(fromLocalInput("tomorrow")).toBeNull();
  });
  it("defaults to the next full hour", () => {
    const n = nextFullHour(new Date(2026, 8, 30, 23, 40));
    expect([n.getDate(), n.getHours(), n.getMinutes()]).toEqual([1, 0, 0]);
  });
});

describe("slots and channels", () => {
  it("keeps the newest slot per project", () => {
    const m = latestSlotPerProject([
      slot("old", "p1", "2026-10-01T10:00:00Z", "2026-09-30T10:00:00Z", "cancelled"),
      slot("new", "p1", "2026-10-02T10:00:00Z", "2026-09-30T11:00:00Z"),
      slot("x", "p2", "2026-10-02T10:00:00Z", "2026-09-30T09:00:00Z"),
    ]);
    expect(m.get("p1")?.id).toBe("new");
    expect(m.get("p2")?.id).toBe("x");
  });
  it("maps unknown statuses to failed, never to a success", () => {
    expect(slotStatus("published")).toBe("published");
    expect(slotStatus("weird")).toBe("failed");
  });
  it("labels channels and only lets wired ones schedule", () => {
    const ch = [
      { id: "ch-youtube", name: "YouTube", status: "dry", note: "dry run" },
      { id: "ch-tiktok", name: "TikTok", status: "not_wired", note: "Content Posting API (drafts) - milestone M5" },
      { id: "ch-x", name: "X", status: "live", note: null },
    ];
    expect(wiredChannels(ch).map((c) => c.id)).toEqual(["ch-youtube", "ch-x"]);
    expect(channelLabel(ch[1] as (typeof ch)[number])).toBe("NOT WIRED YET (M5)");
    expect(channelLabel(ch[0] as (typeof ch)[number])).toBe("DRY RUN");
    expect(milestoneOf(null)).toBeNull();
  });
  it("splits tags", () => {
    expect(splitTags(" F1, data ,,era ")).toEqual(["F1", "data", "era"]);
  });
});

describe("relWhen", () => {
  it("reads both sides of now", () => {
    const now = Date.parse("2026-09-30T12:00:00Z");
    
    expect(relWhen("2026-09-30T15:00:00Z", now)).toBe("in 3 h");
    expect(relWhen("2026-09-30T11:48:00Z", now)).toBe("12 min ago");
    expect(relWhen("2026-09-30T12:00:10Z", now)).toBe("now");
  });
});

describe("labels", () => {
  it("formats days and weeks in local time", async () => {
    const { dayLabel, weekLabel, dateTimeLabel } = await import("./calendar");
    expect(dayLabel(new Date(2026, 8, 28))).toEqual({ dow: "Mon", date: "28 Sep" });
    expect(weekLabel(new Date(2026, 8, 28))).toBe("28 Sep – 4 Oct 2026");
    expect(dateTimeLabel(new Date(2026, 8, 30, 9, 5).toISOString())).toBe("Wed 30 Sep, 09:05");
  });
});
