/**
 * Calendar (ADR 006): channel management and timing on top of composed videos. Reads GET
 * /api/calendar (channels, ready = gated renders not on the calendar, slots) and /api/metrics
 * (the stored visibility of a published slot). Schedules a ready video on a wired channel
 * (POST /api/calendar), "Publish now" = the same POST at the current time, reschedules (PATCH)
 * and cancels (DELETE). Server errors are shown verbatim. Uploads are private only.
 */
import type { Mode } from "@statreel/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useMemo, useState } from "react";
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
  channelLabel,
  dateTimeLabel,
  dayKey,
  dayLabel,
  fromLocalInput,
  isUpcoming,
  latestSlotPerProject,
  nextFullHour,
  relWhen,
  SLOT_META,
  type SlotStatusKey,
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
import { Arrow, FormatIcon } from "../components/glyphs";
import { identVar } from "../components/idents";
import { artStyle, Empty, Failure, Loading } from "../components/ui";
import { useCalendar, useHeatmap, useMetrics } from "../data";
import { MODE_LABEL, relTime } from "../logic";
import { formatLabel } from "../onair";

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
  const upcoming = slots.filter((s) => isUpcoming(s.status));
  const history = slots.filter((s) => !isUpcoming(s.status)).reverse();

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
        <Failure error={cal.error} what="The calendar" />
      ) : cal.isLoading ? (
        <Loading what="the calendar" />
      ) : (
        <>
          <Defer tier={1} id="cal:channels" phClass="cal-channels" minHeight={140}>
            <section className="cal-channels" aria-labelledby="h-channels">
              <h2 className="sec-h sec-h--page" id="h-channels">
                <span>Channels · {channels.length}</span>
                <span>
                  {wired.length} wired · {channels.length - wired.length} not wired
                </span>
              </h2>
              {channels.length ? (
                <ul className="ch-cards">
                  {channels.map((c) => {
                    const mine = slots.filter((s) => s.channel_id === c.id);
                    return (
                      <li key={c.id} className={`ch-card ch-card--${c.status}`}>
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
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Empty title="No channel">The server seeds YouTube, TikTok and Instagram; none came back.</Empty>
              )}
            </section>
          </Defer>

          <Defer tier={2} id="cal:main" minHeight={320}>
            <div className="cal-main">
              <section className="cal-ready" aria-labelledby="h-ready">
                <h2 className="sec-h sec-h--page" id="h-ready">
                  <span>Ready to schedule · {ready.length}</span>
                  <span>gated, not on the calendar</span>
                </h2>
                {ready.length ? (
                  <ul className="ready-list">
                    {ready.map((r) => (
                      <ReadyItem key={r.project_id} r={r} wired={wired} ucName={ucName(r.use_case_id)} />
                    ))}
                  </ul>
                ) : (
                  <Empty title="Nothing ready">
                    A video becomes ready when Produce renders it and the publish gate allows the latest render. Open a
                    project in the <Link to="/studio">studio</Link> and produce it until the gate says ALLOW.
                  </Empty>
                )}
              </section>

              <Defer tier={1} id="cal:week" phClass="cal-week" minHeight={320}>
                <WeekView week={week} setWeek={setWeek} slots={slots} chById={chById} />
              </Defer>
            </div>
          </Defer>

          <Defer tier={3} id="cal:slots" visible phClass="cal-slots" minHeight={240}>
            <section className="cal-slots" aria-labelledby="h-slots">
              <h2 className="sec-h sec-h--page" id="h-slots" tabIndex={-1}>
                <span>Every slot · {slots.length}</span>
                <span>
                  {upcoming.length} upcoming · {history.length} done or stopped
                </span>
              </h2>
              {slots.length ? (
                <>
                  {upcoming.length ? <h3 className="slot-group">Upcoming</h3> : null}
                  <ul className="slot-list">
                    {upcoming.map((s) => (
                      <SlotRow
                        key={s.id}
                        s={s}
                        channel={chById.get(s.channel_id)}
                        pubs={pubs}
                        testid={newest.get(s.project_id)?.id === s.id}
                      />
                    ))}
                  </ul>
                  {history.length ? <h3 className="slot-group">History</h3> : null}
                  <ul className="slot-list">
                    {history.map((s) => (
                      <SlotRow
                        key={s.id}
                        s={s}
                        channel={chById.get(s.channel_id)}
                        pubs={pubs}
                        testid={newest.get(s.project_id)?.id === s.id}
                      />
                    ))}
                  </ul>
                </>
              ) : (
                <Empty title="No slot yet">
                  Schedule a ready video above, or publish it now; slots appear here and on the week.
                </Empty>
              )}
            </section>
          </Defer>
          <p className="page__foot">
            Times are local ({Intl.DateTimeFormat().resolvedOptions().timeZone}). Scheduled slots can move or be
            cancelled until the tick picks them up; a failed slot keeps the job's error verbatim.
          </p>
        </>
      )}
    </main>
  );
}

// ------------------------------------------------------------------ ready

function ReadyItem({ r, wired, ucName }: { r: ReadyVideo; wired: Channel[]; ucName: string }) {
  const qc = useQueryClient();
  const [channel, setChannel] = useState(wired[0]?.id ?? "");
  const [when, setWhen] = useState(() => toLocalInput(nextFullHour(new Date())));
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
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
  });
  const chosen = channel || wired[0]?.id || "";
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
    const at = fromLocalInput(when);
    if (!at) {
      setLocalError("Pick a date and time.");
      return;
    }
    setLocalError(null);
    schedule.mutate(body(at));
  };
  const base = `rd-${r.project_id}`;
  return (
    <li className="ready" data-testid={`ready-${r.project_id}`} style={artStyle(identVar(r.use_case_id))}>
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
      <form className="ready__form" onSubmit={submit}>
        <label className="fld">
          <span className="fld__k">Channel</span>
          <select id={`${base}-ch`} value={chosen} onChange={(e) => setChannel(e.target.value)} disabled={!wired.length}>
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
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
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
            onClick={() => schedule.mutate(body(new Date().toISOString()))}
          >
            Publish now <Arrow />
          </button>
        </div>
      </form>
      {localError ? <p className="cal-err" role="alert">{localError}</p> : null}
      {schedule.isError ? (
        <p className="cal-err" role="alert">
          <span className="label">Server</span> {serverError(schedule.error)}
        </p>
      ) : null}
      {!wired.length ? <p className="cal-err">No channel is wired, so nothing can be scheduled.</p> : null}
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
    <section className="cal-week" aria-labelledby="h-week">
      <div className="cal-week__bar">
        <h2 className="sec-h" id="h-week">
          <span>
            Week · {weekLabel(start)} · {count} slot{count === 1 ? "" : "s"}
          </span>
        </h2>
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
      </div>
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
    </section>
  );
}

