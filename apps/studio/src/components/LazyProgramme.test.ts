import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// counts how often the Remotion-carrying implementation module is evaluated
const loaded = vi.hoisted(() => ({ n: 0 }));
vi.mock("./Programme", () => {
  loaded.n += 1;
  return { Programme: () => null };
});

import { Programme } from "./LazyProgramme";

const base = { format: "vertical", slate: createElement("p", null, "the slate") } as const;

describe("LazyProgramme", () => {
  it("shows the slate without importing the implementation when there are no props", () => {
    const html = renderToStaticMarkup(createElement(Programme, { ...base, props: null }));
    expect(html).toBe("<p>the slate</p>");
    expect(loaded.n).toBe(0);
  });
});
