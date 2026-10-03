import { readFileSync } from "node:fs";
import { frameStatSvg } from "@statreel/design-tokens";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Wordmark } from "./components/Wordmark";

describe("Wordmark (ADR 009)", () => {
  const html = renderToStaticMarkup(createElement(Wordmark));

  it("draws the Frame Stat icon before STAT | REEL", () => {
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).toContain('focusable="false"');
    expect(html.match(/class="fsm__bar/g)).toHaveLength(4);
    expect(html.match(/class="fsm__bar fsm__bar--lead"/g)).toHaveLength(1);
    expect(html.match(/class="fsm__hole"/g)).toHaveLength(12);
    expect(html).toContain("STAT");
    expect(html).toContain("REEL");
    expect(html.indexOf("<svg")).toBeLessThan(html.indexOf("STAT"));
    expect(html.indexOf("STAT")).toBeLessThan(html.indexOf("pf-mark__l"));
    expect(html.indexOf("pf-mark__l")).toBeLessThan(html.indexOf("REEL"));
  });

  it("is theme-free: no theme classes or hooks", () => {
    expect(html).not.toMatch(/oa-|theme/i);
  });

  it("the favicon is generated from the shared geometry", () => {
    const fav = readFileSync(new URL("../public/favicon.svg", import.meta.url), "utf8").trim();
    const expected = frameStatSvg({
      ink: "#12161a",
      paper: "#eceff2",
      bars: ["#12161a", "#12161a", "#12161a", "#e4432a"],
    });
    expect(fav).toBe(expected);
  });
});
