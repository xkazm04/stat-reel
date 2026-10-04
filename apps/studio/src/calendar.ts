/**
 * Pure Calendar helpers (ADR 006): week bounds and day bucketing in local time, datetime-local
 * <-> ISO, slot status vocabulary, channel wiring, the newest slot per project. No React, no DOM
 * (unit-tested in calendar.test.ts).
 */

import type { SlotDrift, SlotStatus } from "./api";

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

/**
 * The move form's starting value. A missed slot starts at the next full hour: its own time has
 * passed, so sending it back unchanged would only be marked missed again at the next tick.
 */
export function moveDefault(s: { status: string; publish_at: string }, now: Date): string {
  return toLocalInput(s.status === "missed" ? nextFullHour(now) : new Date(s.publish_at));
}

export type SlotStatusKey = SlotStatus;
/** Every slot status as shape + label (the label is literal text, never colour-only). */
export const SLOT_META: Record<SlotStatusKey, { label: string; hint: string }> = {
  scheduled: { label: "SCHEDULED", hint: "waits for its time; the server tick publishes it" },
  publishing: { label: "PUBLISHING", hint: "the publish job is uploading" },
  published: { label: "PUBLISHED", hint: "uploaded" },
  failed: { label: "FAILED", hint: "the publish job did not finish" },
  cancelled: { label: "CANCELLED", hint: "taken off the calendar" },
  missed: { label: "MISSED", hint: "its time passed while the server was not ticking; nothing was published" },
};
export const slotStatus = (s: string): SlotStatusKey => (s in SLOT_META ? (s as SlotStatusKey) : "failed");
export const isUpcoming = (s: string): boolean => s === "scheduled" || s === "publishing";

/** Drift the server reports on a slot (apps/server/src/calendar.ts SlotView; typed in api.ts). */
export type { SlotDrift };
export const slotDrift = (s: { drift?: SlotDrift | null }): SlotDrift | null => s.drift ?? null;
export const DRIFT_META: Record<SlotDrift, { label: string; hint: string }> = {
  superseded_render: { label: "RE-RENDERED", hint: "the project was re-rendered after this slot was set; it will not fire until you reschedule it onto the new render" },
  gate_denied: { label: "GATE DENIED", hint: "the publish gate no longer allows this render; it will not fire" },
};
/** A slot the owner has to act on: missed, or held back by drift. */
export const needsDecision = (s: { status: string; drift?: SlotDrift | null }): boolean =>
  s.status === "missed" || (s.status === "scheduled" && slotDrift(s) !== null);

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

// ------------------------------------------------------------------ the one validation door

export type FieldKey = "channel" | "when" | "form";
export type FieldIssue = { field: FieldKey; message: string };
export type ScheduleCheck = {
  /** the instant to send, null when the time field is unusable */
  at: string | null;
  /** blocks submit */
  error: FieldIssue | null;
  /** shown, does not block */
  warnings: FieldIssue[];
  /** the value for the input's `min` attribute (now, local, minutes) */
  min: string;
};

/**
 * Validate a schedule / move form in one place (form: one validation door). Empty time blocks; a past time
 * and a same-channel same-minute clash only warn - the server decides (a slot up to its missed window late
 * still fires on the next tick, older becomes MISSED). `slots` are the calendar's slots; `ignoreSlotId`
 * excludes the slot being moved.
 */
export function checkSchedule(input: {
  when: string;
  channelId: string;
  now: Date;
  slots: { id: string; channel_id: string; publish_at: string; status: string; title?: string | null }[];
  ignoreSlotId?: string;
}): ScheduleCheck {
  const min = toLocalInput(input.now);
  const at = fromLocalInput(input.when);
  if (!at) return { at: null, error: { field: "when", message: "Pick a date and time." }, warnings: [], min };
  const warnings: FieldIssue[] = [];
  if (new Date(at).getTime() < input.now.getTime() - 60_000)
    warnings.push({ field: "when", message: `That time has passed (earliest ${min.replace("T", " ")}). The server publishes a slot up to an hour late at its next tick; older ones are marked missed.` });
  const minute = Math.floor(new Date(at).getTime() / 60_000);
  const clash = input.slots.find(
    (s) => s.id !== input.ignoreSlotId && s.channel_id === input.channelId && (s.status === "scheduled" || s.status === "publishing")
      && Math.floor(new Date(s.publish_at).getTime() / 60_000) === minute,
  );
  if (clash) warnings.push({ field: "when", message: `Another video is already set for this channel at ${timeLabel(clash.publish_at)}.` });
  return { at, error: null, warnings, min };
}

/**
 * Map a server error text (apps/server/src/calendar.ts) to the field it belongs to and a plain message.
 * Unknown texts stay on the form, still without a raw "Server" label.
 */
export function mapScheduleError(text: string): FieldIssue {
  if (/not wired yet/i.test(text)) return { field: "channel", message: `${text.replace(/ \(.*\)$/, "")}; pick a wired channel.` };
  if (/unknown channel/i.test(text)) return { field: "channel", message: "That channel no longer exists; pick another." };
  if (/not a date/i.test(text)) return { field: "when", message: "That is not a valid date and time." };
  const on = /already on the calendar \((slot [^)]*)\)/i.exec(text);
  if (on) return { field: "form", message: `This video is already on the calendar (${on[1]}). Move or cancel that slot instead.` };
  if (/already on the calendar/i.test(text)) return { field: "form", message: "This video is already on the calendar. Move or cancel that slot instead." };
  if (/publish gate has not allowed/i.test(text)) {
    const why = /: (.+)$/.exec(text)?.[1];
    return { field: "form", message: `The publish gate does not allow this video's latest render${why ? ` (${why})` : ""}. Fix it in Produce first.` };
  }
  if (/only a scheduled or missed slot/i.test(text)) return { field: "form", message: "This slot has already moved on (published, failed or cancelled), so it can no longer change." };
  return { field: "form", message: text };
}

/** Search params of /calendar: `project` deep-links a ready video (ControlRoom -> Calendar). */
export type CalendarSearch = { project?: string };
export function parseCalendarSearch(s: Record<string, unknown>): CalendarSearch {
  return typeof s.project === "string" && s.project.trim() ? { project: s.project.trim() } : {};
}
