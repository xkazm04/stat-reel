/**
 * Calendar (ADR 006): channel management and timing on top of composed videos. Reads GET
 * /api/calendar (channels, ready = gated renders not on the calendar, slots) and /api/metrics
 * (the stored visibility of a published slot). Schedules a ready video on a wired channel
 * (POST /api/calendar), "Publish now" = the same POST at the current time, reschedules (PATCH)
 * and cancels (DELETE). Every schedule/move goes through one validation helper (calendar.ts checkSchedule);
 * known server errors are mapped to the field they belong to (mapScheduleError) and focused with aria-invalid.
 * "Publish now" and "Cancel slot" confirm first. /calendar?project=<id> deep-links to a ready video.
 * Uploads are private only.
 */
import type { Mode } from "@statreel/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { type FormEvent, Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  api,
  type CalendarSlot,
  type Channel,
  type MetricsPublication,
  qk,
  type ReadyVideo,
  type ScheduleBody,
  serverError,
} from "../api";
import {
  bucketByDay,
  type CalendarSearch,
  channelLabel,
  checkSchedule,
  DRIFT_META,
  dateTimeLabel,
  dayKey,
  dayLabel,
  type FieldIssue,
  isUpcoming,
  latestSlotPerProject,
  mapScheduleError,
  moveDefault,
  nextFullHour,
  relWhen,
  SLOT_META,
  type SlotStatusKey,
  slotDrift,
  slotGroups,
  slotStatus,
  splitTags,
  timeLabel,
  toLocalInput,
  weekDays,
  weekLabel,
  weekStart,
  wiredChannels,
} from "../calendar";
import { Defer } from "../components/arrive";
import { Card, CardGrid } from "../components/Card";
import { Arrow, FormatIcon } from "../components/glyphs";
import { identVar } from "../components/idents";
import { artStyle, Empty, Failure, Loading } from "../components/ui";
import { useCalendar, useHeatmap, useMetrics } from "../data";
import { MODE_LABEL, relTime } from "../logic";
import { formatLabel } from "../display";

// ------------------------------------------------------------------ marks

/** Slot status as a drawn shape (label always beside it). */
function SlotMark({ status, size = 14 }: { status: SlotStatusKey; size?: number }) {
  let inner: React.ReactNode;
  if (status === "scheduled")
    inner = (
      <>
        <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 4.2V8l2.6 1.7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </>
    );
  else if (status === "publishing")
    inner = (
      <>
        <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 1.8a6.2 6.2 0 0 1 0 12.4z" fill="currentColor" />
      </>
    );
  else if (status === "published")
    inner = (
      <>
        <rect x="1.5" y="1.5" width="13" height="13" fill="currentColor" />
        <path d="M4.4 8.3l2.4 2.4 4.9-5.2" fill="none" stroke="var(--color-bg)" strokeWidth="1.8" />
      </>
    );
  else if (status === "failed")
    inner = (
      <>
        <rect x="1.75" y="1.75" width="12.5" height="12.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4.6 4.6l6.8 6.8M11.4 4.6l-6.8 6.8" stroke="currentColor" strokeWidth="1.7" />
      </>
    );
  else if (status === "missed")
    inner = (
      <>
        <path d="M8 1.6L14.6 13.6H1.4z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M8 6v3.6M8 11.4v1" stroke="currentColor" strokeWidth="1.7" />
      </>
    );
  else
    inner = (
      <>
        <rect x="1.75" y="1.75" width="12.5" height="12.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2" />
        <path d="M3 8h10" stroke="currentColor" strokeWidth="1.7" />
      </>
    );
  return (
    <svg className="slot-mark" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      {inner}
    </svg>
  );
}

function SlotState({ status }: { status: SlotStatusKey }) {
  return (
    <span className={`slot-st slot-st--${status}`}>
      <SlotMark status={status} />
      <span>{SLOT_META[status].label}</span>
    </span>
  );
}

function ChannelMark({ status }: { status: string }) {
  return <i className={`ch-mark ch-mark--${status}`} aria-hidden="true" />;
}

