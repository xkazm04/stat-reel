/**
 * Server-side bridge from the worker process to the studio (ADR 010): the worker appends
 * `generation_job_events`; this 1 s poller re-emits each row exactly once, in order, as a
 * `gen.<type>` event on the existing EventBus (and so over SSE). Events that predate the server
 * start are not replayed.
 */
import type { Db } from "../db";
import type { EventBus } from "../events";

export class GenerationEventsRelay {
  private last: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly db: Db, private readonly bus: EventBus, private readonly intervalMs = 1000, fromStart = false) {
    const max = (db.$client.prepare("select coalesce(max(id), 0) m from generation_job_events").get() as { m: number }).m;
    this.last = fromStart ? 0 : max;
  }

  /** Emit every row newer than the last one seen. Returns how many were emitted. */
  poll(): number {
    const rows = this.db.$client.prepare("select id, job_id, at, type, data_json from generation_job_events where id > ? order by id").all(this.last) as {
      id: number; job_id: string; at: string; type: string; data_json: string;
    }[];
    for (const r of rows) {
      this.last = r.id;
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(r.data_json) as Record<string, unknown>; } catch { /* keep empty */ }
      this.bus.emit({ ...data, type: `gen.${r.type}`, job_id: r.job_id, at: r.at });
    }
    return rows.length;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try { this.poll(); } catch { /* db briefly locked: next tick */ }
    }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
