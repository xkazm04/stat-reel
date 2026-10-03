import { describe, expect, it } from "vitest";
import { dropStaleTheme, THEME, THEME_KEY } from "./theme";

const store = (initial: string | null) => {
  let v = initial;
  return {
    getItem: (k: string) => (k === THEME_KEY ? v : null),
    removeItem: (k: string) => {
      if (k === THEME_KEY) v = null;
    },
    peek: () => v,
  };
};

describe("theme migration (ADR 009)", () => {
  it("Photo Finish is the only theme", () => {
    expect(THEME).toBe("photofinish");
  });
  it("drops a stale stored pick and keeps the current one", () => {
    const stale = store("legacy-dark");
    expect(dropStaleTheme(stale)).toBe(true);
    expect(stale.peek()).toBeNull();
    const current = store("photofinish");
    expect(dropStaleTheme(current)).toBe(false);
    expect(current.peek()).toBe("photofinish");
    expect(dropStaleTheme(store(null))).toBe(false);
  });
  it("survives blocked storage", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    };
    expect(dropStaleTheme(throwing)).toBe(false);
  });
});