/** Visibility of a published slot: the stored publication when metrics has it, else v1's rule (private). */
function Visibility({ slot, channel, pubs }: { slot: CalendarSlot; channel: Channel | undefined; pubs: MetricsPublication[] }) {
  const pub = slot.publication_id ? pubs.find((p) => p.publication_id === slot.publication_id) : undefined;
  const dry = pub ? pub.mode === "dry" : channel?.status === "dry";
  return (
    <span className="slot-vis">
      <span className="pub pub--private">
        <i />
        {(pub?.visibility ?? "private").toUpperCase()}
      </span>
      {dry ? <span className="dry">DRY RUN</span> : null}
    </span>
  );
}

// ------------------------------------------------------------------ page

export function CalendarPage() {
  const cal = useCalendar();
  const { project: linked } = useSearch({ from: "/calendar" }) as CalendarSearch;
  const met = useMetrics();
  const hm = useHeatmap();
  const [week, setWeek] = useState(0);
  const channels = cal.data?.channels ?? [];
  const wired = wiredChannels(channels);
  const slots = cal.data?.slots ?? [];
  const ready = cal.data?.ready ?? [];
  const pubs = met.data?.publications ?? [];
  const chById = new Map(channels.map((c) => [c.id, c]));
  const ucName = (id: string) => hm.data?.usecases.find((u) => u.id === id)?.name ?? id;
  const newest = useMemo(() => latestSlotPerProject(slots), [slots]);
  const groups = slotGroups(slots);
  const groupSize = (k: string) => groups.find((g) => g.key === k)?.slots.length ?? 0;

  return (
    <main id="main" className="page cal-page">
      <header className="page__head">
        <div>
          <p className="eyebrow">
            <i />
            Calendar · channels and timing
          </p>
          <h1 className="page__title display">When each video goes out</h1>
          <p className="page__sub">
            Composed videos whose latest render passed the gate, scheduled on a wired channel. At its time the server
            publishes the slot through the publish job.
          </p>
        </div>
        <div className="cal-private" role="note">
          <b>Private only</b>
          <span>
            Every upload is private (YouTube) or a draft (TikTok, later). Making a video public is the owner's call, made
            on the platform itself; this studio never flips visibility.
          </span>
        </div>
      </header>

      {cal.isError ? (
        <Failure error={cal.error} what="The calendar" onRetry={() => void cal.refetch()} retrying={cal.isFetching} />
      ) : cal.isLoading ? (
        <Loading what="the calendar" />
      ) : (
        <>
          <Defer tier={1} id="cal:channels" phClass="cal-channels" minHeight={140}>
            <Card
              className="cal-channels"
              title="Channels"
              tag={channels.length}
              actions={
                <span>
                  {wired.length} wired · {channels.length - wired.length} not wired
                </span>
              }
            >
              {channels.length ? (
                <CardGrid as="ul" min={260} gap="sm" className="ch-cards">
                  {channels.map((c) => {
                    const mine = slots.filter((s) => s.channel_id === c.id);
                    return (
                      <Card as="li" key={c.id} className={`ch-card ch-card--${c.status}`}>
                        <div className="ch-card__h">
                          <b className="ch-card__name">{c.name}</b>
                          <span className={`ch-state ch-state--${c.status}`}>
                            <ChannelMark status={c.status} />
                            {channelLabel(c)}
                          </span>
                        </div>
                        <p className="ch-card__note">{c.note ?? "no note"}</p>
                        <p className="ch-card__n num">
                          {c.status === "not_wired"
                            ? "Cannot take a slot until it is wired."
                            : `${mine.filter((s) => isUpcoming(s.status)).length} upcoming · ${mine.filter((s) => s.status === "published").length} published`}
                        </p>
                      </Card>
                    );
                  })}
                </CardGrid>
              ) : (
                <Empty title="No channel">The server seeds YouTube, TikTok and Instagram; none came back.</Empty>
              )}
            </Card>
          </Defer>

          <Defer tier={linked ? 0 : 2} id="cal:main" minHeight={320}>
            <div className="cal-main">
              <Card
                className="cal-ready"
                title="Ready to schedule"
                tag={ready.length}
                actions={<span>gated, not on the calendar</span>}
              >
                {linked && !ready.some((r) => r.project_id === linked) ? (
                  <p className="cal-note" role="status">
                    {slots.some((s) => s.project_id === linked && (s.status === "scheduled" || s.status === "publishing"))
                      ? `${linked} is already on the calendar; find it under Every slot below.`
                      : `${linked} is not ready to schedule: it needs a render that the publish gate allows.`}
                  </p>
                ) : null}
                {ready.length ? (
                  <ul className="ready-list">
                    {ready.map((r) => (
                      <ReadyItem key={r.project_id} r={r} wired={wired} slots={slots} linked={r.project_id === linked} ucName={ucName(r.use_case_id)} />
                    ))}
                  </ul>
                ) : (
                  <Empty title="Nothing ready">
                    A video becomes ready when Produce renders it and the publish gate allows the latest render. Open a
                    project in the <Link to="/studio">studio</Link> and produce it until the gate says ALLOW.
                  </Empty>
                )}
              </Card>

              <Defer tier={1} id="cal:week" phClass="cal-week" minHeight={320}>
                <WeekView week={week} setWeek={setWeek} slots={slots} chById={chById} />
              </Defer>
            </div>
          </Defer>

          <Defer tier={3} id="cal:slots" visible phClass="cal-slots" minHeight={240}>
            <Card
              className="cal-slots"
              title="Every slot"
              titleId="h-slots"
              titleTabIndex={-1}
              tag={slots.length}
              actions={
                <span>
                  {groupSize("upcoming")} upcoming · {groupSize("history")} done or stopped
                </span>
              }
            >
              {groups.length ? (
                groups.map((g) => (
                  <Fragment key={g.key}>
                    <h3 className="slot-group">{g.label}</h3>
                    <ul className="slot-list">
                      {g.slots.map((s) => (
                        <SlotRow
                          key={s.id}
                          s={s}
                          slots={slots}
                          channel={chById.get(s.channel_id)}
                          pubs={pubs}
                          testid={newest.get(s.project_id)?.id === s.id}
                        />
                      ))}
                    </ul>
                  </Fragment>
                ))
              ) : (
                <Empty title="No slot yet">
                  Schedule a ready video above, or publish it now; slots appear here and on the week.
                </Empty>
              )}
            </Card>
          </Defer>
          <p className="page__foot">
            Times are local ({Intl.DateTimeFormat().resolvedOptions().timeZone}). Scheduled slots can move or be
            cancelled until the tick picks them up; a failed slot keeps the job's error verbatim. A slot more than an
            hour late is marked missed instead of publishing, and a re-rendered video waits for you to reschedule it.
          </p>
        </>
      )}
    </main>
  );
}

