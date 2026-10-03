import { describe, expect, it } from "vitest";
import { createFrameClock, type FrameSource } from "./playerClock";

function fakePlayer(start = 0) {
  const hs = new Map<string, Set<(e: { detail: { frame: number } }) => void>>();
  let cur = start;
  const src: FrameSource = {
    addEventListener: (t, h) => void (hs.get(t) ?? hs.set(t, new Set()).get(t))?.add(h),
    removeEventListener: (t, h) => void hs.get(t)?.delete(h),
    getCurrentFrame: () => cur,
  };
  return {
    src,
    emit(type: "frameupdate" | "seeked", frame: number) {
      cur = frame;
      for (const h of hs.get(type) ?? []) h({ detail: { frame } });
    },
    listeners: () => [...hs.values()].reduce((n, s) => n + s.size, 0),
  };
}

describe("frame clock", () => {
  it("follows frameupdate and seeked, starting from the player's current frame", () => {
    const p = fakePlayer(12);
    const c = createFrameClock();
    c.attach(p.src);
    expect(c.get()).toBe(12);
    p.emit("frameupdate", 13);
    expect(c.get()).toBe(13);
    p.emit("seeked", 90);
    expect(c.get()).toBe(90);
  });

  it("notifies subscribers per change only, and a derived leaf can skip frames that do not change it", () => {
    const p = fakePlayer();
    const c = createFrameClock();
    c.attach(p.src);
    let raw = 0;
    let scene = 0;
    let lastScene = Math.floor(c.get() / 30);
    c.subscribe(() => raw++);
    c.subscribe(() => {
      const s = Math.floor(c.get() / 30);
      if (s !== lastScene) {
        lastScene = s;
        scene++;
      }
    });
    for (let f = 1; f <= 60; f++) p.emit("frameupdate", f);
    p.emit("frameupdate", 60); // a repeated frame is not a change
    expect(raw).toBe(60);
    expect(scene).toBe(2); // the selector value changes at 30 and 60 only
  });

  it("detaches cleanly and stops notifying unsubscribed leaves", () => {
    const p = fakePlayer();
    const c = createFrameClock();
    const detach = c.attach(p.src);
    let n = 0;
    const off = c.subscribe(() => n++);
    p.emit("frameupdate", 1);
    off();
    p.emit("frameupdate", 2);
    expect(n).toBe(1);
    detach();
    expect(p.listeners()).toBe(0);
    p.emit("frameupdate", 3);
    expect(c.get()).toBe(2);
  });
});