// ------------------------------------------------------------------ list

function SlotRow({
  s,
  channel,
  pubs,
  testid,
}: {
  s: CalendarSlot;
  channel: Channel | undefined;
  pubs: MetricsPublication[];
  testid: boolean;
}) {
  const qc = useQueryClient();
  const st = slotStatus(s.status);
  const [when, setWhen] = useState(() => toLocalInput(new Date(s.publish_at)));
  const [localError, setLocalError] = useState<string | null>(null);
  const done = () => void qc.invalidateQueries({ queryKey: qk.calendar });
  const move = useMutation({ mutationFn: (at: string) => api.reschedule(s.id, at), onSuccess: done });
  const cancel = useMutation({ mutationFn: () => api.cancelSlot(s.id), onSuccess: done });
  const err = move.error ?? cancel.error;
  return (
    <li className={`slot slot--${st}`} data-testid={testid ? `slot-${s.project_id}` : undefined} style={artStyle(identVar(s.project?.use_case_id ?? ""))}>
      <span className="slot__when">
        <b className="num">{dateTimeLabel(s.publish_at)}</b>
        <span className="slot__rel">{relWhen(s.publish_at)}</span>
      </span>
      <SlotState status={st} />
      <span className="slot__what">
        <Link to="/studio/$projectId" params={{ projectId: s.project_id }} className="slot__t">
          {s.title ?? s.project?.title ?? s.project_id}
        </Link>
        <span className="slot__m mono">
          {s.project_id} · {channel?.name ?? s.channel_id} · {SLOT_META[st].hint}
        </span>
      </span>
      <span className="slot__side">
        {st === "published" ? <Visibility slot={s} channel={channel} pubs={pubs} /> : null}
        {st === "failed" ? <span className="slot__err mono">{s.error ?? "no error text"}</span> : null}
        {st === "scheduled" ? (
          <form
            className="slot__acts"
            onSubmit={(e) => {
              e.preventDefault();
              const at = fromLocalInput(when);
              if (!at) {
                setLocalError("Pick a date and time.");
                return;
              }
              setLocalError(null);
              move.mutate(at);
            }}
          >
            <label className="sr-only" htmlFor={`mv-${s.id}`}>
              New date and time
            </label>
            <input id={`mv-${s.id}`} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            <button type="submit" className="btn btn--sm" disabled={move.isPending}>
              {move.isPending ? "Moving" : "Move"}
            </button>
            <button type="button" className="btn btn--sm btn--ghost" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              {cancel.isPending ? "Cancelling" : "Cancel slot"}
            </button>
          </form>
        ) : null}
      </span>
      {localError ? <p className="cal-err slot__msg" role="alert">{localError}</p> : null}
      {err ? (
        <p className="cal-err slot__msg" role="alert">
          <span className="label">Server</span> {serverError(err)}
        </p>
      ) : null}
    </li>
  );
}