// ------------------------------------------------------------------ confirm

/** Native <dialog> confirm (focus trap, Esc, backdrop) for the two actions that cannot be taken back. */
function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  keepLabel,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  keepLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const tid = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="cal-confirm"
      aria-labelledby={tid}
      onClose={onClose}
    >
      <h2 id={tid} className="cal-confirm__t">
        {title}
      </h2>
      <p className="cal-confirm__b">{body}</p>
      <div className="cal-confirm__acts">
        <button type="button" className="btn btn--sm" onClick={() => ref.current?.close()}>
          {keepLabel}
        </button>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          data-testid="confirm-yes"
          onClick={() => {
            ref.current?.close();
            onConfirm();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

/** Focus a form field (or the form-level message) after the error has rendered with aria-invalid. */
const focusId = (id: string) => window.setTimeout(() => document.getElementById(id)?.focus(), 0);

// ------------------------------------------------------------------ ready

function ReadyItem({
  r,
  wired,
  slots,
  linked,
  ucName,
}: {
  r: ReadyVideo;
  wired: Channel[];
  slots: CalendarSlot[];
  linked: boolean;
  ucName: string;
}) {
  const qc = useQueryClient();
  const [channel, setChannel] = useState(wired[0]?.id ?? "");
  const [when, setWhen] = useState(() => toLocalInput(nextFullHour(new Date())));
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [issue, setIssue] = useState<FieldIssue | null>(null);
  const [confirmNow, setConfirmNow] = useState(false);
  const li = useRef<HTMLLIElement>(null);
  const base = `rd-${r.project_id}`;
  const ids = { channel: `${base}-ch`, when: `${base}-when`, form: `${base}-err` } as const;
  const fail = (i: FieldIssue) => {
    setIssue(i);
    focusId(i.field === "form" ? ids.form : ids[i.field]);
  };
  // deep link (/calendar?project=<id>): bring this item into view, mark it and park focus on it
  useEffect(() => {
    if (!linked) return;
    li.current?.scrollIntoView({ block: "center" });
    li.current?.focus({ preventScroll: true });
  }, [linked]);
  const done = () => {
    void qc.invalidateQueries({ queryKey: qk.calendar });
    void qc.invalidateQueries({ queryKey: qk.projects });
    void qc.invalidateQueries({ queryKey: qk.project(r.project_id) });
  };
  const schedule = useMutation({
    mutationFn: (b: ScheduleBody) => api.schedule(b),
    onSuccess: () => {
      done();
      // this item leaves the ready list: keep focus on the slot it became
      window.setTimeout(() => document.getElementById("h-slots")?.focus(), 0);
    },
    onError: (e) => fail(mapScheduleError(serverError(e))),
  });
  const chosen = channel || wired[0]?.id || "";
  const check = checkSchedule({ when, channelId: chosen, now: new Date(), slots });
  const body = (publish_at: string): ScheduleBody => ({
    project_id: r.project_id,
    channel_id: chosen,
    publish_at,
    ...(title.trim() ? { title: title.trim() } : {}),
    ...(description.trim() ? { description: description.trim() } : {}),
    ...(splitTags(tags).length ? { tags: splitTags(tags) } : {}),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (check.error || !check.at) {
      if (check.error) fail(check.error);
      return;
    }
    setIssue(null);
    schedule.mutate(body(check.at));
  };
  const invalid = (f: FieldIssue["field"]) => (issue?.field === f ? true : undefined);
  const described = (f: FieldIssue["field"]) => {
    const parts = [issue?.field === f ? ids.form : "", f === "when" && check.warnings.length ? `${base}-warn` : ""].filter(Boolean);
    return parts.length ? parts.join(" ") : undefined;
  };
  return (
    <li
      ref={li}
      id={base}
      tabIndex={-1}
      className={`ready${linked ? " is-linked" : ""}`}
      data-testid={`ready-${r.project_id}`}
      style={artStyle(identVar(r.use_case_id))}
    >
      <div className="ready__h">
        <Link to="/studio/$projectId" params={{ projectId: r.project_id }} className="ready__t">
          {r.title}
        </Link>
        <span className="ready__m mono">
          <span>{r.project_id}</span>
          <span>{ucName}</span>
          <span>{r.sport}</span>
          <span>
            <FormatIcon format={r.format} h={11} /> {formatLabel(r.format)}
          </span>
          <span>{MODE_LABEL[r.mode as Mode] ?? r.mode}</span>
          <span>rendered {relTime(r.rendered_at)}</span>
        </span>
      </div>
      <form className="ready__form" onSubmit={submit} noValidate>
        <label className="fld">
          <span className="fld__k">Channel</span>
          <select
            id={ids.channel}
            value={chosen}
            onChange={(e) => {
              setChannel(e.target.value);
              setIssue(null);
            }}
            disabled={!wired.length}
            aria-invalid={invalid("channel")}
            aria-describedby={described("channel")}
          >
            {wired.length ? (
              wired.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {channelLabel(c).toLowerCase()}
                </option>
              ))
            ) : (
              <option value="">no wired channel</option>
            )}
          </select>
        </label>
        <label className="fld">
          <span className="fld__k">Date and time</span>
          <input
            id={ids.when}
            type="datetime-local"
            value={when}
            min={check.min}
            onChange={(e) => {
              setWhen(e.target.value);
              setIssue(null);
            }}
            aria-invalid={invalid("when")}
            aria-describedby={described("when")}
          />
        </label>
        <details className="ready__opt">
          <summary>Title, description, tags (optional)</summary>
          <label className="fld">
            <span className="fld__k">Title</span>
            <input type="text" value={title} maxLength={100} placeholder={r.title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="fld">
            <span className="fld__k">Description</span>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="The server adds the method note, every source attribution and the AI disclosure." />
          </label>
          <label className="fld">
            <span className="fld__k">Tags, comma separated</span>
            <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder={`${r.sport}, data`} />
          </label>
        </details>
        <div className="ready__acts">
          <button type="submit" className="btn btn--sm" disabled={!wired.length || schedule.isPending}>
            {schedule.isPending ? "Sending" : "Schedule"}
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            data-testid={`publish-now-${r.project_id}`}
            disabled={!wired.length || schedule.isPending}
            onClick={() => setConfirmNow(true)}
          >
            Publish now <Arrow />
          </button>
        </div>
      </form>
      {check.warnings.length ? (
        <p id={`${base}-warn`} className="cal-warn" aria-live="polite">
          {check.warnings.map((w) => w.message).join(" ")}
        </p>
      ) : null}
      {issue ? (
        <p id={ids.form} tabIndex={-1} className="cal-err" role="alert">
          {issue.message}
        </p>
      ) : null}
      {!wired.length ? <p className="cal-err">No channel is wired, so nothing can be scheduled.</p> : null}
      <ConfirmDialog
        open={confirmNow}
        title={`Publish "${r.title}" now?`}
        body={`${r.title} uploads right away to ${wired.find((c) => c.id === chosen)?.name ?? "the channel"} as a private video. You make it public on the platform yourself.`}
        confirmLabel="Publish now"
        keepLabel="Not yet"
        onClose={() => setConfirmNow(false)}
        onConfirm={() => {
          setIssue(null);
          schedule.mutate(body(new Date().toISOString()));
        }}
      />
    </li>
  );
}

// ------------------------------------------------------------------ week

function WeekView({
  week,
  setWeek,
  slots,
  chById,
}: {
  week: number;
  setWeek: (n: number) => void;
  slots: CalendarSlot[];
  chById: Map<string, Channel>;
}) {
  const now = new Date();
  const start = weekStart(now, week);
  const days = weekDays(start);
  const buckets = bucketByDay(slots, start);
  const today = dayKey(now);
  const count = [...buckets.values()].reduce((a, l) => a + l.length, 0);
  return (
    <Card
      className="cal-week"
      title="Week"
      tag={`${weekLabel(start)} · ${count} slot${count === 1 ? "" : "s"}`}
      pad="none"
      actions={
        <div className="seg seg--sm" role="group" aria-label="Week">
          <button type="button" onClick={() => setWeek(week - 1)}>
            Previous
          </button>
          <button type="button" aria-pressed={week === 0} onClick={() => setWeek(0)}>
            This week
          </button>
          <button type="button" onClick={() => setWeek(week + 1)}>
            Next
          </button>
        </div>
      }
    >
      <ol className="week">
        {days.map((d) => {
          const k = dayKey(d);
          const list = buckets.get(k) ?? [];
          const l = dayLabel(d);
          return (
            <li key={k} className={`day${k === today ? " is-today" : ""}${d < new Date(now.getFullYear(), now.getMonth(), now.getDate()) ? " is-past" : ""}`}>
              <h3 className="day__h">
                <span className="day__dow">{l.dow}</span>
                <span className="day__date num">{l.date}</span>
                {k === today ? <span className="day__today">today</span> : null}
              </h3>
              {list.length ? (
                <ul className="day__slots">
                  {list.map((s) => {
                    const st = slotStatus(s.status);
                    return (
                      <li key={s.id} className={`wk-slot wk-slot--${st}`} style={artStyle(identVar(s.project?.use_case_id ?? ""))}>
                        <span className="wk-slot__t num">{timeLabel(s.publish_at)}</span>
                        <SlotState status={st} />
                        <Link to="/studio/$projectId" params={{ projectId: s.project_id }} className="wk-slot__p">
                          {s.title ?? s.project?.title ?? s.project_id}
                        </Link>
                        <span className="wk-slot__c">{chById.get(s.channel_id)?.name ?? s.channel_id}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="day__none">no slot</p>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

// ------------------------------------------------------------------ list

function SlotRow({
  s,
  slots,
  channel,
  pubs,
  testid,
}: {
  s: CalendarSlot;
  slots: CalendarSlot[];
  channel: Channel | undefined;
  pubs: MetricsPublication[];
  testid: boolean;
}) {
  const qc = useQueryClient();
  const st = slotStatus(s.status);
  const drift = slotDrift(s);
  const missedAt = (s as { missed_at?: string | null }).missed_at ?? null;
  const [when, setWhen] = useState(() => moveDefault(s, new Date()));
  const [issue, setIssue] = useState<FieldIssue | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const inputId = `mv-${s.id}`;
  const errId = `mv-${s.id}-err`;
  const fail = (i: FieldIssue) => {
    setIssue(i);
    focusId(i.field === "form" ? errId : inputId);
  };
  const done = () => void qc.invalidateQueries({ queryKey: qk.calendar });
  const move = useMutation({
    mutationFn: (at: string) => api.reschedule(s.id, at),
    onSuccess: done,
    onError: (e) => fail(mapScheduleError(serverError(e))),
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelSlot(s.id),
    onSuccess: done,
    onError: (e) => fail(mapScheduleError(serverError(e))),
  });
  const check = checkSchedule({ when, channelId: s.channel_id, now: new Date(), slots, ignoreSlotId: s.id });
  const title = s.title ?? s.project?.title ?? s.project_id;
  const actionable = st === "scheduled" || st === "missed";
  const moveLabel = st === "missed" || drift ? "Reschedule" : "Move";
  return (
    <li className={`slot slot--${st}`} data-testid={testid ? `slot-${s.project_id}` : undefined} style={artStyle(identVar(s.project?.use_case_id ?? ""))}>
      <span className="slot__when">
        <b className="num">{dateTimeLabel(s.publish_at)}</b>
        <span className="slot__rel">{relWhen(s.publish_at)}</span>
      </span>
      <SlotState status={st} />
      <span className="slot__what">
        <Link to="/studio/$projectId" params={{ projectId: s.project_id }} className="slot__t">
          {title}
        </Link>
        <span className="slot__m mono">
          {s.project_id} · {channel?.name ?? s.channel_id} · {SLOT_META[st].hint}
          {st === "missed" && missedAt ? ` (found ${dateTimeLabel(missedAt)})` : ""}
        </span>
        {drift ? (
          <span className="slot__drift mono" data-testid={`drift-${s.id}`}>
            <b>{DRIFT_META[drift].label}</b> {DRIFT_META[drift].hint}
          </span>
        ) : null}
      </span>
      <span className="slot__side">
        {st === "published" ? <Visibility slot={s} channel={channel} pubs={pubs} /> : null}
        {st === "failed" ? <span className="slot__err mono">{s.error ?? "no error text"}</span> : null}
        {actionable ? (
          <form
            className="slot__acts"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (check.error || !check.at) {
                if (check.error) fail(check.error);
                return;
              }
              setIssue(null);
              move.mutate(check.at);
            }}
          >
            <label className="sr-only" htmlFor={inputId}>
              New date and time
            </label>
            <input
              id={inputId}
              type="datetime-local"
              value={when}
              min={check.min}
              onChange={(e) => {
                setWhen(e.target.value);
                setIssue(null);
              }}
              aria-invalid={issue && issue.field !== "form" ? true : undefined}
              aria-describedby={issue ? errId : check.warnings.length ? `${inputId}-warn` : undefined}
            />
            <button type="submit" className="btn btn--sm" disabled={move.isPending}>
              {move.isPending ? "Moving" : moveLabel}
            </button>
            <button type="button" className="btn btn--sm btn--ghost" disabled={cancel.isPending} onClick={() => setConfirmCancel(true)}>
              {cancel.isPending ? "Cancelling" : "Cancel slot"}
            </button>
          </form>
        ) : null}
      </span>
      {actionable && check.warnings.length && !issue ? (
        <p id={`${inputId}-warn`} className="cal-warn slot__msg" aria-live="polite">
          {check.warnings.map((w) => w.message).join(" ")}
        </p>
      ) : null}
      {issue ? (
        <p id={errId} tabIndex={-1} className="cal-err slot__msg" role="alert">
          {issue.message}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirmCancel}
        title={`Cancel the slot for "${title}"?`}
        body={`${title} comes off the calendar (${dateTimeLabel(s.publish_at)} on ${channel?.name ?? s.channel_id}); it returns to Ready to schedule if its render still passes the gate.`}
        confirmLabel="Cancel slot"
        keepLabel="Keep slot"
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => {
          setIssue(null);
          cancel.mutate();
        }}
      />
    </li>
  );
}
