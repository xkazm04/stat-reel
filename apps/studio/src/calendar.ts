/**
 * Pure Calendar helpers (ADR 006): week bounds and day bucketing in local time, datetime-local
 * <-> ISO, slot status vocabulary, channel wiring, the newest slot per project. No React, no DOM
 * (unit-tested in calendar.test.ts).
 */

export type SlotLike = { id: string; project_id: string; publish_at: string; status: string; created_at: string };
export type ChannelLike = { id: string; name: string; status: string; note: string | null };

const p2 = (n: number): string => String(n).padStart(2, "0");

/** Local midnight of the Monday of the week containing `d`, shifted by `offset` weeks. */
export function weekStart(d: Date, offset = 0): Date {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (s.getDay() + 6) % 7; // Monday = 0
  s.setDate(s.getDate() - dow + offset * 7);
  return s;
}

/** The seven local days of a week starting at `start`. */
export function weekDays(start: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

/** "YYYY-MM-DD" in local time. */
export const dayKey = (d: Date): string => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

/** Slots of the week starting at `start`, bucketed by local day, time-ordered. */
export function bucketByDay<T extends SlotLike>(slots: T[], start: Date): Map<string, T[]> {
  const days = weekDays(start);
  const out = new Map<string, T[]>(days.map((d) => [dayKey(d), []]));
  for (const s of slots) {
    const t = new Date(s.publish_at);
    if (Number.isNaN(t.getTime())) continue;
    const list = out.get(dayKey(t));
    if (list) list.push(s);
  }
  for (const list of out.values()) list.sort((a, b) => a.publish_at.localeCompare(b.publish_at));
  return out;
}

/** A Date as the value of an <input type="datetime-local"> (local time, minutes). */
export const toLocalInput = (d: Date): string =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;

/** A datetime-local value as an ISO instant; null when empty or not a date. */
export function fromLocalInput(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The next full hour after `now` (the schedule form's default). */
export function nextFullHour(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0, 0);
  return d;
}

export type SlotStatusKey = "scheduled" | "publishing" | "published" | "failed" | "cancelled";
/** Every slot status as shape + label (the label is literal text, never colour-only). */
export const SLOT_META: Record<SlotStatusKey, { label: string; hint: string }> = {
  scheduled: { label: "SCHEDULED", hint: "waits for its time; the server tick publishes it" },
  publishing: { label: "PUBLISHING", hint: "the publish job is uploading" },
  published: { label: "PUBLISHED", hint: "uploaded" },
  failed: { label: "FAILED", hint: "the publish job did not finish" },
  cancelled: { label: "CANCELLED", hint: "taken off the calendar" },
};
export const slotStatus = (s: string): SlotStatusKey => (s in SLOT_META ? (s as SlotStatusKey) : "failed");
export const isUpcoming = (s: string): boolean => s === "scheduled" || s === "publishing";

/** The newest slot (by created_at, then publish_at) of each project. */
export function latestSlotPerProject<T extends SlotLike>(slots: T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const s of slots) {
    const cur = out.get(s.project_id);
    if (!cur || s.created_at > cur.created_at || (s.created_at === cur.created_at && s.publish_at > cur.publish_at))
      out.set(s.project_id, s);
  }
  return out;
}

/** Channels a video can be scheduled on (live or dry); not_wired channels refuse. */
export const wiredChannels = <T extends ChannelLike>(channels: T[]): T[] =>
  channels.filter((c) => c.status === "live" || c.status === "dry");

/** The milestone a note names ("... - milestone M5" -> "M5"). */
export function milestoneOf(note: string | null | undefined): string | null {
  return /\b(M\d+)\b/.exec(note ?? "")?.[1] ?? null;
}

/** A channel's state as a label. */
export function channelLabel(c: ChannelLike): string {
  if (c.status === "live") return "LIVE";
  if (c.status === "dry") return "DRY RUN";
  if (c.status === "not_wired") {
    const m = milestoneOf(c.note);
    return `NOT WIRED YET${m ? ` (${m})` : ""}`;
  }
  return c.status.toUpperCase();
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mon" + "28 Sep" day label, "28 Sep – 4 Oct 2026" week label, "14:00", "Wed 30 Sep, 14:00" (local). */
export const dayLabel = (d: Date): { dow: string; date: string } => ({
  dow: DOW[d.getDay()] ?? "",
  date: `${d.getDate()} ${MON[d.getMonth()] ?? ""}`,
});
export function weekLabel(start: Date): string {
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return `${dayLabel(start).date} – ${dayLabel(end).date} ${end.getFullYear()}`;
}
export const timeLabel = (iso: string): string => {
  const d = new Date(iso);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
};
export const dateTimeLabel = (iso: string): string => {
  const d = new Date(iso);
  const l = dayLabel(d);
  return `${l.dow} ${l.date}, ${timeLabel(iso)}`;
};

/** Comma-separated tags -> trimmed, non-empty. */
export const splitTags = (s: string): string[] =>
  s
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

/** Relative time either side of now: "in 3 h", "12 min ago", "now". */
export function relWhen(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const d = (t - now) / 1000;
  const a = Math.abs(d);
  if (a < 45) return "now";
  const v = a < 3600 ? `${Math.round(a / 60)} min` : a < 86400 ? `${Math.round(a / 3600)} h` : `${Math.round(a / 86400)} d`;
  return d > 0 ? `in ${v}` : `${v} ago`;
}
