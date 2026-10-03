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
