/** In-process event bus; the SSE route (/events) fans it out to the studio. */
export type AppEvent = { type: string; at?: string; [k: string]: unknown };
type Listener = (e: AppEvent) => void;

export class EventBus {
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(e: AppEvent): void {
    const stamped = { at: new Date().toISOString(), ...e };
    for (const fn of this.listeners) fn(stamped);
  }
}
