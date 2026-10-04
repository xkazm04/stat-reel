/** In-process event bus; the SSE route (/events) fans it out to the studio. */
export type AppEvent = { type: string; at?: string; [k: string]: unknown };
type Listener = (e: AppEvent) => void;

export class EventBus {
  private listeners = new Set<Listener>();
  /** listener failures swallowed by emit(); a listener's bug must not break the emitter (e.g. JobRunner.finish) */
  dropped = 0;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(e: AppEvent): void {
    const stamped = { at: new Date().toISOString(), ...e };
    for (const fn of [...this.listeners]) {
      try {
        fn(stamped);
      } catch (err) {
        this.dropped++;
        console.error(`[events] listener failed on ${e.type} (${this.dropped} dropped): ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      }
    }
  }
}

/** Min gap between two `job.progress` frames of one job on one SSE client (the DB row and the bus stay unthrottled). */
export const PROGRESS_SSE_INTERVAL_MS = 250;

/**
 * Per-client SSE rate limit for `job.progress` (~4/s per job): a burst collapses to its latest value,
 * delivered on a trailing timer so the last progress is never lost, and any other event of the same job
 * (started/succeeded/...) flushes the pending value first so a stale progress never lands after the end.
 * Every other event type passes straight through.
 */
export function throttleProgress(send: (e: AppEvent) => void, intervalMs = PROGRESS_SSE_INTERVAL_MS) {
  type Slot = { last: number; pending?: AppEvent; timer?: NodeJS.Timeout };
  const slots = new Map<string, Slot>();
  const flush = (s: Slot) => {
    if (s.timer) clearTimeout(s.timer);
    s.timer = undefined;
    const p = s.pending;
    s.pending = undefined;
    if (p) {
      s.last = Date.now();
      send(p);
    }
  };
  const progress = (id: string, e: AppEvent) => {
    const t = Date.now();
    const s = slots.get(id) ?? { last: Number.NEGATIVE_INFINITY };
    slots.set(id, s);
    if (t - s.last >= intervalMs && !s.timer) {
      s.last = t;
      send(e);
      return;
    }
    s.pending = e;
    if (!s.timer) {
      s.timer = setTimeout(() => flush(s), Math.max(0, intervalMs - (t - s.last)));
      s.timer.unref();
    }
  };
  return {
    push(e: AppEvent): void {
      const id = typeof e.id === "string" ? e.id : undefined;
      if (id && e.type === "job.progress") {
        progress(id, e);
        return;
      }
      const s = id ? slots.get(id) : undefined;
      if (id && s) {
        flush(s);
        if (/^job.(succeeded|failed|cancelled|refused)$/.test(e.type)) slots.delete(id);
      }
      send(e);
    },
    dispose(): void {
      for (const s of slots.values()) if (s.timer) clearTimeout(s.timer);
      slots.clear();
    },
  };
}
