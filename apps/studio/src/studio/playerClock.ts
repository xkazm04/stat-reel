/**
 * The player's frame clock outside React state. The media-playback golden path: the clock is the
 * authority and it does not live in render state. The Remotion player emits `frameupdate` ~30x/s;
 * if that fed useState in Monitor or Tracks, the whole monitor (Player included) and every lane
 * would re-render per frame. Here the frame lives in a tiny store: leaves subscribe with
 * useClockSelect (re-render only when their selected value changes) or write the DOM directly
 * (the Tracks needle). The store itself has no React and no DOM dependency (unit-tested).
 */
import type { PlayerRef } from "@remotion/player";
import { type RefObject, useEffect, useMemo, useSyncExternalStore } from "react";
import type { PlayerMeta } from "../components/Programme";

/** The slice of PlayerRef the clock reads (a fake emitter satisfies it in tests). */
export type FrameSource = {
  addEventListener(type: "frameupdate" | "seeked", h: (e: { detail: { frame: number } }) => void): void;
  removeEventListener(type: "frameupdate" | "seeked", h: (e: { detail: { frame: number } }) => void): void;
  getCurrentFrame(): number;
};

export type FrameClock = {
  get(): number;
  subscribe(fn: () => void): () => void;
  /** follow a player; returns the detach function. Resets to the player's current frame. */
  attach(source: FrameSource): () => void;
  /** set directly (also the reset to 0 when no player is attached); notifies only on change */
  set(frame: number): void;
};

export function createFrameClock(): FrameClock {
  let frame = 0;
  const subs = new Set<() => void>();
  const set = (f: number) => {
    if (f === frame) return;
    frame = f;
    for (const s of [...subs]) s();
  };
  return {
    get: () => frame,
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    set,
    attach(source) {
      const h = (e: { detail: { frame: number } }) => set(e.detail.frame);
      source.addEventListener("frameupdate", h);
      source.addEventListener("seeked", h);
      set(source.getCurrentFrame());
      return () => {
        source.removeEventListener("frameupdate", h);
        source.removeEventListener("seeked", h);
      };
    },
  };
}

/** One clock per monitor; the returned object is stable, so passing it down never re-renders anyone. */
export function usePlayerClock(ref: RefObject<PlayerRef | null>, meta: PlayerMeta | null): FrameClock {
  const clock = useMemo(createFrameClock, []);
  useEffect(() => {
    const p = ref.current;
    if (!p || !meta) {
      clock.set(0);
      return;
    }
    return clock.attach(p);
  }, [clock, ref, meta]);
  return clock;
}

/**
 * Subscribe to a value derived from the frame. The component re-renders only when `select` returns a
 * different primitive, so e.g. "scene under the playhead" costs a render per cut, not per frame.
 */
export function useClockSelect<T extends string | number | boolean | null>(
  clock: FrameClock,
  select: (frame: number) => T,
): T {
  return useSyncExternalStore(clock.subscribe, () => select(clock.get()));
}
