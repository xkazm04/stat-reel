/**
 * The Board's undo stack (SPEC D.1): every reject (design, case or style) pushes an entry; the
 * toast offers the latest and a count, so an earlier mis-reject is not lost when the next one
 * lands. Bounded (UNDO_CAP) and expiring (UNDO_MS); a refused undo (409 while generation runs)
 * keeps its entry and says why. Framework-free: undo.tsx binds it to React.
 * No React, no DOM (unit-tested in undo-store.test.ts).
 */

export const UNDO_CAP = 10;
/** how long a decision stays undoable from the toast; the Rejected lane keeps the long tail */
export const UNDO_MS = 10_000;
export const NOTICE_MS = 8_000;

/** What an accept left behind (outcome.ts): the job an undo must wait for, and whether the data gate refused. */
export type UndoMeta = {
  jobId?: string | null;
  blocked?: boolean;
  /**
   * The row the decision was on ("board:<id>", "case:<id>"). A row has at most one entry: a newer decision
   * replaces the older one (its undo goes back to pending, never to the earlier verdict), and `forget` drops it
   * once the decision was undone somewhere else, so the toast never offers an undo that already happened.
   */
  key?: string;
};

export type UndoEntry = { id: number; message: string; at: number; run: () => Promise<unknown> } & UndoMeta;

// ------------------------------------------------------------------ pure stack (newest last)

/** Push, dropping the oldest entries beyond `cap`. */
export const push = (stack: readonly UndoEntry[], entry: UndoEntry, cap = UNDO_CAP): UndoEntry[] =>
  [...stack, entry].slice(-cap);
export const latest = (stack: readonly UndoEntry[]): UndoEntry | null => stack[stack.length - 1] ?? null;
/** The latest entry and the stack without it. */
export const pop = (stack: readonly UndoEntry[]): [UndoEntry | null, UndoEntry[]] => [
  latest(stack),
  stack.slice(0, -1),
];
export const removeEntry = (stack: readonly UndoEntry[], id: number): UndoEntry[] => stack.filter((e) => e.id !== id);
/** Entries still within `ttl` of their push. */
export const expire = (stack: readonly UndoEntry[], now: number, ttl = UNDO_MS): UndoEntry[] =>
  stack.filter((e) => now - e.at < ttl);
/** Ms until the oldest entry expires; null for an empty stack. Entries are pushed in time order. */
export const nextExpiry = (stack: readonly UndoEntry[], now: number, ttl = UNDO_MS): number | null => {
  const first = stack[0];
  return first ? Math.max(0, first.at + ttl - now) : null;
};

// ------------------------------------------------------------------ the store

export type UndoState = {
  stack: UndoEntry[];
  /** an undo is in flight */
  busy: boolean;
  /** the last refusal ("Could not undo: ..."), shown with the toast */
  notice: string | null;
  /** the undo was refused because this generation job still runs: the toast offers its Cancel */
  cancelJobId: string | null;
  /** the text of the one page-level live region: changes on every event, never remounted */
  said: string;
};

export type UndoStore = {
  subscribe: (l: () => void) => () => void;
  getState: () => UndoState;
  /** Offer an undo for a decision just made. */
  show: (message: string, run: () => Promise<unknown>, meta?: UndoMeta) => void;
  /** Drop the entry of a row whose decision was undone outside the toast (the Gate, the Rejected lane, a dialog). */
  forget: (key: string) => void;
  /** Undo the latest entry; false when there is none, one is in flight, or the server refused (entry kept). */
  undoLatest: (onSettled?: () => void) => Promise<boolean>;
  /** Drop everything (leaving the page). */
  reset: () => void;
};

export function createUndoStore(
  opts: {
    cap?: number;
    ttl?: number;
    now?: () => number;
    describeError?: (e: unknown) => string;
    /** a refusal that means "its generation job still runs" (409); with an entry job id it asks to cancel first */
    isConflict?: (e: unknown) => boolean;
    conflictNotice?: string;
  } = {},
): UndoStore {
  const cap = opts.cap ?? UNDO_CAP;
  const ttl = opts.ttl ?? UNDO_MS;
  const now = opts.now ?? Date.now;
  const describe = opts.describeError ?? ((e: unknown) => (e instanceof Error ? e.message : String(e)));
  let state: UndoState = { stack: [], busy: false, notice: null, cancelJobId: null, said: "" };
  let seq = 0;
  let flip = false;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<UndoState>) => {
    state = { ...state, ...patch };
    for (const l of listeners) l();
  };
  /** the same sentence twice in a row must still change the live region's text */
  const say = (text: string) => {
    flip = !flip;
    return flip ? text : `${text} `;
  };
  const arm = () => {
    clearTimeout(expiry);
    const ms = nextExpiry(state.stack, now(), ttl);
    if (ms === null) return;
    expiry = setTimeout(() => {
      set({ stack: expire(state.stack, now(), ttl) });
      arm();
    }, ms + 1);
  };
  const notify = (message: string) => {
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => set({ notice: null }), NOTICE_MS);
    set({ notice: message, cancelJobId: null, said: say(message) });
  };
  /** the cancel offer stays until the owner acts (no timer) and the entry's clock restarts, so it outlives the cancel */
  const notifyCancelFirst = (entry: UndoEntry, message: string) => {
    clearTimeout(noticeTimer);
    const stack = state.stack.map((e) => (e.id === entry.id ? { ...e, at: now() } : e));
    set({ stack, notice: message, cancelJobId: entry.jobId ?? null, said: say(message) });
    arm();
  };

  return {
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getState: () => state,
    show: (message, run, meta) => {
      const live = expire(state.stack, now(), ttl).filter((e) => !meta?.key || e.key !== meta.key);
      const stack = push(live, { id: ++seq, message, at: now(), run, ...meta }, cap);
      set({ stack, notice: null, cancelJobId: null, said: say(`${message}. Press Z to undo.`) });
      arm();
    },
    forget: (key) => {
      if (!state.stack.some((e) => e.key === key)) return;
      set({ stack: state.stack.filter((e) => e.key !== key), notice: null, cancelJobId: null });
      arm();
    },
    undoLatest: async (onSettled) => {
      const entry = latest(state.stack);
      if (!entry || state.busy) return false;
      set({ busy: true, cancelJobId: null });
      try {
        await entry.run();
        set({
          stack: removeEntry(state.stack, entry.id),
          notice: null,
          cancelJobId: null,
          said: say(`Undone: ${entry.message}`),
        });
        arm();
        return true;
      } catch (e) {
        // keep the entry: the owner can retry once the server allows it
        if (entry.jobId && opts.isConflict?.(e)) {
          notifyCancelFirst(entry, opts.conflictNotice ?? describe(e));
          return false;
        }
        notify(`Could not undo: ${describe(e)}`);
        return false;
      } finally {
        set({ busy: false });
        onSettled?.();
      }
    },
    reset: () => {
      clearTimeout(expiry);
      clearTimeout(noticeTimer);
      set({ stack: [], busy: false, notice: null, cancelJobId: null, said: "" });
    },
  };
}
