import { describe, expect, it } from "vitest";
import { SLOT_STATUSES } from "./api";
import {
  bucketByDay,
  channelLabel,
  checkSchedule,
  dayKey,
  fromLocalInput,
  latestSlotPerProject,
  mapScheduleError,
  milestoneOf,
  moveDefault,
  needsDecision,
  nextFullHour,
  parseCalendarSearch,
  relWhen,
  SLOT_META,
  slotDrift,
  slotGroups,
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
  it("picks the unit after rounding: never 60 min or 24 h (parity with logic.ts relTime)", () => {
    const now = Date.parse("2026-09-30T12:00:00Z");
    const at = (s: number) => new Date(now + s * 1000).toISOString();
    expect(relWhen(at(3599), now)).toBe("in 1 h");
    expect(relWhen(at(-3599), now)).toBe("1 h ago");
    expect(relWhen(at(86399), now)).toBe("in 1 d");
    expect(relWhen(at(-86399), now)).toBe("1 d ago");
    // every other age reads as before
    expect(relWhen(at(90), now)).toBe("in 2 min");
    expect(relWhen(at(-5400), now)).toBe("2 h ago");
    expect(relWhen(at(3 * 86400), now)).toBe("in 3 d");
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

describe("checkSchedule (the one validation door)", () => {
  const now = new Date(2026, 8, 30, 12, 0);
  const slots = [
    { id: "sl-a", channel_id: "ch-yt", publish_at: new Date(2026, 9, 1, 9, 0).toISOString(), status: "scheduled" },
  ];
  const base = { channelId: "ch-yt", now, slots };
  it("blocks an empty time", () => {
    const c = checkSchedule({ ...base, when: "" });
    expect(c.at).toBeNull();
    expect(c.error).toEqual({ field: "when", message: "Pick a date and time." });
  });
  it("warns, not blocks, on a past time and exposes min", () => {
    const c = checkSchedule({ ...base, when: toLocalInput(new Date(2026, 8, 30, 9, 0)) });
    expect(c.error).toBeNull();
    expect(c.at).not.toBeNull();
    expect(c.min).toBe("2026-09-30T12:00");
    expect(c.warnings.map((w) => w.field)).toEqual(["when"]);
    expect(c.warnings[0]?.message).toMatch(/has passed/);
  });
  it("warns on a same-channel same-minute clash, but not on another channel or the slot being moved", () => {
    const when = toLocalInput(new Date(2026, 9, 1, 9, 0));
    expect(checkSchedule({ ...base, when }).warnings[0]?.message).toMatch(/already set for this channel at 09:00/);
    expect(checkSchedule({ ...base, when, channelId: "ch-tt" }).warnings).toEqual([]);
    expect(checkSchedule({ ...base, when, ignoreSlotId: "sl-a" }).warnings).toEqual([]);
  });
  it("a clean future time has no issue", () => {
    const c = checkSchedule({ ...base, when: toLocalInput(new Date(2026, 9, 2, 9, 0)) });
    expect(c.error).toBeNull();
    expect(c.warnings).toEqual([]);
  });
});

describe("mapScheduleError", () => {
  it("maps the known server errors to a field with a plain message", () => {
    expect(mapScheduleError("TikTok is not wired yet (Content Posting API - milestone M5)")).toMatchObject({
      field: "channel",
    });
    expect(mapScheduleError("publish_at is not a date: x").field).toBe("when");
    const gate = mapScheduleError(
      "the publish gate has not allowed this project's latest render: safe-zone violations",
    );
    expect(gate.field).toBe("form");
    expect(gate.message).toMatch(/safe-zone violations/);
    expect(
      mapScheduleError("this project is already on the calendar (slot sl-1, scheduled for 2026-10-01T09:00:00Z)")
        .message,
    ).toMatch(/slot sl-1/);
    expect(mapScheduleError("this render is already on the calendar (slot sl-2, published)").field).toBe("form");
    expect(mapScheduleError("only a scheduled or missed slot can move").field).toBe("form");
  });
  it("never prefixes a raw Server label", () => {
    expect(mapScheduleError("boom").message).toBe("boom");
  });
});

describe("slotGroups", () => {
  const s = (id: string, status: string, drift: "gate_denied" | null = null) => ({ id, status, drift });
  it("returns only the groups that hold a slot, in decision / upcoming / history order", () => {
    // the common case: nothing to decide, nothing done yet -> one group, no empty lists
    expect(slotGroups([s("a", "scheduled"), s("b", "publishing")]).map((g) => g.key)).toEqual(["upcoming"]);
    expect(slotGroups([]).length).toBe(0);
    const all = slotGroups([
      s("p1", "published"),
      s("m", "missed"),
      s("u", "scheduled"),
      s("d", "scheduled", "gate_denied"),
      s("p2", "failed"),
    ]);
    expect(all.map((g) => [g.key, g.slots.map((x) => x.id)])).toEqual([
      ["attention", ["m", "d"]],
      ["upcoming", ["u"]],
      ["history", ["p2", "p1"]], // newest first
    ]);
    expect(all.map((g) => g.label)).toEqual(["Needs your decision", "Upcoming", "History"]);
  });
});

describe("moveDefault", () => {
  const now = new Date(2026, 8, 30, 12, 20);
  it("a missed slot starts at the next full hour, not at the time it already missed", () => {
    const missed = { status: "missed", publish_at: new Date(2026, 8, 30, 9, 0).toISOString() };
    expect(moveDefault(missed, now)).toBe("2026-09-30T13:00");
    // that default passes the validation door without a "has passed" warning
    expect(checkSchedule({ when: moveDefault(missed, now), channelId: "ch", now, slots: [] }).warnings).toEqual([]);
  });
  it("any other slot starts at its own time", () => {
    const at = new Date(2026, 9, 1, 9, 30);
    expect(moveDefault({ status: "scheduled", publish_at: at.toISOString() }, now)).toBe("2026-10-01T09:30");
  });
});

describe("drift and missed", () => {
  it("narrows the drift field and flags slots the owner must decide on", () => {
    expect(slotDrift({ drift: "superseded_render" })).toBe("superseded_render");
    expect(slotDrift({})).toBeNull();
    expect(needsDecision({ status: "missed" })).toBe(true);
    expect(needsDecision({ status: "scheduled", drift: "gate_denied" })).toBe(true);
    expect(needsDecision({ status: "scheduled" })).toBe(false);
    expect(slotStatus("missed")).toBe("missed");
  });
});

describe("slot status parity with the server", () => {
  // Fixture: the statuses apps/server/src/calendar.ts writes (header "Slot states and the transitions"); the
  // server has no exported list, so a new status there must land here, in SLOT_STATUSES and in SLOT_META.
  const SERVER_STATUSES = ["scheduled", "publishing", "published", "failed", "cancelled", "missed"];
  it("types exactly the server's statuses and gives each a label", () => {
    expect([...SLOT_STATUSES].sort()).toEqual([...SERVER_STATUSES].sort());
    expect(Object.keys(SLOT_META).sort()).toEqual([...SERVER_STATUSES].sort());
  });
});

describe("parseCalendarSearch", () => {
  it("keeps a non-empty project id only", () => {
    expect(parseCalendarSearch({ project: " p-1 " })).toEqual({ project: "p-1" });
    expect(parseCalendarSearch({ project: "" })).toEqual({});
    expect(parseCalendarSearch({ project: 5 })).toEqual({});
  });
});
