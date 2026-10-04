import type { Mode } from "@statreel/schemas";
import { describe, expect, it } from "vitest";
import { modeKeyDown } from "./finish";

/** A keydown as React delivers it: currentTarget is set during the listener and reset to null after it. */
function press(key: string, mode: Mode) {
  const focused: string[] = [];
  const changed: Mode[] = [];
  const frames: (() => void)[] = [];
  const group = { querySelector: (sel: string) => ({ focus: () => focused.push(sel) }) };
  const ev = {
    key,
    prevented: false,
    preventDefault() {
      ev.prevented = true;
    },
    currentTarget: group as typeof group | null,
  };
  modeKeyDown(
    mode,
    (m) => changed.push(m),
    (cb) => frames.push(cb),
  )(ev);
  // react-dom executeDispatch: `event.currentTarget = null` once the listener has returned
  ev.currentTarget = null;
  for (const f of frames) f();
  return { focused, changed, prevented: ev.prevented };
}

describe("ModeSwitch keyboard (radiogroup)", () => {
  it("an arrow flips the mode and focus follows to the checked radio after React reset currentTarget", () => {
    const r = press("ArrowRight", "monetized");
    expect(r.changed).toEqual(["non_commercial"]);
    expect(r.prevented).toBe(true);
    expect(r.focused).toEqual(['[data-mode="non_commercial"]']);
    expect(press("ArrowLeft", "non_commercial").focused).toEqual(['[data-mode="monetized"]']);
  });
  it("other keys do nothing", () => {
    const r = press("Enter", "monetized");
    expect(r).toEqual({ focused: [], changed: [], prevented: false });
  });
});
